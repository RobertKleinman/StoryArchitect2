import React, { useState } from "react";
import type { EngineInsightsResponse } from "../../shared/types/api";
import type { CulturalBrief, EvidenceItem, CreativeApplication } from "../../shared/types/cultural";
import type { DirectionMapSnapshot, DirectionFamily } from "../../shared/types/userPsychology";

interface Props {
  module: string;
  projectId: string | null;
  fetchInsights: () => Promise<EngineInsightsResponse>;
  visible: boolean;
  onClose: () => void;
}

type Tab = "cultural" | "divergence" | "psychology" | "targets";

const SEVERITY_COLORS: Record<string, string> = {
  critical: "#ef4444",
  review: "#f59e0b",
  minor: "#6b7280",
};

const STATUS_COLORS: Record<string, string> = {
  unaddressed: "#ef4444",
  partially_addressed: "#f59e0b",
  addressed: "#10b981",
  deferred: "#6b7280",
};

export function EngineInsights({ module, projectId, fetchInsights, visible, onClose }: Props) {
  const [data, setData] = useState<EngineInsightsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("cultural");
  const [autoLoaded, setAutoLoaded] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});

  const toggleSection = (key: string) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const refresh = async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchInsights();
      setData(result);
    } catch (err: any) {
      setError(err.message ?? "Failed to fetch insights data");
    } finally {
      setLoading(false);
    }
  };

  if (visible && projectId && autoLoaded !== projectId) {
    setAutoLoaded(projectId);
    void refresh();
  }

  if (!visible) return null;

  const culturalBrief = data?.culturalBrief ?? null;
  const divergenceMap = data?.divergenceMap ?? null;
  const psychologyLedger = data?.psychologyLedger ?? null;
  const developmentTargets = data?.developmentTargets ?? [];

  return (
    <div className="insights-drawer">
      <div className="insights-header">
        <h3>Engine Insights ({module})</h3>
        <div className="insights-actions">
          <button type="button" className="chip-sm" onClick={() => void refresh()} disabled={loading}>
            {loading ? "..." : "Refresh"}
          </button>
          <button type="button" className="insights-close" onClick={onClose}>&times;</button>
        </div>
      </div>

      {error && <div className="insights-error">{error}</div>}

      {!data && !loading && !error && (
        <div className="insights-empty">No insights data yet. Start a conversation first.</div>
      )}

      {data && (
        <>
          <div className="insights-tabs">
            {(["cultural", "divergence", "psychology", "targets"] as Tab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                className={`insights-tab${activeTab === tab ? " insights-tab-active" : ""}`}
                onClick={() => setActiveTab(tab)}
              >
                {tab === "cultural"
                  ? "Cultural"
                  : tab === "divergence"
                  ? "Divergence"
                  : tab === "psychology"
                  ? "Psychology"
                  : `Targets (${developmentTargets.length})`}
              </button>
            ))}
          </div>

          <div className="insights-content">
            {activeTab === "cultural" && (
              <CulturalPanel brief={culturalBrief} expanded={expandedSections} toggle={toggleSection} />
            )}
            {activeTab === "divergence" && (
              <DivergencePanel snapshot={divergenceMap} expanded={expandedSections} toggle={toggleSection} />
            )}
            {activeTab === "psychology" && (
              <PsychologySummaryPanel ledger={psychologyLedger} />
            )}
            {activeTab === "targets" && (
              <TargetsPanel targets={developmentTargets} />
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ─── Cultural Brief Panel ─── */

function CulturalPanel({
  brief,
  expanded,
  toggle,
}: {
  brief: CulturalBrief | null;
  expanded: Record<string, boolean>;
  toggle: (key: string) => void;
}) {
  if (!brief) {
    return <div className="insights-empty">No cultural research brief available. The cultural engine runs after turn 2 when ENABLE_CULTURAL_ENGINE is set.</div>;
  }

  return (
    <div className="cultural-panel">
      <div className="cultural-meta">
        <span>Module: {brief.module}</span>
        <span>After turn: {brief.afterTurn}</span>
        <span>{new Date(brief.generatedAt).toLocaleTimeString()}</span>
      </div>

      {/* Evidence Items */}
      <div className="insights-section">
        <button
          type="button"
          className="insights-section-header"
          onClick={() => toggle("evidence")}
        >
          <span>Evidence ({brief.evidenceBrief.items.length})</span>
          <span>{expanded["evidence"] ? "\u25BC" : "\u25B6"}</span>
        </button>
        {expanded["evidence"] && (
          <div className="insights-section-body">
            {brief.evidenceBrief.items.map((item, i) => (
              <React.Fragment key={i}><EvidenceCard item={item} /></React.Fragment>
            ))}
            {brief.evidenceBrief.negativeProfile.length > 0 && (
              <div className="cultural-negative">
                <strong>Not this story:</strong> {brief.evidenceBrief.negativeProfile.join(", ")}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Creative Applications */}
      <div className="insights-section">
        <button
          type="button"
          className="insights-section-header"
          onClick={() => toggle("applications")}
        >
          <span>Creative Applications ({brief.creativeApplications.length})</span>
          <span>{expanded["applications"] ? "\u25BC" : "\u25B6"}</span>
        </button>
        {expanded["applications"] && (
          <div className="insights-section-body">
            {brief.creativeApplications.map((app, i) => (
              <React.Fragment key={i}><ApplicationCard app={app} /></React.Fragment>
            ))}
          </div>
        )}
      </div>

      {/* Proposals */}
      {brief.proposals.length > 0 && (
        <div className="insights-section">
          <button
            type="button"
            className="insights-section-header"
            onClick={() => toggle("proposals")}
          >
            <span>Proposals ({brief.proposals.length})</span>
            <span>{expanded["proposals"] ? "\u25BC" : "\u25B6"}</span>
          </button>
          {expanded["proposals"] && (
            <div className="insights-section-body">
              {brief.proposals.map((p) => (
                <div key={p.id} className="proposal-card">
                  <p className="proposal-connection">{p.connection}</p>
                  <p className="proposal-evidence">{p.evidence}</p>
                  <span className={`proposal-confidence proposal-${p.confidence}`}>{p.confidence}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EvidenceCard({ item }: { item: EvidenceItem }) {
  return (
    <div className="evidence-card">
      <div className="evidence-top">
        <span className={`evidence-confidence evidence-${item.confidence}`}>{item.confidence}</span>
        <span className="evidence-source">{item.sourceFamily.replace(/_/g, " ")}</span>
        <span className="evidence-dimension">{item.storyDimension}</span>
      </div>
      <p className="evidence-claim">{item.claim}</p>
      <p className="evidence-detail">{item.specificDetail}</p>
    </div>
  );
}

function ApplicationCard({ app }: { app: CreativeApplication }) {
  return (
    <div className="application-card">
      <div className="application-top">
        <span className={`application-mode application-${app.mode}`}>{app.mode}</span>
      </div>
      <p className="application-connection">{app.connection}</p>
      <p className="application-use">{app.suggestedUse}</p>
      {app.antiDerivative && (
        <p className="application-warning">Warning: {app.antiDerivative}</p>
      )}
    </div>
  );
}

/* ─── Divergence Map Panel ─── */

function DivergencePanel({
  snapshot,
  expanded,
  toggle,
}: {
  snapshot: DirectionMapSnapshot | null;
  expanded: Record<string, boolean>;
  toggle: (key: string) => void;
}) {
  if (!snapshot) {
    return <div className="insights-empty">No divergence map available. The divergence explorer runs in the background during user think-time.</div>;
  }

  const map = snapshot.directionMap;

  return (
    <div className="divergence-panel">
      <div className="divergence-meta">
        <span>Module: {snapshot.module}</span>
        <span>After turn: {snapshot.afterTurn}</span>
        <span>{new Date(snapshot.timestamp).toLocaleTimeString()}</span>
      </div>

      <div className="divergence-convergence">
        <strong>Convergence:</strong> {map.convergenceNote}
      </div>

      <div className="divergence-blind-spot">
        <strong>Blind spot:</strong> {map.blindSpot}
      </div>

      {map.families.map((family, i) => (
        <div key={i} className="insights-section">
          <button
            type="button"
            className="insights-section-header"
            onClick={() => toggle(`family-${i}`)}
          >
            <span>{family.name} (novelty: {Math.round(family.novelty * 100)}%)</span>
            <span>{expanded[`family-${i}`] ? "\u25BC" : "\u25B6"}</span>
          </button>
          {expanded[`family-${i}`] && (
            <div className="insights-section-body">
              <p className="family-signature">{family.signature}</p>
              {family.futures.map((f, j) => (
                <div key={j} className="future-card">
                  <div className="future-top">
                    <strong>{f.label}</strong>
                    <span className="future-conflict">{f.conflictPattern}</span>
                    <span className="future-power">{f.powerDynamic}</span>
                  </div>
                  <p className="future-sketch">{f.sketch}</p>
                  <p className="future-payoff">Payoff: {f.emotionalPayoff}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ─── Psychology Summary Panel ─── */

function PsychologySummaryPanel({ ledger }: { ledger: any | null }) {
  if (!ledger) {
    return <div className="insights-empty">No psychology data available.</div>;
  }

  const signalStore = ledger.signalStore ?? ledger.hypothesisStore ?? [];
  const activeSignals = signalStore.filter((s: any) => s.status !== "suppressed");
  const heuristics = ledger.heuristics;

  return (
    <div className="psychology-summary-panel">
      <div className="psych-summary-stats">
        <div className="psych-stat-mini">
          <span className="psych-stat-value">{signalStore.length}</span>
          <span className="psych-stat-label">Total Signals</span>
        </div>
        <div className="psych-stat-mini">
          <span className="psych-stat-value">{activeSignals.length}</span>
          <span className="psych-stat-label">Active</span>
        </div>
        <div className="psych-stat-mini">
          <span className="psych-stat-value">{ledger.reads?.length ?? 0}</span>
          <span className="psych-stat-label">Reads</span>
        </div>
        <div className="psych-stat-mini">
          <span className="psych-stat-value">{heuristics?.totalInteractions ?? 0}</span>
          <span className="psych-stat-label">Interactions</span>
        </div>
      </div>

      {/* Latest behavior summary */}
      {ledger.reads?.length > 0 && (
        <div className="psych-latest-read">
          <h4>Latest Behavior Read</h4>
          {(() => {
            const latest = ledger.reads[ledger.reads.length - 1];
            return (
              <>
                {latest.behaviorSummary && (
                  <div className="psych-summary-block">
                    <p>{latest.behaviorSummary.orientation}</p>
                    <div className="psych-summary-meta">
                      <span>Focus: {latest.behaviorSummary.currentFocus}</span>
                      <span>Mode: {latest.behaviorSummary.engagementMode}</span>
                      {latest.behaviorSummary.satisfaction && (
                        <span>
                          Satisfaction: {Math.round(latest.behaviorSummary.satisfaction.score * 100)}%
                          ({latest.behaviorSummary.satisfaction.trend})
                        </span>
                      )}
                    </div>
                  </div>
                )}
                {latest.adaptationPlan && (
                  <div className="psych-plan-block">
                    <strong>Plan:</strong> {latest.adaptationPlan.dominantNeed}
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}

      {/* Top active signals */}
      {activeSignals.length > 0 && (
        <div className="psych-top-signals">
          <h4>Top Signals</h4>
          {activeSignals.slice(0, 5).map((s: any) => (
            <div key={s.id} className="psych-signal-mini">
              <span
                className="psych-signal-dot"
                style={{ background: s.status === "stable" ? "#10b981" : s.status === "active" ? "#3b82f6" : "#f59e0b" }}
              />
              <span className="psych-signal-text">{s.hypothesis}</span>
              <span className="psych-signal-conf">{Math.round((s.confidence ?? 0) * 100)}%</span>
            </div>
          ))}
        </div>
      )}

      {/* Consolidation note */}
      {ledger.lastConsolidation?.result?.reasoning && (
        <div className="psych-consolidation">
          <h4>Last Consolidation</h4>
          <p>{ledger.lastConsolidation.result.reasoning}</p>
        </div>
      )}
    </div>
  );
}

/* ─── Development Targets Panel ─── */

function TargetsPanel({ targets }: { targets: EngineInsightsResponse["developmentTargets"] }) {
  if (targets.length === 0) {
    return <div className="insights-empty">No development targets tracked for this module.</div>;
  }

  // Group by status
  const grouped: Record<string, typeof targets> = {};
  for (const t of targets) {
    (grouped[t.status] ??= []).push(t);
  }

  const statusOrder = ["unaddressed", "partially_addressed", "deferred", "addressed"];

  return (
    <div className="targets-panel">
      {statusOrder.map(status => {
        const items = grouped[status];
        if (!items || items.length === 0) return null;
        return (
          <div key={status} className="target-group">
            <h4 className="target-group-header">
              <span
                className="target-status-dot"
                style={{ background: STATUS_COLORS[status] ?? "#888" }}
              />
              {status.replace(/_/g, " ")} ({items.length})
            </h4>
            {items.map((t) => (
              <div key={t.id} className="target-card">
                <div className="target-top">
                  <span className="target-source">{t.source_module}</span>
                  {t.best_module_to_address && (
                    <span className="target-best-module">best: {t.best_module_to_address}</span>
                  )}
                </div>
                <p className="target-text">{t.target}</p>
                {t.current_gap && <p className="target-gap">Gap: {t.current_gap}</p>}
                {t.suggestion && <p className="target-suggestion">Suggestion: {t.suggestion}</p>}
                {t.notes && <p className="target-notes">{t.notes}</p>}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
