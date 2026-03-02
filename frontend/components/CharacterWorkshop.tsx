import React, { useMemo, useState } from "react";
import { characterApi } from "../lib/characterApi";
import type {
  CharacterAssumptionResponse,
  CharacterBuilderOutput,
  CharacterClarifierOption,
  CharacterAssumption,
  CharacterJudgeScores,
  CharacterRelationshipUpdate,
  CharacterSurfaced,
} from "../../shared/types/character";

type Phase = "connect" | "start" | "seeding" | "clarifying" | "generating" | "revealed" | "locked";

interface CharacterWorkshopState {
  phase: Phase;
  hypothesisLine: string;
  question: string;
  options: CharacterClarifierOption[];
  allowFreeText: boolean;
  freeTextValue: string;
  characterFocus: string | null;
  turnNumber: number;
  readyForCharacters: boolean;
  readinessPct: number;
  readinessNote: string;
  conflictFlag: string;
  charactersSurfaced: CharacterSurfaced[];
  relationshipUpdates: CharacterRelationshipUpdate[];
  revealedCharacters: CharacterBuilderOutput | null;
  judgeInfo: {
    passed: boolean;
    hard_fail_reasons: string[];
    scores: CharacterJudgeScores;
    weakest_character: string;
    one_fix_instruction: string;
  } | null;
  loading: boolean;
  loadingMessage: string;
  error: string | null;
  assumptions: CharacterAssumption[];
  assumptionResponses: Record<string, { action: "keep" | "alternative" | "freeform" | "not_ready"; value: string }>;
  selectedOptionId: string | null;
  selectedOptionLabel: string | null;
  characterSeedValue: string;
}

const initialState: CharacterWorkshopState = {
  phase: "connect",
  hypothesisLine: "",
  question: "",
  options: [],
  allowFreeText: true,
  freeTextValue: "",
  characterFocus: null,
  turnNumber: 0,
  readyForCharacters: false,
  readinessPct: 0,
  readinessNote: "",
  conflictFlag: "",
  charactersSurfaced: [],
  relationshipUpdates: [],
  revealedCharacters: null,
  judgeInfo: null,
  loading: false,
  loadingMessage: "",
  error: null,
  assumptions: [],
  assumptionResponses: {},
  selectedOptionId: null,
  selectedOptionLabel: null,
  characterSeedValue: "",
};

const CHAR_SESSION_KEY = "characterWorkshop_projectId";
const CHAR_HOOK_ID_KEY = "characterWorkshop_hookProjectId";
const HOOK_SESSION_KEY = "hookWorkshop_projectId";

function makeProjectId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `char-${crypto.randomUUID()}`;
  }
  return `char-${Date.now()}`;
}

function loadSaved(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function saveTo(key: string, id: string) {
  try { localStorage.setItem(key, id); } catch {}
}
function clearSaved(key: string) {
  try { localStorage.removeItem(key); } catch {}
}

export function CharacterWorkshop() {
  const [projectId, setProjectId] = useState(() => {
    return loadSaved(CHAR_SESSION_KEY) ?? makeProjectId();
  });

  // Hook project ID — try to auto-detect from localStorage, but allow manual override
  const [hookProjectId, setHookProjectId] = useState(() => {
    return loadSaved(CHAR_HOOK_ID_KEY) ?? loadSaved(HOOK_SESSION_KEY) ?? "";
  });
  const [hookIdInput, setHookIdInput] = useState(() => {
    return loadSaved(CHAR_HOOK_ID_KEY) ?? loadSaved(HOOK_SESSION_KEY) ?? "";
  });
  const [hookValidated, setHookValidated] = useState(false);
  const [hookPreview, setHookPreview] = useState<{ seedInput: string; premise: string } | null>(null);

  const [state, setState] = useState<CharacterWorkshopState>(initialState);
  const [lastAction, setLastAction] = useState<null | (() => Promise<void>)>(null);
  const [sourcesExpanded, setSourcesExpanded] = useState(false);

  // Crash recovery
  const [recoverySession, setRecoverySession] = useState<any>(null);
  const [recoveryChecked, setRecoveryChecked] = useState(false);

  React.useEffect(() => {
    const savedCharId = loadSaved(CHAR_SESSION_KEY);
    if (savedCharId) {
      characterApi.getSession(savedCharId).then((session) => {
        if (session && session.status !== "locked") {
          setRecoverySession(session);
          // Restore hook connection from the session itself (survives localStorage loss)
          if (session.hookProjectId) {
            setHookProjectId(session.hookProjectId);
            setHookIdInput(session.hookProjectId);
            setHookValidated(true);
            saveTo(CHAR_HOOK_ID_KEY, session.hookProjectId);
          }
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
    saveTo(CHAR_SESSION_KEY, session.projectId);

    // Restore hook connection from session data
    if (session.hookProjectId) {
      setHookProjectId(session.hookProjectId);
      setHookIdInput(session.hookProjectId);
      setHookValidated(true);
      saveTo(CHAR_HOOK_ID_KEY, session.hookProjectId);
    }

    const lastTurn = session.turns?.length > 0 ? session.turns[session.turns.length - 1] : null;

    if (session.status === "revealed" && session.revealedCharacters) {
      setState((prev) => ({
        ...prev,
        phase: "revealed",
        hypothesisLine: lastTurn?.clarifierResponse?.hypothesis_line ?? "",
        revealedCharacters: session.revealedCharacters,
        judgeInfo: session.revealedJudge ? {
          passed: session.revealedJudge.pass,
          hard_fail_reasons: session.revealedJudge.hard_fail_reasons,
          scores: session.revealedJudge.scores,
          weakest_character: session.revealedJudge.weakest_character,
          one_fix_instruction: session.revealedJudge.one_fix_instruction,
        } : null,
        turnNumber: session.turns?.length ?? 0,
      }));
    } else if (session.status === "clarifying" && lastTurn) {
      const allAssumptions: CharacterAssumption[] = [];
      for (const char of lastTurn.clarifierResponse.characters_surfaced ?? []) {
        allAssumptions.push(...(char.assumptions ?? []));
      }

      setState((prev) => ({
        ...prev,
        phase: "clarifying",
        hypothesisLine: lastTurn.clarifierResponse.hypothesis_line,
        question: lastTurn.clarifierResponse.question,
        options: lastTurn.clarifierResponse.options,
        allowFreeText: lastTurn.clarifierResponse.allow_free_text,
        characterFocus: lastTurn.clarifierResponse.character_focus,
        turnNumber: session.turns.length,
        readyForCharacters: lastTurn.clarifierResponse.ready_for_characters,
        readinessPct: lastTurn.clarifierResponse.readiness_pct ?? 0,
        readinessNote: lastTurn.clarifierResponse.readiness_note ?? "",
        conflictFlag: lastTurn.clarifierResponse.conflict_flag ?? "",
        charactersSurfaced: lastTurn.clarifierResponse.characters_surfaced ?? [],
        relationshipUpdates: lastTurn.clarifierResponse.relationship_updates ?? [],
        assumptions: allAssumptions,
        assumptionResponses: {},
      }));
    } else if (session.status === "generating") {
      setState((prev) => ({
        ...prev,
        phase: "clarifying",
        hypothesisLine: lastTurn?.clarifierResponse?.hypothesis_line ?? "",
        question: lastTurn?.clarifierResponse?.question ?? "Ready to generate?",
        options: [],
        turnNumber: session.turns?.length ?? 2,
        readyForCharacters: true,
        readinessNote: "Recovered from a crash — ready to generate your cast again!",
      }));
    }

    setRecoverySession(null);
  }, []);

  const dismissRecovery = React.useCallback(() => {
    clearSaved(CHAR_SESSION_KEY);
    // Keep the hook connection — don't clear CHAR_HOOK_ID_KEY
    const newId = makeProjectId();
    setProjectId(newId);
    setRecoverySession(null);
  }, []);

  const setError = (error: unknown) => {
    const message = error instanceof Error ? error.message : "Something went wrong";
    setState((prev) => ({ ...prev, loading: false, error: message }));
  };

  const runAndTrack = async (fn: () => Promise<void>) => {
    setLastAction(() => fn);
    try { await fn(); } catch (error) { setError(error); }
  };

  const buildStructuredAssumptionResponses = (): CharacterAssumptionResponse[] => {
    const responses: CharacterAssumptionResponse[] = [];
    for (const [id, resp] of Object.entries(state.assumptionResponses)) {
      const assumption = state.assumptions.find((a) => a.id === id);
      if (!assumption) continue;
      responses.push({
        assumptionId: id,
        characterRole: assumption.characterRole,
        category: assumption.category,
        action: resp.action,
        originalValue: assumption.assumption,
        newValue: resp.value,
      });
    }
    return responses;
  };

  // ─── Validate Hook Export ───

  const validateHookId = async () => {
    const id = hookIdInput.trim();
    if (!id) return;

    setState((prev) => ({ ...prev, loading: true, loadingMessage: "Checking hook export...", error: null }));

    try {
      const exportData = await characterApi.checkHookExport(id);
      setHookProjectId(id);
      setHookValidated(true);
      setHookPreview({
        seedInput: exportData.seedInput ?? "",
        premise: exportData.hookPack?.locked?.premise ?? "(no premise found)",
      });
      saveTo(CHAR_HOOK_ID_KEY, id);
      setState((prev) => ({ ...prev, phase: "start", loading: false, loadingMessage: "", error: null }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        loadingMessage: "",
        error: `Could not find a hook export for "${id}". Make sure you've locked the hook module first.`,
      }));
      setHookValidated(false);
      setHookPreview(null);
    }
  };

  // ─── First Turn ───

  const startCharacterSession = async () => {
    await runAndTrack(async () => {
      setState((prev) => ({ ...prev, loading: true, loadingMessage: "Reading your hook and preparing cast questions...", error: null }));
      saveTo(CHAR_SESSION_KEY, projectId);
      saveTo(CHAR_HOOK_ID_KEY, hookProjectId);

      const seed = state.characterSeedValue.trim() || undefined;
      const response = await characterApi.clarify({
        projectId,
        hookProjectId,
        characterSeed: seed,
      });

      const allAssumptions: CharacterAssumption[] = [];
      for (const char of response.clarifier.characters_surfaced ?? []) {
        allAssumptions.push(...(char.assumptions ?? []));
      }

      setState((prev) => ({
        ...prev,
        phase: "clarifying",
        hypothesisLine: response.clarifier.hypothesis_line,
        question: response.clarifier.question,
        options: response.clarifier.options,
        allowFreeText: response.clarifier.allow_free_text,
        characterFocus: response.clarifier.character_focus,
        turnNumber: response.turnNumber,
        readyForCharacters: response.clarifier.ready_for_characters,
        readinessPct: response.clarifier.readiness_pct ?? 0,
        readinessNote: response.clarifier.readiness_note ?? "",
        conflictFlag: response.clarifier.conflict_flag ?? "",
        charactersSurfaced: response.clarifier.characters_surfaced ?? [],
        relationshipUpdates: response.clarifier.relationship_updates ?? [],
        assumptions: allAssumptions,
        assumptionResponses: {},
        selectedOptionId: null,
        selectedOptionLabel: null,
        freeTextValue: "",
        loading: false,
        loadingMessage: "",
        error: null,
      }));
    });
  };

  // ─── Subsequent Turns ───

  const answerClarifier = async (selection: {
    type: "option" | "surprise_me" | "free_text";
    optionId?: string;
    label: string;
  }) => {
    await runAndTrack(async () => {
      const assumptionResponses = buildStructuredAssumptionResponses();
      setState((prev) => ({ ...prev, loading: true, loadingMessage: "Thinking...", error: null }));

      const response = await characterApi.clarify({
        projectId,
        hookProjectId,
        userSelection: selection,
        assumptionResponses: assumptionResponses.length > 0 ? assumptionResponses : undefined,
      });

      const allAssumptions: CharacterAssumption[] = [];
      for (const char of response.clarifier.characters_surfaced ?? []) {
        allAssumptions.push(...(char.assumptions ?? []));
      }

      setState((prev) => ({
        ...prev,
        phase: "clarifying",
        hypothesisLine: response.clarifier.hypothesis_line,
        question: response.clarifier.question,
        options: response.clarifier.options,
        allowFreeText: response.clarifier.allow_free_text,
        characterFocus: response.clarifier.character_focus,
        turnNumber: response.turnNumber,
        readyForCharacters: response.clarifier.ready_for_characters,
        readinessPct: response.clarifier.readiness_pct ?? 0,
        readinessNote: response.clarifier.readiness_note ?? "",
        conflictFlag: response.clarifier.conflict_flag ?? "",
        charactersSurfaced: response.clarifier.characters_surfaced ?? [],
        relationshipUpdates: response.clarifier.relationship_updates ?? [],
        assumptions: allAssumptions,
        assumptionResponses: {},
        selectedOptionId: null,
        selectedOptionLabel: null,
        freeTextValue: "",
        loading: false,
        loadingMessage: "",
        error: null,
      }));
    });
  };

  // ─── Generate ───

  const generateCharacters = async () => {
    await runAndTrack(async () => {
      const progressMessages = [
        "Building your cast from the creative brief...",
        "Crafting psychological profiles...",
        "Weaving relationship dynamics...",
        "Quality checking the ensemble...",
        "Polishing descriptions...",
        "Almost there...",
      ];
      let step = 0;

      setState((prev) => ({
        ...prev,
        phase: "generating",
        loading: true,
        loadingMessage: progressMessages[0],
        error: null,
      }));

      const progressInterval = setInterval(() => {
        step = Math.min(step + 1, progressMessages.length - 1);
        setState((prev) => ({ ...prev, loadingMessage: progressMessages[step] }));
      }, 5000);

      try {
        const response = await characterApi.generate(projectId);
        clearInterval(progressInterval);

        setState((prev) => ({
          ...prev,
          phase: "revealed",
          revealedCharacters: response.characters,
          judgeInfo: response.judge,
          loading: false,
          loadingMessage: "",
          error: null,
        }));
      } catch (err) {
        clearInterval(progressInterval);
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
        loadingMessage: "Trying a fresh cast...",
        error: null,
      }));

      const response = await characterApi.reroll(projectId);

      setState((prev) => ({
        ...prev,
        phase: "revealed",
        revealedCharacters: response.characters,
        judgeInfo: response.judge,
        loading: false,
        loadingMessage: "",
      }));
    });
  };

  const lockCharacters = async () => {
    await runAndTrack(async () => {
      setState((prev) => ({ ...prev, loading: true, loadingMessage: "Locking your cast...", error: null }));
      await characterApi.lock(projectId);
      setState((prev) => ({
        ...prev,
        phase: "locked",
        loading: false,
        loadingMessage: "",
      }));
    });
  };

  const startOver = async () => {
    await runAndTrack(async () => {
      setState((prev) => ({ ...prev, loading: true, loadingMessage: "Resetting...", error: null }));
      await characterApi.reset(projectId);
      clearSaved(CHAR_SESSION_KEY);
      // Keep the hook connection — don't clear CHAR_HOOK_ID_KEY, hookProjectId, or hookPreview
      const newId = makeProjectId();
      setProjectId(newId);
      setState({ ...initialState, phase: "start" });
    });
  };

  const cast = state.revealedCharacters;

  // ─── Recovery Screen ───

  if (!recoveryChecked) {
    return (
      <main className="workshop-shell">
        <section className="workshop-card">
          <div className="loading-state"><p>Loading...</p></div>
        </section>
      </main>
    );
  }

  if (recoverySession) {
    return (
      <main className="workshop-shell">
        <section className="workshop-card">
          <div className="recovery-banner">
            <p>Found a previous character session ({recoverySession.status}).</p>
            <div className="recovery-actions">
              <button type="button" className="primary" onClick={() => recoverSession(recoverySession)}>Resume session</button>
              <button type="button" onClick={dismissRecovery}>Start fresh</button>
            </div>
          </div>
        </section>
      </main>
    );
  }

  // ─── Main Render ───

  return (
    <main className="workshop-shell">
      <section className="workshop-card">
        {state.phase !== "connect" && state.phase !== "start" && state.hypothesisLine && (
          <header className="hypothesis-banner" key={state.hypothesisLine}>
            <p className="hypothesis-title">
              {state.turnNumber <= 2 ? "First impressions of your cast..." : "Your cast is taking shape..."}
            </p>
            <p className="hypothesis-line">{state.hypothesisLine}</p>
          </header>
        )}

        {state.error && (
          <div className="error-banner">
            <p>Something went wrong: {state.error}</p>
            {lastAction && (
              <button type="button" onClick={() => void lastAction()}>Retry</button>
            )}
          </div>
        )}

        {/* ─── Connect Phase: enter hook project ID ─── */}
        {state.phase === "connect" && (
          <section>
            <p className="lead">Connect to your hook</p>
            <p>Enter the project ID from the hook module to import your locked premise and start building characters.</p>

            <div className="seed-row">
              <input
                value={hookIdInput}
                onChange={(e) => setHookIdInput(e.target.value)}
                placeholder="Paste hook project ID here..."
                disabled={state.loading}
                onKeyDown={(e: React.KeyboardEvent) => {
                  if (e.key === "Enter" && hookIdInput.trim()) {
                    void validateHookId();
                  }
                }}
              />
              <button
                type="button"
                className="primary"
                onClick={() => void validateHookId()}
                disabled={state.loading || !hookIdInput.trim()}
              >
                {state.loading ? "Checking..." : "Load hook"}
              </button>
            </div>

            {loadSaved(HOOK_SESSION_KEY) && hookIdInput !== loadSaved(HOOK_SESSION_KEY) && (
              <p className="hook-id-hint">
                Detected from Hook module: <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    const detected = loadSaved(HOOK_SESSION_KEY) ?? "";
                    setHookIdInput(detected);
                  }}
                >
                  {loadSaved(HOOK_SESSION_KEY)?.slice(0, 20)}...
                </button>
              </p>
            )}
          </section>
        )}

        {/* ─── Start Phase: hook validated, ready to begin ─── */}
        {state.phase === "start" && (
          <section>
            <p className="lead">Time to meet the people who live in your story.</p>

            {hookPreview && (
              <div className="hook-preview-card">
                <p className="hook-preview-label">Imported from hook module:</p>
                {hookPreview.seedInput && (
                  <p className="hook-preview-seed">Seed: &ldquo;{hookPreview.seedInput.slice(0, 120)}{hookPreview.seedInput.length > 120 ? "..." : ""}&rdquo;</p>
                )}
                <p className="hook-preview-premise">{hookPreview.premise.slice(0, 300)}{hookPreview.premise.length > 300 ? "..." : ""}</p>
              </div>
            )}

            <div className="actions-row">
              <button
                type="button"
                className="primary"
                onClick={() => setState((prev) => ({ ...prev, phase: "seeding" }))}
                disabled={state.loading}
              >
                Let's build the cast
              </button>
              <button
                type="button"
                onClick={() => {
                  setHookValidated(false);
                  setHookPreview(null);
                  setState((prev) => ({ ...prev, phase: "connect", error: null }));
                }}
                disabled={state.loading}
              >
                Use different hook
              </button>
            </div>
          </section>
        )}

        {/* ─── Seeding Phase: free-form opening question ─── */}
        {state.phase === "seeding" && !state.loading && (
          <section>
            <p className="lead">Before we dig in — what kind of characters are you imagining?</p>
            <p style={{ opacity: 0.7, marginBottom: "1rem" }}>
              This is totally free-form. A sentence, a vibe, a half-baked idea — anything helps.
              You can also skip this and we'll figure it out together.
            </p>

            <div className="seed-textarea-row">
              <textarea
                value={state.characterSeedValue}
                onChange={(e) => setState((prev) => ({ ...prev, characterSeedValue: e.target.value }))}
                placeholder='e.g. "A con artist who actually believes their own lies, paired with someone who sees through everyone except them" or "I want a villain you almost root for"'
                rows={4}
                style={{ width: "100%", resize: "vertical", padding: "0.75rem", borderRadius: "8px", border: "1px solid #444", background: "#1a1a2e", color: "#eee", fontSize: "0.95rem", fontFamily: "inherit" }}
                disabled={state.loading}
              />
            </div>

            <div className="actions-row" style={{ marginTop: "1rem" }}>
              <button
                type="button"
                className="primary"
                onClick={() => void startCharacterSession()}
                disabled={state.loading}
              >
                {state.characterSeedValue.trim() ? "Let's go!" : "Skip — surprise me"}
              </button>
              <button
                type="button"
                onClick={() => setState((prev) => ({ ...prev, phase: "start" }))}
                disabled={state.loading}
              >
                Back
              </button>
            </div>
          </section>
        )}

        {state.phase === "seeding" && state.loading && (
          <section className="loading-state">
            <p>{state.loadingMessage || "Reading your hook and preparing cast questions..."}</p>
          </section>
        )}

        {/* ─── Clarifying Phase ─── */}
        {state.phase === "clarifying" && !state.loading && (
          <section>
            {state.readinessPct > 0 && (
              <div className="readiness-progress">
                <div className="readiness-bar">
                  <div className="readiness-fill" style={{ width: `${Math.min(state.readinessPct, 100)}%` }} />
                </div>
                <span className="readiness-label">
                  {state.readinessPct < 30 ? "Meeting the cast" : state.readinessPct < 60 ? "Characters forming" : state.readinessPct < 85 ? "Almost there" : "Ready!"} ({state.readinessPct}%)
                </span>
              </div>
            )}

            {state.characterFocus && (
              <div className="focus-indicator">
                Shaping: <strong>{state.characterFocus.replace(/_/g, " ").replace(/\./g, " & ")}</strong>
              </div>
            )}

            {state.conflictFlag && (
              <div className="conflict-banner"><p>{state.conflictFlag}</p></div>
            )}

            <div className="question-header">
              <h2>{state.question}</h2>
            </div>

            <div className="free-text-row">
              <input
                value={state.freeTextValue}
                onChange={(e) => setState((prev) => ({ ...prev, freeTextValue: e.target.value, selectedOptionId: null, selectedOptionLabel: null }))}
                placeholder="Type your answer or pick a direction below..."
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

            {/* ─── Assumptions ─── */}
            {state.assumptions.length > 0 && (
              <div className="assumptions-section">
                <p className="assumptions-title">Things I'm assuming about your characters:</p>
                {state.assumptions.map((a) => {
                  const resp = state.assumptionResponses[a.id];
                  return (
                    <div className="assumption-card" key={a.id}>
                      <div className="assumption-header">
                        <span className="assumption-category">{a.characterRole} &middot; {a.category.replace(/_/g, " ")}</span>
                        <span className="assumption-text">{a.assumption}</span>
                      </div>
                      <div className="assumption-actions">
                        <button
                          type="button"
                          className={`assumption-btn${resp?.action === "keep" ? " assumption-btn-active" : ""}`}
                          onClick={() =>
                            setState((prev) => ({
                              ...prev,
                              assumptionResponses: { ...prev.assumptionResponses, [a.id]: { action: "keep", value: a.assumption } },
                            }))
                          }
                        >Keep it</button>
                        {a.alternatives.map((alt, i) => (
                          <button
                            type="button"
                            key={`${a.id}-alt-${i}`}
                            className={`assumption-btn assumption-alt${resp?.action === "alternative" && resp.value === alt ? " assumption-btn-active" : ""}`}
                            onClick={() =>
                              setState((prev) => ({
                                ...prev,
                                assumptionResponses: { ...prev.assumptionResponses, [a.id]: { action: "alternative", value: alt } },
                              }))
                            }
                          >{alt}</button>
                        ))}
                        <button
                          type="button"
                          className={`assumption-btn assumption-notready${resp?.action === "not_ready" ? " assumption-btn-active" : ""}`}
                          onClick={() =>
                            setState((prev) => ({
                              ...prev,
                              assumptionResponses: { ...prev.assumptionResponses, [a.id]: { action: "not_ready", value: "" } },
                            }))
                          }
                        >Not ready yet</button>
                      </div>
                      {resp?.action !== "freeform" && (
                        <button
                          type="button"
                          className="assumption-btn assumption-freeform-trigger"
                          onClick={() =>
                            setState((prev) => ({
                              ...prev,
                              assumptionResponses: { ...prev.assumptionResponses, [a.id]: { action: "freeform", value: "" } },
                            }))
                          }
                        >My own idea...</button>
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
                                assumptionResponses: { ...prev.assumptionResponses, [a.id]: { action: "freeform", value: e.target.value } },
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

            {state.readyForCharacters && state.readinessNote && (
              <div className="readiness-banner"><p>{state.readinessNote}</p></div>
            )}

            {/* Continue button */}
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
                    void answerClarifier({ type: "free_text", label: "(User responded to assumptions only)" });
                  }
                }}
              >
                Continue {state.selectedOptionId ? "with this direction" : state.freeTextValue.trim() ? "" : "with these choices"} &rarr;
              </button>
            )}

            {state.turnNumber >= 2 && (
              <button
                type="button"
                className={state.readyForCharacters ? "primary full" : "secondary full"}
                disabled={state.loading}
                onClick={() => void generateCharacters()}
              >
                {state.readyForCharacters ? "Meet your cast!" : "Generate cast now (keep answering for better results)"}
              </button>
            )}
          </section>
        )}

        {state.phase === "clarifying" && state.loading && (
          <section className="loading-state">
            <p>{state.loadingMessage || "Thinking..."}</p>
          </section>
        )}

        {state.phase === "generating" && (
          <section className="loading-state">
            <p>{state.loadingMessage || "Building your cast..."}</p>
          </section>
        )}

        {/* ─── Revealed / Locked Phase ─── */}
        {(state.phase === "revealed" || state.phase === "locked") && cast && (
          <section>
            <article className="hook-output-card">
              <h3>YOUR CAST</h3>

              {cast.ensemble_dynamic && (
                <>
                  <h4>ENSEMBLE DYNAMIC</h4>
                  <p>{cast.ensemble_dynamic}</p>
                </>
              )}

              {Object.entries(cast.characters).map(([role, profile]) => (
                <div key={role} className="character-card">
                  <h4>{role.replace(/_/g, " ").toUpperCase()}</h4>
                  <p>{profile.description}</p>
                  <div className="character-dials">
                    <span className="dial-chip">Want: {profile.core_dials.want}</span>
                    <span className="dial-chip">Misbelief: {profile.core_dials.misbelief}</span>
                    <span className="dial-chip">Stakes: {profile.core_dials.stakes}</span>
                  </div>
                  {((profile as any).threshold_statement || (profile as any).competence_axis || (profile as any).cost_type) && (
                    <div className="character-dials" style={{ marginTop: "0.4rem" }}>
                      {(profile as any).threshold_statement && (
                        <span className="dial-chip" style={{ fontStyle: "italic" }}>&ldquo;{(profile as any).threshold_statement}&rdquo;</span>
                      )}
                      {(profile as any).competence_axis && (
                        <span className="dial-chip">Good at: {(profile as any).competence_axis}</span>
                      )}
                      {(profile as any).cost_type && (
                        <span className="dial-chip">Breaks from: {(profile as any).cost_type}</span>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {cast.relationship_tensions?.length > 0 && (
                <>
                  <h4>RELATIONSHIP TENSIONS</h4>
                  {cast.relationship_tensions.map((rel, i) => (
                    <div key={i} className="relationship-card" style={{ marginBottom: "0.5rem", padding: "0.5rem 0", borderBottom: i < cast.relationship_tensions.length - 1 ? "1px solid #333" : "none" }}>
                      <p style={{ margin: "0 0 0.25rem 0" }}><strong>{rel.pair.join(" & ")}</strong> — <span style={{ opacity: 0.6 }}>{rel.stated_dynamic}</span></p>
                      <p style={{ margin: "0 0 0.15rem 0" }}>Actually: {rel.true_dynamic}</p>
                      <p style={{ margin: 0, opacity: 0.7, fontSize: "0.9em" }}>{rel.tension_mechanism}</p>
                    </div>
                  ))}
                </>
              )}

              <div className="details-toggle-row">
                <button type="button" className="link-btn" onClick={() => setSourcesExpanded((prev) => !prev)}>
                  {sourcesExpanded ? "\u25BE" : "\u25B8"} Collision sources ({sourcesExpanded ? "hide" : "show"})
                </button>
              </div>
              {sourcesExpanded && cast.collision_sources?.length > 0 && (
                <ul>
                  {cast.collision_sources.map((source, i) => (
                    <li key={i}>{source.source} &rarr; {source.element_extracted} (applied to: {source.applied_to})</li>
                  ))}
                </ul>
              )}
            </article>

            {state.phase === "revealed" && state.judgeInfo && !state.judgeInfo.passed && (
              <aside className="judge-warning">
                <p>Judge flagged issues with the cast:</p>
                <ul>
                  {state.judgeInfo.hard_fail_reasons.map((reason, i) => (
                    <li key={i}>{reason}</li>
                  ))}
                </ul>
                <p>Weakest: {state.judgeInfo.weakest_character}</p>
                <p>Suggestion: {state.judgeInfo.one_fix_instruction}</p>
              </aside>
            )}

            {state.phase === "revealed" && (
              <div className="actions-row">
                <button type="button" disabled={state.loading} onClick={() => void reroll()}>
                  {state.loading ? "Working..." : "Reroll cast"}
                </button>
                <button type="button" className="primary" disabled={state.loading} onClick={() => void lockCharacters()}>
                  Lock the cast
                </button>
              </div>
            )}

            {state.phase === "locked" && (
              <div className="actions-row">
                <p>Cast locked &mdash; ready for visual design module</p>
                <button type="button" disabled={state.loading} onClick={() => void startOver()}>Start over</button>
              </div>
            )}
          </section>
        )}
      </section>
    </main>
  );
}
