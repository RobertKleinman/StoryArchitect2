/**
 * PipelineWorkshop — unified v2 pipeline experience.
 * Single-page wizard with step indicator, SSE-driven progress, and automation.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { v2Api } from "../lib/v2Api";
import { useSSE } from "../lib/useSSE";
import { IntakeStep } from "./v2/IntakeStep";
import { ReviewStep } from "./v2/ReviewStep";
import { ProgressStep } from "./v2/ProgressStep";
import type { ProjectState, BatchProgress } from "../../shared/types/project";
import type { PremiseArtifact, ScenePlanArtifact } from "../../shared/types/artifacts";

const STORAGE_KEY = "v2-project-id";

const STEPS = [
  { key: "idea_gathering", label: "Intake" },
  { key: "premise_generating", label: "Generate Premise" },
  { key: "premise_review", label: "Review Premise" },
  { key: "bible_generating", label: "Build Bible" },
  { key: "scene_review", label: "Review Scenes" },
  { key: "scene_generating", label: "Write Scenes" },
  { key: "completed", label: "Complete" },
] as const;

function stepIndex(step: string): number {
  const idx = STEPS.findIndex(s => s.key === step);
  return idx >= 0 ? idx : -1;
}

export function PipelineWorkshop() {
  const [projectId, setProjectId] = useState<string | null>(
    () => localStorage.getItem(STORAGE_KEY),
  );
  const [project, setProject] = useState<ProjectState | null>(null);
  const [automating, setAutomating] = useState(false);
  const automatingRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const [completedScenes, setCompletedScenes] = useState<string[]>([]);
  const [selectedMode, setSelectedMode] = useState<"default" | "fast" | "erotica" | "erotica-fast" | "erotica-hybrid" | "haiku">("default");

  const { lastEvent, connected } = useSSE(projectId);

  // Sync automating ref
  useEffect(() => { automatingRef.current = automating; }, [automating]);

  // Fetch project state
  const refreshProject = useCallback(async () => {
    if (!projectId) return;
    try {
      const { project: p } = await v2Api.getProject(projectId);
      setProject(p);
      setError(null);
    } catch (e: any) {
      // Project might not exist anymore
      if (e.message?.includes("not found")) {
        localStorage.removeItem(STORAGE_KEY);
        setProjectId(null);
        setProject(null);
      } else {
        setError(e.message);
      }
    }
  }, [projectId]);

  // Load project on mount
  useEffect(() => {
    if (projectId) refreshProject();
  }, [projectId, refreshProject]);

  // Handle SSE events
  useEffect(() => {
    if (!lastEvent) return;

    switch (lastEvent.type) {
      case "step_complete":
        setProgress(null);
        setCompletedScenes([]);
        refreshProject();
        break;
      case "progress":
        setProgress(lastEvent.data);
        break;
      case "scene_complete":
        setCompletedScenes(prev =>
          prev.includes(lastEvent.data.scene_id) ? prev : [...prev, lastEvent.data.scene_id],
        );
        break;
      case "error":
        setError(lastEvent.data.message);
        setAutomating(false);
        refreshProject();
        break;
      case "aborted":
        setAutomating(false);
        refreshProject();
        break;
    }
  }, [lastEvent, refreshProject]);

  // Automation logic — reacts to project step changes
  useEffect(() => {
    if (!project || !automatingRef.current) return;

    const step = project.step;

    async function autoStep() {
      if (!projectId || !automatingRef.current) return;
      try {
        setLoading(true);
        if (step === "premise_review") {
          await v2Api.reviewPremise(projectId, { action: "approve" });
          // Bible generation starts automatically after approval in v2
          await v2Api.generateBible(projectId);
          await refreshProject();
        } else if (step === "scene_review") {
          await v2Api.reviewScenes(projectId, { action: "approve" });
          await v2Api.generateScenes(projectId);
          await refreshProject();
        }
      } catch (e: any) {
        setError(e.message);
        setAutomating(false);
      } finally {
        setLoading(false);
      }
    }

    if (step === "premise_review" || step === "scene_review") {
      autoStep();
    }
  }, [project?.step, projectId, refreshProject]);

  // ── Actions ──

  async function createProject() {
    setLoading(true);
    setError(null);
    try {
      const { projectId: id } = await v2Api.createProject({ mode: selectedMode });
      localStorage.setItem(STORAGE_KEY, id);
      setProjectId(id);
      const { project: p } = await v2Api.getProject(id);
      setProject(p);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleGeneratePremise() {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      await v2Api.generatePremise(projectId);
      await refreshProject();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleApprovePremise() {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      await v2Api.reviewPremise(projectId, { action: "approve" });
      await v2Api.generateBible(projectId);
      await refreshProject();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleRevisePremise(feedback: string) {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      await v2Api.reviewPremise(projectId, { action: "revise", changes: feedback });
      await refreshProject();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleApproveScenes() {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      await v2Api.reviewScenes(projectId, { action: "approve" });
      await v2Api.generateScenes(projectId);
      await refreshProject();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleReviseScenes(feedback: string) {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      await v2Api.reviewScenes(projectId, {
        action: "revise",
        feedback,
      });
      await refreshProject();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleAbort() {
    if (!projectId) return;
    setAutomating(false);
    try {
      await v2Api.abort(projectId);
      await refreshProject();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function handleRetry() {
    if (!projectId) return;
    setError(null);
    try {
      await v2Api.retry(projectId);
      await refreshProject();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function handleExport() {
    if (!projectId) return;
    try {
      const data = await v2Api.exportProject(projectId);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pipeline-export-${projectId}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e.message);
    }
  }

  function handleNewProject() {
    localStorage.removeItem(STORAGE_KEY);
    setProjectId(null);
    setProject(null);
    setAutomating(false);
    setProgress(null);
    setCompletedScenes([]);
    setError(null);
  }

  function startAutomation() {
    setAutomating(true);
  }

  // ── Render ──

  const step = project?.step ?? "none";
  const currentStepIdx = stepIndex(step);

  // No project yet
  if (!projectId || !project) {
    return (
      <div className="pipeline-shell">
        <div className="pipeline-welcome">
          <h1>Pipeline v2</h1>
          <p>Create a new project to start generating your visual novel.</p>
          <div className="mode-selector" style={{ margin: "1rem 0", display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <label style={{ fontWeight: 500 }}>Mode:</label>
            <select
              value={selectedMode}
              onChange={e => setSelectedMode(e.target.value as any)}
              style={{ padding: "0.4rem 0.8rem", borderRadius: "4px", border: "1px solid #444", background: "#1a1a2e", color: "#eee" }}
            >
              <option value="default">Default (Sonnet + Haiku)</option>
              <option value="fast">Fast (Gemini Flash - cheap)</option>
              <option value="erotica">Erotica (Grok 4 - uncensored)</option>
              <option value="erotica-fast">Erotica Fast (Grok 4.1 NR - cheap uncensored)</option>
              <option value="erotica-hybrid">Erotica Hybrid (Grok-4 plan + Fast scenes)</option>
              <option value="haiku">Haiku (cheapest)</option>
            </select>
          </div>
          <button className="primary-btn" onClick={createProject} disabled={loading}>
            {loading ? "Creating..." : "New Project"}
          </button>
          {error && <p className="error-text">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="pipeline-shell">
      {/* Mode badge */}
      {project.mode && project.mode !== "default" && (
        <div style={{ padding: "0.3rem 0.8rem", background: project.mode === "erotica" ? "#4a1942" : project.mode === "erotica-fast" ? "#3a1942" : project.mode === "erotica-hybrid" ? "#3a1942" : project.mode === "fast" ? "#1a3a1a" : "#1a2a3a", borderRadius: "4px", fontSize: "0.8rem", textAlign: "center", marginBottom: "0.5rem", color: "#ccc" }}>
          Mode: <strong>{project.mode}</strong>
        </div>
      )}
      {/* Step indicator sidebar */}
      <div className="step-indicator">
        {STEPS.map((s, i) => {
          let status = "pending";
          if (i < currentStepIdx) status = "complete";
          else if (i === currentStepIdx) status = step === "failed" ? "failed" : "active";
          return (
            <div key={s.key} className={`step-indicator-item step-${status}`}>
              <span className="step-dot">
                {status === "complete" ? "\u2713" : status === "failed" ? "\u2717" : status === "active" ? "\u25CF" : "\u25CB"}
              </span>
              <span className="step-label">{s.label}</span>
            </div>
          );
        })}

        <div className="step-indicator-footer">
          <button className="text-btn" onClick={handleNewProject}>New Project</button>
          {connected && <span className="sse-indicator" title="Connected">&#x25CF;</span>}
        </div>
      </div>

      {/* Main content */}
      <div className="pipeline-content">
        {/* Automation banner */}
        {automating && (
          <div className="automate-banner" onClick={() => setAutomating(false)}>
            Automating... (click to pause)
          </div>
        )}

        {/* Error display */}
        {error && (
          <div className="pipeline-error">
            <p>{error}</p>
            {step === "failed" && (
              <button className="primary-btn" onClick={handleRetry}>Retry</button>
            )}
          </div>
        )}

        {/* Step content */}
        {step === "idea_gathering" && (
          <IntakeStep
            projectId={projectId}
            onProjectUpdate={refreshProject}
            onGeneratePremise={handleGeneratePremise}
          />
        )}

        {step === "premise_generating" && (
          <ProgressStep
            label="Generating premise..."
            progress={progress}
            onAbort={handleAbort}
          />
        )}

        {step === "premise_review" && !automating && (
          <ReviewStep
            type="premise"
            premise={(project as any).premise as PremiseArtifact}
            onApprove={handleApprovePremise}
            onRevise={handleRevisePremise}
            onAutomate={startAutomation}
            loading={loading}
          />
        )}

        {step === "premise_review" && automating && (
          <ProgressStep
            label="Auto-approving premise..."
            progress={progress}
            onAbort={handleAbort}
          />
        )}

        {step === "bible_generating" && (
          <ProgressStep
            label="Building story bible (world, characters, plot)..."
            progress={progress}
            onAbort={handleAbort}
          />
        )}

        {step === "scene_review" && !automating && (
          <ReviewStep
            type="scenes"
            scenePlan={(project as any).scenePlan as ScenePlanArtifact}
            onApprove={handleApproveScenes}
            onRevise={handleReviseScenes}
            onAutomate={startAutomation}
            loading={loading}
          />
        )}

        {step === "scene_review" && automating && (
          <ProgressStep
            label="Auto-approving scene plan..."
            progress={progress}
            onAbort={handleAbort}
          />
        )}

        {step === "scene_generating" && (
          <ProgressStep
            label="Writing scenes..."
            progress={progress}
            completedScenes={completedScenes}
            scenePlanScenes={(project as any).scenePlan?.scenes}
            onAbort={handleAbort}
          />
        )}

        {step === "completed" && (
          <div className="pipeline-complete">
            <h2>Pipeline Complete</h2>
            <p>Your visual novel has been generated successfully.</p>
            <div className="review-actions">
              <button className="primary-btn" onClick={handleExport}>Download Export</button>
              <button className="secondary-btn" onClick={handleNewProject}>Start New</button>
            </div>
          </div>
        )}

        {step === "failed" && !error && (
          <div className="pipeline-error">
            <h2>Pipeline Failed</h2>
            <p>{(project as any).error ?? "Unknown error"}</p>
            <button className="primary-btn" onClick={handleRetry}>Retry</button>
          </div>
        )}

        {step === "aborted" && (
          <div className="pipeline-error">
            <h2>Pipeline Aborted</h2>
            <button className="primary-btn" onClick={handleNewProject}>Start Over</button>
          </div>
        )}
      </div>
    </div>
  );
}
