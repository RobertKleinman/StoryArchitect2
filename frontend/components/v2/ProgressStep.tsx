/**
 * ProgressStep — shows real-time progress during async generation.
 * Driven by SSE progress events from the parent.
 */

import type { BatchProgress } from "../../../shared/types/project";

interface ProgressStepProps {
  label: string;
  progress: BatchProgress | null;
  completedScenes?: string[];
  totalScenes?: number;
  onAbort: () => void;
}

export function ProgressStep({ label, progress, completedScenes, totalScenes, onAbort }: ProgressStepProps) {
  const pct = progress
    ? Math.round((progress.completedSteps / Math.max(progress.totalSteps, 1)) * 100)
    : 0;

  return (
    <div className="progress-step">
      <h2>{label}</h2>

      <div className="progress-bar-container">
        <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
      </div>

      {progress?.currentStep && (
        <p className="progress-current-step">{progress.currentStep}</p>
      )}

      {completedScenes && totalScenes && totalScenes > 0 && (
        <div className="progress-scene-list">
          <h3>Scenes ({completedScenes.length} / {totalScenes})</h3>
          <ul>
            {Array.from({ length: totalScenes }, (_, i) => {
              const sceneId = `scene_${String(i + 1).padStart(2, "0")}`;
              const done = completedScenes.includes(sceneId);
              return (
                <li key={i} className={done ? "scene-done" : "scene-pending"}>
                  {done ? "\u2713" : "\u00B7"} Scene {i + 1}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {!progress && (
        <p className="progress-waiting">Starting...</p>
      )}

      <button className="abort-btn" onClick={onAbort}>Abort</button>
    </div>
  );
}
