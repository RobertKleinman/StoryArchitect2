/**
 * ReviewStep — reusable review UI for premise and scene plan review.
 */

import { useState } from "react";
import type { PremiseArtifact, ScenePlanArtifact } from "../../../shared/types/artifacts";

interface ReviewStepProps {
  type: "premise" | "scenes";
  premise?: PremiseArtifact;
  scenePlan?: ScenePlanArtifact;
  onApprove: () => void;
  onRevise: (feedback: string) => void;
  onAutomate: () => void;
  loading: boolean;
}

export function ReviewStep({ type, premise, scenePlan, onApprove, onRevise, onAutomate, loading }: ReviewStepProps) {
  const [feedback, setFeedback] = useState("");
  const [showRevise, setShowRevise] = useState(false);

  if (type === "premise" && premise) {
    return (
      <div className="review-step">
        <h2>Review Premise</h2>

        <div className="review-card">
          <h3>Hook</h3>
          <p>{premise.hook_sentence}</p>
        </div>

        <div className="review-card">
          <h3>Emotional Promise</h3>
          <p>{premise.emotional_promise}</p>
        </div>

        <div className="review-card">
          <h3>Premise</h3>
          <p>{premise.premise_paragraph}</p>
        </div>

        {premise.synopsis && (
          <div className="review-card">
            <h3>Synopsis</h3>
            <p>{premise.synopsis}</p>
          </div>
        )}

        <div className="review-card">
          <h3>Tone</h3>
          <div className="tone-chips">
            {premise.tone_chips?.map((chip, i) => (
              <span key={i} className="tone-chip">{chip}</span>
            ))}
          </div>
        </div>

        {premise.characters_sketch && premise.characters_sketch.length > 0 && (
          <div className="review-card">
            <h3>Characters</h3>
            {premise.characters_sketch.map((c, i) => (
              <p key={i}><strong>{c.name}</strong> ({c.role}) — {c.one_liner}</p>
            ))}
          </div>
        )}

        <div className="review-actions">
          <button className="primary-btn" onClick={onApprove} disabled={loading}>
            {loading ? "Working..." : "Approve"}
          </button>
          <button className="secondary-btn" onClick={() => setShowRevise(!showRevise)} disabled={loading}>
            Request Changes
          </button>
          <button className="automate-btn" onClick={onAutomate} disabled={loading}>
            Automate from here
          </button>
        </div>

        {showRevise && (
          <div className="review-revise">
            <textarea
              value={feedback}
              onChange={e => setFeedback(e.target.value)}
              placeholder="What would you like changed?"
              rows={3}
            />
            <button className="primary-btn" onClick={() => onRevise(feedback)} disabled={loading || !feedback.trim()}>
              Submit Changes
            </button>
          </div>
        )}
      </div>
    );
  }

  if (type === "scenes" && scenePlan) {
    return (
      <div className="review-step">
        <h2>Review Scene Plan ({scenePlan.total_scenes} scenes)</h2>

        <div className="scene-plan-list">
          {scenePlan.scenes.map((scene, i) => (
            <div key={scene.scene_id} className="review-card scene-plan-card">
              <h3>Scene {i + 1}: {scene.title}</h3>
              <p className="scene-purpose">{scene.purpose}</p>
              <p className="scene-meta">
                <span>Setting: {scene.setting}</span>
                {scene.pov_character && <span> | POV: {scene.pov_character}</span>}
              </p>
            </div>
          ))}
        </div>

        <div className="review-actions">
          <button className="primary-btn" onClick={onApprove} disabled={loading}>
            {loading ? "Working..." : "Approve Scene Plan"}
          </button>
          <button className="secondary-btn" onClick={() => setShowRevise(!showRevise)} disabled={loading}>
            Request Changes
          </button>
          <button className="automate-btn" onClick={onAutomate} disabled={loading}>
            Automate from here
          </button>
        </div>

        {showRevise && (
          <div className="review-revise">
            <textarea
              value={feedback}
              onChange={e => setFeedback(e.target.value)}
              placeholder="What would you like changed about the scene plan?"
              rows={3}
            />
            <button className="primary-btn" onClick={() => onRevise(feedback)} disabled={loading || !feedback.trim()}>
              Submit Changes
            </button>
          </div>
        )}
      </div>
    );
  }

  return <p>Loading review data...</p>;
}
