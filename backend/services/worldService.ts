import {
  WorldAssumptionResponse,
  WorldBuilderOutput,
  WorldClarifierResponse,
  WorldJudgeOutput,
  WorldLedgerEntry,
  WorldPack,
  WorldSessionState,
  WorldTurn,
  WorldPromptHistoryEntry,
  WorldPromptOverrides,
  WorldPromptPreview,
  DevelopmentTarget,
} from "../../shared/types/world";
import { CharacterPack } from "../../shared/types/character";
import { CharacterImagePack } from "../../shared/types/characterImage";
import { HookPack } from "../../shared/types/hook";
import { WorldStore } from "../storage/worldStore";
import { CharacterStore } from "../storage/characterStore";
import { CharacterImageStore } from "../storage/characterImageStore";
import { ProjectStore } from "../storage/projectStore";
import { LLMClient } from "./llmClient";
import {
  WORLD_BUILDER_SYSTEM,
  WORLD_BUILDER_USER_PREFIX,
  WORLD_BUILDER_USER_DYNAMIC,
  WORLD_CLARIFIER_SYSTEM,
  WORLD_CLARIFIER_USER_PREFIX,
  WORLD_CLARIFIER_USER_DYNAMIC,
  WORLD_JUDGE_SYSTEM,
  WORLD_JUDGE_USER_TEMPLATE,
  WORLD_POLISH_SYSTEM,
  WORLD_POLISH_USER_TEMPLATE,
  WORLD_SUMMARY_SYSTEM,
  WORLD_SUMMARY_USER_TEMPLATE,
} from "./worldPrompts";
import {
  WORLD_BUILDER_SCHEMA,
  WORLD_CLARIFIER_SCHEMA,
  WORLD_JUDGE_SCHEMA,
} from "./worldSchemas";
import {
  createEmptyLedger,
  ensureLedgerShape,
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
  formatSuggestedProbeForPrompt,
  markProbeConsumed,
  moduleBoundaryConsolidation,
} from "./psychologyEngine";
import type { RawSignalObservation, BehaviorSummary, AdaptationPlan } from "../../shared/types/userPsychology";
import { pickBackgroundTasks } from "./backgroundThrottling";
import {
  runDivergenceExploration,
  extractDivergenceContext,
  formatDirectionMapForPrompt,
} from "./divergenceExplorer";
import { culturalResearchService, storyBibleService, projectStore as runtimeProjectStore } from "./runtime";
import { detectDirectedReferences, shouldRunCulturalResearch } from "./culturalResearchService";
import type { CulturalResearchContext } from "./culturalResearchService";
import { buildMustHonorBlock } from "./mustHonorBlock";

// ─── API response types ───

export interface WorldClarifyResponse {
  clarifier: WorldClarifierResponse;
  turnNumber: number;
  totalTurns: number;
}

export interface WorldGenerateResponse {
  world: WorldBuilderOutput;
  judge: {
    passed: boolean;
    hard_fail_reasons: string[];
    scores: WorldJudgeOutput["scores"];
    weakest_element: string;
    one_fix_instruction: string;
  } | null;
  developmentTargets?: DevelopmentTarget[];
  weaknesses?: Array<{
    area: string;
    weakness: string;
    development_opportunity: string;
  }>;
}

export class WorldServiceError extends Error {
  code: "NOT_FOUND" | "INVALID_INPUT" | "LLM_PARSE_ERROR" | "LLM_CALL_FAILED";

  constructor(
    code: "NOT_FOUND" | "INVALID_INPUT" | "LLM_PARSE_ERROR" | "LLM_CALL_FAILED",
    message: string
  ) {
    super(message);
    this.code = code;
  }
}

export class WorldService {
  constructor(
    private worldStore: WorldStore,
    private charImageStore: CharacterImageStore,
    private charStore: CharacterStore,
    private hookStore: ProjectStore,
    private llm: LLMClient
  ) {}

  // ─── Preview Prompt (no LLM call) ───

  async previewPrompt(
    projectId: string,
    stage: "clarifier" | "builder" | "judge" | "summary",
  ): Promise<WorldPromptPreview> {
    const session = await this.worldStore.get(projectId);
    if (!session) {
      throw new WorldServiceError("NOT_FOUND", "World session not found");
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
        if (session.revealedWorld) {
          const prompt = this.buildJudgePrompt(session.revealedWorld, session);
          return { stage, system: prompt.system, user: prompt.user };
        }
        return {
          stage,
          system: WORLD_JUDGE_SYSTEM,
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
    characterImageProjectId: string | undefined,
    characterProjectId: string,
    hookProjectId: string,
    userSelection?: { type: "option" | "free_text" | "surprise_me"; optionId?: string; label: string },
    modelOverride?: string,
    promptOverrides?: WorldPromptOverrides,
    assumptionResponses?: WorldAssumptionResponse[],
    worldSeed?: string,
  ): Promise<WorldClarifyResponse> {
    let session = await this.worldStore.get(projectId);
    const isFirstTurn = !session || session.turns.length === 0;

    if (isFirstTurn) {
      if (userSelection) {
        throw new WorldServiceError("INVALID_INPUT", "First turn cannot have userSelection");
      }

      if (!session) {
        // Load upstream packs — parallel for speed
        const [charImageExport, charExport, hookExport] = await Promise.all([
          characterImageProjectId
            ? this.charImageStore.getExport(characterImageProjectId)
            : Promise.resolve(undefined),
          this.charStore.getExport(characterProjectId),
          this.hookStore.getExport(hookProjectId),
        ]);

        let sourceCharacterImagePack: CharacterImagePack | undefined;
        if (characterImageProjectId) {
          if (!charImageExport || !charImageExport.characterImagePack) {
            throw new WorldServiceError(
              "NOT_FOUND",
              "Character image export not found. Complete the character image module first."
            );
          }
          sourceCharacterImagePack = charImageExport.characterImagePack;
        }

        if (!charExport || !charExport.characterPack) {
          throw new WorldServiceError(
            "NOT_FOUND",
            "Character export not found. Complete the character module first."
          );
        }

        if (!hookExport || !hookExport.hookPack) {
          throw new WorldServiceError(
            "NOT_FOUND",
            "Hook export not found. Complete the hook module first."
          );
        }

        const sourceCharPack = charExport.characterPack;
        const sourceHookPack = hookExport.hookPack;

        // Import constraint ledgers from all upstream modules
        const importedLedger: WorldLedgerEntry[] = [];

        // Hook ledger entries
        if (hookExport.constraintLedger) {
          for (const entry of hookExport.constraintLedger) {
            importedLedger.push({
              key: `hook.${entry.key}`,
              value: entry.value,
              source: "hook_imported",
              confidence: "imported",
              turnNumber: 0,
            });
          }
        }

        // Character ledger entries
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

        // Import psychology ledger (prefer charImage > char > hook — most recent)
        const importedPsychLedger = ensureLedgerShape(
          sourceCharacterImagePack?.psychologyLedger ??
          sourceCharPack.psychologyLedger ??
          sourceHookPack.psychologyLedger ??
          createEmptyLedger()
        );
        snapshotBaselineForNewModule(importedPsychLedger);

        // Build development targets from upstream weaknesses
        const devTargets: DevelopmentTarget[] = [];

        // Hook open threads
        if (sourceHookPack.open_threads) {
          for (let i = 0; i < sourceHookPack.open_threads.length; i++) {
            devTargets.push({
              id: `dt_hook_${i}`,
              source_module: "hook",
              target: sourceHookPack.open_threads[i],
              status: "unaddressed",
            });
          }
        }

        // Character weaknesses
        if (sourceCharPack.weaknesses) {
          for (let i = 0; i < sourceCharPack.weaknesses.length; i++) {
            const w = sourceCharPack.weaknesses[i];
            devTargets.push({
              id: `dt_char_${i}`,
              source_module: "character",
              target: `[${w.role}] ${w.weakness}`,
              status: "unaddressed",
              notes: w.development_opportunity,
            });
          }
        }

        // Strip base64 image data from CharacterImagePack — World only needs text descriptions
        const lightCharImagePack = sourceCharacterImagePack
          ? {
              ...sourceCharacterImagePack,
              locked: {
                ...sourceCharacterImagePack.locked,
                characters: Object.fromEntries(
                  Object.entries(sourceCharacterImagePack.locked.characters).map(
                    ([role, char]) => [role, {
                      role: char.role,
                      visual_description: char.visual_description,
                      image_base64: "", // stripped — not needed for world module
                      enhanced_prompt: char.enhanced_prompt,
                    }]
                  )
                ),
              },
            }
          : undefined;

        session = {
          projectId,
          characterImageProjectId,
          characterProjectId,
          hookProjectId,
          sourceCharacterImagePack: lightCharImagePack,
          sourceCharacterPack: sourceCharPack,
          sourceHookPack: sourceHookPack,
          worldSeed: worldSeed ?? undefined,
          turns: [],
          constraintLedger: importedLedger,
          developmentTargets: devTargets,
          status: "clarifying",
          psychologyLedger: importedPsychLedger,
        };
      }

      if (session && worldSeed) {
        session.worldSeed = worldSeed;
      }
    } else {
      if (!session) {
        throw new WorldServiceError("NOT_FOUND", "World session not found");
      }

      if (session.status === "revealed" || session.status === "locked") {
        throw new WorldServiceError("INVALID_INPUT", "Session already progressed; reset first");
      }

      if (!userSelection) {
        throw new WorldServiceError("INVALID_INPUT", "Subsequent turns require userSelection");
      }

      const previousTurn = session.turns[session.turns.length - 1];
      if (!previousTurn) {
        throw new WorldServiceError("INVALID_INPUT", "No clarifier turn to attach selection to");
      }

      if (userSelection.type === "option") {
        const isValid = previousTurn.clarifierResponse.options.some(
          (opt) => opt.id === userSelection.optionId
        );
        if (!userSelection.optionId || !isValid) {
          throw new WorldServiceError("INVALID_INPUT", "optionId must exist in previous turn options");
        }
      }

      previousTurn.userSelection = userSelection;

      // Process assumption responses
      if (assumptionResponses && assumptionResponses.length > 0) {
        this.processAssumptionResponses(session, assumptionResponses, session.turns.length);
        previousTurn.assumptionResponses = assumptionResponses;

        // Record assumption deltas for psychology
        if (session.psychologyLedger) {
          const offeredIds = assumptionResponses.map(r => r.assumptionId);
          const respondedIds = assumptionResponses
            .filter(r => r.action !== "not_ready")
            .map(r => r.assumptionId);
          const actions: Record<string, "keep" | "alternative" | "freeform" | "not_ready"> =
            Object.fromEntries(assumptionResponses.map(r => [r.assumptionId, r.action]));
          recordAssumptionDelta(
            session.psychologyLedger,
            session.turns.length,
            offeredIds,
            respondedIds,
            actions,
          );
        }
      }
    }

    // Build and call clarifier prompt
    const prompt = await this.buildClarifierPrompt(session!);
    const system = promptOverrides?.system ?? prompt.system;
    const user = promptOverrides?.user ?? prompt.user;

    let raw: string;
    try {
      raw = await this.llm.call("world_clarifier", system, user, {
        temperature: 0.7,
        maxTokens: 4000,
        modelOverride,
        jsonSchema: WORLD_CLARIFIER_SCHEMA,
        // Only use cached prefix when not using prompt overrides
        cacheableUserPrefix: promptOverrides?.user ? undefined : prompt.cacheableUserPrefix,
      });
    } catch (err) {
      console.error("WORLD CLARIFIER LLM ERROR:", err);
      throw new WorldServiceError("LLM_CALL_FAILED", "World clarifier LLM call failed");
    }

    // Record prompt history
    this.recordPromptHistory(
      session!, "clarifier", prompt.system, prompt.user,
      promptOverrides, raw.slice(0, 200)
    );

    const clarifier = this.parseAndValidate<WorldClarifierResponse>(raw, [
      "psychology_strategy", "hypothesis_line", "question", "options",
      "allow_free_text", "ready_for_world", "readiness_pct", "assumptions", "user_read"
    ]);

    if (!clarifier) {
      throw new WorldServiceError("LLM_PARSE_ERROR", "Failed to parse world clarifier output");
    }

    // Ensure defaults
    if (!clarifier.missing_signal) clarifier.missing_signal = "";
    if (!clarifier.conflict_flag) clarifier.conflict_flag = "";

    // Record psychology signals
    if (!session!.psychologyLedger) session!.psychologyLedger = createEmptyLedger();
    if (clarifier.user_read && typeof clarifier.user_read === "object") {
      const ur = clarifier.user_read;
      if (ur.signals && ur.behaviorSummary) {
        recordSignals(
          session!.psychologyLedger,
          session!.turns.length + 1,
          "world",
          ur.signals as RawSignalObservation[],
          ur.behaviorSummary as BehaviorSummary,
          (ur.adaptationPlan as AdaptationPlan) ?? { dominantNeed: "", moves: [] },
        );
      } else {
        recordHypotheses(
          session!.psychologyLedger,
          session!.turns.length + 1,
          "world",
          (ur as any).hypotheses ?? [],
          (ur as any).overall_read ?? "",
          (ur as any).satisfaction
        );
      }
    }
    this.updatePsychologyHeuristics(session!);

    const turn: WorldTurn = {
      turnNumber: session!.turns.length + 1,
      clarifierResponse: clarifier,
      userSelection: null,
    };

    // Suppress readiness on the very first turn
    if (session!.turns.length < 1 && turn.clarifierResponse.ready_for_world) {
      turn.clarifierResponse.ready_for_world = false;
    }

    // Readiness convergence safety net
    if (turn.clarifierResponse.readiness_pct >= 75) {
      session!.consecutiveHighReadiness = (session!.consecutiveHighReadiness ?? 0) + 1;
    } else {
      session!.consecutiveHighReadiness = 0;
    }

    if (
      session!.consecutiveHighReadiness! >= 2 &&
      !turn.clarifierResponse.ready_for_world &&
      session!.turns.length >= 3
    ) {
      turn.clarifierResponse.ready_for_world = true;
      turn.clarifierResponse.readiness_note =
        turn.clarifierResponse.readiness_note || "Your world is taking shape nicely — ready to build it!";
    }

    session!.turns.push(turn);
    session!.status = "clarifying";
    session!.lastSavedAt = new Date().toISOString();

    // Mark any pending probe as consumed
    if (session!.psychologyLedger) {
      markProbeConsumed(session!.psychologyLedger, turn.turnNumber);
    }

    await this.worldStore.save(session!);

    // ─── Fire background work (non-blocking, coordinated to avoid storms) ───
    const bgTasks = pickBackgroundTasks(turn, session!);

    if (bgTasks.consolidate) {
      this.fireBackgroundConsolidation(session!.projectId, turn.turnNumber, "world")
        .catch(err => console.error("[PSYCH] World consolidation fire failed:", err));
    }

    if (bgTasks.diverge) {
      this.fireBackgroundDivergence(session!, turn.turnNumber, "world")
        .catch(err => console.error("[DIVERGENCE] World exploration fire failed:", err));
    }

    if (bgTasks.cultural) {
      const hasCachedBrief = !!(await culturalResearchService.getBriefForBuilder(
        session!.projectId, "world", turn.turnNumber,
      ).catch(() => null));
      if (shouldRunCulturalResearch({ turnNumber: turn.turnNumber, userSelection: turn.userSelection, hasCachedBrief })) {
        this.fireBackgroundCulturalResearch(session!, turn.turnNumber)
          .catch(err => console.error("[CULTURAL] Background research fire failed:", err));
      }
    }

    return {
      clarifier: turn.clarifierResponse,
      turnNumber: turn.turnNumber,
      totalTurns: session!.turns.length,
    };
  }

  /**
   * Fire-and-forget background consolidation for world module.
   */
  private async fireBackgroundConsolidation(
    projectId: string,
    turnNumber: number,
    module: "hook" | "character" | "character_image" | "world",
  ): Promise<void> {
    const sessionForConsolidation = await this.worldStore.get(projectId);
    if (!sessionForConsolidation?.psychologyLedger) return;

    const snapshot = await runConsolidation(
      sessionForConsolidation.psychologyLedger,
      turnNumber,
      module,
      this.llm,
    );

    if (snapshot) {
      // Re-read the LATEST session to avoid overwriting concurrent changes.
      // IMPORTANT: Only graft consolidation-owned fields — NOT the entire ledger.
      // Divergence explorer may have saved lastDirectionMap concurrently;
      // replacing the whole ledger would clobber it (and vice versa).
      const freshSession = await this.worldStore.get(projectId);
      if (!freshSession) return;

      if (!freshSession.psychologyLedger) freshSession.psychologyLedger = sessionForConsolidation.psychologyLedger;
      else {
        freshSession.psychologyLedger.signalStore = sessionForConsolidation.psychologyLedger.signalStore;
        freshSession.psychologyLedger.lastConsolidation = sessionForConsolidation.psychologyLedger.lastConsolidation;
      }
      freshSession.lastSavedAt = new Date().toISOString();
      await this.worldStore.save(freshSession);
    }
  }

  /**
   * Fire-and-forget background divergence exploration for world module.
   */
  private async fireBackgroundDivergence(
    session: WorldSessionState,
    turnNumber: number,
    module: "hook" | "character" | "character_image" | "world",
  ): Promise<void> {
    const psychSummary = formatPsychologyLedgerForPrompt(session.psychologyLedger);
    // Build a state snapshot from world-module fields for divergence explorer
    const worldState: Record<string, unknown> = {};
    if (session.revealedWorld) {
      worldState.world_thesis = session.revealedWorld.world_thesis;
      worldState.arena = session.revealedWorld.arena;
      worldState.rules = session.revealedWorld.rules;
    }
    if (session.worldSeed) worldState.worldSeed = session.worldSeed;
    const previousFamilyNames = session.psychologyLedger?.lastDirectionMap?.directionMap?.families
      ?.map(f => f.name) ?? [];
    const context = extractDivergenceContext(
      session.sourceHookPack?.locked?.premise ?? session.worldSeed ?? "",
      session.constraintLedger,
      worldState,
      psychSummary,
      turnNumber,
      module,
      previousFamilyNames,
    );

    const snapshot = await runDivergenceExploration(context, this.llm);

    if (snapshot) {
      const freshSession = await this.worldStore.get(session.projectId);
      if (!freshSession) return;

      if (!freshSession.psychologyLedger) freshSession.psychologyLedger = createEmptyLedger();
      freshSession.psychologyLedger.lastDirectionMap = snapshot;
      freshSession.lastSavedAt = new Date().toISOString();
      await this.worldStore.save(freshSession);
    }
  }

  // ─── Generate (builder + judge) ───

  async runGenerate(
    projectId: string,
    modelOverride?: string,
    promptOverrides?: { builder?: WorldPromptOverrides; judge?: WorldPromptOverrides },
  ): Promise<WorldGenerateResponse> {
    const session = await this.worldStore.get(projectId);
    if (!session) {
      throw new WorldServiceError("NOT_FOUND", "World session not found");
    }
    if (session.turns.length === 0) {
      throw new WorldServiceError("INVALID_INPUT", "Must have at least 1 clarifier turn before generating");
    }

    session.status = "generating";
    // Build progress for frontend polling (Issue #11) — single attempt for world
    session.buildProgress = { attempt: 1, maxAttempts: 1, status: "building" };
    await this.worldStore.save(session);

    // ─── Builder ───
    const builderPrompt = await this.buildBuilderPrompt(session);
    const builderSystem = promptOverrides?.builder?.system ?? builderPrompt.system;
    const builderUser = promptOverrides?.builder?.user ?? builderPrompt.user;

    let builderRaw: string;
    try {
      builderRaw = await this.llm.call("world_builder", builderSystem, builderUser, {
        temperature: 0.6,
        maxTokens: 12000,
        modelOverride,
        jsonSchema: WORLD_BUILDER_SCHEMA,
        // Only use cached prefix when not using prompt overrides
        cacheableUserPrefix: promptOverrides?.builder?.user ? undefined : builderPrompt.cacheableUserPrefix,
      });
    } catch (err) {
      console.error("WORLD BUILDER LLM ERROR:", err);
      throw new WorldServiceError("LLM_CALL_FAILED", "World builder LLM call failed");
    }

    this.recordPromptHistory(
      session, "builder", builderPrompt.system, builderPrompt.user,
      promptOverrides?.builder, builderRaw.slice(0, 200)
    );

    const builderResult = this.parseAndValidate<WorldBuilderOutput>(builderRaw, [
      "scope", "arena", "rules", "factions", "consequence_patterns", "canon_register",
      "world_thesis", "pressure_summary"
    ]);

    // Defensive defaults for optional array fields (schema doesn't require these)
    if (builderResult) {
      if (!Array.isArray(builderResult.information_access)) builderResult.information_access = [];
      if (!Array.isArray(builderResult.volatility)) builderResult.volatility = [];
    }

    if (!builderResult) {
      throw new WorldServiceError("LLM_PARSE_ERROR", "Failed to parse world builder output");
    }

    // ─── Judge ───
    session.buildProgress = { attempt: 1, maxAttempts: 1, status: "judging" };
    await this.worldStore.save(session);

    const judgePrompt = this.buildJudgePrompt(builderResult, session);
    const judgeSystem = promptOverrides?.judge?.system ?? judgePrompt.system;
    const judgeUser = promptOverrides?.judge?.user ?? judgePrompt.user;

    let judgeRaw: string;
    try {
      judgeRaw = await this.llm.call("world_judge", judgeSystem, judgeUser, {
        temperature: 0.3,
        maxTokens: 1500,
        modelOverride,
        jsonSchema: WORLD_JUDGE_SCHEMA,
      });
    } catch (err) {
      console.error("WORLD JUDGE LLM ERROR:", err);
      // Non-fatal: reveal without judge
      session.revealedWorld = builderResult;
      session.status = "revealed";
      session.buildProgress = undefined;
      session.lastSavedAt = new Date().toISOString();
      await this.worldStore.save(session);
      return { world: builderResult, judge: null };
    }

    const judgeResult = this.parseAndValidate<WorldJudgeOutput>(judgeRaw, [
      "pass", "hard_fail_reasons", "scores", "weakest_element", "one_fix_instruction",
    ]);

    // Defensive defaults for new score dimensions
    if (judgeResult?.scores) {
      if (typeof judgeResult.scores.scene_variety !== "number") judgeResult.scores.scene_variety = 5;
      if (typeof judgeResult.scores.information_asymmetry !== "number") judgeResult.scores.information_asymmetry = 5;
    }

    this.recordPromptHistory(
      session, "judge", judgePrompt.system, judgePrompt.user,
      promptOverrides?.judge,
      judgeResult ? `${judgeResult.pass ? "PASS" : "FAIL"} weakest=${judgeResult.weakest_element}` : "PARSE_FAILED"
    );

    // Update development targets based on judge assessment
    if (judgeResult?.upstream_target_assessment) {
      for (const assessment of judgeResult.upstream_target_assessment) {
        const target = session.developmentTargets.find(t => t.id === assessment.target_id);
        if (target) {
          target.status = assessment.status;
          if (assessment.notes) target.notes = assessment.notes;
          if (assessment.status === "addressed") target.addressed_by = "world";
        }
      }
    }

    // Polish world thesis and pressure summary
    try {
      const polished = await this.polishDescriptions(builderResult, session, modelOverride);
      if (polished) {
        if (polished.world_thesis) builderResult.world_thesis = polished.world_thesis;
        if (polished.pressure_summary) builderResult.pressure_summary = polished.pressure_summary;
      }
    } catch (err) {
      console.error("WORLD POLISH ERROR (using raw descriptions):", err);
    }

    session.revealedWorld = builderResult;
    session.revealedJudge = judgeResult ?? undefined;
    session.status = "revealed";
    session.buildProgress = undefined;  // Clear build progress on reveal
    session.lastSavedAt = new Date().toISOString();

    await this.worldStore.save(session);

    return {
      world: builderResult,
      judge: judgeResult ? {
        passed: judgeResult.pass,
        hard_fail_reasons: judgeResult.hard_fail_reasons,
        scores: judgeResult.scores,
        weakest_element: judgeResult.weakest_element,
        one_fix_instruction: judgeResult.one_fix_instruction,
      } : null,
      developmentTargets: session.developmentTargets,
      weaknesses: judgeResult?.weaknesses,
    };
  }

  // ─── Reroll ───

  async reroll(
    projectId: string,
    modelOverride?: string,
    promptOverrides?: { builder?: WorldPromptOverrides; judge?: WorldPromptOverrides },
  ): Promise<WorldGenerateResponse> {
    const session = await this.worldStore.get(projectId);
    if (!session) {
      throw new WorldServiceError("NOT_FOUND", "World session not found");
    }
    if (session.status !== "revealed") {
      throw new WorldServiceError("INVALID_INPUT", "Must be in revealed status to reroll");
    }

    session.revealedWorld = undefined;
    session.revealedJudge = undefined;

    return this.runGenerate(projectId, modelOverride, promptOverrides);
  }

  // ─── Lock World ───

  async lockWorld(
    projectId: string,
    modelOverride?: string,
  ): Promise<WorldPack> {
    const session = await this.worldStore.get(projectId);
    if (!session) {
      throw new WorldServiceError("NOT_FOUND", "World session not found");
    }
    if (session.status !== "revealed" || !session.revealedWorld) {
      throw new WorldServiceError("INVALID_INPUT", "Must be in revealed status to lock");
    }

    session.lastSavedAt = new Date().toISOString();
    await this.worldStore.save(session);

    // Generate summary
    const summaryPrompt = this.buildSummaryPrompt(session);
    let summary = "";
    try {
      summary = await this.llm.call("world_summary", summaryPrompt.system, summaryPrompt.user, {
        temperature: 0.5,
        maxTokens: 800,
        modelOverride,
      });
    } catch (err) {
      console.error("WORLD SUMMARY LLM ERROR:", err);
      throw new WorldServiceError("LLM_CALL_FAILED", "World summary generation failed");
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

    const world = session.revealedWorld;

    // Add world weaknesses to development targets
    if (session.revealedJudge?.weaknesses) {
      for (let i = 0; i < session.revealedJudge.weaknesses.length; i++) {
        const w = session.revealedJudge.weaknesses[i];
        session.developmentTargets.push({
          id: `dt_world_${i}`,
          source_module: "world",
          target: `[${w.area}] ${w.weakness}`,
          status: "unaddressed",
          notes: w.development_opportunity,
        });
      }
    }

    // Module boundary consolidation: prune low-confidence signals before handoff
    if (session.psychologyLedger) {
      session.psychologyLedger = moduleBoundaryConsolidation(session.psychologyLedger);
    }

    const worldPack: WorldPack = {
      module: "world",
      locked: {
        scope: world.scope,
        arena: world.arena,
        rules: world.rules,
        factions: world.factions,
        consequence_patterns: world.consequence_patterns,
        canon_register: world.canon_register,
        information_access: world.information_access ?? [],
        volatility: world.volatility ?? [],
        world_thesis: world.world_thesis,
        pressure_summary: world.pressure_summary,
      },
      preferences: {
        tone_chips: session.sourceCharacterPack.preferences?.tone_chips ?? [],
        bans: session.sourceCharacterPack.preferences?.bans ?? [],
      },
      development_targets: session.developmentTargets,
      weaknesses: session.revealedJudge?.weaknesses,
      user_style: {
        control_preference: controlPreference,
        typed_vs_clicked: typedVsClicked,
        total_turns: session.turns.length,
      },
      state_summary: summary.trim(),
      ...(session.characterImageProjectId && { characterImagePack_reference: { characterImageProjectId: session.characterImageProjectId } }),
      characterPack_reference: { characterProjectId: session.characterProjectId },
      hookPack_reference: { hookProjectId: session.hookProjectId },
      psychologyLedger: session.psychologyLedger,
    };

    // Update story bible with world module output
    try {
      const existingBible = await runtimeProjectStore.getStoryBible(session.projectId);
      const bible = await storyBibleService.generateBible(
        session.projectId,
        worldPack.state_summary ?? "",
        existingBible ?? undefined,
      );
      await runtimeProjectStore.saveStoryBible(session.projectId, bible);
    } catch (err) {
      console.error("WORLD STORY BIBLE ERROR (non-fatal):", err);
    }

    await this.worldStore.saveExport(session, worldPack);

    session.status = "locked";
    session.lastSavedAt = new Date().toISOString();
    await this.worldStore.save(session);

    return worldPack;
  }

  // ─── Session Management ───

  async getSession(projectId: string): Promise<WorldSessionState | null> {
    return this.worldStore.get(projectId);
  }

  async resetSession(projectId: string): Promise<void> {
    await this.worldStore.delete(projectId);
  }

  // ─── Prompt Builders (private) ───

  private async buildClarifierPrompt(session: WorldSessionState): Promise<{
    system: string;
    user: string;
    cacheableUserPrefix?: string;
  }> {
    const hook = session.sourceHookPack;
    const charPack = session.sourceCharacterPack;
    const charImagePack = session.sourceCharacterImagePack;
    const upstreamTargets = this.formatUpstreamTargets(session);

    const charProfilesJson = JSON.stringify(charPack.locked.characters, null, 2);
    const relationshipTensionsJson = JSON.stringify(charPack.locked.relationship_tensions ?? []);
    const visualSummary = this.formatCharacterVisualsSummary(charImagePack);

    // Static prefix — cacheable (hook, character data, world seed, upstream targets don't change)
    const prefix = WORLD_CLARIFIER_USER_PREFIX
      .replace("{{PREMISE}}", hook.locked.premise)
      .replace("{{HOOK_SENTENCE}}", hook.locked.hook_sentence)
      .replace("{{EMOTIONAL_PROMISE}}", hook.locked.emotional_promise)
      .replace("{{CORE_ENGINE_JSON}}", JSON.stringify(hook.locked.core_engine))
      .replace("{{SETTING}}", hook.locked.core_engine.setting_anchor ?? "")
      .replace("{{TONE_CHIPS}}", JSON.stringify(hook.preferences?.tone_chips ?? []))
      .replace("{{BAN_LIST}}", JSON.stringify(hook.preferences?.bans ?? []))
      .replace("{{CHARACTER_PROFILES_JSON}}", charProfilesJson)
      .replace("{{ENSEMBLE_DYNAMIC}}", charPack.locked.ensemble_dynamic ?? "")
      .replace("{{RELATIONSHIP_TENSIONS_JSON}}", relationshipTensionsJson)
      .replace("{{CHARACTER_VISUALS_SUMMARY}}", visualSummary)
      .replace("{{WORLD_SEED}}", session.worldSeed ?? "(none provided)")
      .replace("{{UPSTREAM_DEVELOPMENT_TARGETS}}", upstreamTargets);

    // Dynamic suffix — changes each turn (prior turns, psychology, ledger, turn number, probes, direction map, focus nudge)
    const priorTurns = this.formatPriorTurns(session.turns);
    const ledgerText = this.formatLedgerForPrompt(session.constraintLedger ?? []);
    const turnNumber = String(session.turns.length + 1);
    const psychText = formatPsychologyLedgerForPrompt(session.psychologyLedger);

    let dynamic = WORLD_CLARIFIER_USER_DYNAMIC
      .replace("{{PRIOR_TURNS}}", priorTurns)
      .replace("{{PSYCHOLOGY_LEDGER}}", psychText)
      .replace("{{ENGINE_DIALS}}", formatEngineDialsForPrompt(session.psychologyLedger))
      .replace("{{CONSTRAINT_LEDGER}}", ledgerText)
      .replace("{{TURN_NUMBER}}", turnNumber);

    const focusNudge = this.buildFocusLoopNudge(session.turns);
    const probeText = formatSuggestedProbeForPrompt(session.psychologyLedger);
    const currentTurn = session.turns.length + 1;
    const directionMapText = formatDirectionMapForPrompt(session.psychologyLedger, currentTurn);

    dynamic += (focusNudge ? "\n\n" + focusNudge : "");
    dynamic += (probeText ? "\n\n" + probeText : "");
    dynamic += (directionMapText ? "\n\n" + directionMapText : "");

    // ─── Story Bible injection ───
    const storyBible = await runtimeProjectStore.getStoryBible(session.projectId);
    dynamic += "\n\n═══ STORY BIBLE (do NOT contradict — these are confirmed canonical facts) ═══\n" +
      (storyBible || "(not yet available)");

    // ─── Cultural Intelligence Engine injection ───
    const culturalBrief = await this.getCulturalBrief(session, currentTurn);
    const culturalText = culturalResearchService.formatBriefForClarifier(culturalBrief);
    if (culturalText) {
      dynamic += "\n\n" + culturalText;
    }

    // ─── MUST HONOR constraint reinforcement (end of prompt = highest attention) ───
    const mustHonor = buildMustHonorBlock(session.constraintLedger ?? []);
    if (mustHonor) {
      dynamic += "\n\n" + mustHonor;
    }

    return {
      system: WORLD_CLARIFIER_SYSTEM,
      user: prefix + dynamic,
      cacheableUserPrefix: prefix,
    };
  }

  private async buildBuilderPrompt(session: WorldSessionState): Promise<{
    system: string;
    user: string;
    cacheableUserPrefix?: string;
  }> {
    const hook = session.sourceHookPack;
    const charPack = session.sourceCharacterPack;
    const upstreamTargets = this.formatUpstreamTargets(session);

    // Trimmed character profiles for builder — only world-relevant fields
    const charProfilesJson = this.formatCharacterProfilesForBuilder(charPack);
    const relationshipTensionsJson = JSON.stringify(
      (charPack.locked.relationship_tensions ?? []).map(rt => ({
        pair: rt.pair,
        stated_dynamic: rt.stated_dynamic,
        true_dynamic: rt.true_dynamic,
        tension_mechanism: rt.tension_mechanism,
      }))
    );

    // Static prefix — cacheable (hook, character data, world seed, upstream targets, tone chips, bans don't change)
    const prefix = WORLD_BUILDER_USER_PREFIX
      .replace("{{PREMISE}}", hook.locked.premise)
      .replace("{{HOOK_SENTENCE}}", hook.locked.hook_sentence)
      .replace("{{EMOTIONAL_PROMISE}}", hook.locked.emotional_promise)
      .replace("{{CORE_ENGINE_JSON}}", JSON.stringify(hook.locked.core_engine))
      .replace("{{SETTING}}", hook.locked.core_engine.setting_anchor ?? "")
      .replace("{{CHARACTER_PROFILES_JSON}}", charProfilesJson)
      .replace("{{ENSEMBLE_DYNAMIC}}", charPack.locked.ensemble_dynamic ?? "")
      .replace("{{RELATIONSHIP_TENSIONS_JSON}}", relationshipTensionsJson)
      .replace("{{WORLD_SEED}}", session.worldSeed ?? "(none provided)")
      .replace("{{UPSTREAM_DEVELOPMENT_TARGETS}}", upstreamTargets)
      .replace("{{TONE_CHIPS}}", JSON.stringify(hook.preferences?.tone_chips ?? []))
      .replace("{{BAN_LIST}}", JSON.stringify(hook.preferences?.bans ?? []));

    // Dynamic suffix — changes (prior turns, psychology signals, constraint ledger)
    const ledgerText = this.formatLedgerForPrompt(session.constraintLedger ?? [], false);
    const signalsText = formatSignalsForBuilderJudge(session.psychologyLedger);
    let dynamic = WORLD_BUILDER_USER_DYNAMIC
      .replace("{{PRIOR_TURNS}}", this.formatPriorTurnsCompact(session.turns))
      .replace("{{PSYCHOLOGY_SIGNALS}}", signalsText)
      .replace("{{CONSTRAINT_LEDGER}}", ledgerText);

    // ─── Story Bible injection ───
    const storyBibleBuilder = await runtimeProjectStore.getStoryBible(session.projectId);
    dynamic += "\n\n═══ STORY BIBLE (do NOT contradict — these are confirmed canonical facts) ═══\n" +
      (storyBibleBuilder || "(not yet available)");

    // ─── Cultural Intelligence Engine injection ───
    const culturalBrief = await this.getCulturalBriefForBuilder(session);
    const culturalText = culturalResearchService.formatBriefForBuilder(culturalBrief);
    if (culturalText) {
      dynamic += "\n\n" + culturalText;
    }

    // ─── MUST HONOR constraint reinforcement (end of prompt = highest attention) ───
    const mustHonorBuilder = buildMustHonorBlock(session.constraintLedger ?? []);
    if (mustHonorBuilder) {
      dynamic += "\n\n" + mustHonorBuilder;
    }

    return {
      system: WORLD_BUILDER_SYSTEM,
      user: prefix + dynamic,
      cacheableUserPrefix: prefix,
    };
  }

  // ─── Cultural Intelligence Engine helpers ───

  private async getCulturalBrief(
    session: WorldSessionState,
    turnNumber: number,
  ): Promise<import("../../shared/types/cultural").CulturalBrief | null> {
    return culturalResearchService.getBriefForClarifier({
      projectId: session.projectId,
      module: "world",
      turnNumber,
      lockedPacksSummary: this.buildLockedPacksSummary(session),
      currentState: (session.revealedWorld ?? {}) as Record<string, unknown>,
      constraintLedger: this.formatLedgerForPrompt(session.constraintLedger ?? []),
      psychologySummary: formatPsychologyLedgerForPrompt(session.psychologyLedger) ?? "",
      directedReferences: this.extractDirectedReferences(session),
    });
  }

  private async getCulturalBriefForBuilder(
    session: WorldSessionState,
  ): Promise<import("../../shared/types/cultural").CulturalBrief | null> {
    return culturalResearchService.getBriefForBuilder(
      session.projectId, "world", session.turns.length,
    );
  }

  private async fireBackgroundCulturalResearch(
    session: WorldSessionState,
    turnNumber: number,
  ): Promise<void> {
    const context: CulturalResearchContext = {
      projectId: session.projectId,
      module: "world",
      turnNumber,
      lockedPacksSummary: this.buildLockedPacksSummary(session),
      currentState: (session.revealedWorld ?? {}) as Record<string, unknown>,
      constraintLedger: this.formatLedgerForPrompt(session.constraintLedger ?? []),
      psychologySummary: formatPsychologyLedgerForPrompt(session.psychologyLedger) ?? "",
      directedReferences: this.extractDirectedReferences(session),
    };
    await culturalResearchService.fireBackgroundResearch(context);
  }

  private buildLockedPacksSummary(session: WorldSessionState): string {
    const parts: string[] = [];
    if (session.sourceHookPack) {
      parts.push(`HOOK: ${session.sourceHookPack.locked.hook_sentence} — ${session.sourceHookPack.locked.emotional_promise}`);
    }
    if (session.sourceCharacterPack) {
      const chars = Object.entries(session.sourceCharacterPack.locked.characters)
        .map(([role, c]) => `${role}: ${c.role}, description="${c.description}"`)
        .join("; ");
      parts.push(`CHARACTERS: ${chars}`);
    }
    return parts.join("\n\n");
  }

  private extractDirectedReferences(session: WorldSessionState): string[] {
    const refs: string[] = [];
    const recentTurns = session.turns.slice(-3);
    for (const t of recentTurns) {
      if (t.userSelection?.type === "free_text" && (t.userSelection as any).text) {
        refs.push(...detectDirectedReferences((t.userSelection as any).text));
      }
    }
    return [...new Set(refs)];
  }

  private buildJudgePrompt(
    world: WorldBuilderOutput,
    session: WorldSessionState
  ): { system: string; user: string } {
    const hook = session.sourceHookPack;
    const charPack = session.sourceCharacterPack;
    const signalsText = formatSignalsForBuilderJudge(session.psychologyLedger);
    const upstreamTargets = this.formatUpstreamTargets(session);
    // Trimmed profiles for judge — only world-relevant fields
    const charProfilesJson = this.formatCharacterProfilesForBuilder(charPack);

    const user = WORLD_JUDGE_USER_TEMPLATE
      .replace("{{WORLD_JSON}}", JSON.stringify(world, null, 2))
      .replace("{{PREMISE}}", hook.locked.premise)
      .replace("{{EMOTIONAL_PROMISE}}", hook.locked.emotional_promise)
      .replace("{{CHARACTER_PROFILES_JSON}}", charProfilesJson)
      .replace("{{ENSEMBLE_DYNAMIC}}", charPack.locked.ensemble_dynamic ?? "")
      .replace("{{PSYCHOLOGY_SIGNALS}}", signalsText)
      .replace("{{UPSTREAM_DEVELOPMENT_TARGETS}}", upstreamTargets);

    return { system: WORLD_JUDGE_SYSTEM, user };
  }

  private buildSummaryPrompt(session: WorldSessionState): {
    system: string;
    user: string;
  } {
    const hook = session.sourceHookPack;
    const priorTurns = this.formatPriorTurns(session.turns);

    const user = WORLD_SUMMARY_USER_TEMPLATE
      .replace("{{PREMISE}}", hook.locked.premise)
      .replace("{{EMOTIONAL_PROMISE}}", hook.locked.emotional_promise)
      .replace("{{PRIOR_TURNS}}", priorTurns)
      .replace("{{WORLD_JSON}}", JSON.stringify(session.revealedWorld ?? {}, null, 2));

    return { system: WORLD_SUMMARY_SYSTEM, user };
  }

  // ─── Polish ───

  private async polishDescriptions(
    world: WorldBuilderOutput,
    session: WorldSessionState,
    modelOverride?: string
  ): Promise<{ world_thesis?: string; pressure_summary?: string } | null> {
    const hook = session.sourceHookPack;

    const user = WORLD_POLISH_USER_TEMPLATE
      .replace("{{WORLD_THESIS}}", world.world_thesis)
      .replace("{{PRESSURE_SUMMARY}}", world.pressure_summary)
      .replace("{{PREMISE}}", hook.locked.premise)
      .replace("{{EMOTIONAL_PROMISE}}", hook.locked.emotional_promise)
      .replace("{{BAN_LIST}}", JSON.stringify(hook.preferences?.bans ?? []));

    const raw = await this.llm.call("world_polish", WORLD_POLISH_SYSTEM, user, {
      temperature: 0.4,
      maxTokens: 500,
      modelOverride,
    });

    try {
      const parsed = JSON.parse(raw.trim());
      if (typeof parsed === "object" && parsed !== null) {
        return parsed;
      }
    } catch {
      console.error("WORLD POLISH parse failed");
    }

    return null;
  }

  // ─── Upstream Development Targets ───

  private formatUpstreamTargets(session: WorldSessionState): string {
    const targets = session.developmentTargets;
    if (!targets || targets.length === 0) return "(No upstream targets)";

    const unresolved = targets.filter(t => t.status !== "addressed");
    if (unresolved.length === 0) return "(All upstream targets addressed)";

    const lines: string[] = ["DEVELOPMENT TARGETS (from earlier modules — weave in subtly):"];
    for (let i = 0; i < unresolved.length; i++) {
      const t = unresolved[i];
      const statusLabel = t.status === "partially_addressed" ? " [partially addressed]" : "";
      // Use simple sequential number instead of internal IDs like dt_hook_0
      lines.push(`  ${i + 1}. (from ${t.source_module}) ${t.target}${statusLabel}`);
      if (t.notes) lines.push(`     Opportunity: ${t.notes}`);
    }

    return lines.join("\n");
  }

  // ─── Anti-loop: detect consecutive same-focus turns ───

  /**
   * Check if the clarifier has been stuck on the same world_focus for 3+ turns.
   * Returns a soft nudge string for injection, or empty string if no loop detected.
   *
   * This is a NUDGE, not a constraint — the clarifier can still choose the same
   * focus if it has good reason. The goal is to break unconscious loops.
   */
  private buildFocusLoopNudge(turns: WorldTurn[]): string {
    if (turns.length < 3) return "";

    // Get the last 3 focus values (from clarifier responses)
    const recentFoci = turns.slice(-3).map(t => t.clarifierResponse.world_focus).filter(Boolean);
    if (recentFoci.length < 3) return "";

    // Check if all 3 are the same
    const allSame = recentFoci.every(f => f === recentFoci[0]);
    if (!allSame) return "";

    const stuckFocus = recentFoci[0];

    // Build the nudge — suggest other aspects, but don't force
    const allAspects = ["arena", "rules", "factions", "consequences"];
    const otherAspects = allAspects.filter(a => a !== stuckFocus);

    return `═══ FOCUS DIVERSITY NOTE ═══
You've focused on "${stuckFocus}" for 3 consecutive turns. This is fine if there's still meaningful ground to cover, but consider whether switching to ${otherAspects.join(" or ")} would build a more complete world faster. If you've been circling the same sub-topic, a fresh aspect might re-energize the conversation.
This is a suggestion, not a rule. If ${stuckFocus} still needs work, keep going.`;
  }

  // ─── Formatting Helpers ───

  /**
   * Trimmed character profiles for builder/judge — only world-relevant fields.
   * Strips voice_pattern, tell, backstory, stress_style, optimization_function etc.
   * which are scene/dialogue concerns, not world-building concerns.
   */
  private formatCharacterProfilesForBuilder(charPack: CharacterPack): string {
    const chars = charPack.locked.characters;
    const trimmed: Record<string, any> = {};

    for (const [role, char] of Object.entries(chars)) {
      const profile: any = {
        role: char.role,
        description: char.description,
        want: char.psychological_profile?.want,
        misbelief: char.psychological_profile?.misbelief,
        stakes: char.psychological_profile?.stakes,
        break_point: char.psychological_profile?.break_point,
        secret: char.psychological_profile?.secret,
        vulnerability: char.psychological_profile?.vulnerability,
        competence: char.psychological_profile?.competence,
        leverage: char.psychological_profile?.leverage,
        threshold_statement: char.threshold_statement,
        competence_axis: char.competence_axis,
        cost_type: char.cost_type,
        volatility: char.volatility,
      };

      // Include antagonist dials if present
      if (char.antagonist_dials?.moral_logic) {
        profile.moral_logic = char.antagonist_dials.moral_logic;
        profile.strategy_under_constraint = char.antagonist_dials.strategy_under_constraint;
        profile.targeted_attack = char.antagonist_dials.targeted_attack;
      }

      // Include supporting role function if present
      if (char.supporting_dials?.role_function) {
        profile.role_function = char.supporting_dials.role_function;
      }

      trimmed[role] = profile;
    }

    return JSON.stringify(trimmed, null, 2);
  }

  /**
   * Compact prior turns for builder — just the key decisions, no full details.
   */
  private formatPriorTurnsCompact(turns: WorldTurn[]): string {
    if (turns.length === 0) return "(No conversation yet)";

    const lines: string[] = [];
    for (const turn of turns) {
      const parts: string[] = [];
      parts.push(`[Turn ${turn.turnNumber}]`);
      if (turn.clarifierResponse.world_focus) {
        parts.push(`  Focus: ${turn.clarifierResponse.world_focus}`);
      }
      parts.push(`  Question: "${turn.clarifierResponse.question}"`);

      if (!turn.userSelection) {
        parts.push(`  → No response yet`);
      } else if (turn.userSelection.type === "option") {
        parts.push(`  → Chose: "${turn.userSelection.label}"`);
      } else if (turn.userSelection.type === "surprise_me") {
        parts.push(`  → (surprise me)`);
      } else {
        parts.push(`  → Typed: "${turn.userSelection.label}"`);
      }

      // Include assumption responses (these are user choices)
      if (turn.assumptionResponses) {
        const meaningful = turn.assumptionResponses.filter(r => r.action !== "not_ready");
        for (const r of meaningful) {
          if (r.action === "keep") {
            parts.push(`  ✓ Kept: "${r.originalValue}"`);
          } else {
            parts.push(`  ✎ Changed: "${r.originalValue}" → "${r.newValue}"`);
          }
        }
      }

      lines.push(parts.join("\n"));
    }

    return lines.join("\n\n");
  }

  private formatCharacterVisualsSummary(charImagePack: CharacterImagePack | undefined): string {
    if (!charImagePack) return "(No character visuals — character image module was skipped)";

    const locked = charImagePack.locked;
    if (!locked?.characters) return "(No character visuals available)";

    const lines: string[] = [];
    for (const [role, char] of Object.entries(locked.characters)) {
      lines.push(`${role}: ${char.visual_description?.visual_anchors?.visual_vibe ?? "no visual vibe"}`);
      if (char.visual_description?.visual_anchors?.color_palette) {
        lines.push(`  Colors: ${char.visual_description.visual_anchors.color_palette.join(", ")}`);
      }
    }
    return lines.join("\n") || "(No character visuals)";
  }

  private formatPriorTurns(turns: WorldTurn[]): string {
    if (turns.length === 0) return "(No conversation yet)";

    const RECENT_WINDOW = turns.length <= 3 ? 2 : 1;
    const recentStart = Math.max(0, turns.length - RECENT_WINDOW);

    const lines: string[] = [];

    // Older turns: compressed
    for (let i = 0; i < recentStart; i++) {
      const turn = turns[i];
      const parts: string[] = [];
      parts.push(`[Turn ${turn.turnNumber}] (summary)`);
      if (turn.clarifierResponse.world_focus) {
        parts.push(`  Focus: ${turn.clarifierResponse.world_focus}`);
      }
      parts.push(`  Asked: "${turn.clarifierResponse.question}"`);

      if (!turn.userSelection) {
        parts.push(`  → No response yet`);
      } else if (turn.userSelection.type === "option") {
        parts.push(`  → Chose: "${turn.userSelection.label}"`);
      } else if (turn.userSelection.type === "surprise_me") {
        parts.push(`  → (surprise me)`);
      } else {
        parts.push(`  → Typed: "${turn.userSelection.label}"`);
      }

      // Include assumption responses even in compressed turns (these are user choices)
      if (turn.assumptionResponses) {
        const meaningful = turn.assumptionResponses.filter(r => r.action !== "not_ready");
        for (const r of meaningful) {
          if (r.action === "keep") {
            parts.push(`  ✓ Kept: "${r.originalValue}"`);
          } else {
            parts.push(`  ✎ Changed: "${r.originalValue}" → "${r.newValue}"`);
          }
        }
      }

      // Include hypothesis_line in compressed turns (shows evolving world read)
      if (turn.clarifierResponse.hypothesis_line) {
        parts.push(`  World read: "${turn.clarifierResponse.hypothesis_line}"`);
      }

      lines.push(parts.join("\n"));
    }

    // Recent turns: full detail
    for (let i = recentStart; i < turns.length; i++) {
      const turn = turns[i];
      const parts: string[] = [];
      parts.push(`[Turn ${turn.turnNumber}]`);
      if (turn.clarifierResponse.world_focus) {
        parts.push(`  Focus: ${turn.clarifierResponse.world_focus}`);
      }
      parts.push(`  Question: "${turn.clarifierResponse.question}"`);
      parts.push(`  Options: ${turn.clarifierResponse.options.map((o) => `${o.id}="${o.label}"`).join(", ")}`);

      if (turn.clarifierResponse.assumptions && turn.clarifierResponse.assumptions.length > 0) {
        parts.push(`  Assumptions:`);
        for (const a of turn.clarifierResponse.assumptions) {
          parts.push(`    ${a.id} [${a.category}]: "${a.assumption}" → ${a.alternatives.map((alt) => `"${alt}"`).join(" / ")}`);
        }
      }

      if (!turn.userSelection) {
        parts.push(`  → [awaiting response]`);
      } else if (turn.userSelection.type === "option") {
        parts.push(`  → Chose: "${turn.userSelection.label}"`);
      } else if (turn.userSelection.type === "surprise_me") {
        parts.push(`  → (surprise me)`);
      } else {
        parts.push(`  → Typed: "${turn.userSelection.label}"`);
      }

      if (turn.assumptionResponses) {
        for (const r of turn.assumptionResponses) {
          const emoji = r.action === "keep" ? "✓" : r.action === "not_ready" ? "…" : "✎";
          parts.push(`  ${emoji} [${r.category}] ${r.action === "keep" ? `Kept: "${r.originalValue}"` : r.action === "not_ready" ? "Deferred" : `Changed: "${r.originalValue}" → "${r.newValue}"`}`);
        }
      }

      if (turn.clarifierResponse.conflict_flag) {
        parts.push(`  ⚠ ${turn.clarifierResponse.conflict_flag}`);
      }

      lines.push(parts.join("\n"));
    }

    return lines.join("\n\n");
  }

  private formatLedgerForPrompt(ledger: WorldLedgerEntry[], compress = true): string {
    if (!ledger || ledger.length === 0) return "(No constraints established yet)";

    const confirmed = ledger.filter((e) => e.confidence === "confirmed");
    const inferred = ledger.filter((e) => e.confidence === "inferred");
    const imported = ledger.filter((e) => e.confidence === "imported");

    const lines: string[] = [];

    // Clean key for display — strip module prefixes that are just noise
    const cleanKey = (key: string) => key.replace(/^(hook|char|world)\./, "");

    if (imported.length > 0) {
      lines.push("IMPORTED from prior modules (honor these — build on them):");
      for (const e of imported) {
        lines.push(`  - ${cleanKey(e.key)}: "${e.value}"`);
      }
    }

    if (confirmed.length > 0) {
      lines.push("CONFIRMED by user (MUST honor — do NOT contradict or re-ask):");
      for (const e of confirmed) {
        lines.push(`  - ${cleanKey(e.key)}: "${e.value}"`);
      }
    }

    if (inferred.length > 0) {
      lines.push("INFERRED by you (user hasn't weighed in — can surface as assumption):");
      for (const e of inferred) {
        lines.push(`  - ${cleanKey(e.key)}: "${e.value}"`);
      }
    }

    lines.push(`\n${confirmed.length} confirmed, ${inferred.length} inferred, ${imported.length} imported`);

    return lines.join("\n");
  }

  // ─── Assumption Processing ───

  private processAssumptionResponses(
    session: WorldSessionState,
    responses: WorldAssumptionResponse[],
    turnNumber: number
  ): void {
    const ledger = session.constraintLedger;

    for (const resp of responses) {
      if (resp.action === "not_ready") continue;

      const source =
        resp.action === "keep" ? "user_kept_assumption" as const :
        resp.action === "alternative" ? "user_changed_assumption" as const :
        "user_freeform" as const;

      const value = resp.action === "keep" ? resp.originalValue : resp.newValue;
      const ledgerKey = `world.${resp.category}.${resp.assumptionId}`;

      const existingIdx = ledger.findIndex((e) => e.key === ledgerKey);

      const entry: WorldLedgerEntry = {
        key: ledgerKey,
        value,
        source,
        confidence: "confirmed",
        turnNumber,
        assumptionId: resp.assumptionId,
      };

      if (existingIdx >= 0) {
        ledger[existingIdx] = entry;
      } else {
        ledger.push(entry);
      }
    }
  }

  // ─── Psychology Helpers ───

  private updatePsychologyHeuristics(session: WorldSessionState): void {
    if (!session.psychologyLedger) return;

    const lastTurn = session.turns[session.turns.length - 1];
    if (!lastTurn?.userSelection) return;

    const typedCount = lastTurn.userSelection.type === "free_text" ? 1 : 0;
    const clickedCount = lastTurn.userSelection.type === "option" || lastTurn.userSelection.type === "surprise_me" ? 1 : 0;

    const assumptionStats = lastTurn.assumptionResponses ?? [];
    const totalAssumptions = assumptionStats.length;
    const deferredAssumptions = assumptionStats.filter(r => r.action === "not_ready").length;
    const changedAssumptions = assumptionStats.filter(r => r.action === "alternative" || r.action === "freeform").length;
    const responseLengths = lastTurn.userSelection.type === "free_text" && lastTurn.userSelection.label
      ? [lastTurn.userSelection.label.length]
      : [];

    updateHeuristics(session.psychologyLedger, {
      typedCount,
      clickedCount,
      totalAssumptions,
      deferredAssumptions,
      changedAssumptions,
      responseLengths,
    });
  }

  // ─── Prompt History ───

  private recordPromptHistory(
    session: WorldSessionState,
    stage: WorldPromptHistoryEntry["stage"],
    defaultSystem: string,
    defaultUser: string,
    overrides?: WorldPromptOverrides,
    responseSummary?: string
  ): void {
    if (!session.promptHistory) session.promptHistory = [];

    session.promptHistory.push({
      timestamp: new Date().toISOString(),
      stage,
      turnNumber: session.turns.length,
      defaultSystem,
      defaultUser,
      editedSystem: overrides?.system,
      editedUser: overrides?.user,
      wasEdited: !!(overrides?.system || overrides?.user),
      responseSummary,
    });
  }

  // ─── Parse Helper ───

  private parseAndValidate<T>(raw: string, requiredFields: string[]): T | null {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const field of requiredFields) {
        if (!(field in parsed)) return null;
      }
      return parsed as T;
    } catch {
      // Try extracting JSON from markdown fences
      const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenced) {
        try {
          const parsed = JSON.parse(fenced[1].trim()) as Record<string, unknown>;
          for (const field of requiredFields) {
            if (!(field in parsed)) return null;
          }
          return parsed as T;
        } catch {
          return null;
        }
      }
      return null;
    }
  }
}
