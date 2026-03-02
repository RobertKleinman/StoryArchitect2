import {
  ClarifyResponse,
  GenerateResponse,
} from "../../shared/types/api";
import {
  AssumptionResponse,
  ConstraintLedgerEntry,
  HookBuilderOutput,
  HookJudgeOutput,
  HookPack,
  HookSessionState,
  HookStateUpdate,
  HookTurn,
  PromptHistoryEntry,
  PromptOverrides,
  PromptPreview,
  TournamentProgress,
} from "../../shared/types/hook";
import { ProjectStore } from "../storage/projectStore";
import { LLMClient } from "./llmClient";
import {
  HOOK_BUILDER_SYSTEM,
  HOOK_BUILDER_USER_TEMPLATE,
  HOOK_CLARIFIER_SYSTEM,
  HOOK_CLARIFIER_USER_TEMPLATE,
  HOOK_JUDGE_SYSTEM,
  HOOK_JUDGE_USER_TEMPLATE,
  HOOK_SUMMARY_SYSTEM,
  HOOK_SUMMARY_USER_TEMPLATE,
  PREMISE_POLISH_SYSTEM,
  PREMISE_POLISH_USER_TEMPLATE,
} from "./hookPrompts";
import {
  HOOK_BUILDER_SCHEMA,
  HOOK_CLARIFIER_SCHEMA,
  HOOK_JUDGE_SCHEMA,
} from "./hookSchemas";
import {
  createEmptyLedger,
  recordUserRead,
  updateHeuristics,
  formatPsychologyLedgerForPrompt,
} from "./psychologyEngine";

export class HookServiceError extends Error {
  code: "NOT_FOUND" | "INVALID_INPUT" | "LLM_PARSE_ERROR" | "LLM_CALL_FAILED";

  constructor(
    code: "NOT_FOUND" | "INVALID_INPUT" | "LLM_PARSE_ERROR" | "LLM_CALL_FAILED",
    message: string
  ) {
    super(message);
    this.code = code;
  }
}

export class HookService {
  constructor(
    private store: ProjectStore,
    private llm: LLMClient
  ) {}

  /**
   * Preview the prompt that would be sent to the LLM at a given stage.
   * Does NOT call the LLM — just builds and returns the prompts.
   */
  async previewPrompt(
    projectId: string,
    stage: "clarifier" | "builder" | "judge" | "summary",
    seedInput?: string,
    userSelection?: { type: "option" | "free_text" | "surprise_me"; optionId?: string; label: string },
  ): Promise<PromptPreview> {
    let session = await this.store.get(projectId);

    // For clarifier first turn, build a temporary session
    if (!session && stage === "clarifier" && seedInput) {
      session = {
        projectId,
        seedInput,
        turns: [],
        currentState: {},
        rerollCount: 0,
        status: "clarifying",
      };
    }

    if (!session) {
      throw new HookServiceError("NOT_FOUND", "Session not found");
    }

    // If there's a userSelection, temporarily attach it to the last turn for prompt building
    if (userSelection && session.turns.length > 0) {
      const lastTurn = session.turns[session.turns.length - 1];
      if (!lastTurn.userSelection) {
        lastTurn.userSelection = userSelection;
      }
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
        // For judge preview, use the revealed hook if available
        if (session.revealedHook) {
          const prompt = this.buildJudgePrompt(session.revealedHook, session.currentState);
          return { stage, system: prompt.system, user: prompt.user };
        }
        // Otherwise return the template with placeholder
        return {
          stage,
          system: HOOK_JUDGE_SYSTEM,
          user: HOOK_JUDGE_USER_TEMPLATE
            .replace("{{CANDIDATE_JSON}}", "(generated at runtime for each candidate)")
            .replace("{{CURRENT_STATE_JSON}}", JSON.stringify(this.stripNil(session.currentState))),
        };
      }
      case "summary": {
        const prompt = this.buildSummaryPrompt(session);
        return { stage, system: prompt.system, user: prompt.user };
      }
    }
  }

  async runClarifierTurn(
    projectId: string,
    seedInput?: string,
    userSelection?: { type: "option" | "free_text" | "surprise_me"; optionId?: string; label: string },
    modelOverride?: string,
    promptOverrides?: PromptOverrides,
    assumptionResponses?: AssumptionResponse[]
  ): Promise<ClarifyResponse> {
    let session = await this.store.get(projectId);
    const isFirstTurn = !session;

    if (isFirstTurn) {
      if (!seedInput || userSelection) {
        throw new HookServiceError(
          "INVALID_INPUT",
          "First turn requires seedInput and no userSelection"
        );
      }
      session = {
        projectId,
        seedInput,
        turns: [],
        currentState: {},
        constraintLedger: [],
        rerollCount: 0,
        status: "clarifying",
        psychologyLedger: createEmptyLedger(),
      };
    } else {
      if (!session) {
        throw new HookServiceError("NOT_FOUND", "Session not found");
      }

      if (session.status === "revealed" || session.status === "locked") {
        throw new HookServiceError("INVALID_INPUT", "Session already progressed; reset session first");
      }
      if (!userSelection) {
        throw new HookServiceError("INVALID_INPUT", "Subsequent turns require userSelection");
      }

      const previousTurn = session.turns[session.turns.length - 1];
      if (!previousTurn) {
        throw new HookServiceError("INVALID_INPUT", "No clarifier turn exists to attach selection");
      }

      if (userSelection.type === "option") {
        const isValidOption = previousTurn.clarifierResponse.options.some(
          (opt) => opt.id === userSelection.optionId
        );
        if (!userSelection.optionId || !isValidOption) {
          throw new HookServiceError("INVALID_INPUT", "optionId must exist in previous turn options");
        }
      }

      previousTurn.userSelection = userSelection;

      // Store structured assumption responses on the turn
      if (assumptionResponses && assumptionResponses.length > 0) {
        previousTurn.assumptionResponses = assumptionResponses;
      }

      // Process assumption responses into the constraint ledger (deterministic, no LLM needed)
      if (!session.constraintLedger) session.constraintLedger = [];
      this.processAssumptionResponses(session, assumptionResponses ?? [], session.turns.length);
    }

    if (!session) {
      throw new HookServiceError("NOT_FOUND", "Session not found");
    }

    // Save state before LLM call (crash recovery)
    session.lastSavedAt = new Date().toISOString();
    await this.store.save(session);

    const prompt = this.buildClarifierPrompt(session);
    const systemPrompt = promptOverrides?.system ?? prompt.system;
    const userPrompt = promptOverrides?.user ?? prompt.user;

    let clarifierRaw: string;
    try {
      clarifierRaw = await this.llm.call("clarifier", systemPrompt, userPrompt, {
        temperature: 0.7,
        maxTokens: 1800,
        modelOverride,
        jsonSchema: HOOK_CLARIFIER_SCHEMA,
      });
    } catch (err) {
      console.error("CLARIFY LLM ERROR:", err);
      throw new HookServiceError("LLM_CALL_FAILED", "Clarifier call failed");
    }

    let clarifier = this.parseAndValidate<any>(clarifierRaw, [
      "hypothesis_line",
      "question",
      "options",
      "allow_free_text",
      "ready_for_hook",
      "readiness_pct",
      "readiness_note",
      "missing_signal",
      "conflict_flag",
      "assumptions",
      "state_update",
    ]);

    if (!clarifier) {
      try {
        const retryRaw = await this.llm.call("clarifier", systemPrompt, userPrompt, {
          temperature: 0.7,
          maxTokens: 1800,
          modelOverride,
          jsonSchema: HOOK_CLARIFIER_SCHEMA,
        });
        clarifier = this.parseAndValidate<any>(retryRaw, [
          "hypothesis_line",
          "question",
          "options",
          "allow_free_text",
          "ready_for_hook",
          "readiness_pct",
          "readiness_note",
          "missing_signal",
          "conflict_flag",
          "assumptions",
          "state_update",
        ]);
      } catch (err) {
        console.error("CLARIFY RETRY LLM ERROR:", err);
        throw new HookServiceError("LLM_PARSE_ERROR", "Failed to parse clarifier response");
      }

      if (!clarifier) {
        throw new HookServiceError("LLM_PARSE_ERROR", "Failed to parse clarifier response");
      }
    }

    // Record prompt history
    this.recordPromptHistory(
      session, "clarifier", prompt.system, prompt.user, promptOverrides,
      clarifierRaw.slice(0, 500)
    );

    session.currentState = this.mergeStateUpdate(session.currentState, clarifier.state_update);

    // Process LLM's state_update into ledger as inferred entries (only if not already confirmed by user)
    if (!session.constraintLedger) session.constraintLedger = [];
    this.processStateUpdateIntoLedger(session, clarifier.state_update, session.turns.length + 1);

    // ─── Psychology Ledger: record LLM's user_read + update heuristics ───
    if (!session.psychologyLedger) session.psychologyLedger = createEmptyLedger();
    recordUserRead(session.psychologyLedger, session.turns.length + 1, "hook", clarifier.user_read ?? "");
    this.updatePsychologyHeuristics(session);

    const turn: HookTurn = {
      turnNumber: session.turns.length + 1,
      clarifierResponse: clarifier,
      userSelection: null,
    };

    // LLM decides readiness, but suppress it on the very first turn (need at least 1 user response)
    if (session.turns.length < 1 && turn.clarifierResponse.ready_for_hook) {
      turn.clarifierResponse.ready_for_hook = false;
    }

    // Readiness convergence safety net: track consecutive high-readiness turns
    // If the LLM stays at ≥75% for 2+ turns without setting ready_for_hook, force it
    if (turn.clarifierResponse.readiness_pct >= 75) {
      session.consecutiveHighReadiness = (session.consecutiveHighReadiness ?? 0) + 1;
    } else {
      session.consecutiveHighReadiness = 0;
    }

    if (
      session.consecutiveHighReadiness >= 2 &&
      !turn.clarifierResponse.ready_for_hook &&
      session.turns.length >= 3  // minimum 3 turns before forcing
    ) {
      turn.clarifierResponse.ready_for_hook = true;
      turn.clarifierResponse.readiness_note =
        turn.clarifierResponse.readiness_note || "Your hook has been taking shape nicely — ready to see it come to life!";
    }

    session.turns.push(turn);
    session.status = "clarifying";
    session.lastSavedAt = new Date().toISOString();

    await this.store.save(session);

    return {
      clarifier: turn.clarifierResponse,
      turnNumber: turn.turnNumber,
      totalTurns: session.turns.length,
    };
  }

  async runTournament(
    projectId: string,
    modelOverride?: string,
    promptOverrides?: { builder?: PromptOverrides; judge?: PromptOverrides }
  ): Promise<GenerateResponse> {
    const session = await this.store.get(projectId);
    if (!session || !session.seedInput) {
      throw new HookServiceError("NOT_FOUND", "Session not found");
    }
    return this.executeTournament(session, modelOverride, true, promptOverrides);
  }

  async reroll(
    projectId: string,
    modelOverride?: string,
    promptOverrides?: { builder?: PromptOverrides; judge?: PromptOverrides }
  ): Promise<GenerateResponse> {
    const session = await this.store.get(projectId);
    if (!session) {
      throw new HookServiceError("NOT_FOUND", "Session not found");
    }
    if (session.status !== "revealed") {
      throw new HookServiceError("INVALID_INPUT", "Session must be in revealed status to reroll");
    }

    return this.executeTournament(session, modelOverride, false, promptOverrides);
  }

  private async executeTournament(
    session: HookSessionState,
    modelOverride: string | undefined,
    resetRerollCount: boolean,
    promptOverrides?: { builder?: PromptOverrides; judge?: PromptOverrides }
  ): Promise<GenerateResponse> {
    session.status = "generating";

    // Initialize tournament progress for crash recovery
    session.tournamentProgress = {
      startedAt: new Date().toISOString(),
      builderResults: [],
      judgeResults: [],
      phase: "builders",
    };
    session.lastSavedAt = new Date().toISOString();
    await this.store.save(session);

    const builderPrompt = this.buildBuilderPrompt(session);
    const builderSystem = promptOverrides?.builder?.system ?? builderPrompt.system;
    const builderUser = promptOverrides?.builder?.user ?? builderPrompt.user;
    const temperatures = [0.7, 0.85, 1.0];

    // Run builders individually for crash recovery (save after each)
    for (let i = 0; i < temperatures.length; i++) {
      try {
        const raw = await this.llm.call("builder", builderSystem, builderUser, {
          temperature: temperatures[i],
          maxTokens: 2400,
          modelOverride,
          jsonSchema: HOOK_BUILDER_SCHEMA,
        });
        const parsed = this.parseAndValidate<HookBuilderOutput>(raw, [
          "hook_sentence", "emotional_promise", "premise", "opening_image",
          "page_1_splash_prompt", "page_turn_trigger", "why_addictive", "collision_sources",
        ]);
        session.tournamentProgress!.builderResults.push({ raw, parsed });
        if (!parsed) {
          console.error(`BUILDER CANDIDATE ${i + 1} PARSE FAILED. Raw:`, raw.slice(0, 500));
        }
      } catch (err) {
        console.error(`BUILDER CANDIDATE ${i + 1} LLM ERROR:`, err);
        session.tournamentProgress!.builderResults.push({ raw: "", parsed: null });
      }
      // Save after each builder completes
      session.lastSavedAt = new Date().toISOString();
      await this.store.save(session);
    }

    // Record builder prompt history (one entry covers all 3 candidates)
    const builderResponseSummary = session.tournamentProgress!.builderResults
      .map((r, i) => `Candidate ${i + 1}: ${r.parsed ? r.parsed.premise?.slice(0, 100) : "FAILED"}`)
      .join(" | ");
    this.recordPromptHistory(
      session, "builder", builderPrompt.system, builderPrompt.user,
      promptOverrides?.builder, builderResponseSummary
    );

    const hooks: HookBuilderOutput[] = session.tournamentProgress!.builderResults
      .map(r => r.parsed)
      .filter((p): p is HookBuilderOutput => p !== null);

    if (hooks.length === 0) {
      session.tournamentProgress = undefined;
      await this.store.save(session);
      throw new HookServiceError("LLM_PARSE_ERROR", "All builder candidates failed to parse");
    }

    // Move to judge phase
    session.tournamentProgress!.phase = "judges";
    session.lastSavedAt = new Date().toISOString();
    await this.store.save(session);

    // Run judges individually for crash recovery
    for (let i = 0; i < hooks.length; i++) {
      try {
        const judgePrompt = this.buildJudgePrompt(hooks[i], session.currentState);
        const judgeSystem = promptOverrides?.judge?.system ?? judgePrompt.system;
        const judgeUser = promptOverrides?.judge?.user ?? judgePrompt.user;
        const raw = await this.llm.call("judge", judgeSystem, judgeUser, {
          temperature: 0.3,
          modelOverride,
          jsonSchema: HOOK_JUDGE_SCHEMA,
        });
        const parsed = this.parseAndValidate<HookJudgeOutput>(raw, [
          "pass", "hard_fail_reasons", "scores",
          "most_generic_part", "one_fix_instruction",
        ]);
        session.tournamentProgress!.judgeResults.push({ raw, parsed });
        if (!parsed) {
          console.error(`JUDGE ${i + 1} PARSE FAILED. Raw:`, raw.slice(0, 500));
        }
      } catch (err) {
        console.error(`JUDGE ${i + 1} LLM ERROR:`, err);
        session.tournamentProgress!.judgeResults.push({ raw: "", parsed: null });
      }
      // Save after each judge completes
      session.lastSavedAt = new Date().toISOString();
      await this.store.save(session);
    }

    // Record judge prompt history
    if (hooks.length > 0) {
      const firstJudgePrompt = this.buildJudgePrompt(hooks[0], session.currentState);
      const judgeResponseSummary = session.tournamentProgress!.judgeResults
        .map((r, i) => `Judge ${i + 1}: ${r.parsed ? (r.parsed.pass ? "PASS" : "FAIL") + " avg=" + this.avgScore(r.parsed).toFixed(1) : "FAILED"}`)
        .join(" | ");
      this.recordPromptHistory(
        session, "judge", firstJudgePrompt.system, firstJudgePrompt.user,
        promptOverrides?.judge, judgeResponseSummary
      );
    }

    // Select winner
    session.tournamentProgress!.phase = "selecting";

    const candidates: Array<{ hook: HookBuilderOutput; judge: HookJudgeOutput }> = [];
    for (let i = 0; i < session.tournamentProgress!.judgeResults.length; i++) {
      const parsed = session.tournamentProgress!.judgeResults[i].parsed;
      if (parsed) {
        candidates.push({ hook: hooks[i], judge: parsed });
      }
    }

    if (candidates.length === 0) {
      session.tournamentProgress = undefined;
      await this.store.save(session);
      throw new HookServiceError("LLM_PARSE_ERROR", "All judge evaluations failed to parse");
    }

    const winner = this.selectWinner(candidates);

    // Premise polish + slop QA: rewrite the winning premise to protect mystery and strip AI slop
    try {
      const polishedPremise = await this.polishPremise(winner.hook, session, modelOverride);
      if (polishedPremise) {
        winner.hook.premise = polishedPremise;
      }
    } catch (err) {
      // Non-fatal: if polish fails, use the raw premise
      console.error("PREMISE POLISH ERROR (using raw premise):", err);
    }

    session.revealedHook = winner.hook;
    session.revealedJudge = winner.judge;
    session.status = "revealed";
    session.rerollCount = resetRerollCount ? 0 : session.rerollCount + 1;
    session.tournamentProgress = undefined;  // Clear progress on success
    session.lastSavedAt = new Date().toISOString();

    await this.store.save(session);

    return {
      hook: winner.hook,
      judge: {
        passed: winner.judge.pass,
        hard_fail_reasons: winner.judge.hard_fail_reasons,
        scores: winner.judge.scores,
        most_generic_part: winner.judge.most_generic_part,
        one_fix_instruction: winner.judge.one_fix_instruction,
      },
      rerollCount: session.rerollCount,
    };
  }

  async lockHook(
    projectId: string,
    edits?: { premise?: string; page_turn_trigger?: string },
    modelOverride?: string
  ): Promise<HookPack> {
    const session = await this.store.get(projectId);
    if (!session) {
      throw new HookServiceError("NOT_FOUND", "Session not found");
    }
    if (session.status !== "revealed" || !session.revealedHook) {
      throw new HookServiceError("INVALID_INPUT", "Session must be revealed before locking");
    }

    const revealedHook = { ...session.revealedHook };
    if (edits?.premise) {
      revealedHook.premise = edits.premise;
    }
    if (edits?.page_turn_trigger) {
      revealedHook.page_turn_trigger = edits.page_turn_trigger;
    }

    session.revealedHook = revealedHook;

    // Save before summary LLM call (crash recovery)
    session.lastSavedAt = new Date().toISOString();
    await this.store.save(session);

    const summaryPrompt = this.buildSummaryPrompt(session);
    let summary = "";
    try {
      summary = await this.llm.call("summary", summaryPrompt.system, summaryPrompt.user, {
        temperature: 0.5,
        maxTokens: 600,
        modelOverride,
      });
    } catch (err) {
      console.error("SUMMARY LLM ERROR:", err);
      throw new HookServiceError("LLM_CALL_FAILED", "Summary generation failed");
    }

    // Collect unused assumptions (surfaced but user said "not ready" or never confirmed)
    const allAssumptions: Array<{ category: string; assumption: string; status: string }> = [];
    for (const turn of session.turns) {
      if (turn.clarifierResponse.assumptions) {
        for (const a of turn.clarifierResponse.assumptions) {
          allAssumptions.push({ category: a.category, assumption: a.assumption, status: "surfaced" });
        }
      }
    }

    // Analyze user behavior style
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

    const hookPack: HookPack = {
      module: "hook",
      locked: {
        hook_sentence: revealedHook.hook_sentence ?? "",
        emotional_promise: revealedHook.emotional_promise ?? "",
        premise: revealedHook.premise,
        page1_splash: revealedHook.page_1_splash_prompt,
        page_turn_trigger: revealedHook.page_turn_trigger,
        core_engine: {
          hook_engine: session.currentState.hook_engine ?? "",
          stakes: session.currentState.stakes ?? "",
          taboo_or_tension: session.currentState.taboo_or_tension ?? "",
          protagonist_role: session.currentState.protagonist_role ?? "",
          antagonist_form: session.currentState.antagonist_form ?? "",
          setting_anchor: session.currentState.setting_anchor ?? "",
        },
      },
      preferences: {
        tone_chips: session.currentState.tone_chips ?? [],
        bans: session.currentState.bans ?? [],
      },
      source_dna: revealedHook.collision_sources,
      open_threads: session.turns
        .filter((t) => !t.clarifierResponse.ready_for_hook)
        .map((t) => t.clarifierResponse.missing_signal)
        .filter(Boolean),
      unused_assumptions: allAssumptions,
      user_style: {
        control_preference: controlPreference,
        typed_vs_clicked: typedVsClicked,
        total_turns: session.turns.length,
      },
      state_summary: summary.trim(),
      psychologyLedger: session.psychologyLedger,
    };

    session.hookPack = hookPack;
    session.status = "locked";

    await this.store.save(session);

    // Auto-save comprehensive export for module handoff
    try {
      await this.store.saveExport(session);
    } catch (err) {
      // Non-fatal: the session is saved, export is a bonus
      console.error("AUTO-EXPORT ERROR (session saved, export failed):", err);
    }

    return hookPack;
  }

  async getSession(projectId: string, _modelOverride?: string): Promise<HookSessionState | null> {
    return this.store.get(projectId);
  }

  async resetSession(projectId: string, _modelOverride?: string): Promise<void> {
    await this.store.delete(projectId);
  }

  private buildClarifierPrompt(session: HookSessionState): {
    system: string;
    user: string;
  } {
    const currentStateJson = JSON.stringify(this.stripNil(session.currentState));
    const priorTurns = this.formatPriorTurns(session.turns);
    const bans = JSON.stringify(session.currentState.bans ?? []);
    const ledgerText = this.formatLedgerForPrompt(session.constraintLedger ?? []);

    const turnNumber = String(session.turns.length + 1);

    const psychText = formatPsychologyLedgerForPrompt(session.psychologyLedger);

    const user = HOOK_CLARIFIER_USER_TEMPLATE
      .replace("{{USER_SEED}}", session.seedInput)
      .replace("{{PRIOR_TURNS}}", priorTurns)
      .replace("{{CONSTRAINT_LEDGER}}", ledgerText)
      .replace("{{PSYCHOLOGY_LEDGER}}", psychText)
      .replace("{{CURRENT_STATE_JSON}}", currentStateJson)
      .replace("{{BAN_LIST}}", bans)
      .replace("{{TURN_NUMBER}}", turnNumber);

    return { system: HOOK_CLARIFIER_SYSTEM, user };
  }

  private buildBuilderPrompt(session: HookSessionState): {
    system: string;
    user: string;
  } {
    const ledgerText = this.formatLedgerForPrompt(session.constraintLedger ?? []);
    const user = HOOK_BUILDER_USER_TEMPLATE
      .replace("{{USER_SEED}}", session.seedInput)
      .replace("{{PRIOR_TURNS}}", this.formatPriorTurns(session.turns))
      .replace("{{CONSTRAINT_LEDGER}}", ledgerText)
      .replace("{{CURRENT_STATE_JSON}}", JSON.stringify(this.stripNil(session.currentState)))
      .replace("{{BAN_LIST}}", JSON.stringify(session.currentState.bans ?? []))
      .replace("{{TONE_CHIPS}}", JSON.stringify(session.currentState.tone_chips ?? []));

    return { system: HOOK_BUILDER_SYSTEM, user };
  }

  private buildJudgePrompt(
    candidate: HookBuilderOutput,
    state: HookStateUpdate
  ): { system: string; user: string } {
    const user = HOOK_JUDGE_USER_TEMPLATE
      .replace("{{CANDIDATE_JSON}}", JSON.stringify(candidate))
      .replace("{{CURRENT_STATE_JSON}}", JSON.stringify(this.stripNil(state)));

    return { system: HOOK_JUDGE_SYSTEM, user };
  }

  private buildSummaryPrompt(session: HookSessionState): {
    system: string;
    user: string;
  } {
    const user = HOOK_SUMMARY_USER_TEMPLATE
      .replace("{{USER_SEED}}", session.seedInput)
      .replace("{{PRIOR_TURNS}}", this.formatPriorTurns(session.turns))
      .replace("{{CURRENT_STATE_JSON}}", JSON.stringify(this.stripNil(session.currentState)))
      .replace("{{HOOK_JSON}}", JSON.stringify(session.revealedHook ?? {}));

    return { system: HOOK_SUMMARY_SYSTEM, user };
  }

  /**
   * Polish the winning premise: protect mystery, strip AI slop, target ~200 words.
   * Returns the polished premise text, or null if the call fails.
   */
  private async polishPremise(
    hook: HookBuilderOutput,
    session: HookSessionState,
    modelOverride?: string
  ): Promise<string | null> {
    const user = PREMISE_POLISH_USER_TEMPLATE
      .replace("{{RAW_PREMISE}}", hook.premise)
      .replace("{{HOOK_SENTENCE}}", hook.hook_sentence)
      .replace("{{EMOTIONAL_PROMISE}}", hook.emotional_promise)
      .replace("{{BAN_LIST}}", JSON.stringify(session.currentState.bans ?? []));

    const raw = await this.llm.call("polish", PREMISE_POLISH_SYSTEM, user, {
      temperature: 0.4,
      maxTokens: 800,
      modelOverride,
    });

    const trimmed = raw.trim();
    // Sanity check: should be a reasonable length, not JSON, not empty
    if (!trimmed || trimmed.startsWith("{") || trimmed.length < 50) {
      console.error("PREMISE POLISH returned unexpected format, using raw premise");
      return null;
    }

    return trimmed;
  }

  /**
   * Format prior turns for the prompt.
   * COMPRESSION STRATEGY: Last 2 turns get full detail (assumptions, etc.)
   * Older turns get compressed to just question + user response.
   * Full historical detail lives in the constraint ledger.
   */
  private formatPriorTurns(turns: HookTurn[]): string {
    if (turns.length === 0) return "(No conversation yet)";

    const RECENT_WINDOW = 2;
    const recentStart = Math.max(0, turns.length - RECENT_WINDOW);

    const lines: string[] = [];

    // Older turns: compressed
    for (let i = 0; i < recentStart; i++) {
      const turn = turns[i];
      const parts: string[] = [];
      parts.push(`[Turn ${turn.turnNumber}] (summary)`);
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

      if (turn.assumptionResponses && turn.assumptionResponses.length > 0) {
        const kept = turn.assumptionResponses.filter((r) => r.action === "keep").length;
        const changed = turn.assumptionResponses.filter((r) => r.action === "alternative" || r.action === "freeform");
        const deferred = turn.assumptionResponses.filter((r) => r.action === "not_ready").length;
        const changeSummary = changed.map((r) => `${r.category}→"${r.newValue}"`).join("; ");
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
      parts.push(`  Asked: "${turn.clarifierResponse.question}"`);

      if (turn.clarifierResponse.assumptions?.length > 0) {
        const assumptionSummary = turn.clarifierResponse.assumptions
          .map((a) => `${a.id}(${a.category}): "${a.assumption}"`)
          .join("; ");
        parts.push(`  Assumptions surfaced: ${assumptionSummary}`);
      }

      if (!turn.userSelection) {
        parts.push(`  → User pending selection.`);
      } else if (turn.userSelection.type === "option") {
        parts.push(`  → User chose [${turn.userSelection.optionId}]: "${turn.userSelection.label}"`);
      } else if (turn.userSelection.type === "surprise_me") {
        parts.push(`  → User chose: (surprise me)`);
      } else {
        parts.push(`  → User typed: "${turn.userSelection.label}"`);
      }

      if (turn.assumptionResponses && turn.assumptionResponses.length > 0) {
        parts.push(`  → Assumption responses:`);
        for (const resp of turn.assumptionResponses) {
          if (resp.action === "keep") {
            parts.push(`    ${resp.assumptionId}(${resp.category}): KEPT "${resp.originalValue}"`);
          } else if (resp.action === "alternative") {
            parts.push(`    ${resp.assumptionId}(${resp.category}): CHANGED to "${resp.newValue}"`);
          } else if (resp.action === "freeform") {
            parts.push(`    ${resp.assumptionId}(${resp.category}): USER WROTE "${resp.newValue}"`);
          } else if (resp.action === "not_ready") {
            parts.push(`    ${resp.assumptionId}(${resp.category}): NOT READY YET`);
          }
        }
      }

      if (turn.clarifierResponse.conflict_flag) {
        parts.push(`  ⚠ Conflict flagged: "${turn.clarifierResponse.conflict_flag}"`);
      }

      lines.push(parts.join("\n"));
    }

    return lines.join("\n\n");
  }

  /**
   * Process user assumption responses into the constraint ledger.
   * This is deterministic — no LLM involved. User-confirmed constraints are authoritative.
   */
  private processAssumptionResponses(
    session: HookSessionState,
    responses: AssumptionResponse[],
    turnNumber: number
  ): void {
    const ledger = session.constraintLedger!;

    for (const resp of responses) {
      if (resp.action === "not_ready") {
        // User isn't ready — remove any inferred entry for this category so it stays open
        // But don't remove confirmed entries
        continue;
      }

      const source =
        resp.action === "keep" ? "user_kept_assumption" as const :
        resp.action === "alternative" ? "user_changed_assumption" as const :
        "user_freeform" as const;

      const value = resp.action === "keep" ? resp.originalValue : resp.newValue;

      // Find existing entry for this category
      const existingIdx = ledger.findIndex((e) => e.key === resp.category);

      const entry: ConstraintLedgerEntry = {
        key: resp.category,
        value,
        source,
        confidence: "confirmed",
        turnNumber,
        assumptionId: resp.assumptionId,
      };

      if (existingIdx >= 0) {
        // Overwrite — user action always wins
        ledger[existingIdx] = entry;
      } else {
        ledger.push(entry);
      }
    }
  }

  /**
   * Process the LLM's state_update into the ledger as inferred entries.
   * Only adds/updates entries that are NOT already user-confirmed.
   */
  private processStateUpdateIntoLedger(
    session: HookSessionState,
    stateUpdate: HookStateUpdate,
    turnNumber: number
  ): void {
    const ledger = session.constraintLedger!;

    const mappings: Array<{ stateKey: keyof HookStateUpdate; ledgerKey: string }> = [
      { stateKey: "hook_engine", ledgerKey: "hook_engine" },
      { stateKey: "stakes", ledgerKey: "stakes" },
      { stateKey: "taboo_or_tension", ledgerKey: "taboo_or_tension" },
      { stateKey: "setting_anchor", ledgerKey: "setting" },
      { stateKey: "protagonist_role", ledgerKey: "character_role" },
      { stateKey: "antagonist_form", ledgerKey: "antagonist" },
    ];

    for (const { stateKey, ledgerKey } of mappings) {
      const value = stateUpdate[stateKey];
      if (typeof value !== "string" || !value.trim()) continue;

      const existingIdx = ledger.findIndex((e) => e.key === ledgerKey);

      if (existingIdx >= 0) {
        // Only update if the existing entry is inferred (never overwrite confirmed)
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

  /**
   * Format the constraint ledger for inclusion in the LLM prompt.
   * Groups entries by confidence level so the LLM can see what's settled vs open.
   */
  private formatLedgerForPrompt(ledger: ConstraintLedgerEntry[]): string {
    if (!ledger || ledger.length === 0) return "(No constraints established yet)";

    const confirmed = ledger.filter((e) => e.confidence === "confirmed");
    const inferred = ledger.filter((e) => e.confidence === "inferred");

    const lines: string[] = [];

    if (confirmed.length > 0) {
      lines.push("CONFIRMED by user (must honor these):");
      for (const e of confirmed) {
        lines.push(`  - ${e.key}: "${e.value}" [${e.source}, turn ${e.turnNumber}]`);
      }
    }

    if (inferred.length > 0) {
      lines.push("INFERRED by you (user hasn't weighed in — can be changed):");
      for (const e of inferred) {
        lines.push(`  - ${e.key}: "${e.value}" [turn ${e.turnNumber}]`);
      }
    }

    const totalDimensions = Math.max(confirmed.length + inferred.length, 1);
    lines.push(`\nConfirmed: ${confirmed.length}/${totalDimensions} dimensions shaped by user`);

    return lines.join("\n");
  }

  private selectWinner(
    candidates: Array<{ hook: HookBuilderOutput; judge: HookJudgeOutput }>
  ): { hook: HookBuilderOutput; judge: HookJudgeOutput } {
    const passed = candidates.filter((candidate) => candidate.judge.pass);

    if (passed.length > 0) {
      passed.sort((a, b) => this.avgScore(b.judge) - this.avgScore(a.judge));
      return passed[0];
    }

    const sorted = [...candidates].sort(
      (a, b) => a.judge.hard_fail_reasons.length - b.judge.hard_fail_reasons.length
    );
    return sorted[0];
  }

  private mergeStateUpdate(current: HookStateUpdate, update: HookStateUpdate): HookStateUpdate {
    const next: HookStateUpdate = { ...current };

    const stringKeys: Array<keyof HookStateUpdate> = [
      "hook_engine",
      "stakes",
      "taboo_or_tension",
      "opening_image_seed",
      "setting_anchor",
      "protagonist_role",
      "antagonist_form",
    ];

    for (const key of stringKeys) {
      const value = update[key];
      if (typeof value === "string" && value.trim()) {
        (next as any)[key] = value;
      }
    }

    if (Array.isArray(update.tone_chips)) {
      next.tone_chips = [...new Set([...(current.tone_chips ?? []), ...update.tone_chips])];
    }

    if (Array.isArray(update.bans)) {
      next.bans = [...new Set([...(current.bans ?? []), ...update.bans])];
    }

    return next;
  }

  private parseAndValidate<T>(raw: string, requiredFields: string[]): T | null {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const field of requiredFields) {
        if (!(field in parsed)) {
          return null;
        }
      }
      return parsed as T;
    } catch {
      return null;
    }
  }

  private stripNil(value: HookStateUpdate): HookStateUpdate {
    const next: HookStateUpdate = {};
    for (const [key, v] of Object.entries(value)) {
      if (v !== undefined && v !== null) {
        (next as any)[key] = v;
      }
    }
    return next;
  }

  private avgScore(judge: HookJudgeOutput): number {
    const s = judge.scores;
    return (s.specificity + s.drawability + s.page_turn + s.mechanism + s.freshness) / 5;
  }

  /** Record a prompt history entry (tracks both defaults and user edits) */
  private recordPromptHistory(
    session: HookSessionState,
    stage: PromptHistoryEntry["stage"],
    defaultSystem: string,
    defaultUser: string,
    overrides?: PromptOverrides,
    responseSummary?: string,
  ): void {
    if (!session.promptHistory) {
      session.promptHistory = [];
    }
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

  /** Get the prompt history for export */
  getPromptHistory(session: HookSessionState): PromptHistoryEntry[] {
    return session.promptHistory ?? [];
  }

  /** Compute interaction heuristics from turn data for the psychology ledger */
  private updatePsychologyHeuristics(session: HookSessionState): void {
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
