import React, { useEffect, useMemo, useRef, useState } from "react";
import { sceneApi } from "../lib/sceneApi";
import { PsychologyOverlay } from "./PsychologyOverlay";
import { ModelSelector } from "./ModelSelector";
import type {
  SceneClarifierResponse,
  ScenePlan,
  NarrativePreview,
  BuiltScene,
  FinalJudgeOutput,
  SceneDivergenceOutput,
} from "../../shared/types/scene";

type Phase =
  | "connect"        // select upstream plot session
  | "planning"       // planner running
  | "plan_clarify"   // user refining plan
  | "plan_confirmed" // plan locked, beginning scene-by-scene
  | "scene_clarify"  // per-scene steering
  | "building"       // scene being built (loading)
  | "reviewing"      // all scenes built, user reading
  | "final_judging"  // final judge running
  | "complete";      // done

interface WorkshopState {
  phase: Phase;
  // planning
  narrativePreview: NarrativePreview | null;
  scenePlan: ScenePlan[] | null;
  planClarifier: SceneClarifierResponse | null;
  planTurnNumber: number;
  planConfirmed: boolean;
  // per-scene clarify
  sceneClarifier: SceneClarifierResponse | null;
  currentSceneId: string;
  sceneIndex: number;
  totalScenes: number;
  autoPassApplied: boolean;
  // building
  builtScenes: BuiltScene[];
  // final judge
  finalJudge: FinalJudgeOutput | null;
  // shared
  freeTextValue: string;
  selectedOptionId: string | null;
  selectedOptionLabel: string | null;
  assumptionResponses: Record<string, { action: "keep" | "alternative" | "freeform"; value: string }>;
  loading: boolean;
  loadingMessage: string;
  error: string | null;
}

const initialState: WorkshopState = {
  phase: "connect",
  narrativePreview: null,
  scenePlan: null,
  planClarifier: null,
  planTurnNumber: 0,
  planConfirmed: false,
  sceneClarifier: null,
  currentSceneId: "",
  sceneIndex: 0,
  totalScenes: 0,
  autoPassApplied: false,
  builtScenes: [],
  finalJudge: null,
  freeTextValue: "",
  selectedOptionId: null,
  selectedOptionLabel: null,
  assumptionResponses: {},
  loading: false,
  loadingMessage: "",
  error: null,
};

const SCENE_SESSION_KEY = "sceneWorkshop_projectId";
const SCENE_PLOT_ID_KEY = "sceneWorkshop_plotProjectId";

// Upstream module localStorage keys
const PLOT_SESSION_KEY = "plotWorkshop_projectId";

function makeProjectId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `scene-${crypto.randomUUID()}`;
  }
  return `scene-${Date.now()}`;
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

interface PlotSessionInfo {
  projectId: string;
  status: string;
  turnCount: number;
}

export function SceneWorkshop() {
  const [projectId, setProjectId] = useState(() => loadSaved(SCENE_SESSION_KEY) ?? makeProjectId());
  const [plotProjectId, setPlotProjectId] = useState(() => loadSaved(SCENE_PLOT_ID_KEY) ?? loadSaved(PLOT_SESSION_KEY) ?? "");
  const [selectedPlotId, setSelectedPlotId] = useState(() => loadSaved(SCENE_PLOT_ID_KEY) ?? loadSaved(PLOT_SESSION_KEY) ?? "");
  const [upstreamValidated, setUpstreamValidated] = useState(false);
  const [showManualInput, setShowManualInput] = useState(false);

  const [state, setState] = useState<WorkshopState>(initialState);
  // Ref to track latest builtScenes — avoids stale closure in async buildCurrentScene
  const builtScenesRef = useRef(state.builtScenes);
  useEffect(() => { builtScenesRef.current = state.builtScenes; }, [state.builtScenes]);
  const [showPsych, setShowPsych] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const fetchPsych = useMemo(() => () => sceneApi.debugPsychology(projectId), [projectId]);

  // ─── Recovery check ───
  const [recoveryChecked, setRecoveryChecked] = useState(false);

  React.useEffect(() => {
    const savedId = loadSaved(SCENE_SESSION_KEY);
    if (savedId) {
      sceneApi.getSession(savedId).then((session) => {
        if (session) {
          setProjectId(session.projectId);
          setPlotProjectId(session.plotProjectId);
          saveTo(SCENE_PLOT_ID_KEY, session.plotProjectId);
          setUpstreamValidated(true);

          if (session.status === "complete") {
            setState(prev => ({
              ...prev,
              phase: "complete",
              builtScenes: session.builtScenes,
              finalJudge: session.finalJudge ?? null,
              narrativePreview: session.narrativePreview ?? null,
              scenePlan: session.scenePlan ?? null,
            }));
          } else if (session.status === "reviewing" || session.status === "final_judging") {
            setState(prev => ({
              ...prev,
              phase: "reviewing",
              builtScenes: session.builtScenes,
              narrativePreview: session.narrativePreview ?? null,
              scenePlan: session.scenePlan ?? null,
              totalScenes: session.scenePlan?.length ?? 0,
              finalJudge: session.finalJudge ?? null,
            }));
          } else if (session.status === "writing") {
            const lastWritingTurn = session.writingTurns.length > 0
              ? session.writingTurns[session.writingTurns.length - 1]
              : null;
            setState(prev => ({
              ...prev,
              phase: "scene_clarify",
              sceneClarifier: lastWritingTurn?.clarifierResponse ?? null,
              currentSceneId: session.scenePlan?.[session.currentSceneIndex]?.scene_id ?? "",
              sceneIndex: session.currentSceneIndex,
              totalScenes: session.scenePlan?.length ?? 0,
              builtScenes: session.builtScenes,
              narrativePreview: session.narrativePreview ?? null,
              scenePlan: session.scenePlan ?? null,
              planConfirmed: true,
            }));
          } else if (session.status === "plan_confirmed") {
            setState(prev => ({
              ...prev,
              phase: "plan_confirmed",
              narrativePreview: session.narrativePreview ?? null,
              scenePlan: session.scenePlan ?? null,
              totalScenes: session.scenePlan?.length ?? 0,
              planConfirmed: true,
            }));
          } else if (session.status === "planning" || session.status === "plan_clarifying") {
            const lastPlanTurn = session.planningTurns.length > 0
              ? session.planningTurns[session.planningTurns.length - 1]
              : null;
            setState(prev => ({
              ...prev,
              phase: "plan_clarify",
              narrativePreview: session.narrativePreview ?? null,
              scenePlan: session.scenePlan ?? null,
              planClarifier: lastPlanTurn?.clarifierResponse ?? null,
              planTurnNumber: session.planningTurns.length,
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
    if (!selectedPlotId) {
      setState(s => ({ ...s, error: "Please enter a Plot project ID or select one." }));
      return;
    }
    setState(s => ({ ...s, loading: true, loadingMessage: "Checking plot module...", error: null }));
    try {
      const plotSession = await sceneApi.getPlotSession(selectedPlotId);
      if (!plotSession) throw new Error("Plot session not found");

      setPlotProjectId(selectedPlotId);
      saveTo(SCENE_PLOT_ID_KEY, selectedPlotId);
      setUpstreamValidated(true);
      setState(s => ({ ...s, loading: false, phase: "connect" }));
    } catch (err: any) {
      setState(s => ({
        ...s,
        loading: false,
        error: `Plot validation failed: ${err.message}. Complete and lock the Plot module first.`,
      }));
    }
  };

  const startPlanning = async () => {
    setState(s => ({ ...s, loading: true, loadingMessage: "Planning scenes...", error: null, phase: "planning" }));
    try {
      const newId = makeProjectId();
      setProjectId(newId);
      saveTo(SCENE_SESSION_KEY, newId);

      const result = await sceneApi.plan({
        projectId: newId,
        plotProjectId,
      });

      setState(s => ({
        ...s,
        phase: "plan_clarify",
        narrativePreview: result.planner.narrative_preview,
        scenePlan: result.planner.scenes,
        planClarifier: result.clarifier,
        planTurnNumber: result.turnNumber,
        loading: false,
      }));
    } catch (err: any) {
      setState(s => ({ ...s, loading: false, error: err.message, phase: "connect" }));
    }
  };

  const submitPlanTurn = async () => {
    const hasSelection = !!state.selectedOptionId || !!state.freeTextValue.trim();
    const hasAssumptions = Object.keys(state.assumptionResponses).length > 0;
    if (!hasSelection && !hasAssumptions) return;

    const userSelection = state.freeTextValue.trim()
      ? { type: "free_text" as const, label: state.freeTextValue.trim() }
      : state.selectedOptionId
        ? { type: "option" as const, optionId: state.selectedOptionId!, label: state.selectedOptionLabel! }
        : { type: "confirm" as const, label: "(assumptions only)" };

    const assumptionResponses: Array<{ assumptionId: string; action: string; originalValue: string; newValue: string }> = [];
    for (const [id, resp] of Object.entries(state.assumptionResponses)) {
      const assumption = state.planClarifier?.assumptions?.find(a => a.id === id);
      if (!assumption) continue;
      assumptionResponses.push({
        assumptionId: id,
        action: resp.action,
        originalValue: assumption.assumption,
        newValue: resp.value,
      });
    }

    setState(s => ({ ...s, loading: true, loadingMessage: "Refining plan...", error: null }));
    try {
      const result = await sceneApi.planClarify({
        projectId,
        userSelection,
        assumptionResponses: assumptionResponses.length > 0 ? assumptionResponses : undefined,
      });

      if (result.planConfirmed) {
        setState(s => ({
          ...s,
          phase: "plan_confirmed",
          planConfirmed: true,
          loading: false,
        }));
      } else {
        setState(s => ({
          ...s,
          planClarifier: result.clarifier,
          planTurnNumber: result.turnNumber,
          loading: false,
          selectedOptionId: null,
          selectedOptionLabel: null,
          freeTextValue: "",
          assumptionResponses: {},
        }));
      }
    } catch (err: any) {
      setState(s => ({ ...s, loading: false, error: err.message }));
    }
  };

  const confirmPlan = async () => {
    setState(s => ({ ...s, loading: true, loadingMessage: "Confirming plan...", error: null }));
    try {
      const result = await sceneApi.confirmPlan(projectId);
      setState(s => ({
        ...s,
        phase: "plan_confirmed",
        planConfirmed: true,
        totalScenes: result.totalScenes,
        loading: false,
      }));
    } catch (err: any) {
      setState(s => ({ ...s, loading: false, error: err.message }));
    }
  };

  /**
   * Process a clarify response that may include an auto-built scene.
   * Returns the updated builtScenes array and whether all scenes are done.
   */
  const processClarifyAutoBuild = (result: any, currentBuiltScenes: BuiltScene[]) => {
    if (result.autoBuiltScene) {
      const updatedScenes = [...currentBuiltScenes, result.autoBuiltScene];
      return { updatedScenes, allDone: result.allScenesBuilt ?? false };
    }
    return { updatedScenes: currentBuiltScenes, allDone: false };
  };

  const startSceneClarify = async () => {
    setState(s => ({ ...s, loading: true, loadingMessage: "Preparing first scene...", error: null }));
    try {
      const result = await sceneApi.clarify({ projectId });
      const { updatedScenes, allDone } = processClarifyAutoBuild(result, state.builtScenes);

      if (allDone) {
        setState(s => ({
          ...s,
          phase: "reviewing",
          builtScenes: updatedScenes,
          loading: false,
        }));
        return;
      }

      if (result.autoBuiltScene) {
        // Scene was auto-built — move to next scene's clarifier
        setState(s => ({ ...s, builtScenes: updatedScenes, loadingMessage: "Preparing next scene..." }));
        const nextResult = await sceneApi.clarify({ projectId });
        setState(s => ({
          ...s,
          phase: "scene_clarify",
          sceneClarifier: nextResult.clarifier,
          currentSceneId: nextResult.sceneId,
          sceneIndex: nextResult.sceneIndex,
          totalScenes: nextResult.totalScenes,
          autoPassApplied: nextResult.autoPassApplied,
          loading: false,
          selectedOptionId: null,
          selectedOptionLabel: null,
          freeTextValue: "",
          assumptionResponses: {},
        }));
        return;
      }

      setState(s => ({
        ...s,
        phase: "scene_clarify",
        sceneClarifier: result.clarifier,
        currentSceneId: result.sceneId,
        sceneIndex: result.sceneIndex,
        totalScenes: result.totalScenes,
        autoPassApplied: result.autoPassApplied,
        loading: false,
        selectedOptionId: null,
        selectedOptionLabel: null,
        freeTextValue: "",
        assumptionResponses: {},
      }));
    } catch (err: any) {
      setState(s => ({ ...s, loading: false, error: err.message }));
    }
  };

  const submitSceneTurn = async () => {
    const hasSelection = !!state.selectedOptionId || !!state.freeTextValue.trim();
    const hasAssumptions = Object.keys(state.assumptionResponses).length > 0;
    if (!hasSelection && !hasAssumptions) return;

    const userSelection = state.freeTextValue.trim()
      ? { type: "free_text" as const, label: state.freeTextValue.trim() }
      : state.selectedOptionId
        ? { type: "option" as const, optionId: state.selectedOptionId!, label: state.selectedOptionLabel! }
        : { type: "confirm" as const, label: "(assumptions only)" };

    const assumptionResponses: Array<{ assumptionId: string; action: string; originalValue: string; newValue: string }> = [];
    for (const [id, resp] of Object.entries(state.assumptionResponses)) {
      const assumption = state.sceneClarifier?.assumptions?.find(a => a.id === id);
      if (!assumption) continue;
      assumptionResponses.push({
        assumptionId: id,
        action: resp.action,
        originalValue: assumption.assumption,
        newValue: resp.value,
      });
    }

    setState(s => ({ ...s, loading: true, loadingMessage: "Processing...", error: null }));
    try {
      const result = await sceneApi.clarify({
        projectId,
        userSelection,
        assumptionResponses: assumptionResponses.length > 0 ? assumptionResponses : undefined,
      });

      const { updatedScenes, allDone } = processClarifyAutoBuild(result, state.builtScenes);

      if (allDone) {
        setState(s => ({
          ...s,
          phase: "reviewing",
          builtScenes: updatedScenes,
          loading: false,
        }));
        return;
      }

      if (result.autoBuiltScene) {
        // Scene was auto-built — move to next scene's clarifier
        setState(s => ({ ...s, builtScenes: updatedScenes, loadingMessage: "Preparing next scene..." }));
        const nextResult = await sceneApi.clarify({ projectId });
        setState(s => ({
          ...s,
          phase: "scene_clarify",
          sceneClarifier: nextResult.clarifier,
          currentSceneId: nextResult.sceneId,
          sceneIndex: nextResult.sceneIndex,
          totalScenes: nextResult.totalScenes,
          autoPassApplied: nextResult.autoPassApplied,
          loading: false,
          selectedOptionId: null,
          selectedOptionLabel: null,
          freeTextValue: "",
          assumptionResponses: {},
        }));
        return;
      }

      setState(s => ({
        ...s,
        sceneClarifier: result.clarifier,
        currentSceneId: result.sceneId,
        sceneIndex: result.sceneIndex,
        totalScenes: result.totalScenes,
        autoPassApplied: result.autoPassApplied,
        loading: false,
        selectedOptionId: null,
        selectedOptionLabel: null,
        freeTextValue: "",
        assumptionResponses: {},
      }));
    } catch (err: any) {
      setState(s => ({ ...s, loading: false, error: err.message }));
    }
  };

  const buildCurrentScene = async () => {
    setState(s => ({
      ...s,
      phase: "building",
      loading: true,
      loadingMessage: `Writing scene ${state.sceneIndex + 1} of ${state.totalScenes}...`,
      error: null,
    }));
    try {
      const result = await sceneApi.build(projectId);
      const updatedScenes = [...builtScenesRef.current, result.scene];

      // Check if all scenes are built
      if (result.sceneIndex + 1 >= result.totalScenes) {
        setState(s => ({
          ...s,
          phase: "reviewing",
          builtScenes: updatedScenes,
          loading: false,
        }));
      } else {
        // Move to next scene clarify
        setState(s => ({
          ...s,
          builtScenes: updatedScenes,
          loading: true,
          loadingMessage: "Preparing next scene...",
        }));

        const clarifyResult = await sceneApi.clarify({ projectId });
        const { updatedScenes: scenesAfterAutoBuild, allDone } = processClarifyAutoBuild(clarifyResult, updatedScenes);

        if (allDone) {
          setState(s => ({
            ...s,
            phase: "reviewing",
            builtScenes: scenesAfterAutoBuild,
            loading: false,
          }));
          return;
        }

        if (clarifyResult.autoBuiltScene) {
          // Next scene was auto-built too — chain to the one after
          setState(s => ({ ...s, builtScenes: scenesAfterAutoBuild, loadingMessage: "Preparing next scene..." }));
          const nextClarify = await sceneApi.clarify({ projectId });
          setState(s => ({
            ...s,
            phase: "scene_clarify",
            sceneClarifier: nextClarify.clarifier,
            currentSceneId: nextClarify.sceneId,
            sceneIndex: nextClarify.sceneIndex,
            totalScenes: nextClarify.totalScenes,
            autoPassApplied: nextClarify.autoPassApplied,
            loading: false,
            selectedOptionId: null,
            selectedOptionLabel: null,
            freeTextValue: "",
            assumptionResponses: {},
          }));
          return;
        }

        setState(s => ({
          ...s,
          phase: "scene_clarify",
          sceneClarifier: clarifyResult.clarifier,
          currentSceneId: clarifyResult.sceneId,
          sceneIndex: clarifyResult.sceneIndex,
          totalScenes: clarifyResult.totalScenes,
          autoPassApplied: clarifyResult.autoPassApplied,
          loading: false,
          selectedOptionId: null,
          selectedOptionLabel: null,
          freeTextValue: "",
          assumptionResponses: {},
        }));
      }
    } catch (err: any) {
      setState(s => ({ ...s, phase: "scene_clarify", loading: false, error: err.message }));
    }
  };

  // ─── Auto-build after auto-pass (fallback for cases without server-side auto-build) ───
  const autoPassRef = React.useRef(false);
  React.useEffect(() => {
    if (state.phase === "scene_clarify" && state.autoPassApplied && !state.loading && !autoPassRef.current) {
      autoPassRef.current = true;
      buildCurrentScene();
    }
    if (state.phase !== "scene_clarify") {
      autoPassRef.current = false;
    }
  });

  const runFinalJudge = async () => {
    setState(s => ({ ...s, phase: "final_judging", loading: true, loadingMessage: "Running final assessment...", error: null }));
    try {
      const result = await sceneApi.finalJudge(projectId);
      setState(s => ({
        ...s,
        phase: "reviewing",
        finalJudge: result.judge,
        loading: false,
      }));
    } catch (err: any) {
      setState(s => ({ ...s, phase: "reviewing", loading: false, error: err.message }));
    }
  };

  const completeScene = async () => {
    setState(s => ({ ...s, loading: true, loadingMessage: "Completing...", error: null }));
    try {
      await sceneApi.complete(projectId);
      setState(s => ({ ...s, phase: "complete", loading: false }));
    } catch (err: any) {
      setState(s => ({ ...s, loading: false, error: err.message }));
    }
  };

  const resetAll = async () => {
    try { await sceneApi.reset(projectId); } catch {}
    clearSaved(SCENE_SESSION_KEY);
    clearSaved(SCENE_PLOT_ID_KEY);
    const newId = makeProjectId();
    setProjectId(newId);
    setPlotProjectId(loadSaved(PLOT_SESSION_KEY) ?? "");
    setSelectedPlotId(loadSaved(PLOT_SESSION_KEY) ?? "");
    setUpstreamValidated(false);
    setShowManualInput(false);
    setState(initialState);
  };

  // ─── Render helpers ───

  const selectOption = (opt: { id: string; label: string }) => {
    setState(s => ({
      ...s,
      selectedOptionId: opt.id,
      selectedOptionLabel: opt.label,
      freeTextValue: "",
    }));
  };

  const setAssumptionAction = (id: string, action: "keep" | "alternative" | "freeform", value: string) => {
    setState(s => ({
      ...s,
      assumptionResponses: { ...s.assumptionResponses, [id]: { action, value } },
    }));
  };

  const renderClarifierUI = (
    clarifier: SceneClarifierResponse | null,
    onSubmit: () => void,
    submitLabel: string,
  ) => {
    if (!clarifier) return null;

    return (
      <div className="clarifier-section">
        {clarifier.scene_summary && (
          <div className="scene-summary-card">
            <p>{clarifier.scene_summary}</p>
          </div>
        )}

        {clarifier.needs_input && clarifier.question && (
          <>
            <p className="clarifier-question">{clarifier.question}</p>

            {clarifier.options && clarifier.options.length > 0 && (
              <div className="options-row">
                {clarifier.options.map((opt) => (
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
            )}

            {clarifier.allow_free_text && (
              <textarea
                className="free-text-input"
                rows={3}
                placeholder="Or type your own direction..."
                value={state.freeTextValue}
                onChange={(e) => setState(s => ({ ...s, freeTextValue: e.target.value, selectedOptionId: null, selectedOptionLabel: null }))}
              />
            )}

            {clarifier.assumptions && clarifier.assumptions.length > 0 && (
              <div className="assumptions-section">
                <h4>Assumptions</h4>
                {clarifier.assumptions.map((a) => (
                  <div key={a.id} className="assumption-card">
                    <p className="assumption-text">{a.assumption}</p>
                    <div className="assumption-actions">
                      <button
                        type="button"
                        className={`chip-sm ${state.assumptionResponses[a.id]?.action === "keep" ? "chip-selected" : ""}`}
                        onClick={() => setAssumptionAction(a.id, "keep", a.assumption)}
                      >
                        Keep
                      </button>
                      {a.alternatives.map((alt, i) => (
                        <button
                          key={i}
                          type="button"
                          className={`chip-sm ${
                            state.assumptionResponses[a.id]?.action === "alternative" &&
                            state.assumptionResponses[a.id]?.value === alt
                              ? "chip-selected" : ""
                          }`}
                          onClick={() => setAssumptionAction(a.id, "alternative", alt)}
                        >
                          {alt}
                        </button>
                      ))}
                    </div>
                    <input
                      type="text"
                      className="assumption-freeform"
                      placeholder="Or type your own..."
                      value={state.assumptionResponses[a.id]?.action === "freeform" ? state.assumptionResponses[a.id]?.value : ""}
                      onChange={(e) => setAssumptionAction(a.id, "freeform", e.target.value)}
                    />
                  </div>
                ))}
              </div>
            )}

            <div className="clarifier-submit">
              <button
                type="button"
                className="btn-primary"
                onClick={onSubmit}
                disabled={state.loading || (!state.selectedOptionId && !state.freeTextValue.trim() && Object.keys(state.assumptionResponses).length === 0)}
              >
                {submitLabel}
              </button>
            </div>
          </>
        )}

        {!clarifier.needs_input && (
          <div className="auto-pass-notice">
            <p>High confidence ({Math.round(clarifier.auto_pass_confidence * 100)}%) — auto-passing this scene.</p>
          </div>
        )}
      </div>
    );
  };

  const renderNarrativePreview = () => {
    if (!state.narrativePreview) return null;
    return (
      <div className="narrative-preview">
        <h4>Story Preview</h4>
        <div className="trailer-text">
          {state.narrativePreview.trailer_text.split("\n").map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
        <div className="preview-stats">
          <span>~{state.narrativePreview.estimated_scene_count} scenes</span>
          <span>~{state.narrativePreview.estimated_reading_time} min read</span>
        </div>
      </div>
    );
  };

  const renderScenePlanOverview = () => {
    if (!state.scenePlan) return null;
    return (
      <div className="scene-plan-overview">
        <h4>Scene Plan ({state.scenePlan.length} scenes)</h4>
        <div className="scene-plan-list">
          {state.scenePlan.map((scene, i) => {
            const isBuilt = state.builtScenes.some(b => b.scene_id === scene.scene_id);
            const isCurrent = scene.scene_id === state.currentSceneId;
            return (
              <div
                key={scene.scene_id}
                className={`scene-plan-item ${isBuilt ? "scene-built" : ""} ${isCurrent ? "scene-current" : ""}`}
              >
                <span className="scene-number">{i + 1}</span>
                <div className="scene-plan-details">
                  <strong>{scene.title}</strong>
                  <span className="scene-pacing">{scene.pacing_type}</span>
                </div>
                {isBuilt && <span className="scene-check">&#10003;</span>}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderBuiltScenes = () => {
    if (state.builtScenes.length === 0) return null;
    return (
      <div className="built-scenes">
        <h4>Written Scenes</h4>
        {state.builtScenes.map((scene, i) => (
          <div key={scene.scene_id} className="built-scene-card">
            <div className="built-scene-header">
              <h5>Scene {i + 1}: {scene.builder_output.readable.title}</h5>
              {scene.minor_judge && (
                <span className={`judge-badge ${scene.minor_judge.pass ? "judge-pass" : "judge-fail"}`}>
                  {scene.minor_judge.pass ? "Passed" : "Needs Fix"}
                </span>
              )}
            </div>
            <div className="screenplay-text">
              {scene.builder_output.readable.screenplay_text.split("\n").map((line, j) => (
                <p key={j} className={line.startsWith("  ") ? "dialogue-line" : "direction-line"}>{line}</p>
              ))}
            </div>
            <div className="scene-word-count">
              {scene.builder_output.readable.word_count} words
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderFinalJudge = () => {
    if (!state.finalJudge) return null;
    const j = state.finalJudge;
    return (
      <div className="final-judge-panel">
        <h4>Final Assessment</h4>
        <div className={`judge-overall ${j.pass ? "judge-pass" : "judge-fail"}`}>
          {j.pass ? "PASSED" : "NEEDS REVISION"}
        </div>
        <div className="judge-scores">
          {Object.entries(j.scores).map(([key, val]) => (
            <div key={key} className="score-row">
              <span className="score-label">{key.replace(/_/g, " ")}</span>
              <div className="score-bar">
                <div className="score-fill" style={{ width: `${(val as number) * 10}%` }} />
                <span className="score-value">{val as number}/10</span>
              </div>
            </div>
          ))}
        </div>
        {j.flagged_scenes.length > 0 && (
          <div className="flagged-scenes">
            <h5>Flagged Scenes</h5>
            {j.flagged_scenes.map((f, i) => (
              <div key={i} className={`flag-item flag-${f.severity}`}>
                <span className="flag-scene">{f.scene_id}</span>
                <span className="flag-issue">{f.issue}</span>
                <span className="flag-severity">{f.severity}</span>
              </div>
            ))}
          </div>
        )}
        <p className="judge-note">{j.overall_note}</p>
      </div>
    );
  };

  // ─── Main Render ───

  if (!recoveryChecked) {
    return <div className="workshop"><p className="loading-text">Loading...</p></div>;
  }

  return (
    <div className="workshop scene-workshop">
      <ModelSelector />

      <div className="workshop-header">
        <h2>Scenes</h2>
        <div className="header-actions">
          {state.phase !== "connect" && state.phase !== "complete" && (
            <button type="button" className="btn-ghost btn-sm" onClick={resetAll}>Start Over</button>
          )}
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={() => setShowPsych(p => !p)}
          >
            {showPsych ? "Hide" : "Show"} Psychology
          </button>
        </div>
      </div>

      {state.error && (
        <div className="error-banner">
          <p>{state.error}</p>
          <button type="button" onClick={() => setState(s => ({ ...s, error: null }))}>Dismiss</button>
        </div>
      )}

      {state.loading && (
        <div className="loading-overlay">
          <div className="spinner" />
          <p>{state.loadingMessage}</p>
        </div>
      )}

      {/* ═══ CONNECT PHASE ═══ */}
      {state.phase === "connect" && !upstreamValidated && (
        <div className="connect-phase">
          <p>Connect to a locked Plot module to begin scene generation.</p>
          <div className="upstream-input">
            <label>Plot Project ID</label>
            <input
              type="text"
              value={selectedPlotId}
              onChange={e => setSelectedPlotId(e.target.value)}
              placeholder="plot-xxxxxxxx-..."
            />
          </div>
          <button
            type="button"
            className="btn-primary"
            onClick={validateUpstream}
            disabled={state.loading || !selectedPlotId}
          >
            Connect
          </button>
        </div>
      )}

      {state.phase === "connect" && upstreamValidated && (
        <div className="connect-phase">
          <div className="upstream-validated">
            <p>Connected to Plot: <code>{plotProjectId}</code></p>
          </div>
          <button
            type="button"
            className="btn-primary"
            onClick={startPlanning}
            disabled={state.loading}
          >
            Begin Scene Planning
          </button>
        </div>
      )}

      {/* ═══ PLANNING (loading) ═══ */}
      {state.phase === "planning" && (
        <div className="planning-phase">
          <p>Clustering beats into scenes and building narrative preview...</p>
        </div>
      )}

      {/* ═══ PLAN CLARIFY ═══ */}
      {state.phase === "plan_clarify" && (
        <div className="plan-clarify-phase">
          {renderNarrativePreview()}
          {renderScenePlanOverview()}

          <div className="plan-clarify-section">
            <h4>Plan Refinement (Turn {state.planTurnNumber})</h4>
            {renderClarifierUI(state.planClarifier, submitPlanTurn, "Refine Plan")}
          </div>

          <div className="plan-actions">
            <button
              type="button"
              className="btn-primary"
              onClick={confirmPlan}
              disabled={state.loading}
            >
              Confirm Plan &amp; Start Writing
            </button>
          </div>
        </div>
      )}

      {/* ═══ PLAN CONFIRMED ═══ */}
      {state.phase === "plan_confirmed" && (
        <div className="plan-confirmed-phase">
          {renderNarrativePreview()}
          {renderScenePlanOverview()}
          <div className="plan-confirmed-actions">
            <p>Plan confirmed with {state.totalScenes || state.scenePlan?.length || "?"} scenes. Ready to begin writing.</p>
            <button
              type="button"
              className="btn-primary"
              onClick={startSceneClarify}
              disabled={state.loading}
            >
              Start Scene-by-Scene
            </button>
          </div>
        </div>
      )}

      {/* ═══ SCENE CLARIFY ═══ */}
      {state.phase === "scene_clarify" && (
        <div className="scene-clarify-phase">
          <div className="scene-progress">
            <span>Scene {state.sceneIndex + 1} of {state.totalScenes}</span>
            <span className="scene-id">{state.currentSceneId}</span>
            {state.autoPassApplied && <span className="auto-pass-badge">Auto-passed</span>}
          </div>

          {renderScenePlanOverview()}

          {state.autoPassApplied ? (
            <div className="auto-pass-section">
              <p>High confidence — auto-building this scene...</p>
            </div>
          ) : (
            <>
              {renderClarifierUI(state.sceneClarifier, submitSceneTurn, "Submit Steering")}
              <div className="scene-build-actions">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={buildCurrentScene}
                  disabled={state.loading}
                >
                  Looks Good — Build It
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ═══ BUILDING (loading) ═══ */}
      {state.phase === "building" && (
        <div className="building-phase">
          {renderScenePlanOverview()}
          <p>Writing scene {state.sceneIndex + 1}...</p>
        </div>
      )}

      {/* ═══ REVIEWING ═══ */}
      {state.phase === "reviewing" && (
        <div className="reviewing-phase">
          {renderNarrativePreview()}
          {renderBuiltScenes()}

          {state.finalJudge ? (
            <>
              {renderFinalJudge()}
              <div className="review-actions">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={completeScene}
                  disabled={state.loading}
                >
                  Complete &amp; Lock
                </button>
              </div>
            </>
          ) : (
            <div className="review-actions">
              <button
                type="button"
                className="btn-primary"
                onClick={runFinalJudge}
                disabled={state.loading}
              >
                Run Final Assessment
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={completeScene}
                disabled={state.loading}
              >
                Skip Assessment &amp; Complete
              </button>
            </div>
          )}
        </div>
      )}

      {/* ═══ FINAL JUDGING (loading) ═══ */}
      {state.phase === "final_judging" && (
        <div className="final-judging-phase">
          <p>Running intensive final assessment...</p>
        </div>
      )}

      {/* ═══ COMPLETE ═══ */}
      {state.phase === "complete" && (
        <div className="complete-phase">
          <div className="complete-banner">
            <h3>Scene Module Complete</h3>
            <p>All scenes have been written and the ScenePack is locked.</p>
          </div>
          {renderNarrativePreview()}
          {renderBuiltScenes()}
          {state.finalJudge && renderFinalJudge()}
          <button type="button" className="btn-ghost" onClick={resetAll}>
            Start New Scene Session
          </button>
        </div>
      )}

      {/* ═══ Psychology Overlay ═══ */}
      <PsychologyOverlay
        fetchPsychology={fetchPsych}
        projectId={projectId}
        visible={showPsych}
        onClose={() => setShowPsych(false)}
      />
    </div>
  );
}
