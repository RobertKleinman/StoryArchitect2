import {
  CharacterAssumptionResponse,
  CharacterBuilderOutput,
  CharacterClarifierResponse,
  CharacterJudgeOutput,
  CharacterLedgerEntry,
  CharacterPack,
  CharacterSessionState,
  CharacterStateUpdate,
  CharacterTurn,
  CharacterPromptHistoryEntry,
  CharacterPromptOverrides,
  CharacterPromptPreview,
} from "../../shared/types/character";
import { HookPack } from "../../shared/types/hook";
import {
  CharacterClarifyResponse,
  CharacterGenerateResponse,
} from "../../shared/types/api";
import { CharacterStore } from "../storage/characterStore";
import { ProjectStore } from "../storage/projectStore";
import { LLMClient } from "./llmClient";
import {
  CHARACTER_BUILDER_SYSTEM,
  CHARACTER_BUILDER_USER_PREFIX,
  CHARACTER_BUILDER_USER_DYNAMIC,
  CHARACTER_CLARIFIER_SYSTEM,
  CHARACTER_CLARIFIER_USER_PREFIX,
  CHARACTER_CLARIFIER_USER_DYNAMIC,
  CHARACTER_JUDGE_SYSTEM,
  CHARACTER_JUDGE_USER_TEMPLATE,
  CHARACTER_POLISH_SYSTEM,
  CHARACTER_POLISH_USER_TEMPLATE,
  CHARACTER_SUMMARY_SYSTEM,
  CHARACTER_SUMMARY_USER_TEMPLATE,
} from "./characterPrompts";
import {
  CHARACTER_BUILDER_SCHEMA,
  CHARACTER_CLARIFIER_SCHEMA,
  CHARACTER_JUDGE_SCHEMA,
} from "./characterSchemas";
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
import { buildMustHonorBlock, normalizeStringifiedFields } from "./mustHonorBlock";
import { withProjectLock } from "../storage/projectMutex";

export class CharacterServiceError extends Error {
  code: "NOT_FOUND" | "INVALID_INPUT" | "LLM_PARSE_ERROR" | "LLM_CALL_FAILED";

  constructor(
    code: "NOT_FOUND" | "INVALID_INPUT" | "LLM_PARSE_ERROR" | "LLM_CALL_FAILED",
    message: string
  ) {
    super(message);
    this.code = code;
  }
}

export class CharacterService {
  constructor(
    private charStore: CharacterStore,
    private hookStore: ProjectStore,
    private llm: LLMClient
  ) {}

  // ─── Preview Prompt (no LLM call) ───

  async previewPrompt(
    projectId: string,
    stage: "clarifier" | "builder" | "judge" | "summary",
  ): Promise<CharacterPromptPreview> {
    const session = await this.charStore.get(projectId);
    if (!session) {
      throw new CharacterServiceError("NOT_FOUND", "Character session not found");
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
        if (session.revealedCharacters) {
          const prompt = this.buildJudgePrompt(session.revealedCharacters, session);
          return { stage, system: prompt.system, user: prompt.user };
        }
        return {
          stage,
          system: CHARACTER_JUDGE_SYSTEM,
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
    hookProjectId: string,
    userSelection?: { type: "option" | "free_text" | "surprise_me"; optionId?: string; label: string },
    modelOverride?: string,
    promptOverrides?: CharacterPromptOverrides,
    assumptionResponses?: CharacterAssumptionResponse[],
    characterSeed?: string,
  ): Promise<CharacterClarifyResponse> {
    let session = await this.charStore.get(projectId);
    const isFirstTurn = !session || session.turns.length === 0;

    if (isFirstTurn) {
      if (userSelection) {
        throw new CharacterServiceError("INVALID_INPUT", "First turn cannot have userSelection");
      }

      // If session already exists with 0 turns (crashed first attempt), reuse it
      if (!session) {
        // Load the hook pack from the hook module export
        const hookExport = await this.hookStore.getExport(hookProjectId);
        if (!hookExport || !hookExport.hookPack) {
          throw new CharacterServiceError(
            "NOT_FOUND",
            "Hook export not found or hook not locked. Complete the hook module first."
          );
        }

        const sourceHook = hookExport.hookPack;

        // Import confirmed hook ledger entries so the character clarifier knows
        // what creative decisions were already locked in by the user
        const importedLedger: CharacterLedgerEntry[] = [];
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

        // Import psychology ledger from hook module (or start fresh)
        const importedPsychLedger = sourceHook.psychologyLedger ?? createEmptyLedger();
        // Snapshot hook's accumulated stats as baseline for this module
        snapshotBaselineForNewModule(importedPsychLedger);

        session = {
          projectId,
          hookProjectId,
          sourceHook,
          seedInput: hookExport.seedInput,
          characterSeed: characterSeed ?? undefined,
          characters: {},
          activeFocus: null,
          turns: [],
          constraintLedger: importedLedger,
          status: "clarifying",
          rerollCount: 0,
          psychologyLedger: importedPsychLedger,
        };
      }
      // else: session exists with 0 turns from a crashed first attempt — reuse it
      // Update characterSeed if provided (may have been missing from the crashed attempt)
      if (session && characterSeed) {
        session.characterSeed = characterSeed;
      }
    } else {
      if (!session) {
        throw new CharacterServiceError("NOT_FOUND", "Character session not found");
      }

      if (session.status === "revealed" || session.status === "locked") {
        throw new CharacterServiceError("INVALID_INPUT", "Session already progressed; reset first");
      }

      if (!userSelection) {
        throw new CharacterServiceError("INVALID_INPUT", "Subsequent turns require userSelection");
      }

      const previousTurn = session.turns[session.turns.length - 1];
      if (!previousTurn) {
        throw new CharacterServiceError("INVALID_INPUT", "No clarifier turn to attach selection to");
      }

      if (userSelection.type === "option") {
        const isValid = previousTurn.clarifierResponse.options.some(
          (opt) => opt.id === userSelection.optionId
        );
        if (!userSelection.optionId || !isValid) {
          throw new CharacterServiceError("INVALID_INPUT", "optionId must exist in previous turn options");
        }
      }

      previousTurn.userSelection = userSelection;

      if (assumptionResponses && assumptionResponses.length > 0) {
        previousTurn.assumptionResponses = assumptionResponses;
      }

      // Process assumption responses into ledger (deterministic, no LLM)
      if (!session.constraintLedger) session.constraintLedger = [];
      this.processAssumptionResponses(session, assumptionResponses ?? [], session.turns.length);

      // ─── Non-choice tracking: log offered vs responded assumption IDs ───
      if (session.psychologyLedger) {
        // Collect offered IDs from all characters_surfaced assumptions in previous turn
        const offeredIds: string[] = [];
        for (const ch of previousTurn.clarifierResponse.characters_surfaced ?? []) {
          for (const a of ch.assumptions ?? []) {
            offeredIds.push(a.id);
          }
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
      throw new CharacterServiceError("NOT_FOUND", "Session not found");
    }

    // Save before LLM call (crash recovery)
    session.lastSavedAt = new Date().toISOString();
    await this.charStore.save(session);

    const prompt = await this.buildClarifierPrompt(session);
    const systemPrompt = promptOverrides?.system ?? prompt.system;
    const userPrompt = promptOverrides?.user ?? prompt.user;

    let clarifierRaw: string;
    try {
      clarifierRaw = await this.llm.call("char_clarifier", systemPrompt, userPrompt, {
        temperature: 0.7,
        maxTokens: 3500,
        modelOverride,
        jsonSchema: CHARACTER_CLARIFIER_SCHEMA,
        // Only use cached prefix when not using prompt overrides
        cacheableUserPrefix: promptOverrides?.user ? undefined : prompt.cacheableUserPrefix,
      });
    } catch (err: any) {
      console.error("CHAR CLARIFY LLM ERROR:", err);
      const detail = typeof err === "object" && err?.body ? ` — ${err.body}` : "";
      throw new CharacterServiceError("LLM_CALL_FAILED", `Character clarifier call failed${detail}`);
    }

    // Structured outputs guarantee valid JSON schema compliance, so parse failures
    // indicate a non-retryable shape issue — no point re-calling with identical prompt.
    // LLMClient.call() already retries transient transport errors (429/500/529).
    const clarifier = this.parseAndValidate<CharacterClarifierResponse>(clarifierRaw, [
      "psychology_strategy",
      "hypothesis_line",
      "question",
      "options",
      "allow_free_text",
      "character_focus",
      "ready_for_characters",
      "readiness_pct",
      "readiness_note",
      "missing_signal",
      "conflict_flag",
      "characters_surfaced",
      "relationship_updates",
      "state_updates",
    ]);

    if (!clarifier) {
      console.error("CHAR CLARIFIER PARSE FAILED. Raw (first 500):", clarifierRaw.slice(0, 500));
      throw new CharacterServiceError("LLM_PARSE_ERROR", "Failed to parse character clarifier response");
    }

    // Normalize stringified fields (user_read, scope_recommendation) from JSON strings to objects
    normalizeStringifiedFields(clarifier as unknown as Record<string, unknown>);

    // Record prompt history
    this.recordPromptHistory(
      session, "clarifier", prompt.system, prompt.user,
      promptOverrides, clarifierRaw.slice(0, 500)
    );

    // Convert state_updates from LLM array format [{role, updates: [{dial, value}]}]
    // back to Record<role, CharacterStateUpdate> for the rest of the pipeline
    const stateUpdatesRecord: Record<string, CharacterStateUpdate> = {};
    if (Array.isArray(clarifier.state_updates)) {
      for (const item of clarifier.state_updates as any[]) {
        if (!item.role) continue;
        const update: Record<string, string> = {};
        if (Array.isArray(item.updates)) {
          for (const entry of item.updates) {
            if (entry.dial && entry.value) {
              update[entry.dial] = entry.value;
            }
          }
        } else {
          // Fallback: old format where dials were direct properties
          const { role, updates, ...rest } = item;
          Object.assign(update, rest);
        }
        stateUpdatesRecord[item.role] = update as CharacterStateUpdate;
      }
    } else if (clarifier.state_updates && typeof clarifier.state_updates === "object") {
      Object.assign(stateUpdatesRecord, clarifier.state_updates);
    }
    clarifier.state_updates = stateUpdatesRecord;

    // Merge state updates into session characters
    if (clarifier.state_updates) {
      for (const [role, update] of Object.entries(clarifier.state_updates)) {
        session.characters[role] = this.mergeCharacterState(
          session.characters[role] ?? {},
          update
        );
      }
    }

    // Process state updates into ledger as inferred entries
    if (!session.constraintLedger) session.constraintLedger = [];
    this.processStateUpdatesIntoLedger(session, clarifier.state_updates ?? {}, session.turns.length + 1);

    // ─── Psychology Ledger: record LLM's structured signals + update heuristics ───
    if (!session.psychologyLedger) session.psychologyLedger = createEmptyLedger();
    if (clarifier.user_read && typeof clarifier.user_read === "object") {
      const ur = clarifier.user_read;
      if (ur.signals && ur.behaviorSummary) {
        recordSignals(
          session.psychologyLedger,
          session.turns.length + 1,
          "character",
          ur.signals as RawSignalObservation[],
          ur.behaviorSummary as BehaviorSummary,
          (ur.adaptationPlan as AdaptationPlan) ?? { dominantNeed: "", moves: [] },
        );
      } else {
        recordHypotheses(
          session.psychologyLedger,
          session.turns.length + 1,
          "character",
          (ur as any).hypotheses ?? [],
          (ur as any).overall_read ?? "",
          (ur as any).satisfaction
        );
      }
    }
    this.updatePsychologyHeuristics(session);

    // Update active focus
    session.activeFocus = clarifier.character_focus;

    const turn: CharacterTurn = {
      turnNumber: session.turns.length + 1,
      clarifierResponse: clarifier,
      userSelection: null,
    };

    // Suppress readiness on the very first turn
    if (session.turns.length < 1 && turn.clarifierResponse.ready_for_characters) {
      turn.clarifierResponse.ready_for_characters = false;
    }

    // Readiness convergence safety net
    if (turn.clarifierResponse.readiness_pct >= 75) {
      session.consecutiveHighReadiness = (session.consecutiveHighReadiness ?? 0) + 1;
    } else {
      session.consecutiveHighReadiness = 0;
    }

    if (
      session.consecutiveHighReadiness >= 2 &&
      !turn.clarifierResponse.ready_for_characters &&
      session.turns.length >= 3
    ) {
      // Issue #23 gate: ensure protagonist has confirmed presentation before forcing readiness
      const presentationConfirmed = (session.constraintLedger ?? []).some(
        (e) => e.key.endsWith(".presentation") && e.confidence === "confirmed",
      );
      if (presentationConfirmed) {
        turn.clarifierResponse.ready_for_characters = true;
        turn.clarifierResponse.readiness_note =
          turn.clarifierResponse.readiness_note || "Your cast has been taking shape nicely — ready to meet them!";
      }
    }

    session.turns.push(turn);
    session.status = "clarifying";
    session.lastSavedAt = new Date().toISOString();

    // Mark any pending probe as consumed
    if (session.psychologyLedger) {
      markProbeConsumed(session.psychologyLedger, turn.turnNumber);
    }

    await this.charStore.save(session);

    // ─── Fire background work (non-blocking, coordinated to avoid storms) ───
    const bgTasks = pickBackgroundTasks(turn, session);

    if (bgTasks.consolidate) {
      this.fireBackgroundConsolidation(session.projectId, turn.turnNumber, "character")
        .catch(err => console.error("[PSYCH] Character consolidation fire failed:", err));
    }

    if (bgTasks.diverge) {
      this.fireBackgroundDivergence(session, turn.turnNumber, "character")
        .catch(err => console.error("[DIVERGENCE] Character exploration fire failed:", err));
    }

    if (bgTasks.cultural) {
      const hasCachedBrief = !!(await culturalResearchService.getBriefForBuilder(
        session.projectId, "character", turn.turnNumber,
      ).catch(() => null));
      if (shouldRunCulturalResearch({ turnNumber: turn.turnNumber, userSelection: turn.userSelection, hasCachedBrief })) {
        this.fireBackgroundCulturalResearch(session, turn.turnNumber)
          .catch(err => console.error("[CULTURAL] Background research fire failed:", err));
      }
    }

    return {
      clarifier: turn.clarifierResponse,
      turnNumber: turn.turnNumber,
      totalTurns: session.turns.length,
    };
  }

  /**
   * Fire-and-forget background consolidation for character module.
   */
  private async fireBackgroundConsolidation(
    projectId: string,
    turnNumber: number,
    module: "hook" | "character" | "character_image" | "world",
  ): Promise<void> {
    const sessionForConsolidation = await this.charStore.get(projectId);
    if (!sessionForConsolidation?.psychologyLedger) return;

    const snapshot = await runConsolidation(
      sessionForConsolidation.psychologyLedger,
      turnNumber,
      module,
      this.llm,
    );

    if (snapshot) {
      await withProjectLock(projectId, async () => {
        // Re-read the LATEST session to avoid overwriting concurrent changes.
        // IMPORTANT: Only graft consolidation-owned fields — NOT the entire ledger.
        // Divergence explorer may have saved lastDirectionMap concurrently;
        // replacing the whole ledger would clobber it (and vice versa).
        const freshSession = await this.charStore.get(projectId);
        if (!freshSession) return;

        if (sessionForConsolidation.psychologyLedger) {
          if (!freshSession.psychologyLedger) freshSession.psychologyLedger = sessionForConsolidation.psychologyLedger;
          else {
            freshSession.psychologyLedger.signalStore = sessionForConsolidation.psychologyLedger.signalStore;
            freshSession.psychologyLedger.lastConsolidation = sessionForConsolidation.psychologyLedger.lastConsolidation;
          }
        }
        freshSession.lastSavedAt = new Date().toISOString();
        await this.charStore.save(freshSession);
      });
    }
  }

  /**
   * Fire-and-forget background divergence exploration for character module.
   */
  private async fireBackgroundDivergence(
    session: CharacterSessionState,
    turnNumber: number,
    module: "hook" | "character" | "character_image" | "world",
  ): Promise<void> {
    const psychSummary = formatPsychologyLedgerForPrompt(session.psychologyLedger);
    // Build a state snapshot from character-module fields for divergence explorer
    const characterState: Record<string, unknown> = {};
    if (session.characters) {
      for (const [role, state] of Object.entries(session.characters)) {
        characterState[role] = state;
      }
    }
    if (session.activeFocus) characterState._activeFocus = session.activeFocus;
    const previousFamilyNames = session.psychologyLedger?.lastDirectionMap?.directionMap?.families
      ?.map(f => f.name) ?? [];
    const context = extractDivergenceContext(
      session.seedInput ?? session.sourceHook?.locked?.premise ?? "",
      session.constraintLedger,
      characterState,
      psychSummary,
      turnNumber,
      module,
      previousFamilyNames,
    );

    const snapshot = await runDivergenceExploration(context, this.llm);

    if (snapshot) {
      await withProjectLock(session.projectId, async () => {
        const freshSession = await this.charStore.get(session.projectId);
        if (!freshSession) return;

        if (!freshSession.psychologyLedger) freshSession.psychologyLedger = createEmptyLedger();
        freshSession.psychologyLedger.lastDirectionMap = snapshot;
        freshSession.lastSavedAt = new Date().toISOString();
        await this.charStore.save(freshSession);
      });
    }
  }

  // ─── Generate (tournament: adaptive multi-candidate + judge) ───

  async runGenerate(
    projectId: string,
    modelOverride?: string,
    promptOverrides?: { builder?: CharacterPromptOverrides; judge?: CharacterPromptOverrides },
  ): Promise<CharacterGenerateResponse> {
    const session = await this.charStore.get(projectId);
    if (!session) {
      throw new CharacterServiceError("NOT_FOUND", "Character session not found");
    }

    return this.executeTournament(session, modelOverride, true, promptOverrides);
  }

  // ─── Reroll (regenerate via tournament) ───

  async reroll(
    projectId: string,
    modelOverride?: string,
    promptOverrides?: { builder?: CharacterPromptOverrides; judge?: CharacterPromptOverrides },
    constraintOverrides?: Record<string, string>,
  ): Promise<CharacterGenerateResponse> {
    const session = await this.charStore.get(projectId);
    if (!session) {
      throw new CharacterServiceError("NOT_FOUND", "Character session not found");
    }
    if (session.status !== "revealed") {
      throw new CharacterServiceError("INVALID_INPUT", "Must be in revealed status to reroll");
    }

    if (constraintOverrides && Object.keys(constraintOverrides).length > 0) {
      this.applyConstraintOverrides(session, constraintOverrides);
      await this.charStore.save(session);
    }

    // Clear revealed state and regenerate
    session.revealedCharacters = undefined;
    session.revealedJudge = undefined;

    return this.executeTournament(session, modelOverride, false, promptOverrides);
  }

  private applyConstraintOverrides(
    session: CharacterSessionState,
    overrides: Record<string, string>,
  ): void {
    if (!session.constraintLedger) session.constraintLedger = [];
    const ledger = session.constraintLedger;
    const turnNumber = session.turns.length;

    for (const [key, value] of Object.entries(overrides)) {
      const trimmed = value.trim();
      if (!trimmed) continue;

      const existingIdx = ledger.findIndex((e) => e.key === key);
      const entry: CharacterLedgerEntry = {
        key,
        value: trimmed,
        source: "user_freeform",
        confidence: "confirmed",
        turnNumber,
      };

      if (existingIdx >= 0) {
        ledger[existingIdx] = entry;
      } else {
        ledger.push(entry);
      }
    }
  }

  /**
   * Tournament: run N builders in parallel at different temperatures, judge each,
   * select the winner. Adaptive candidate count:
   *  - 2 candidates when constraints are tight (many confirmed ledger entries)
   *  - 3 candidates otherwise (more creative exploration)
   */
  private async executeTournament(
    session: CharacterSessionState,
    modelOverride: string | undefined,
    resetRerollCount: boolean,
    promptOverrides?: { builder?: CharacterPromptOverrides; judge?: CharacterPromptOverrides },
  ): Promise<CharacterGenerateResponse> {
    session.status = "generating";

    // Initialize tournament progress for crash recovery
    session.tournamentProgress = {
      startedAt: new Date().toISOString(),
      builderResults: [],
      judgeResults: [],
      phase: "builders",
    };
    // Initialize build progress for frontend polling (Issue #11)
    session.buildProgress = { attempt: 1, maxAttempts: 3, status: "building" };
    session.lastSavedAt = new Date().toISOString();
    await this.charStore.save(session);

    // Build prompts
    const builderPrompt = await this.buildBuilderPrompt(session);
    const builderSystem = promptOverrides?.builder?.system ?? builderPrompt.system;
    const builderUser = promptOverrides?.builder?.user ?? builderPrompt.user;

    // Adaptive maxTokens based on cast size — each character profile is ~1,500-2,000 tokens
    const uniqueRoles = new Set<string>();
    for (const turn of session.turns) {
      for (const ch of turn.clarifierResponse.characters_surfaced ?? []) {
        uniqueRoles.add(ch.role);
      }
    }
    const castSize = Math.max(uniqueRoles.size, 2); // at least 2
    const builderMaxTokens = Math.min(4000 + castSize * 1500, 16000);

    // Adaptive candidate count: more confirmed constraints → less ambiguity → fewer candidates needed
    const confirmedCount = (session.constraintLedger ?? []).filter(
      e => e.confidence === "confirmed"
    ).length;
    const candidateCount = confirmedCount >= 8 ? 2 : 3;
    const temperatures = candidateCount === 2 ? [0.7, 0.9] : [0.7, 0.85, 1.0];

    // SHORT-CIRCUIT TOURNAMENT: Run builders and judges serially with early exit
    const builderStart = Date.now();
    const candidates: Array<{ cast: CharacterBuilderOutput; judge: CharacterJudgeOutput | null }> = [];

    for (let i = 0; i < temperatures.length; i++) {
      const temp = temperatures[i];

      // Update build progress for this candidate
      session.buildProgress = { attempt: i + 1, maxAttempts: temperatures.length, status: "building" };
      session.lastSavedAt = new Date().toISOString();
      await this.charStore.save(session);

      // Run builder for this candidate
      let builderRaw = "";
      try {
        builderRaw = await this.llm.call("char_builder", builderSystem, builderUser, {
          temperature: temp,
          maxTokens: builderMaxTokens,
          modelOverride,
          jsonSchema: CHARACTER_BUILDER_SCHEMA,
          cacheableUserPrefix: promptOverrides?.builder?.user ? undefined : builderPrompt.cacheableUserPrefix,
        });
      } catch (err) {
        console.error(`CHAR BUILDER CANDIDATE ${i + 1} LLM ERROR:`, err);
        continue;
      }

      let builderParsed = this.parseAndValidate<CharacterBuilderOutput>(builderRaw, [
        "characters", "ensemble_dynamic", "relationship_tensions",
        "structural_diversity", "collision_sources",
      ]);

      if (!builderParsed) {
        console.error(`CHAR BUILDER CANDIDATE ${i + 1} PARSE FAILED. Raw:`, builderRaw.slice(0, 500));
        continue;
      }

      // Convert characters from LLM array format to Record<role, profile>
      if (builderParsed && Array.isArray(builderParsed.characters)) {
        const charsRecord: Record<string, any> = {};
        for (const profile of builderParsed.characters as any[]) {
          if (profile.role) {
            charsRecord[profile.role] = profile;
          }
        }
        builderParsed.characters = charsRecord;
      }

      session.tournamentProgress!.builderResults.push({ raw: builderRaw, parsed: builderParsed });

      // Run judge for this candidate
      session.buildProgress = { attempt: i + 1, maxAttempts: temperatures.length, status: "judging" };
      session.lastSavedAt = new Date().toISOString();
      await this.charStore.save(session);

      const judgePrompt = this.buildJudgePrompt(builderParsed, session);
      const judgeSystem = promptOverrides?.judge?.system ?? judgePrompt.system;
      const judgeUser = promptOverrides?.judge?.user ?? judgePrompt.user;

      let judgeRaw = "";
      try {
        judgeRaw = await this.llm.call("char_judge", judgeSystem, judgeUser, {
          temperature: 0.3,
          maxTokens: 1200,
          modelOverride,
          jsonSchema: CHARACTER_JUDGE_SCHEMA,
        });
      } catch (err) {
        console.error(`CHAR JUDGE ${i + 1} LLM ERROR:`, err);
        session.tournamentProgress!.judgeResults.push({ raw: "", parsed: null });
        continue;
      }

      const judgeParsed = this.parseAndValidate<CharacterJudgeOutput>(judgeRaw, [
        "pass", "hard_fail_reasons", "scores", "weakest_character", "one_fix_instruction",
      ]);

      if (!judgeParsed) {
        console.error(`CHAR JUDGE ${i + 1} PARSE FAILED. Raw:`, judgeRaw.slice(0, 500));
        session.tournamentProgress!.judgeResults.push({ raw: judgeRaw, parsed: null });
        continue;
      }

      session.tournamentProgress!.judgeResults.push({ raw: judgeRaw, parsed: judgeParsed });

      const avgScore = this.charAvgScore(judgeParsed);

      // Early exit logic
      if (judgeParsed.pass && avgScore >= 8.5) {
        // Elite candidate: exit immediately
        candidates.push({ cast: builderParsed, judge: judgeParsed });
        session.buildProgress = { attempt: i + 1, maxAttempts: temperatures.length, status: "passed" };
        console.log(`[TOURNAMENT] Character early-exit after ${i + 1} candidate(s), avgScore=${avgScore.toFixed(1)}`);
        session.lastSavedAt = new Date().toISOString();
        await this.charStore.save(session);
        break;
      } else if (judgeParsed.pass && avgScore >= 8.0) {
        // Good candidate: continue to check next, then decide
        candidates.push({ cast: builderParsed, judge: judgeParsed });
        if (i === 1) {
          session.buildProgress = { attempt: i + 1, maxAttempts: temperatures.length, status: "passed" };
          console.log(`[TOURNAMENT] Character early-exit after ${i + 1} candidate(s), avgScore=${avgScore.toFixed(1)}`);
          session.lastSavedAt = new Date().toISOString();
          await this.charStore.save(session);
          break;
        }
      } else {
        candidates.push({ cast: builderParsed, judge: judgeParsed });
        const isLast = i === temperatures.length - 1;
        session.buildProgress = {
          attempt: i + 1,
          maxAttempts: temperatures.length,
          status: isLast ? "best_effort" : "failed_retrying",
          lastFailReason: judgeParsed.one_fix_instruction,
        };
        session.lastSavedAt = new Date().toISOString();
        await this.charStore.save(session);
      }
    }

    console.log(`[perf] Character tournament completed in ${Date.now() - builderStart}ms (serial with early-exit)`);

    // Single checkpoint save
    session.lastSavedAt = new Date().toISOString();
    await this.charStore.save(session);

    // Record builder prompt history
    const builderResponseSummary = session.tournamentProgress!.builderResults
      .map((r, i) => `Candidate ${i + 1}: ${r.parsed ? Object.keys(r.parsed.characters).join(",") : "FAILED"}`)
      .join(" | ");
    this.recordPromptHistory(
      session, "builder", builderPrompt.system, builderPrompt.user,
      promptOverrides?.builder, builderResponseSummary
    );

    if (candidates.length === 0) {
      session.tournamentProgress = undefined;
      session.buildProgress = undefined;
      session.status = "clarifying";
      await this.charStore.save(session);
      throw new CharacterServiceError("LLM_PARSE_ERROR", "All character builder candidates failed to parse");
    }

    // Move to judge phase
    session.tournamentProgress!.phase = "judges";
    session.lastSavedAt = new Date().toISOString();
    await this.charStore.save(session);

    // Record judge prompt history
    const judgeResponseSummary = session.tournamentProgress!.judgeResults
      .map((r, i) => `Judge ${i + 1}: ${r.parsed ? (r.parsed.pass ? "PASS" : "FAIL") + " avg=" + this.charAvgScore(r.parsed).toFixed(1) : "FAILED"}`)
      .join(" | ");
    const judgeSettled = session.tournamentProgress!.judgeResults;

    // Single checkpoint save after all judges complete
    session.lastSavedAt = new Date().toISOString();
    await this.charStore.save(session);

    // Record judge prompt history
    if (candidates.length > 0) {
      const firstJudgePrompt = this.buildJudgePrompt(candidates[0].cast, session);
      this.recordPromptHistory(
        session, "judge", firstJudgePrompt.system, firstJudgePrompt.user,
        promptOverrides?.judge, judgeResponseSummary
      );
    }

    // Select winner
    session.tournamentProgress!.phase = "selecting";

    const validCandidates: Array<{ cast: CharacterBuilderOutput; judge: CharacterJudgeOutput }> = [];
    for (const c of candidates) {
      if (c.judge) {
        validCandidates.push({ cast: c.cast, judge: c.judge });
      }
    }

    if (validCandidates.length === 0) {
      // All judges failed — fall back to first valid builder output without judge
      const fallbackCast = candidates[0].cast;
      session.revealedCharacters = fallbackCast;
      session.revealedJudge = undefined;
      session.status = "revealed";
      session.rerollCount = resetRerollCount ? 0 : (session.rerollCount ?? 0) + 1;
      session.tournamentProgress = undefined;
      session.buildProgress = undefined;
      session.lastSavedAt = new Date().toISOString();
      await this.charStore.save(session);
      return {
        characters: fallbackCast,
        judge: null,
        rerollCount: session.rerollCount,
      };
    }

    const winner = this.selectCharacterWinner(validCandidates);

    // Polish descriptions
    try {
      const polished = await this.polishDescriptions(winner.cast, session, modelOverride);
      if (polished) {
        for (const [role, desc] of Object.entries(polished)) {
          if (winner.cast.characters[role]) {
            winner.cast.characters[role].description = desc;
          }
        }
      }
    } catch (err) {
      // Non-fatal: if polish fails, use the raw descriptions
      console.error("CHAR POLISH ERROR (using raw descriptions):", err);
    }

    // Validate presentation field on each character (critical for downstream image gen)
    const validPresentations = ["male", "female", "androgynous", "non-binary", "unspecified"];
    for (const [roleKey, profile] of Object.entries(winner.cast.characters)) {
      const p = (profile as any).presentation;
      if (p && !validPresentations.includes(p)) {
        console.warn(`[CHARACTER] Invalid presentation "${p}" for ${roleKey} — coercing to "unspecified"`);
        (profile as any).presentation = "unspecified";
      }
    }

    session.revealedCharacters = winner.cast;
    session.revealedJudge = winner.judge;
    session.status = "revealed";
    session.rerollCount = resetRerollCount ? 0 : (session.rerollCount ?? 0) + 1;
    session.tournamentProgress = undefined;  // Clear progress on success
    session.buildProgress = undefined;       // Clear build progress on reveal
    session.lastSavedAt = new Date().toISOString();

    await this.charStore.save(session);

    return {
      characters: winner.cast,
      judge: {
        passed: winner.judge.pass,
        hard_fail_reasons: winner.judge.hard_fail_reasons,
        scores: winner.judge.scores,
        weakest_character: winner.judge.weakest_character,
        one_fix_instruction: winner.judge.one_fix_instruction,
      },
      rerollCount: session.rerollCount,
    };
  }

  /**
   * Select the best cast from tournament candidates.
   * Prefers passing candidates sorted by average score.
   * Falls back to fewest hard-fails if none pass.
   */
  private selectCharacterWinner(
    candidates: Array<{ cast: CharacterBuilderOutput; judge: CharacterJudgeOutput }>
  ): { cast: CharacterBuilderOutput; judge: CharacterJudgeOutput } {
    const passed = candidates.filter(c => c.judge.pass);

    if (passed.length > 0) {
      passed.sort((a, b) => this.charAvgScore(b.judge) - this.charAvgScore(a.judge));
      return passed[0];
    }

    // None passed — pick the one with fewest hard-fail reasons, break ties by score
    const sorted = [...candidates].sort((a, b) => {
      const failDiff = a.judge.hard_fail_reasons.length - b.judge.hard_fail_reasons.length;
      if (failDiff !== 0) return failDiff;
      return this.charAvgScore(b.judge) - this.charAvgScore(a.judge);
    });
    return sorted[0];
  }

  /**
   * Weighted average score — relationship_dynamics counts double (highest weight per judge prompt).
   * Total weights: 1+2+1+1+1+1 = 7
   */
  private charAvgScore(judge: CharacterJudgeOutput): number {
    const s = judge.scores;
    return (s.psychological_depth + s.relationship_dynamics * 2 + s.diversity
      + s.mechanism_clarity + s.specificity + s.user_fit) / 7;
  }

  // ─── Lock Characters ───

  async lockCharacters(
    projectId: string,
    modelOverride?: string,
  ): Promise<CharacterPack> {
    const session = await this.charStore.get(projectId);
    if (!session) {
      throw new CharacterServiceError("NOT_FOUND", "Character session not found");
    }
    if (session.status !== "revealed" || !session.revealedCharacters) {
      throw new CharacterServiceError("INVALID_INPUT", "Must be in revealed status to lock");
    }

    // Save before summary call
    session.lastSavedAt = new Date().toISOString();
    await this.charStore.save(session);

    // Generate summary
    const summaryPrompt = this.buildSummaryPrompt(session);
    let summary = "";
    try {
      summary = await this.llm.call("char_summary", summaryPrompt.system, summaryPrompt.user, {
        temperature: 0.5,
        maxTokens: 800,
        modelOverride,
      });
    } catch (err) {
      console.error("CHAR SUMMARY LLM ERROR:", err);
      throw new CharacterServiceError("LLM_CALL_FAILED", "Character summary generation failed");
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

    const cast = session.revealedCharacters;

    // Build locked characters
    const lockedCharacters: CharacterPack["locked"]["characters"] = {};
    for (const [role, profile] of Object.entries(cast.characters)) {
      lockedCharacters[role] = {
        role: profile.role,
        description: profile.description,
        presentation: profile.presentation ?? "unspecified",
        age_range: profile.age_range,
        ethnicity: profile.ethnicity,
        psychological_profile: {
          ...profile.core_dials,
          ...profile.secondary_dials,
        },
        antagonist_dials: profile.antagonist_dials,
        supporting_dials: profile.supporting_dials,
        threshold_statement: profile.threshold_statement ?? "",
        competence_axis: profile.competence_axis ?? "",
        cost_type: profile.cost_type ?? "",
        volatility: profile.volatility ?? "",
      };
    }

    // Module boundary consolidation: prune low-confidence signals before handoff
    if (session.psychologyLedger) {
      session.psychologyLedger = moduleBoundaryConsolidation(session.psychologyLedger);
    }

    const characterPack: CharacterPack = {
      module: "character",
      locked: {
        characters: lockedCharacters,
        ensemble_dynamic: cast.ensemble_dynamic,
        relationship_tensions: cast.relationship_tensions,
        cast_count: Object.keys(cast.characters).length,
        differentiation_matrix: cast.differentiation_matrix,
      },
      preferences: {
        tone_chips: session.sourceHook.preferences?.tone_chips ?? [],
        bans: session.sourceHook.preferences?.bans ?? [],
      },
      source_dna: cast.collision_sources,
      weaknesses: session.revealedJudge?.weaknesses ?? (
        session.revealedJudge?.weakest_character ? [{
          role: session.revealedJudge.weakest_character,
          weakness: session.revealedJudge.one_fix_instruction,
          development_opportunity: `Develop ${session.revealedJudge.weakest_character} further in visual/narrative modules`,
        }] : undefined
      ),
      user_style: {
        control_preference: controlPreference,
        typed_vs_clicked: typedVsClicked,
        total_turns: session.turns.length,
      },
      state_summary: summary.trim(),
      // Store just the ID reference — downstream modules load the hook export separately
      hookpack_reference: { hookProjectId: session.hookProjectId },
    };

    // Update story bible with character module output
    try {
      const existingBible = await runtimeProjectStore.getStoryBible(session.projectId);
      const bible = await storyBibleService.generateBible(
        session.projectId,
        characterPack.state_summary ?? "",
        existingBible ?? undefined,
      );
      await runtimeProjectStore.saveStoryBible(session.projectId, bible);
    } catch (err) {
      console.error("CHAR STORY BIBLE ERROR (non-fatal):", err);
    }

    // Save export separately (clean handoff payload for downstream modules)
    await this.charStore.saveExport(session, characterPack);

    // Session stores status change but NOT the characterPack (that's in the export)
    session.status = "locked";
    session.lastSavedAt = new Date().toISOString();
    await this.charStore.save(session);

    return characterPack;
  }

  // ─── Session Management ───

  async getSession(projectId: string): Promise<CharacterSessionState | null> {
    return this.charStore.get(projectId);
  }

  async resetSession(projectId: string): Promise<void> {
    await this.charStore.delete(projectId);
  }

  // ─── Character Review (Issue 8) ───

  async getCharacterReview(
    projectId: string,
  ): Promise<{
    characters: Array<{
      roleKey: string;
      role: string;
      presentation: string;
      age_range: string;
      ethnicity: string;
      description_summary: string;
      confirmed_traits: Record<string, string>;
      inferred_traits: Record<string, string>;
    }>;
    ready: boolean;
  }> {
    const session = await this.charStore.get(projectId);
    if (!session) {
      throw new CharacterServiceError("NOT_FOUND", "Character session not found");
    }

    const ledger = session.constraintLedger ?? [];
    const characters: Array<{
      roleKey: string; role: string; presentation: string;
      age_range: string; ethnicity: string; description_summary: string;
      confirmed_traits: Record<string, string>; inferred_traits: Record<string, string>;
    }> = [];

    for (const [roleKey, charState] of Object.entries(session.characters)) {
      const confirmed: Record<string, string> = {};
      const inferred: Record<string, string> = {};

      for (const entry of ledger) {
        if (entry.key.startsWith(`${roleKey}.`)) {
          const traitName = entry.key.slice(roleKey.length + 1);
          if (entry.confidence === "confirmed") {
            confirmed[traitName] = entry.value;
          } else {
            inferred[traitName] = entry.value;
          }
        }
      }

      const presentation = confirmed.presentation ?? inferred.presentation ?? "unspecified";
      const age_range = confirmed.age_range ?? inferred.age_range ?? "";
      const ethnicity = confirmed.ethnicity ?? inferred.ethnicity ?? "";

      const descParts: string[] = [];
      if (charState.want) descParts.push(`Wants: ${charState.want}`);
      if (charState.misbelief) descParts.push(`Misbelief: ${charState.misbelief}`);
      const description_summary = descParts.join(". ").slice(0, 300) || roleKey;

      characters.push({
        roleKey, role: roleKey, presentation, age_range, ethnicity,
        description_summary, confirmed_traits: confirmed, inferred_traits: inferred,
      });
    }

    return { characters, ready: Object.keys(session.characters).length > 0 };
  }

  async applyCharacterReviewEdits(
    projectId: string,
    edits: Array<{ roleKey: string; field: string; value: string }>,
  ): Promise<{ applied: number }> {
    const session = await this.charStore.get(projectId);
    if (!session) {
      throw new CharacterServiceError("NOT_FOUND", "Character session not found");
    }

    if (!session.constraintLedger) session.constraintLedger = [];
    const ledger = session.constraintLedger;
    const turnNumber = session.turns.length;
    let applied = 0;

    for (const edit of edits) {
      const trimmed = edit.value.trim();
      if (!trimmed) continue;

      const key = `${edit.roleKey}.${edit.field}`;
      const existingIdx = ledger.findIndex((e) => e.key === key);
      const entry: CharacterLedgerEntry = {
        key, value: trimmed, source: "user_freeform", confidence: "confirmed", turnNumber,
      };

      if (existingIdx >= 0) {
        ledger[existingIdx] = entry;
      } else {
        ledger.push(entry);
      }
      applied++;
    }

    await this.charStore.save(session);
    return { applied };
  }

  // ─── Prompt Builders (private) ───
  //
  // STORAGE vs PROMPT BOUNDARY
  // ===========================
  // These prompt builders produce a CURATED payload — deliberately smaller than what's in storage.
  //
  // What goes into the LLM prompt (curated):
  //   - Hook summary (premise, hook_sentence, emotional_promise, core_engine)
  //   - Prior turns: last 2 full, older ones compressed to one-line summaries
  //   - Constraint ledger: imported entries compressed, confirmed/inferred shown in full
  //   - Psychology context: top 6 hypotheses, last turn's delta, heuristics
  //   - Current cast state (stripped of nil values)
  //   - Character seed input
  //
  // What stays in storage only (never sent to LLM):
  //   - Full turn history (all turns, all fields, all assumption details)
  //   - Raw builder/judge outputs (revealedCharacters, revealedJudge)
  //   - Full psychology store (all 10 hypotheses, all 5 deltas, all 10 reads)
  //   - Full constraint ledger evidence chains
  //   - Prompt history entries
  //   - Character export (saved separately via charStore.saveExport())

  private async buildClarifierPrompt(session: CharacterSessionState): Promise<{
    system: string;
    user: string;
    cacheableUserPrefix?: string;
  }> {
    const hook = session.sourceHook;
    const castStateJson = JSON.stringify(this.stripNilCharacters(session.characters));
    const upstreamTargets = this.formatUpstreamTargetsFromHook(session.sourceHook);

    // Static prefix — cacheable (hook data, cast state, character seed don't change between turns)
    const prefix = CHARACTER_CLARIFIER_USER_PREFIX
      .replace("{{PREMISE}}", hook.locked.premise)
      .replace("{{HOOK_SENTENCE}}", hook.locked.hook_sentence)
      .replace("{{EMOTIONAL_PROMISE}}", hook.locked.emotional_promise)
      .replace("{{CORE_ENGINE_JSON}}", JSON.stringify(hook.locked.core_engine))
      .replace("{{SETTING}}", hook.locked.core_engine.setting_anchor ?? "")
      .replace("{{TONE_CHIPS}}", JSON.stringify(hook.preferences?.tone_chips ?? []))
      .replace("{{BAN_LIST}}", JSON.stringify(hook.preferences?.bans ?? []))
      .replace("{{STATE_SUMMARY}}", this.compressStateSummary(hook.state_summary ?? ""))
      .replace("{{CAST_STATE_JSON}}", castStateJson)
      .replace("{{CHARACTER_SEED}}", session.characterSeed ?? "(none provided)")
      .replace("{{UPSTREAM_DEVELOPMENT_TARGETS}}", upstreamTargets);

    // Dynamic suffix — changes each turn (prior turns, psychology, ledger, turn number, probes, direction map)
    const priorTurns = this.formatPriorTurns(session.turns);
    const ledgerText = this.formatLedgerForPrompt(session.constraintLedger ?? []);
    const turnNumber = String(session.turns.length + 1);
    const psychText = formatPsychologyLedgerForPrompt(session.psychologyLedger);
    const probeText = formatSuggestedProbeForPrompt(session.psychologyLedger);
    const currentTurn = session.turns.length + 1;
    const directionMapText = formatDirectionMapForPrompt(session.psychologyLedger, currentTurn);

    let dynamic = CHARACTER_CLARIFIER_USER_DYNAMIC
      .replace("{{PRIOR_TURNS}}", priorTurns)
      .replace("{{PSYCHOLOGY_LEDGER}}", psychText)
      .replace("{{ENGINE_DIALS}}", formatEngineDialsForPrompt(session.psychologyLedger))
      .replace("{{CONSTRAINT_LEDGER}}", ledgerText)
      .replace("{{TURN_NUMBER}}", turnNumber);

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
      system: CHARACTER_CLARIFIER_SYSTEM,
      user: prefix + dynamic,
      cacheableUserPrefix: prefix,
    };
  }

  private async buildBuilderPrompt(session: CharacterSessionState): Promise<{
    system: string;
    user: string;
    cacheableUserPrefix?: string;
  }> {
    const hook = session.sourceHook;
    const castStateJson = JSON.stringify(this.stripNilCharacters(session.characters));
    const upstreamTargets = this.formatUpstreamTargetsFromHook(session.sourceHook);

    // Static prefix — cacheable (hook data, cast state, character seed, tone chips, bans don't change)
    const prefix = CHARACTER_BUILDER_USER_PREFIX
      .replace("{{PREMISE}}", hook.locked.premise)
      .replace("{{HOOK_SENTENCE}}", hook.locked.hook_sentence)
      .replace("{{EMOTIONAL_PROMISE}}", hook.locked.emotional_promise)
      .replace("{{CORE_ENGINE_JSON}}", JSON.stringify(hook.locked.core_engine))
      .replace("{{SETTING}}", hook.locked.core_engine.setting_anchor ?? "")
      .replace("{{CAST_STATE_JSON}}", castStateJson)
      .replace("{{TONE_CHIPS}}", JSON.stringify(hook.preferences?.tone_chips ?? []))
      .replace("{{BAN_LIST}}", JSON.stringify(hook.preferences?.bans ?? []))
      .replace("{{CHARACTER_SEED}}", session.characterSeed ?? "(none provided)")
      .replace("{{UPSTREAM_DEVELOPMENT_TARGETS}}", upstreamTargets);

    // Dynamic suffix — changes (prior turns, psychology signals, constraint ledger)
    const ledgerText = this.formatLedgerForPrompt(session.constraintLedger ?? [], false);
    const signalsText = formatSignalsForBuilderJudge(session.psychologyLedger);
    let dynamic = CHARACTER_BUILDER_USER_DYNAMIC
      .replace("{{PRIOR_TURNS}}", this.formatPriorTurns(session.turns))
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
      system: CHARACTER_BUILDER_SYSTEM,
      user: prefix + dynamic,
      cacheableUserPrefix: prefix,
    };
  }

  // ─── Cultural Intelligence Engine helpers ───

  private async getCulturalBrief(
    session: CharacterSessionState,
    turnNumber: number,
  ): Promise<import("../../shared/types/cultural").CulturalBrief | null> {
    return culturalResearchService.getBriefForClarifier({
      projectId: session.projectId,
      module: "character",
      turnNumber,
      lockedPacksSummary: this.buildLockedPacksSummary(session),
      currentState: session.characters as Record<string, unknown>,
      constraintLedger: this.formatLedgerForPrompt(session.constraintLedger ?? []),
      psychologySummary: formatPsychologyLedgerForPrompt(session.psychologyLedger) ?? "",
      directedReferences: this.extractDirectedReferences(session),
    });
  }

  private async getCulturalBriefForBuilder(
    session: CharacterSessionState,
  ): Promise<import("../../shared/types/cultural").CulturalBrief | null> {
    return culturalResearchService.getBriefForBuilder(
      session.projectId, "character", session.turns.length,
    );
  }

  private async fireBackgroundCulturalResearch(
    session: CharacterSessionState,
    turnNumber: number,
  ): Promise<void> {
    const context: CulturalResearchContext = {
      projectId: session.projectId,
      module: "character",
      turnNumber,
      lockedPacksSummary: this.buildLockedPacksSummary(session),
      currentState: session.characters as Record<string, unknown>,
      constraintLedger: this.formatLedgerForPrompt(session.constraintLedger ?? []),
      psychologySummary: formatPsychologyLedgerForPrompt(session.psychologyLedger) ?? "",
      directedReferences: this.extractDirectedReferences(session),
    };
    await culturalResearchService.fireBackgroundResearch(context);
  }

  private buildLockedPacksSummary(session: CharacterSessionState): string {
    const hook = session.sourceHook;
    return `HOOK: ${hook.locked.hook_sentence} — ${hook.locked.emotional_promise}`;
  }

  private extractDirectedReferences(session: CharacterSessionState): string[] {
    const refs: string[] = [];
    const recentTurns = session.turns.slice(-3);
    for (const t of recentTurns) {
      if (t.userSelection?.type === "free_text" && t.userSelection.label) {
        refs.push(...detectDirectedReferences(t.userSelection.label));
      }
    }
    return [...new Set(refs)];
  }

  private buildJudgePrompt(
    cast: CharacterBuilderOutput,
    session: CharacterSessionState
  ): { system: string; user: string } {
    const hook = session.sourceHook;
    const castStateJson = JSON.stringify(this.stripNilCharacters(session.characters));
    const signalsText = formatSignalsForBuilderJudge(session.psychologyLedger);

    const upstreamTargets = this.formatUpstreamTargetsFromHook(session.sourceHook);

    const user = CHARACTER_JUDGE_USER_TEMPLATE
      .replace("{{CAST_JSON}}", JSON.stringify(cast))
      .replace("{{PREMISE}}", hook.locked.premise)
      .replace("{{EMOTIONAL_PROMISE}}", hook.locked.emotional_promise)
      .replace("{{CAST_STATE_JSON}}", castStateJson)
      .replace("{{PSYCHOLOGY_SIGNALS}}", signalsText)
      .replace("{{UPSTREAM_DEVELOPMENT_TARGETS}}", upstreamTargets);

    return { system: CHARACTER_JUDGE_SYSTEM, user };
  }

  private buildSummaryPrompt(session: CharacterSessionState): {
    system: string;
    user: string;
  } {
    const hook = session.sourceHook;
    const castStateJson = JSON.stringify(this.stripNilCharacters(session.characters));

    const user = CHARACTER_SUMMARY_USER_TEMPLATE
      .replace("{{HOOK_SENTENCE}}", hook.locked.hook_sentence)
      .replace("{{PREMISE}}", hook.locked.premise)
      .replace("{{PRIOR_TURNS}}", this.formatPriorTurns(session.turns))
      .replace("{{CAST_STATE_JSON}}", castStateJson)
      .replace("{{CAST_JSON}}", JSON.stringify(session.revealedCharacters ?? {}));

    return { system: CHARACTER_SUMMARY_SYSTEM, user };
  }

  // ─── Polish Descriptions ───

  private async polishDescriptions(
    cast: CharacterBuilderOutput,
    session: CharacterSessionState,
    modelOverride?: string
  ): Promise<Record<string, string> | null> {
    const hook = session.sourceHook;
    const charsJson: Record<string, string> = {};
    for (const [role, profile] of Object.entries(cast.characters)) {
      charsJson[role] = profile.description;
    }

    const user = CHARACTER_POLISH_USER_TEMPLATE
      .replace("{{CHARACTERS_JSON}}", JSON.stringify(charsJson, null, 2))
      .replace("{{EMOTIONAL_PROMISE}}", hook.locked.emotional_promise)
      .replace("{{BAN_LIST}}", JSON.stringify(hook.preferences?.bans ?? []));

    const raw = await this.llm.call("char_polish", CHARACTER_POLISH_SYSTEM, user, {
      temperature: 0.4,
      maxTokens: 2000,
      modelOverride,
    });

    try {
      const parsed = JSON.parse(raw.trim());
      if (typeof parsed === "object" && parsed !== null) {
        return parsed as Record<string, string>;
      }
    } catch {
      console.error("CHAR POLISH parse failed, using raw descriptions");
    }

    return null;
  }

  // ─── Formatting Helpers ───

  /**
   * Format prior turns for the prompt.
   * COMPRESSION STRATEGY: Adaptive window — show 2 recent turns in full for short sessions,
   * compress to 1 for longer ones. Older turns get compressed to question + response.
   * Full historical detail lives in the constraint ledger, not the turn history.
   */
  private formatPriorTurns(turns: CharacterTurn[]): string {
    if (turns.length === 0) return "(No conversation yet)";

    // Adaptive: keep 2 full turns when session is short (≤3), compress to 1 when longer
    const RECENT_WINDOW = turns.length <= 3 ? 2 : 1;
    const recentStart = Math.max(0, turns.length - RECENT_WINDOW);

    const lines: string[] = [];

    // Older turns: compressed
    for (let i = 0; i < recentStart; i++) {
      const turn = turns[i];
      const parts: string[] = [];
      parts.push(`[Turn ${turn.turnNumber}] (summary)`);
      if (turn.clarifierResponse.character_focus) {
        parts.push(`  Focus: ${turn.clarifierResponse.character_focus}`);
      }
      parts.push(`  Asked: "${turn.clarifierResponse.question}"`);

      // User response only
      if (!turn.userSelection) {
        parts.push(`  → No response yet`);
      } else if (turn.userSelection.type === "option") {
        parts.push(`  → Chose: "${turn.userSelection.label}"`);
      } else if (turn.userSelection.type === "surprise_me") {
        parts.push(`  → (surprise me)`);
      } else {
        parts.push(`  → Typed: "${turn.userSelection.label}"`);
      }

      // Compressed assumption responses: just the action + key decisions
      if (turn.assumptionResponses && turn.assumptionResponses.length > 0) {
        const kept = turn.assumptionResponses.filter((r) => r.action === "keep").length;
        const changed = turn.assumptionResponses.filter((r) => r.action === "alternative" || r.action === "freeform");
        const deferred = turn.assumptionResponses.filter((r) => r.action === "not_ready").length;
        const changeSummary = changed.map((r) => `${r.characterRole}.${r.category}→"${r.newValue}"`).join("; ");
        parts.push(`  → Assumptions: ${kept} kept, ${changed.length} changed, ${deferred} deferred${changeSummary ? ` [changes: ${changeSummary}]` : ""}`);
      }

      lines.push(parts.join("\n"));
    }

    // Recent turns: full detail
    for (let i = recentStart; i < turns.length; i++) {
      const turn = turns[i];
      const parts: string[] = [];
      parts.push(`[Turn ${turn.turnNumber}]`);

      if (turn.clarifierResponse.hypothesis_line) {
        parts.push(`  Hypothesis: "${turn.clarifierResponse.hypothesis_line}"`);
      }

      if (turn.clarifierResponse.character_focus) {
        parts.push(`  Focus: ${turn.clarifierResponse.character_focus}`);
      }

      parts.push(`  Asked: "${turn.clarifierResponse.question}"`);

      // Characters surfaced
      if (turn.clarifierResponse.characters_surfaced?.length > 0) {
        for (const char of turn.clarifierResponse.characters_surfaced) {
          const tag = char.newToConversation ? "(NEW)" : "";
          parts.push(`  Character: ${char.role} ${tag}`);
          if (char.assumptions?.length > 0) {
            const assumSummary = char.assumptions
              .map((a) => `${a.id}(${a.category}): "${a.assumption}"`)
              .join("; ");
            parts.push(`    Assumptions: ${assumSummary}`);
          }
        }
      }

      // Relationship updates
      if (turn.clarifierResponse.relationship_updates?.length > 0) {
        for (const rel of turn.clarifierResponse.relationship_updates) {
          parts.push(`  Relationship ${rel.characterA}↔${rel.characterB}: stated="${rel.statedDynamic}" true="${rel.trueDynamic}"`);
        }
      }

      // User response
      if (!turn.userSelection) {
        parts.push(`  → User pending selection.`);
      } else if (turn.userSelection.type === "option") {
        parts.push(`  → User chose [${turn.userSelection.optionId}]: "${turn.userSelection.label}"`);
      } else if (turn.userSelection.type === "surprise_me") {
        parts.push(`  → User chose: (surprise me)`);
      } else {
        parts.push(`  → User typed: "${turn.userSelection.label}"`);
      }

      // Full assumption responses
      if (turn.assumptionResponses && turn.assumptionResponses.length > 0) {
        parts.push(`  → Assumption responses:`);
        for (const resp of turn.assumptionResponses) {
          if (resp.action === "keep") {
            parts.push(`    ${resp.assumptionId}(${resp.characterRole}.${resp.category}): KEPT "${resp.originalValue}"`);
          } else if (resp.action === "alternative") {
            parts.push(`    ${resp.assumptionId}(${resp.characterRole}.${resp.category}): CHANGED to "${resp.newValue}"`);
          } else if (resp.action === "freeform") {
            parts.push(`    ${resp.assumptionId}(${resp.characterRole}.${resp.category}): USER WROTE "${resp.newValue}"`);
          } else if (resp.action === "not_ready") {
            parts.push(`    ${resp.assumptionId}(${resp.characterRole}.${resp.category}): NOT READY YET`);
          }
        }
      }

      // Conflict flag from this turn (so the LLM knows what it flagged)
      if (turn.clarifierResponse.conflict_flag) {
        parts.push(`  ⚠ Conflict flagged: "${turn.clarifierResponse.conflict_flag}"`);
      }

      lines.push(parts.join("\n"));
    }

    return lines.join("\n\n");
  }

  private processAssumptionResponses(
    session: CharacterSessionState,
    responses: CharacterAssumptionResponse[],
    turnNumber: number
  ): void {
    const ledger = session.constraintLedger!;

    for (const resp of responses) {
      if (resp.action === "not_ready") continue;

      const source =
        resp.action === "keep" ? "user_kept_assumption" as const :
        resp.action === "alternative" ? "user_changed_assumption" as const :
        "user_freeform" as const;

      const value = resp.action === "keep" ? resp.originalValue : resp.newValue;
      const ledgerKey = `${resp.characterRole}.${resp.category}`;

      const existingIdx = ledger.findIndex((e) => e.key === ledgerKey);

      const entry: CharacterLedgerEntry = {
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

  private processStateUpdatesIntoLedger(
    session: CharacterSessionState,
    stateUpdates: Record<string, CharacterStateUpdate>,
    turnNumber: number
  ): void {
    const ledger = session.constraintLedger!;

    for (const [role, update] of Object.entries(stateUpdates)) {
      for (const [key, value] of Object.entries(update)) {
        if (typeof value !== "string" || !value.trim()) continue;

        const ledgerKey = `${role}.${key}`;
        const existingIdx = ledger.findIndex((e) => e.key === ledgerKey);

        if (existingIdx >= 0) {
          if (ledger[existingIdx].confidence === "confirmed") continue;
          ledger[existingIdx] = {
            key: ledgerKey,
            value: value.trim(),
            source: "llm_inferred",
            confidence: "inferred",
            turnNumber,
          };
        } else {
          ledger.push({
            key: ledgerKey,
            value: value.trim(),
            source: "llm_inferred",
            confidence: "inferred",
            turnNumber,
          });
        }
      }
    }
  }

  /**
   * Compress the hook state summary to avoid bloating the character clarifier prompt.
   * The full hook context (premise, core engine, etc.) is already injected separately,
   * so the summary just needs the key creative decisions and unresolved threads.
   * Cap at ~500 chars.
   */
  private compressStateSummary(summary: string): string {
    if (!summary) return "";
    if (summary.length <= 500) return summary;
    // Take the first 500 chars and cut at the last sentence boundary
    const truncated = summary.slice(0, 500);
    const lastPeriod = truncated.lastIndexOf(".");
    const lastNewline = truncated.lastIndexOf("\n");
    const cutPoint = Math.max(lastPeriod, lastNewline);
    return cutPoint > 200 ? truncated.slice(0, cutPoint + 1) + " [...]" : truncated + "...";
  }

  /**
   * Format constraint ledger for the prompt.
   * COMPRESSION STRATEGY:
   * - Imported hook entries: compressed to a brief summary (full hook context is already in the prompt)
   * - Confirmed entries: full detail (these are authoritative)
   * - Inferred entries: full detail (LLM needs to know what to update/surface)
   */
  /**
   * @param compress If true, imported hook entries are compressed to key-only.
   *                 Use compress=true for clarifier (where hook context is already in the prompt).
   *                 Use compress=false for builder/judge (where they need the full values).
   */
  private formatLedgerForPrompt(ledger: CharacterLedgerEntry[], compress = true): string {
    if (!ledger || ledger.length === 0) return "(No constraints established yet)";

    const confirmed = ledger.filter((e) => e.confidence === "confirmed");
    const inferred = ledger.filter((e) => e.confidence === "inferred");
    const imported = ledger.filter((e) => e.confidence === "imported");

    const lines: string[] = [];

    if (imported.length > 0) {
      if (compress) {
        // Compressed: just list keys since full hook context is already in the prompt
        const importedKeys = imported.map((e) => e.key).join(", ");
        lines.push(`IMPORTED from hook (${imported.length} entries — full context above): ${importedKeys}`);
      } else {
        // Full: include values for builder/judge
        lines.push("IMPORTED from hook module (context — can build on these):");
        for (const e of imported) {
          lines.push(`  - ${e.key}: "${e.value}"`);
        }
      }
    }

    if (confirmed.length > 0) {
      lines.push("CONFIRMED by user (MUST honor — do NOT contradict or re-ask):");
      for (const e of confirmed) {
        lines.push(`  - ${e.key}: "${e.value}" [turn ${e.turnNumber}]`);
      }
    }

    if (inferred.length > 0) {
      lines.push("INFERRED by you (user hasn't weighed in — can surface as assumption):");
      for (const e of inferred) {
        lines.push(`  - ${e.key}: "${e.value}" [turn ${e.turnNumber}]`);
      }
    }

    lines.push(`\nUser-shaped: ${confirmed.length} confirmed, ${inferred.length} inferred, ${imported.length} imported`);

    return lines.join("\n");
  }

  // ─── Upstream Development Targets ───

  /**
   * Format upstream development targets from the HookPack for injection into prompts.
   * Includes: open_threads (unexplored narrative threads) and unused_assumptions
   * (things surfaced during hook but not used in the final hook output).
   */
  private formatUpstreamTargetsFromHook(hook: HookPack): string {
    const lines: string[] = [];

    // Open threads from hook
    if (hook.open_threads && hook.open_threads.length > 0) {
      lines.push("OPEN THREADS (from hook — narrative threads worth developing through characters):");
      for (const thread of hook.open_threads) {
        lines.push(`  - ${thread}`);
      }
    }

    // Unused assumptions from hook (things the user considered but didn't use)
    if (hook.unused_assumptions && hook.unused_assumptions.length > 0) {
      const relevant = hook.unused_assumptions.filter(a =>
        a.status !== "rejected" // Only include deferred/unused, not rejected
      );
      if (relevant.length > 0) {
        lines.push("UNUSED ASSUMPTIONS (from hook — user saw these but they weren't used; may be worth exploring):");
        for (const a of relevant.slice(0, 5)) { // Cap at 5 to avoid bloat
          lines.push(`  - [${a.category}] ${a.assumption}`);
        }
      }
    }

    if (lines.length === 0) {
      return "(No upstream targets)";
    }

    return lines.join("\n");
  }

  // ─── State Helpers ───

  private mergeCharacterState(
    current: CharacterStateUpdate,
    update: CharacterStateUpdate
  ): CharacterStateUpdate {
    const next: CharacterStateUpdate = { ...current };
    for (const [key, value] of Object.entries(update)) {
      if (typeof value === "string" && value.trim()) {
        (next as any)[key] = value;
      }
    }
    return next;
  }

  private stripNilCharacters(
    characters: Record<string, CharacterStateUpdate>
  ): Record<string, CharacterStateUpdate> {
    const result: Record<string, CharacterStateUpdate> = {};
    for (const [role, state] of Object.entries(characters)) {
      const clean: CharacterStateUpdate = {};
      for (const [key, v] of Object.entries(state)) {
        if (v !== undefined && v !== null && v !== "") {
          (clean as any)[key] = v;
        }
      }
      if (Object.keys(clean).length > 0) {
        result[role] = clean;
      }
    }
    return result;
  }

  private parseAndValidate<T>(raw: string, requiredFields: string[]): T | null {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const field of requiredFields) {
        if (!(field in parsed)) return null;
      }
      return parsed as T;
    } catch {
      return null;
    }
  }

  private recordPromptHistory(
    session: CharacterSessionState,
    stage: CharacterPromptHistoryEntry["stage"],
    defaultSystem: string,
    defaultUser: string,
    overrides?: CharacterPromptOverrides,
    responseSummary?: string
  ): void {
    if (!session.promptHistory) session.promptHistory = [];
    const wasEdited = !!(overrides?.system || overrides?.user);
    session.promptHistory.push({
      timestamp: new Date().toISOString(),
      stage,
      turnNumber: session.turns.length + 1,
      defaultSystem,
      defaultUser,
      editedSystem: overrides?.system,
      editedUser: overrides?.user,
      wasEdited,
      responseSummary: responseSummary?.slice(0, 500),
      provider: this.llm.lastCallProvenance?.provider,
      model: this.llm.lastCallProvenance?.model,
    });
  }

  getPromptHistory(session: CharacterSessionState): CharacterPromptHistoryEntry[] {
    return session.promptHistory ?? [];
  }

  /** Compute interaction heuristics from turn data for the psychology ledger */
  private updatePsychologyHeuristics(session: CharacterSessionState): void {
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
}
