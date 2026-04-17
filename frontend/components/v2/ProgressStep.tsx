/**
 * ProgressStep — shows real-time progress during async generation.
 * Driven by SSE progress events from the parent.
 */

import type { BatchProgress } from "../../../shared/types/project";

interface ScenePlanEntry {
  scene_id: string;
  title: string;
}

interface ProgressStepProps {
  label: string;
  progress: BatchProgress | null;
  completedScenes?: string[];
  /** Scene plan entries — renders one row per planned scene, matching by real scene_id. */
  scenePlanScenes?: ScenePlanEntry[];
  onAbort: () => void;
}

export function ProgressStep({ label, progress, completedScenes, scenePlanScenes, onAbort }: ProgressStepProps) {
  const pct = progress
    ? Math.round((progress.completedSteps / Math.max(progress.totalSteps, 1)) * 100)
    : 0;

  const showSceneList = completedScenes && scenePlanScenes && scenePlanScenes.length > 0;

  return (
    <div className="progress-step">
      <h2>{label}</h2>

      <div className="progress-bar-container">
        <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
      </div>

      {progress?.currentStep && (
        <p className="progress-current-step">{progress.currentStep}</p>
      )}

      {showSceneList && (
        <div className="progress-scene-list">
          <h3>Scenes ({completedScenes!.length} / {scenePlanScenes!.length})</h3>
          <ul>
            {scenePlanScenes!.map((scene, i) => {
              const done = completedScenes!.includes(scene.scene_id);
              return (
                <li key={scene.scene_id} className={done ? "scene-done" : "scene-pending"}>
                  {done ? "\u2713" : "\u00B7"} Scene {i + 1}{scene.title ? ` — ${scene.title}` : ""}
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
