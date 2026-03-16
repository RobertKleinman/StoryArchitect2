import React, { useMemo, useState } from "react";
import { plotApi } from "../lib/plotApi";
import { hookApi } from "../lib/hookApi";
import { characterApi } from "../lib/characterApi";
import { worldApi } from "../lib/worldApi";
import { startBuildProgressPolling } from "../lib/buildProgressPoller";
import { emitModuleStatus } from "./App";
import { PsychologyOverlay } from "./PsychologyOverlay";
import { EngineInsights } from "./EngineInsights";
import { ModelSelector } from "./ModelSelector";
import { PackPreview } from "./PackPreview";
import { PromptEditor } from "./PromptEditor";
import type {
  PlotAssumptionResponse,
  PlotBuilderOutput,
  PlotClarifierOption,
  PlotAssumption,
  PlotJudgeScores,
  PlotPromptOverrides,
  PlotDevelopmentTarget,
  TensionBeat,
  TurningPoint,
} from "../../shared/types/plot";
import type { HookPack } from "../../shared/types/hook";
import type { CharacterPack } from "../../shared/types/character";
import type { WorldPack } from "../../shared/types/world";

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
  options: PlotClarifierOption[];
  allowFreeText: boolean;
  freeTextValue: string;
  plotFocus: string | null;
  turnNumber: number;
  readyForPlot: boolean;
  readinessPct: number;
  readinessNote: string;
  conflictFlag: string;
  revealedPlot: PlotBuilderOutput | null;
  judgeInfo: {
    passed: boolean;
    hard_fail_reasons: string[];
    scores: PlotJudgeScores;
    weakest_element: string;
    one_fix_instruction: string;
  } | null;
  loading: boolean;
  loadingMessage: string;
  error: string | null;
  assumptions: PlotAssumption[];
  assumptionResponses: Record<string, { action: "keep" | "alternative" | "freeform" | "not_ready"; value: string }>;
  selectedOptionId: string | null;
  selectedOptionLabel: string | null;
  plotSeedValue: string;
  developmentTargets: PlotDevelopmentTarget[];
  weaknesses: Array<{ area: string; weakness: string; development_opportunity: string }>;
}

const initialState: WorkshopState = {
  phase: "connect",
  hypothesisLine: "",
  question: "",
  options: [],
  allowFreeText: true,
  freeTextValue: "",
  plotFocus: null,
  turnNumber: 0,
  readyForPlot: false,
  readinessPct: 0,
  readinessNote: "",
  conflictFlag: "",
  revealedPlot: null,
  judgeInfo: null,
  loading: false,
  loadingMessage: "",
  error: null,
  assumptions: [],
  assumptionResponses: {},
  selectedOptionId: null,
  selectedOptionLabel: null,
  plotSeedValue: "",
  developmentTargets: [],
  weaknesses: [],
};

const PLOT_SESSION_KEY = "plotWorkshop_projectId";
const PLOT_WORLD_ID_KEY = "plotWorkshop_worldProjectId";
const PLOT_CHAR_IMAGE_ID_KEY = "plotWorkshop_charImageProjectId";
const PLOT_CHAR_ID_KEY = "plotWorkshop_characterProjectId";
const PLOT_HOOK_ID_KEY = "plotWorkshop_hookProjectId";

// Keys from upstream modules' localStorage
const WORLD_SESSION_KEY = "worldWorkshop_projectId";
const IMG_SESSION_KEY = "charImageWorkshop_projectId";
const CHAR_SESSION_KEY = "characterWorkshop_projectId";
const HOOK_SESSION_KEY = "hookWorkshop_projectId";

interface WorldSessionInfo {
  projectId: string;
  characterImageProjectId?: string;
  characterProjectId: string;
  hookProjectId: string;
  status: string;
  turnCount: number;
  hasExport: boolean;
}

function makeProjectId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `plot-${crypto.randomUUID()}`;
  }
  return `plot-${Date.now()}`;
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

export function PlotWorkshop() {
  const [projectId, setProjectId] = useState(() => {
    return loadSaved(PLOT_SESSION_KEY) ?? makeProjectId();
  });

  // Upstream IDs
  const [worldProjectId, setWorldProjectId] = useState(() => {
    return loadSaved(PLOT_WORLD_ID_KEY) ?? loadSaved(WORLD_SESSION_KEY) ?? "";
  });
  const [charImageProjectId, setCharImageProjectId] = useState(() => {
    return loadSaved(PLOT_CHAR_IMAGE_ID_KEY) ?? "";
  });
  const [characterProjectId, setCharacterProjectId] = useState(() => {
    return loadSaved(PLOT_CHAR_ID_KEY) ?? "";
  });
  const [hookProjectId, setHookProjectId] = useState(() => {
    return loadSaved(PLOT_HOOK_ID_KEY) ?? "";
  });

  // Selected world session ID for the connect phase card picker
  const [selectedWorldId, setSelectedWorldId] = useState(() => {
    return loadSaved(PLOT_WORLD_ID_KEY) ?? loadSaved(WORLD_SESSION_KEY) ?? "";
  });

  // Available world sessions for the connect phase
  const [availableSessions, setAvailableSessions] = useState<WorldSessionInfo[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [showManualInput, setShowManualInput] = useState(false);
  // Resolved upstream IDs from world session
  const [resolvedCharImageId, setResolvedCharImageId] = useState<string | null>(null);
  const [resolvedCharId, setResolvedCharId] = useState<string | null>(null);
  const [resolvedHookId, setResolvedHookId] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);

  const [upstreamValidated, setUpstreamValidated] = useState(false);

  const [state, setState] = useState<WorkshopState>(initialState);
  const [showPsych, setShowPsych] = useState(false);
  const [showInsights, setShowInsights] = useState(false);
  const fetchPsych = useMemo(() => () => plotApi.debugPsychology(projectId), [projectId]);
  const fetchInsights = useMemo(() => () => plotApi.debugInsights(projectId), [projectId]);

  // Constraint override state for regeneration
  const [showConstraintOverrides, setShowConstraintOverrides] = useState(false);
  const [constraintOverridesText, setConstraintOverridesText] = useState("");

  // Prompt preview / override state
  const [promptPreview, setPromptPreview] = useState<{ stage: string; system: string; user: string } | null>(null);
  const [promptOverrides, setPromptOverrides] = useState<PlotPromptOverrides | undefined>(undefined);
  const [builderPromptOverrides, setBuilderPromptOverrides] = useState<PlotPromptOverrides | undefined>(undefined);

  // Locked pack for PackPreview display
  const [lockedPack, setLockedPack] = useState<import("../../shared/types/plot").PlotPack | null>(null);

  // Upstream pack previews
  const [upstreamHookPack, setUpstreamHookPack] = useState<HookPack | null>(null);
  const [upstreamCharacterPack, setUpstreamCharacterPack] = useState<CharacterPack | null>(null);
  const [upstreamWorldPack, setUpstreamWorldPack] = useState<WorldPack | null>(null);

  // ─── Load available world sessions on mount ───
  React.useEffect(() => {
    setSessionsLoading(true);
    setSessionsError(null);
    plotApi.listWorldSessions()
      .then((result) => {
        setAvailableSessions(result.sessions);

        // Auto-select if only one locked session
        const lockedWorlds = result.sessions.filter(s => s.hasExport);
        if (lockedWorlds.length === 1) {
          setSelectedWorldId((prev) => prev || lockedWorlds[0].projectId);
        }
      })
      .catch((err) => {
        setSessionsError(err.message ?? "Failed to load sessions");
      })
      .finally(() => setSessionsLoading(false));
  }, []);

  // ─── Auto-resolve upstream IDs when a world session is selected ───
  React.useEffect(() => {
    if (!selectedWorldId) {
      setResolvedCharImageId(null);
      setResolvedCharId(null);
      setResolvedHookId(null);
      return;
    }
    // Try to find the session to get upstream IDs
    const session = availableSessions.find(s => s.projectId === selectedWorldId);
    if (session) {
      setResolvedCharImageId(session.characterImageProjectId ?? null);
      setResolvedCharId(session.characterProjectId);
      setResolvedHookId(session.hookProjectId);
    } else {
      setResolvedCharImageId(null);
      setResolvedCharId(null);
      setResolvedHookId(null);
    }
  }, [selectedWorldId, availableSessions]);

  // ─── Recovery check ───
  const [recoveryChecked, setRecoveryChecked] = useState(false);

  React.useEffect(() => {
    const savedId = loadSaved(PLOT_SESSION_KEY);
    if (savedId) {
      plotApi.getSession(savedId).then((session) => {
        if (session && session.status !== "locked") {
          setProjectId(session.projectId);
          setWorldProjectId(session.worldProjectId);
          setCharacterProjectId(session.characterProjectId);
          setHookProjectId(session.hookProjectId);
          if (session.characterImageProjectId) {
            setCharImageProjectId(session.characterImageProjectId);
          }
          setUpstreamValidated(true);

          saveTo(PLOT_WORLD_ID_KEY, session.worldProjectId);
          saveTo(PLOT_CHAR_ID_KEY, session.characterProjectId);
          saveTo(PLOT_HOOK_ID_KEY, session.hookProjectId);
          if (session.characterImageProjectId) {
            saveTo(PLOT_CHAR_IMAGE_ID_KEY, session.characterImageProjectId);
          }

          const lastTurn = session.turns?.length > 0 ? session.turns[session.turns.length - 1] : null;

          if (session.status === "revealed" && session.revealedPlot) {
            setState(prev => ({
              ...prev,
              phase: "revealed",
              revealedPlot: session.revealedPlot ?? null,
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
              plotFocus: lastTurn.clarifierResponse.plot_focus,
              turnNumber: session.turns.length,
              readyForPlot: lastTurn.clarifierResponse.ready_for_plot,
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
    let finalWorldId = selectedWorldId;
    let finalCharImageId = resolvedCharImageId ?? "";
    let finalCharId = resolvedCharId ?? "";
    let finalHookId = resolvedHookId ?? "";

    if (!finalWorldId) {
      setState(s => ({ ...s, error: "Please select a World session." }));
      return;
    }

    if (!finalCharId || !finalHookId) {
      setState(s => ({ ...s, error: "Could not resolve all upstream IDs from the selected world session. Try manual input." }));
      setShowManualInput(true);
      return;
    }

    setState(s => ({ ...s, loading: true, loadingMessage: "Checking upstream modules...", error: null }));
    try {
      // Validate world session exists
      await plotApi.getWorldSession(finalWorldId);

      setWorldProjectId(finalWorldId);
      setCharImageProjectId(finalCharImageId);
      setCharacterProjectId(finalCharId);
      setHookProjectId(finalHookId);

      saveTo(PLOT_WORLD_ID_KEY, finalWorldId);
      if (finalCharImageId) {
        saveTo(PLOT_CHAR_IMAGE_ID_KEY, finalCharImageId);
      }
      saveTo(PLOT_CHAR_ID_KEY, finalCharId);
      saveTo(PLOT_HOOK_ID_KEY, finalHookId);

      setUpstreamValidated(true);
      setState(s => ({ ...s, phase: "seeding", loading: false }));

      // Fetch upstream packs for preview (fire and forget)
      hookApi.exportSession(finalHookId).then(p => setUpstreamHookPack(p)).catch(() => {});
      characterApi.exportSession(finalCharId).then(p => setUpstreamCharacterPack(p)).catch(() => {});
      worldApi.exportSession(finalWorldId).then(p => setUpstreamWorldPack(p)).catch(() => {});
    } catch (err: any) {
      setState(s => ({ ...s, loading: false, error: `Upstream validation failed: ${err.message}. Complete and lock the World module first.` }));
    }
  };

  const loadPromptPreview = async (stage: "clarifier" | "builder" | "judge" | "summary") => {
    try {
      const preview = await plotApi.previewPrompt({ projectId, stage });
      setPromptPreview(preview);
      setPromptOverrides(undefined);
      setBuilderPromptOverrides(undefined);
    } catch { /* prompt preview is optional */ }
  };

  const startClarification = async () => {
    setState(s => ({ ...s, loading: true, loadingMessage: "Starting plot discovery...", error: null }));
    try {
      const newId = makeProjectId();
      setProjectId(newId);
      saveTo(PLOT_SESSION_KEY, newId);

      const result = await plotApi.clarify({
        projectId: newId,
        worldProjectId,
        ...(charImageProjectId && { characterImageProjectId: charImageProjectId }),
        characterProjectId,
        hookProjectId,
        plotSeed: state.plotSeedValue || undefined,
        promptOverrides,
      });
      setPromptPreview(null);
      setPromptOverrides(undefined);

      setState(s => ({
        ...s,
        phase: "clarifying",
        hypothesisLine: result.clarifier.hypothesis_line,
        question: result.clarifier.question,
        options: result.clarifier.options,
        allowFreeText: result.clarifier.allow_free_text,
        plotFocus: result.clarifier.plot_focus,
        turnNumber: result.turnNumber,
        readyForPlot: result.clarifier.ready_for_plot,
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
      emitModuleStatus("plot", "active");
    } catch (err: any) {
      setState(s => ({ ...s, loading: false, error: err.message }));
    }
  };

  const submitTurn = async () => {
    const hasOption = !!state.selectedOptionId;
    const hasFreeText = !!state.freeTextValue.trim();
    const hasAssumptions = Object.keys(state.assumptionResponses).length > 0;
    if (!hasOption && !hasFreeText && !hasAssumptions) return;

    const userSelection = hasFreeText
      ? { type: "free_text" as const, label: state.freeTextValue.trim() }
      : hasOption
        ? { type: "option" as const, optionId: state.selectedOptionId!, label: state.selectedOptionLabel! }
        : { type: "option" as const, optionId: "assumptions_only", label: "Confirmed assumptions" };

    const assumptionResponses: PlotAssumptionResponse[] = [];
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

    setState(s => ({ ...s, loading: true, loadingMessage: "Weaving the plot...", error: null }));
    try {
      const result = await plotApi.clarify({
        projectId,
        worldProjectId,
        ...(charImageProjectId && { characterImageProjectId: charImageProjectId }),
        characterProjectId,
        hookProjectId,
        userSelection,
        assumptionResponses: assumptionResponses.length > 0 ? assumptionResponses : undefined,
        promptOverrides,
      });
      setPromptPreview(null);
      setPromptOverrides(undefined);

      setState(s => ({
        ...s,
        phase: "clarifying",
        hypothesisLine: result.clarifier.hypothesis_line,
        question: result.clarifier.question,
        options: result.clarifier.options,
        allowFreeText: result.clarifier.allow_free_text,
        plotFocus: result.clarifier.plot_focus,
        turnNumber: result.turnNumber,
        readyForPlot: result.clarifier.ready_for_plot,
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

  const generatePlot = async () => {
    setState(s => ({ ...s, phase: "generating", loading: true, loadingMessage: "Building your plot...", error: null }));
    const stopPolling = startBuildProgressPolling(
      () => plotApi.getSession(projectId),
      "plot",
      (msg) => setState(s => ({ ...s, loadingMessage: msg })),
    );
    try {
      const tournamentOverrides = builderPromptOverrides ? { builder: builderPromptOverrides } : undefined;
      const result = await plotApi.generate(projectId, tournamentOverrides);
      stopPolling();
      setPromptPreview(null);
      setBuilderPromptOverrides(undefined);
      setState(s => ({
        ...s,
        phase: "revealed",
        revealedPlot: result.plot,
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

  const rerollPlot = async () => {
    setState(s => ({ ...s, loading: true, loadingMessage: "Regenerating plot...", error: null }));
    const stopPolling = startBuildProgressPolling(
      () => plotApi.getSession(projectId),
      "plot",
      (msg) => setState(s => ({ ...s, loadingMessage: msg })),
    );
    try {
      const parsedOverrides = parseConstraintOverrides(constraintOverridesText);
      const tournamentOverrides = builderPromptOverrides ? { builder: builderPromptOverrides } : undefined;
      const result = await plotApi.reroll(projectId, tournamentOverrides, parsedOverrides);
      stopPolling();
      setState(s => ({
        ...s,
        revealedPlot: result.plot,
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

  const lockPlot = async () => {
    setState(s => ({ ...s, loading: true, loadingMessage: "Locking plot...", error: null }));
    try {
      const pack = await plotApi.lock(projectId);
      setLockedPack(pack);
      setState(s => ({ ...s, phase: "locked", loading: false }));
      emitModuleStatus("plot", "locked");
    } catch (err: any) {
      setState(s => ({ ...s, loading: false, error: err.message }));
    }
  };

  const resetAll = async () => {
    try { await plotApi.reset(projectId); } catch {}
    clearSaved(PLOT_SESSION_KEY);
    clearSaved(PLOT_WORLD_ID_KEY);
    clearSaved(PLOT_CHAR_IMAGE_ID_KEY);
    clearSaved(PLOT_CHAR_ID_KEY);
    clearSaved(PLOT_HOOK_ID_KEY);
    const newId = makeProjectId();
    setProjectId(newId);
    setWorldProjectId("");
    setCharImageProjectId("");
    setCharacterProjectId("");
    setHookProjectId("");
    setSelectedWorldId(loadSaved(WORLD_SESSION_KEY) ?? "");
    setResolvedCharImageId(null);
    setResolvedCharId(null);
    setResolvedHookId(null);
    setShowManualInput(false);
    setUpstreamValidated(false);
    setState(initialState);
    emitModuleStatus("plot", "idle");
    // Re-fetch sessions
    setSessionsLoading(true);
    plotApi.listWorldSessions()
      .then((result) => {
        setAvailableSessions(result.sessions);
        const lockedWorlds = result.sessions.filter(s => s.hasExport);
        if (lockedWorlds.length === 1) setSelectedWorldId(lockedWorlds[0].projectId);
      })
      .catch((err) => {
        console.error("Failed to refresh world sessions:", err);
        setSessionsError(err.message ?? "Failed to refresh sessions");
      })
      .finally(() => setSessionsLoading(false));
  };

  // ─── Render helpers ───

  const selectOption = (opt: PlotClarifierOption) => {
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

  const renderTensionChain = () => {
    if (!state.revealedPlot || !state.revealedPlot.tension_chain) return null;

    const beats = state.revealedPlot.tension_chain;
    const turningPointIds = new Set(state.revealedPlot.turning_points.map(tp => tp.beat_id));

    return (
      <div className="tension-chain">
        {beats.map((beat, idx) => {
          const isTurningPoint = turningPointIds.has(beat.id);
          const turningPoint = state.revealedPlot!.turning_points.find(tp => tp.beat_id === beat.id);

          return (
            <div key={beat.id} className={`tension-beat ${isTurningPoint ? "turning-point" : ""}`}>
              <div className="beat-number">
                {isTurningPoint && <span className="turning-point-badge">⚡</span>}
                <span className="beat-idx">{idx + 1}</span>
              </div>

              <div className="beat-content">
                <div className="beat-text">
                  <p className="beat-description">{beat.beat}</p>
                </div>

                {idx > 0 && beat.causal_logic && (
                  <div className="beat-connector">
                    <span className="connector-reason">{beat.causal_logic}</span>
                  </div>
                )}

                <div className="beat-details">
                  <div className="beat-detail-row">
                    <span className="detail-label">Stakes:</span>
                    <div className="stakes-bar">
                      <div className="stakes-fill" style={{ width: `${beat.stakes_level * 10}%` }} />
                      <span className="stakes-value">{beat.stakes_level}/10</span>
                    </div>
                  </div>

                  <div className="beat-detail-row">
                    <span className="detail-label">Emotional Register:</span>
                    <span className="detail-value">{beat.emotional_register}</span>
                  </div>

                  {beat.question_opened && (
                    <div className="beat-question">
                      <span className="question-label">Opens:</span>
                      <span className="question-text">"{beat.question_opened}"</span>
                    </div>
                  )}

                  {beat.question_answered && (
                    <div className="beat-answer">
                      <span className="answer-label">Answers:</span>
                      <span className="answer-text">"{beat.question_answered}"</span>
                    </div>
                  )}

                  {beat.characters_involved.length > 0 && (
                    <div className="beat-characters">
                      <span className="detail-label">Characters:</span>
                      <div className="character-chips">
                        {beat.characters_involved.map((char, i) => (
                          <span key={i} className="role-chip">{char}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {isTurningPoint && turningPoint && (
                  <div className="turning-point-panel">
                    <h5>Turning Point: {turningPoint.label}</h5>
                    <div className="turning-point-content">
                      <p><strong>Believed before:</strong> {turningPoint.believed_before}</p>
                      <p><strong>Learned after:</strong> {turningPoint.learned_after}</p>
                      <p><strong>Emotional whiplash:</strong> {turningPoint.whiplash_direction}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
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
    <div className="workshop plot-workshop">
      <ModelSelector />

      <div className="workshop-header">
        <h2>Plot</h2>
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

      {/* ─── Phase: Connect to world module ─── */}
      {state.phase === "connect" && (
        <div className="connect-phase">
          <p>Select a locked World session. The upstream chain (Character, Hook) will be resolved automatically.</p>

          {sessionsLoading && <p className="loading-text">Loading available world sessions...</p>}

          {sessionsError && (
            <div className="error-banner">
              <p>Could not load sessions: {sessionsError}</p>
              <button type="button" onClick={() => setShowManualInput(true)}>Enter ID manually</button>
            </div>
          )}

          {/* World sessions */}
          {!sessionsLoading && !sessionsError && availableSessions.length > 0 && (
            <div className="session-list">
              {availableSessions.map(s => {
                const isLocked = s.hasExport;
                const isSelected = selectedWorldId === s.projectId;
                return (
                  <div
                    key={s.projectId}
                    className={`session-card ${isSelected ? "session-card-selected" : ""} ${!isLocked ? "session-card-disabled" : ""}`}
                    onClick={() => { if (isLocked) setSelectedWorldId(s.projectId); }}
                  >
                    <div className="session-card-header">
                      <span className={`session-status ${isLocked ? "status-locked" : "status-" + s.status}`}>
                        {isLocked ? "✓ Locked" : s.status}
                      </span>
                    </div>
                    <div className="session-card-meta">
                      <span>{s.turnCount} turns</span>
                      {!isLocked && <span className="warn-text">Not locked yet — complete the World module first</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {!sessionsLoading && !sessionsError && availableSessions.length === 0 && (
            <p className="empty-text">No locked world sessions found. Complete the World module first, or enter IDs manually.</p>
          )}

          {/* Resolved upstream IDs display */}
          {selectedWorldId && !showManualInput && (resolvedCharId || resolving) && (
            <div className="resolved-ids" style={{ marginTop: "0.75rem", fontSize: "0.85rem", color: "#6b7280" }}>
              {resolving && <p>Resolving upstream sessions...</p>}
              {!resolving && resolvedCharId && (
                <p>Character: <span style={{ color: "#10b981" }}>{resolvedCharId}</span>
                  {resolvedHookId && <> · Hook: <span style={{ color: "#10b981" }}>{resolvedHookId}</span></>}
                </p>
              )}
            </div>
          )}

          {/* Manual ID input fallback */}
          {(showManualInput) && (
            <div className="manual-input-section" style={{ marginTop: "0.75rem" }}>
              <p style={{ fontSize: "0.85rem", color: "#6b7280", marginBottom: "0.4rem" }}>Enter session IDs manually:</p>
              <div className="connect-inputs">
                <div className="connect-field">
                  <label>World Session ID</label>
                  <input
                    value={selectedWorldId}
                    onChange={(e) => setSelectedWorldId(e.target.value)}
                    placeholder="World project ID..."
                    disabled={state.loading}
                  />
                </div>
                <div className="connect-field">
                  <label>Character Image Session ID (optional)</label>
                  <input
                    value={resolvedCharImageId ?? ""}
                    onChange={(e) => setResolvedCharImageId(e.target.value || null)}
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

          {!showManualInput && availableSessions.length > 0 && (
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
                (!selectedWorldId?.trim() || state.loading) ||
                (!resolvedCharId?.trim() || !resolvedHookId?.trim())
              }
            >
              Connect to World
            </button>
          </div>
        </div>
      )}

      {/* ─── Phase: Plot Seed ─── */}
      {state.phase === "seeding" && (
        <div className="seed-phase">
          {(upstreamHookPack || upstreamCharacterPack || upstreamWorldPack) && (
            <div className="upstream-packs">
              {upstreamHookPack && <PackPreview pack={upstreamHookPack} />}
              {upstreamCharacterPack && <PackPreview pack={upstreamCharacterPack} />}
              {upstreamWorldPack && <PackPreview pack={upstreamWorldPack} />}
            </div>
          )}

          <h3>What kind of plot do you envision?</h3>
          <p>Describe the story spine, pacing, twist locations, or emotional peaks you imagine — or leave blank and we'll build it from your world, characters, and hook.</p>
          <textarea
            className="seed-textarea"
            value={state.plotSeedValue}
            onChange={e => setState(s => ({ ...s, plotSeedValue: e.target.value }))}
            placeholder="e.g., 'Fast-paced with a major reversal at the midpoint, protagonist must choose between family loyalty and survival, bitter ending where they lose everything they tried to save...'"
            rows={4}
          />
          <button type="button" className="btn-primary" onClick={startClarification} disabled={state.loading}>
            {state.plotSeedValue.trim() ? "Start with this vision" : "Start fresh — build from what we have"}
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
            <span>{state.readinessPct}% — {state.readinessNote || "Shaping the plot..."}</span>
          </div>

          {state.plotFocus && (
            <div className="character-focus-tag">
              Focusing on: <strong>{state.plotFocus}</strong>
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
                placeholder="Or describe your plot vision..."
                rows={2}
              />
            )}
          </div>

          {/* Assumptions */}
          {state.assumptions.length > 0 && (
            <div className="assumptions-section">
              <h4>Plot assumptions — shape these:</h4>
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

          {/* Prompt preview for clarifier */}
          {promptPreview?.stage === "clarifier" && (
            <PromptEditor stage="clarifier" systemPrompt={promptPreview.system} userPrompt={promptPreview.user} loading={state.loading} onOverridesChange={setPromptOverrides} />
          )}
          {!promptPreview && (
            <button type="button" className="prompt-toggle" onClick={() => void loadPromptPreview("clarifier")}>View clarifier prompt</button>
          )}
          {state.readyForPlot && (
            <>
              {promptPreview?.stage === "builder" && (
                <PromptEditor stage="builder" systemPrompt={promptPreview.system} userPrompt={promptPreview.user} loading={state.loading} onOverridesChange={setBuilderPromptOverrides} />
              )}
              {promptPreview?.stage !== "builder" && (
                <button type="button" className="prompt-toggle" onClick={() => void loadPromptPreview("builder")}>View builder prompt</button>
              )}
            </>
          )}

          <div className="action-row">
            <button type="button" className="btn-primary" onClick={submitTurn}
              disabled={!state.selectedOptionId && !state.freeTextValue.trim()}>
              Continue
            </button>
            {state.readyForPlot && (
              <button type="button" className="btn-accent" onClick={generatePlot}>
                Generate Plot
              </button>
            )}
          </div>
        </div>
      )}

      {/* ─── Phase: Generating ─── */}
      {state.phase === "generating" && (
        <div className="generating-phase">
          <p>Building your plot — tension chain, turning points, climax, mysteries...</p>
        </div>
      )}

      {/* ─── Phase: Revealed ─── */}
      {state.phase === "revealed" && state.revealedPlot && (
        <div className="revealed-phase">
          <h3>Plot Blueprint</h3>

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
                  </div>
                ))}
              </div>
            </details>
          )}

          {/* Judge Weaknesses */}
          {state.weaknesses.length > 0 && (
            <details className="dev-targets-panel weaknesses-panel">
              <summary className="dev-targets-summary">
                Plot Weaknesses — {state.weaknesses.length} areas for downstream development
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

          {/* Core Conflict */}
          <div className="plot-section">
            <h4>Core Conflict</h4>
            <p>{state.revealedPlot.core_conflict}</p>
          </div>

          {/* Tension Chain */}
          <div className="plot-section">
            <h4>Tension Chain — {state.revealedPlot.tension_chain.length} beats</h4>
            {renderTensionChain()}
          </div>

          {/* Climax */}
          <div className="plot-section">
            <h4>Climax</h4>
            <div className="climax-card">
              <p><strong>What happens:</strong> {state.revealedPlot.climax.beat}</p>
              <p><strong>Why now:</strong> {state.revealedPlot.climax.why_now}</p>
              <p><strong>Collision:</strong> {state.revealedPlot.climax.core_conflict_collision}</p>
            </div>
          </div>

          {/* Resolution */}
          <div className="plot-section">
            <h4>Resolution</h4>
            <div className="resolution-card">
              <p><strong>New normal:</strong> {state.revealedPlot.resolution.new_normal}</p>
              <p><strong>Emotional landing:</strong> {state.revealedPlot.resolution.emotional_landing}</p>
              <p><strong>Ending energy:</strong>
                <span className="ending-energy-chip">{state.revealedPlot.resolution.ending_energy}</span>
              </p>
            </div>
          </div>

          {/* Theme Cluster */}
          <div className="plot-section">
            <h4>Theme — {state.revealedPlot.theme_cluster.topic}</h4>
            <div className="theme-card">
              <p><strong>Question:</strong> {state.revealedPlot.theme_cluster.question}</p>
              <p><strong>Statement:</strong> {state.revealedPlot.theme_cluster.statement}</p>
              <p><strong>Counter-theme:</strong> {state.revealedPlot.theme_cluster.countertheme}</p>
              <p><strong>Inferred from:</strong> {state.revealedPlot.theme_cluster.inferred_from}</p>
            </div>
          </div>

          {/* Dramatic Irony Points */}
          {state.revealedPlot.dramatic_irony_points.length > 0 && (
            <div className="plot-section">
              <h4>Dramatic Irony — {state.revealedPlot.dramatic_irony_points.length} points</h4>
              {state.revealedPlot.dramatic_irony_points.map((irony, i) => (
                <div key={i} className="irony-card">
                  <p><strong>Reader knows:</strong> {irony.reader_knows}</p>
                  <p><strong>Character believes:</strong> {irony.character_believes}</p>
                  <p><strong>Tension created:</strong> {irony.tension_created}</p>
                </div>
              ))}
            </div>
          )}

          {/* Mystery Hooks */}
          {state.revealedPlot.mystery_hooks.length > 0 && (
            <div className="plot-section">
              <h4>Mystery Hooks — {state.revealedPlot.mystery_hooks.length} questions</h4>
              {state.revealedPlot.mystery_hooks.map((hook, i) => (
                <div key={i} className="mystery-hook-card">
                  <p><strong>Question:</strong> {hook.question}</p>
                  <p><strong>Planted at:</strong> Beat {hook.planted_at_beat}</p>
                  {hook.payoff_beat && <p><strong>Paid off at:</strong> Beat {hook.payoff_beat}</p>}
                  <p><strong>Sustains through:</strong> {hook.sustains_through}</p>
                </div>
              ))}
            </div>
          )}

          {/* Motifs */}
          {state.revealedPlot.motifs.length > 0 && (
            <div className="plot-section">
              <h4>Motifs — {state.revealedPlot.motifs.length} recurring elements</h4>
              {state.revealedPlot.motifs.map((motif, i) => (
                <div key={i} className="motif-card">
                  <p><strong>{motif.name}</strong></p>
                  <p><strong>First appears:</strong> {motif.first_appearance}</p>
                  <p><strong>Recurrences:</strong> {motif.recurrences}</p>
                  <p><strong>Thematic function:</strong> {motif.thematic_function}</p>
                </div>
              ))}
            </div>
          )}

          {/* Addiction Engine */}
          <div className="plot-section">
            <h4>Addiction Engine</h4>
            <p className="addiction-engine-text">{state.revealedPlot.addiction_engine}</p>
          </div>

          {/* Collision Sources */}
          {state.revealedPlot.collision_sources.length > 0 && (
            <details className="dev-targets-panel">
              <summary className="dev-targets-summary">
                Collision Sources — {state.revealedPlot.collision_sources.length} upstream elements
              </summary>
              <div className="dev-targets-list">
                {state.revealedPlot.collision_sources.map((source, i) => (
                  <div key={i} className="dev-target-card">
                    <div className="dev-target-header">
                      <span className="dev-target-source">{source.source}</span>
                    </div>
                    <p className="dev-target-text"><strong>Element:</strong> {source.element_extracted}</p>
                    <p className="dev-target-notes"><strong>Applied to:</strong> {source.applied_to}</p>
                  </div>
                ))}
              </div>
            </details>
          )}

          <div className="action-row">
            <button type="button" className="btn-accent" onClick={lockPlot} disabled={state.loading}>
              Lock Plot
            </button>
            <button type="button" className="btn-ghost" onClick={rerollPlot} disabled={state.loading}>
              Regenerate Plot
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
              <label htmlFor="plot-constraint-overrides">
                <strong>Constraint Overrides</strong>
                <span className="hint"> (one per line: key: value)</span>
              </label>
              <textarea
                id="plot-constraint-overrides"
                rows={4}
                placeholder={"pacing.preference: slow burn\ntwist.midpoint_reversal: betrayal by ally\nstakes.ceiling: civilization-ending\nending.energy: bittersweet"}
                value={constraintOverridesText}
                onChange={(e) => setConstraintOverridesText(e.target.value)}
              />
              <p className="hint">
                Override or add constraint ledger entries before regenerating. Use scoped keys like: pacing.preference, twist.midpoint_reversal, stakes.ceiling, ending.energy.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ─── Phase: Locked ─── */}
      {state.phase === "locked" && (
        <div className="locked-phase">
          <h3>Plot Locked!</h3>
          {lockedPack && <PackPreview pack={lockedPack} defaultExpanded />}
          <p>Your plot&apos;s tension chain, turning points, climax, and mysteries have been saved. These will drive all downstream generation.</p>
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
        module="plot"
        projectId={projectId}
        fetchInsights={fetchInsights}
        visible={showInsights}
        onClose={() => setShowInsights(false)}
      />
    </div>
  );
}
