/**
 * IntakeStep — multi-turn conversation to refine the story seed.
 */

import { useState } from "react";
import { v2Api } from "../../lib/v2Api";
import type { IntakeResponse } from "../../../shared/types/apiV2";

interface IntakeStepProps {
  projectId: string;
  initialIntake?: IntakeResponse | null;
  onProjectUpdate: () => void;
  onGeneratePremise: () => void;
}

interface Turn {
  question?: string;
  userResponse?: string;
  assumptions: IntakeResponse["assumptions"];
}

export function IntakeStep({ projectId, initialIntake, onProjectUpdate, onGeneratePremise }: IntakeStepProps) {
  const [seedInput, setSeedInput] = useState("");
  const [userResponse, setUserResponse] = useState("");
  const [turns, setTurns] = useState<Turn[]>(
    initialIntake ? [{ question: initialIntake.question, assumptions: initialIntake.assumptions }] : [],
  );
  const [currentIntake, setCurrentIntake] = useState<IntakeResponse | null>(initialIntake ?? null);
  const [assumptionResponses, setAssumptionResponses] = useState<Record<string, { action: "keep" | "change"; newValue?: string }>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasSentSeed = turns.length > 0;
  const ready = currentIntake?.readyForPremise ?? false;

  async function sendSeed() {
    if (!seedInput.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await v2Api.intake(projectId, { seedInput: seedInput.trim() });
      setCurrentIntake(res);
      setTurns([{ question: res.question, assumptions: res.assumptions }]);
      onProjectUpdate();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function sendResponse() {
    if (!userResponse.trim() && Object.keys(assumptionResponses).length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await v2Api.intake(projectId, {
        userResponse: userResponse.trim() || undefined,
        assumptionResponses: Object.entries(assumptionResponses).map(([id, r]) => ({
          assumptionId: id,
          action: r.action,
          newValue: r.newValue,
        })),
      });
      setCurrentIntake(res);
      setTurns(prev => [
        ...prev.slice(0, -1),
        { ...prev[prev.length - 1], userResponse: userResponse.trim() },
        { question: res.question, assumptions: res.assumptions },
      ]);
      setUserResponse("");
      setAssumptionResponses({});
      onProjectUpdate();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function handleAssumption(id: string, action: "keep" | "change", newValue?: string) {
    setAssumptionResponses(prev => ({ ...prev, [id]: { action, newValue } }));
  }

  // Seed input (first turn)
  if (!hasSentSeed) {
    return (
      <div className="intake-step">
        <h2>What's your story idea?</h2>
        <textarea
          className="intake-seed-input"
          value={seedInput}
          onChange={e => setSeedInput(e.target.value)}
          placeholder="Describe your story concept..."
          rows={4}
        />
        <button className="primary-btn" onClick={sendSeed} disabled={loading || !seedInput.trim()}>
          {loading ? "Thinking..." : "Start"}
        </button>
        {error && <p className="error-text">{error}</p>}
      </div>
    );
  }

  // Conversation in progress
  const latestTurn = turns[turns.length - 1];
  const latestAssumptions = latestTurn?.assumptions ?? [];

  return (
    <div className="intake-step">
      <h2>Refining your story</h2>

      {/* Previous turns */}
      <div className="intake-history">
        {turns.slice(0, -1).map((turn, i) => (
          <div key={i} className="intake-turn">
            {turn.question && <p className="intake-question">{turn.question}</p>}
            {turn.userResponse && <p className="intake-user-response">{turn.userResponse}</p>}
          </div>
        ))}
      </div>

      {/* Current question */}
      {latestTurn?.question && !ready && (
        <div className="intake-current">
          <p className="intake-question">{latestTurn.question}</p>
        </div>
      )}

      {/* Assumptions */}
      {latestAssumptions.length > 0 && !ready && (
        <div className="intake-assumptions">
          <h3>Assumptions</h3>
          {latestAssumptions.map(a => (
            <div key={a.id} className="assumption-card">
              <p className="assumption-text"><strong>{a.category}:</strong> {a.assumption}</p>
              <div className="assumption-actions">
                <button
                  className={assumptionResponses[a.id]?.action === "keep" || !assumptionResponses[a.id] ? "assumption-btn active" : "assumption-btn"}
                  onClick={() => handleAssumption(a.id, "keep")}
                >
                  Keep
                </button>
                <button
                  className={assumptionResponses[a.id]?.action === "change" ? "assumption-btn active" : "assumption-btn"}
                  onClick={() => handleAssumption(a.id, "change")}
                >
                  Change
                </button>
              </div>
              {assumptionResponses[a.id]?.action === "change" && (
                <input
                  type="text"
                  className="assumption-change-input"
                  placeholder="What instead?"
                  value={assumptionResponses[a.id]?.newValue ?? ""}
                  onChange={e => handleAssumption(a.id, "change", e.target.value)}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Response input */}
      {!ready && (
        <div className="intake-respond">
          <textarea
            className="intake-response-input"
            value={userResponse}
            onChange={e => setUserResponse(e.target.value)}
            placeholder="Your response (optional if just adjusting assumptions)..."
            rows={2}
          />
          <button className="primary-btn" onClick={sendResponse} disabled={loading}>
            {loading ? "Thinking..." : "Continue"}
          </button>
        </div>
      )}

      {/* Ready for premise */}
      {ready && (
        <div className="intake-ready">
          <p className="intake-ready-text">Ready to generate your premise.</p>
          <button className="primary-btn automate-btn" onClick={onGeneratePremise} disabled={loading}>
            Generate Premise
          </button>
        </div>
      )}

      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
