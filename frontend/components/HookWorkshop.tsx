import { useMemo, useState } from "react";
import { hookApi } from "../api/hookApi";
import type {
  HookBuilderOutput,
  HookClarifierOption,
  HookJudgeScores,
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
  revealedHook: null,
  judgeInfo: null,
  rerollCount: 0,
  loading: false,
  loadingMessage: "",
  error: null,
  editing: false,
  editPremise: "",
  editTrigger: "",
};

function makeProjectId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `project-${Date.now()}`;
}

export function HookWorkshop() {
  const [projectId] = useState(() => makeProjectId());
  const [state, setState] = useState<HookWorkshopState>(initialState);
  const [lastAction, setLastAction] = useState<null | (() => Promise<void>)>(null);
  const [sourcesExpanded, setSourcesExpanded] = useState(false);

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

  const startSeed = async () => {
    if (!state.seedInput.trim()) return;

    await runAndTrack(async () => {
      setState((prev) => ({
        ...prev,
        loading: true,
        loadingMessage: "Clarifying your concept…",
        error: null,
      }));

      const response = await hookApi.clarify({
        projectId,
        seedInput: state.seedInput.trim(),
      });

      setState((prev) => ({
        ...prev,
        phase: response.clarifier.ready_for_hook ? "generating" : "clarifying",
        hypothesisLine: response.clarifier.hypothesis_line,
        question: response.clarifier.question,
        options: response.clarifier.options,
        allowFreeText: response.clarifier.allow_free_text,
        turnNumber: response.turnNumber,
        readyForHook: response.clarifier.ready_for_hook,
        showFreeTextInput: false,
        freeTextValue: "",
        loading: false,
        loadingMessage: "",
        error: null,
      }));

      if (response.clarifier.ready_for_hook) {
        await generateHook();
      }
    });
  };

  const answerClarifier = async (selection: {
    type: "option" | "surprise_me" | "free_text";
    optionId?: string;
    label: string;
  }) => {
    await runAndTrack(async () => {
      setState((prev) => ({
        ...prev,
        loading: true,
        loadingMessage: "Refining your hook DNA…",
        error: null,
      }));

      const response = await hookApi.clarify({
        projectId,
        userSelection: selection,
      });

      setState((prev) => ({
        ...prev,
        phase: response.clarifier.ready_for_hook ? "generating" : "clarifying",
        hypothesisLine: response.clarifier.hypothesis_line,
        question: response.clarifier.question,
        options: response.clarifier.options,
        allowFreeText: response.clarifier.allow_free_text,
        turnNumber: response.turnNumber,
        readyForHook: response.clarifier.ready_for_hook,
        showFreeTextInput: false,
        freeTextValue: "",
        loading: false,
        loadingMessage: "",
        error: null,
      }));

      if (response.clarifier.ready_for_hook) {
        await generateHook();
      }
    });
  };

  const generateHook = async () => {
    await runAndTrack(async () => {
      setState((prev) => ({
        ...prev,
        phase: "generating",
        loading: true,
        loadingMessage: "Building 3 hook candidates and judging them…",
        error: null,
      }));

      const response = await hookApi.generate(projectId);

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
    });
  };

  const reroll = async () => {
    await runAndTrack(async () => {
      setState((prev) => ({
        ...prev,
        phase: "generating",
        loading: true,
        loadingMessage: "Building a fresh hook tournament…",
        error: null,
      }));

      const response = await hookApi.reroll(projectId);

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
    });
  };

  const lock = async (edits?: { premise?: string; page_turn_trigger?: string }) => {
    await runAndTrack(async () => {
      setState((prev) => ({ ...prev, loading: true, loadingMessage: "Locking your hook…", error: null }));
      const pack = await hookApi.lock(projectId, edits);

      setState((prev) => ({
        ...prev,
        phase: "locked",
        revealedHook: {
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
    });
  };

  const startOver = async () => {
    await runAndTrack(async () => {
      setState((prev) => ({ ...prev, loading: true, loadingMessage: "Resetting workshop…", error: null }));
      await hookApi.reset(projectId);
      setState(initialState);
      setSourcesExpanded(false);
    });
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
          ▸ Sources ({sourcesExpanded ? "hide" : "show"})
        </button>
        {sourcesExpanded && (
          <ul>
            {hook.collision_sources.map((source, index) => (
              <li key={`${source.source}-${index}`}>
                {source.source} → {source.element_extracted}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }, [hook?.collision_sources, sourcesExpanded]);

  return (
    <main className="workshop-shell">
      <section className="workshop-card">
        {state.phase !== "seed" && (
          <header className="hypothesis-banner" key={state.hypothesisLine}>
            <p className="hypothesis-title">Here's how I see your hook shaping so far…</p>
            <p>{state.hypothesisLine}</p>
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
              />
              <button type="button" className="primary" onClick={() => void startSeed()}>
                Go →
              </button>
            </div>
          </section>
        )}

        {state.phase === "clarifying" && (
          <section>
            <div className="question-header">
              <h2>{state.question}</h2>
              <span>Question {state.turnNumber} of ~3</span>
            </div>

            <div className="options-stack">
              {state.options.map((option) => (
                <button
                  type="button"
                  key={option.id}
                  onClick={() => void answerClarifier({ type: "option", optionId: option.id, label: option.label })}
                >
                  {option.label}
                </button>
              ))}

              <button type="button" onClick={() => void answerClarifier({ type: "surprise_me", label: "surprise_me" })}>
                🎲 Surprise me
              </button>

              {state.allowFreeText && (
                <>
                  <button
                    type="button"
                    onClick={() => setState((prev) => ({ ...prev, showFreeTextInput: !prev.showFreeTextInput }))}
                  >
                    ✏️ None of these
                  </button>
                  {state.showFreeTextInput && (
                    <div className="free-text-row">
                      <input
                        value={state.freeTextValue}
                        onChange={(event) =>
                          setState((prev) => ({ ...prev, freeTextValue: event.target.value }))
                        }
                        placeholder="Type your direction"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          void answerClarifier({
                            type: "free_text",
                            label: state.freeTextValue.trim(),
                          })
                        }
                        disabled={!state.freeTextValue.trim()}
                      >
                        Submit
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>

            <button
              type="button"
              className={state.readyForHook ? "primary full" : "secondary full"}
              onClick={() => void generateHook()}
            >
              ⚡ Generate hook now
            </button>
          </section>
        )}

        {state.phase === "generating" && (
          <section className="loading-state">
            <p>⏳ {loadingLabel || "Building 3 hook candidates and judging them…"}</p>
          </section>
        )}

        {(state.phase === "revealed" || state.phase === "locked") && hook && (
          <section>
            <article className="hook-output-card">
              <h3>YOUR HOOK</h3>

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

              <h4>WHY IT'S ADDICTIVE</h4>
              <ul>
                {hook.why_addictive.map((bullet, index) => (
                  <li key={`${bullet}-${index}`}>{bullet}</li>
                ))}
              </ul>

              {sourceSection}
            </article>

            {state.phase === "revealed" && state.judgeInfo && !state.judgeInfo.passed && (
              <aside className="judge-warning">
                <p>⚠️ Judge didn't fully pass this hook:</p>
                <ul>
                  {state.judgeInfo.hard_fail_reasons.map((reason, index) => (
                    <li key={`${reason}-${index}`}>{reason}</li>
                  ))}
                </ul>
                <p>Weakest part: "{state.judgeInfo.most_generic_part}"</p>
                <p>Suggestion: {state.judgeInfo.one_fix_instruction}</p>
              </aside>
            )}

            {state.phase === "revealed" && (
              <div className="actions-row">
                <button type="button" onClick={() => void reroll()}>
                  🔄 Reroll{state.rerollCount > 0 ? ` (${state.rerollCount})` : ""}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    state.editing
                      ? void lock({
                          premise: state.editPremise.trim(),
                          page_turn_trigger: state.editTrigger.trim(),
                        })
                      : setState((prev) => ({ ...prev, editing: true }))
                  }
                >
                  ✏️ {state.editing ? "Save edits & Lock" : "Edit & Lock"}
                </button>
                <button type="button" className="primary" onClick={() => void lock()}>
                  ✅ Lock it
                </button>
              </div>
            )}

            {state.phase === "locked" && (
              <div className="actions-row">
                <p>✅ Hook locked</p>
                <button type="button" onClick={() => void startOver()}>
                  Start over
                </button>
              </div>
            )}
          </section>
        )}
      </section>
    </main>
  );
}
