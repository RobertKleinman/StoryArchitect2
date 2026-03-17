/**
 * SCENE MODULE SERVICE
 * ════════════════════════════════════════
 * Module #6: Hook → Character → CharacterImage → World → Plot → Scene
 *
 * Three-phase flow:
 *   Phase 0: PLANNING — cluster beats into scenes, user confirms shape
 *   Phase 1: CLARIFICATION — per-scene steering (selective, adaptive)
 *   Phase 2: BUILDING — background VN writing + minor judge + retroactive review
 *   Phase 3: REVIEW — user reads unfinished product
 *   Phase 4: FINAL JUDGE — intensive full-work assessment
 */

import type {
  SceneSessionState,
  ScenePack,
  ScenePlan,
  ScenePlannerOutput,
  NarrativePreview,
  SceneClarifierResponse,
  SceneBuilderOutput,
  SceneMinorJudgeOutput,
  FinalJudgeOutput,
  ConsistencyCheckResult,
  SceneDivergenceOutput,
  SceneRhythmSnapshot,
  BuiltScene,
  ReadableScene,
  SceneLedgerEntry,
  SceneDevelopmentTarget,
  ScenePlanningTurn,
  SceneWritingTurn,
  ScenePromptOverrides,
  SceneStagingState,
  PacingType,
  CompulsionVector,
  ClarifySceneResult,
} from "../../shared/types/scene";
import type { PlotPack, TensionBeat } from "../../shared/types/plot";
import type { CharacterPack } from "../../shared/types/character";
import type { WorldPack } from "../../shared/types/world";
import type { HookPack } from "../../shared/types/hook";
import type { UserPsychologyLedger } from "../../shared/types/userPsychology";

import { SceneStore } from "../storage/sceneStore";
import { PlotStore } from "../storage/plotStore";
import { WorldStore } from "../storage/worldStore";
import { CharacterImageStore } from "../storage/characterImageStore";
import { CharacterStore } from "../storage/characterStore";
import { ProjectStore } from "../storage/projectStore";
import { LLMClient } from "./llmClient";

import {
  createEmptyLedger,
  snapshotBaselineForNewModule,
  formatPsychologyLedgerForPrompt,
  formatSignalsForBuilderJudge,
  formatEngineDialsForPrompt,
  recordSignals,
  recordAssumptionDelta,
  updateHeuristics,
  runConsolidation,
  formatSuggestedProbeForPrompt,
  markProbeConsumed,
  ensureLedgerShape,
} from "./psychologyEngine";

import {
  SCENE_PLANNER_SYSTEM, SCENE_PLANNER_USER_TEMPLATE,
  SCENE_CLARIFIER_SYSTEM, SCENE_CLARIFIER_USER_PREFIX, SCENE_CLARIFIER_USER_DYNAMIC,
  SCENE_BUILDER_SYSTEM, SCENE_BUILDER_USER_PREFIX, SCENE_BUILDER_USER_DYNAMIC,
  SCENE_MINOR_JUDGE_SYSTEM, SCENE_MINOR_JUDGE_USER_TEMPLATE,
  SCENE_FINAL_JUDGE_SYSTEM, SCENE_FINAL_JUDGE_USER_TEMPLATE,
  SCENE_DIVERGENCE_SYSTEM, SCENE_DIVERGENCE_USER_TEMPLATE,
  SCENE_PLAN_CLARIFIER_SYSTEM, SCENE_PLAN_CLARIFIER_USER_PREFIX, SCENE_PLAN_CLARIFIER_USER_SUFFIX,
} from "./scenePrompts";

import {
  SCENE_PLANNER_SCHEMA,
  SCENE_CLARIFIER_SCHEMA,
  SCENE_BUILDER_SCHEMA,
  SCENE_MINOR_JUDGE_SCHEMA,
  SCENE_FINAL_JUDGE_SCHEMA,
  SCENE_DIVERGENCE_SCHEMA,
} from "./sceneSchemas";
import { culturalResearchService } from "./runtime";
import { detectDirectedReferences, shouldRunCulturalResearch } from "./culturalResearchService";
import type { CulturalResearchContext } from "./culturalResearchService";
import { buildMustHonorBlock, normalizeStringifiedFields } from "./mustHonorBlock";
import { logPromptBlocks } from "./contextObservability";

// ─── Error class ───

export class SceneServiceError extends Error {
  code: "NOT_FOUND" | "INVALID_INPUT" | "LLM_PARSE_ERROR" | "LLM_CALL_FAILED";

  constructor(
    code: "NOT_FOUND" | "INVALID_INPUT" | "LLM_PARSE_ERROR" | "LLM_CALL_FAILED",
    message: string
  ) {
    super(message);
    this.code = code;
    this.name = "SceneServiceError";
  }
}

// ─── Service ───

export class SceneService {
  // OPTIMIZATION: Cache for divergence exploration results, keyed by sceneIndex:stagingState hash
  private divergenceCache = new Map<string, SceneDivergenceOutput>();

  constructor(
    private sceneStore: SceneStore,
    private plotStore: PlotStore,
    private worldStore: WorldStore,
    private charImageStore: CharacterImageStore,
    private charStore: CharacterStore,
    private hookStore: ProjectStore,
    private llm: LLMClient,
  ) {}

  // ═══════════════════════════════════════════════════════════════
  // Phase 0: PLANNING — cluster beats into scenes
  // ═══════════════════════════════════════════════════════════════

  async initPlan(
    projectId: string,
    plotProjectId: string,
    modelOverride?: string,
    promptOverrides?: ScenePromptOverrides,
  ): Promise<{ planner: ScenePlannerOutput; clarifier: SceneClarifierResponse; turnNumber: number }> {
    // Load all upstream exports
    const plotExport = await this.plotStore.getExport(plotProjectId);
    if (!plotExport || !plotExport.plotPack) {
      throw new SceneServiceError("NOT_FOUND", "Plot export not found — lock the plot module first");
    }
    const plotPack = plotExport.plotPack;

    // Resolve upstream chain
    const worldProjectId = plotExport.worldProjectId;
    const characterProjectId = plotExport.characterProjectId;
    const characterImageProjectId = plotExport.characterImageProjectId;
    const hookProjectId = plotExport.hookProjectId;

    const [worldExport, charExport, hookExport] = await Promise.all([
      this.worldStore.getExport(worldProjectId),
      this.charStore.getExport(characterProjectId),
      this.hookStore.getExport(hookProjectId),
    ]);

    if (!charExport?.characterPack) throw new SceneServiceError("NOT_FOUND", "Character export not found");
    if (!hookExport?.hookPack) throw new SceneServiceError("NOT_FOUND", "Hook export not found");

    const sourceCharacterPack = charExport.characterPack;
    const sourceWorldPack = worldExport?.worldPack ?? null;
    const sourceHookPack = hookExport.hookPack;
    if (!sourceHookPack) throw new SceneServiceError("NOT_FOUND", "Hook pack not found in export");

    // Load character image pack if available
    let sourceCharacterImagePack: any = undefined;
    if (characterImageProjectId) {
      const charImageExport = await this.charImageStore.getExport(characterImageProjectId);
      if (charImageExport?.characterImagePack) {
        sourceCharacterImagePack = charImageExport.characterImagePack;
      }
    }

    // Import psychology ledger (cascade: plot > world > charImage > char > hook)
    let importedPsychLedger = createEmptyLedger();
    const psychSource = plotPack.psychologyLedger
      ?? sourceWorldPack?.psychologyLedger
      ?? sourceCharacterImagePack?.psychologyLedger
      ?? sourceCharacterPack.psychologyLedger
      ?? sourceHookPack.psychologyLedger;
    if (psychSource) {
      importedPsychLedger = ensureLedgerShape(JSON.parse(JSON.stringify(psychSource)));
    }
    snapshotBaselineForNewModule(importedPsychLedger);

    // Import constraint ledger from plot
    const importedLedger: SceneLedgerEntry[] = [];
    if (plotExport.constraintLedger) {
      for (const entry of plotExport.constraintLedger) {
        importedLedger.push({
          key: `plot.${entry.key}`,
          value: entry.value,
          source: "plot_imported",
          confidence: "imported",
          turnNumber: 0,
        });
      }
    }

    // Import development targets
    const devTargets: SceneDevelopmentTarget[] = [];
    if (plotPack.development_targets) {
      for (const t of plotPack.development_targets) {
        devTargets.push({ ...t, source_module: t.source_module as any });
      }
    }
    if (plotPack.weaknesses) {
      for (const w of plotPack.weaknesses) {
        devTargets.push({
          id: `plot_weakness_${devTargets.length}`,
          source_module: "plot",
          target: `${w.area}: ${w.weakness}`,
          status: "unaddressed",
          notes: w.development_opportunity,
        });
      }
    }

    // Build planner prompt
    const plannerUser = this.buildPlannerUserPrompt(plotPack, sourceCharacterPack, sourceWorldPack, sourceHookPack, importedPsychLedger);
    const plannerSystem = promptOverrides?.system ?? SCENE_PLANNER_SYSTEM;
    const plannerUserFinal = promptOverrides?.user ?? plannerUser;

    // Call planner LLM
    let plannerRaw: string;
    try {
      plannerRaw = await this.llm.call("scene_planner", plannerSystem, plannerUserFinal, {
        temperature: 0.7,
        maxTokens: 32000,
        modelOverride,
        jsonSchema: SCENE_PLANNER_SCHEMA,
      });
    } catch (err) {
      console.error("SCENE PLANNER LLM ERROR:", err);
      throw new SceneServiceError("LLM_CALL_FAILED", "Scene planner call failed");
    }

    const plannerOutput = this.parseAndValidate<ScenePlannerOutput>(plannerRaw, [
      "narrative_preview", "scenes", "clustering_rationale",
    ]);
    if (!plannerOutput) {
      throw new SceneServiceError("LLM_PARSE_ERROR", "Failed to parse scene planner response");
    }

    // Build initial clarifier response for the plan
    const planClarifier = this.buildInitialPlanClarifier(plannerOutput, importedPsychLedger);

    // Create session
    const session: SceneSessionState = {
      projectId,
      plotProjectId,
      worldProjectId,
      characterProjectId,
      characterImageProjectId,
      hookProjectId,
      sourcePlotPack: plotPack,
      sourceWorldPack: sourceWorldPack as WorldPack,
      sourceCharacterPack,
      sourceCharacterImagePack,
      sourceHookPack,
      narrativePreview: plannerOutput.narrative_preview,
      scenePlan: plannerOutput.scenes,
      scenePlanConfirmed: false,
      planningTurns: [{
        turnNumber: 1,
        phase: "planning",
        clarifierResponse: planClarifier,
        userSelection: null,
      }],
      currentSceneIndex: 0,
      writingTurns: [],
      builtScenes: [],
      sceneDivergenceResults: {},
      sceneStagingStates: {},
      constraintLedger: importedLedger,
      developmentTargets: devTargets,
      status: "planning",
      psychologyLedger: importedPsychLedger,
      promptHistory: [],
      lastSavedAt: new Date().toISOString(),
    };

    this.recordPromptHistory(session, "planner", SCENE_PLANNER_SYSTEM, plannerUser, promptOverrides, `${plannerOutput.scenes.length} scenes planned`);

    await this.sceneStore.save(session);

    return {
      planner: plannerOutput,
      clarifier: planClarifier,
      turnNumber: 1,
    };
  }

  // ─── Plan Clarification (phase 0 follow-up turns) ───

  async clarifyPlan(
    projectId: string,
    userSelection?: { type: string; optionId?: string; label: string },
    assumptionResponses?: Array<{ assumptionId: string; action: string; originalValue: string; newValue: string }>,
    modelOverride?: string,
    promptOverrides?: ScenePromptOverrides,
  ): Promise<{ clarifier: SceneClarifierResponse; turnNumber: number; planConfirmed: boolean }> {
    const session = await this.sceneStore.get(projectId);
    if (!session) throw new SceneServiceError("NOT_FOUND", "Scene session not found");
    if (session.status !== "planning" && session.status !== "plan_clarifying") {
      throw new SceneServiceError("INVALID_INPUT", `Cannot clarify plan in status: ${session.status}`);
    }

    session.status = "plan_clarifying";

    // Record user's response to previous turn
    const lastTurn = session.planningTurns[session.planningTurns.length - 1];
    if (lastTurn && !lastTurn.userSelection && userSelection) {
      lastTurn.userSelection = userSelection as any;
      lastTurn.assumptionResponses = assumptionResponses as any;
    }

    // Update constraint ledger from assumption responses
    if (assumptionResponses) {
      for (const resp of assumptionResponses) {
        session.constraintLedger.push({
          key: `plan.${resp.assumptionId}`,
          value: resp.newValue,
          source: resp.action === "keep" ? "user_kept_assumption" : resp.action === "freeform" ? "user_freeform" : "user_changed_assumption",
          confidence: "confirmed",
          turnNumber: session.planningTurns.length + 1,
          assumptionId: resp.assumptionId,
        });
      }
    }

    // Update psychology heuristics from user interaction
    if (userSelection && session.psychologyLedger) {
      const isTyped = userSelection.type === "free_text";
      updateHeuristics(session.psychologyLedger, {
        typedCount: isTyped ? 1 : 0,
        clickedCount: isTyped ? 0 : 1,
        totalAssumptions: assumptionResponses?.length ?? 0,
        deferredAssumptions: 0,
        changedAssumptions: assumptionResponses?.filter(r => r.action !== "keep").length ?? 0,
        responseLengths: isTyped ? [userSelection.label?.length ?? 0] : [],
      });

      // Record assumption delta
      if (assumptionResponses && assumptionResponses.length > 0) {
        const offeredIds = assumptionResponses.map(r => r.assumptionId);
        const actions: Record<string, "keep" | "alternative" | "freeform"> = {};
        for (const r of assumptionResponses) {
          actions[r.assumptionId] = r.action as "keep" | "alternative" | "freeform";
        }
        recordAssumptionDelta(session.psychologyLedger, session.planningTurns.length + 1, offeredIds, offeredIds, actions);
      }
    }

    // Build plan clarifier prompt
    const planSummary = this.formatScenePlanSummary(session.scenePlan ?? []);

    // Static prefix — cacheable (narrative preview, scene plan summary don't change between turns)
    const cacheablePrefix = SCENE_PLAN_CLARIFIER_USER_PREFIX
      .replace("{{NARRATIVE_PREVIEW}}", session.narrativePreview?.trailer_text ?? "")
      .replace("{{SCENE_PLAN_SUMMARY}}", planSummary);

    // Dynamic suffix — changes each turn (psychology signals, engine dials, user feedback)
    const psychSignals = formatPsychologyLedgerForPrompt(session.psychologyLedger!);
    const engineDials = formatEngineDialsForPrompt(session.psychologyLedger!);
    const userFeedback = userSelection ? `User said: "${userSelection.label}"` : "(no feedback yet)";

    let dynamicSuffix = SCENE_PLAN_CLARIFIER_USER_SUFFIX
      .replace("{{USER_FEEDBACK}}", userFeedback)
      .replace("{{PSYCHOLOGY_SIGNALS}}", psychSignals)
      .replace("{{ENGINE_DIALS}}", engineDials);

    // ─── Cultural Intelligence Engine injection ───
    const planCulturalBrief = await this.getCulturalBrief(session, session.planningTurns.length + 1);
    const planCulturalText = culturalResearchService.formatBriefForClarifier(planCulturalBrief);
    if (planCulturalText) {
      dynamicSuffix += "\n\n" + planCulturalText;
    }

    // ─── MUST HONOR constraint reinforcement (end of prompt = highest attention) ───
    const planMustHonor = buildMustHonorBlock(session.constraintLedger ?? []);
    if (planMustHonor) {
      dynamicSuffix += "\n\n" + planMustHonor;
    }

    const system = promptOverrides?.system ?? SCENE_PLAN_CLARIFIER_SYSTEM;
    const user = promptOverrides?.user ?? (cacheablePrefix + dynamicSuffix);

    let clarifierRaw: string;
    try {
      clarifierRaw = await this.llm.call("scene_clarifier", system, user, {
        temperature: 0.7,
        maxTokens: 4000,
        modelOverride,
        jsonSchema: SCENE_CLARIFIER_SCHEMA,
        // Only use cached prefix when not using prompt overrides
        cacheableUserPrefix: promptOverrides?.user ? undefined : cacheablePrefix,
      });
    } catch (err) {
      console.error("SCENE PLAN CLARIFIER LLM ERROR:", err);
      throw new SceneServiceError("LLM_CALL_FAILED", "Scene plan clarifier call failed");
    }

    const clarifier = this.parseAndValidate<SceneClarifierResponse>(clarifierRaw, [
      "psychology_strategy", "scene_summary", "needs_input", "auto_pass_confidence",
    ]);
    if (!clarifier) {
      throw new SceneServiceError("LLM_PARSE_ERROR", "Failed to parse plan clarifier response");
    }

    // Normalize stringified JSON fields (user_read)
    normalizeStringifiedFields(clarifier as unknown as Record<string, unknown>);

    // Check if plan is confirmed (user confirmed or auto-pass confidence is very high)
    const planConfirmed = !clarifier.needs_input && clarifier.auto_pass_confidence >= 0.85;

    const turnNumber = session.planningTurns.length + 1;
    session.planningTurns.push({
      turnNumber,
      phase: "planning",
      clarifierResponse: clarifier,
      userSelection: null,
    });

    if (planConfirmed) {
      session.scenePlanConfirmed = true;
      session.status = "plan_confirmed";
    }

    this.recordPromptHistory(session, "plan_clarifier", system, user, promptOverrides, planConfirmed ? "plan confirmed" : "steering");
    session.lastSavedAt = new Date().toISOString();
    await this.sceneStore.save(session);

    // Record signals from clarifier
    if (clarifier.user_read && session.psychologyLedger) {
      recordSignals(
        session.psychologyLedger,
        turnNumber,
        "scene",
        clarifier.user_read.signals ?? [],
        clarifier.user_read.behaviorSummary,
        clarifier.user_read.adaptationPlan,
      );

      // Run background consolidation (non-blocking, throttled)
      // Only consolidate on meaningful change
      const shouldConsolidate =
        (userSelection?.type === "free_text") ||
        (assumptionResponses?.some(r => r.action !== "keep")) ||
        (turnNumber % 5 === 0) ||
        ((session.psychologyLedger.signalStore?.length ?? 0) - (session.psychologyLedger.signalCountAtLastConsolidation ?? 0) >= 5);

      if (shouldConsolidate) {
        const bgProjId = session.projectId;
        const ledgerCopy = JSON.parse(JSON.stringify(session.psychologyLedger));
        runConsolidation(ledgerCopy, turnNumber, "scene", this.llm)
          .then(async () => {
            const fresh = await this.sceneStore.get(bgProjId);
            if (fresh) {
              fresh.psychologyLedger = ledgerCopy;
              await this.sceneStore.save(fresh);
            }
          })
          .catch(err => console.error("SCENE PLAN CONSOLIDATION ERROR (non-fatal):", err));
      }

      // ─── Cultural Intelligence Engine: background research ───
      if (shouldRunCulturalResearch({ turnNumber, userSelection: userSelection ?? null, hasCachedBrief: false })) {
        this.fireBackgroundCulturalResearch(session, turnNumber).catch(err =>
          console.error("SCENE PLAN CULTURAL RESEARCH ERROR (non-fatal):", err)
        );
      }

      await this.sceneStore.save(session);
    }

    return { clarifier, turnNumber, planConfirmed };
  }

  // ─── Confirm Plan (explicit user confirmation) ───

  async confirmPlan(projectId: string): Promise<{ confirmed: true; totalScenes: number }> {
    const session = await this.sceneStore.get(projectId);
    if (!session) throw new SceneServiceError("NOT_FOUND", "Scene session not found");

    session.scenePlanConfirmed = true;
    session.status = "plan_confirmed";
    session.lastSavedAt = new Date().toISOString();
    await this.sceneStore.save(session);

    return { confirmed: true, totalScenes: session.scenePlan?.length ?? 0 };
  }

  // ═══════════════════════════════════════════════════════════════
  // Phase 1: PER-SCENE CLARIFICATION (selective)
  // ═══════════════════════════════════════════════════════════════

  async clarifyScene(
    projectId: string,
    userSelection?: { type: string; optionId?: string; label: string },
    assumptionResponses?: Array<{ assumptionId: string; action: string; originalValue: string; newValue: string }>,
    modelOverride?: string,
    promptOverrides?: ScenePromptOverrides,
  ): Promise<ClarifySceneResult> {
    const session = await this.sceneStore.get(projectId);
    if (!session) throw new SceneServiceError("NOT_FOUND", "Scene session not found");
    if (!session.scenePlanConfirmed || !session.scenePlan) {
      throw new SceneServiceError("INVALID_INPUT", "Scene plan must be confirmed before clarifying scenes");
    }
    if (session.status !== "plan_confirmed" && session.status !== "writing") {
      throw new SceneServiceError("INVALID_INPUT", `Cannot clarify scene in status: ${session.status}`);
    }

    session.status = "writing";
    const sceneIndex = session.currentSceneIndex;
    const totalScenes = session.scenePlan.length;

    if (sceneIndex >= totalScenes) {
      throw new SceneServiceError("INVALID_INPUT", "All scenes have been clarified");
    }

    const scenePlan = session.scenePlan[sceneIndex];

    // Record previous scene turn's user selection
    if (userSelection && session.writingTurns.length > 0) {
      const lastTurn = session.writingTurns[session.writingTurns.length - 1];
      if (!lastTurn.userSelection) {
        lastTurn.userSelection = userSelection as any;
        lastTurn.assumptionResponses = assumptionResponses as any;
      }
    }

    // Record assumption responses in ledger
    if (assumptionResponses) {
      for (const resp of assumptionResponses) {
        session.constraintLedger.push({
          key: `${scenePlan.scene_id}.${resp.assumptionId}`,
          value: resp.newValue,
          source: resp.action === "keep" ? "user_kept_assumption" : "user_freeform",
          confidence: "confirmed",
          turnNumber: session.writingTurns.length + 1,
          sceneId: scenePlan.scene_id,
          assumptionId: resp.assumptionId,
        });
      }
    }

    // Update heuristics
    if (userSelection && session.psychologyLedger) {
      const isTyped = userSelection.type === "free_text";
      updateHeuristics(session.psychologyLedger, {
        typedCount: isTyped ? 1 : 0,
        clickedCount: isTyped ? 0 : 1,
        totalAssumptions: assumptionResponses?.length ?? 0,
        deferredAssumptions: 0,
        changedAssumptions: assumptionResponses?.filter(r => r.action !== "keep").length ?? 0,
        responseLengths: isTyped ? [userSelection.label?.length ?? 0] : [],
      });

      // Record assumption delta
      if (assumptionResponses && assumptionResponses.length > 0) {
        const offeredIds = assumptionResponses.map(r => r.assumptionId);
        const actions: Record<string, "keep" | "alternative" | "freeform"> = {};
        for (const r of assumptionResponses) {
          actions[r.assumptionId] = r.action as "keep" | "alternative" | "freeform";
        }
        recordAssumptionDelta(session.psychologyLedger, session.writingTurns.length + 1, offeredIds, offeredIds, actions);
      }
    }

    // Get rhythm snapshot
    const rhythmSnapshot = this.computeRhythmSnapshot(session);

    // Check for previously completed background divergence results for this scene
    let divergenceResult: SceneDivergenceOutput | null =
      session.sceneDivergenceResults[scenePlan.scene_id] ?? null;

    // Fire divergence in the background (non-blocking) for this scene if needed
    // Results will be available on the *next* clarifier turn or when building
    if (this.shouldRunDivergence(session, scenePlan, sceneIndex, totalScenes) && !divergenceResult) {
      // Capture projectId and sceneId for the background closure — do NOT reference the
      // mutable `session` object to avoid race conditions with the main flow saving.
      const bgProjectId = session.projectId;
      const bgSceneId = scenePlan.scene_id;
      this.runSceneDivergence(session, scenePlan, modelOverride)
        .then(async (result) => {
          if (result) {
            // Re-fetch the latest session to avoid overwriting main-flow changes
            const freshSession = await this.sceneStore.get(bgProjectId);
            if (freshSession) {
              freshSession.sceneDivergenceResults[bgSceneId] = result;
              await this.sceneStore.save(freshSession);
            }
          }
        })
        .catch(err => console.error("SCENE DIVERGENCE ERROR (non-fatal, background):", err));
      console.log(`[SCENE OPT] Divergence fired in background for scene ${scenePlan.scene_id}`);
    } else if (!this.shouldRunDivergence(session, scenePlan, sceneIndex, totalScenes)) {
      console.log(`[SCENE OPT] Skipping divergence for scene ${scenePlan.scene_id} (low-risk)`);
    }

    // Build clarifier prompt
    const previousScene = sceneIndex > 0 ? session.builtScenes[sceneIndex - 1] : null;
    const previousSummary = previousScene
      ? `Scene "${previousScene.plan.title}": ${previousScene.builder_output.readable.screenplay_text.slice(0, 500)}...`
      : "(first scene — no previous)";

    const divergenceText = divergenceResult?.worth_asking
      ? JSON.stringify(divergenceResult.alternatives)
      : "(no staging alternatives worth asking about)";

    // Static prefix — cacheable (scene plan, previous scene summary, rhythm snapshot don't change within a scene clarifier turn)
    const cacheablePrefix = SCENE_CLARIFIER_USER_PREFIX
      .replace("{{SCENE_PLAN_JSON}}", JSON.stringify(scenePlan))
      .replace("{{PREVIOUS_SCENE_SUMMARY}}", previousSummary)
      .replace("{{RHYTHM_SNAPSHOT}}", JSON.stringify(rhythmSnapshot))
      .replace("{{DIVERGENCE_ALTERNATIVES}}", divergenceText)
      .replace("{{SCENE_INDEX}}", String(sceneIndex + 1))
      .replace("{{TOTAL_SCENES}}", String(totalScenes));

    // Dynamic suffix — changes (psychology signals, engine dials, constraint ledger, prior turns)
    const psychSignals = formatPsychologyLedgerForPrompt(session.psychologyLedger!);
    const engineDials = formatEngineDialsForPrompt(session.psychologyLedger!);
    const ledgerText = this.formatLedger(session.constraintLedger);
    const priorTurns = this.formatPriorTurns(session.planningTurns, session.writingTurns);

    let dynamicSuffix = SCENE_CLARIFIER_USER_DYNAMIC
      .replace("{{CONSTRAINT_LEDGER}}", ledgerText)
      .replace("{{PSYCHOLOGY_SIGNALS}}", psychSignals)
      .replace("{{ENGINE_DIALS}}", engineDials)
      .replace("{{PRIOR_TURNS}}", priorTurns);

    // ─── Cultural Intelligence Engine injection ───
    const sceneCulturalBrief = await this.getCulturalBrief(session, session.writingTurns.length + 1);
    const sceneCulturalText = culturalResearchService.formatBriefForClarifier(sceneCulturalBrief);
    if (sceneCulturalText) {
      dynamicSuffix += "\n\n" + sceneCulturalText;
    }

    // ─── MUST HONOR constraint reinforcement (end of prompt = highest attention) ───
    const sceneMustHonor = buildMustHonorBlock(session.constraintLedger ?? []);
    if (sceneMustHonor) {
      dynamicSuffix += "\n\n" + sceneMustHonor;
    }

    const system = promptOverrides?.system ?? SCENE_CLARIFIER_SYSTEM;
    const user = promptOverrides?.user ?? (cacheablePrefix + dynamicSuffix);

    let clarifierRaw: string;
    try {
      clarifierRaw = await this.llm.call("scene_clarifier", system, user, {
        temperature: 0.7,
        maxTokens: 4000,
        modelOverride,
        jsonSchema: SCENE_CLARIFIER_SCHEMA,
        // Only use cached prefix when not using prompt overrides
        cacheableUserPrefix: promptOverrides?.user ? undefined : cacheablePrefix,
      });
    } catch (err) {
      console.error("SCENE CLARIFIER LLM ERROR:", err);
      throw new SceneServiceError("LLM_CALL_FAILED", "Scene clarifier call failed");
    }

    const clarifier = this.parseAndValidate<SceneClarifierResponse>(clarifierRaw, [
      "psychology_strategy", "scene_summary", "needs_input", "auto_pass_confidence",
    ]);
    if (!clarifier) {
      throw new SceneServiceError("LLM_PARSE_ERROR", "Failed to parse scene clarifier response");
    }

    // Normalize stringified JSON fields (user_read)
    normalizeStringifiedFields(clarifier as unknown as Record<string, unknown>);

    // Auto-pass requires BOTH: LLM says no input needed AND confidence >= threshold
    // Turning-point scenes require higher confidence; non-turning-point scenes pass more easily
    const AUTO_PASS_THRESHOLD = scenePlan.turning_point_ref ? 0.85 : 0.70;
    const autoPassApplied = !clarifier.needs_input && clarifier.auto_pass_confidence >= AUTO_PASS_THRESHOLD;
    const turnNumber = session.writingTurns.length + 1;

    session.writingTurns.push({
      turnNumber,
      phase: "scene_clarify",
      sceneId: scenePlan.scene_id,
      clarifierResponse: clarifier,
      userSelection: autoPassApplied ? { type: "auto_pass", label: "(auto-passed)" } : null,
    });

    // Build effective scene plan with user steering merged in
    if (!session.sceneStagingStates) session.sceneStagingStates = {};
    const stagingState: SceneStagingState = session.sceneStagingStates[scenePlan.scene_id] ?? {
      scene_id: scenePlan.scene_id,
      assumption_overrides: {},
      effective_plan: { ...scenePlan },
      resolved: false,
    };

    // Merge user steering into effective plan
    if (userSelection) {
      stagingState.user_selection = userSelection;
    }
    if (assumptionResponses) {
      for (const resp of assumptionResponses) {
        stagingState.assumption_overrides[resp.assumptionId] = resp.newValue;
      }
    }
    if (divergenceResult?.worth_asking && userSelection?.optionId) {
      const chosenAlt = divergenceResult.alternatives.find((_, i) => String.fromCharCode(65 + i) === userSelection.optionId);
      if (chosenAlt) {
        stagingState.divergence_choice = chosenAlt.label;
      }
    }

    // Materialize effective plan: start with canonical, overlay steering
    const effectivePlan = { ...scenePlan };
    // Apply user direction as staging notes that the builder will consume
    const steeringDirections: string[] = [];
    if (stagingState.user_selection?.type === "free_text" && stagingState.user_selection.label) {
      steeringDirections.push(`User direction: "${stagingState.user_selection.label}"`);
    }
    if (stagingState.user_selection?.type === "option" && stagingState.user_selection.label) {
      steeringDirections.push(`User chose: "${stagingState.user_selection.label}"`);
    }
    if (stagingState.divergence_choice) {
      steeringDirections.push(`Staging alternative selected: "${stagingState.divergence_choice}"`);
    }
    for (const [key, val] of Object.entries(stagingState.assumption_overrides)) {
      steeringDirections.push(`Assumption override [${key}]: "${val}"`);
    }
    if (steeringDirections.length > 0) {
      effectivePlan.user_steering = steeringDirections.join("\n");
    }
    stagingState.effective_plan = effectivePlan;
    stagingState.resolved = autoPassApplied || (!!userSelection);
    session.sceneStagingStates[scenePlan.scene_id] = stagingState;

    // OPTIMIZATION: Invalidate divergence cache when staging changes
    if (userSelection || assumptionResponses || divergenceResult) {
      const oldKey = this.divergenceCacheKey(sceneIndex, undefined);
      this.divergenceCache.delete(oldKey);
      console.log(`[DIVERGENCE CACHE] Invalidated for scene ${sceneIndex} due to staging change`);
    }

    session.rhythmSnapshot = rhythmSnapshot;
    this.recordPromptHistory(session, "scene_clarifier", system, user, promptOverrides, `scene ${scenePlan.scene_id} ${autoPassApplied ? "(auto-pass)" : ""}`);

    // Record psychology signals
    if (clarifier.user_read && session.psychologyLedger) {
      recordSignals(
        session.psychologyLedger,
        turnNumber,
        "scene",
        clarifier.user_read.signals ?? [],
        clarifier.user_read.behaviorSummary,
        clarifier.user_read.adaptationPlan,
      );

      // Run background consolidation (non-blocking, throttled)
      // Only consolidate on meaningful change
      const shouldConsolidateScene =
        (userSelection?.type === "free_text") ||
        (assumptionResponses?.some(r => r.action !== "keep")) ||
        (turnNumber % 5 === 0) ||
        ((session.psychologyLedger.signalStore?.length ?? 0) - (session.psychologyLedger.signalCountAtLastConsolidation ?? 0) >= 5);

      if (shouldConsolidateScene) {
        const bgProjId = session.projectId;
        const ledgerCopy = JSON.parse(JSON.stringify(session.psychologyLedger));
        runConsolidation(ledgerCopy, turnNumber, "scene", this.llm)
          .then(async () => {
            const fresh = await this.sceneStore.get(bgProjId);
            if (fresh) {
              fresh.psychologyLedger = ledgerCopy;
              await this.sceneStore.save(fresh);
            }
          })
          .catch(err => console.error("SCENE CONSOLIDATION ERROR (non-fatal):", err));
      }

      // ─── Cultural Intelligence Engine: background research ───
      if (shouldRunCulturalResearch({ turnNumber, userSelection: userSelection ?? null, hasCachedBrief: false })) {
        this.fireBackgroundCulturalResearch(session, turnNumber).catch(err =>
          console.error("SCENE CULTURAL RESEARCH ERROR (non-fatal):", err)
        );
      }
    }

    session.lastSavedAt = new Date().toISOString();
    await this.sceneStore.save(session);

    // OPTIMIZATION: When auto-pass fires, immediately build the scene in the same call
    // This eliminates an HTTP round-trip for scenes that don't need user input
    let autoBuiltScene: BuiltScene | null = null;
    if (autoPassApplied) {
      try {
        console.log(`[SCENE OPT] Auto-pass pipeline: building scene ${scenePlan.scene_id} immediately`);
        autoBuiltScene = await this.buildScene(projectId, modelOverride, promptOverrides ? { builder: promptOverrides } : undefined);
      } catch (err) {
        // Non-fatal: if the auto-build fails, the frontend can still trigger it manually
        console.error(`[SCENE OPT] Auto-build failed for ${scenePlan.scene_id} (non-fatal):`, err);
      }
    }

    return {
      clarifier,
      sceneId: scenePlan.scene_id,
      sceneIndex,
      totalScenes,
      autoPassApplied,
      autoBuiltScene,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // Phase 2: BACKGROUND BUILDING
  // ═══════════════════════════════════════════════════════════════

  async buildScene(
    projectId: string,
    modelOverride?: string,
    promptOverrides?: { builder?: ScenePromptOverrides; judge?: ScenePromptOverrides },
  ): Promise<BuiltScene> {
    const session = await this.sceneStore.get(projectId);
    if (!session) throw new SceneServiceError("NOT_FOUND", "Scene session not found");
    if (session.status !== "writing") {
      throw new SceneServiceError("INVALID_INPUT", `Cannot build scene in status: ${session.status}`);
    }

    const sceneIndex = session.currentSceneIndex;
    const canonicalPlan = session.scenePlan![sceneIndex];

    // Check staging state — if user explicitly called build, treat as implicit acceptance
    const staging = session.sceneStagingStates?.[canonicalPlan.scene_id];
    if (staging && !staging.resolved) {
      // User clicked "Build" without submitting steering — this IS acceptance of defaults
      staging.resolved = true;
      console.log(`[SCENE] Implicitly resolving clarifier for scene "${canonicalPlan.scene_id}" — user triggered build directly`);
    }

    // Use effective plan (with user steering merged in) if available, else canonical
    const scenePlan = staging?.effective_plan ?? canonicalPlan;
    const rhythmSnapshot = session.rhythmSnapshot ?? this.computeRhythmSnapshot(session);

    // Build the scene with effective plan (includes user_steering field)
    const builderOutput = await this.runBuilder(session, scenePlan, rhythmSnapshot, modelOverride, promptOverrides?.builder);

    // Run minor judge
    let minorJudge: SceneMinorJudgeOutput | null = null;
    if (this.shouldRunMinorJudge(session, scenePlan, sceneIndex)) {
      try {
        minorJudge = await this.runMinorJudge(session, scenePlan, builderOutput, sceneIndex, modelOverride, promptOverrides?.judge);
      } catch (err) {
        console.error("SCENE MINOR JUDGE ERROR (non-fatal):", err);
      }
    } else {
      console.log(`[SCENE OPT] Skipping minor judge for scene ${scenePlan.scene_id} (auto-passed, low-risk)`);
    }

    // Check retroactive consistency
    const retroactiveFlags: BuiltScene["retroactive_flags"] = [];
    if (sceneIndex > 0 && minorJudge?.consistency?.issues) {
      for (const issue of minorJudge.consistency.issues) {
        if (issue.affects_scene && issue.affects_scene !== scenePlan.scene_id) {
          retroactiveFlags.push({
            affects_scene_id: issue.affects_scene,
            issue: issue.description,
            severity: issue.severity,
          });
        }
      }
    }

    const builtScene: BuiltScene = {
      scene_id: scenePlan.scene_id,
      plan: scenePlan,
      builder_output: builderOutput,
      minor_judge: minorJudge,
      consistency_check: minorJudge?.consistency ?? null,
      retroactive_flags: retroactiveFlags,
      built_at: new Date().toISOString(),
      provenance: this.llm.lastCallProvenance ? { ...this.llm.lastCallProvenance, sourceTurn: session.writingTurns.length } : undefined,
    };

    session.builtScenes.push(builtScene);
    session.currentSceneIndex++;

    // Check if all scenes are built
    if (session.currentSceneIndex >= session.scenePlan!.length) {
      session.status = "reviewing";
    }

    session.lastSavedAt = new Date().toISOString();
    await this.sceneStore.save(session);

    return builtScene;
  }

  // ═══════════════════════════════════════════════════════════════
  // Phase 4: FINAL JUDGE
  // ═══════════════════════════════════════════════════════════════

  async runFinalJudge(
    projectId: string,
    modelOverride?: string,
    promptOverrides?: ScenePromptOverrides,
  ): Promise<FinalJudgeOutput> {
    const session = await this.sceneStore.get(projectId);
    if (!session) throw new SceneServiceError("NOT_FOUND", "Scene session not found");
    if (session.status !== "reviewing") {
      throw new SceneServiceError("INVALID_INPUT", `Cannot run final judge in status: ${session.status}`);
    }

    session.status = "final_judging";
    await this.sceneStore.save(session);

    // OPTIMIZATION: Use scene digests instead of full screenplay text to reduce token usage
    const allScenesJson = JSON.stringify(session.builtScenes.map(s => this.createSceneDigest(s)));

    const allPlansJson = JSON.stringify(session.scenePlan);
    const plotPack = session.sourcePlotPack;

    // OPTIMIZATION: Item 16 - For final judge, collect all unique characters from all scenes
    const allCharactersInvolved = new Set<string>();
    if (session.scenePlan) {
      for (const scene of session.scenePlan) {
        for (const char of scene.characters_present) {
          allCharactersInvolved.add(char);
        }
      }
    }
    const relevantCharacters = this.filterCharacterProfiles(
      session.sourceCharacterPack.locked.characters,
      Array.from(allCharactersInvolved)
    );

    const system = promptOverrides?.system ?? SCENE_FINAL_JUDGE_SYSTEM;
    const user = promptOverrides?.user ?? SCENE_FINAL_JUDGE_USER_TEMPLATE
      .replace("{{ALL_SCENES_JSON}}", allScenesJson)
      .replace("{{ALL_PLANS_JSON}}", allPlansJson)
      .replace("{{TENSION_CHAIN_JSON}}", JSON.stringify(plotPack.locked.tension_chain))
      .replace("{{TURNING_POINTS_JSON}}", JSON.stringify(plotPack.locked.turning_points))
      .replace("{{MYSTERY_HOOKS_JSON}}", JSON.stringify(plotPack.locked.mystery_hooks))
      .replace("{{MOTIFS_JSON}}", JSON.stringify(plotPack.locked.motifs))
      .replace("{{THEME_JSON}}", JSON.stringify(plotPack.locked.theme_cluster))
      .replace("{{RESOLUTION_JSON}}", JSON.stringify(plotPack.locked.resolution))
      .replace("{{CHARACTER_PROFILES_JSON}}", JSON.stringify(relevantCharacters))
      .replace("{{EMOTIONAL_PROMISE}}", session.sourceHookPack?.locked?.emotional_promise ?? "(not specified)")
      .replace("{{HOOK_SENTENCE}}", session.sourceHookPack?.locked?.hook_sentence ?? "(not specified)")
      .replace("{{PSYCHOLOGY_SIGNALS}}", formatPsychologyLedgerForPrompt(session.psychologyLedger!))
      .replace("{{TOTAL_SCENES}}", String(session.builtScenes.length))
      .replace("{{ENDING_ENERGY}}", plotPack.locked.resolution.ending_energy);

    let judgeRaw: string;
    try {
      judgeRaw = await this.llm.call("scene_final_judge", system, user, {
        temperature: 0.3,
        maxTokens: 8000,
        modelOverride,
        jsonSchema: SCENE_FINAL_JUDGE_SCHEMA,
        truncationMode: "critical",
      });
    } catch (err) {
      console.error("SCENE FINAL JUDGE LLM ERROR:", err);
      session.status = "reviewing";
      await this.sceneStore.save(session);
      throw new SceneServiceError("LLM_CALL_FAILED", "Scene final judge call failed");
    }

    const judge = this.parseAndValidate<FinalJudgeOutput>(judgeRaw, ["pass", "scores", "flagged_scenes", "overall_note"]);
    if (!judge) {
      session.status = "reviewing";
      await this.sceneStore.save(session);
      throw new SceneServiceError("LLM_PARSE_ERROR", "Failed to parse final judge response");
    }

    // Override LLM's pass decision with severity-based + class-aware gate:
    // Fail if: any must_fix, OR 2+ should_fix in structural classes (continuity/structural/emotional/logic)
    const allIssues = [
      ...(judge.flagged_scenes ?? []),
      ...(judge.arc_issues ?? []),
    ];
    const mustFixCount = allIssues.filter(i => i.severity === "must_fix").length;
    const structuralClasses = new Set(["continuity", "structural", "emotional", "logic"]);
    // Default missing issue_class to "structural" (conservative — old data without class gets counted)
    const structuralShouldFixCount = allIssues.filter(
      i => i.severity === "should_fix" && structuralClasses.has(i.issue_class ?? "structural"),
    ).length;
    if (mustFixCount > 0 || structuralShouldFixCount >= 2) {
      if (judge.pass) {
        console.log(
          `[SCENE] Judge gate override: LLM said pass=true but found ${mustFixCount} must_fix, ${structuralShouldFixCount} structural should_fix — forcing fail`,
        );
      }
      judge.pass = false;
    }

    session.finalJudge = judge;
    session.status = "reviewing";
    this.recordPromptHistory(session, "final_judge", system, user, promptOverrides, judge.pass ? "PASS" : "FAIL");
    session.lastSavedAt = new Date().toISOString();
    await this.sceneStore.save(session);

    return judge;
  }

  // ═══════════════════════════════════════════════════════════════
  // COMPLETE — package final ScenePack
  // ═══════════════════════════════════════════════════════════════

  async complete(projectId: string): Promise<ScenePack> {
    const session = await this.sceneStore.get(projectId);
    if (!session) throw new SceneServiceError("NOT_FOUND", "Scene session not found");
    if (session.status !== "reviewing" && session.status !== "final_judging" && session.status !== "complete") {
      throw new SceneServiceError("INVALID_INPUT", `Cannot complete in status: ${session.status}. All scenes must be built first.`);
    }

    const autoPassedCount = session.writingTurns.filter(t => t.userSelection?.type === "auto_pass").length;
    const steeredCount = session.builtScenes.length - autoPassedCount;

    // Determine user style
    const totalTurns = session.planningTurns.length + session.writingTurns.length;
    let typedCount = 0;
    let clickedCount = 0;
    for (const turn of [...session.planningTurns, ...session.writingTurns]) {
      if (turn.userSelection?.type === "free_text") typedCount++;
      else if (turn.userSelection?.type === "option") clickedCount++;
    }
    const controlPref = typedCount > clickedCount * 2 ? "director" : clickedCount > typedCount * 2 ? "explorer" : "mixed";
    const typedVsClicked = typedCount > clickedCount * 2 ? "mostly_typed" : clickedCount > typedCount * 2 ? "mostly_clicked" : "mixed";

    const pack: ScenePack = {
      module: "scene",
      scenes: session.builtScenes,
      readable_vn: session.builtScenes.map(s => s.builder_output.readable),
      final_judge: session.finalJudge,
      scene_plan: session.scenePlan!,
      narrative_preview: session.narrativePreview!,
      preferences: {
        tone_chips: session.sourcePlotPack.preferences?.tone_chips ?? [],
        bans: session.sourcePlotPack.preferences?.bans ?? [],
      },
      development_targets: session.developmentTargets,
      user_style: {
        control_preference: controlPref as any,
        typed_vs_clicked: typedVsClicked as any,
        total_turns: totalTurns,
        auto_passed_scenes: autoPassedCount,
        steered_scenes: steeredCount,
      },
      state_summary: session.narrativePreview?.trailer_text ?? "Scene module complete.",
      plotPack_reference: { plotProjectId: session.plotProjectId },
      worldPack_reference: { worldProjectId: session.worldProjectId },
      characterImagePack_reference: session.characterImageProjectId
        ? { characterImageProjectId: session.characterImageProjectId }
        : undefined,
      characterPack_reference: { characterProjectId: session.characterProjectId },
      hookPack_reference: { hookProjectId: session.hookProjectId },
      psychologyLedger: session.psychologyLedger,
    };

    session.status = "complete";
    session.lastSavedAt = new Date().toISOString();
    await this.sceneStore.save(session);
    await this.sceneStore.saveExport(session, pack);

    return pack;
  }

  // ═══════════════════════════════════════════════════════════════
  // GENERATE ALL — skip clarification, build all scenes sequentially
  // ═══════════════════════════════════════════════════════════════

  async generateAllScenes(
    projectId: string,
    modelOverride?: string,
  ): Promise<{ builtScenes: BuiltScene[]; totalScenes: number; skippedJudgeCount: number }> {
    const session = await this.sceneStore.get(projectId);
    if (!session) throw new SceneServiceError("NOT_FOUND", "Scene session not found");

    // Phase 0 must be complete — plan must be confirmed
    if (!session.scenePlanConfirmed || !session.scenePlan) {
      throw new SceneServiceError("INVALID_INPUT", "Scene plan must be confirmed before generating all scenes. Complete Phase 0 first.");
    }

    // Allow from plan_confirmed or writing (if partially built)
    if (session.status !== "plan_confirmed" && session.status !== "writing") {
      throw new SceneServiceError("INVALID_INPUT", `Cannot generate all scenes in status: ${session.status}. Status must be plan_confirmed or writing.`);
    }

    session.status = "writing";
    await this.sceneStore.save(session);

    const totalScenes = session.scenePlan.length;
    let skippedJudgeCount = 0;

    // Iterate through remaining scenes (supports partial resume)
    while (session.currentSceneIndex < totalScenes) {
      const sceneIndex = session.currentSceneIndex;
      const scenePlan = session.scenePlan[sceneIndex];

      console.log(`[GENERATE ALL] Building scene ${sceneIndex + 1}/${totalScenes}: "${scenePlan.title}"`);

      // Create a staging state with auto-pass (skip clarification entirely)
      if (!session.sceneStagingStates) session.sceneStagingStates = {};
      const stagingState: SceneStagingState = {
        scene_id: scenePlan.scene_id,
        assumption_overrides: {},
        effective_plan: { ...scenePlan },
        resolved: true,
      };
      session.sceneStagingStates[scenePlan.scene_id] = stagingState;

      // Record a writing turn for this scene (auto-pass)
      const turnNumber = session.writingTurns.length + 1;
      session.writingTurns.push({
        turnNumber,
        phase: "scene_clarify",
        sceneId: scenePlan.scene_id,
        clarifierResponse: {
          psychology_strategy: "Generate-all mode — skipping clarification",
          scene_summary: scenePlan.purpose,
          needs_input: false,
          allow_free_text: false,
          auto_pass_confidence: 1.0,
          user_read: {
            signals: [],
            behaviorSummary: {
              orientation: "Generate-all batch mode",
              currentFocus: scenePlan.title,
              engagementMode: "converging",
              satisfaction: { score: 0.8, trend: "stable", reason: "Batch generation" },
            },
            adaptationPlan: {
              dominantNeed: "Fast batch generation",
              moves: [],
            },
          },
        },
        userSelection: { type: "auto_pass", label: "(generate-all)" },
      });

      // Compute rhythm snapshot for variety tracking
      session.rhythmSnapshot = this.computeRhythmSnapshot(session);

      // Save before building (in case of crash, we can resume)
      session.lastSavedAt = new Date().toISOString();
      await this.sceneStore.save(session);

      // Build the scene using the effective plan
      const rhythmSnapshot = session.rhythmSnapshot;
      const builderOutput = await this.runBuilder(session, scenePlan, rhythmSnapshot, modelOverride);

      // Skip minor judge for non-turning-point scenes
      let minorJudge: SceneMinorJudgeOutput | null = null;
      const isTurningPoint = !!scenePlan.turning_point_ref;
      const isLastScene = sceneIndex === totalScenes - 1;

      if (isTurningPoint || isLastScene) {
        try {
          minorJudge = await this.runMinorJudge(session, scenePlan, builderOutput, sceneIndex, modelOverride);
        } catch (err) {
          console.error(`[GENERATE ALL] Minor judge failed for scene ${scenePlan.scene_id} (non-fatal):`, err);
        }
      } else {
        skippedJudgeCount++;
        console.log(`[GENERATE ALL] Skipping minor judge for scene ${scenePlan.scene_id} (no turning_point_ref)`);
      }

      // Check retroactive consistency
      const retroactiveFlags: BuiltScene["retroactive_flags"] = [];
      if (sceneIndex > 0 && minorJudge?.consistency?.issues) {
        for (const issue of minorJudge.consistency.issues) {
          if (issue.affects_scene && issue.affects_scene !== scenePlan.scene_id) {
            retroactiveFlags.push({
              affects_scene_id: issue.affects_scene,
              issue: issue.description,
              severity: issue.severity,
            });
          }
        }
      }

      const builtScene: BuiltScene = {
        scene_id: scenePlan.scene_id,
        plan: scenePlan,
        builder_output: builderOutput,
        minor_judge: minorJudge,
        consistency_check: minorJudge?.consistency ?? null,
        retroactive_flags: retroactiveFlags,
        built_at: new Date().toISOString(),
        provenance: this.llm.lastCallProvenance ? { ...this.llm.lastCallProvenance, sourceTurn: session.writingTurns.length } : undefined,
      };

      session.builtScenes.push(builtScene);
      session.currentSceneIndex++;

      // Save after each scene (progress tracking + crash recovery)
      session.lastSavedAt = new Date().toISOString();
      await this.sceneStore.save(session);

      console.log(`[GENERATE ALL] Scene ${sceneIndex + 1}/${totalScenes} built successfully`);
    }

    // All scenes built — transition to reviewing
    session.status = "reviewing";
    session.lastSavedAt = new Date().toISOString();
    await this.sceneStore.save(session);

    console.log(`[GENERATE ALL] Complete: ${totalScenes} scenes built, ${skippedJudgeCount} judges skipped`);

    return {
      builtScenes: session.builtScenes,
      totalScenes,
      skippedJudgeCount,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // Session Management
  // ═══════════════════════════════════════════════════════════════

  async getSession(projectId: string): Promise<SceneSessionState | null> {
    return this.sceneStore.get(projectId);
  }

  async resetSession(projectId: string): Promise<void> {
    await this.sceneStore.delete(projectId);
    // Also clean up any export file
    try { await this.sceneStore.deleteExport(projectId); } catch (err) { console.warn("[SCENE] non-critical error:", err); }
  }

  // ═══════════════════════════════════════════════════════════════
  // PRIVATE — LLM call helpers
  // ═══════════════════════════════════════════════════════════════

  private async runBuilder(
    session: SceneSessionState,
    scenePlan: ScenePlan,
    rhythmSnapshot: SceneRhythmSnapshot,
    modelOverride?: string,
    promptOverrides?: ScenePromptOverrides,
  ): Promise<SceneBuilderOutput> {
    const previousScene = session.builtScenes.length > 0
      ? session.builtScenes[session.builtScenes.length - 1]
      : null;
    // OPTIMIZATION: Item 15 - Use continuity anchor from builder output for fresh continuity bridge between scenes
    const previousText = previousScene
      ? (() => {
          const parts: string[] = [];

          // Continuity anchor (primary bridge)
          if (previousScene.builder_output.continuity_anchor) {
            parts.push(previousScene.builder_output.continuity_anchor);
          } else if (previousScene.plan.continuity_anchor) {
            parts.push(previousScene.plan.continuity_anchor);
          } else {
            parts.push(`Previous scene "${previousScene.plan.title}" ended with emotion: ${previousScene.plan.emotion_arc.end}.`);
          }

          // Exit hook for forward momentum
          if (previousScene.plan.exit_hook) {
            parts.push(`Exit hook: ${previousScene.plan.exit_hook}`);
          }

          // Last 3 VN lines for voice continuity
          const vnLines = previousScene.builder_output.vn_scene?.lines;
          if (vnLines?.length) {
            const lastLines = vnLines.slice(-3).map((l: any) =>
              l.speaker === "NARRATION" ? `[${l.text?.slice(0, 80)}]` :
              l.speaker === "INTERNAL" ? `*${l.text?.slice(0, 80)}*` :
              `${l.speaker}: "${l.text?.slice(0, 80)}"`
            ).join(" → ");
            parts.push(`Last lines: ${lastLines}`);
          }

          const result = parts.join("\n");
          return result.length > 600 ? result.slice(0, 597) + "..." : result;
        })()
      : "(first scene)";

    // Get character visuals if available
    const charVisuals = session.sourceCharacterImagePack?.locked?.characters
      ? JSON.stringify(
          Object.fromEntries(
            Object.entries(session.sourceCharacterImagePack.locked.characters).map(([role, c]: [string, any]) => [
              role,
              { visual_description: c.visual_description?.full_body_description ?? "(no visual)", image_prompt: c.visual_description?.image_generation_prompt ?? "" },
            ])
          ),
        )
      : "(no character visuals available)";

    const plotPack = session.sourcePlotPack;

    // Build user steering text from effective plan
    const userSteeringText = scenePlan.user_steering ?? "(no user steering — use your best judgment)";

    // Get constraint ledger entries relevant to this scene
    const sceneConstraints = session.constraintLedger
      .filter(e => e.confidence === "confirmed" && (!e.sceneId || e.sceneId === scenePlan.scene_id))
      .map(e => `[${e.key}] ${e.value} (${e.source})`)
      .join("\n") || "(no constraints)";

    // Static prefix — cacheable (scene plan, character profiles, world summary, theme, tone chips, bans don't change)
    // OPTIMIZATION: Item 16 - Only include characters involved in this scene
    const relevantCharacters = this.filterCharacterProfiles(
      session.sourceCharacterPack.locked.characters,
      scenePlan.characters_present
    );
    // Build rich world context instead of just state_summary
    const worldContext = this.formatWorldForSceneBuilder(session);
    // Build hook context with emotional promise
    const hookContext = this.formatHookForSceneBuilder(session);
    // Get relationship tensions
    const relationshipTensions = session.sourceCharacterPack?.locked?.relationship_tensions
      ? JSON.stringify(session.sourceCharacterPack.locked.relationship_tensions)
      : "(none)";
    // Get development targets relevant to scenes
    const devTargets = (session.developmentTargets ?? [])
      .filter(t => t.status !== "addressed")
      .map(t => `[${t.id}] ${t.target}${t.current_gap ? ` (gap: ${t.current_gap})` : ""}${t.suggestion ? ` → ${t.suggestion}` : ""}`)
      .join("\n") || "(none)";

    const cacheablePrefix = SCENE_BUILDER_USER_PREFIX
      .replace("{{SCENE_PLAN_JSON}}", JSON.stringify(scenePlan))
      .replace("{{USER_STEERING}}", userSteeringText)
      .replace("{{SCENE_CONSTRAINTS}}", sceneConstraints)
      .replace("{{CHARACTER_PROFILES_JSON}}", JSON.stringify(relevantCharacters))
      .replace("{{CHARACTER_VISUALS_JSON}}", charVisuals)
      .replace("{{WORLD_SUMMARY}}", worldContext)
      .replace("{{RELATIONSHIP_TENSIONS}}", relationshipTensions)
      .replace("{{HOOK_CONTEXT}}", hookContext)
      .replace("{{DEVELOPMENT_TARGETS}}", devTargets)
      .replace("{{ACTIVE_IRONY_JSON}}", JSON.stringify(scenePlan.active_irony ?? []))
      .replace("{{ACTIVE_MYSTERY_JSON}}", JSON.stringify(scenePlan.mystery_hook_activity ?? []))
      .replace("{{MOTIF_NOTES}}", scenePlan.motif_notes ?? "(none)")
      .replace("{{THEME_JSON}}", JSON.stringify(plotPack.locked.theme_cluster))
      .replace("{{TONE_CHIPS}}", JSON.stringify(plotPack.preferences?.tone_chips ?? []))
      .replace("{{BANS}}", JSON.stringify(plotPack.preferences?.bans ?? []));

    // Dynamic suffix — changes (previous scene text, rhythm snapshot, psychology signals)
    const psychSignals = formatPsychologyLedgerForPrompt(session.psychologyLedger!);
    let dynamicSuffix = SCENE_BUILDER_USER_DYNAMIC
      .replace("{{PREVIOUS_SCENE_TEXT}}", previousText)
      .replace("{{RECENT_PACING}}", rhythmSnapshot.recent_pacing.join(", ") || "(first scene)")
      .replace("{{MONOTONY_RISK}}", String(rhythmSnapshot.monotony_risk))
      .replace("{{RHYTHM_NOTE}}", rhythmSnapshot.rhythm_note)
      .replace("{{PSYCHOLOGY_SIGNALS}}", psychSignals);

    // ─── Cultural Intelligence Engine injection ───
    const builderCulturalBrief = await this.getCulturalBriefForBuilder(session);
    const builderCulturalText = culturalResearchService.formatBriefForBuilder(builderCulturalBrief);
    if (builderCulturalText) {
      dynamicSuffix += "\n\n" + builderCulturalText;
    }

    // ─── MUST HONOR constraint reinforcement (end of prompt = highest attention) ───
    const builderMustHonor = buildMustHonorBlock(session.constraintLedger ?? []);
    if (builderMustHonor) {
      dynamicSuffix += "\n\n" + builderMustHonor;
    }

    const system = promptOverrides?.system ?? SCENE_BUILDER_SYSTEM;
    const user = promptOverrides?.user ?? (cacheablePrefix + dynamicSuffix);

    // Context observability: log token estimates per block
    logPromptBlocks("builder", "SCENE", [
      { name: "system", content: system, injected: true },
      { name: "scene_plan", content: JSON.stringify(scenePlan), injected: true },
      { name: "characters", content: JSON.stringify(relevantCharacters), injected: true },
      { name: "char_visuals", content: charVisuals, injected: charVisuals !== "(no character visuals available)" },
      { name: "world", content: worldContext, injected: true },
      { name: "hook", content: hookContext, injected: true },
      { name: "relationships", content: relationshipTensions, injected: relationshipTensions !== "(none)" },
      { name: "dev_targets", content: devTargets, injected: devTargets !== "(none)" },
      { name: "theme", content: JSON.stringify(plotPack.locked.theme_cluster), injected: true },
      { name: "tone_chips", content: JSON.stringify(plotPack.preferences?.tone_chips ?? []), injected: true },
      { name: "prev_scene", content: previousText, injected: !!previousText },
      { name: "psychology", content: psychSignals, injected: !!psychSignals },
      { name: "cultural", content: builderCulturalText, injected: !!builderCulturalText },
      { name: "must_honor", content: builderMustHonor, injected: !!builderMustHonor },
    ]);

    let builderRaw: string;
    try {
      builderRaw = await this.llm.call("scene_builder", system, user, {
        temperature: 0.85,
        maxTokens: 8000,
        modelOverride,
        jsonSchema: SCENE_BUILDER_SCHEMA,
        truncationMode: "critical",
        // Only use cached prefix when not using prompt overrides
        cacheableUserPrefix: promptOverrides?.user ? undefined : cacheablePrefix,
      });
    } catch (err) {
      console.error("SCENE BUILDER LLM ERROR:", err);
      throw new SceneServiceError("LLM_CALL_FAILED", "Scene builder call failed");
    }

    const result = this.parseAndValidate<SceneBuilderOutput>(builderRaw, ["scene_id", "vn_scene", "readable", "delivery_notes"]);
    if (!result) {
      throw new SceneServiceError("LLM_PARSE_ERROR", "Failed to parse scene builder response");
    }

    this.recordPromptHistory(session, "builder", system, user, promptOverrides, `scene ${scenePlan.scene_id} built (${result.readable.word_count} words)`);
    return result;
  }

  private async runMinorJudge(
    session: SceneSessionState,
    scenePlan: ScenePlan,
    builderOutput: SceneBuilderOutput,
    sceneIndex: number,
    modelOverride?: string,
    promptOverrides?: ScenePromptOverrides,
  ): Promise<SceneMinorJudgeOutput> {
    const previousScene = sceneIndex > 0 ? session.builtScenes[sceneIndex - 1] : null;
    const previousSummary = previousScene
      ? `"${previousScene.plan.title}" — ends with: ${previousScene.builder_output.readable.screenplay_text.slice(-500)}`
      : "(first scene)";

    const totalScenes = session.scenePlan!.length;
    const arcPosition = sceneIndex < totalScenes * 0.25 ? "opening"
      : sceneIndex < totalScenes * 0.5 ? "rising"
      : sceneIndex < totalScenes * 0.75 ? "peak"
      : "resolution";

    // OPTIMIZATION: Item 16 - Only include characters involved in this scene
    const relevantCharacters = this.filterCharacterProfiles(
      session.sourceCharacterPack.locked.characters,
      scenePlan.characters_present
    );

    const system = promptOverrides?.system ?? SCENE_MINOR_JUDGE_SYSTEM;
    const user = promptOverrides?.user ?? SCENE_MINOR_JUDGE_USER_TEMPLATE
      .replace("{{SCENE_PLAN_JSON}}", JSON.stringify(scenePlan))
      .replace("{{SCENE_CONTENT_JSON}}", JSON.stringify({
        screenplay: builderOutput.readable.screenplay_text,
        delivery_notes: builderOutput.delivery_notes,
        vn_lines_count: builderOutput.vn_scene.lines.length,
      }))
      .replace("{{PREVIOUS_SCENE_SUMMARY}}", previousSummary)
      .replace("{{CHARACTER_PROFILES_JSON}}", JSON.stringify(relevantCharacters))
      .replace("{{SCENE_INDEX}}", String(sceneIndex + 1))
      .replace("{{TOTAL_SCENES}}", String(totalScenes))
      .replace("{{PACING_TYPE}}", scenePlan.pacing_type)
      .replace("{{ARC_POSITION}}", arcPosition);

    let judgeRaw: string;
    try {
      judgeRaw = await this.llm.call("scene_minor_judge", system, user, {
        temperature: 0.3,
        maxTokens: 3000,
        modelOverride,
        jsonSchema: SCENE_MINOR_JUDGE_SCHEMA,
        truncationMode: "critical",
      });
    } catch (err) {
      console.error("SCENE MINOR JUDGE ERROR:", err);
      throw err;
    }

    const result = this.parseAndValidate<SceneMinorJudgeOutput>(judgeRaw, ["pass", "beat_delivery", "consistency"]);
    if (!result) throw new Error("Failed to parse minor judge response");

    this.recordPromptHistory(session, "minor_judge", system, user, promptOverrides, result.pass ? "PASS" : "FAIL");
    return result;
  }

  private async runSceneDivergence(
    session: SceneSessionState,
    scenePlan: ScenePlan,
    modelOverride?: string,
  ): Promise<SceneDivergenceOutput | null> {
    // OPTIMIZATION: Check divergence cache first
    const sceneIndex = session.currentSceneIndex;
    const stagingState = session.sceneStagingStates?.[scenePlan.scene_id];
    const cacheKey = this.divergenceCacheKey(sceneIndex, stagingState);

    const cached = this.divergenceCache.get(cacheKey);
    if (cached) {
      console.log(`[DIVERGENCE CACHE] Hit for scene ${sceneIndex}`);
      return cached;
    }

    const previousScene = session.builtScenes.length > 0
      ? session.builtScenes[session.builtScenes.length - 1]
      : null;
    const previousSummary = previousScene
      ? `"${previousScene.plan.title}": ${previousScene.builder_output.readable.screenplay_text.slice(0, 300)}...`
      : "(first scene)";

    // Find the beat(s) this scene stages
    const beats = session.sourcePlotPack.locked.tension_chain.filter(b => scenePlan.beat_ids.includes(b.id));
    const psychSignals = formatPsychologyLedgerForPrompt(session.psychologyLedger!);

    // OPTIMIZATION: Item 16 - Only include characters involved in this scene
    const relevantCharacters = this.filterCharacterProfiles(
      session.sourceCharacterPack.locked.characters,
      scenePlan.characters_present
    );

    const user = SCENE_DIVERGENCE_USER_TEMPLATE
      .replace("{{SCENE_PLAN_JSON}}", JSON.stringify(scenePlan))
      .replace("{{BEAT_JSON}}", JSON.stringify(beats))
      .replace("{{PREVIOUS_SCENE_SUMMARY}}", previousSummary)
      .replace("{{CHARACTER_PROFILES_JSON}}", JSON.stringify(relevantCharacters))
      .replace("{{WORLD_SUMMARY}}", session.sourceWorldPack?.state_summary ?? "(no world context)")
      .replace("{{PSYCHOLOGY_SIGNALS}}", psychSignals);

    let raw: string;
    try {
      raw = await this.llm.call("scene_divergence", SCENE_DIVERGENCE_SYSTEM, user, {
        temperature: 0.9,
        maxTokens: 3000,
        modelOverride,
        jsonSchema: SCENE_DIVERGENCE_SCHEMA,
      });
    } catch (err) {
      console.error("SCENE DIVERGENCE ERROR:", err);
      return null;
    }

    const result = this.parseAndValidate<SceneDivergenceOutput>(raw, ["scene_id", "alternatives", "worth_asking"]);
    if (result) {
      // OPTIMIZATION: Cache the result for this scene's staging state
      this.divergenceCache.set(cacheKey, result);
      this.recordPromptHistory(session, "divergence", SCENE_DIVERGENCE_SYSTEM, user, undefined, `${result.alternatives.length} alternatives, worth_asking: ${result.worth_asking}`);
    }
    return result;
  }

  // ═══════════════════════════════════════════════════════════════
  // PRIVATE — Utility helpers
  // ═══════════════════════════════════════════════════════════════

  // OPTIMIZATION: Item 16 - Filter character profiles to only relevant cast
  private filterCharacterProfiles(allCharacters: any, charactersInvolved: string[]): any {
    if (!charactersInvolved || charactersInvolved.length === 0) {
      return allCharacters;
    }

    const filtered: Record<string, any> = {};
    for (const charId of charactersInvolved) {
      // Try direct key match first (role-based keys)
      if (allCharacters[charId]) {
        filtered[charId] = allCharacters[charId];
        continue;
      }
      // Fallback: search by character name/role fields (LLM-generated names)
      const lowerCharId = charId.toLowerCase();
      for (const [key, value] of Object.entries(allCharacters)) {
        if (key in filtered) continue;
        const v = value as any;
        if (
          v?.name?.toLowerCase() === lowerCharId ||
          v?.role?.toLowerCase() === lowerCharId ||
          key.toLowerCase() === lowerCharId
        ) {
          filtered[key] = value;
          break;
        }
      }
    }

    return Object.keys(filtered).length > 0 ? filtered : allCharacters;
  }

  private createSceneDigest(builtScene: BuiltScene): { scene_id: string; title: string; digest: string; word_count: number; delivery_notes: any } {
    const screenplay = builtScene.builder_output.readable.screenplay_text;
    const plan = builtScene.plan;
    const notes = builtScene.builder_output.delivery_notes;

    // Extract key dialogue lines (first 3 character dialogue lines)
    const dialogueLines = builtScene.builder_output.vn_scene?.lines
      ?.filter((l: any) => l.speaker && l.speaker !== "NARRATION" && l.speaker !== "INTERNAL")
      ?.slice(0, 3)
      ?.map((l: any) => `${l.speaker}: "${l.text?.slice(0, 60)}${l.text?.length > 60 ? "..." : ""}"`)
      ?.join(" | ") ?? "";

    // Emotion arc summary
    const emotionArc = `${plan.emotion_arc.start} → ${plan.emotion_arc.end}`;

    // Exit hook for forward momentum
    const exitHook = plan.exit_hook ?? notes?.exit_hook_planted ?? "";

    // Build enriched digest (~500 chars)
    const parts = [
      `[${plan.pacing_type}] ${plan.title}`,
      `Characters: ${plan.characters_present.join(", ")}`,
      `Emotion arc: ${emotionArc}`,
      dialogueLines ? `Key lines: ${dialogueLines}` : "",
      exitHook ? `Exit hook: ${exitHook}` : "",
      notes?.scene_question_status ? `Scene question: ${notes.scene_question_status}` : "",
    ].filter(Boolean);

    const digest = parts.join(" | ");

    return {
      scene_id: builtScene.scene_id,
      title: plan.title,
      digest: digest.length > 600 ? digest.slice(0, 597) + "..." : digest,
      word_count: builtScene.builder_output.readable.word_count,
      delivery_notes: notes,
    };
  }

  private computeRhythmSnapshot(session: SceneSessionState): SceneRhythmSnapshot {
    const built = session.builtScenes;
    const recentPacing: PacingType[] = built.slice(-4).map(s => s.plan.pacing_type);
    const recentCompulsions: CompulsionVector[] = built.slice(-4).map(s => s.plan.compulsion_vector);
    const recentEmotionExits: string[] = built.slice(-4).map(s => s.plan.emotion_arc.end);

    // Check monotony
    let monotonyRisk = false;
    let rhythmNote = "Good variety so far.";
    if (recentPacing.length >= 3) {
      const lastThree = recentPacing.slice(-3);
      if (lastThree[0] === lastThree[1] && lastThree[1] === lastThree[2]) {
        monotonyRisk = true;
        rhythmNote = `Three consecutive ${lastThree[0]} scenes — vary the pacing for this scene.`;
      }
    }
    if (recentPacing.length >= 2 && !monotonyRisk) {
      const lastTwo = recentPacing.slice(-2);
      if (lastTwo[0] === lastTwo[1]) {
        rhythmNote = `Two consecutive ${lastTwo[0]} scenes — consider a different pacing type.`;
      }
    }

    return {
      recent_pacing: recentPacing,
      recent_compulsions: recentCompulsions,
      recent_emotion_exits: recentEmotionExits,
      monotony_risk: monotonyRisk,
      rhythm_note: rhythmNote,
    };
  }

  private divergenceCacheKey(sceneIndex: number, stagingState: SceneStagingState | undefined): string {
    // Create cache key from scene index and staging state
    const stagingHash = stagingState
      ? JSON.stringify({
          user_selection: stagingState.user_selection,
          assumption_overrides: stagingState.assumption_overrides,
          divergence_choice: stagingState.divergence_choice,
        })
      : "{}";
    return `${sceneIndex}:${stagingHash}`;
  }

  private shouldRunDivergence(session: SceneSessionState, scenePlan: ScenePlan, sceneIndex: number, totalScenes: number): boolean {
    // Gate 1: Scene is pivotal (has pivotal: true or pivot_moment on the plan)
    const isPivotal = (scenePlan as any).pivotal || (scenePlan as any).pivot_moment;
    if (isPivotal) return true;

    // Gate 2: Scene is first or last
    if (sceneIndex === 0 || sceneIndex === totalScenes - 1) return true;

    // Gate 3: Check clarifier confidence from previous turn
    if (session.writingTurns.length > 0) {
      const lastWritingTurn = session.writingTurns[session.writingTurns.length - 1];
      if (lastWritingTurn.clarifierResponse?.auto_pass_confidence !== undefined) {
        const clarifierConfidence = lastWritingTurn.clarifierResponse.auto_pass_confidence;
        if (clarifierConfidence < 0.7) return true;
      }
    }

    // Gate 4: Scene has user steering from staging state
    const stagingState = session.sceneStagingStates?.[scenePlan.scene_id];
    if (stagingState?.user_selection || Object.keys(stagingState?.assumption_overrides ?? {}).length > 0) {
      return true;
    }

    // Gate 5: Monotony risk - check if 2+ consecutive scenes have same pacing type
    if (sceneIndex > 0) {
      const currentPacing = scenePlan.pacing_type;
      const previousPacing = session.scenePlan?.[sceneIndex - 1]?.pacing_type;

      let consecutiveCount = 1;
      if (previousPacing === currentPacing) {
        consecutiveCount++;
        // Check if there's a scene before the previous one with the same pacing
        if (sceneIndex > 1) {
          const twoBack = session.scenePlan?.[sceneIndex - 2]?.pacing_type;
          if (twoBack === currentPacing) {
            consecutiveCount++;
          }
        }
      }

      if (consecutiveCount >= 2) return true;
    }

    // Default: low-risk scene, skip divergence
    return false;
  }

  private shouldRunMinorJudge(session: SceneSessionState, scenePlan: ScenePlan, sceneIndex: number): boolean {
    const staging = session.sceneStagingStates?.[scenePlan.scene_id];
    const totalScenes = session.scenePlan?.length ?? 0;

    // Skip ONLY when ALL conditions are true
    const wasAutoPassedWithoutUserSelection = staging?.resolved && !staging?.user_selection;
    const hasNoUserSteering = !staging?.user_selection && Object.keys(staging?.assumption_overrides ?? {}).length === 0;
    const isNotPivotal = !(scenePlan as any).pivotal && !(scenePlan as any).pivot_moment;
    const isNotLastScene = sceneIndex !== totalScenes - 1;
    const pacingIsNotCritical = scenePlan.pacing_type !== "set_piece" && scenePlan.pacing_type !== "pressure_cooker";

    const shouldSkip = wasAutoPassedWithoutUserSelection && hasNoUserSteering && isNotPivotal && isNotLastScene && pacingIsNotCritical;

    return !shouldSkip;
  }

  private formatWorldForSceneBuilder(session: SceneSessionState): string {
    const wp = session.sourceWorldPack?.locked;
    if (!wp) return session.sourceWorldPack?.state_summary ?? "(no world context)";

    const parts: string[] = [];
    if (wp.world_thesis) parts.push(`World thesis: ${wp.world_thesis}`);
    if (wp.arena?.locations?.length) {
      parts.push(`Locations: ${wp.arena.locations.map((l: any) => `${l.name} (${l.emotional_register})`).join(", ")}`);
    }
    if (wp.rules?.length) {
      parts.push(`Active rules: ${wp.rules.map((r: any) => `${r.rule} [broken→${r.consequence_if_broken}]`).join("; ")}`);
    }
    if (wp.factions?.length) {
      parts.push(`Factions: ${wp.factions.map((f: any) => `${f.name}: ${f.goal} (pressure: ${f.pressure_on_protagonist})`).join("; ")}`);
    }
    if (wp.consequence_patterns?.length) {
      parts.push(`Consequence patterns: ${wp.consequence_patterns.map((c: any) => `${c.trigger}→${c.world_response}`).join("; ")}`);
    }
    if (wp.information_access?.length) {
      parts.push(`Information asymmetry: ${wp.information_access.map((i: any) => `"${i.truth}" known by [${i.who_knows?.join(",")}]`).join("; ")}`);
    }
    return parts.join("\n") || (session.sourceWorldPack?.state_summary ?? "(no world context)");
  }

  private formatHookForSceneBuilder(session: SceneSessionState): string {
    const hook = session.sourceHookPack?.locked;
    if (!hook) return "(no hook context)";

    const parts: string[] = [];
    if (hook.emotional_promise) parts.push(`Emotional promise: ${hook.emotional_promise}`);
    if (hook.hook_sentence) parts.push(`Hook: ${hook.hook_sentence}`);
    if (hook.core_engine?.taboo_or_tension) parts.push(`Tension source: ${hook.core_engine.taboo_or_tension}`);
    return parts.join("\n") || "(no hook context)";
  }

  private buildInitialPlanClarifier(planner: ScenePlannerOutput, psychLedger: UserPsychologyLedger): SceneClarifierResponse {
    return {
      psychology_strategy: "Initial plan presentation — gauge user's reaction to the scene structure.",
      scene_summary: planner.narrative_preview.trailer_text,
      needs_input: true,
      question: `I've mapped out ${planner.scenes.length} scenes for your story. Does this feel like the right shape, or would you like to steer anything before we start writing?`,
      options: [
        { id: "A", label: "Looks great — let's start writing" },
        { id: "B", label: "Show me the scene map first" },
        { id: "C", label: "I want to adjust a few things" },
      ],
      allow_free_text: true,
      auto_pass_confidence: 0.5,
      user_read: {
        signals: [],
        behaviorSummary: {
          orientation: "New module — assessing initial engagement",
          currentFocus: "scene structure",
          engagementMode: "exploring",
          satisfaction: { score: 0.7, trend: "stable", reason: "New phase beginning" },
        },
        adaptationPlan: {
          dominantNeed: "Confirm the plan shape before writing begins",
          moves: [{ action: "Present narrative preview and offer steering", drivenBy: ["new_module_start"], target: "question" }],
        },
      },
    };
  }

  private buildPlannerUserPrompt(
    plotPack: PlotPack,
    charPack: CharacterPack,
    worldPack: WorldPack | null,
    hookPack: HookPack,
    psychLedger: UserPsychologyLedger,
  ): string {
    return SCENE_PLANNER_USER_TEMPLATE
      .replace("{{TENSION_CHAIN_JSON}}", JSON.stringify(plotPack.locked.tension_chain, null, 2))
      .replace("{{TURNING_POINTS_JSON}}", JSON.stringify(plotPack.locked.turning_points, null, 2))
      .replace("{{DRAMATIC_IRONY_JSON}}", JSON.stringify(plotPack.locked.dramatic_irony_points, null, 2))
      .replace("{{MYSTERY_HOOKS_JSON}}", JSON.stringify(plotPack.locked.mystery_hooks, null, 2))
      .replace("{{MOTIFS_JSON}}", JSON.stringify(plotPack.locked.motifs, null, 2))
      .replace("{{THEME_JSON}}", JSON.stringify(plotPack.locked.theme_cluster, null, 2))
      .replace("{{CLIMAX_JSON}}", JSON.stringify(plotPack.locked.climax, null, 2))
      .replace("{{RESOLUTION_JSON}}", JSON.stringify(plotPack.locked.resolution, null, 2))
      .replace("{{CORE_CONFLICT}}", plotPack.locked.core_conflict)
      .replace("{{ADDICTION_ENGINE}}", plotPack.locked.addiction_engine)
      .replace("{{CHARACTER_PROFILES_JSON}}", JSON.stringify(charPack.locked.characters, null, 2))
      .replace("{{WORLD_SUMMARY}}", worldPack?.state_summary ?? "(no world context)")
      .replace("{{HOOK_SUMMARY}}", hookPack.state_summary ?? "(no hook summary)")
      .replace("{{TONE_CHIPS}}", JSON.stringify(plotPack.preferences?.tone_chips ?? []))
      .replace("{{BANS}}", JSON.stringify(plotPack.preferences?.bans ?? []))
      .replace("{{PSYCHOLOGY_SIGNALS}}", formatPsychologyLedgerForPrompt(psychLedger));
  }

  private formatScenePlanSummary(scenes: ScenePlan[]): string {
    return scenes.map((s, i) =>
      `Scene ${i + 1}: "${s.title}" — ${s.setting.location}, ${s.setting.time}. POV: ${s.pov_character}. Pacing: ${s.pacing_type}. ${s.purpose}`
    ).join("\n");
  }

  private formatLedger(ledger: SceneLedgerEntry[]): string {
    if (ledger.length === 0) return "(empty)";
    return ledger
      .filter(e => e.confidence === "confirmed")
      .map(e => `[${e.key}] ${e.value} (${e.source})`)
      .join("\n");
  }

  private formatPriorTurns(planTurns: ScenePlanningTurn[], writeTurns: SceneWritingTurn[]): string {
    const lines: string[] = [];
    for (const t of planTurns) {
      if (t.userSelection) {
        lines.push(`[Plan Turn ${t.turnNumber}] User: ${t.userSelection.label}`);
      }
    }
    for (const t of writeTurns) {
      if (t.userSelection) {
        lines.push(`[Scene ${t.sceneId} Turn ${t.turnNumber}] User: ${t.userSelection.label}`);
      }
    }
    return lines.join("\n") || "(no prior turns)";
  }

  private parseAndValidate<T>(raw: string, requiredKeys: string[]): T | null {
    try {
      // Strip markdown fences if present
      let cleaned = raw.trim();
      if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
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

  private recordPromptHistory(
    session: SceneSessionState,
    stage: string,
    system: string,
    user: string,
    overrides?: ScenePromptOverrides,
    summary?: string,
  ): void {
    if (!session.promptHistory) session.promptHistory = [];
    const provenance = this.llm.lastCallProvenance;
    session.promptHistory.push({
      timestamp: new Date().toISOString(),
      stage: stage as any,
      turnNumber: session.planningTurns.length + session.writingTurns.length,
      defaultSystem: system,
      defaultUser: user,
      editedSystem: overrides?.system,
      editedUser: overrides?.user,
      wasEdited: !!(overrides?.system || overrides?.user),
      responseSummary: summary,
      provider: provenance?.provider,
      model: provenance?.model,
    });
  }

  // ─── Cultural Intelligence Engine helpers ───

  private async getCulturalBrief(
    session: SceneSessionState,
    turnNumber: number,
  ): Promise<import("../../shared/types/cultural").CulturalBrief | null> {
    return culturalResearchService.getBriefForClarifier({
      projectId: session.projectId,
      module: "scene",
      turnNumber,
      lockedPacksSummary: this.buildLockedPacksSummary(session),
      currentState: (session.sceneStagingStates ?? {}) as Record<string, unknown>,
      constraintLedger: this.formatLedger(session.constraintLedger),
      psychologySummary: formatPsychologyLedgerForPrompt(session.psychologyLedger!) ?? "",
      directedReferences: this.extractDirectedReferences(session),
    });
  }

  private async getCulturalBriefForBuilder(
    session: SceneSessionState,
  ): Promise<import("../../shared/types/cultural").CulturalBrief | null> {
    return culturalResearchService.getBriefForBuilder(
      session.projectId, "scene", session.writingTurns.length,
    );
  }

  private async fireBackgroundCulturalResearch(
    session: SceneSessionState,
    turnNumber: number,
  ): Promise<void> {
    const context: CulturalResearchContext = {
      projectId: session.projectId,
      module: "scene",
      turnNumber,
      lockedPacksSummary: this.buildLockedPacksSummary(session),
      currentState: (session.sceneStagingStates ?? {}) as Record<string, unknown>,
      constraintLedger: this.formatLedger(session.constraintLedger),
      psychologySummary: formatPsychologyLedgerForPrompt(session.psychologyLedger!) ?? "",
      directedReferences: this.extractDirectedReferences(session),
    };
    await culturalResearchService.fireBackgroundResearch(context);
  }

  private buildLockedPacksSummary(session: SceneSessionState): string {
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
    if (session.sourceWorldPack) {
      parts.push(`WORLD: ${session.sourceWorldPack.locked.world_thesis} — ${session.sourceWorldPack.locked.pressure_summary}`);
    }
    if (session.sourcePlotPack) {
      parts.push(`PLOT: ${session.sourcePlotPack.locked.theme_cluster?.topic ?? "(no theme)"} — ${session.sourcePlotPack.locked.tension_chain?.length ?? 0} tension beats`);
    }
    return parts.join("\n\n");
  }

  private extractDirectedReferences(session: SceneSessionState): string[] {
    const refs: string[] = [];
    // Check both planning and writing turns for directed references
    const recentPlanTurns = session.planningTurns.slice(-3);
    for (const t of recentPlanTurns) {
      if (t.userSelection?.type === "free_text" && (t.userSelection as any).label) {
        refs.push(...detectDirectedReferences((t.userSelection as any).label));
      }
    }
    const recentWriteTurns = session.writingTurns.slice(-3);
    for (const t of recentWriteTurns) {
      if (t.userSelection?.type === "free_text" && (t.userSelection as any).label) {
        refs.push(...detectDirectedReferences((t.userSelection as any).label));
      }
    }
    return [...new Set(refs)];
  }
}
