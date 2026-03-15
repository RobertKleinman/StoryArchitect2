import React, { useMemo, useState } from "react";
import { worldApi } from "../lib/worldApi";
import { startBuildProgressPolling } from "../lib/buildProgressPoller";
import { emitModuleStatus } from "./App";
import { PsychologyOverlay } from "./PsychologyOverlay";
import { EngineInsights } from "./EngineInsights";
import { PackPreview } from "./PackPreview";
import { ModelSelector } from "./ModelSelector";
import type {
  WorldAssumptionResponse,
  WorldBuilderOutput,
  WorldClarifierOption,
  WorldAssumption,
  WorldJudgeScores,
  WorldPack,
  DevelopmentTarget,
} from "../../shared/types/world";

type Phase =
  | "connect"
  | "seeding"
  | "clarifying"
  | "generating"
  | "revealed"
  | "locked";

interface WorkshopState {
  phase: Phase;
  hypothesisLine: string;
  question: string;
  options: WorldClarifierOption[];
  allowFreeText: boolean;
  freeTextValue: string;
  worldFocus: string | null;
  turnNumber: number;
  readyForWorld: boolean;
  readinessPct: number;
  readinessNote: string;
  conflictFlag: string;
  revealedWorld: WorldBuilderOutput | null;
  judgeInfo: {
    passed: boolean;
    hard_fail_reasons: string[];
    scores: WorldJudgeScores;
    weakest_element: string;
    one_fix_instruction: string;
  } | null;
  loading: boolean;
  loadingMessage: string;
  error: string | null;
  assumptions: WorldAssumption[];
  assumptionResponses: Record<string, { action: "keep" | "alternative" | "freeform" | "not_ready"; value: string }>;
  selectedOptionId: string | null;
  selectedOptionLabel: string | null;
  worldSeedValue: string;
  developmentTargets: DevelopmentTarget[];
  weaknesses: Array<{ area: string; weakness: string; development_opportunity: string }>;
}

const initialState: WorkshopState = {
  phase: "connect",
  hypothesisLine: "",
  question: "",
  options: [],
  allowFreeText: true,
  freeTextValue: "",
  worldFocus: null,
  turnNumber: 0,
  readyForWorld: false,
  readinessPct: 0,
  readinessNote: "",
  conflictFlag: "",
  revealedWorld: null,
  judgeInfo: null,
  loading: false,
  loadingMessage: "",
  error: null,
  assumptions: [],
  assumptionResponses: {},
  selectedOptionId: null,
  selectedOptionLabel: null,
  worldSeedValue: "",
  developmentTargets: [],
  weaknesses: [],
};

const WORLD_SESSION_KEY = "worldWorkshop_projectId";
const WORLD_CHAR_IMAGE_ID_KEY = "worldWorkshop_charImageProjectId";
const WORLD_CHAR_ID_KEY = "worldWorkshop_characterProjectId";
const WORLD_HOOK_ID_KEY = "worldWorkshop_hookProjectId";

// Keys from upstream modules' localStorage
const IMG_SESSION_KEY = "charImageWorkshop_projectId";
const CHAR_SESSION_KEY = "characterWorkshop_projectId";
const HOOK_SESSION_KEY = "hookWorkshop_projectId";

interface CharImageSessionInfo {
  projectId: string;
  characterProjectId: string;
  status: string;
  turnCount: number;
  hasExport: boolean;
  artStyle: string;
  characterCount: number;
  characterNames: string[];
  hookPremise: string;
}

interface CharSessionInfo {
  projectId: string;
  status: string;
  turnCount: number;
  castCount: number;
  characterRoles: string[];
  hasExport: boolean;
  ensembleDynamic: string;
}

function makeProjectId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `world-${crypto.randomUUID()}`;
  }
  return `world-${Date.now()}`;
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

export function WorldWorkshop() {
  const [projectId, setProjectId] = useState(() => {
    return loadSaved(WORLD_SESSION_KEY) ?? makeProjectId();
  });

  // Upstream IDs
  const [charImageProjectId, setCharImageProjectId] = useState(() => {
    return loadSaved(WORLD_CHAR_IMAGE_ID_KEY) ?? loadSaved(IMG_SESSION_KEY) ?? "";
  });
  const [characterProjectId, setCharacterProjectId] = useState(() => {
    return loadSaved(WORLD_CHAR_ID_KEY) ?? loadSaved(CHAR_SESSION_KEY) ?? "";
  });
  const [hookProjectId, setHookProjectId] = useState(() => {
    return loadSaved(WORLD_HOOK_ID_KEY) ?? loadSaved(HOOK_SESSION_KEY) ?? "";
  });

  // Selected charImage session ID for the connect phase card picker
  const [selectedCharImageId, setSelectedCharImageId] = useState(() => {
    return loadSaved(WORLD_CHAR_IMAGE_ID_KEY) ?? loadSaved(IMG_SESSION_KEY) ?? "";
  });

  // Available character-image sessions for the connect phase
  const [availableSessions, setAvailableSessions] = useState<CharImageSessionInfo[]>([]);
  const [availableCharSessions, setAvailableCharSessions] = useState<CharSessionInfo[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [showManualInput, setShowManualInput] = useState(false);
  // Resolved upstream IDs from auto-detection
  const [resolvedCharId, setResolvedCharId] = useState<string | null>(null);
  const [resolvedHookId, setResolvedHookId] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  // Character-only mode
  const [selectedCharId, setSelectedCharId] = useState<string>("");
  const [connectMode, setConnectMode] = useState<"auto" | "charImage" | "character" | "manual">("auto");

  const [upstreamValidated, setUpstreamValidated] = useState(false);

  const [state, setState] = useState<WorkshopState>(initialState);
  const [showPsych, setShowPsych] = useState(false);
  const [showInsights, setShowInsights] = useState(false);
  const fetchPsych = useMemo(() => () => worldApi.debugPsychology(projectId), [projectId]);
  const fetchInsights = useMemo(() => () => worldApi.debugInsights(projectId), [projectId]);

  // Constraint override state for regeneration
  const [showConstraintOverrides, setShowConstraintOverrides] = useState(false);
  const [constraintOverridesText, setConstraintOverridesText] = useState("");

  // ─── Load available charImage and character sessions on mount ───
  React.useEffect(() => {
    setSessionsLoading(true);
    setSessionsError(null);
    Promise.all([
      worldApi.listCharacterImageSessions(),
      worldApi.listCharacterSessions(),
    ])
      .then(([charImageResult, charResult]) => {
        setAvailableSessions(charImageResult.sessions);
        setAvailableCharSessions(charResult.sessions);

        // Determine mode: prefer charImage if available, otherwise character
        const lockedCharImages = charImageResult.sessions.filter(s => s.hasExport);
        const lockedCharSessions = charResult.sessions.filter(s => s.hasExport);

        if (lockedCharImages.length > 0) {
          // Path A: CharImage sessions available
          setConnectMode("charImage");
          if (lockedCharImages.length === 1 && !selectedCharImageId) {
            setSelectedCharImageId(lockedCharImages[0].projectId);
          }
        } else if (lockedCharSessions.length > 0) {
          // Path B: Only character sessions available
          setConnectMode("character");
          if (lockedCharSessions.length === 1 && !selectedCharId) {
            setSelectedCharId(lockedCharSessions[0].projectId);
          }
        } else {
          // Path C: No locked sessions, manual input required
          setConnectMode("manual");
        }
      })
      .catch((err) => {
        setSessionsError(err.message ?? "Failed to load sessions");
        setConnectMode("manual");
      })
      .finally(() => setSessionsLoading(false));
  }, []);

  // ─── Auto-resolve character + hook IDs when a charImage session is selected ───
  React.useEffect(() => {
    if (!selectedCharImageId) {
      setResolvedCharId(null);
      setResolvedHookId(null);
      return;
    }
    // Try to find the session in availableSessions to get characterProjectId
    const session = availableSessions.find(s => s.projectId === selectedCharImageId);
    if (session?.characterProjectId) {
      setResolvedCharId(session.characterProjectId);
      // Now resolve hookProjectId from the character session
      setResolving(true);
      worldApi.getCharacterSession(session.characterProjectId)
        .then((charSession) => {
          if (charSession?.hookProjectId) {
            setResolvedHookId(charSession.hookProjectId);
          } else {
            // Fallback: try localStorage
            setResolvedHookId(loadSaved(HOOK_SESSION_KEY));
          }
        })
        .catch(() => {
          setResolvedHookId(loadSaved(HOOK_SESSION_KEY));
        })
        .finally(() => setResolving(false));
    } else {
      setResolvedCharId(null);
      setResolvedHookId(null);
    }
  }, [selectedCharImageId, availableSessions]);

  // ─── Resolve hook ID when a Character session is directly selected ───
  React.useEffect(() => {
    if (connectMode !== "character" || !selectedCharId) return;
    setResolving(true);
    worldApi.getCharacterSession(selectedCharId)
      .then((charSession) => {
        setResolvedCharId(selectedCharId);
        if (charSession?.hookProjectId) {
          setResolvedHookId(charSession.hookProjectId);
        } else {
          setResolvedHookId(loadSaved(HOOK_SESSION_KEY));
        }
      })
      .catch(() => {
        setResolvedHookId(loadSaved(HOOK_SESSION_KEY));
      })
      .finally(() => setResolving(false));
  }, [selectedCharId, connectMode]);

  // ─── Recovery check ───
  const [recoveryChecked, setRecoveryChecked] = useState(false);

  React.useEffect(() => {
    const savedId = loadSaved(WORLD_SESSION_KEY);
    if (savedId) {
      worldApi.getSession(savedId).then((session) => {
        if (session && session.status !== "locked") {
          setProjectId(session.projectId);
          setCharacterProjectId(session.characterProjectId);
          setHookProjectId(session.hookProjectId);
          setUpstreamValidated(true);

          if (session.characterImageProjectId) {
            setCharImageProjectId(session.characterImageProjectId);
            setSelectedCharImageId(session.characterImageProjectId);
            saveTo(WORLD_CHAR_IMAGE_ID_KEY, session.characterImageProjectId);
          }
          saveTo(WORLD_CHAR_ID_KEY, session.characterProjectId);
          saveTo(WORLD_HOOK_ID_KEY, session.hookProjectId);

          const lastTurn = session.turns?.length > 0 ? session.turns[session.turns.length - 1] : null;

          if (session.status === "revealed" && session.revealedWorld) {
            setState(prev => ({
              ...prev,
              phase: "revealed",
              revealedWorld: session.revealedWorld ?? null,
              judgeInfo: session.revealedJudge ? {
                passed: session.revealedJudge.pass,
                hard_fail_reasons: session.revealedJudge.hard_fail_reasons,
                scores: session.revealedJudge.scores,
                weakest_element: session.revealedJudge.weakest_element,
                one_fix_instruction: session.revealedJudge.one_fix_instruction,
              } : null,
              turnNumber: session.turns?.length ?? 0,
            }));
          } else if (session.status === "clarifying" && lastTurn) {
            setState(prev => ({
              ...prev,
              phase: "clarifying",
              hypothesisLine: lastTurn.clarifierResponse.hypothesis_line,
              question: lastTurn.clarifierResponse.question,
              options: lastTurn.clarifierResponse.options,
              allowFreeText: lastTurn.clarifierResponse.allow_free_text,
              worldFocus: lastTurn.clarifierResponse.world_focus,
              turnNumber: session.turns.length,
              readyForWorld: lastTurn.clarifierResponse.ready_for_world,
              readinessPct: lastTurn.clarifierResponse.readiness_pct ?? 0,
              readinessNote: lastTurn.clarifierResponse.readiness_note ?? "",
              conflictFlag: lastTurn.clarifierResponse.conflict_flag ?? "",
              assumptions: lastTurn.clarifierResponse.assumptions ?? [],
              assumptionResponses: {},
            }));
          }
        }
        setRecoveryChecked(true);
      }).catch(() => setRecoveryChecked(true));
    } else {
      setRecoveryChecked(true);
    }
  }, []);

  // ─── Actions ───

  const validateUpstream = async () => {
    // Determine IDs based on connect mode
    let finalCharImageId = "";
    let finalCharId = "";
    let finalHookId = "";

    if (connectMode === "charImage") {
      finalCharImageId = selectedCharImageId;
      finalCharId = resolvedCharId ?? "";
      finalHookId = resolvedHookId ?? "";

      if (!finalCharImageId) {
        setState(s => ({ ...s, error: "Please select a Character Image session." }));
        return;
      }
    } else if (connectMode === "character") {
      finalCharId = selectedCharId || (resolvedCharId ?? "");
      finalHookId = resolvedHookId ?? "";

      if (!finalCharId) {
        setState(s => ({ ...s, error: "Please select a Character session." }));
        return;
      }
    } else if (connectMode === "manual") {
      finalCharImageId = selectedCharImageId;
      finalCharId = resolvedCharId ?? "";
      finalHookId = resolvedHookId ?? "";

      if (!finalCharId || !finalHookId) {
        setState(s => ({ ...s, error: "Please enter Character and Hook session IDs." }));
        return;
      }
    }

    setState(s => ({ ...s, loading: true, loadingMessage: "Checking upstream modules...", error: null }));
    try {
      // Only validate charImage session if we're using it
      if (finalCharImageId) {
        await worldApi.checkCharacterImageSession(finalCharImageId);
      }

      // If we don't have resolved char/hook IDs yet, try to resolve them now
      let charId = finalCharId;
      let hookId = finalHookId;

      if (!charId && finalCharImageId) {
        // Try to get characterProjectId from charImage session
        const session = availableSessions.find(s => s.projectId === finalCharImageId);
        if (session?.characterProjectId) {
          charId = session.characterProjectId;
        }
      }

      if (charId && !hookId) {
        // Try to resolve hookProjectId from character session
        try {
          const charSession = await worldApi.getCharacterSession(charId);
          if (charSession?.hookProjectId) {
            hookId = charSession.hookProjectId;
          }
        } catch { /* fallback to empty */ }
      }

      if (!charId || !hookId) {
        setState(s => ({
          ...s,
          loading: false,
          error: "Could not auto-resolve all upstream IDs. Try using manual input to specify Character and Hook session IDs.",
        }));
        setShowManualInput(true);
        return;
      }

      if (finalCharImageId) {
        setCharImageProjectId(finalCharImageId);
      }
      setCharacterProjectId(charId);
      setHookProjectId(hookId);
      if (finalCharImageId) {
        saveTo(WORLD_CHAR_IMAGE_ID_KEY, finalCharImageId);
      }
      saveTo(WORLD_CHAR_ID_KEY, charId);
      saveTo(WORLD_HOOK_ID_KEY, hookId);
      setUpstreamValidated(true);
      setState(s => ({ ...s, phase: "seeding", loading: false }));
    } catch (err: any) {
      setState(s => ({ ...s, loading: false, error: `Upstream validation failed: ${err.message}. Complete and lock the Character module first.` }));
    }
  };

  const startClarification = async () => {
    setState(s => ({ ...s, loading: true, loadingMessage: "Starting world discovery...", error: null }));
    try {
      const newId = makeProjectId();
      setProjectId(newId);
      saveTo(WORLD_SESSION_KEY, newId);

      const result = await worldApi.clarify({
        projectId: newId,
        ...(charImageProjectId && { characterImageProjectId: charImageProjectId }),
        characterProjectId,
        hookProjectId,
        worldSeed: state.worldSeedValue || undefined,
      });

      setState(s => ({
        ...s,
        phase: "clarifying",
        hypothesisLine: result.clarifier.hypothesis_line,
        question: result.clarifier.question,
        options: result.clarifier.options,
        allowFreeText: result.clarifier.allow_free_text,
        worldFocus: result.clarifier.world_focus,
        turnNumber: result.turnNumber,
        readyForWorld: result.clarifier.ready_for_world,
        readinessPct: result.clarifier.readiness_pct ?? 0,
        readinessNote: result.clarifier.readiness_note ?? "",
        conflictFlag: result.clarifier.conflict_flag ?? "",
        assumptions: result.clarifier.assumptions ?? [],
        assumptionResponses: {},
        loading: false,
        selectedOptionId: null,
        selectedOptionLabel: null,
        freeTextValue: "",
      }));
      emitModuleStatus("world", "active");
    } catch (err: any) {
      setState(s => ({ ...s, loading: false, error: err.message }));
    }
  };

  const submitTurn = async () => {
    if (!state.selectedOptionId && !state.freeTextValue.trim()) return;

    const userSelection = state.freeTextValue.trim()
      ? { type: "free_text" as const, label: state.freeTextValue.trim() }
      : { type: "option" as const, optionId: state.selectedOptionId!, label: state.selectedOptionLabel! };

    const assumptionResponses: WorldAssumptionResponse[] = [];
    for (const [id, resp] of Object.entries(state.assumptionResponses)) {
      const assumption = state.assumptions.find(a => a.id === id);
      if (!assumption) continue;
      assumptionResponses.push({
        assumptionId: id,
        category: assumption.category,
        action: resp.action,
        originalValue: assumption.assumption,
        newValue: resp.value,
      });
    }

    setState(s => ({ ...s, loading: true, loadingMessage: "Shaping the world...", error: null }));
    try {
      const result = await worldApi.clarify({
        projectId,
        ...(charImageProjectId && { characterImageProjectId: charImageProjectId }),
        characterProjectId,
        hookProjectId,
        userSelection,
        assumptionResponses: assumptionResponses.length > 0 ? assumptionResponses : undefined,
      });

      setState(s => ({
        ...s,
        phase: "clarifying",
        hypothesisLine: result.clarifier.hypothesis_line,
        question: result.clarifier.question,
        options: result.clarifier.options,
        allowFreeText: result.clarifier.allow_free_text,
        worldFocus: result.clarifier.world_focus,
        turnNumber: result.turnNumber,
        readyForWorld: result.clarifier.ready_for_world,
        readinessPct: result.clarifier.readiness_pct ?? 0,
        readinessNote: result.clarifier.readiness_note ?? "",
        conflictFlag: result.clarifier.conflict_flag ?? "",
        assumptions: result.clarifier.assumptions ?? [],
        assumptionResponses: {},
        loading: false,
        selectedOptionId: null,
        selectedOptionLabel: null,
        freeTextValue: "",
      }));
    } catch (err: any) {
      setState(s => ({ ...s, loading: false, error: err.message }));
    }
  };

  const generateWorld = async () => {
    setState(s => ({ ...s, phase: "generating", loading: true, loadingMessage: "Building your world...", error: null }));
    const stopPolling = startBuildProgressPolling(
      () => worldApi.getSession(projectId),
      "world",
      (msg) => setState(s => ({ ...s, loadingMessage: msg })),
    );
    try {
      const result = await worldApi.generate(projectId);
      stopPolling();
      setState(s => ({
        ...s,
        phase: "revealed",
        revealedWorld: result.world,
        judgeInfo: result.judge,
        developmentTargets: result.developmentTargets ?? [],
        weaknesses: result.weaknesses ?? [],
        loading: false,
      }));
    } catch (err: any) {
      stopPolling();
      setState(s => ({ ...s, phase: "clarifying", loading: false, error: err.message }));
    }
  };

  const rerollWorld = async () => {
    setState(s => ({ ...s, loading: true, loadingMessage: "Regenerating world...", error: null }));
    const stopPolling = startBuildProgressPolling(
      () => worldApi.getSession(projectId),
      "world",
      (msg) => setState(s => ({ ...s, loadingMessage: msg })),
    );
    try {
      const parsedOverrides = parseConstraintOverrides(constraintOverridesText);
      const result = await worldApi.reroll(projectId, undefined, parsedOverrides);
      stopPolling();
      setState(s => ({
        ...s,
        revealedWorld: result.world,
        judgeInfo: result.judge,
        developmentTargets: result.developmentTargets ?? [],
        weaknesses: result.weaknesses ?? [],
        loading: false,
      }));
    } catch (err: any) {
      stopPolling();
      setState(s => ({ ...s, loading: false, error: err.message }));
    }
  };

  const lockWorld = async () => {
    setState(s => ({ ...s, loading: true, loadingMessage: "Locking world...", error: null }));
    try {
      await worldApi.lock(projectId);
      setState(s => ({ ...s, phase: "locked", loading: false }));
      emitModuleStatus("world", "locked");
    } catch (err: any) {
      setState(s => ({ ...s, loading: false, error: err.message }));
    }
  };

  const resetAll = async () => {
    try { await worldApi.reset(projectId); } catch {}
    clearSaved(WORLD_SESSION_KEY);
    clearSaved(WORLD_CHAR_IMAGE_ID_KEY);
    clearSaved(WORLD_CHAR_ID_KEY);
    clearSaved(WORLD_HOOK_ID_KEY);
    const newId = makeProjectId();
    setProjectId(newId);
    setCharImageProjectId("");
    setCharacterProjectId("");
    setHookProjectId("");
    setSelectedCharImageId(loadSaved(IMG_SESSION_KEY) ?? "");
    setSelectedCharId("");
    setResolvedCharId(null);
    setResolvedHookId(null);
    setShowManualInput(false);
    setConnectMode("auto");
    setUpstreamValidated(false);
    setState(initialState);
    emitModuleStatus("world", "idle");
    // Re-fetch sessions
    setSessionsLoading(true);
    Promise.all([
      worldApi.listCharacterImageSessions(),
      worldApi.listCharacterSessions(),
    ])
      .then(([charImageResult, charResult]) => {
        setAvailableSessions(charImageResult.sessions);
        setAvailableCharSessions(charResult.sessions);

        const lockedCharImages = charImageResult.sessions.filter(s => s.hasExport);
        const lockedCharSessions = charResult.sessions.filter(s => s.hasExport);

        if (lockedCharImages.length > 0) {
          setConnectMode("charImage");
          if (lockedCharImages.length === 1) setSelectedCharImageId(lockedCharImages[0].projectId);
        } else if (lockedCharSessions.length > 0) {
          setConnectMode("character");
          if (lockedCharSessions.length === 1) setSelectedCharId(lockedCharSessions[0].projectId);
        } else {
          setConnectMode("manual");
        }
      })
      .catch(() => {})
      .finally(() => setSessionsLoading(false));
  };

  // ─── Render helpers ───

  const selectOption = (opt: WorldClarifierOption) => {
    setState(s => ({
      ...s,
      selectedOptionId: opt.id,
      selectedOptionLabel: opt.label,
      freeTextValue: "",
    }));
  };

  const setAssumptionAction = (id: string, action: "keep" | "alternative" | "freeform" | "not_ready", value: string) => {
    setState(s => ({
      ...s,
      assumptionResponses: { ...s.assumptionResponses, [id]: { action, value } },
    }));
  };

  // ─── Render ───

  if (!recoveryChecked) {
    return (
      <div className="workshop">
        <div className="skeleton-card" />
        <div className="skeleton-card" />
        <div className="skeleton-card" />
      </div>
    );
  }

  return (
    <div className="workshop world-workshop">
      <ModelSelector />

      <div className="workshop-header">
        <h2>World</h2>
        {state.phase !== "connect" && state.phase !== "locked" && (
          <button type="button" className="btn-ghost btn-sm" onClick={resetAll}>Start Over</button>
        )}
      </div>

      {state.error && (
        <div className="error-banner">
          <p>{state.error}</p>
          <button type="button" onClick={() => setState(s => ({ ...s, error: null }))}>Dismiss</button>
        </div>
      )}

      {state.loading && (
        <div className="loading-overlay">
          <div className="loading-spinner" />
          <p>{state.loadingMessage}</p>
        </div>
      )}

      {/* ─── Phase: Connect to upstream modules ─── */}
      {state.phase === "connect" && (
        <div className="connect-phase">
          {connectMode === "charImage" && (
            <p>Select a locked Character Image session. The Character and Hook sessions will be resolved automatically.</p>
          )}
          {connectMode === "character" && (
            <p>Select a locked Character session. The Hook session will be resolved automatically.</p>
          )}
          {connectMode === "manual" && (
            <p>No locked sessions found. Enter session IDs manually.</p>
          )}

          {sessionsLoading && <p className="loading-text">Loading available sessions...</p>}

          {sessionsError && (
            <div className="error-banner">
              <p>Could not load sessions: {sessionsError}</p>
              <button type="button" onClick={() => setShowManualInput(true)}>Enter ID manually</button>
            </div>
          )}

          {/* Character Image sessions (Path A) */}
          {!sessionsLoading && !sessionsError && connectMode === "charImage" && availableSessions.length > 0 && (
            <div className="session-list">
              {availableSessions.map(s => {
                const isLocked = s.hasExport;
                const isSelected = selectedCharImageId === s.projectId;
                return (
                  <div
                    key={s.projectId}
                    className={`session-card ${isSelected ? "session-card-selected" : ""} ${!isLocked ? "session-card-disabled" : ""}`}
                    onClick={() => { if (isLocked) setSelectedCharImageId(s.projectId); }}
                  >
                    <div className="session-card-header">
                      <span className={`session-status ${isLocked ? "status-locked" : "status-" + s.status}`}>
                        {isLocked ? "✓ Locked" : s.status}
                      </span>
                      <span className="session-cast-count">{s.characterCount} characters</span>
                    </div>
                    {s.characterNames.length > 0 && (
                      <div className="session-card-roles">
                        {s.characterNames.map(name => (
                          <span key={name} className="role-chip">{name}</span>
                        ))}
                      </div>
                    )}
                    {s.hookPremise && (
                      <div className="session-card-premise">
                        <em>{s.hookPremise}</em>
                      </div>
                    )}
                    {s.artStyle && (
                      <div className="session-card-style">
                        <span className="role-chip" style={{ background: "#e0e7ff", color: "#4338ca" }}>{s.artStyle}</span>
                      </div>
                    )}
                    <div className="session-card-meta">
                      <span>{s.turnCount} turns</span>
                      {!isLocked && <span className="warn-text">Not locked yet — complete the Character Image module first</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Character sessions (Path B) */}
          {!sessionsLoading && !sessionsError && connectMode === "character" && availableCharSessions.length > 0 && (
            <div className="session-list">
              {availableCharSessions.map(s => {
                const isLocked = s.hasExport;
                const isSelected = selectedCharId === s.projectId;
                return (
                  <div
                    key={s.projectId}
                    className={`session-card ${isSelected ? "session-card-selected" : ""} ${!isLocked ? "session-card-disabled" : ""}`}
                    onClick={() => { if (isLocked) setSelectedCharId(s.projectId); }}
                  >
                    <div className="session-card-header">
                      <span className={`session-status ${isLocked ? "status-locked" : "status-" + s.status}`}>
                        {isLocked ? "✓ Locked" : s.status}
                      </span>
                      <span className="session-cast-count">{s.castCount} characters</span>
                    </div>
                    {s.characterRoles.length > 0 && (
                      <div className="session-card-roles">
                        {s.characterRoles.map(r => (
                          <span key={r} className="role-chip">{r}</span>
                        ))}
                      </div>
                    )}
                    {s.ensembleDynamic && (
                      <div className="session-card-ensemble">
                        <em>{s.ensembleDynamic}</em>
                      </div>
                    )}
                    <div className="session-card-meta">
                      <span>{s.turnCount} turns</span>
                      {!isLocked && <span className="warn-text">Not locked yet — complete the Character module first</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {!sessionsLoading && !sessionsError && connectMode !== "manual" && availableSessions.length === 0 && availableCharSessions.length === 0 && (
            <p className="empty-text">No locked sessions found. Complete the Character or Character Image module first, or enter IDs manually.</p>
          )}

          {/* Resolved upstream IDs display for charImage mode */}
          {connectMode === "charImage" && selectedCharImageId && !showManualInput && (resolvedCharId || resolving) && (
            <div className="resolved-ids" style={{ marginTop: "0.75rem", fontSize: "0.85rem", color: "#6b7280" }}>
              {resolving && <p>Resolving upstream sessions...</p>}
              {!resolving && resolvedCharId && (
                <p>Character: <span style={{ color: "#10b981" }}>{resolvedCharId}</span>
                  {resolvedHookId && <> · Hook: <span style={{ color: "#10b981" }}>{resolvedHookId}</span></>}
                </p>
              )}
            </div>
          )}

          {/* Resolved upstream IDs display for character mode */}
          {connectMode === "character" && selectedCharId && !showManualInput && (resolvedCharId || resolving) && (
            <div className="resolved-ids" style={{ marginTop: "0.75rem", fontSize: "0.85rem", color: "#6b7280" }}>
              {resolving && <p>Resolving hook session...</p>}
              {!resolving && resolvedHookId && (
                <p>Hook: <span style={{ color: "#10b981" }}>{resolvedHookId}</span></p>
              )}
            </div>
          )}

          {/* Manual ID input fallback */}
          {(showManualInput || (connectMode === "manual" && !sessionsLoading && !sessionsError)) && (
            <div className="manual-input-section" style={{ marginTop: "0.75rem" }}>
              <p style={{ fontSize: "0.85rem", color: "#6b7280", marginBottom: "0.4rem" }}>Enter session IDs manually:</p>
              <div className="connect-inputs">
                <div className="connect-field">
                  <label>Character Image Session ID (optional)</label>
                  <input
                    value={selectedCharImageId}
                    onChange={(e) => setSelectedCharImageId(e.target.value)}
                    placeholder="Character Image project ID (leave blank to skip)..."
                    disabled={state.loading}
                  />
                </div>
                <div className="connect-field">
                  <label>Character Session ID</label>
                  <input
                    value={resolvedCharId ?? ""}
                    onChange={(e) => setResolvedCharId(e.target.value)}
                    placeholder="Character project ID..."
                    disabled={state.loading}
                  />
                </div>
                <div className="connect-field">
                  <label>Hook Session ID</label>
                  <input
                    value={resolvedHookId ?? ""}
                    onChange={(e) => setResolvedHookId(e.target.value)}
                    placeholder="Hook project ID..."
                    disabled={state.loading}
                  />
                </div>
              </div>
            </div>
          )}

          {!showManualInput && connectMode !== "manual" && availableSessions.length > 0 && (
            <button type="button" className="link-btn" style={{ fontSize: "0.82rem", marginTop: "0.4rem" }}
              onClick={() => setShowManualInput(true)}>
              Enter IDs manually instead
            </button>
          )}

          <div className="action-row" style={{ marginTop: "1rem" }}>
            <button
              type="button"
              className="btn-primary"
              onClick={validateUpstream}
              disabled={
                (connectMode === "charImage" && (!selectedCharImageId.trim() || resolving || state.loading)) ||
                (connectMode === "character" && (!selectedCharId.trim() || resolving || state.loading)) ||
                (connectMode === "manual" && (!resolvedCharId?.trim() || !resolvedHookId?.trim() || state.loading))
              }
            >
              {connectMode === "charImage" && "Connect via Character Images"}
              {connectMode === "character" && "Connect via Characters"}
              {connectMode === "manual" && "Connect"}
            </button>
          </div>
        </div>
      )}

      {/* ─── Phase: World Seed ─── */}
      {state.phase === "seeding" && (
        <div className="seed-phase">
          <h3>What kind of world do you envision?</h3>
          <p>Describe the world, setting, or constraints you have in mind — or leave blank and we'll build it together from your hook and characters.</p>
          <textarea
            className="seed-textarea"
            value={state.worldSeedValue}
            onChange={e => setState(s => ({ ...s, worldSeedValue: e.target.value }))}
            placeholder="e.g., 'A small-town grocery store where everyone knows everyone's business, corporate is always watching, and the loading dock is the only place you can have a real conversation...'"
            rows={4}
          />
          <button type="button" className="btn-primary" onClick={startClarification} disabled={state.loading}>
            {state.worldSeedValue.trim() ? "Start with this vision" : "Start fresh — build from what we have"}
          </button>
        </div>
      )}

      {/* ─── Phase: Clarifying ─── */}
      {state.phase === "clarifying" && !state.loading && (
        <div className="clarifier-phase">
          {state.hypothesisLine && (
            <div className="hypothesis-line">
              <p>{state.hypothesisLine}</p>
            </div>
          )}

          {state.conflictFlag && (
            <div className="conflict-flag">
              <p>{state.conflictFlag}</p>
              <div className="conflict-actions">
                <button
                  type="button"
                  className="chip-sm"
                  onClick={() => setState(s => ({ ...s, freeTextValue: "Regarding the conflict: I want to keep both as-is", selectedOptionId: null, selectedOptionLabel: null }))}
                >
                  Keep both
                </button>
                <button
                  type="button"
                  className="chip-sm"
                  onClick={() => setState(s => ({ ...s, freeTextValue: "Regarding the conflict: ", selectedOptionId: null, selectedOptionLabel: null }))}
                >
                  I'll resolve it...
                </button>
              </div>
            </div>
          )}

          <div className="readiness-bar">
            <div className={`readiness-fill ${state.readinessPct < 30 ? "readiness-low" : state.readinessPct < 60 ? "readiness-mid" : state.readinessPct < 85 ? "readiness-high" : "readiness-ready"}`} style={{ width: `${state.readinessPct}%` }} />
            <span>{state.readinessPct}% — {state.readinessNote || "Shaping the world..."}</span>
          </div>

          {state.worldFocus && (
            <div className="character-focus-tag">
              Focusing on: <strong>{state.worldFocus}</strong>
            </div>
          )}

          <div className="question-section">
            <h3>{state.question}</h3>

            <div className="options-row">
              {state.options.map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  className={`chip ${state.selectedOptionId === opt.id ? "chip-selected" : ""}`}
                  onClick={() => selectOption(opt)}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {state.allowFreeText && (
              <textarea
                className="free-text-input"
                value={state.freeTextValue}
                onChange={e => {
                  setState(s => ({ ...s, freeTextValue: e.target.value, selectedOptionId: null, selectedOptionLabel: null }));
                }}
                placeholder="Or describe your world vision..."
                rows={2}
              />
            )}
          </div>

          {/* Assumptions */}
          {state.assumptions.length > 0 && (
            <div className="assumptions-section">
              <h4>World assumptions — shape these:</h4>
              {state.assumptions.map(a => {
                const resp = state.assumptionResponses[a.id];
                return (
                  <div key={a.id} className="assumption-card">
                    <div className="assumption-header">
                      <span className="assumption-role">{a.category}</span>
                      <span className="assumption-text">{a.assumption}</span>
                    </div>
                    <div className="assumption-actions">
                      <button
                        type="button"
                        className={`chip-sm ${resp?.action === "keep" ? "chip-selected" : ""}`}
                        onClick={() => setAssumptionAction(a.id, "keep", a.assumption)}
                      >
                        Keep
                      </button>
                      {a.alternatives.map((alt, i) => {
                        const isSelected = resp?.action === "alternative" && resp.value.split(" + ").includes(alt);
                        return (
                          <button
                            key={i}
                            type="button"
                            className={`chip-sm ${isSelected ? "chip-selected" : ""}`}
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
                          >
                            {alt}
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        className={`chip-sm ${resp?.action === "not_ready" ? "chip-selected" : ""}`}
                        onClick={() => setAssumptionAction(a.id, "not_ready", "")}
                      >
                        Not sure yet
                      </button>
                      {resp?.action !== "freeform" && (
                        <button
                          type="button"
                          className="assumption-btn assumption-freeform-trigger"
                          onClick={() => setAssumptionAction(a.id, "freeform", "")}
                        >
                          My own idea...
                        </button>
                      )}
                    </div>
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

          <div className="action-row">
            <button type="button" className="btn-primary" onClick={submitTurn}
              disabled={!state.selectedOptionId && !state.freeTextValue.trim()}>
              Continue
            </button>
            {state.readyForWorld && (
              <button type="button" className="btn-accent" onClick={generateWorld}>
                Generate World
              </button>
            )}
          </div>
        </div>
      )}

      {/* ─── Phase: Generating ─── */}
      {state.phase === "generating" && !state.loading && (
        <div className="generating-phase">
          <p>Building your world — arena, rules, factions, consequences...</p>
        </div>
      )}

      {/* ─── Phase: Revealed ─── */}
      {state.phase === "revealed" && state.revealedWorld && (
        <div className="revealed-phase">
          <h3>World Blueprint</h3>

          {state.judgeInfo && (
            <div className={`judge-banner ${state.judgeInfo.passed ? "judge-pass" : "judge-fail"}`}>
              <strong>{state.judgeInfo.passed ? "PASSED" : "NEEDS WORK"}</strong>
              {!state.judgeInfo.passed && state.judgeInfo.hard_fail_reasons.length > 0 && (
                <ul>
                  {state.judgeInfo.hard_fail_reasons.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              )}
              <div className="judge-scores">
                {Object.entries(state.judgeInfo.scores).map(([key, val]) => (
                  <span key={key} className="score-pill">
                    {key.replace(/_/g, " ")}: <strong>{val}/10</strong>
                  </span>
                ))}
              </div>
              {state.judgeInfo.weakest_element && (
                <p className="judge-note"><strong>Weakest element:</strong> {state.judgeInfo.weakest_element}</p>
              )}
              {state.judgeInfo.one_fix_instruction && (
                <p className="judge-fix"><strong>Suggested fix:</strong> {state.judgeInfo.one_fix_instruction}</p>
              )}
            </div>
          )}

          {/* Development Targets (cross-module tracking) */}
          {state.developmentTargets.length > 0 && (
            <details className="dev-targets-panel">
              <summary className="dev-targets-summary">
                Development Targets — {state.developmentTargets.filter(t => t.status === "addressed").length}/{state.developmentTargets.length} addressed
              </summary>
              <div className="dev-targets-list">
                {state.developmentTargets.map(target => (
                  <div key={target.id} className={`dev-target-card dev-target-${target.status}`}>
                    <div className="dev-target-header">
                      <span className={`dev-target-status status-${target.status}`}>
                        {target.status === "addressed" ? "✓" : target.status === "partially_addressed" ? "◐" : "○"} {target.status.replace(/_/g, " ")}
                      </span>
                      <span className="dev-target-source">from {target.source_module}</span>
                    </div>
                    <p className="dev-target-text">{target.target}</p>
                    {target.notes && <p className="dev-target-notes">{target.notes}</p>}
                    {target.addressed_by && <p className="dev-target-addressed">Addressed by: {target.addressed_by}</p>}
                  </div>
                ))}
              </div>
            </details>
          )}

          {/* Judge Weaknesses (this world build) */}
          {state.weaknesses.length > 0 && (
            <details className="dev-targets-panel weaknesses-panel">
              <summary className="dev-targets-summary">
                World Weaknesses — {state.weaknesses.length} areas for downstream development
              </summary>
              <div className="dev-targets-list">
                {state.weaknesses.map((w, i) => (
                  <div key={i} className="dev-target-card dev-target-unaddressed">
                    <div className="dev-target-header">
                      <span className="dev-target-source">{w.area}</span>
                    </div>
                    <p className="dev-target-text">{w.weakness}</p>
                    <p className="dev-target-notes">Opportunity: {w.development_opportunity}</p>
                  </div>
                ))}
              </div>
            </details>
          )}

          {/* World Thesis */}
          <div className="world-section">
            <h4>World Thesis</h4>
            <p>{state.revealedWorld.world_thesis}</p>
          </div>

          {/* Pressure Summary */}
          <div className="world-section">
            <h4>Pressure Summary</h4>
            <p>{state.revealedWorld.pressure_summary}</p>
          </div>

          {/* Scope */}
          <div className="world-section">
            <h4>Scope</h4>
            <div className="world-detail-grid">
              <div className="world-detail-item">
                <span className="detail-label">Reality Level</span>
                <span className="detail-value">{state.revealedWorld.scope.reality_level}</span>
              </div>
              <div className="world-detail-item">
                <span className="detail-label">Violence Level</span>
                <span className="detail-value">{state.revealedWorld.scope.violence_level}</span>
              </div>
              <div className="world-detail-item">
                <span className="detail-label">Time Pressure</span>
                <span className="detail-value">{state.revealedWorld.scope.time_pressure}</span>
              </div>
              <div className="world-detail-item">
                <span className="detail-label">Camera Rule</span>
                <span className="detail-value">{state.revealedWorld.scope.camera_rule}</span>
              </div>
            </div>
            <p className="world-tone-rule">{state.revealedWorld.scope.tone_rule}</p>
          </div>

          {/* Arena */}
          <div className="world-section">
            <h4>Arena — {state.revealedWorld.arena.locations.length} locations</h4>
            {state.revealedWorld.arena.locations.map(loc => (
              <div key={loc.id} className="arena-location-card">
                <div className="arena-location-header">
                  <strong>{loc.name}</strong>
                  {loc.id === state.revealedWorld!.arena.primary_stage && <span className="arena-badge">Primary Stage</span>}
                  {loc.id === state.revealedWorld!.arena.hidden_stage && <span className="arena-badge arena-badge-hidden">Hidden Stage</span>}
                  <span className="arena-access">{loc.access}</span>
                </div>
                <p>{loc.description}</p>
                <div className="arena-details">
                  <div className="arena-affordances">
                    <span className="detail-label">Affordances:</span>
                    {loc.affordances.map((a, i) => <span key={i} className="role-chip">{a}</span>)}
                  </div>
                  <div className="arena-register">
                    <span className="detail-label">Emotional register:</span> {loc.emotional_register}
                  </div>
                </div>
              </div>
            ))}
            {state.revealedWorld.arena.edges.length > 0 && (
              <div className="arena-edges">
                <h5>Connections</h5>
                {state.revealedWorld.arena.edges.map((edge, i) => (
                  <div key={i} className="arena-edge">
                    <span className="edge-path">{edge.from} → {edge.to}</span>
                    <span className="edge-traversal">{edge.traversal}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Rules */}
          <div className="world-section">
            <h4>Rules — {state.revealedWorld.rules.length} constraints</h4>
            {state.revealedWorld.rules.map(rule => (
              <div key={rule.id} className="world-rule-card">
                <div className="rule-header">
                  <span className="rule-domain">{rule.domain}</span>
                  <span className="rule-enforcer">Enforced by: {rule.who_enforces}</span>
                </div>
                <p className="rule-text">{rule.rule}</p>
                <div className="rule-details">
                  <p><strong>If broken:</strong> {rule.consequence_if_broken}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Factions */}
          <div className="world-section">
            <h4>Factions — {state.revealedWorld.factions.length} power groups</h4>
            {state.revealedWorld.factions.map(faction => (
              <div key={faction.id} className="faction-card">
                <h5>{faction.name}</h5>
                <p className="faction-goal"><strong>Goal:</strong> {faction.goal}</p>
                <div className="faction-details">
                  <div>
                    <span className="detail-label">Methods:</span>
                    {faction.methods.map((m, i) => <span key={i} className="role-chip">{m}</span>)}
                  </div>
                  <div>
                    <span className="detail-label">Constraints:</span>
                    {faction.constraints.map((c, i) => <span key={i} className="role-chip">{c}</span>)}
                  </div>
                </div>
                <p className="faction-pressure"><strong>Pressure on protagonist:</strong> {faction.pressure_on_protagonist}</p>
              </div>
            ))}
          </div>

          {/* Consequence Patterns */}
          <div className="world-section">
            <h4>Consequence Patterns — {state.revealedWorld.consequence_patterns.length} vectors</h4>
            {state.revealedWorld.consequence_patterns.map(cp => (
              <div key={cp.id} className="consequence-card">
                <div className="consequence-header">
                  <span className="consequence-speed">{cp.escalation_speed}</span>
                  {cp.reversible && <span className="consequence-reversible">Reversible</span>}
                  {!cp.reversible && <span className="consequence-irreversible">Irreversible</span>}
                </div>
                <p><strong>Trigger:</strong> {cp.trigger}</p>
                <p><strong>Response:</strong> {cp.world_response}</p>
              </div>
            ))}
          </div>

          {/* Canon Register */}
          {state.revealedWorld.canon_register.length > 0 && (
            <div className="world-section">
              <h4>Canon Register — {state.revealedWorld.canon_register.length} facts</h4>
              <div className="canon-list">
                {state.revealedWorld.canon_register.map(fact => (
                  <div key={fact.id} className="canon-fact">
                    <span className="canon-source">{fact.source_module}</span>
                    <span className="canon-text">{fact.fact}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Information Access (Truth Matrix) */}
          {state.revealedWorld.information_access?.length > 0 && (
            <div className="world-section">
              <h4>Information Access — {state.revealedWorld.information_access.length} truth layers</h4>
              {state.revealedWorld.information_access.map((il) => (
                <div key={il.id} className="info-layer-card">
                  <p className="info-truth"><strong>Truth:</strong> {il.truth}</p>
                  <div className="info-grid">
                    <div><span className="detail-label">Knows:</span> {il.who_knows.map((w, i) => <span key={i} className="role-chip">{w}</span>)}</div>
                  </div>
                  <p className="info-irony"><strong>Dramatic irony:</strong> {il.dramatic_irony}</p>
                </div>
              ))}
            </div>
          )}

          {/* Volatility (Live Wires) */}
          {state.revealedWorld.volatility?.length > 0 && (
            <div className="world-section">
              <h4>Volatility — {state.revealedWorld.volatility.length} live wires</h4>
              {state.revealedWorld.volatility.map((vp) => (
                <div key={vp.id} className="volatility-card">
                  <p><strong>Element:</strong> {vp.element}</p>
                  <p><strong>Trigger:</strong> {vp.trigger}</p>
                  <p><strong>Consequence:</strong> {vp.consequence}</p>
                </div>
              ))}
            </div>
          )}

          <div className="action-row">
            <button type="button" className="btn-accent" onClick={lockWorld}>
              Lock World
            </button>
            <button type="button" className="btn-ghost" onClick={rerollWorld}>
              Regenerate World
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

          {showConstraintOverrides && (
            <div className="constraint-overrides">
              <label htmlFor="world-constraint-overrides">
                <strong>Constraint Overrides</strong>
                <span className="hint"> (one per line: key: value)</span>
              </label>
              <textarea
                id="world-constraint-overrides"
                rows={4}
                placeholder={"arena.backroom.access: restricted to insiders\nrule.institutional.audit_schedule: weekly\nfaction.corporate.goal: monopoly"}
                value={constraintOverridesText}
                onChange={(e) => setConstraintOverridesText(e.target.value)}
              />
              <p className="hint">
                Override or add constraint ledger entries before regenerating. Use scoped keys like: arena.backroom.access, rule.institutional.audit_schedule, faction.corporate.goal.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ─── Phase: Locked ─── */}
      {state.phase === "locked" && (
        <div className="locked-phase">
          <h3>World Locked!</h3>
          <p>Your world&apos;s arena, rules, factions, and consequences have been saved. These constraints will shape all downstream generation.</p>
          <button type="button" className="btn-ghost" onClick={resetAll}>Start New Session</button>
        </div>
      )}

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
        module="world"
        projectId={projectId}
        fetchInsights={fetchInsights}
        visible={showInsights}
        onClose={() => setShowInsights(false)}
      />
    </div>
  );
}
