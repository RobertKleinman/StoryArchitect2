import {
  ClarifyResponse,
  GenerateResponse,
} from "../../shared/types/api";
import {
  HookBuilderOutput,
  HookJudgeOutput,
  HookPack,
  HookSessionState,
  HookStateUpdate,
  HookTurn,
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
} from "./hookPrompts";
import {
  HOOK_BUILDER_SCHEMA,
  HOOK_CLARIFIER_SCHEMA,
  HOOK_JUDGE_SCHEMA,
} from "./hookSchemas";

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

  async runClarifierTurn(
    projectId: string,
    seedInput?: string,
    userSelection?: { type: "option" | "free_text" | "surprise_me"; optionId?: string; label: string },
    modelOverride?: string
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
        rerollCount: 0,
        status: "clarifying",
      };
    } else {
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
    }

    const prompt = this.buildClarifierPrompt(session);
    let clarifierRaw: string;
    try {
      clarifierRaw = await this.llm.call("clarifier", prompt.system, prompt.user, {
        temperature: 0.7,
        maxTokens: 800,
        modelOverride,
        jsonSchema: HOOK_CLARIFIER_SCHEMA,
      });
    } catch {
      throw new HookServiceError("LLM_CALL_FAILED", "Clarifier call failed");
    }

    let clarifier = this.parseAndValidate<any>(clarifierRaw, [
      "hypothesis_line",
      "question",
      "options",
      "allow_free_text",
      "ready_for_hook",
      "missing_signal",
      "state_update",
    ]);

    if (!clarifier) {
      try {
        const retryRaw = await this.llm.call("clarifier", prompt.system, prompt.user, {
          temperature: 0.7,
          maxTokens: 800,
          modelOverride,
          jsonSchema: HOOK_CLARIFIER_SCHEMA,
        });
        clarifier = this.parseAndValidate<any>(retryRaw, [
          "hypothesis_line",
          "question",
          "options",
          "allow_free_text",
          "ready_for_hook",
          "missing_signal",
          "state_update",
        ]);
      } catch {
        throw new HookServiceError("LLM_PARSE_ERROR", "Failed to parse clarifier response");
      }

      if (!clarifier) {
        throw new HookServiceError("LLM_PARSE_ERROR", "Failed to parse clarifier response");
      }
    }

    session.currentState = this.mergeStateUpdate(session.currentState, clarifier.state_update);

    const turn: HookTurn = {
      turnNumber: session.turns.length + 1,
      clarifierResponse: clarifier,
      userSelection: null,
    };

    if (session.turns.length >= 2 && !turn.clarifierResponse.ready_for_hook) {
      turn.clarifierResponse.ready_for_hook = true;
    }

    session.turns.push(turn);
    session.status = "clarifying";

    await this.store.save(session);

    return {
      clarifier: turn.clarifierResponse,
      turnNumber: turn.turnNumber,
      totalTurns: session.turns.length,
    };
  }

  async runTournament(
    projectId: string,
    modelOverride?: string
  ): Promise<GenerateResponse> {
    const session = await this.store.get(projectId);
    if (!session || !session.seedInput) {
      throw new HookServiceError("NOT_FOUND", "Session not found");
    }
    return this.executeTournament(session, modelOverride, true);
  }

  async reroll(
    projectId: string,
    modelOverride?: string
  ): Promise<GenerateResponse> {
    const session = await this.store.get(projectId);
    if (!session) {
      throw new HookServiceError("NOT_FOUND", "Session not found");
    }
    if (session.status !== "revealed") {
      throw new HookServiceError("INVALID_INPUT", "Session must be in revealed status to reroll");
    }

    return this.executeTournament(session, modelOverride, false);
  }

  private async executeTournament(
    session: HookSessionState,
    modelOverride: string | undefined,
    resetRerollCount: boolean
  ): Promise<GenerateResponse> {
    session.status = "generating";

    const builderPrompt = this.buildBuilderPrompt(session);
    const temperatures = [0.7, 0.9, 1.1];

    let builderRawResults: string[];
    try {
      builderRawResults = await Promise.all(
        temperatures.map((temperature) =>
          this.llm.call("builder", builderPrompt.system, builderPrompt.user, {
            temperature,
            modelOverride,
            jsonSchema: HOOK_BUILDER_SCHEMA,
          })
        )
      );
    } catch {
      throw new HookServiceError("LLM_CALL_FAILED", "Builder tournament failed");
    }

    const hooks = builderRawResults.map((raw) => {
      const parsed = this.parseAndValidate<HookBuilderOutput>(raw, [
        "premise",
        "opening_image",
        "page_1_splash_prompt",
        "page_turn_trigger",
        "why_addictive",
        "collision_sources",
      ]);
      if (!parsed) {
        throw new HookServiceError("LLM_PARSE_ERROR", "Failed to parse builder response");
      }
      return parsed;
    });

    let judgeRawResults: string[];
    try {
      judgeRawResults = await Promise.all(
        hooks.map((hook) => {
          const judgePrompt = this.buildJudgePrompt(hook, session.currentState);
          return this.llm.call("judge", judgePrompt.system, judgePrompt.user, {
            temperature: 0.3,
            modelOverride,
            jsonSchema: HOOK_JUDGE_SCHEMA,
          });
        })
      );
    } catch {
      throw new HookServiceError("LLM_CALL_FAILED", "Judge evaluation failed");
    }

    const judges = judgeRawResults.map((raw) => {
      const parsed = this.parseAndValidate<HookJudgeOutput>(raw, [
        "pass",
        "hard_fail_reasons",
        "scores",
        "most_generic_part",
        "one_fix_instruction",
      ]);
      if (!parsed) {
        throw new HookServiceError("LLM_PARSE_ERROR", "Failed to parse judge response");
      }
      return parsed;
    });

    const winner = this.selectWinner(hooks.map((hook, i) => ({ hook, judge: judges[i] })));

    session.revealedHook = winner.hook;
    session.revealedJudge = winner.judge;
    session.status = "revealed";
    session.rerollCount = resetRerollCount ? 0 : session.rerollCount + 1;

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

    const summaryPrompt = this.buildSummaryPrompt(session);
    let summary = "";
    try {
      summary = await this.llm.call("summary", summaryPrompt.system, summaryPrompt.user, {
        temperature: 0.5,
        maxTokens: 600,
        modelOverride,
      });
    } catch {
      throw new HookServiceError("LLM_CALL_FAILED", "Summary generation failed");
    }

    const hookPack: HookPack = {
      module: "hook",
      locked: {
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
      state_summary: summary.trim(),
    };

    session.hookPack = hookPack;
    session.status = "locked";

    await this.store.save(session);
    return hookPack;
  }

  async getSession(projectId: string): Promise<HookSessionState | null> {
    return this.store.get(projectId);
  }

  async resetSession(projectId: string): Promise<void> {
    await this.store.delete(projectId);
  }

  private buildClarifierPrompt(session: HookSessionState): {
    system: string;
    user: string;
  } {
    const currentStateJson = JSON.stringify(this.stripNil(session.currentState));
    const priorTurns = this.formatPriorTurns(session.turns);
    const bans = JSON.stringify(session.currentState.bans ?? []);

    const user = HOOK_CLARIFIER_USER_TEMPLATE
      .replace("{{USER_SEED}}", session.seedInput)
      .replace("{{PRIOR_TURNS}}", priorTurns)
      .replace("{{CURRENT_STATE_JSON}}", currentStateJson)
      .replace("{{BAN_LIST}}", bans);

    return { system: HOOK_CLARIFIER_SYSTEM, user };
  }

  private buildBuilderPrompt(session: HookSessionState): {
    system: string;
    user: string;
  } {
    const user = HOOK_BUILDER_USER_TEMPLATE
      .replace("{{USER_SEED}}", session.seedInput)
      .replace("{{PRIOR_TURNS}}", this.formatPriorTurns(session.turns))
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

  private formatPriorTurns(turns: HookTurn[]): string {
    const lines = turns.map((turn) => {
      const q = `Q${turn.turnNumber}: "${turn.clarifierResponse.question}"`;
      if (!turn.userSelection) {
        return `${q} → User pending selection.`;
      }
      if (turn.userSelection.type === "option") {
        return `${q} → User chose [${turn.userSelection.optionId}]: "${turn.userSelection.label}"`;
      }
      if (turn.userSelection.type === "surprise_me") {
        return `${q} → User chose: (surprise me)`;
      }
      return `${q} → User typed: "${turn.userSelection.label}"`;
    });

    const words: string[] = [];
    const out: string[] = [];
    for (const line of lines) {
      const lineWords = line.split(/\s+/);
      if (words.length + lineWords.length > 300) {
        break;
      }
      words.push(...lineWords);
      out.push(line);
    }

    return out.join("\n");
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
}
