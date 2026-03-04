import React, { useState } from "react";
import type {
  UserPsychologyLedger,
  UserHypothesis,
  UserInteractionHeuristics,
  AssumptionDelta,
} from "../../shared/types/userPsychology";

interface Props {
  fetchPsychology: () => Promise<{ psychologyLedger: UserPsychologyLedger | null }>;
  projectId: string | null;
  visible: boolean;
  onClose: () => void;
}

type Tab = "hypotheses" | "heuristics" | "deltas" | "reads";

const CONFIDENCE_COLORS: Record<string, string> = {
  low: "#f59e0b",
  medium: "#3b82f6",
  high: "#10b981",
};

const CATEGORY_LABELS: Record<string, string> = {
  content_preferences: "Content",
  control_orientation: "Control",
  power_dynamics: "Power",
  tonal_risk: "Tone",
  narrative_ownership: "Ownership",
  engagement_satisfaction: "Engagement",
};

export function PsychologyOverlay({ fetchPsychology, projectId, visible, onClose }: Props) {
  const [ledger, setLedger] = useState<UserPsychologyLedger | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("hypotheses");
  const [autoLoaded, setAutoLoaded] = useState<string | null>(null);

  const refresh = async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchPsychology();
      setLedger(result.psychologyLedger);
    } catch (err: any) {
      setError(err.message ?? "Failed to fetch psychology data");
    } finally {
      setLoading(false);
    }
  };

  // Auto-load when becoming visible with a new projectId
  if (visible && projectId && autoLoaded !== projectId) {
    setAutoLoaded(projectId);
    void refresh();
  }

  if (!visible) return null;

  return (
    <div className="psych-overlay">
      <div className="psych-overlay-header">
        <h3>Psychology Debug</h3>
        <div className="psych-overlay-actions">
          <button type="button" className="chip-sm" onClick={() => void refresh()} disabled={loading}>
            {loading ? "..." : "Refresh"}
          </button>
          <button type="button" className="psych-close" onClick={onClose}>&times;</button>
        </div>
      </div>

      {error && <div className="psych-error">{error}</div>}

      {!ledger && !loading && !error && (
        <div className="psych-empty">No psychology data yet. Start a conversation first.</div>
      )}

      {ledger && (
        <>
          <div className="psych-tabs">
            {(["hypotheses", "heuristics", "deltas", "reads"] as Tab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                className={`psych-tab${activeTab === tab ? " psych-tab-active" : ""}`}
                onClick={() => setActiveTab(tab)}
              >
                {tab === "hypotheses"
                  ? `Hypotheses (${ledger.hypothesisStore.length})`
                  : tab === "heuristics"
                  ? "Heuristics"
                  : tab === "deltas"
                  ? `Deltas (${ledger.assumptionDeltas.length})`
                  : `Reads (${ledger.reads.length})`}
              </button>
            ))}
          </div>

          <div className="psych-content">
            {activeTab === "hypotheses" && <HypothesesPanel hypotheses={ledger.hypothesisStore} />}
            {activeTab === "heuristics" && <HeuristicsPanel heuristics={ledger.heuristics} />}
            {activeTab === "deltas" && <DeltasPanel deltas={ledger.assumptionDeltas} />}
            {activeTab === "reads" && <ReadsPanel reads={ledger.reads} />}
          </div>
        </>
      )}
    </div>
  );
}

/* ─── Sub-panels ─── */

function HypothesesPanel({ hypotheses }: { hypotheses: UserHypothesis[] }) {
  if (hypotheses.length === 0) return <div className="psych-empty">No hypotheses recorded yet.</div>;

  const grouped: Record<string, UserHypothesis[]> = {};
  for (const h of hypotheses) {
    const cat = h.category || "unknown";
    (grouped[cat] ??= []).push(h);
  }

  return (
    <div className="psych-hypotheses">
      {Object.entries(grouped).map(([category, items]) => (
        <div key={category} className="psych-hyp-group">
          <h4 className="psych-hyp-category">{CATEGORY_LABELS[category] ?? category}</h4>
          {items.map((h) => (
            <div key={h.id} className={`psych-hyp-card${h.disconfirmedBy ? " psych-hyp-disconfirmed" : ""}`}>
              <div className="psych-hyp-top">
                <span
                  className="psych-confidence"
                  style={{ background: CONFIDENCE_COLORS[h.confidence] ?? "#888" }}
                >
                  {h.confidence}
                </span>
                <span className="psych-scope">{h.scope.replace(/_/g, " ")}</span>
                {h.disconfirmedBy && <span className="psych-disconfirmed-badge">disconfirmed</span>}
              </div>
              <p className="psych-hyp-text">{h.hypothesis}</p>
              <p className="psych-hyp-evidence">{h.evidence}</p>
              <div className="psych-hyp-meta">
                <span>First: turn {h.firstSeen}</span>
                <span>Updated: turn {h.lastUpdated}</span>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function HeuristicsPanel({ heuristics }: { heuristics: UserInteractionHeuristics }) {
  const h = heuristics;
  const trend = h.engagementTrend === 1 ? "rising" : h.engagementTrend === -1 ? "declining" : "stable";

  return (
    <div className="psych-heuristics">
      <div className="psych-stat-grid">
        <StatCard label="Type ratio" value={h.typeRatio.toFixed(2)} subtitle="typed / total" />
        <StatCard label="Avg response" value={h.avgResponseLength.toFixed(0)} subtitle="chars" />
        <StatCard label="Deferral rate" value={`${(h.deferralRate * 100).toFixed(0)}%`} subtitle="not ready / total" />
        <StatCard label="Change rate" value={`${(h.changeRate * 100).toFixed(0)}%`} subtitle="changed assumptions" />
        <StatCard label="Interactions" value={String(h.totalInteractions)} subtitle="total" />
        <StatCard label="Engagement" value={trend} subtitle={`trend (${h.engagementTrend})`} />
      </div>

      {h.satisfaction && (
        <div className="psych-satisfaction">
          <h4>Satisfaction</h4>
          <div className="psych-stat-grid">
            <StatCard label="Score" value={h.satisfaction.score.toFixed(2)} subtitle="0-1 scale" />
            <StatCard label="Trend" value={h.satisfaction.trend} subtitle="" />
            <StatCard label="Last computed" value={`turn ${h.satisfaction.last_computed_turn}`} subtitle="" />
          </div>
        </div>
      )}

      {h._importedBaseline && (
        <div className="psych-baseline">
          <h4>Imported Baseline (prev modules)</h4>
          <pre className="psych-json">{JSON.stringify(h._importedBaseline, null, 2)}</pre>
        </div>
      )}

      {h._rawStats && (
        <div className="psych-baseline">
          <h4>Raw Stats (cumulative)</h4>
          <pre className="psych-json">{JSON.stringify(h._rawStats, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, subtitle }: { label: string; value: string; subtitle: string }) {
  return (
    <div className="psych-stat-card">
      <div className="psych-stat-value">{value}</div>
      <div className="psych-stat-label">{label}</div>
      {subtitle && <div className="psych-stat-sub">{subtitle}</div>}
    </div>
  );
}

function DeltasPanel({ deltas }: { deltas: AssumptionDelta[] }) {
  if (deltas.length === 0) return <div className="psych-empty">No assumption deltas recorded.</div>;

  return (
    <div className="psych-deltas">
      {deltas.map((d, i) => (
        <div key={i} className="psych-delta-card">
          <div className="psych-delta-header">
            <span className="psych-delta-turn">Turn {d.turnNumber}</span>
            <span>Offered: {d.offered.length} | Responded: {d.responded.length} | Ignored: {d.ignored.length}</span>
          </div>
          {Object.entries(d.actions).length > 0 && (
            <div className="psych-delta-actions">
              {Object.entries(d.actions).map(([id, action]) => (
                <span key={id} className={`psych-delta-action psych-action-${action}`}>
                  {id}: {action}
                </span>
              ))}
            </div>
          )}
          {d.prior_changes && d.prior_changes.length > 0 && (
            <div className="psych-delta-prior">
              Prior changes: {d.prior_changes.map((c) => `${c.hypothesis_id}(${c.change_applied}, relevant=${c.still_relevant})`).join(", ")}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ReadsPanel({ reads }: { reads: UserPsychologyLedger["reads"] }) {
  if (reads.length === 0) return <div className="psych-empty">No LLM reads recorded.</div>;

  return (
    <div className="psych-reads">
      {reads.map((r, i) => (
        <div key={i} className="psych-read-card">
          <div className="psych-read-header">
            <span className="psych-read-module">{r.module} &middot; turn {r.turnNumber}</span>
          </div>
          <p className="psych-read-overall">{r.overall_read}</p>
          {r.hypotheses.length > 0 && (
            <div className="psych-read-hyps">
              {r.hypotheses.map((h, j) => (
                <div key={j} className="psych-read-hyp">
                  <span
                    className="psych-confidence"
                    style={{ background: CONFIDENCE_COLORS[h.confidence] ?? "#888" }}
                  >
                    {h.confidence}
                  </span>
                  <span className="psych-scope">{h.scope.replace(/_/g, " ")}</span>
                  <span>{h.hypothesis}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
