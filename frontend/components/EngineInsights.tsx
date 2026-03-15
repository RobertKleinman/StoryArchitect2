import React, { useState, useEffect, useCallback } from "react";
import type { EngineInsightsResponse } from "../../shared/types/api";
import type { CulturalBrief, EvidenceItem, CreativeApplication } from "../../shared/types/cultural";
import type {
  UserPsychologyLedger,
  DirectionMapSnapshot,
  BehaviorSignal,
  DirectionFamily,
} from "../../shared/types/userPsychology";

type TabId = "cultural" | "divergence" | "psychology" | "targets";

interface EngineInsightsProps {
  module: string;
  projectId: string;
  fetchInsights: () => Promise<EngineInsightsResponse>;
  visible: boolean;
  onClose: () => void;
}

// ─── Sub-components ───

function CulturalPanel({ brief }: { brief: CulturalBrief | null }) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    evidence: true,
    applications: false,
    proposals: false,
  });

  const toggle = (key: string) =>
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));

  if (!brief) {
    return <div className="insights-empty">No cultural brief available yet.</div>;
  }

  return (
    <div className="insights-cultural">
      {/* Evidence */}
      <div className="insights-section">
        <button className="insights-section-header" onClick={() => toggle("evidence")}>
          <span>{expandedSections.evidence ? "\u25BC" : "\u25B6"} Evidence Brief</span>
          <span className="insights-badge">{brief.evidenceBrief.items.length}</span>
        </button>
        {expandedSections.evidence && (
          <div className="insights-section-body">
            {brief.evidenceBrief.items.map((item: EvidenceItem, i: number) => (
              <div key={i} className="evidence-card">
                <div className="evidence-claim">{item.claim}</div>
                <div className="evidence-meta">
                  <span className={`evidence-confidence evidence-confidence-${item.confidence}`}>
                    {item.confidence}
                  </span>
                  <span className="evidence-source">{item.sourceFamily}</span>
                  <span className="evidence-dimension">{item.storyDimension}</span>
                </div>
                <div className="evidence-detail">{item.specificDetail}</div>
              </div>
            ))}
            {brief.evidenceBrief.negativeProfile.length > 0 && (
              <div className="negative-profile">
                <strong>Not this story:</strong> {brief.evidenceBrief.negativeProfile.join(", ")}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Creative Applications */}
      <div className="insights-section">
        <button className="insights-section-header" onClick={() => toggle("applications")}>
          <span>{expandedSections.applications ? "\u25BC" : "\u25B6"} Creative Applications</span>
          <span className="insights-badge">{brief.creativeApplications.length}</span>
        </button>
        {expandedSections.applications && (
          <div className="insights-section-body">
            {brief.creativeApplications.map((app: CreativeApplication, i: number) => (
              <div key={i} className="application-card">
                <div className="application-connection">{app.connection}</div>
                <div className="application-mode">Mode: {app.mode}</div>
                <div className="application-use">{app.suggestedUse}</div>
                {app.antiDerivative && (
                  <div className="application-warning">Warning: {app.antiDerivative}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Proposals */}
      {brief.proposals.length > 0 && (
        <div className="insights-section">
          <button className="insights-section-header" onClick={() => toggle("proposals")}>
            <span>{expandedSections.proposals ? "\u25BC" : "\u25B6"} Proposals</span>
            <span className="insights-badge">{brief.proposals.length}</span>
          </button>
          {expandedSections.proposals && (
            <div className="insights-section-body">
              {brief.proposals.map((p, i) => (
                <div key={i} className="proposal-card">
                  <div className="proposal-connection">{p.connection}</div>
                  <div className="proposal-evidence">{p.evidence}</div>
                  <div className="proposal-option">{p.suggestedOption}</div>
                  <span className={`proposal-confidence proposal-confidence-${p.confidence}`}>
                    {p.confidence}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DivergencePanel({ snapshot }: { snapshot: DirectionMapSnapshot | null }) {
  if (!snapshot) {
    return <div className="insights-empty">No divergence map available yet.</div>;
  }

  const map = snapshot.directionMap;

  return (
    <div className="insights-divergence">
      <div className="divergence-meta">
        <span>After turn {snapshot.afterTurn}</span>
        <span>Module: {snapshot.module}</span>
      </div>

      {map.convergenceNote && (
        <div className="divergence-convergence">{map.convergenceNote}</div>
      )}

      {map.blindSpot && (
        <div className="divergence-blindspot">
          <strong>Blind spot:</strong> {map.blindSpot}
        </div>
      )}

      <div className="divergence-families">
        {map.families.map((family: DirectionFamily, i: number) => (
          <div key={i} className="divergence-family">
            <div className="family-header">
              <span className="family-name">{family.name}</span>
              <span className="family-novelty">novelty: {(family.novelty * 100).toFixed(0)}%</span>
            </div>
            <div className="family-signature">{family.signature}</div>
            <div className="family-futures">
              {family.futures.map((f, j) => (
                <div key={j} className="future-card">
                  <div className="future-label">{f.label}</div>
                  <div className="future-sketch">{f.sketch}</div>
                  <div className="future-meta">
                    <span>{f.emotionalPayoff}</span>
                    <span>{f.conflictPattern}</span>
                    <span>{f.powerDynamic}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PsychologySummaryPanel({ ledger }: { ledger: UserPsychologyLedger | null }) {
  if (!ledger) {
    return <div className="insights-empty">No psychology data available yet.</div>;
  }

  const signals = ledger.signalStore ?? [];
  const activeSignals = signals.filter((s: BehaviorSignal) => s.status === "active" || s.status === "stable");
  const lastRead = ledger.reads.length > 0 ? ledger.reads[ledger.reads.length - 1] : null;
  const h = ledger.heuristics;

  return (
    <div className="insights-psychology">
      {/* Heuristics summary */}
      <div className="psych-stats-grid">
        <div className="psych-stat">
          <span className="psych-stat-value">{(h.typeRatio * 100).toFixed(0)}%</span>
          <span className="psych-stat-label">Type ratio</span>
        </div>
        <div className="psych-stat">
          <span className="psych-stat-value">{h.avgResponseLength.toFixed(0)}</span>
          <span className="psych-stat-label">Avg response len</span>
        </div>
        <div className="psych-stat">
          <span className="psych-stat-value">{(h.deferralRate * 100).toFixed(0)}%</span>
          <span className="psych-stat-label">Deferral rate</span>
        </div>
        <div className="psych-stat">
          <span className="psych-stat-value">{(h.changeRate * 100).toFixed(0)}%</span>
          <span className="psych-stat-label">Change rate</span>
        </div>
        <div className="psych-stat">
          <span className="psych-stat-value">{h.totalInteractions}</span>
          <span className="psych-stat-label">Total interactions</span>
        </div>
        <div className="psych-stat">
          <span className="psych-stat-value">
            {h.engagementTrend > 0 ? "+" : ""}{h.engagementTrend.toFixed(1)}
          </span>
          <span className="psych-stat-label">Engagement trend</span>
        </div>
      </div>

      {/* Last behavior summary */}
      {lastRead?.behaviorSummary && (
        <div className="psych-behavior-summary">
          <div className="psych-orientation">{lastRead.behaviorSummary.orientation}</div>
          <div className="psych-engagement-mode">
            Mode: {lastRead.behaviorSummary.engagementMode}
            {lastRead.behaviorSummary.satisfaction && (
              <> | Satisfaction: {(lastRead.behaviorSummary.satisfaction.score * 100).toFixed(0)}% ({lastRead.behaviorSummary.satisfaction.trend})</>
            )}
          </div>
        </div>
      )}

      {/* Active signals */}
      <div className="psych-signals">
        <h4>Active Signals ({activeSignals.length})</h4>
        {activeSignals.map((s: BehaviorSignal) => (
          <div key={s.id} className={`signal-mini-card signal-status-${s.status}`}>
            <div className="signal-header">
              <span className="signal-id">{s.id}</span>
              <span className="signal-category">{s.category}</span>
              <span className="signal-confidence">{(s.confidence * 100).toFixed(0)}%</span>
            </div>
            <div className="signal-hypothesis">{s.hypothesis}</div>
            <div className="signal-consequence">{s.adaptationConsequence}</div>
          </div>
        ))}
      </div>

      {/* Consolidation */}
      {ledger.lastConsolidation && (
        <div className="psych-consolidation">
          <h4>Last Consolidation (turn {ledger.lastConsolidation.afterTurn})</h4>
          {ledger.lastConsolidation.result.reasoning && (
            <div className="consolidation-reasoning">{ledger.lastConsolidation.result.reasoning}</div>
          )}
          {ledger.lastConsolidation.result.unresolvedAmbiguity && (
            <div className="consolidation-ambiguity">
              <strong>Unresolved:</strong> {ledger.lastConsolidation.result.unresolvedAmbiguity.description}
              <div className="ambiguity-why">{ledger.lastConsolidation.result.unresolvedAmbiguity.whyItMatters}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TargetsPanel({ targets }: { targets: EngineInsightsResponse["developmentTargets"] }) {
  if (!targets || targets.length === 0) {
    return <div className="insights-empty">No development targets tracked in this module.</div>;
  }

  return (
    <div className="insights-targets">
      {targets.map((t, i) => (
        <div key={t.id || i} className={`target-card target-status-${t.status}`}>
          <div className="target-header">
            <span className={`target-status-dot target-dot-${t.status}`} />
            <span className="target-source">{t.source_module}</span>
            <span className="target-status-label">{t.status}</span>
          </div>
          <div className="target-description">{t.target}</div>
          {t.current_gap && <div className="target-gap">Gap: {t.current_gap}</div>}
          {t.suggestion && <div className="target-suggestion">Suggestion: {t.suggestion}</div>}
          {t.notes && <div className="target-notes">{t.notes}</div>}
          {t.best_module_to_address && (
            <div className="target-best-module">Best addressed by: {t.best_module_to_address}</div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Main Component ───

export function EngineInsights({ module, projectId, fetchInsights, visible, onClose }: EngineInsightsProps) {
  const [activeTab, setActiveTab] = useState<TabId>("cultural");
  const [data, setData] = useState<EngineInsightsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchInsights();
      setData(result);
    } catch (err: any) {
      setError(err.message ?? "Failed to load insights");
    } finally {
      setLoading(false);
    }
  }, [fetchInsights]);

  useEffect(() => {
    if (visible && !data) {
      loadData();
    }
  }, [visible, data, loadData]);

  if (!visible) return null;

  const tabs: { id: TabId; label: string }[] = [
    { id: "cultural", label: "Cultural" },
    { id: "divergence", label: "Divergence" },
    { id: "psychology", label: "Psychology" },
    { id: "targets", label: "Targets" },
  ];

  return (
    <div className="insights-drawer">
      <div className="insights-drawer-header">
        <h3>Engine Insights ({module})</h3>
        <div className="insights-header-actions">
          <button className="insights-refresh" onClick={loadData} disabled={loading} title="Refresh">
            {loading ? "..." : "\u21BB"}
          </button>
          <button className="insights-close" onClick={onClose} title="Close">&times;</button>
        </div>
      </div>

      <div className="insights-tabs">
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`insights-tab ${activeTab === tab.id ? "insights-tab-active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="insights-content">
        {error && <div className="insights-error">{error}</div>}
        {loading && !data && <div className="insights-loading">Loading insights...</div>}
        {data && (
          <>
            {activeTab === "cultural" && <CulturalPanel brief={data.culturalBrief} />}
            {activeTab === "divergence" && <DivergencePanel snapshot={data.divergenceMap} />}
            {activeTab === "psychology" && <PsychologySummaryPanel ledger={data.psychologyLedger} />}
            {activeTab === "targets" && <TargetsPanel targets={data.developmentTargets} />}
          </>
        )}
      </div>
    </div>
  );
}
