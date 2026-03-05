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
  CHARACTER_BUILDER_USER_TEMPLATE,
  CHARACTER_CLARIFIER_SYSTEM,
  CHARACTER_CLARIFIER_USER_TEMPLATE,
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
  recordAssumptionDelta,
  updateHeuristics,
  checkPersistence,
  formatPsychologyLedgerForPrompt,
  snapshotBaselineForNewModule,
} from "./psychologyEngine";

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
        const prompt = this.buildClarifierPrompt(session);
        return { stage, system: prompt.system, user: prompt.user };
      }
      case "builder": {
        const prompt = this.buildBuilderPrompt(session);
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

    const prompt = this.buildClarifierPrompt(session);
    const systemPrompt = promptOverrides?.system ?? prompt.system;
    const userPrompt = promptOverrides?.user ?? prompt.user;

    let clarifierRaw: string;
    try {
      clarifierRaw = await this.llm.call("char_clarifier", systemPrompt, userPrompt, {
        temperature: 0.7,
        maxTokens: 3500,
        modelOverride,
        jsonSchema: CHARACTER_CLARIFIER_SCHEMA,
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

    // ─── Psychology Ledger: record LLM's structured hypotheses + update heuristics ───
    if (!session.psychologyLedger) session.psychologyLedger = createEmptyLedger();
    if (clarifier.user_read && typeof clarifier.user_read === "object") {
      recordHypotheses(
        session.psychologyLedger,
        session.turns.length + 1,
        "character",
        clarifier.user_read.hypotheses ?? [],
        clarifier.user_read.overall_read ?? "",
        clarifier.user_read.satisfaction
      );
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
      turn.clarifierResponse.ready_for_characters = true;
      turn.clarifierResponse.readiness_note =
        turn.clarifierResponse.readiness_note || "Your cast has been taking shape nicely — ready to meet them!";
    }

    session.turns.push(turn);
    session.status = "clarifying";
    session.lastSavedAt = new Date().toISOString();

    await this.charStore.save(session);

    return {
      clarifier: turn.clarifierResponse,
      turnNumber: turn.turnNumber,
      totalTurns: session.turns.length,
    };
  }

  // ─── Generate (single pass + judge) ───

  async runGenerate(
    projectId: string,
    modelOverride?: string,
    promptOverrides?: { builder?: CharacterPromptOverrides; judge?: CharacterPromptOverrides },
  ): Promise<CharacterGenerateResponse> {
    const session = await this.charStore.get(projectId);
    if (!session) {
      throw new CharacterServiceError("NOT_FOUND", "Character session not found");
    }

    session.status = "generating";
    session.lastSavedAt = new Date().toISOString();
    await this.charStore.save(session);

    // Build prompts
    const builderPrompt = this.buildBuilderPrompt(session);
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

    // Single builder pass (no tournament for characters)
    let builderRaw: string;
    try {
      builderRaw = await this.llm.call("char_builder", builderSystem, builderUser, {
        temperature: 0.8,
        maxTokens: builderMaxTokens,
        modelOverride,
        jsonSchema: CHARACTER_BUILDER_SCHEMA,
      });
    } catch (err) {
      console.error("CHAR BUILDER LLM ERROR:", err);
      session.status = "clarifying";
      await this.charStore.save(session);
      throw new CharacterServiceError("LLM_CALL_FAILED", "Character builder call failed");
    }

    console.log("CHAR BUILDER RAW (first 500):", builderRaw.slice(0, 500));

    let builderResult = this.parseAndValidate<CharacterBuilderOutput>(builderRaw, [
      "characters", "ensemble_dynamic", "relationship_tensions",
      "structural_diversity", "collision_sources",
    ]);

    if (!builderResult) {
      console.error("CHAR BUILDER PARSE FAILED. Full raw length:", builderRaw.length);
      console.error("CHAR BUILDER RAW (first 2000):", builderRaw.slice(0, 2000));
      // Try to parse just to see the error
      try { JSON.parse(builderRaw); console.log("JSON.parse succeeded but field check failed"); } catch (e) { console.error("JSON.parse failed:", e); }
    }

    // Convert characters from LLM array format to Record<role, profile>
    if (builderResult && Array.isArray(builderResult.characters)) {
      const charsRecord: Record<string, any> = {};
      for (const profile of builderResult.characters as any[]) {
        if (profile.role) {
          charsRecord[profile.role] = profile;
        }
      }
      builderResult.characters = charsRecord;
    }

    if (!builderResult) {
      session.status = "clarifying";
      await this.charStore.save(session);
      throw new CharacterServiceError("LLM_PARSE_ERROR", "Failed to parse character builder response");
    }

    // Record builder prompt history
    this.recordPromptHistory(
      session, "builder", builderPrompt.system, builderPrompt.user,
      promptOverrides?.builder,
      Object.keys(builderResult.characters).join(", ")
    );

    // Save after builder
    session.lastSavedAt = new Date().toISOString();
    await this.charStore.save(session);

    // Judge pass
    const judgePrompt = this.buildJudgePrompt(builderResult, session);
    const judgeSystem = promptOverrides?.judge?.system ?? judgePrompt.system;
    const judgeUser = promptOverrides?.judge?.user ?? judgePrompt.user;

    let judgeRaw: string;
    try {
      judgeRaw = await this.llm.call("char_judge", judgeSystem, judgeUser, {
        temperature: 0.3,
        maxTokens: 1200,
        modelOverride,
        jsonSchema: CHARACTER_JUDGE_SCHEMA,
      });
    } catch (err) {
      console.error("CHAR JUDGE LLM ERROR:", err);
      // Non-fatal: reveal without judge
      session.revealedCharacters = builderResult;
      session.status = "revealed";
      session.lastSavedAt = new Date().toISOString();
      await this.charStore.save(session);
      return {
        characters: builderResult,
        judge: null,
      };
    }

    const judgeResult = this.parseAndValidate<CharacterJudgeOutput>(judgeRaw, [
      "pass", "hard_fail_reasons", "scores", "weakest_character", "one_fix_instruction",
    ]);

    // Record judge prompt history
    this.recordPromptHistory(
      session, "judge", judgePrompt.system, judgePrompt.user,
      promptOverrides?.judge,
      judgeResult ? `${judgeResult.pass ? "PASS" : "FAIL"} weakest=${judgeResult.weakest_character}` : "PARSE_FAILED"
    );

    // Polish descriptions
    try {
      const polished = await this.polishDescriptions(builderResult, session, modelOverride);
      if (polished) {
        for (const [role, desc] of Object.entries(polished)) {
          if (builderResult.characters[role]) {
            builderResult.characters[role].description = desc;
          }
        }
      }
    } catch (err) {
      console.error("CHAR POLISH ERROR (using raw descriptions):", err);
    }

    session.revealedCharacters = builderResult;
    session.revealedJudge = judgeResult ?? undefined;
    session.status = "revealed";
    session.lastSavedAt = new Date().toISOString();

    await this.charStore.save(session);

    return {
      characters: builderResult,
      judge: judgeResult ? {
        passed: judgeResult.pass,
        hard_fail_reasons: judgeResult.hard_fail_reasons,
        scores: judgeResult.scores,
        weakest_character: judgeResult.weakest_character,
        one_fix_instruction: judgeResult.one_fix_instruction,
      } : null,
    };
  }

  // ─── Reroll (regenerate) ───

  async reroll(
    projectId: string,
    modelOverride?: string,
    promptOverrides?: { builder?: CharacterPromptOverrides; judge?: CharacterPromptOverrides },
  ): Promise<CharacterGenerateResponse> {
    const session = await this.charStore.get(projectId);
    if (!session) {
      throw new CharacterServiceError("NOT_FOUND", "Character session not found");
    }
    if (session.status !== "revealed") {
      throw new CharacterServiceError("INVALID_INPUT", "Must be in revealed status to reroll");
    }

    // Clear revealed state and regenerate
    session.revealedCharacters = undefined;
    session.revealedJudge = undefined;

    return this.runGenerate(projectId, modelOverride, promptOverrides);
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

    const characterPack: CharacterPack = {
      module: "character",
      locked: {
        characters: lockedCharacters,
        ensemble_dynamic: cast.ensemble_dynamic,
        relationship_tensions: cast.relationship_tensions,
        cast_count: Object.keys(cast.characters).length,
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

  private buildClarifierPrompt(session: CharacterSessionState): {
    system: string;
    user: string;
  } {
    const hook = session.sourceHook;
    const castStateJson = JSON.stringify(this.stripNilCharacters(session.characters));
    const priorTurns = this.formatPriorTurns(session.turns);
    const ledgerText = this.formatLedgerForPrompt(session.constraintLedger ?? []);
    const turnNumber = String(session.turns.length + 1);

    const psychText = formatPsychologyLedgerForPrompt(session.psychologyLedger);

    const user = CHARACTER_CLARIFIER_USER_TEMPLATE
      .replace("{{PREMISE}}", hook.locked.premise)
      .replace("{{HOOK_SENTENCE}}", hook.locked.hook_sentence)
      .replace("{{EMOTIONAL_PROMISE}}", hook.locked.emotional_promise)
      .replace("{{CORE_ENGINE_JSON}}", JSON.stringify(hook.locked.core_engine))
      .replace("{{SETTING}}", hook.locked.core_engine.setting_anchor ?? "")
      .replace("{{TONE_CHIPS}}", JSON.stringify(hook.preferences?.tone_chips ?? []))
      .replace("{{BAN_LIST}}", JSON.stringify(hook.preferences?.bans ?? []))
      .replace("{{STATE_SUMMARY}}", this.compressStateSummary(hook.state_summary ?? ""))
      .replace("{{PRIOR_TURNS}}", priorTurns)
      .replace("{{PSYCHOLOGY_LEDGER}}", psychText)
      .replace("{{CONSTRAINT_LEDGER}}", ledgerText)
      .replace("{{CAST_STATE_JSON}}", castStateJson)
      .replace("{{TURN_NUMBER}}", turnNumber)
      .replace("{{CHARACTER_SEED}}", session.characterSeed ?? "(none provided)");

    return { system: CHARACTER_CLARIFIER_SYSTEM, user };
  }

  private buildBuilderPrompt(session: CharacterSessionState): {
    system: string;
    user: string;
  } {
    const hook = session.sourceHook;
    const castStateJson = JSON.stringify(this.stripNilCharacters(session.characters));
    const ledgerText = this.formatLedgerForPrompt(session.constraintLedger ?? [], false);

    const psychText = formatPsychologyLedgerForPrompt(session.psychologyLedger);

    const user = CHARACTER_BUILDER_USER_TEMPLATE
      .replace("{{PREMISE}}", hook.locked.premise)
      .replace("{{HOOK_SENTENCE}}", hook.locked.hook_sentence)
      .replace("{{EMOTIONAL_PROMISE}}", hook.locked.emotional_promise)
      .replace("{{CORE_ENGINE_JSON}}", JSON.stringify(hook.locked.core_engine))
      .replace("{{SETTING}}", hook.locked.core_engine.setting_anchor ?? "")
      .replace("{{PRIOR_TURNS}}", this.formatPriorTurns(session.turns))
      .replace("{{PSYCHOLOGY_LEDGER}}", psychText)
      .replace("{{CONSTRAINT_LEDGER}}", ledgerText)
      .replace("{{CAST_STATE_JSON}}", castStateJson)
      .replace("{{TONE_CHIPS}}", JSON.stringify(hook.preferences?.tone_chips ?? []))
      .replace("{{BAN_LIST}}", JSON.stringify(hook.preferences?.bans ?? []))
      .replace("{{CHARACTER_SEED}}", session.characterSeed ?? "(none provided)");

    return { system: CHARACTER_BUILDER_SYSTEM, user };
  }

  private buildJudgePrompt(
    cast: CharacterBuilderOutput,
    session: CharacterSessionState
  ): { system: string; user: string } {
    const hook = session.sourceHook;
    const castStateJson = JSON.stringify(this.stripNilCharacters(session.characters));

    const user = CHARACTER_JUDGE_USER_TEMPLATE
      .replace("{{CAST_JSON}}", JSON.stringify(cast))
      .replace("{{PREMISE}}", hook.locked.premise)
      .replace("{{EMOTIONAL_PROMISE}}", hook.locked.emotional_promise)
      .replace("{{CAST_STATE_JSON}}", castStateJson);

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
