import React, { useEffect, useMemo, useRef, useState } from "react";
import { hookApi } from "../lib/hookApi";
import { startBuildProgressPolling } from "../lib/buildProgressPoller";
import { emitModuleStatus } from "./App";
import { PromptEditor } from "./PromptEditor";
import { PsychologyOverlay } from "./PsychologyOverlay";
import { EngineInsights } from "./EngineInsights";
import { PackPreview } from "./PackPreview";
import { ModelSelector } from "./ModelSelector";
import type {
  AssumptionResponse,
  HookAssumption,
  HookBuilderOutput,
  HookClarifierOption,
  HookJudgeScores,
  HookPack,
  PromptOverrides,
} from "../../shared/types/hook";

type Phase = "seed" | "clarifying" | "generating" | "revealed" | "locked";

interface HookWorkshopState {
  phase: Phase;
  seedInput: string;
  hypothesisLine: string;
  question: string;
  options: HookClarifierOption[];
  allowFreeText: boolean;
  freeTextValue: string;
  showFreeTextInput: boolean;
  turnNumber: number;
  readyForHook: boolean;
  readinessPct: number;
  readinessNote: string;
  conflictFlag: string;
  revealedHook: HookBuilderOutput | null;
  judgeInfo: {
    passed: boolean;
    hard_fail_reasons: string[];
    scores: HookJudgeScores;
    most_generic_part: string;
    one_fix_instruction: string;
  } | null;
  rerollCount: number;
  loading: boolean;
  loadingMessage: string;
  error: string | null;
  assumptions: HookAssumption[];
  assumptionResponses: Record<string, { action: "keep" | "alternative" | "freeform" | "not_ready"; value: string }>;
  selectedOptionId: string | null;
  selectedOptionLabel: string | null;
  editing: boolean;
  editPremise: string;
  editTrigger: string;
}

const initialState: HookWorkshopState = {
  phase: "seed",
  seedInput: "",
  hypothesisLine: "",
  question: "",
  options: [],
  allowFreeText: true,
  freeTextValue: "",
  showFreeTextInput: false,
  turnNumber: 0,
  readyForHook: false,
  readinessPct: 0,
  readinessNote: "",
  conflictFlag: "",
  revealedHook: null,
  judgeInfo: null,
  rerollCount: 0,
  loading: false,
  loadingMessage: "",
  error: null,
  assumptions: [],
  assumptionResponses: {},
  selectedOptionId: null,
  selectedOptionLabel: null,
  editing: false,
  editPremise: "",
  editTrigger: "",
};

const SESSION_KEY = "hookWorkshop_projectId";

function makeProjectId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `project-${Date.now()}`;
}

function loadSavedProjectId(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

function saveProjectId(id: string) {
  try {
    localStorage.setItem(SESSION_KEY, id);
  } catch {
    // ignore
  }
}

function clearSavedProjectId() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

/**
 * Parse constraint overrides from a simple text format: "key: value" per line.
 * Returns a Record<string, string> or undefined if empty.
 */
function parseConstraintOverrides(text: string): Record<string, string> | undefined {
  const overrides: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx <= 0) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();
    if (key && value) overrides[key] = value;
  }
  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

export function HookWorkshop() {
  const [projectId, setProjectId] = useState(() => {
    return loadSavedProjectId() ?? makeProjectId();
  });
  const [state, setState] = useState<HookWorkshopState>(initialState);
  const [lastAction, setLastAction] = useState<null | (() => Promise<void>)>(null);
  const [sourcesExpanded, setSourcesExpanded] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [showPsych, setShowPsych] = useState(false);
  const [showInsights, setShowInsights] = useState(false);
  const [lockedPack, setLockedPack] = useState<HookPack | null>(null);
  const fetchPsych = useMemo(() => () => hookApi.debugPsychology(projectId), [projectId]);
  const fetchInsights = useMemo(() => () => hookApi.debugInsights(projectId), [projectId]);

  // Progress interval ref — cleared on unmount to prevent leaks
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    return () => {
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    };
  }, []);

  // Prompt preview state
  const [promptPreview, setPromptPreview] = useState<{
    stage: string;
    system: string;
    user: string;
  } | null>(null);
  const [promptOverrides, setPromptOverrides] = useState<PromptOverrides | undefined>(undefined);
  const [builderPromptOverrides, setBuilderPromptOverrides] = useState<PromptOverrides | undefined>(undefined);

  // Constraint override state for regeneration
  const [showConstraintOverrides, setShowConstraintOverrides] = useState(false);
  const [constraintOverridesText, setConstraintOverridesText] = useState("");

  // Crash recovery state
  const [recoverySession, setRecoverySession] = useState<any>(null);
  const [recoveryChecked, setRecoveryChecked] = useState(false);

  // Check for recoverable session on mount
  React.useEffect(() => {
    const savedId = loadSavedProjectId();
    if (savedId) {
      hookApi.getSession(savedId).then((session) => {
        if (session && session.status !== "locked") {
          setRecoverySession(session);
        }
        setRecoveryChecked(true);
      }).catch(() => {
        setRecoveryChecked(true);
      });
    } else {
      setRecoveryChecked(true);
    }
  }, []);

  const recoverSession = React.useCallback((session: any) => {
    setProjectId(session.projectId);
    saveProjectId(session.projectId);

    const lastTurn = session.turns?.length > 0 ? session.turns[session.turns.length - 1] : null;

    if (session.status === "revealed" && session.revealedHook) {
      setState((prev) => ({
        ...prev,
        phase: "revealed",
        seedInput: session.seedInput,
        hypothesisLine: lastTurn?.clarifierResponse?.hypothesis_line ?? "",
        revealedHook: session.revealedHook,
        judgeInfo: session.revealedJudge ? {
          passed: session.revealedJudge.pass,
          hard_fail_reasons: session.revealedJudge.hard_fail_reasons,
          scores: session.revealedJudge.scores,
          most_generic_part: session.revealedJudge.most_generic_part,
          one_fix_instruction: session.revealedJudge.one_fix_instruction,
        } : null,
        rerollCount: session.rerollCount,
        editPremise: session.revealedHook.premise,
        editTrigger: session.revealedHook.page_turn_trigger,
        turnNumber: session.turns?.length ?? 0,
      }));
    } else if (session.status === "clarifying" && lastTurn) {
      setState((prev) => ({
        ...prev,
        phase: "clarifying",
        seedInput: session.seedInput,
        hypothesisLine: lastTurn.clarifierResponse.hypothesis_line,
        question: lastTurn.clarifierResponse.question,
        options: lastTurn.clarifierResponse.options,
        allowFreeText: lastTurn.clarifierResponse.allow_free_text,
        turnNumber: session.turns.length,
        readyForHook: lastTurn.clarifierResponse.ready_for_hook,
        readinessPct: lastTurn.clarifierResponse.readiness_pct ?? 0,
        readinessNote: lastTurn.clarifierResponse.readiness_note ?? "",
        conflictFlag: lastTurn.clarifierResponse.conflict_flag ?? "",
        assumptions: lastTurn.clarifierResponse.assumptions ?? [],
        assumptionResponses: {},
      }));
    } else if (session.status === "generating") {
      // Was mid-tournament — show what we have and let user re-trigger
      setState((prev) => ({
        ...prev,
        phase: "clarifying",
        seedInput: session.seedInput,
        hypothesisLine: lastTurn?.clarifierResponse?.hypothesis_line ?? "",
        question: lastTurn?.clarifierResponse?.question ?? "Ready to generate?",
        options: [],
        turnNumber: session.turns?.length ?? 2,
        readyForHook: true,
        readinessNote: "Recovered from a crash — ready to generate your hook again!",
        error: session.tournamentProgress
          ? `Previous generation was interrupted (${session.tournamentProgress.builderResults?.length ?? 0}/3 builders completed). You can try again.`
          : null,
      }));
    }

    setRecoverySession(null);
  }, []);

  const dismissRecovery = React.useCallback(() => {
    clearSavedProjectId();
    const newId = makeProjectId();
    setProjectId(newId);
    setRecoverySession(null);
  }, []);

  const loadingLabel = state.loading ? state.loadingMessage : "";

  const setError = (error: unknown) => {
    const message = error instanceof Error ? error.message : "Something went wrong";
    setState((prev) => ({ ...prev, loading: false, error: message }));
  };

  const runAndTrack = async (fn: () => Promise<void>) => {
    setLastAction(() => fn);
    try {
      await fn();
    } catch (error) {
      setError(error);
    }
  };

  // Load prompt preview for the current stage
  const loadPromptPreview = async (
    stage: "clarifier" | "builder" | "judge" | "summary",
    seedInput?: string,
    userSelection?: { type: string; optionId?: string; label: string }
  ) => {
    try {
      const preview = await hookApi.previewPrompt({
        projectId,
        stage,
        seedInput,
        userSelection,
      });
      setPromptPreview(preview);
      setPromptOverrides(undefined);
      setBuilderPromptOverrides(undefined);
    } catch {
      // Silently fail — prompt preview is optional
    }
  };

  const startSeed = async () => {
    if (!state.seedInput.trim()) return;

    await runAndTrack(async () => {
      setState((prev) => ({
        ...prev,
        loading: true,
        loadingMessage: "Thinking...",
        error: null,
      }));

      // Always start with a fresh projectId to avoid collisions with previous sessions
      const freshId = makeProjectId();
      setProjectId(freshId);
      saveProjectId(freshId);

      const response = await hookApi.clarify({
        projectId: freshId,
        seedInput: state.seedInput.trim(),
        promptOverrides,
      });

      setPromptPreview(null);
      setPromptOverrides(undefined);

      setState((prev) => ({
        ...prev,
        phase: "clarifying",
        hypothesisLine: response.clarifier.hypothesis_line,
        question: response.clarifier.question,
        options: response.clarifier.options,
        allowFreeText: response.clarifier.allow_free_text,
        turnNumber: response.turnNumber,
        readyForHook: response.clarifier.ready_for_hook,
        readinessPct: response.clarifier.readiness_pct ?? 0,
        readinessNote: response.clarifier.readiness_note ?? "",
        conflictFlag: response.clarifier.conflict_flag ?? "",
        assumptions: response.clarifier.assumptions ?? [],
        assumptionResponses: {},
        selectedOptionId: null,
        selectedOptionLabel: null,
        showFreeTextInput: false,
        freeTextValue: "",
        loading: false,
        loadingMessage: "",
        error: null,
      }));
      emitModuleStatus("hook", "active");
    });
  };

  /** Convert frontend assumption responses to structured AssumptionResponse[] for the backend */
  const buildStructuredAssumptionResponses = (): AssumptionResponse[] => {
    const responses: AssumptionResponse[] = [];
    for (const [id, resp] of Object.entries(state.assumptionResponses)) {
      const assumption = state.assumptions.find((a) => a.id === id);
      if (!assumption) continue;
      responses.push({
        assumptionId: id,
        category: assumption.category,
        action: resp.action,
        originalValue: assumption.assumption,
        newValue: resp.value,
      });
    }
    return responses;
  };

  const answerClarifier = async (selection: {
    type: "option" | "surprise_me" | "free_text";
    optionId?: string;
    label: string;
  }) => {
    await runAndTrack(async () => {
      // Send assumption responses as structured data — no more label-stuffing
      const assumptionResponses = buildStructuredAssumptionResponses();

      setState((prev) => ({
        ...prev,
        loading: true,
        loadingMessage: "Thinking...",
        error: null,
      }));

      const response = await hookApi.clarify({
        projectId,
        userSelection: selection,
        assumptionResponses: assumptionResponses.length > 0 ? assumptionResponses : undefined,
        promptOverrides,
      });

      setPromptPreview(null);
      setPromptOverrides(undefined);

      setState((prev) => ({
        ...prev,
        phase: "clarifying",
        hypothesisLine: response.clarifier.hypothesis_line,
        question: response.clarifier.question,
        options: response.clarifier.options,
        allowFreeText: response.clarifier.allow_free_text,
        turnNumber: response.turnNumber,
        readyForHook: response.clarifier.ready_for_hook,
        readinessPct: response.clarifier.readiness_pct ?? 0,
        readinessNote: response.clarifier.readiness_note ?? "",
        conflictFlag: response.clarifier.conflict_flag ?? "",
        assumptions: response.clarifier.assumptions ?? [],
        assumptionResponses: {},
        selectedOptionId: null,
        selectedOptionLabel: null,
        showFreeTextInput: false,
        freeTextValue: "",
        loading: false,
        loadingMessage: "",
        error: null,
      }));
    });
  };

  const generateHook = async () => {
    await runAndTrack(async () => {
      setState((prev) => ({
        ...prev,
        phase: "generating",
        loading: true,
        loadingMessage: "Crafting hook... (candidate 1/3)",
        error: null,
      }));

      // Poll build progress from session state
      const stopPolling = startBuildProgressPolling(
        () => hookApi.getSession(projectId),
        "hook",
        (msg) => setState((prev) => ({ ...prev, loadingMessage: msg })),
      );

      try {
        const tournamentOverrides = builderPromptOverrides
          ? { builder: builderPromptOverrides }
          : undefined;
        const response = await hookApi.generate(projectId, tournamentOverrides);

        stopPolling();
        setPromptPreview(null);
        setBuilderPromptOverrides(undefined);

        setState((prev) => ({
          ...prev,
          phase: "revealed",
          revealedHook: response.hook,
          judgeInfo: response.judge,
          rerollCount: response.rerollCount,
          editPremise: response.hook.premise,
          editTrigger: response.hook.page_turn_trigger,
          editing: false,
          loading: false,
          loadingMessage: "",
          error: null,
        }));
      } catch (err) {
        stopPolling();
        throw err;
      }
    });
  };

  const reroll = async () => {
    await runAndTrack(async () => {
      setState((prev) => ({
        ...prev,
        phase: "generating",
        loading: true,
        loadingMessage: "Trying a fresh angle...",
        error: null,
      }));

      const stopPolling = startBuildProgressPolling(
        () => hookApi.getSession(projectId),
        "hook",
        (msg) => setState((prev) => ({ ...prev, loadingMessage: msg })),
      );

      try {
        const tournamentOverrides = builderPromptOverrides
          ? { builder: builderPromptOverrides }
          : undefined;
        const parsedOverrides = parseConstraintOverrides(constraintOverridesText);
        const response = await hookApi.reroll(projectId, tournamentOverrides, parsedOverrides);

        stopPolling();
        setState((prev) => ({
          ...prev,
          phase: "revealed",
          revealedHook: response.hook,
          judgeInfo: response.judge,
          rerollCount: response.rerollCount,
          editPremise: response.hook.premise,
          editTrigger: response.hook.page_turn_trigger,
          editing: false,
          loading: false,
          loadingMessage: "",
        }));
      } catch (err) {
        stopPolling();
        throw err;
      }
    });
  };

  const lock = async (edits?: { premise?: string; page_turn_trigger?: string }) => {
    await runAndTrack(async () => {
      setState((prev) => ({ ...prev, loading: true, loadingMessage: "Locking your hook\u2026", error: null }));
      const pack = await hookApi.lock(projectId, edits);
      setLockedPack(pack);

      setState((prev) => ({
        ...prev,
        phase: "locked",
        revealedHook: {
          hook_sentence: prev.revealedHook?.hook_sentence ?? "",
          emotional_promise: prev.revealedHook?.emotional_promise ?? "",
          premise: pack.locked.premise,
          opening_image: prev.revealedHook?.opening_image ?? "",
          page_1_splash_prompt: pack.locked.page1_splash,
          page_turn_trigger: pack.locked.page_turn_trigger,
          why_addictive: prev.revealedHook?.why_addictive ?? ["", "", ""],
          collision_sources: prev.revealedHook?.collision_sources ?? [],
        },
        editing: false,
        loading: false,
        loadingMessage: "",
      }));
      emitModuleStatus("hook", "locked");
    });
  };

  const startOver = async () => {
    await runAndTrack(async () => {
      setState((prev) => ({ ...prev, loading: true, loadingMessage: "Resetting workshop\u2026", error: null }));
      await hookApi.reset(projectId);
      clearSavedProjectId();
      const newId = makeProjectId();
      setProjectId(newId);
      setState(initialState);
      setSourcesExpanded(false);
      setDetailsExpanded(false);
      setPromptPreview(null);
      setPromptOverrides(undefined);
      setBuilderPromptOverrides(undefined);
      emitModuleStatus("hook", "idle");
    });
  };

  const exportPromptHistory = async () => {
    try {
      const data = await hookApi.exportPrompts(projectId);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `prompt-history-${projectId.slice(0, 8)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      setState((prev) => ({ ...prev, error: "Failed to export prompt history" }));
    }
  };

  const exportFullSession = async () => {
    try {
      const data = await hookApi.exportSession(projectId);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `hook-module-export-${projectId.slice(0, 8)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      setState((prev) => ({ ...prev, error: "Failed to export session" }));
    }
  };

  const hook = state.revealedHook;

  const sourceSection = useMemo(() => {
    if (!hook?.collision_sources?.length) return null;
    return (
      <div className="source-group">
        <button
          type="button"
          className="link-btn"
          onClick={() => setSourcesExpanded((prev) => !prev)}
        >
          \u25B8 Sources ({sourcesExpanded ? "hide" : "show"})
        </button>
        {sourcesExpanded && (
          <ul>
            {hook.collision_sources.map((source, index) => (
              <li key={`${source.source}-${index}`}>
                {source.source} \u2192 {source.element_extracted}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }, [hook?.collision_sources, sourcesExpanded]);

  // Show recovery banner if there's a saved session
  if (!recoveryChecked) {
    return (
      <main className="workshop-shell">
        <section className="workshop-card">
          <div>
            <div className="skeleton-card" />
            <div className="skeleton-card" />
            <div className="skeleton-card" />
          </div>
        </section>
      </main>
    );
  }

  if (recoverySession) {
    return (
      <main className="workshop-shell">
        <section className="workshop-card">
          <div className="recovery-banner">
            <p>
              Found a previous session ({recoverySession.status}).
              {recoverySession.seedInput && (
                <> Seed: &ldquo;{recoverySession.seedInput.slice(0, 80)}{recoverySession.seedInput.length > 80 ? "\u2026" : ""}&rdquo;</>
              )}
            </p>
            <div className="recovery-actions">
              <button
                type="button"
                className="primary"
                onClick={() => recoverSession(recoverySession)}
              >
                Resume session
              </button>
              <button
                type="button"
                onClick={dismissRecovery}
              >
                Start fresh
              </button>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="workshop-shell">
      <section className="workshop-card">
        <ModelSelector />

        {state.phase !== "seed" && state.hypothesisLine && (
          <header className="hypothesis-banner" key={state.hypothesisLine}>
            <p className="hypothesis-title">
              {state.turnNumber <= 2 ? "What I\u2019m thinking\u2026" : "Your hook is taking shape\u2026"}
            </p>
            <p className="hypothesis-line">{state.hypothesisLine}</p>
          </header>
        )}

        {state.error && (
          <div className="error-banner">
            <p>Something went wrong: {state.error}</p>
            {lastAction && (
              <button type="button" onClick={() => void lastAction()}>
                Retry
              </button>
            )}
          </div>
        )}

        {state.phase === "seed" && (
          <section>
            <p className="lead">If you could write a story, what would you want it to include?</p>
            <div className="seed-row">
              <input
                value={state.seedInput}
                onChange={(event) =>
                  setState((prev) => ({ ...prev, seedInput: event.target.value, error: null }))
                }
                placeholder="A taboo romance in a floodlit megacity..."
                disabled={state.loading}
                onKeyDown={(event: React.KeyboardEvent) => {
                  if (event.key === "Enter" && state.seedInput.trim()) {
                    void startSeed();
                  }
                }}
              />
              <button type="button" className="primary" onClick={() => void startSeed()} disabled={state.loading || !state.seedInput.trim()}>
                {state.loading ? "Thinking\u2026" : "Go \u2192"}
              </button>
            </div>

            {state.seedInput.trim() && !state.loading && (
              <PromptEditor
                stage="clarifier"
                systemPrompt={promptPreview?.system ?? "(Click to load preview)"}
                userPrompt={promptPreview?.user ?? "(Click to load preview)"}
                loading={state.loading}
                onOverridesChange={setPromptOverrides}
              />
            )}
            {state.seedInput.trim() && !state.loading && !promptPreview && (
              <button
                type="button"
                className="prompt-toggle"
                onClick={() => void loadPromptPreview("clarifier", state.seedInput.trim())}
              >
                \uD83D\uDD27 Preview clarifier prompt
              </button>
            )}
          </section>
        )}

        {state.phase === "clarifying" && !state.loading && (
          <section>
            {state.readinessPct > 0 && (
              <div className="readiness-progress">
                <div className="readiness-bar">
                  <div
                    className={`readiness-fill ${state.readinessPct < 30 ? "readiness-low" : state.readinessPct < 60 ? "readiness-mid" : state.readinessPct < 85 ? "readiness-high" : "readiness-ready"}`}
                    style={{ width: `${Math.min(state.readinessPct, 100)}%` }}
                  />
                </div>
                <span className="readiness-label">
                  {state.readinessPct < 30 ? "Exploring" : state.readinessPct < 60 ? "Taking shape" : state.readinessPct < 85 ? "Almost there" : "Ready!"} ({state.readinessPct}%)
                </span>
              </div>
            )}

            {state.conflictFlag && (
              <div className="conflict-banner">
                <p>⚠ {state.conflictFlag}</p>
                <div className="conflict-actions">
                  <button
                    type="button"
                    className="chip-sm"
                    onClick={() => setState(s => ({ ...s, freeTextValue: `Regarding the conflict: I want to keep both as-is`, selectedOptionId: null, selectedOptionLabel: null }))}
                  >
                    Keep both
                  </button>
                  <button
                    type="button"
                    className="chip-sm"
                    onClick={() => setState(s => ({ ...s, freeTextValue: `Regarding the conflict: `, selectedOptionId: null, selectedOptionLabel: null }))}
                  >
                    I'll resolve it...
                  </button>
                </div>
              </div>
            )}

            <div className="question-header">
              <h2>{state.question}</h2>
            </div>

            <div className="free-text-row">
              <input
                value={state.freeTextValue}
                onChange={(event) =>
                  setState((prev) => ({ ...prev, freeTextValue: event.target.value, selectedOptionId: null, selectedOptionLabel: null }))
                }
                placeholder="Type your answer or pick a direction below\u2026"
                disabled={state.loading}
              />
            </div>

            {state.options.length > 0 && (
              <div className="suggestion-chips">
                <p className="chip-label">Or pick a direction:</p>
                <div className="chip-row">
                  {state.options.map((option) => (
                    <button
                      type="button"
                      className={`chip${state.selectedOptionId === option.id ? " chip-selected" : ""}`}
                      key={option.id}
                      disabled={state.loading}
                      onClick={() =>
                        setState((prev) => ({
                          ...prev,
                          selectedOptionId: prev.selectedOptionId === option.id ? null : option.id,
                          selectedOptionLabel: prev.selectedOptionId === option.id ? null : option.label,
                          freeTextValue: "",
                        }))
                      }
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {state.assumptions.length > 0 && (
              <div className="assumptions-section">
                <p className="assumptions-title">Things I'm assuming about your story:</p>
                {state.assumptions.map((a) => {
                  const resp = state.assumptionResponses[a.id];
                  return (
                    <div className="assumption-card" key={a.id}>
                      <div className="assumption-header">
                        <span className="assumption-category">{a.category.replace(/_/g, " ")}</span>
                        <span className="assumption-text">{a.assumption}</span>
                      </div>
                      <div className="assumption-actions">
                        <button
                          type="button"
                          className={`assumption-btn${resp?.action === "keep" ? " assumption-btn-active" : ""}`}
                          onClick={() =>
                            setState((prev) => ({
                              ...prev,
                              assumptionResponses: {
                                ...prev.assumptionResponses,
                                [a.id]: { action: "keep", value: a.assumption },
                              },
                            }))
                          }
                        >
                          Keep it
                        </button>
                        {a.alternatives.map((alt, i) => {
                          const isSelected = resp?.action === "alternative" && resp.value.split(" + ").includes(alt);
                          return (
                            <button
                              type="button"
                              key={`${a.id}-alt-${i}`}
                              className={`assumption-btn assumption-alt${isSelected ? " assumption-btn-active" : ""}`}
                              onClick={() =>
                                setState((prev) => {
                                  const prevResp = prev.assumptionResponses[a.id];
                                  const prevAlts = (prevResp?.action === "alternative" && prevResp.value)
                                    ? prevResp.value.split(" + ") : [];
                                  let newAlts: string[];
                                  if (prevAlts.includes(alt)) {
                                    newAlts = prevAlts.filter((v) => v !== alt);
                                  } else {
                                    newAlts = [...prevAlts, alt];
                                  }
                                  return {
                                    ...prev,
                                    assumptionResponses: {
                                      ...prev.assumptionResponses,
                                      [a.id]: newAlts.length > 0
                                        ? { action: "alternative", value: newAlts.join(" + ") }
                                        : { action: "keep", value: a.assumption },
                                    },
                                  };
                                })
                              }
                            >
                              {alt}
                            </button>
                          );
                        })}
                        <button
                          type="button"
                          className={`assumption-btn assumption-notready${resp?.action === "not_ready" ? " assumption-btn-active" : ""}`}
                          onClick={() =>
                            setState((prev) => ({
                              ...prev,
                              assumptionResponses: {
                                ...prev.assumptionResponses,
                                [a.id]: { action: "not_ready", value: "" },
                              },
                            }))
                          }
                        >
                          Not ready yet
                        </button>
                      </div>
                      {resp?.action !== "freeform" && (
                        <button
                          type="button"
                          className="assumption-btn assumption-freeform-trigger"
                          onClick={() =>
                            setState((prev) => ({
                              ...prev,
                              assumptionResponses: {
                                ...prev.assumptionResponses,
                                [a.id]: { action: "freeform", value: "" },
                              },
                            }))
                          }
                        >
                          My own idea...
                        </button>
                      )}
                      {resp?.action === "freeform" && (
                        <div className="assumption-freeform">
                          <input
                            type="text"
                            placeholder="Type your own idea..."
                            value={resp.value}
                            onChange={(e) =>
                              setState((prev) => ({
                                ...prev,
                                assumptionResponses: {
                                  ...prev.assumptionResponses,
                                  [a.id]: { action: "freeform", value: e.target.value },
                                },
                              }))
                            }
                          />
                        </div>
                      )}
                    </div>
                  );
                })}

              </div>
            )}

            {state.readyForHook && state.readinessNote && (
              <div className="readiness-banner">
                <p>{state.readinessNote}</p>
              </div>
            )}

            {/* Unified continue button — submits selected option + free text + assumption responses */}
            {(state.selectedOptionId || state.freeTextValue.trim() || Object.keys(state.assumptionResponses).length > 0) && (
              <button
                type="button"
                className="primary full continue-btn"
                disabled={state.loading}
                onClick={() => {
                  if (state.freeTextValue.trim()) {
                    void answerClarifier({ type: "free_text", label: state.freeTextValue.trim() });
                  } else if (state.selectedOptionId && state.selectedOptionLabel) {
                    void answerClarifier({ type: "option", optionId: state.selectedOptionId, label: state.selectedOptionLabel });
                  } else {
                    // Assumption-only response
                    void answerClarifier({
                      type: "free_text",
                      label: "(User responded to assumptions only — no answer to the main question)",
                    });
                  }
                }}
              >
                Continue {state.selectedOptionId ? "with this direction" : state.freeTextValue.trim() ? "" : "with these choices"} \u2192
              </button>
            )}

            {/* Prompt preview for clarifier */}
            {promptPreview?.stage === "clarifier" && (
              <PromptEditor
                stage="clarifier"
                systemPrompt={promptPreview.system}
                userPrompt={promptPreview.user}
                loading={state.loading}
                onOverridesChange={setPromptOverrides}
              />
            )}
            {!promptPreview && (
              <button
                type="button"
                className="prompt-toggle"
                onClick={() => void loadPromptPreview("clarifier")}
              >
                \uD83D\uDD27 View clarifier prompt
              </button>
            )}

            {state.turnNumber >= 2 && (
              <>
                {/* Prompt preview for builder (before generating) */}
                {promptPreview?.stage === "builder" && (
                  <PromptEditor
                    stage="builder"
                    systemPrompt={promptPreview.system}
                    userPrompt={promptPreview.user}
                    loading={state.loading}
                    onOverridesChange={setBuilderPromptOverrides}
                  />
                )}
                {promptPreview?.stage !== "builder" && (
                  <button
                    type="button"
                    className="prompt-toggle"
                    onClick={() => void loadPromptPreview("builder")}
                  >
                    \uD83D\uDD27 View builder prompt
                  </button>
                )}

                <button
                  type="button"
                  className={state.readyForHook ? "primary full" : "secondary full"}
                  disabled={state.loading}
                  onClick={() => void generateHook()}
                >
                  {state.readyForHook ? "\u26A1 Generate my hook!" : "\u26A1 Generate hook now (keep answering for a better result)"}
                </button>
              </>
            )}
          </section>
        )}

        {state.phase === "clarifying" && state.loading && (
          <section className="loading-state">
            <div className="loading-spinner" />
            <p>\u23F3 {loadingLabel || "Thinking\u2026"}</p>
          </section>
        )}

        {state.phase === "generating" && (
          <section className="loading-state">
            <div className="loading-spinner" />
            <p>\u23F3 {loadingLabel || "Building 3 hook candidates and judging them\u2026"}</p>
          </section>
        )}

        {(state.phase === "revealed" || state.phase === "locked") && hook && (
          <section>
            <article className="hook-output-card">
              <h3>YOUR HOOK</h3>

              {hook.hook_sentence && (
                <>
                  <h4>THE HOOK</h4>
                  <p className="hook-sentence">{hook.hook_sentence}</p>
                </>
              )}

              {hook.emotional_promise && (
                <>
                  <h4>EMOTIONAL PROMISE</h4>
                  <p className="emotional-promise">{hook.emotional_promise}</p>
                </>
              )}

              <h4>PREMISE</h4>
              {state.editing ? (
                <textarea
                  value={state.editPremise}
                  onChange={(event) =>
                    setState((prev) => ({ ...prev, editPremise: event.target.value }))
                  }
                />
              ) : (
                <p>{hook.premise}</p>
              )}

              <div className="details-toggle-row">
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => setDetailsExpanded((prev) => !prev)}
                >
                  {detailsExpanded ? "\u25BE" : "\u25B8"} Production details ({detailsExpanded ? "hide" : "show"})
                </button>
              </div>

              {detailsExpanded && (
                <div className="hook-details">
                  <h4>PAGE 1 SPLASH</h4>
                  <p>{hook.page_1_splash_prompt}</p>

                  <h4>PAGE-TURN TRIGGER</h4>
                  {state.editing ? (
                    <textarea
                      value={state.editTrigger}
                      onChange={(event) =>
                        setState((prev) => ({ ...prev, editTrigger: event.target.value }))
                      }
                    />
                  ) : (
                    <p>{hook.page_turn_trigger}</p>
                  )}

                  <h4>WHY IT&apos;S ADDICTIVE</h4>
                  <ul>
                    {hook.why_addictive.map((bullet, index) => (
                      <li key={`${bullet}-${index}`}>{bullet}</li>
                    ))}
                  </ul>

                  {sourceSection}
                </div>
              )}
            </article>

            {state.phase === "revealed" && state.judgeInfo && !state.judgeInfo.passed && (
              <aside className="judge-warning">
                <p>\u26A0\uFE0F Judge didn&apos;t fully pass this hook:</p>
                <ul>
                  {state.judgeInfo.hard_fail_reasons.map((reason, index) => (
                    <li key={`${reason}-${index}`}>{reason}</li>
                  ))}
                </ul>
                <p>Weakest part: &ldquo;{state.judgeInfo.most_generic_part}&rdquo;</p>
                <p>Suggestion: {state.judgeInfo.one_fix_instruction}</p>
              </aside>
            )}

            {state.phase === "revealed" && (
              <div className="actions-row">
                <button type="button" disabled={state.loading} onClick={() => void reroll()}>
                  {state.loading ? "Working\u2026" : `\uD83D\uDD04 Reroll${state.rerollCount > 0 ? ` (${state.rerollCount})` : ""}`}
                </button>
                <button
                  type="button"
                  disabled={state.loading}
                  onClick={() =>
                    state.editing
                      ? void lock({
                          premise: state.editPremise.trim(),
                          page_turn_trigger: state.editTrigger.trim(),
                        })
                      : setState((prev) => ({ ...prev, editing: true }))
                  }
                >
                  \u270F\uFE0F {state.editing ? "Save edits & Lock" : "Edit & Lock"}
                </button>
                <button type="button" className="primary" disabled={state.loading} onClick={() => void lock()}>
                  \u2705 Lock it
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={state.loading}
                  onClick={() => setShowConstraintOverrides((v) => !v)}
                >
                  {showConstraintOverrides ? "Hide" : "Show"} Constraints
                </button>
              </div>
            )}

            {state.phase === "revealed" && showConstraintOverrides && (
              <div className="constraint-overrides">
                <label htmlFor="hook-constraint-overrides">
                  <strong>Constraint Overrides</strong>
                  <span className="hint"> (one per line: key: value)</span>
                </label>
                <textarea
                  id="hook-constraint-overrides"
                  rows={4}
                  placeholder={"setting: deep-space station\ntone: noir\nstakes: survival"}
                  value={constraintOverridesText}
                  onChange={(e) => setConstraintOverridesText(e.target.value)}
                />
                <p className="hint">
                  Override or add constraint ledger entries before rerolling. Use keys like: setting, tone, stakes, hook_engine, character_role, antagonist, taboo_or_tension.
                </p>
              </div>
            )}

            {state.phase === "locked" && (
              <>
                {lockedPack && <PackPreview pack={lockedPack} defaultExpanded />}
                <div className="actions-row">
                  <p>Hook locked -- ready for character module</p>
                  <button type="button" disabled={state.loading} onClick={() => void exportFullSession()}>
                    Export full session
                  </button>
                  <button type="button" disabled={state.loading} onClick={() => void startOver()}>
                    Start over
                  </button>
                </div>
              </>
            )}
          </section>
        )}

        {state.phase !== "seed" && (
          <div className="export-row">
            <button
              type="button"
              className="prompt-toggle"
              onClick={() => void exportPromptHistory()}
              disabled={state.loading}
            >
              \uD83D\uDCE5 Export prompt history
            </button>
          </div>
        )}
      </section>

      <button type="button" className="psych-toggle" onClick={() => setShowPsych((v) => !v)}>
        {showPsych ? "Hide" : "Show"} Psychology
      </button>
      <button type="button" className="insights-toggle" onClick={() => setShowInsights((v) => !v)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>
        Insights
      </button>
      <PsychologyOverlay
        fetchPsychology={fetchPsych}
        projectId={projectId}
        visible={showPsych}
        onClose={() => setShowPsych(false)}
      />
      <EngineInsights
        module="hook"
        projectId={projectId}
        fetchInsights={fetchInsights}
        visible={showInsights}
        onClose={() => setShowInsights(false)}
      />
    </main>
  );
}
