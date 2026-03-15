import {
  CharacterImageAssumptionResponse,
  CharacterImageBuilderOutput,
  CharacterImageClarifierResponse,
  CharacterImageJudgeOutput,
  CharacterImageLedgerEntry,
  CharacterImagePack,
  CharacterImageSessionState,
  CharacterImageTurn,
  CharacterImagePromptHistoryEntry,
  CharacterImagePromptOverrides,
  CharacterImagePromptPreview,
  GeneratedCharacterImage,
  VisualDescription,
} from "../../shared/types/characterImage";
import { CharacterPack } from "../../shared/types/character";
import { CharacterImageStore } from "../storage/characterImageStore";
import { CharacterStore } from "../storage/characterStore";
import { ProjectStore } from "../storage/projectStore";
import { LLMClient } from "./llmClient";
import { AnimeGenClient } from "./animeGenClient";
import {
  CHARACTER_IMAGE_BUILDER_SYSTEM,
  CHARACTER_IMAGE_BUILDER_USER_TEMPLATE,
  CHARACTER_IMAGE_CLARIFIER_SYSTEM,
  CHARACTER_IMAGE_CLARIFIER_USER_TEMPLATE,
  CHARACTER_IMAGE_JUDGE_SYSTEM,
  CHARACTER_IMAGE_JUDGE_USER_TEMPLATE,
  CHARACTER_IMAGE_SUMMARY_SYSTEM,
  CHARACTER_IMAGE_SUMMARY_USER_TEMPLATE,
} from "./characterImagePrompts";
import {
  CHARACTER_IMAGE_BUILDER_SCHEMA,
  CHARACTER_IMAGE_CLARIFIER_SCHEMA,
  CHARACTER_IMAGE_JUDGE_SCHEMA,
} from "./characterImageSchemas";
import {
  createEmptyLedger,
  recordHypotheses,
  recordSignals,
  recordAssumptionDelta,
  updateHeuristics,
  checkPersistence,
  formatPsychologyLedgerForPrompt,
  formatSignalsForBuilderJudge,
  formatEngineDialsForPrompt,
  snapshotBaselineForNewModule,
  runConsolidation,
  applyConsolidation,
  formatSuggestedProbeForPrompt,
  markProbeConsumed,
} from "./psychologyEngine";
import type { RawSignalObservation, BehaviorSummary, AdaptationPlan } from "../../shared/types/userPsychology";
import {
  runDivergenceExploration,
  extractDivergenceContext,
  formatDirectionMapForPrompt,
} from "./divergenceExplorer";
import { culturalResearchService } from "./runtime";
import { detectDirectedReferences, shouldRunCulturalResearch } from "./culturalResearchService";
import type { CulturalResearchContext } from "./culturalResearchService";

// ─── API response types ───

export interface CharacterImageClarifyResponse {
  clarifier: CharacterImageClarifierResponse;
  turnNumber: number;
  totalTurns: number;
}

export interface CharacterImageGenerateResponse {
  specs: CharacterImageBuilderOutput;
  judge: {
    passed: boolean;
    hard_fail_reasons: string[];
    scores: CharacterImageJudgeOutput["scores"];
    distinctiveness_notes: string;
    one_fix_instruction: string;
  } | null;
}

export interface CharacterImageGenerateImagesResponse {
  images: Record<string, GeneratedCharacterImage>;
  generationTimeMs: number;
}

// ─── Error class ───

export class CharacterImageServiceError extends Error {
  code: "NOT_FOUND" | "INVALID_INPUT" | "LLM_PARSE_ERROR" | "LLM_CALL_FAILED" | "IMAGE_GEN_FAILED";

  constructor(
    code: "NOT_FOUND" | "INVALID_INPUT" | "LLM_PARSE_ERROR" | "LLM_CALL_FAILED" | "IMAGE_GEN_FAILED",
    message: string
  ) {
    super(message);
    this.code = code;
  }
}

// ─── Service ───

export class CharacterImageService {
  constructor(
    private imageStore: CharacterImageStore,
    private charStore: CharacterStore,
    private hookStore: ProjectStore,
    private llm: LLMClient,
    private animeGen: AnimeGenClient
  ) {}

  // ─── Preview Prompt (no LLM call) ───

  async previewPrompt(
    projectId: string,
    stage: "clarifier" | "builder" | "judge" | "summary",
  ): Promise<CharacterImagePromptPreview> {
    const session = await this.imageStore.get(projectId);
    if (!session) {
      throw new CharacterImageServiceError("NOT_FOUND", "Character image session not found");
    }

    switch (stage) {
      case "clarifier": {
        const prompt = await this.buildClarifierPrompt(session);
        return { stage, system: prompt.system, user: prompt.user };
      }
      case "builder": {
        const prompt = await this.buildBuilderPrompt(session);
        return { stage, system: prompt.system, user: prompt.user };
      }
      case "judge": {
        if (session.revealedSpecs) {
          const prompt = this.buildJudgePrompt(session.revealedSpecs, session);
          return { stage, system: prompt.system, user: prompt.user };
        }
        return {
          stage,
          system: CHARACTER_IMAGE_JUDGE_SYSTEM,
          user: "(generated at runtime after builder runs)",
        };
      }
      case "summary": {
        const prompt = this.buildSummaryPrompt(session);
        return { stage, system: prompt.system, user: prompt.user };
      }
    }
  }

  // ─── Clarifier Turn ───

  async runClarifierTurn(
    projectId: string,
    characterProjectId: string,
    userSelection?: { type: "option" | "free_text" | "surprise_me"; optionId?: string; label: string },
    modelOverride?: string,
    promptOverrides?: CharacterImagePromptOverrides,
    assumptionResponses?: CharacterImageAssumptionResponse[],
    visualSeed?: string,
  ): Promise<CharacterImageClarifyResponse> {
    let session = await this.imageStore.get(projectId);
    const isFirstTurn = !session || session.turns.length === 0;

    if (isFirstTurn) {
      if (userSelection) {
        throw new CharacterImageServiceError("INVALID_INPUT", "First turn cannot have userSelection");
      }

      if (!session) {
        // Load the character export
        const charExport = await this.charStore.getExport(characterProjectId);
        if (!charExport || !charExport.characterPack) {
          throw new CharacterImageServiceError(
            "NOT_FOUND",
            "Character export not found or characters not locked. Complete the character module first."
          );
        }

        const sourceCharacterPack = charExport.characterPack;

        // Import confirmed character visual ledger entries
        const importedLedger: CharacterImageLedgerEntry[] = [];
        if (charExport.constraintLedger) {
          for (const entry of charExport.constraintLedger) {
            importedLedger.push({
              key: `char.${entry.key}`,
              value: entry.value,
              source: "character_imported",
              confidence: "imported",
              turnNumber: 0,
            });
          }
        }

        // Import psychology ledger: prefer export (curated handoff), fall back to session
        let importedPsychLedger = createEmptyLedger();
        if (charExport.psychologyLedger) {
          importedPsychLedger = charExport.psychologyLedger;
        } else {
          // Legacy: export didn't include psychology ledger, try loading from session
          const charSession = await this.charStore.get(characterProjectId);
          if (charSession?.psychologyLedger) {
            importedPsychLedger = charSession.psychologyLedger;
          }
        }
        // Snapshot character module's accumulated stats as baseline for this module
        snapshotBaselineForNewModule(importedPsychLedger);

        session = {
          projectId,
          characterProjectId,
          sourceCharacterPack,
          visualSeed: visualSeed ?? undefined,
          turns: [],
          constraintLedger: importedLedger,
          generatedImages: {},
          status: "seeding",
          psychologyLedger: importedPsychLedger,
        };
      }

      if (session && visualSeed) {
        session.visualSeed = visualSeed;
      }

      // Move to clarifying after first turn (seeding is just the visual seed input)
      session!.status = "clarifying";
    } else {
      if (!session) {
        throw new CharacterImageServiceError("NOT_FOUND", "Character image session not found");
      }

      if (session.status === "revealed" || session.status === "locked" || session.status === "image_review") {
        throw new CharacterImageServiceError("INVALID_INPUT", "Session already progressed; reset first");
      }

      if (!userSelection) {
        throw new CharacterImageServiceError("INVALID_INPUT", "Subsequent turns require userSelection");
      }

      const previousTurn = session.turns[session.turns.length - 1];
      if (!previousTurn) {
        throw new CharacterImageServiceError("INVALID_INPUT", "No clarifier turn to attach selection to");
      }

      if (userSelection.type === "option") {
        const isValid = previousTurn.clarifierResponse.options.some(
          (opt) => opt.id === userSelection.optionId
        );
        if (!userSelection.optionId || !isValid) {
          throw new CharacterImageServiceError("INVALID_INPUT", "optionId must exist in previous turn options");
        }
      }

      previousTurn.userSelection = userSelection;

      if (assumptionResponses && assumptionResponses.length > 0) {
        previousTurn.assumptionResponses = assumptionResponses;
      }

      // Process assumption responses into ledger
      if (!session.constraintLedger) session.constraintLedger = [];
      this.processAssumptionResponses(session, assumptionResponses ?? [], session.turns.length);

      // Non-choice tracking
      if (session.psychologyLedger) {
        const offeredIds: string[] = [];
        for (const a of previousTurn.clarifierResponse.assumptions ?? []) {
          offeredIds.push(a.id);
        }
        const respondedIds = (assumptionResponses ?? []).map((r) => r.assumptionId);
        const actions: Record<string, "keep" | "alternative" | "freeform" | "not_ready"> = {};
        for (const r of assumptionResponses ?? []) {
          actions[r.assumptionId] = r.action;
        }
        recordAssumptionDelta(
          session.psychologyLedger,
          session.turns.length,
          offeredIds,
          respondedIds,
          actions
        );

        // Track whether prior hypothesis-informed changes persisted
        checkPersistence(session.psychologyLedger, session.turns.length, actions);
      }
    }

    if (!session) {
      throw new CharacterImageServiceError("NOT_FOUND", "Session not found");
    }

    // Save before LLM call (crash recovery)
    session.lastSavedAt = new Date().toISOString();
    await this.imageStore.save(session);

    const prompt = await this.buildClarifierPrompt(session);
    const systemPrompt = promptOverrides?.system ?? prompt.system;
    const userPrompt = promptOverrides?.user ?? prompt.user;

    // Record prompt history
    this.recordPromptHistory(
      session, "clarifier", prompt.system, prompt.user,
      promptOverrides, "(pending)"
    );

    let clarifierRaw: string;
    try {
      clarifierRaw = await this.llm.call("img_clarifier", systemPrompt, userPrompt, {
        temperature: 0.85,
        maxTokens: 4000,
        modelOverride,
        jsonSchema: CHARACTER_IMAGE_CLARIFIER_SCHEMA,
      });
    } catch (err) {
      console.error("IMG CLARIFIER LLM ERROR:", err);
      throw new CharacterImageServiceError("LLM_CALL_FAILED", "Character image clarifier call failed");
    }

    const clarifier = this.parseAndValidate<CharacterImageClarifierResponse>(clarifierRaw, [
      "hypothesis_line", "question", "options", "ready_for_images", "assumptions", "user_read",
    ]);

    if (!clarifier) {
      throw new CharacterImageServiceError("LLM_PARSE_ERROR", "Failed to parse character image clarifier response");
    }

    // Update prompt history with actual response
    if (session.promptHistory && session.promptHistory.length > 0) {
      session.promptHistory[session.promptHistory.length - 1].responseSummary = clarifierRaw.slice(0, 500);
    }

    // Psychology Ledger: record LLM's structured signals + update heuristics
    if (!session.psychologyLedger) session.psychologyLedger = createEmptyLedger();
    if (clarifier.user_read && typeof clarifier.user_read === "object") {
      const ur = clarifier.user_read;
      if (ur.signals && ur.behaviorSummary) {
        recordSignals(
          session.psychologyLedger,
          session.turns.length + 1,
          "character_image",
          ur.signals as RawSignalObservation[],
          ur.behaviorSummary as BehaviorSummary,
          (ur.adaptationPlan as AdaptationPlan) ?? { dominantNeed: "", moves: [] },
        );
      } else {
        recordHypotheses(
          session.psychologyLedger,
          session.turns.length + 1,
          "character_image",
          (ur as any).hypotheses ?? [],
          (ur as any).overall_read ?? "",
          (ur as any).satisfaction
        );
      }
    }
    this.updatePsychologyHeuristics(session);

    const turn: CharacterImageTurn = {
      turnNumber: session.turns.length + 1,
      clarifierResponse: clarifier,
      userSelection: null,
    };

    // Suppress readiness on the very first turn
    if (session.turns.length < 1 && turn.clarifierResponse.ready_for_images) {
      turn.clarifierResponse.ready_for_images = false;
    }

    // Readiness convergence safety net (tighter for image module — most creative decisions already made)
    if (turn.clarifierResponse.readiness_pct >= 60) {
      session.consecutiveHighReadiness = (session.consecutiveHighReadiness ?? 0) + 1;
    } else {
      session.consecutiveHighReadiness = 0;
    }

    if (
      (session.consecutiveHighReadiness >= 2 && session.turns.length >= 2) ||
      (session.turns.length >= 4) // Hard cap: 4 turns max for visual clarification
    ) {
      if (!turn.clarifierResponse.ready_for_images) {
        turn.clarifierResponse.ready_for_images = true;
        turn.clarifierResponse.readiness_note =
          turn.clarifierResponse.readiness_note || "Your characters are taking visual shape — ready to see them!";
      }
    }

    session.turns.push(turn);
    session.status = "clarifying";
    session.lastSavedAt = new Date().toISOString();

    // Mark any pending probe as consumed
    if (session.psychologyLedger) {
      markProbeConsumed(session.psychologyLedger, turn.turnNumber);
    }

    await this.imageStore.save(session);

    // ─── Fire background consolidation (non-blocking) ───
    if (session.psychologyLedger && session.psychologyLedger.signalStore.length > 0) {
      this.fireBackgroundConsolidation(session.projectId, turn.turnNumber, "character_image")
        .catch(err => console.error("[PSYCH] CharImage consolidation fire failed:", err));
    }

    // ─── Fire background divergence exploration (non-blocking) ───
    if (turn.turnNumber >= 2) {
      this.fireBackgroundDivergence(session.projectId, turn.turnNumber, "character_image")
        .catch(err => console.error("[DIVERGENCE] CharImage exploration fire failed:", err));
    }

    // Fire background cultural research (non-blocking, throttled)
    const hasCachedBrief = !!(await culturalResearchService.getBriefForBuilder(
      session.projectId, "character_image", turn.turnNumber,
    ).catch(() => null));
    if (shouldRunCulturalResearch({ turnNumber: turn.turnNumber, userSelection: turn.userSelection, hasCachedBrief })) {
      this.fireBackgroundCulturalResearch(session, turn.turnNumber)
        .catch(err => console.error("[CULTURAL] Background research fire failed:", err));
    }

    return {
      clarifier: turn.clarifierResponse,
      turnNumber: turn.turnNumber,
      totalTurns: session.turns.length,
    };
  }

  /**
   * Fire-and-forget background consolidation for character image module.
   */
  private async fireBackgroundConsolidation(
    projectId: string,
    turnNumber: number,
    module: "hook" | "character" | "character_image" | "world",
  ): Promise<void> {
    const sessionForConsolidation = await this.imageStore.get(projectId);
    if (!sessionForConsolidation?.psychologyLedger) return;

    const snapshot = await runConsolidation(
      sessionForConsolidation.psychologyLedger,
      turnNumber,
      module,
      this.llm,
    );

    if (snapshot) {
      const freshSession = await this.imageStore.get(projectId);
      if (!freshSession) return;

      if (!freshSession.psychologyLedger) freshSession.psychologyLedger = createEmptyLedger();

      const staleIds = new Set(sessionForConsolidation.psychologyLedger!.signalStore.map(s => s.id));
      const newSignals = freshSession.psychologyLedger.signalStore.filter(s => !staleIds.has(s.id));

      applyConsolidation(freshSession.psychologyLedger, snapshot.result, turnNumber, module);
      freshSession.psychologyLedger.signalStore.push(...newSignals);
      freshSession.psychologyLedger.lastConsolidation = snapshot;
      freshSession.psychologyLedger.signalCountAtLastConsolidation = freshSession.psychologyLedger.signalStore.length;

      freshSession.lastSavedAt = new Date().toISOString();
      await this.imageStore.save(freshSession);
    }
  }

  /**
   * Fire-and-forget background divergence exploration for character image module.
   */
  private async fireBackgroundDivergence(
    projectId: string,
    turnNumber: number,
    module: "hook" | "character" | "character_image" | "world",
  ): Promise<void> {
    // Re-read fresh session to avoid using a stale reference
    const session = await this.imageStore.get(projectId);
    if (!session) return;

    const psychSummary = formatPsychologyLedgerForPrompt(session.psychologyLedger);
    // Build a state snapshot from character-image fields for divergence explorer
    const imageState: Record<string, unknown> = {};
    if (session.revealedSpecs) imageState.revealedSpecs = session.revealedSpecs;
    if (session.artStylePreference) imageState.artStyle = session.artStylePreference;
    if (session.visualSeed) imageState.visualSeed = session.visualSeed;
    const seedInput = session.sourceCharacterPack?.locked?.characters
      ? Object.values(session.sourceCharacterPack.locked.characters).map(c => (c as any).description ?? "").join("; ")
      : "";
    const previousFamilyNames = session.psychologyLedger?.lastDirectionMap?.directionMap?.families
      ?.map(f => f.name) ?? [];
    const context = extractDivergenceContext(
      seedInput,
      session.constraintLedger,
      imageState,
      psychSummary,
      turnNumber,
      module,
      previousFamilyNames,
    );

    const snapshot = await runDivergenceExploration(context, this.llm);

    if (snapshot) {
      const freshSession = await this.imageStore.get(session.projectId);
      if (!freshSession) return;

      if (!freshSession.psychologyLedger) freshSession.psychologyLedger = createEmptyLedger();
      freshSession.psychologyLedger.lastDirectionMap = snapshot;
      freshSession.lastSavedAt = new Date().toISOString();
      await this.imageStore.save(freshSession);
    }
  }

  // ─── Generate Visual Specs (builder + judge) ───

  async runGenerate(
    projectId: string,
    modelOverride?: string,
    promptOverrides?: { builder?: CharacterImagePromptOverrides; judge?: CharacterImagePromptOverrides },
  ): Promise<CharacterImageGenerateResponse> {
    const session = await this.imageStore.get(projectId);
    if (!session) {
      throw new CharacterImageServiceError("NOT_FOUND", "Character image session not found");
    }

    session.status = "generating";
    session.lastSavedAt = new Date().toISOString();
    await this.imageStore.save(session);

    // Build prompts
    const builderPrompt = await this.buildBuilderPrompt(session);
    const builderSystem = promptOverrides?.builder?.system ?? builderPrompt.system;
    const builderUser = promptOverrides?.builder?.user ?? builderPrompt.user;

    let builderRaw: string;
    try {
      builderRaw = await this.llm.call("img_builder", builderSystem, builderUser, {
        temperature: 0.8,
        maxTokens: 12000,
        modelOverride,
        jsonSchema: CHARACTER_IMAGE_BUILDER_SCHEMA,
      });
    } catch (err) {
      console.error("IMG BUILDER LLM ERROR:", err);
      session.status = "clarifying";
      await this.imageStore.save(session);
      throw new CharacterImageServiceError("LLM_CALL_FAILED", "Character image builder call failed");
    }

    let builderResult = this.parseAndValidate<CharacterImageBuilderOutput>(builderRaw, [
      "characters", "ensemble_cohesion_note", "style_recommendation", "style_reasoning",
    ]);

    // Convert characters from LLM array format to Record<role, VisualDescription>
    if (builderResult && Array.isArray(builderResult.characters)) {
      const charsRecord: Record<string, VisualDescription> = {};
      for (const desc of builderResult.characters as any[]) {
        if (desc.role) {
          charsRecord[desc.role] = desc;
        }
      }
      builderResult.characters = charsRecord;
    }

    if (!builderResult) {
      session.status = "clarifying";
      await this.imageStore.save(session);
      throw new CharacterImageServiceError("LLM_PARSE_ERROR", "Failed to parse character image builder response");
    }

    // Record builder prompt history
    this.recordPromptHistory(
      session, "builder", builderPrompt.system, builderPrompt.user,
      promptOverrides?.builder,
      Object.keys(builderResult.characters).join(", ")
    );

    session.lastSavedAt = new Date().toISOString();
    await this.imageStore.save(session);

    // Judge pass
    const judgePrompt = this.buildJudgePrompt(builderResult, session);
    const judgeSystem = promptOverrides?.judge?.system ?? judgePrompt.system;
    const judgeUser = promptOverrides?.judge?.user ?? judgePrompt.user;

    let judgeRaw: string;
    try {
      judgeRaw = await this.llm.call("img_judge", judgeSystem, judgeUser, {
        temperature: 0.3,
        maxTokens: 1200,
        modelOverride,
        jsonSchema: CHARACTER_IMAGE_JUDGE_SCHEMA,
      });
    } catch (err) {
      console.error("IMG JUDGE LLM ERROR:", err);
      // Non-fatal: reveal without judge
      session.revealedSpecs = builderResult;
      session.status = "revealed";
      session.lastSavedAt = new Date().toISOString();
      await this.imageStore.save(session);
      return { specs: builderResult, judge: null };
    }

    const judgeResult = this.parseAndValidate<CharacterImageJudgeOutput>(judgeRaw, [
      "pass", "hard_fail_reasons", "scores", "distinctiveness_notes", "one_fix_instruction",
    ]);

    // Record judge prompt history
    this.recordPromptHistory(
      session, "judge", judgePrompt.system, judgePrompt.user,
      promptOverrides?.judge,
      judgeResult ? `${judgeResult.pass ? "PASS" : "FAIL"}` : "PARSE_FAILED"
    );

    session.revealedSpecs = builderResult;
    session.revealedJudge = judgeResult ?? undefined;
    session.status = "revealed";
    session.lastSavedAt = new Date().toISOString();

    await this.imageStore.save(session);

    return {
      specs: builderResult,
      judge: judgeResult ? {
        passed: judgeResult.pass,
        hard_fail_reasons: judgeResult.hard_fail_reasons,
        scores: judgeResult.scores,
        distinctiveness_notes: judgeResult.distinctiveness_notes,
        one_fix_instruction: judgeResult.one_fix_instruction,
      } : null,
    };
  }

  // ─── Reroll (regenerate visual specs) ───

  async reroll(
    projectId: string,
    modelOverride?: string,
    promptOverrides?: { builder?: CharacterImagePromptOverrides; judge?: CharacterImagePromptOverrides },
  ): Promise<CharacterImageGenerateResponse> {
    const session = await this.imageStore.get(projectId);
    if (!session) {
      throw new CharacterImageServiceError("NOT_FOUND", "Character image session not found");
    }
    if (session.status !== "revealed") {
      throw new CharacterImageServiceError("INVALID_INPUT", "Must be in revealed status to reroll");
    }

    session.revealedSpecs = undefined;
    session.revealedJudge = undefined;

    return this.runGenerate(projectId, modelOverride, promptOverrides);
  }

  // ─── Generate Images (call anime-gen API for each character) ───

  async generateImages(
    projectId: string,
    checkpoint: string,
    lora?: string | null,
    quality?: string,
    seed?: number,
  ): Promise<CharacterImageGenerateImagesResponse> {
    const session = await this.imageStore.get(projectId);
    if (!session) {
      throw new CharacterImageServiceError("NOT_FOUND", "Character image session not found");
    }
    if (!session.revealedSpecs) {
      throw new CharacterImageServiceError("INVALID_INPUT", "Visual specs must be generated first");
    }

    // Check anime-gen connectivity
    const status = await this.animeGen.checkStatus();
    if (!status.connected) {
      throw new CharacterImageServiceError("IMAGE_GEN_FAILED", "Anime image generator is not running. Start ComfyUI first.");
    }

    session.status = "generating_images";
    session.lastSavedAt = new Date().toISOString();
    await this.imageStore.save(session);

    const startTime = Date.now();
    const images: Record<string, GeneratedCharacterImage> = {};
    const roles = Object.keys(session.revealedSpecs.characters);

    // Build all generation tasks upfront
    const tasks = roles
      .filter(role => session.revealedSpecs!.characters[role])
      .map(role => ({
        role,
        spec: session.revealedSpecs!.characters[role],
        seed: seed ?? Math.floor(Math.random() * 2147483647),
      }));

    // Run image generation with bounded concurrency (pool of 2)
    // Each role's request is independent; this cuts wall-clock by ~half for multi-character batches
    const CONCURRENCY = 2;
    for (let i = 0; i < tasks.length; i += CONCURRENCY) {
      const batch = tasks.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (task) => {
          const genStart = Date.now();
          const result = await this.animeGen.generateImage({
            prompt: task.spec.image_generation_prompt,
            checkpoint,
            lora: lora ?? undefined,
            quality: quality ?? "balanced",
            seed: task.seed,
            width: 768,
            height: 1024,
          });
          const genTime = Date.now() - genStart;
          console.log(`[img-gen] ${task.role}: ${genTime}ms (seed=${task.seed})`);
          return { role: task.role, result, seed: task.seed, genTime };
        })
      );

      for (const settled of results) {
        if (settled.status === "fulfilled") {
          const { role, result, seed: usedSeed, genTime } = settled.value;
          images[role] = {
            role,
            checkpoint,
            lora: lora ?? null,
            quality: quality ?? "balanced",
            seed: usedSeed,
            image_base64: result.image,
            enhanced_prompt: result.enhanced_prompt,
            generation_time_ms: genTime,
            approved: false,
            reroll_count: 0,
          };
        } else {
          const failedRole = batch[results.indexOf(settled)]?.role ?? "unknown";
          console.error(`[img-gen] Failed to generate image for ${failedRole}:`, settled.reason);
          throw new CharacterImageServiceError(
            "IMAGE_GEN_FAILED",
            `Failed to generate image for ${failedRole}: ${settled.reason instanceof Error ? settled.reason.message : "Unknown error"}`
          );
        }
      }
    }

    const totalTime = Date.now() - startTime;
    console.log(`[img-gen] Total batch: ${totalTime}ms for ${roles.length} characters (concurrency=${CONCURRENCY})`);

    session.generatedImages = images;
    session.modelPreferences = { checkpoint, lora: lora ?? null, quality: quality ?? "balanced" };
    session.status = "image_review";
    session.lastSavedAt = new Date().toISOString();
    await this.imageStore.save(session);

    return { images, generationTimeMs: totalTime };
  }

  // ─── Approve / Redo Individual Character Images ───

  async approveCharacterImage(projectId: string, role: string): Promise<GeneratedCharacterImage> {
    const session = await this.imageStore.get(projectId);
    if (!session) {
      throw new CharacterImageServiceError("NOT_FOUND", "Character image session not found");
    }

    const image = session.generatedImages[role];
    if (!image) {
      throw new CharacterImageServiceError("NOT_FOUND", `No generated image for role: ${role}`);
    }

    image.approved = true;
    session.lastSavedAt = new Date().toISOString();
    await this.imageStore.save(session);

    return image;
  }

  async redoCharacterImage(
    projectId: string,
    role: string,
    seed?: number,
    overrides?: { checkpoint?: string; lora?: string | null; quality?: string },
  ): Promise<GeneratedCharacterImage> {
    const session = await this.imageStore.get(projectId);
    if (!session) {
      throw new CharacterImageServiceError("NOT_FOUND", "Character image session not found");
    }
    if (!session.revealedSpecs) {
      throw new CharacterImageServiceError("INVALID_INPUT", "Visual specs must be generated first");
    }

    const spec = session.revealedSpecs.characters[role];
    if (!spec) {
      throw new CharacterImageServiceError("NOT_FOUND", `No visual spec for role: ${role}`);
    }

    // Use locked model preferences, with optional overrides for model switching
    const prefs = session.modelPreferences;
    if (!prefs) {
      throw new CharacterImageServiceError("INVALID_INPUT", "No model preferences set — generate images first");
    }

    const useCheckpoint = overrides?.checkpoint ?? prefs.checkpoint;
    const useLora = overrides?.lora !== undefined ? overrides.lora : prefs.lora;
    const useQuality = overrides?.quality ?? prefs.quality;

    // If overrides differ from prefs, update the model preferences for future consistency
    if (overrides?.checkpoint || overrides?.lora !== undefined || overrides?.quality) {
      session.modelPreferences = {
        checkpoint: useCheckpoint,
        lora: useLora,
        quality: useQuality,
      };
    }

    const currentSeed = seed ?? Math.floor(Math.random() * 2147483647);
    const existingImage = session.generatedImages[role];
    const rerollCount = (existingImage?.reroll_count ?? 0) + 1;

    try {
      const genStart = Date.now();
      const result = await this.animeGen.generateImage({
        prompt: spec.image_generation_prompt,
        checkpoint: useCheckpoint,
        lora: useLora ?? undefined,
        quality: useQuality,
        seed: currentSeed,
        width: 768,
        height: 1024,
      });
      const genTime = Date.now() - genStart;

      const newImage: GeneratedCharacterImage = {
        role,
        checkpoint: useCheckpoint,
        lora: useLora,
        quality: useQuality,
        seed: currentSeed,
        image_base64: result.image,
        enhanced_prompt: result.enhanced_prompt,
        generation_time_ms: genTime,
        approved: false,
        reroll_count: rerollCount,
      };

      session.generatedImages[role] = newImage;
      session.lastSavedAt = new Date().toISOString();
      await this.imageStore.save(session);

      console.log(`[img-redo] ${role}: ${genTime}ms (seed=${currentSeed}, reroll #${rerollCount})`);
      return newImage;
    } catch (err) {
      throw new CharacterImageServiceError(
        "IMAGE_GEN_FAILED",
        `Failed to redo image for ${role}: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    }
  }

  // ─── Lock Images ───

  async lockImages(
    projectId: string,
    modelOverride?: string,
  ): Promise<CharacterImagePack> {
    const session = await this.imageStore.get(projectId);
    if (!session) {
      throw new CharacterImageServiceError("NOT_FOUND", "Character image session not found");
    }
    if (!session.revealedSpecs || !session.modelPreferences) {
      throw new CharacterImageServiceError("INVALID_INPUT", "Visual specs and images must be generated first");
    }

    // Verify all characters have approved images
    const roles = Object.keys(session.revealedSpecs.characters);
    for (const role of roles) {
      const image = session.generatedImages[role];
      if (!image || !image.approved) {
        throw new CharacterImageServiceError("INVALID_INPUT", `Image for ${role} must be approved before locking`);
      }
    }

    // Save before summary call
    session.lastSavedAt = new Date().toISOString();
    await this.imageStore.save(session);

    // Generate summary
    const summaryPrompt = this.buildSummaryPrompt(session);
    let summary = "";
    try {
      summary = await this.llm.call("img_summary", summaryPrompt.system, summaryPrompt.user, {
        temperature: 0.5,
        maxTokens: 600,
        modelOverride,
      });
    } catch (err) {
      console.error("IMG SUMMARY LLM ERROR:", err);
      // Non-fatal for lock
      summary = "(summary generation failed)";
    }

    // Analyze user behavior
    let typedCount = 0;
    let clickedCount = 0;
    for (const turn of session.turns) {
      if (turn.userSelection) {
        if (turn.userSelection.type === "free_text") typedCount++;
        else clickedCount++;
      }
    }
    const totalResponses = typedCount + clickedCount;
    const typedVsClicked = totalResponses === 0 ? "mixed" as const
      : typedCount > clickedCount * 2 ? "mostly_typed" as const
      : clickedCount > typedCount * 2 ? "mostly_clicked" as const
      : "mixed" as const;
    const controlPreference = typedVsClicked === "mostly_typed" ? "director" as const
      : typedVsClicked === "mostly_clicked" ? "explorer" as const
      : "mixed" as const;

    // Build locked characters
    const lockedCharacters: CharacterImagePack["locked"]["characters"] = {};
    for (const role of roles) {
      const spec = session.revealedSpecs.characters[role];
      const image = session.generatedImages[role];
      lockedCharacters[role] = {
        role: spec.role,
        visual_description: spec,
        image_base64: image.image_base64,
        enhanced_prompt: image.enhanced_prompt,
      };
    }

    const pack: CharacterImagePack = {
      module: "character_image",
      locked: {
        characters: lockedCharacters,
        ensemble_cohesion_note: session.revealedSpecs.ensemble_cohesion_note,
        cast_count: roles.length,
      },
      generation_settings: session.modelPreferences,
      style_used: session.revealedSpecs.style_recommendation,
      preferences: {
        tone_chips: session.sourceCharacterPack.preferences?.tone_chips ?? [],
        bans: session.sourceCharacterPack.preferences?.bans ?? [],
      },
      user_style: {
        control_preference: controlPreference,
        typed_vs_clicked: typedVsClicked,
        total_turns: session.turns.length,
      },
      state_summary: summary.trim(),
      characterpack_reference: { characterProjectId: session.characterProjectId },
      psychologyLedger: session.psychologyLedger,
    };

    // Save export
    await this.imageStore.saveExport(session, pack);

    // Update session status
    session.status = "locked";
    session.lastSavedAt = new Date().toISOString();
    await this.imageStore.save(session);

    return pack;
  }

  // ─── Skip Module (skip image gen but still produce visual descriptions) ───

  async skipModule(
    projectId: string,
    characterProjectId: string,
  ): Promise<CharacterImagePack> {
    const charExport = await this.charStore.getExport(characterProjectId);
    if (!charExport || !charExport.characterPack) {
      throw new CharacterImageServiceError(
        "NOT_FOUND",
        "Character export not found — lock the character module first",
      );
    }
    const sourceCharacterPack = charExport.characterPack;

    // Import constraint ledger from character module (same as normal first-turn)
    const importedLedger: CharacterImageLedgerEntry[] = [];
    if (charExport.constraintLedger) {
      for (const entry of charExport.constraintLedger) {
        importedLedger.push({
          key: `char.${entry.key}`,
          value: entry.value,
          source: "character_imported",
          confidence: "imported",
          turnNumber: 0,
        });
      }
    }

    // Import psychology ledger from character module
    let importedPsychLedger = createEmptyLedger();
    if (charExport.psychologyLedger) {
      importedPsychLedger = JSON.parse(JSON.stringify(charExport.psychologyLedger));
    }
    snapshotBaselineForNewModule(importedPsychLedger);

    // Build a session so buildBuilderPrompt has the context it needs
    const session: CharacterImageSessionState = {
      projectId,
      characterProjectId,
      sourceCharacterPack,
      turns: [],
      constraintLedger: importedLedger,
      generatedImages: {},
      status: "generating",
      lastSavedAt: new Date().toISOString(),
      psychologyLedger: importedPsychLedger,
    };

    // Run a single builder LLM call to produce visual descriptions + image prompts
    const builderPrompt = await this.buildBuilderPrompt(session);
    let builderResult: CharacterImageBuilderOutput | null = null;

    try {
      const builderRaw = await this.llm.call("img_builder", builderPrompt.system, builderPrompt.user, {
        temperature: 0.8,
        maxTokens: 12000,
        jsonSchema: CHARACTER_IMAGE_BUILDER_SCHEMA,
      });

      builderResult = this.parseAndValidate<CharacterImageBuilderOutput>(builderRaw, [
        "characters", "ensemble_cohesion_note", "style_recommendation", "style_reasoning",
      ]);

      // Convert characters from LLM array format to Record<role, VisualDescription>
      if (builderResult && Array.isArray(builderResult.characters)) {
        const charsRecord: Record<string, VisualDescription> = {};
        for (const desc of builderResult.characters as any[]) {
          if (desc.role) {
            charsRecord[desc.role] = desc;
          }
        }
        builderResult.characters = charsRecord;
      }
    } catch (err) {
      console.error("SKIP MODULE BUILDER LLM ERROR:", err);
      // Fall through — builderResult stays null, we'll use empty descriptions
    }

    // Build the locked characters from builder output (or empty fallback)
    const characters: Record<string, {
      role: string;
      visual_description: VisualDescription;
      image_base64: string;
      enhanced_prompt: string;
    }> = {};

    const castRoles = Object.keys(sourceCharacterPack.locked.characters);
    for (const role of castRoles) {
      const builtDesc = builderResult?.characters?.[role];
      characters[role] = {
        role,
        visual_description: builtDesc ?? {
          role,
          full_body_description: "(builder failed — no visual description generated)",
          visual_anchors: {
            hair_description: "",
            eyes_description: "",
            signature_garment: "",
            distinguishing_marks: "",
            body_type: "",
            pose_baseline: "",
            expression_baseline: "",
            color_palette: [],
            visual_vibe: "",
          },
          image_generation_prompt: "",
        },
        image_base64: "",    // no actual image generated
        enhanced_prompt: "",  // no anime-gen tag expansion
      };
    }

    const pack: CharacterImagePack = {
      module: "character_image",
      skipped: true,
      locked: {
        characters,
        ensemble_cohesion_note: builderResult?.ensemble_cohesion_note ?? "(builder not run)",
        cast_count: castRoles.length,
      },
      generation_settings: {
        checkpoint: "none",
        lora: null,
        quality: "none",
      },
      style_used: builderResult?.style_recommendation ?? "none",
      preferences: {
        tone_chips: sourceCharacterPack.preferences?.tone_chips ?? [],
        bans: sourceCharacterPack.preferences?.bans ?? [],
      },
      user_style: {
        control_preference: sourceCharacterPack.user_style?.control_preference ?? "mixed",
        typed_vs_clicked: sourceCharacterPack.user_style?.typed_vs_clicked ?? "mixed",
        total_turns: 0,
      },
      state_summary: builderResult
        ? "Character image module skipped image generation — visual descriptions produced by builder."
        : "Character image module skipped — builder call failed, empty visual descriptions.",
      characterpack_reference: { characterProjectId },
      psychologyLedger: importedPsychLedger,
    };

    // Save session as locked and create export
    session.status = "locked";
    session.revealedSpecs = builderResult ?? undefined;
    session.lastSavedAt = new Date().toISOString();
    await this.imageStore.save(session);
    await this.imageStore.saveExport(session, pack);

    return pack;
  }

  // ─── Session Management ───

  async getSession(projectId: string): Promise<CharacterImageSessionState | null> {
    return this.imageStore.get(projectId);
  }

  async setArtStyle(
    projectId: string,
    style: string,
    customNote?: string,
  ): Promise<void> {
    const session = await this.imageStore.get(projectId);
    if (!session) throw new CharacterImageServiceError("NOT_FOUND", "Session not found");
    session.artStylePreference = { style, customNote };
    await this.imageStore.save(session);
  }

  /** Apply user's visual anchor edits to the revealed specs before image generation */
  async applyVisualEdits(
    projectId: string,
    edits: Record<string, Partial<Record<string, string>>>,
  ): Promise<void> {
    const session = await this.imageStore.get(projectId);
    if (!session) throw new CharacterImageServiceError("NOT_FOUND", "Session not found");
    if (!session.revealedSpecs) throw new CharacterImageServiceError("INVALID_INPUT", "No visual specs to edit");

    for (const [role, fieldEdits] of Object.entries(edits)) {
      const char = session.revealedSpecs.characters[role];
      if (!char) continue;
      for (const [field, value] of Object.entries(fieldEdits)) {
        if (value !== undefined && field in char.visual_anchors) {
          // color_palette is string[] — split comma-separated input
          if (field === "color_palette" && typeof value === "string") {
            (char.visual_anchors as any)[field] = value.split(",").map((s: string) => s.trim()).filter(Boolean);
          } else {
            (char.visual_anchors as any)[field] = value;
          }
        }
      }
    }
    await this.imageStore.save(session);
  }

  async resetSession(projectId: string): Promise<void> {
    await this.imageStore.delete(projectId);
  }

  // ─── Prompt Builders (private) ───

  /**
   * Build a non-truncatable CHARACTER IDENTITIES block from constraint ledger + character descriptions.
   * Extracts gender, role, and core identity markers that MUST NOT be lost in prompt compression.
   */
  private buildCharacterIdentities(session: CharacterImageSessionState): string {
    const charPack = session.sourceCharacterPack;
    const locked = charPack.locked;
    const ledger = session.constraintLedger ?? [];

    const lines: string[] = [];

    for (const [roleKey, char] of Object.entries(locked.characters)) {
      const identity: string[] = [];
      identity.push(`Role: ${char.role}`);

      // Extract gender from constraint ledger (imported from hook → character → image)
      // Keys follow: char.hook.protagonist_gender, char.hook.antagonist_gender, etc.
      // Or character module may have: char.protagonist.gender, etc.
      const genderEntry = ledger.find((e) =>
        (e.key.includes(roleKey) && e.key.includes("gender")) ||
        (e.key.includes(char.role) && e.key.includes("gender"))
      );
      if (genderEntry) {
        identity.push(`Gender: ${genderEntry.value}`);
      } else {
        // Try to extract from description (look for pronouns)
        const desc = char.description?.toLowerCase() ?? "";
        if (desc.includes(" he ") || desc.includes(" his ") || desc.includes(" him ")) {
          identity.push(`Gender: male (inferred from description)`);
        } else if (desc.includes(" she ") || desc.includes(" her ") || desc.includes(" hers ")) {
          identity.push(`Gender: female (inferred from description)`);
        } else if (desc.includes(" they ") || desc.includes(" their ") || desc.includes(" them ")) {
          identity.push(`Gender: non-binary/unspecified (inferred from description)`);
        }
      }

      // Extract age/appearance hints from ledger
      const ageEntry = ledger.find((e) =>
        (e.key.includes(roleKey) || e.key.includes(char.role)) &&
        (e.key.includes("age") || e.key.includes("appearance"))
      );
      if (ageEntry) {
        identity.push(`Age/Appearance: ${ageEntry.value}`);
      }

      // Include first sentence of description for context
      if (char.description) {
        const firstSentence = char.description.split(/[.!?]/)[0]?.trim();
        if (firstSentence) {
          identity.push(`Summary: ${firstSentence}`);
        }
      }

      // Include weakness info from judge (development opportunity for visual work)
      const weakness = charPack.weaknesses?.find((w) => w.role === roleKey || w.role === char.role);
      if (weakness) {
        identity.push(`DEVELOPMENT NOTE: ${weakness.weakness} — visual identity should help address this`);
      }

      lines.push(`${char.role.toUpperCase()} (${roleKey}):\n  ${identity.join("\n  ")}`);
    }

    return lines.length > 0 ? lines.join("\n\n") : "(No character identities available)";
  }

  /**
   * Extract story context fields from the constraint ledger (originally from hook module).
   * These flow: hook → character (as hook_imported) → image (as character_imported).
   */
  private extractStoryContext(ledger: CharacterImageLedgerEntry[]): {
    hookSentence: string;
    emotionalPromise: string;
    setting: string;
  } {
    const find = (pattern: string): string => {
      const entry = ledger.find((e) => e.key.toLowerCase().includes(pattern));
      return entry?.value ?? "";
    };

    return {
      hookSentence: find("hook_sentence") || find("logline") || find("premise"),
      emotionalPromise: find("emotional_promise") || find("promise"),
      setting: find("setting") || find("world"),
    };
  }

  private async buildClarifierPrompt(session: CharacterImageSessionState): Promise<{
    system: string;
    user: string;
  }> {
    const charPack = session.sourceCharacterPack;
    const priorTurns = this.formatPriorTurns(session.turns);
    const ledgerText = this.formatLedgerForPrompt(session.constraintLedger ?? []);
    const turnNumber = String(session.turns.length + 1);
    const psychText = formatPsychologyLedgerForPrompt(session.psychologyLedger);
    const identities = this.buildCharacterIdentities(session);
    const storyCtx = this.extractStoryContext(session.constraintLedger ?? []);

    // Extract story context from character pack
    const locked = charPack.locked;
    const charProfilesJson = JSON.stringify(locked.characters, null, 2);

    const upstreamTargets = this.formatUpstreamTargets(session);

    const probeText = formatSuggestedProbeForPrompt(session.psychologyLedger);

    let user = CHARACTER_IMAGE_CLARIFIER_USER_TEMPLATE
      .replace("{{CHARACTER_IDENTITIES}}", identities)
      .replace("{{CHARACTER_PROFILES_JSON}}", charProfilesJson)
      .replace("{{PREMISE}}", charPack.state_summary ?? "")
      .replace("{{HOOK_SENTENCE}}", storyCtx.hookSentence)
      .replace("{{EMOTIONAL_PROMISE}}", storyCtx.emotionalPromise)
      .replace("{{SETTING}}", storyCtx.setting)
      .replace("{{TONE_CHIPS}}", JSON.stringify(charPack.preferences?.tone_chips ?? []))
      .replace("{{ENSEMBLE_DYNAMIC}}", locked.ensemble_dynamic ?? "")
      .replace("{{VISUAL_SEED}}", session.visualSeed ?? "(none provided)")
      .replace("{{PRIOR_TURNS}}", priorTurns)
      .replace("{{PSYCHOLOGY_LEDGER}}", psychText)
      .replace("{{CONSTRAINT_LEDGER}}", ledgerText)
      .replace("{{TURN_NUMBER}}", turnNumber)
      .replace("{{UPSTREAM_DEVELOPMENT_TARGETS}}", upstreamTargets)
      + (probeText ? "\n\n" + probeText : "");

    const currentTurn = session.turns.length + 1;
    const directionMapText = formatDirectionMapForPrompt(session.psychologyLedger, currentTurn);
    if (directionMapText) user += "\n\n" + directionMapText;

    // ─── Cultural Intelligence Engine injection ───
    const culturalBrief = await this.getCulturalBrief(session, currentTurn);
    const culturalText = culturalResearchService.formatBriefForClarifier(culturalBrief);
    if (culturalText) {
      user += "\n\n" + culturalText;
    }

    return { system: CHARACTER_IMAGE_CLARIFIER_SYSTEM, user };
  }

  private async buildBuilderPrompt(session: CharacterImageSessionState): Promise<{
    system: string;
    user: string;
  }> {
    const charPack = session.sourceCharacterPack;
    const locked = charPack.locked;
    const charProfilesJson = JSON.stringify(locked.characters, null, 2);
    const priorTurns = this.formatPriorTurns(session.turns);
    const ledgerText = this.formatLedgerForPrompt(session.constraintLedger ?? []);
    const identities = this.buildCharacterIdentities(session);
    const storyCtx = this.extractStoryContext(session.constraintLedger ?? []);

    const signalsText = formatSignalsForBuilderJudge(session.psychologyLedger);

    const upstreamTargets = this.formatUpstreamTargets(session);

    let user = CHARACTER_IMAGE_BUILDER_USER_TEMPLATE
      .replace("{{CHARACTER_IDENTITIES}}", identities)
      .replace("{{CHARACTER_PROFILES_JSON}}", charProfilesJson)
      .replace("{{PREMISE}}", charPack.state_summary ?? "")
      .replace("{{HOOK_SENTENCE}}", storyCtx.hookSentence)
      .replace("{{EMOTIONAL_PROMISE}}", storyCtx.emotionalPromise)
      .replace("{{SETTING}}", storyCtx.setting)
      .replace("{{TONE_CHIPS}}", JSON.stringify(charPack.preferences?.tone_chips ?? []))
      .replace("{{ENSEMBLE_DYNAMIC}}", locked.ensemble_dynamic ?? "")
      .replace("{{VISUAL_SEED}}", session.visualSeed ?? "(none provided)")
      .replace("{{STYLE_PREFERENCE}}", this.formatStylePreference(session))
      .replace("{{PRIOR_TURNS}}", priorTurns)
      .replace("{{CONSTRAINT_LEDGER}}", ledgerText)
      .replace("{{PSYCHOLOGY_SIGNALS}}", signalsText)
      .replace("{{UPSTREAM_DEVELOPMENT_TARGETS}}", upstreamTargets);

    // ─── Cultural Intelligence Engine injection ───
    const culturalBrief = await this.getCulturalBriefForBuilder(session);
    const culturalText = culturalResearchService.formatBriefForBuilder(culturalBrief);
    if (culturalText) {
      user += "\n\n" + culturalText;
    }

    return { system: CHARACTER_IMAGE_BUILDER_SYSTEM, user };
  }

  // ─── Cultural Intelligence Engine helpers ───

  private async getCulturalBrief(
    session: CharacterImageSessionState,
    turnNumber: number,
  ): Promise<import("../../shared/types/cultural").CulturalBrief | null> {
    const storyCtx = this.extractStoryContext(session.constraintLedger ?? []);
    return culturalResearchService.getBriefForClarifier({
      projectId: session.projectId,
      module: "character_image",
      turnNumber,
      lockedPacksSummary: `HOOK: ${storyCtx.hookSentence} — ${storyCtx.emotionalPromise}\nCHARACTERS: ${Object.entries(session.sourceCharacterPack.locked.characters).map(([role, c]) => `${role}: ${c.role}`).join("; ")}`,
      currentState: (session.generatedImages ?? {}) as Record<string, unknown>,
      constraintLedger: this.formatLedgerForPrompt(session.constraintLedger ?? []),
      psychologySummary: formatPsychologyLedgerForPrompt(session.psychologyLedger) ?? "",
      directedReferences: this.extractDirectedReferences(session),
    });
  }

  private async getCulturalBriefForBuilder(
    session: CharacterImageSessionState,
  ): Promise<import("../../shared/types/cultural").CulturalBrief | null> {
    return culturalResearchService.getBriefForBuilder(
      session.projectId, "character_image", session.turns.length,
    );
  }

  private async fireBackgroundCulturalResearch(
    session: CharacterImageSessionState,
    turnNumber: number,
  ): Promise<void> {
    const storyCtx = this.extractStoryContext(session.constraintLedger ?? []);
    const context: CulturalResearchContext = {
      projectId: session.projectId,
      module: "character_image",
      turnNumber,
      lockedPacksSummary: `HOOK: ${storyCtx.hookSentence} — ${storyCtx.emotionalPromise}\nCHARACTERS: ${Object.entries(session.sourceCharacterPack.locked.characters).map(([role, c]) => `${role}: ${c.role}`).join("; ")}`,
      currentState: (session.generatedImages ?? {}) as Record<string, unknown>,
      constraintLedger: this.formatLedgerForPrompt(session.constraintLedger ?? []),
      psychologySummary: formatPsychologyLedgerForPrompt(session.psychologyLedger) ?? "",
      directedReferences: this.extractDirectedReferences(session),
    };
    await culturalResearchService.fireBackgroundResearch(context);
  }

  private extractDirectedReferences(session: CharacterImageSessionState): string[] {
    const refs: string[] = [];
    const recentTurns = session.turns.slice(-3);
    for (const t of recentTurns) {
      if (t.userSelection?.type === "free_text" && (t.userSelection as any).text) {
        refs.push(...detectDirectedReferences((t.userSelection as any).text));
      }
    }
    return [...new Set(refs)];
  }

  private formatStylePreference(session: CharacterImageSessionState): string {
    const pref = session.artStylePreference;
    if (!pref) return "(no art style selected — use your best judgment based on story tone)";
    let text = `Selected art style: ${pref.style}`;
    if (pref.customNote) text += `\nUser note: ${pref.customNote}`;
    return text;
  }

  private buildJudgePrompt(
    specs: CharacterImageBuilderOutput,
    session: CharacterImageSessionState
  ): { system: string; user: string } {
    const charPack = session.sourceCharacterPack;
    const charProfilesJson = JSON.stringify(charPack.locked.characters, null, 2);
    const identities = this.buildCharacterIdentities(session);
    const storyCtx = this.extractStoryContext(session.constraintLedger ?? []);
    const signalsText = formatSignalsForBuilderJudge(session.psychologyLedger);

    const upstreamTargets = this.formatUpstreamTargets(session);

    const user = CHARACTER_IMAGE_JUDGE_USER_TEMPLATE
      .replace("{{VISUAL_SPECS_JSON}}", JSON.stringify(specs, null, 2))
      .replace("{{CHARACTER_IDENTITIES}}", identities)
      .replace("{{CHARACTER_PROFILES_JSON}}", charProfilesJson)
      .replace("{{PREMISE}}", charPack.state_summary ?? "")
      .replace("{{EMOTIONAL_PROMISE}}", storyCtx.emotionalPromise)
      .replace("{{TONE_CHIPS}}", JSON.stringify(charPack.preferences?.tone_chips ?? []))
      .replace("{{PSYCHOLOGY_SIGNALS}}", signalsText)
      .replace("{{UPSTREAM_DEVELOPMENT_TARGETS}}", upstreamTargets);

    return { system: CHARACTER_IMAGE_JUDGE_SYSTEM, user };
  }

  private buildSummaryPrompt(session: CharacterImageSessionState): {
    system: string;
    user: string;
  } {
    const charPack = session.sourceCharacterPack;
    const priorTurns = this.formatPriorTurns(session.turns);

    const user = CHARACTER_IMAGE_SUMMARY_USER_TEMPLATE
      .replace("{{PREMISE}}", charPack.state_summary ?? "")
      .replace("{{EMOTIONAL_PROMISE}}", "")
      .replace("{{PRIOR_TURNS}}", priorTurns)
      .replace("{{VISUAL_SPECS_JSON}}", JSON.stringify(session.revealedSpecs ?? {}, null, 2));

    return { system: CHARACTER_IMAGE_SUMMARY_SYSTEM, user };
  }

  // ─── Upstream Development Targets ───

  /**
   * Format upstream development targets from the CharacterPack (and transitively from HookPack).
   * Includes: character weaknesses from judge, open threads from hook, relationship tensions
   * that are underdeveloped.
   */
  private formatUpstreamTargets(session: CharacterImageSessionState): string {
    const charPack = session.sourceCharacterPack;
    const lines: string[] = [];

    // Character weaknesses from the character judge
    if (charPack.weaknesses && charPack.weaknesses.length > 0) {
      lines.push("CHARACTER WEAKNESSES (from character judge — address through visuals where possible):");
      for (const w of charPack.weaknesses) {
        lines.push(`  - [${w.role}] ${w.weakness}`);
        if (w.development_opportunity) {
          lines.push(`    Visual opportunity: ${w.development_opportunity}`);
        }
      }
    }

    // Open threads from hook (if accessible via charPack reference — these are passed as hook context)
    // The charPack.source_dna may hint at underdeveloped collision sources
    if (charPack.source_dna && charPack.source_dna.length > 0) {
      const underused = charPack.source_dna.filter(s =>
        !Object.values(charPack.locked.characters).some(c =>
          c.description?.toLowerCase().includes(s.element_extracted.toLowerCase().slice(0, 20))
        )
      );
      if (underused.length > 0) {
        lines.push("UNDERUSED INSPIRATIONS (collision sources not fully reflected — may inform visual design):");
        for (const s of underused.slice(0, 3)) {
          lines.push(`  - From "${s.source}": ${s.element_extracted}`);
        }
      }
    }

    if (lines.length === 0) {
      return "(No upstream targets)";
    }

    return lines.join("\n");
  }

  // ─── Helpers ───

  private processAssumptionResponses(
    session: CharacterImageSessionState,
    responses: CharacterImageAssumptionResponse[],
    turnNumber: number
  ): void {
    for (const resp of responses) {
      const key = `${resp.characterRole}.${resp.category}`;
      let source: CharacterImageLedgerEntry["source"];
      let confidence: CharacterImageLedgerEntry["confidence"];

      switch (resp.action) {
        case "keep":
          source = "user_kept_assumption";
          confidence = "confirmed";
          break;
        case "alternative":
          source = "user_changed_assumption";
          confidence = "confirmed";
          break;
        case "freeform":
          source = "user_freeform";
          confidence = "confirmed";
          break;
        case "not_ready":
          return; // Don't record not-ready as a constraint
        default:
          return;
      }

      // Upsert into ledger
      const existing = session.constraintLedger.findIndex((e) => e.key === key);
      const entry: CharacterImageLedgerEntry = {
        key,
        value: resp.newValue,
        source,
        confidence,
        turnNumber,
        assumptionId: resp.assumptionId,
      };

      if (existing >= 0) {
        session.constraintLedger[existing] = entry;
      } else {
        session.constraintLedger.push(entry);
      }
    }
  }

  private formatPriorTurns(turns: CharacterImageTurn[]): string {
    if (turns.length === 0) return "(first turn)";

    return turns.map((t, i) => {
      const parts: string[] = [];
      parts.push(`--- Turn ${t.turnNumber} ---`);
      parts.push(`Visual Architect: "${t.clarifierResponse.hypothesis_line}"`);
      parts.push(`Question: "${t.clarifierResponse.question}"`);
      if (t.clarifierResponse.options) {
        parts.push(`Options: ${t.clarifierResponse.options.map((o) => `[${o.id}] ${o.label}`).join(" | ")}`);
      }
      if (t.clarifierResponse.assumptions?.length) {
        parts.push(`Assumptions: ${t.clarifierResponse.assumptions.map((a) => `[${a.id}] ${a.characterRole}: "${a.assumption}"`).join("; ")}`);
      }

      if (t.userSelection) {
        parts.push(`User chose: ${t.userSelection.type === "option" ? `[${t.userSelection.optionId}] ` : ""}${t.userSelection.label}`);
      }
      if (t.assumptionResponses?.length) {
        parts.push(`Assumption responses: ${t.assumptionResponses.map((r) => `${r.assumptionId}=${r.action}${r.action !== "keep" ? ` → "${r.newValue}"` : ""}`).join("; ")}`);
      }

      // Adaptive compression: keep 2 full turns when short session, 1 when longer
      const recentWindow = turns.length <= 3 ? 2 : 1;
      if (i < turns.length - recentWindow) {
        return `Turn ${t.turnNumber}: Q="${t.clarifierResponse.question.slice(0, 60)}..." → ${t.userSelection?.label ?? "(no response)"}`;
      }
      return parts.join("\n");
    }).join("\n\n");
  }

  private formatLedgerForPrompt(
    ledger: CharacterImageLedgerEntry[],
    includeImported = true
  ): string {
    if (ledger.length === 0) return "(empty — first turn)";

    const lines: string[] = [];
    for (const entry of ledger) {
      if (!includeImported && entry.confidence === "imported") continue;
      const marker = entry.confidence === "confirmed" ? "✓"
        : entry.confidence === "imported" ? "↓"
        : "?";
      const val = entry.value.length > 80 ? entry.value.slice(0, 80) + "..." : entry.value;
      lines.push(`${marker} ${entry.key}: "${val}" [${entry.source}, t${entry.turnNumber}]`);
    }
    return lines.join("\n");
  }

  private recordPromptHistory(
    session: CharacterImageSessionState,
    stage: CharacterImagePromptHistoryEntry["stage"],
    defaultSystem: string,
    defaultUser: string,
    overrides?: CharacterImagePromptOverrides,
    responseSummary?: string
  ): void {
    if (!session.promptHistory) session.promptHistory = [];
    session.promptHistory.push({
      timestamp: new Date().toISOString(),
      stage,
      turnNumber: session.turns.length + 1,
      defaultSystem,
      defaultUser,
      editedSystem: overrides?.system,
      editedUser: overrides?.user,
      wasEdited: !!(overrides?.system || overrides?.user),
      responseSummary,
    });
  }

  private updatePsychologyHeuristics(session: CharacterImageSessionState): void {
    if (!session.psychologyLedger) return;

    let typedCount = 0;
    let clickedCount = 0;
    let totalAssumptions = 0;
    let deferredAssumptions = 0;
    let changedAssumptions = 0;
    const responseLengths: number[] = [];

    for (const turn of session.turns) {
      if (!turn.userSelection) continue;
      if (turn.userSelection.type === "free_text") {
        typedCount++;
        responseLengths.push(turn.userSelection.label.split(/\s+/).length);
      } else {
        clickedCount++;
      }
      if (turn.assumptionResponses) {
        for (const resp of turn.assumptionResponses) {
          totalAssumptions++;
          if (resp.action === "not_ready") deferredAssumptions++;
          if (resp.action === "alternative" || resp.action === "freeform") changedAssumptions++;
        }
      }
    }

    updateHeuristics(session.psychologyLedger, {
      typedCount,
      clickedCount,
      totalAssumptions,
      deferredAssumptions,
      changedAssumptions,
      responseLengths,
    });
  }

  private parseAndValidate<T>(raw: string, requiredKeys: string[]): T | null {
    try {
      let cleaned = raw.trim();
      // Strip markdown fences if present
      if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/^```[a-z]*\n?/, "").replace(/\n?```$/, "").trim();
      }
      const parsed = JSON.parse(cleaned);
      for (const key of requiredKeys) {
        if (!(key in parsed)) {
          console.error(`Missing required key: ${key}`);
          return null;
        }
      }
      return parsed as T;
    } catch (err) {
      console.error("JSON parse error:", err);
      return null;
    }
  }
}
