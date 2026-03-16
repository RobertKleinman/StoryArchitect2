import React, { useEffect, useMemo, useRef, useState } from "react";
import { characterApi } from "../lib/characterApi";
import { startBuildProgressPolling } from "../lib/buildProgressPoller";
import { emitModuleStatus } from "./App";
import { PsychologyOverlay } from "./PsychologyOverlay";
import { EngineInsights } from "./EngineInsights";
import { PackPreview } from "./PackPreview";
import { ModelSelector } from "./ModelSelector";
import { PromptEditor } from "./PromptEditor";
import type {
  CharacterAssumptionResponse,
  CharacterBuilderOutput,
  CharacterClarifierOption,
  CharacterAssumption,
  CharacterJudgeScores,
  CharacterPack,
  CharacterPromptOverrides,
  CharacterRelationshipUpdate,
  CharacterSurfaced,
} from "../../shared/types/character";

type Phase = "connect" | "start" | "seeding" | "clarifying" | "reviewing" | "generating" | "revealed" | "locked";

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
  reviewCharacters: Array<{
    roleKey: string;
    role: string;
    presentation: string;
    age_range: string;
    ethnicity: string;
    description_summary: string;
    confirmed_traits: Record<string, string>;
    inferred_traits: Record<string, string>;
  }>;
  reviewEdits: Record<string, Record<string, string>>;
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
  reviewCharacters: [],
  reviewEdits: {},
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

/**
 * Parse constraint overrides from a simple text format: "key: value" per line.
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
  const [showPsych, setShowPsych] = useState(false);
  const [showInsights, setShowInsights] = useState(false);
  const [lockedPack, setLockedPack] = useState<CharacterPack | null>(null);
  const fetchPsych = useMemo(() => () => characterApi.debugPsychology(projectId), [projectId]);
  const fetchInsights = useMemo(() => () => characterApi.debugInsights(projectId), [projectId]);

  // Available hook sessions for the connect phase
  interface HookSessionInfo {
    projectId: string;
    status: string;
    turnCount: number;
    seedInput: string;
    hookSentence: string;
    premise: string;
    emotionalPromise: string;
    hasExport: boolean;
  }
  const [availableHookSessions, setAvailableHookSessions] = useState<HookSessionInfo[]>([]);
  const [hookSessionsLoading, setHookSessionsLoading] = useState(true);
  const [hookSessionsError, setHookSessionsError] = useState<string | null>(null);
  const [showManualInput, setShowManualInput] = useState(false);

  const [state, setState] = useState<CharacterWorkshopState>(initialState);
  const [lastAction, setLastAction] = useState<null | (() => Promise<void>)>(null);
  const [sourcesExpanded, setSourcesExpanded] = useState(false);

  // Constraint override state for regeneration
  const [showConstraintOverrides, setShowConstraintOverrides] = useState(false);
  const [constraintOverridesText, setConstraintOverridesText] = useState("");

  // Prompt preview / override state
  const [promptPreview, setPromptPreview] = useState<{ stage: string; system: string; user: string } | null>(null);
  const [promptOverrides, setPromptOverrides] = useState<CharacterPromptOverrides | undefined>(undefined);
  const [builderPromptOverrides, setBuilderPromptOverrides] = useState<CharacterPromptOverrides | undefined>(undefined);

  // Load hook sessions on mount
  React.useEffect(() => {
    setHookSessionsLoading(true);
    setHookSessionsError(null);
    characterApi.listHookSessions()
      .then(({ sessions }) => {
        setAvailableHookSessions(sessions);
        // Auto-select if there's exactly one locked session and no input yet
        const locked = sessions.filter(s => s.status === "locked");
        if (locked.length === 1 && !hookIdInput) {
          setHookIdInput(locked[0].projectId);
        }
      })
      .catch((err) => {
        setHookSessionsError(err.message ?? "Failed to load hook sessions");
      })
      .finally(() => setHookSessionsLoading(false));
  }, []);

  // Crash recovery
  const [recoverySession, setRecoverySession] = useState<any>(null);
  const [recoveryChecked, setRecoveryChecked] = useState(false);
  const [exportBanner, setExportBanner] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Banner timeout ref — cleared on unmount to prevent leaks
  const bannerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (bannerTimeoutRef.current) clearTimeout(bannerTimeoutRef.current);
    };
  }, []);

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

  const loadPromptPreview = async (stage: "clarifier" | "builder" | "judge" | "summary") => {
    try {
      const preview = await characterApi.previewPrompt({ projectId, stage });
      setPromptPreview(preview);
      setPromptOverrides(undefined);
      setBuilderPromptOverrides(undefined);
    } catch { /* prompt preview is optional */ }
  };

  // ─── First Turn ───

  const startCharacterSession = async () => {
    await runAndTrack(async () => {
      setState((prev) => ({ ...prev, loading: true, loadingMessage: "Reading your hook and preparing cast questions...", error: null }));

      // Always start with a fresh projectId to avoid collisions with previous sessions
      const freshId = makeProjectId();
      setProjectId(freshId);
      saveTo(CHAR_SESSION_KEY, freshId);
      saveTo(CHAR_HOOK_ID_KEY, hookProjectId);

      const seed = state.characterSeedValue.trim() || undefined;
      const response = await characterApi.clarify({
        projectId: freshId,
        hookProjectId,
        characterSeed: seed,
        promptOverrides,
      });
      setPromptPreview(null);
      setPromptOverrides(undefined);

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
      emitModuleStatus("character", "active");
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
        promptOverrides,
      });
      setPromptPreview(null);
      setPromptOverrides(undefined);

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

  // ─── Review (pre-builder review/edit) ───

  const startReview = async () => {
    await runAndTrack(async () => {
      setState((prev) => ({ ...prev, loading: true, loadingMessage: "Loading character review..." }));
      try {
        const review = await characterApi.getReview(projectId);
        setState((prev) => ({
          ...prev,
          phase: "reviewing",
          reviewCharacters: review.characters,
          reviewEdits: {},
          loading: false,
          loadingMessage: "",
        }));
      } catch {
        // If review endpoint fails, fall through to generate directly
        await actuallyGenerate();
      }
    });
  };

  const submitReviewEdits = async () => {
    // Collect all edits into array format
    const edits: Array<{ roleKey: string; field: string; value: string }> = [];
    for (const [roleKey, fields] of Object.entries(state.reviewEdits)) {
      for (const [field, value] of Object.entries(fields)) {
        edits.push({ roleKey, field, value });
      }
    }
    if (edits.length > 0) {
      await characterApi.applyReviewEdits(projectId, edits);
    }
    await actuallyGenerate();
  };

  const updateReviewField = (roleKey: string, field: string, value: string) => {
    setState((prev) => ({
      ...prev,
      reviewEdits: {
        ...prev.reviewEdits,
        [roleKey]: { ...(prev.reviewEdits[roleKey] ?? {}), [field]: value },
      },
    }));
  };

  // ─── Generate ───

  const generateCharacters = async () => {
    await startReview();
  };

  const actuallyGenerate = async () => {
    await runAndTrack(async () => {
      setState((prev) => ({
        ...prev,
        phase: "generating",
        loading: true,
        loadingMessage: "Building your cast from the creative brief...",
        error: null,
      }));

      const stopPolling = startBuildProgressPolling(
        () => characterApi.getSession(projectId),
        "cast",
        (msg) => setState((prev) => ({ ...prev, loadingMessage: msg })),
      );

      try {
        const tournamentOverrides = builderPromptOverrides ? { builder: builderPromptOverrides } : undefined;
        const response = await characterApi.generate(projectId, tournamentOverrides);
        stopPolling();
        setPromptPreview(null);
        setBuilderPromptOverrides(undefined);

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
        loadingMessage: "Trying a fresh cast...",
        error: null,
      }));

      const stopPolling = startBuildProgressPolling(
        () => characterApi.getSession(projectId),
        "cast",
        (msg) => setState((prev) => ({ ...prev, loadingMessage: msg })),
      );

      try {
        const parsedOverrides = parseConstraintOverrides(constraintOverridesText);
        const tournamentOverrides = builderPromptOverrides ? { builder: builderPromptOverrides } : undefined;
        const response = await characterApi.reroll(projectId, tournamentOverrides, parsedOverrides);
        stopPolling();

        setState((prev) => ({
          ...prev,
          phase: "revealed",
          revealedCharacters: response.characters,
          judgeInfo: response.judge,
          loading: false,
          loadingMessage: "",
        }));
      } catch (err) {
        stopPolling();
        throw err;
      }
    });
  };

  const lockCharacters = async () => {
    await runAndTrack(async () => {
      setState((prev) => ({ ...prev, loading: true, loadingMessage: "Locking your cast...", error: null }));
      try {
        const pack = await characterApi.lock(projectId);
        setLockedPack(pack);
        setState((prev) => ({
          ...prev,
          phase: "locked",
          loading: false,
          loadingMessage: "",
        }));
        emitModuleStatus("character", "locked");
        setExportBanner({ type: "success", message: "Cast exported successfully!" });
        if (bannerTimeoutRef.current) clearTimeout(bannerTimeoutRef.current);
        bannerTimeoutRef.current = setTimeout(() => setExportBanner(null), 4000);
      } catch (err: any) {
        setState((prev) => ({ ...prev, loading: false, loadingMessage: "" }));
        setExportBanner({ type: "error", message: `Export failed: ${err?.message ?? "Unknown error"}` });
        if (bannerTimeoutRef.current) clearTimeout(bannerTimeoutRef.current);
        bannerTimeoutRef.current = setTimeout(() => setExportBanner(null), 6000);
        // Don't re-throw — runAndTrack would display a duplicate error
      }
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
      emitModuleStatus("character", "idle");
    });
  };

  const cast = state.revealedCharacters;

  // ─── Recovery Screen ───

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
      {exportBanner && (
        <div className={`export-banner export-banner-${exportBanner.type}`}>
          {exportBanner.message}
        </div>
      )}
      <section className="workshop-card">
        <ModelSelector />

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

        {/* ─── Connect Phase: select hook session ─── */}
        {state.phase === "connect" && (
          <section className="connect-phase">
            <p className="lead">Connect to your hook</p>
            <p>Select a locked hook session to import your premise and start building characters.</p>

            {hookSessionsLoading && <p className="loading-text">Loading available hook sessions...</p>}

            {hookSessionsError && (
              <div className="error-banner">
                <p>Could not load sessions: {hookSessionsError}</p>
                <button type="button" onClick={() => setShowManualInput(true)}>Enter ID manually</button>
              </div>
            )}

            {!hookSessionsLoading && !hookSessionsError && availableHookSessions.length > 0 && (
              <div className="session-list">
                {availableHookSessions.map(s => {
                  const isUsable = s.status === "locked";
                  const isSelected = hookIdInput === s.projectId;
                  return (
                    <div
                      key={s.projectId}
                      className={`session-card ${isSelected ? "session-card-selected" : ""} ${!isUsable ? "session-card-disabled" : ""}`}
                      onClick={() => { if (isUsable) setHookIdInput(s.projectId); }}
                    >
                      <div className="session-card-header">
                        <span className={`session-status ${isUsable ? "status-locked" : "status-" + s.status}`}>
                          {isUsable ? "✓ Locked" : s.status}
                        </span>
                        <span className="session-cast-count">{s.turnCount} turns</span>
                      </div>
                      {s.seedInput && (
                        <p className="session-card-seed">Seed: &ldquo;{s.seedInput.slice(0, 100)}{s.seedInput.length > 100 ? "..." : ""}&rdquo;</p>
                      )}
                      {s.hookSentence && (
                        <p className="session-card-hook">{s.hookSentence.slice(0, 150)}{s.hookSentence.length > 150 ? "..." : ""}</p>
                      )}
                      {s.emotionalPromise && (
                        <p className="session-card-dynamic">{s.emotionalPromise.slice(0, 120)}{s.emotionalPromise.length > 120 ? "..." : ""}</p>
                      )}
                      <div className="session-card-meta">
                        {!isUsable && <span className="warn-text">Not locked yet — complete the Hook module first</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {!hookSessionsLoading && !hookSessionsError && availableHookSessions.length === 0 && (
              <p className="empty-text">No hook sessions found. Complete the Hook module first.</p>
            )}

            {/* Manual ID input fallback */}
            {(showManualInput || (!hookSessionsLoading && availableHookSessions.length === 0)) && (
              <div className="manual-input-section">
                <p style={{ fontSize: "0.85rem", color: "#6b7280", marginBottom: "0.4rem" }}>Or enter a hook project ID manually:</p>
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
                </div>
              </div>
            )}

            {!showManualInput && availableHookSessions.length > 0 && (
              <button type="button" className="link-btn" style={{ fontSize: "0.82rem", marginTop: "0.4rem" }}
                onClick={() => setShowManualInput(true)}>
                Enter ID manually instead
              </button>
            )}

            <div className="action-row" style={{ marginTop: "1rem" }}>
              <button
                type="button"
                className="primary"
                onClick={() => void validateHookId()}
                disabled={state.loading || !hookIdInput.trim()}
              >
                {state.loading ? "Checking..." : "Connect to Selected Hook"}
              </button>
            </div>
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
            <div className="loading-spinner" />
            <p>{state.loadingMessage || "Reading your hook and preparing cast questions..."}</p>
          </section>
        )}

        {/* ─── Clarifying Phase ─── */}
        {state.phase === "clarifying" && !state.loading && (
          <section>
            {state.readinessPct > 0 && (
              <div className="readiness-progress">
                <div className="readiness-bar">
                  <div className={`readiness-fill ${state.readinessPct < 30 ? "readiness-low" : state.readinessPct < 60 ? "readiness-mid" : state.readinessPct < 85 ? "readiness-high" : "readiness-ready"}`} style={{ width: `${Math.min(state.readinessPct, 100)}%` }} />
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
                                  if (prevAlts.includes(alt)) { newAlts = prevAlts.filter((v) => v !== alt); }
                                  else { newAlts = [...prevAlts, alt]; }
                                  return {
                                    ...prev,
                                    assumptionResponses: {
                                      ...prev.assumptionResponses,
                                      [a.id]: newAlts.length > 0
                                        ? { action: "alternative" as const, value: newAlts.join(" + ") }
                                        : { action: "keep" as const, value: a.assumption },
                                    },
                                  };
                                })
                              }
                            >{alt}</button>
                          );
                        })}
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

            {/* Prompt preview for clarifier */}
            {promptPreview?.stage === "clarifier" && (
              <PromptEditor stage="clarifier" systemPrompt={promptPreview.system} userPrompt={promptPreview.user} loading={state.loading} onOverridesChange={setPromptOverrides} />
            )}
            {!promptPreview && (
              <button type="button" className="prompt-toggle" onClick={() => void loadPromptPreview("clarifier")}>View clarifier prompt</button>
            )}

            {state.turnNumber >= 2 && (
              <>
                {promptPreview?.stage === "builder" && (
                  <PromptEditor stage="builder" systemPrompt={promptPreview.system} userPrompt={promptPreview.user} loading={state.loading} onOverridesChange={setBuilderPromptOverrides} />
                )}
                {promptPreview?.stage !== "builder" && (
                  <button type="button" className="prompt-toggle" onClick={() => void loadPromptPreview("builder")}>View builder prompt</button>
                )}
              </>
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
            <div className="loading-spinner" />
            <p>{state.loadingMessage || "Thinking..."}</p>
          </section>
        )}

        {/* ─── Review Phase ─── */}
        {state.phase === "reviewing" && !state.loading && (
          <section>
            <article className="hook-output-card">
              <h3>Meet Your Cast — Any Last Tweaks?</h3>
              <p style={{ color: "#888", marginBottom: "1rem" }}>
                Here's who I think your characters are. You can adjust presentation, age, ethnicity, or anything else before I build them out.
              </p>

              {state.reviewCharacters.map((char) => {
                const edits = state.reviewEdits[char.roleKey] ?? {};
                return (
                  <div key={char.roleKey} style={{ border: "1px solid #333", borderRadius: "8px", padding: "1rem", marginBottom: "1rem" }}>
                    <h4 style={{ textTransform: "capitalize", marginBottom: "0.5rem" }}>{char.roleKey.replace(/_/g, " ")}</h4>
                    {char.description_summary && <p style={{ color: "#aaa", fontSize: "0.9rem", marginBottom: "0.75rem" }}>{char.description_summary}</p>}

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.5rem" }}>
                      <label style={{ fontSize: "0.85rem" }}>
                        Presentation
                        <select
                          value={edits.presentation ?? char.presentation}
                          onChange={(e) => updateReviewField(char.roleKey, "presentation", e.target.value)}
                          style={{ width: "100%", padding: "4px", marginTop: "2px" }}
                        >
                          <option value="masculine">Masculine</option>
                          <option value="feminine">Feminine</option>
                          <option value="androgynous">Androgynous</option>
                          <option value="unspecified">Not specified</option>
                        </select>
                      </label>

                      <label style={{ fontSize: "0.85rem" }}>
                        Age Range
                        <select
                          value={edits.age_range ?? (char.age_range || "")}
                          onChange={(e) => updateReviewField(char.roleKey, "age_range", e.target.value)}
                          style={{ width: "100%", padding: "4px", marginTop: "2px" }}
                        >
                          <option value="">Unspecified</option>
                          <option value="child">Child</option>
                          <option value="teen">Teen</option>
                          <option value="young_adult">Young Adult</option>
                          <option value="adult">Adult</option>
                          <option value="middle_aged">Middle Aged</option>
                          <option value="elderly">Elderly</option>
                        </select>
                      </label>

                      <label style={{ fontSize: "0.85rem" }}>
                        Ethnicity
                        <input
                          type="text"
                          placeholder="e.g. Japanese, Nigerian..."
                          value={edits.ethnicity ?? char.ethnicity}
                          onChange={(e) => updateReviewField(char.roleKey, "ethnicity", e.target.value)}
                          style={{ width: "100%", padding: "4px", marginTop: "2px" }}
                        />
                      </label>
                    </div>

                    {Object.keys(char.confirmed_traits).length > 0 && (
                      <details style={{ marginTop: "0.5rem", fontSize: "0.8rem", color: "#888" }}>
                        <summary>Confirmed traits ({Object.keys(char.confirmed_traits).length})</summary>
                        <ul style={{ margin: "0.25rem 0", paddingLeft: "1.5rem" }}>
                          {Object.entries(char.confirmed_traits).map(([k, v]) => (
                            <li key={k}>{k}: {v}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                );
              })}

              <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
                <button
                  type="button"
                  className="primary full"
                  onClick={() => void submitReviewEdits()}
                >
                  Looks great, build!
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setState((prev) => ({ ...prev, phase: "clarifying" }))}
                >
                  Back to clarifier
                </button>
              </div>
            </article>
          </section>
        )}

        {state.phase === "generating" && (
          <section className="loading-state">
            <div className="loading-spinner" />
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
                  <div className="dials-section">
                    <div className="dials-group">
                      <span className="dials-group-label">Core</span>
                      <div className="dials-row">
                        <span className="dial-chip"><strong>Want:</strong> {profile.core_dials.want}</span>
                        {profile.core_dials.want_urgency && <span className="dial-chip"><strong>Urgency:</strong> {profile.core_dials.want_urgency}</span>}
                        <span className="dial-chip"><strong>Misbelief:</strong> {profile.core_dials.misbelief}</span>
                        <span className="dial-chip"><strong>Stakes:</strong> {profile.core_dials.stakes}</span>
                        {profile.core_dials.break_point && <span className="dial-chip"><strong>Break point:</strong> {profile.core_dials.break_point}</span>}
                      </div>
                    </div>
                    {profile.secondary_dials && (
                      <div className="dials-group">
                        <span className="dials-group-label">Secondary</span>
                        <div className="dials-row">
                          {Object.entries(profile.secondary_dials).map(([key, val]) => (
                            val ? <span key={key} className="dial-chip"><strong>{key.replace(/_/g, " ")}:</strong> {val as string}</span> : null
                          ))}
                        </div>
                      </div>
                    )}
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
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={state.loading}
                  onClick={() => setShowConstraintOverrides((v) => !v)}
                >
                  {showConstraintOverrides ? "Hide" : "Show"} Constraints
                </button>
                <button type="button" className="primary" disabled={state.loading} onClick={() => void lockCharacters()}>
                  Lock the cast
                </button>
              </div>
            )}

            {state.phase === "revealed" && showConstraintOverrides && (
              <div className="constraint-overrides">
                <label htmlFor="char-constraint-overrides">
                  <strong>Constraint Overrides</strong>
                  <span className="hint"> (one per line: key: value)</span>
                </label>
                <textarea
                  id="char-constraint-overrides"
                  rows={4}
                  placeholder={"protagonist.want: revenge\nantagonist.moral_logic: ends justify means\nrelationship.protagonist_antagonist: former allies"}
                  value={constraintOverridesText}
                  onChange={(e) => setConstraintOverridesText(e.target.value)}
                />
                <p className="hint">
                  Override or add constraint ledger entries before rerolling. Use scoped keys like: protagonist.want, antagonist.moral_logic, relationship.protagonist_antagonist.
                </p>
              </div>
            )}

            {state.phase === "locked" && (
              <>
                {lockedPack && <PackPreview pack={lockedPack} defaultExpanded />}
                <div className="actions-row">
                  <p>Cast locked -- ready for visual design module</p>
                  <button type="button" disabled={state.loading} onClick={() => void startOver()}>Start over</button>
                </div>
              </>
            )}
          </section>
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
        module="character"
        projectId={projectId}
        fetchInsights={fetchInsights}
        visible={showInsights}
        onClose={() => setShowInsights(false)}
      />
    </main>
  );
}
