import {
  PlotAssumptionResponse,
  PlotBuilderOutput,
  PlotClarifierResponse,
  PlotJudgeOutput,
  PlotLedgerEntry,
  PlotPack,
  PlotSessionState,
  PlotTurn,
  PlotPromptHistoryEntry,
  PlotPromptOverrides,
  PlotPromptPreview,
  PlotDevelopmentTarget,
} from "../../shared/types/plot";
import { WorldPack } from "../../shared/types/world";
import { CharacterPack } from "../../shared/types/character";
import { CharacterImagePack } from "../../shared/types/characterImage";
import { HookPack } from "../../shared/types/hook";
import { PlotStore } from "../storage/plotStore";
import { WorldStore } from "../storage/worldStore";
import { CharacterStore } from "../storage/characterStore";
import { CharacterImageStore } from "../storage/characterImageStore";
import { ProjectStore } from "../storage/projectStore";
import { LLMClient } from "./llmClient";
import {
  PLOT_BUILDER_SYSTEM,
  PLOT_BUILDER_USER_PREFIX,
  PLOT_BUILDER_USER_DYNAMIC,
  PLOT_BUILDER_USER_TEMPLATE,
  PLOT_CLARIFIER_SYSTEM,
  PLOT_CLARIFIER_USER_PREFIX,
  PLOT_CLARIFIER_USER_DYNAMIC,
  PLOT_CLARIFIER_USER_TEMPLATE,
  PLOT_JUDGE_SYSTEM,
  PLOT_JUDGE_USER_TEMPLATE,
  PLOT_SUMMARY_SYSTEM,
  PLOT_SUMMARY_USER_TEMPLATE,
} from "./plotPrompts";
import {
  PLOT_BUILDER_SCHEMA,
  PLOT_CLARIFIER_SCHEMA,
  PLOT_JUDGE_SCHEMA,
} from "./plotSchemas";
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
} from "./psychologyEngine";
import type { RawSignalObservation, BehaviorSummary, AdaptationPlan } from "../../shared/types/userPsychology";
import {
  runDivergenceExploration,
  extractDivergenceContext,
  formatDirectionMapForPrompt,
} from "./divergenceExplorer";

// ─── API response types ───

export interface PlotClarifyResponse {
  clarifier: PlotClarifierResponse;
  turnNumber: number;
  totalTurns: number;
}

export interface PlotGenerateResponse {
  plot: PlotBuilderOutput;
  judge: {
    passed: boolean;
    hard_fail_reasons: string[];
    scores: PlotJudgeOutput["scores"];
    weakest_element: string;
    one_fix_instruction: string;
  } | null;
  rerollCount: number;
  developmentTargets?: PlotDevelopmentTarget[];
  weaknesses?: Array<{
    area: string;
    weakness: string;
    development_opportunity: string;
  }>;
}

export class PlotServiceError extends Error {
  code: "NOT_FOUND" | "INVALID_INPUT" | "LLM_PARSE_ERROR" | "LLM_CALL_FAILED";

  constructor(
    code: "NOT_FOUND" | "INVALID_INPUT" | "LLM_PARSE_ERROR" | "LLM_CALL_FAILED",
    message: string
  ) {
    super(message);
    this.code = code;
  }
}

export class PlotService {
  constructor(
    private plotStore: PlotStore,
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
  ): Promise<PlotPromptPreview> {
    const session = await this.plotStore.get(projectId);
    if (!session) {
      throw new PlotServiceError("NOT_FOUND", "Plot session not found");
    }

    switch (stage) {
      case "clarifier": {
        const prompt = this.buildClarifierPrompt(session);
        return { stage, system: prompt.system, user: prompt.user };
      }
      case "builder": {
        const prompt = this.buildBuilderPrompt(session);
        return { stage, system: prompt.system, user: prompt.user };
      }
      case "judge": {
        if (session.revealedPlot) {
          const prompt = this.buildJudgePrompt(session.revealedPlot, session);
          return { stage, system: prompt.system, user: prompt.user };
        }
        return {
          stage,
          system: PLOT_JUDGE_SYSTEM,
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
    worldProjectId: string,
    characterImageProjectId: string | undefined,
    characterProjectId: string,
    hookProjectId: string,
    userSelection?: { type: "option" | "free_text" | "surprise_me"; optionId?: string; label: string },
    modelOverride?: string,
    promptOverrides?: PlotPromptOverrides,
    assumptionResponses?: PlotAssumptionResponse[],
    plotSeed?: string,
  ): Promise<PlotClarifyResponse> {
    let session = await this.plotStore.get(projectId);
    const isFirstTurn = !session || session.turns.length === 0;

    if (isFirstTurn) {
      if (userSelection) {
        throw new PlotServiceError("INVALID_INPUT", "First turn cannot have userSelection");
      }

      if (!session) {
        // Load upstream packs — parallel for speed
        const [charImageExport, charExport, hookExport, worldExport] = await Promise.all([
          characterImageProjectId
            ? this.charImageStore.getExport(characterImageProjectId)
            : Promise.resolve(undefined),
          this.charStore.getExport(characterProjectId),
          this.hookStore.getExport(hookProjectId),
          this.worldStore.getExport(worldProjectId),
        ]);

        let sourceCharacterImagePack: CharacterImagePack | undefined;
        if (characterImageProjectId) {
          if (!charImageExport || !charImageExport.characterImagePack) {
            throw new PlotServiceError(
              "NOT_FOUND",
              "Character image export not found. Complete the character image module first."
            );
          }
          sourceCharacterImagePack = charImageExport.characterImagePack;
        }

        if (!charExport || !charExport.characterPack) {
          throw new PlotServiceError(
            "NOT_FOUND",
            "Character export not found. Complete the character module first."
          );
        }

        if (!hookExport || !hookExport.hookPack) {
          throw new PlotServiceError(
            "NOT_FOUND",
            "Hook export not found. Complete the hook module first."
          );
        }

        if (!worldExport || !worldExport.worldPack) {
          throw new PlotServiceError(
            "NOT_FOUND",
            "World export not found. Complete the world module first."
          );
        }

        const sourceCharPack = charExport.characterPack;
        const sourceHookPack = hookExport.hookPack;
        const sourceWorldPack = worldExport.worldPack;

        // Import constraint ledger — FLATTENED approach.
        // Only import from the immediate upstream module (world), which already
        // contains all hook and character constraints in its own ledger.
        // This prevents the 3-4x duplication where the same fact appears as
        // hook.X, char.hook.X, world.hook.X, world.char.hook.X.
        const importedLedger: PlotLedgerEntry[] = [];

        // World ledger entries (already contains all upstream constraints)
        if (worldExport.constraintLedger) {
          for (const entry of worldExport.constraintLedger) {
            importedLedger.push({
              key: entry.key,              // keep original key — no re-prefixing
              value: entry.value,
              source: "world_imported",
              confidence: "imported",
              turnNumber: 0,
            });
          }
        }

        // Only add hook/character entries that are NOT already in the world ledger
        // (i.e., entries the world module didn't carry forward — shouldn't happen
        // normally, but safety net for edge cases)
        const worldKeys = new Set(importedLedger.map(e => e.key));

        if (hookExport.constraintLedger) {
          for (const entry of hookExport.constraintLedger) {
            const hookKey = `hook.${entry.key}`;
            if (!worldKeys.has(hookKey) && !worldKeys.has(entry.key)) {
              importedLedger.push({
                key: `hook.${entry.key}`,
                value: entry.value,
                source: "hook_imported",
                confidence: "imported",
                turnNumber: 0,
              });
            }
          }
        }

        if (charExport.constraintLedger) {
          for (const entry of charExport.constraintLedger) {
            const charKey = `char.${entry.key}`;
            if (!worldKeys.has(charKey) && !worldKeys.has(entry.key)) {
              importedLedger.push({
                key: `char.${entry.key}`,
                value: entry.value,
                source: "character_imported",
                confidence: "imported",
                turnNumber: 0,
              });
            }
          }
        }

        // Import psychology ledger (prefer worldPack > charImagePack > charPack > hookPack — most recent)
        const importedPsychLedger = ensureLedgerShape(
          sourceWorldPack?.psychologyLedger ??
          sourceCharacterImagePack?.psychologyLedger ??
          sourceCharPack.psychologyLedger ??
          sourceHookPack.psychologyLedger ??
          createEmptyLedger()
        );
        snapshotBaselineForNewModule(importedPsychLedger);

        // Build development targets from upstream weaknesses
        const devTargets: PlotDevelopmentTarget[] = [];

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

        // World weaknesses
        if (sourceWorldPack.weaknesses) {
          for (let i = 0; i < sourceWorldPack.weaknesses.length; i++) {
            const w = sourceWorldPack.weaknesses[i];
            devTargets.push({
              id: `dt_world_${i}`,
              source_module: "world",
              target: `[${w.area}] ${w.weakness}`,
              status: "unaddressed",
              notes: w.development_opportunity,
            });
          }
        }

        // Strip base64 image data from CharacterImagePack — Plot only needs text descriptions
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
                      image_base64: "", // stripped — not needed for plot module
                      enhanced_prompt: char.enhanced_prompt,
                    }]
                  )
                ),
              },
            }
          : undefined;

        session = {
          projectId,
          worldProjectId,
          characterImageProjectId,
          characterProjectId,
          hookProjectId,
          sourceCharacterImagePack: lightCharImagePack,
          sourceCharacterPack: sourceCharPack,
          sourceHookPack: sourceHookPack,
          sourceWorldPack: sourceWorldPack,
          plotSeed: plotSeed ?? undefined,
          turns: [],
          constraintLedger: importedLedger,
          developmentTargets: devTargets,
          status: "clarifying",
          rerollCount: 0,
          psychologyLedger: importedPsychLedger,
        };
      }

      if (session && plotSeed) {
        session.plotSeed = plotSeed;
      }
    } else {
      if (!session) {
        throw new PlotServiceError("NOT_FOUND", "Plot session not found");
      }

      if (session.status === "revealed" || session.status === "locked") {
        throw new PlotServiceError("INVALID_INPUT", "Session already progressed; reset first");
      }

      if (!userSelection) {
        throw new PlotServiceError("INVALID_INPUT", "Subsequent turns require userSelection");
      }

      const previousTurn = session.turns[session.turns.length - 1];
      if (!previousTurn) {
        throw new PlotServiceError("INVALID_INPUT", "No clarifier turn to attach selection to");
      }

      if (userSelection.type === "option") {
        const isValid = previousTurn.clarifierResponse.options.some(
          (opt) => opt.id === userSelection.optionId
        );
        if (!userSelection.optionId || !isValid) {
          throw new PlotServiceError("INVALID_INPUT", "optionId must exist in previous turn options");
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
    const prompt = this.buildClarifierPrompt(session!);
    const system = promptOverrides?.system ?? prompt.system;
    const user = promptOverrides?.user ?? prompt.user;

    let raw: string;
    try {
      raw = await this.llm.call("plot_clarifier", system, user, {
        temperature: 0.7,
        maxTokens: 4000,
        modelOverride,
        jsonSchema: PLOT_CLARIFIER_SCHEMA,
        // Only use cached prefix when not using prompt overrides
        cacheableUserPrefix: promptOverrides?.user ? undefined : prompt.cacheableUserPrefix,
      });
    } catch (err) {
      console.error("PLOT CLARIFIER LLM ERROR:", err);
      throw new PlotServiceError("LLM_CALL_FAILED", "Plot clarifier LLM call failed");
    }

    // Record prompt history
    this.recordPromptHistory(
      session!, "clarifier", prompt.system, prompt.user,
      promptOverrides, raw.slice(0, 200)
    );

    const clarifier = this.parseAndValidate<PlotClarifierResponse>(raw, [
      "psychology_strategy", "hypothesis_line", "question", "options",
      "allow_free_text", "ready_for_plot", "readiness_pct", "assumptions", "user_read"
    ]);

    if (!clarifier) {
      throw new PlotServiceError("LLM_PARSE_ERROR", "Failed to parse plot clarifier output");
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
          "plot",
          ur.signals as RawSignalObservation[],
          ur.behaviorSummary as BehaviorSummary,
          (ur.adaptationPlan as AdaptationPlan) ?? { dominantNeed: "", moves: [] },
        );
      } else {
        recordHypotheses(
          session!.psychologyLedger,
          session!.turns.length + 1,
          "plot",
          (ur as any).hypotheses ?? [],
          (ur as any).overall_read ?? "",
          (ur as any).satisfaction
        );
      }
    }
    this.updatePsychologyHeuristics(session!);

    const turn: PlotTurn = {
      turnNumber: session!.turns.length + 1,
      clarifierResponse: clarifier,
      userSelection: null,
    };

    // Suppress readiness on the very first turn
    if (session!.turns.length < 1 && turn.clarifierResponse.ready_for_plot) {
      turn.clarifierResponse.ready_for_plot = false;
    }

    // Readiness convergence safety net
    if (turn.clarifierResponse.readiness_pct >= 75) {
      session!.consecutiveHighReadiness = (session!.consecutiveHighReadiness ?? 0) + 1;
    } else {
      session!.consecutiveHighReadiness = 0;
    }

    if (
      session!.consecutiveHighReadiness! >= 2 &&
      !turn.clarifierResponse.ready_for_plot &&
      session!.turns.length >= 3
    ) {
      turn.clarifierResponse.ready_for_plot = true;
      turn.clarifierResponse.readiness_note =
        turn.clarifierResponse.readiness_note || "Your plot is taking shape nicely — ready to build it!";
    }

    session!.turns.push(turn);
    session!.status = "clarifying";
    session!.lastSavedAt = new Date().toISOString();

    // Mark any pending probe as consumed
    if (session!.psychologyLedger) {
      markProbeConsumed(session!.psychologyLedger, turn.turnNumber);
    }

    await this.plotStore.save(session!);

    // ─── Fire background consolidation (non-blocking) ───
    if (session!.psychologyLedger && session!.psychologyLedger.signalStore.length > 0) {
      this.fireBackgroundConsolidation(session!.projectId, turn.turnNumber, "plot")
        .catch(err => console.error("[PSYCH] Plot consolidation fire failed:", err));
    }

    // ─── Fire background divergence exploration (non-blocking) ───
    if (turn.turnNumber >= 2) {
      this.fireBackgroundDivergence(session!, turn.turnNumber, "plot")
        .catch(err => console.error("[DIVERGENCE] Plot exploration fire failed:", err));
    }

    return {
      clarifier: turn.clarifierResponse,
      turnNumber: turn.turnNumber,
      totalTurns: session!.turns.length,
    };
  }

  /**
   * Fire-and-forget background consolidation for plot module.
   */
  private async fireBackgroundConsolidation(
    projectId: string,
    turnNumber: number,
    module: "plot",
  ): Promise<void> {
    const sessionForConsolidation = await this.plotStore.get(projectId);
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
      const freshSession = await this.plotStore.get(projectId);
      if (!freshSession) return;

      if (!freshSession.psychologyLedger) freshSession.psychologyLedger = sessionForConsolidation.psychologyLedger;
      else {
        freshSession.psychologyLedger.signalStore = sessionForConsolidation.psychologyLedger.signalStore;
        freshSession.psychologyLedger.lastConsolidation = sessionForConsolidation.psychologyLedger.lastConsolidation;
      }
      freshSession.lastSavedAt = new Date().toISOString();
      await this.plotStore.save(freshSession);
    }
  }

  /**
   * Fire-and-forget background divergence exploration for plot module.
   */
  private async fireBackgroundDivergence(
    session: PlotSessionState,
    turnNumber: number,
    module: "plot",
  ): Promise<void> {
    const psychSummary = formatPsychologyLedgerForPrompt(session.psychologyLedger);
    // Build a lightweight "current state" snapshot for the divergence explorer
    const currentState: Record<string, unknown> = {
      plot_seed: session.plotSeed ?? "",
      turn_count: session.turns.length,
      latest_hypothesis: session.turns[session.turns.length - 1]?.clarifierResponse?.hypothesis_line ?? "",
      constraint_count: session.constraintLedger?.length ?? 0,
    };
    const previousFamilyNames = session.psychologyLedger?.lastDirectionMap?.directionMap?.families
      ?.map(f => f.name) ?? [];
    const context = extractDivergenceContext(
      session.sourceHookPack.state_summary ?? "",
      session.constraintLedger as any,
      currentState,
      psychSummary,
      turnNumber,
      module,
      previousFamilyNames,
    );

    const snapshot = await runDivergenceExploration(context, this.llm);

    if (snapshot) {
      const freshSession = await this.plotStore.get(session.projectId);
      if (!freshSession) return;

      if (!freshSession.psychologyLedger) freshSession.psychologyLedger = createEmptyLedger();
      freshSession.psychologyLedger.lastDirectionMap = snapshot;
      freshSession.lastSavedAt = new Date().toISOString();
      await this.plotStore.save(freshSession);
    }
  }

  // ─── Generate (builder + judge) ───

  async runGenerate(
    projectId: string,
    modelOverride?: string,
    promptOverrides?: { builder?: PlotPromptOverrides; judge?: PlotPromptOverrides },
  ): Promise<PlotGenerateResponse> {
    const session = await this.plotStore.get(projectId);
    if (!session) {
      throw new PlotServiceError("NOT_FOUND", "Plot session not found");
    }
    if (session.turns.length === 0) {
      throw new PlotServiceError("INVALID_INPUT", "Must have at least 1 clarifier turn before generating");
    }

    session.status = "generating";
    await this.plotStore.save(session);

    // ─── Builder ───
    const builderPrompt = this.buildBuilderPrompt(session);
    const builderSystem = promptOverrides?.builder?.system ?? builderPrompt.system;
    const builderUser = promptOverrides?.builder?.user ?? builderPrompt.user;

    let builderRaw: string;
    try {
      builderRaw = await this.llm.call("plot_builder", builderSystem, builderUser, {
        temperature: 0.6,
        maxTokens: 12000,
        modelOverride,
        jsonSchema: PLOT_BUILDER_SCHEMA,
        cacheableUserPrefix: promptOverrides?.builder?.user ? undefined : builderPrompt.cacheableUserPrefix,
      });
    } catch (err) {
      console.error("PLOT BUILDER LLM ERROR:", err);
      throw new PlotServiceError("LLM_CALL_FAILED", "Plot builder LLM call failed");
    }

    this.recordPromptHistory(
      session, "builder", builderPrompt.system, builderPrompt.user,
      promptOverrides?.builder, builderRaw.slice(0, 200)
    );

    const builderResult = this.parseAndValidate<PlotBuilderOutput>(builderRaw, [
      "core_conflict", "tension_chain", "turning_points", "climax",
      "resolution", "theme_cluster", "addiction_engine", "collision_sources"
    ]);

    if (!builderResult) {
      throw new PlotServiceError("LLM_PARSE_ERROR", "Failed to parse plot builder output");
    }

    // ─── Judge ───
    const judgePrompt = this.buildJudgePrompt(builderResult, session);
    const judgeSystem = promptOverrides?.judge?.system ?? judgePrompt.system;
    const judgeUser = promptOverrides?.judge?.user ?? judgePrompt.user;

    let judgeRaw: string;
    try {
      judgeRaw = await this.llm.call("plot_judge", judgeSystem, judgeUser, {
        temperature: 0.3,
        maxTokens: 1500,
        modelOverride,
        jsonSchema: PLOT_JUDGE_SCHEMA,
      });
    } catch (err) {
      console.error("PLOT JUDGE LLM ERROR:", err);
      // Non-fatal: reveal without judge
      session.revealedPlot = builderResult;
      session.status = "revealed";
      session.lastSavedAt = new Date().toISOString();
      await this.plotStore.save(session);
      return { plot: builderResult, judge: null, rerollCount: session.rerollCount ?? 0 };
    }

    const judgeResult = this.parseAndValidate<PlotJudgeOutput>(judgeRaw, [
      "pass", "hard_fail_reasons", "scores", "weakest_element", "one_fix_instruction",
    ]);

    // Defensive defaults for score dimensions
    if (judgeResult?.scores) {
      if (typeof judgeResult.scores.tension_escalation !== "number") judgeResult.scores.tension_escalation = 5;
      if (typeof judgeResult.scores.causal_integrity !== "number") judgeResult.scores.causal_integrity = 5;
      if (typeof judgeResult.scores.twist_quality !== "number") judgeResult.scores.twist_quality = 5;
      if (typeof judgeResult.scores.mystery_hook_density !== "number") judgeResult.scores.mystery_hook_density = 5;
      if (typeof judgeResult.scores.dramatic_irony_payoff !== "number") judgeResult.scores.dramatic_irony_payoff = 5;
      if (typeof judgeResult.scores.climax_earned !== "number") judgeResult.scores.climax_earned = 5;
      if (typeof judgeResult.scores.ending_satisfaction !== "number") judgeResult.scores.ending_satisfaction = 5;
      if (typeof judgeResult.scores.user_fit !== "number") judgeResult.scores.user_fit = 5;
    }

    this.recordPromptHistory(
      session, "judge", judgePrompt.system, judgePrompt.user,
      promptOverrides?.judge,
      judgeResult ? `${judgeResult.pass ? "PASS" : "FAIL"} weakest=${judgeResult.weakest_element}` : "PARSE_FAILED"
    );

    // Update development targets based on judge assessment
    if (judgeResult?.upstream_target_assessment && session.developmentTargets) {
      for (const assessment of judgeResult.upstream_target_assessment) {
        const target = session.developmentTargets.find(t => t.id === assessment.target_id);
        if (target) {
          target.status = assessment.status;
          if (assessment.notes) target.notes = assessment.notes;
          if (assessment.status === "addressed") target.addressed_by = "plot";
          if (assessment.quality) target.quality = assessment.quality;
          if (assessment.current_gap) target.current_gap = assessment.current_gap;
          if (assessment.suggestion) target.suggestion = assessment.suggestion;
          if (assessment.best_module_to_address) target.best_module_to_address = assessment.best_module_to_address;
        }
      }
    }

    session.revealedPlot = builderResult;
    session.revealedJudge = judgeResult ?? undefined;
    session.status = "revealed";
    session.lastSavedAt = new Date().toISOString();

    await this.plotStore.save(session);

    return {
      plot: builderResult,
      judge: judgeResult ? {
        passed: judgeResult.pass,
        hard_fail_reasons: judgeResult.hard_fail_reasons,
        scores: judgeResult.scores,
        weakest_element: judgeResult.weakest_element,
        one_fix_instruction: judgeResult.one_fix_instruction,
      } : null,
      rerollCount: session.rerollCount ?? 0,
      developmentTargets: session.developmentTargets,
      weaknesses: judgeResult?.weaknesses,
    };
  }

  // ─── Reroll ───

  async reroll(
    projectId: string,
    modelOverride?: string,
    promptOverrides?: { builder?: PlotPromptOverrides; judge?: PlotPromptOverrides },
  ): Promise<PlotGenerateResponse> {
    const session = await this.plotStore.get(projectId);
    if (!session) {
      throw new PlotServiceError("NOT_FOUND", "Plot session not found");
    }
    if (session.status !== "revealed") {
      throw new PlotServiceError("INVALID_INPUT", "Must be in revealed status to reroll");
    }

    session.rerollCount = (session.rerollCount ?? 0) + 1;
    session.revealedPlot = undefined;
    session.revealedJudge = undefined;
    await this.plotStore.save(session);

    return this.runGenerate(projectId, modelOverride, promptOverrides);
  }

  // ─── Lock Plot ───

  async lockPlot(
    projectId: string,
    modelOverride?: string,
  ): Promise<PlotPack> {
    const session = await this.plotStore.get(projectId);
    if (!session) {
      throw new PlotServiceError("NOT_FOUND", "Plot session not found");
    }
    if (session.status !== "revealed" || !session.revealedPlot) {
      throw new PlotServiceError("INVALID_INPUT", "Must be in revealed status to lock");
    }

    session.lastSavedAt = new Date().toISOString();
    await this.plotStore.save(session);

    // Generate summary
    const summaryPrompt = this.buildSummaryPrompt(session);
    let summary = "";
    try {
      summary = await this.llm.call("plot_summary", summaryPrompt.system, summaryPrompt.user, {
        temperature: 0.5,
        maxTokens: 800,
        modelOverride,
      });
    } catch (err) {
      console.error("PLOT SUMMARY LLM ERROR:", err);
      throw new PlotServiceError("LLM_CALL_FAILED", "Plot summary generation failed");
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

    const plot = session.revealedPlot;

    // Add plot weaknesses to development targets
    if (!session.developmentTargets) session.developmentTargets = [];
    if (session.revealedJudge?.weaknesses) {
      for (let i = 0; i < session.revealedJudge.weaknesses.length; i++) {
        const w = session.revealedJudge.weaknesses[i];
        session.developmentTargets.push({
          id: `dt_plot_${i}`,
          source_module: "plot",
          target: `[${w.area}] ${w.weakness}`,
          status: "unaddressed",
          notes: w.development_opportunity,
          best_module_to_address: "scene",
          current_gap: w.weakness,
        });
      }
    }

    const plotPack: PlotPack = {
      module: "plot",
      locked: {
        core_conflict: plot.core_conflict,
        tension_chain: plot.tension_chain,
        turning_points: plot.turning_points,
        climax: plot.climax,
        resolution: plot.resolution,
        dramatic_irony_points: plot.dramatic_irony_points,
        theme_cluster: plot.theme_cluster,
        theme_beats: plot.theme_beats,
        motifs: plot.motifs,
        mystery_hooks: plot.mystery_hooks,
        addiction_engine: plot.addiction_engine,
        collision_sources: plot.collision_sources,
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
      worldPack_reference: { worldProjectId: session.worldProjectId },
      hookPack_reference: { hookProjectId: session.hookProjectId },
      psychologyLedger: session.psychologyLedger,
    };

    await this.plotStore.saveExport(session, plotPack);

    session.status = "locked";
    session.lastSavedAt = new Date().toISOString();
    await this.plotStore.save(session);

    return plotPack;
  }

  // ─── Session Management ───

  async getSession(projectId: string): Promise<PlotSessionState | null> {
    return this.plotStore.get(projectId);
  }

  async resetSession(projectId: string): Promise<void> {
    await this.plotStore.delete(projectId);
  }

  // ─── Prompt Builders (private) ───

  private buildClarifierPrompt(session: PlotSessionState): {
    system: string;
    user: string;
    cacheableUserPrefix?: string;
  } {
    const hook = session.sourceHookPack;
    const charPack = session.sourceCharacterPack;
    const charImagePack = session.sourceCharacterImagePack;
    const world = session.sourceWorldPack;
    const priorTurns = this.formatPriorTurns(session.turns);
    const ledgerText = this.formatLedgerForPrompt(session.constraintLedger ?? []);
    const turnNumber = String(session.turns.length + 1);
    const psychText = formatPsychologyLedgerForPrompt(session.psychologyLedger);
    const upstreamTargets = this.formatUpstreamTargets(session);

    const charProfilesJson = JSON.stringify(charPack.locked.characters, null, 2);
    const relationshipTensionsJson = JSON.stringify(charPack.locked.relationship_tensions ?? []);
    const visualSummary = this.formatCharacterVisualsSummary(charImagePack);

    // Static upstream context — cacheable (doesn't change between turns)
    const prefix = PLOT_CLARIFIER_USER_PREFIX
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
      .replace("{{WORLD_THESIS}}", world.locked.world_thesis)
      .replace("{{PRESSURE_SUMMARY}}", world.locked.pressure_summary)
      .replace("{{ARENA_JSON}}", JSON.stringify(world.locked.arena))
      .replace("{{RULES_JSON}}", JSON.stringify(world.locked.rules))
      .replace("{{FACTIONS_JSON}}", JSON.stringify(world.locked.factions))
      .replace("{{CONSEQUENCE_PATTERNS_JSON}}", JSON.stringify(world.locked.consequence_patterns))
      .replace("{{INFORMATION_ACCESS_JSON}}", JSON.stringify(world.locked.information_access ?? []))
      .replace("{{VOLATILITY_JSON}}", JSON.stringify(world.locked.volatility ?? []))
      .replace("{{PLOT_SEED}}", session.plotSeed ?? "(none provided)")
      .replace("{{UPSTREAM_DEVELOPMENT_TARGETS}}", upstreamTargets);

    // Dynamic per-turn content
    let dynamic = PLOT_CLARIFIER_USER_DYNAMIC
      .replace("{{PRIOR_TURNS}}", priorTurns)
      .replace("{{PSYCHOLOGY_LEDGER}}", psychText)
      .replace("{{ENGINE_DIALS}}", formatEngineDialsForPrompt(session.psychologyLedger))
      .replace("{{CONSTRAINT_LEDGER}}", ledgerText)
      .replace("{{TURN_NUMBER}}", turnNumber);

    const probeText = formatSuggestedProbeForPrompt(session.psychologyLedger);
    const currentTurn = session.turns.length + 1;
    const directionMapText = formatDirectionMapForPrompt(session.psychologyLedger, currentTurn);

    dynamic = dynamic
      .replace("{{DIRECTION_MAP}}", directionMapText || "")
      + (probeText ? "\n\n" + probeText : "");

    return {
      system: PLOT_CLARIFIER_SYSTEM,
      user: prefix + dynamic,
      cacheableUserPrefix: prefix,
    };
  }

  private buildBuilderPrompt(session: PlotSessionState): {
    system: string;
    user: string;
    cacheableUserPrefix?: string;
  } {
    const hook = session.sourceHookPack;
    const charPack = session.sourceCharacterPack;
    const world = session.sourceWorldPack;
    const ledgerText = this.formatLedgerForPrompt(session.constraintLedger ?? [], false);
    const signalsText = formatSignalsForBuilderJudge(session.psychologyLedger);
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

    const charImagePack = session.sourceCharacterImagePack;
    const visualSummary = this.formatCharacterVisualsSummary(charImagePack);

    // Static upstream context — cacheable
    const prefix = PLOT_BUILDER_USER_PREFIX
      .replace("{{PREMISE}}", hook.locked.premise)
      .replace("{{HOOK_SENTENCE}}", hook.locked.hook_sentence)
      .replace("{{EMOTIONAL_PROMISE}}", hook.locked.emotional_promise)
      .replace("{{CORE_ENGINE_JSON}}", JSON.stringify(hook.locked.core_engine))
      .replace("{{SETTING}}", hook.locked.core_engine.setting_anchor ?? "")
      .replace("{{CHARACTER_PROFILES_JSON}}", charProfilesJson)
      .replace("{{ENSEMBLE_DYNAMIC}}", charPack.locked.ensemble_dynamic ?? "")
      .replace("{{RELATIONSHIP_TENSIONS_JSON}}", relationshipTensionsJson)
      .replace("{{CHARACTER_VISUALS_SUMMARY}}", visualSummary)
      .replace("{{WORLD_THESIS}}", world.locked.world_thesis)
      .replace("{{PRESSURE_SUMMARY}}", world.locked.pressure_summary)
      .replace("{{SCOPE_JSON}}", JSON.stringify(world.locked.scope))
      .replace("{{ARENA_JSON}}", JSON.stringify(world.locked.arena))
      .replace("{{RULES_JSON}}", JSON.stringify(world.locked.rules))
      .replace("{{FACTIONS_JSON}}", JSON.stringify(world.locked.factions))
      .replace("{{CONSEQUENCE_PATTERNS_JSON}}", JSON.stringify(world.locked.consequence_patterns))
      .replace("{{INFORMATION_ACCESS_JSON}}", JSON.stringify(world.locked.information_access ?? []))
      .replace("{{VOLATILITY_JSON}}", JSON.stringify(world.locked.volatility ?? []))
      .replace("{{CANON_REGISTER_JSON}}", JSON.stringify(world.locked.canon_register ?? []))
      .replace("{{PLOT_SEED}}", session.plotSeed ?? "(none provided)")
      .replace("{{UPSTREAM_DEVELOPMENT_TARGETS}}", upstreamTargets);

    // Dynamic per-generation content
    const dynamic = PLOT_BUILDER_USER_DYNAMIC
      .replace("{{PRIOR_TURNS}}", this.formatPriorTurnsCompact(session.turns))
      .replace("{{PSYCHOLOGY_SIGNALS}}", signalsText)
      .replace("{{CONSTRAINT_LEDGER}}", ledgerText)
      .replace("{{TONE_CHIPS}}", JSON.stringify(hook.preferences?.tone_chips ?? []))
      .replace("{{BAN_LIST}}", JSON.stringify(hook.preferences?.bans ?? []));

    return { system: PLOT_BUILDER_SYSTEM, user: prefix + dynamic, cacheableUserPrefix: prefix };
  }

  private buildJudgePrompt(
    plot: PlotBuilderOutput,
    session: PlotSessionState
  ): { system: string; user: string } {
    const hook = session.sourceHookPack;
    const charPack = session.sourceCharacterPack;
    const world = session.sourceWorldPack;
    const signalsText = formatSignalsForBuilderJudge(session.psychologyLedger);
    const upstreamTargets = this.formatUpstreamTargets(session);
    // Trimmed profiles for judge — only world-relevant fields
    const charProfilesJson = this.formatCharacterProfilesForBuilder(charPack);

    const user = PLOT_JUDGE_USER_TEMPLATE
      .replace("{{PLOT_JSON}}", JSON.stringify(plot, null, 2))
      .replace("{{PREMISE}}", hook.locked.premise)
      .replace("{{EMOTIONAL_PROMISE}}", hook.locked.emotional_promise)
      .replace("{{CHARACTER_PROFILES_JSON}}", charProfilesJson)
      .replace("{{ENSEMBLE_DYNAMIC}}", charPack.locked.ensemble_dynamic ?? "")
      .replace("{{WORLD_THESIS}}", world.locked.world_thesis)
      .replace("{{PRESSURE_SUMMARY}}", world.locked.pressure_summary)
      .replace("{{RULES_JSON}}", JSON.stringify(world.locked.rules))
      .replace("{{FACTIONS_JSON}}", JSON.stringify(world.locked.factions))
      .replace("{{PSYCHOLOGY_SIGNALS}}", signalsText)
      .replace("{{UPSTREAM_DEVELOPMENT_TARGETS}}", upstreamTargets);

    return { system: PLOT_JUDGE_SYSTEM, user };
  }

  private buildSummaryPrompt(session: PlotSessionState): {
    system: string;
    user: string;
  } {
    const hook = session.sourceHookPack;
    const priorTurns = this.formatPriorTurns(session.turns);

    const user = PLOT_SUMMARY_USER_TEMPLATE
      .replace("{{PREMISE}}", hook.locked.premise)
      .replace("{{EMOTIONAL_PROMISE}}", hook.locked.emotional_promise)
      .replace("{{PRIOR_TURNS}}", priorTurns)
      .replace("{{PLOT_JSON}}", JSON.stringify(session.revealedPlot ?? {}, null, 2));

    return { system: PLOT_SUMMARY_SYSTEM, user };
  }

  // ─── Upstream Development Targets ───

  private formatUpstreamTargets(session: PlotSessionState): string {
    const targets = session.developmentTargets;
    if (!targets || targets.length === 0) return "(No upstream targets)";

    const unresolved = targets.filter(t => t.status !== "addressed" && t.status !== "deferred");
    if (unresolved.length === 0) return "(All upstream targets addressed)";

    const lines: string[] = ["DEVELOPMENT TARGETS (from earlier modules — address where natural):"];
    for (const t of unresolved) {
      const statusLabel = t.status === "partially_addressed" ? " [partially addressed]" : "";
      // Include actual target ID so judge's upstream_target_assessment can reference it
      lines.push(`  [${t.id}] (from ${t.source_module}) ${t.target}${statusLabel}`);
      if (t.current_gap) lines.push(`     Gap: ${t.current_gap}`);
      if (t.suggestion) lines.push(`     Suggestion: ${t.suggestion}`);
      if (t.best_module_to_address) lines.push(`     Best addressed by: ${t.best_module_to_address}`);
      if (t.notes) lines.push(`     Opportunity: ${t.notes}`);
    }

    return lines.join("\n");
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
  private formatPriorTurnsCompact(turns: PlotTurn[]): string {
    if (turns.length === 0) return "(No conversation yet)";

    const lines: string[] = [];
    for (const turn of turns) {
      const parts: string[] = [];
      parts.push(`[Turn ${turn.turnNumber}]`);
      if (turn.clarifierResponse.plot_focus) {
        parts.push(`  Focus: ${turn.clarifierResponse.plot_focus}`);
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

  private formatPriorTurns(turns: PlotTurn[]): string {
    if (turns.length === 0) return "(No conversation yet)";

    const RECENT_WINDOW = turns.length <= 3 ? 2 : 1;
    const recentStart = Math.max(0, turns.length - RECENT_WINDOW);

    const lines: string[] = [];

    // Older turns: compressed
    for (let i = 0; i < recentStart; i++) {
      const turn = turns[i];
      const parts: string[] = [];
      parts.push(`[Turn ${turn.turnNumber}] (summary)`);
      if (turn.clarifierResponse.plot_focus) {
        parts.push(`  Focus: ${turn.clarifierResponse.plot_focus}`);
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

      // Include hypothesis_line in compressed turns (shows evolving plot read)
      if (turn.clarifierResponse.hypothesis_line) {
        parts.push(`  Plot read: "${turn.clarifierResponse.hypothesis_line}"`);
      }

      lines.push(parts.join("\n"));
    }

    // Recent turns: full detail
    for (let i = recentStart; i < turns.length; i++) {
      const turn = turns[i];
      const parts: string[] = [];
      parts.push(`[Turn ${turn.turnNumber}]`);
      if (turn.clarifierResponse.plot_focus) {
        parts.push(`  Focus: ${turn.clarifierResponse.plot_focus}`);
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

  private formatLedgerForPrompt(ledger: PlotLedgerEntry[], compress = true): string {
    if (!ledger || ledger.length === 0) return "(No constraints established yet)";

    const confirmed = ledger.filter((e) => e.confidence === "confirmed");
    const inferred = ledger.filter((e) => e.confidence === "inferred");
    const imported = ledger.filter((e) => e.confidence === "imported");

    const lines: string[] = [];

    // Clean key for display — strip module prefixes that are just noise
    const cleanKey = (key: string) => key.replace(/^(hook|char|world|plot)\./, "");

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
    session: PlotSessionState,
    responses: PlotAssumptionResponse[],
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
      const ledgerKey = `plot.${resp.category}.${resp.assumptionId}`;

      const existingIdx = ledger.findIndex((e) => e.key === ledgerKey);

      const entry: PlotLedgerEntry = {
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

  private updatePsychologyHeuristics(session: PlotSessionState): void {
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
    session: PlotSessionState,
    stage: PlotPromptHistoryEntry["stage"],
    defaultSystem: string,
    defaultUser: string,
    overrides?: PlotPromptOverrides,
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
