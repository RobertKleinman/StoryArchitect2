/**
 * Psychology Engine — shared utilities for computing and formatting
 * the user psychology ledger across modules.
 *
 * v4: BehaviorSignal governance.
 *     - LLM produces raw observations → engine computes confidence + lifecycle
 *     - Signal lifecycle: candidate → active → stable → suppressed
 *     - Confidence is numeric (0–1), computed from evidence count + recency + contradictions
 *     - Contradiction detection: when a signal's contradictionCriteria are met
 *     - Decay: signals lose confidence over turns without reinforcement
 */

import {
  UserPsychologyLedger,
  BehaviorSignal,
  EvidenceEvent,
  RawSignalObservation,
  BehaviorSummary,
  AdaptationPlan,
  AssumptionDelta,
  UserInteractionHeuristics,
  SignalCategory,
  SignalStatus,
  createEmptyLedger,
} from "../../shared/types/userPsychology";

// ─── Ledger shape guard (for imported/deserialized ledgers) ───

/**
 * Ensures a psychology ledger has all required arrays and objects initialized.
 * Handles ledgers imported from upstream modules that may have been serialized
 * with older schema versions or have missing fields.
 */
export function ensureLedgerShape(ledger: UserPsychologyLedger): UserPsychologyLedger {
  if (!ledger.signalStore) ledger.signalStore = ledger.hypothesisStore ?? [];
  if (!ledger.reads) ledger.reads = [];
  if (!ledger.assumptionDeltas) ledger.assumptionDeltas = [];
  if (!ledger.heuristics) {
    ledger.heuristics = {
      typeRatio: 0.5,
      avgResponseLength: 0,
      deferralRate: 0,
      changeRate: 0,
      totalInteractions: 0,
      engagementTrend: 0,
    };
  }
  return ledger;
}

// ─── Signal ID counter (per-session) ───

let nextSignalId = 1;

/** Reset ID counter (call when starting a fresh session) */
export function resetSignalIdCounter(): void {
  nextSignalId = 1;
}

/** @deprecated Use resetSignalIdCounter */
export function resetHypothesisIdCounter(): void {
  resetSignalIdCounter();
}

function generateSignalId(): string {
  return `s${nextSignalId++}`;
}

// ─── Confidence computation ───

/**
 * Compute numeric confidence (0–1) from evidence events and context.
 *
 * Factors:
 *   - Base: 0.15 per supporting evidence event (diminishing after 4)
 *   - Recency bonus: +0.05 for evidence within last 2 turns
 *   - Contradiction penalty: -0.20 per contradicting event
 *   - Turn cap: max 0.3 on turn 1, max 0.5 on turns 2-3
 *   - Cross-turn bonus: +0.1 if evidence spans 3+ distinct turns
 */
function computeConfidence(
  events: EvidenceEvent[],
  currentTurn: number,
): number {
  const supporting = events.filter(e => e.valence === "supports");
  const contradicting = events.filter(e => e.valence === "contradicts");

  // Base from supporting evidence (diminishing returns)
  let conf = 0;
  for (let i = 0; i < supporting.length; i++) {
    conf += i < 4 ? 0.15 : 0.05;
  }

  // Recency bonus
  const recentSupport = supporting.filter(e => currentTurn - e.turn <= 2).length;
  conf += recentSupport * 0.05;

  // Cross-turn bonus
  const distinctTurns = new Set(supporting.map(e => e.turn));
  if (distinctTurns.size >= 3) conf += 0.1;

  // Contradiction penalty
  conf -= contradicting.length * 0.20;

  // Turn cap (prevents overconfidence early)
  const earliestTurn = Math.min(...events.map(e => e.turn));
  const turnsOfHistory = currentTurn - earliestTurn;
  if (turnsOfHistory === 0) conf = Math.min(conf, 0.30);
  else if (turnsOfHistory <= 2) conf = Math.min(conf, 0.50);

  return Math.max(0, Math.min(1, Math.round(conf * 100) / 100));
}

/**
 * Determine signal status from confidence and evidence.
 */
function computeStatus(
  confidence: number,
  events: EvidenceEvent[],
  currentTurn: number,
): SignalStatus {
  const supporting = events.filter(e => e.valence === "supports");
  const contradicting = events.filter(e => e.valence === "contradicts");

  // Suppressed: more contradictions than support, or confidence bottomed out
  if (contradicting.length >= supporting.length && contradicting.length > 0) {
    return "suppressed";
  }
  if (confidence <= 0.05 && events.length > 1) {
    return "suppressed";
  }

  // Stable: 4+ supporting events across 3+ turns
  const distinctSupportTurns = new Set(supporting.map(e => e.turn));
  if (supporting.length >= 4 && distinctSupportTurns.size >= 3 && confidence >= 0.6) {
    return "stable";
  }

  // Active: 2+ supporting events
  if (supporting.length >= 2 && confidence >= 0.25) {
    return "active";
  }

  return "candidate";
}

// ─── Record structured signals from LLM ───

/**
 * Process the LLM's raw signal observations into the signal store.
 * - Merges with existing signals (keyword overlap)
 * - Computes confidence from evidence
 * - Manages lifecycle transitions
 * - Handles contradictions
 */
export function recordSignals(
  ledger: UserPsychologyLedger,
  turnNumber: number,
  module: "hook" | "character" | "character_image" | "world",
  rawSignals: RawSignalObservation[],
  behaviorSummary: BehaviorSummary,
  adaptationPlan: AdaptationPlan,
): void {
  // Record satisfaction
  if (behaviorSummary?.satisfaction) {
    recordSatisfaction(ledger, turnNumber, {
      score: behaviorSummary.satisfaction.score,
      trend: behaviorSummary.satisfaction.trend,
      note: behaviorSummary.satisfaction.reason,
    });
  }

  // Store the per-turn read
  ledger.reads.push({
    turnNumber,
    module,
    signals: rawSignals ?? [],
    behaviorSummary: behaviorSummary ?? {
      orientation: "",
      currentFocus: "",
      engagementMode: "exploring" as const,
      satisfaction: { score: 0.5, trend: "stable" as const, reason: "first turn" },
    },
    adaptationPlan: adaptationPlan ?? { dominantNeed: "", moves: [] },
  });

  // Cap reads at 10
  if (ledger.reads.length > 10) {
    ledger.reads = ledger.reads.slice(-10);
  }

  if (!rawSignals || rawSignals.length === 0) return;

  // Process each raw observation
  for (const raw of rawSignals) {
    processRawSignal(ledger, turnNumber, module, raw);
  }

  // Apply confidence decay to signals not reinforced this turn
  applyConfidenceDecay(ledger, turnNumber);

  // Cap signal store at 12 (was 10 for hypotheses)
  capSignalStore(ledger);
}

/**
 * Backward-compatible wrapper for code still calling recordHypotheses.
 * Converts old-format hypotheses to raw signals.
 */
export function recordHypotheses(
  ledger: UserPsychologyLedger,
  turnNumber: number,
  module: "hook" | "character" | "character_image" | "world",
  hypotheses: {
    hypothesis: string;
    evidence: string;
    confidence: "low" | "medium" | "high";
    scope: string;
    category?: SignalCategory;
  }[],
  overall_read: string,
  satisfaction?: { score: number; trend: "rising" | "stable" | "declining"; note: string }
): void {
  // Convert old hypotheses to raw signals
  const rawSignals: RawSignalObservation[] = (hypotheses ?? []).map(h => ({
    hypothesis: h.hypothesis,
    action: h.evidence,
    valence: "supports" as const,
    scope: (["this_story", "this_genre", "global"].includes(h.scope) ? h.scope : "this_story") as "this_story" | "this_genre" | "global",
    category: h.category ?? inferCategory(h.hypothesis),
    adaptationConsequence: "",
    contradictionCriteria: "",
  }));

  const behaviorSummary: BehaviorSummary = {
    orientation: overall_read ?? "",
    currentFocus: "",
    engagementMode: "exploring",
    satisfaction: satisfaction
      ? { score: satisfaction.score, trend: satisfaction.trend, reason: satisfaction.note }
      : { score: 0.5, trend: "stable", reason: "default" },
  };

  recordSignals(ledger, turnNumber, module, rawSignals, behaviorSummary, { dominantNeed: "", moves: [] });
}

// ─── Core signal processing ───

function processRawSignal(
  ledger: UserPsychologyLedger,
  turnNumber: number,
  module: "hook" | "character" | "character_image" | "world",
  raw: RawSignalObservation,
): void {
  const store = ledger.signalStore;

  // Create the evidence event
  const event: EvidenceEvent = {
    turn: turnNumber,
    module,
    action: raw.action,
    valence: raw.valence,
  };

  // Handle explicit contradiction of a named signal
  if (raw.valence === "contradicts" && raw.contradictsSignalId) {
    const target = store.find(s => s.id === raw.contradictsSignalId);
    if (target) {
      target.evidenceEvents.push(event);
      target.confidence = computeConfidence(target.evidenceEvents, turnNumber);
      target.status = computeStatus(target.confidence, target.evidenceEvents, turnNumber);
      target.lastUpdated = turnNumber;
      if (target.status === "suppressed") {
        target.suppressionReason = `Contradicted at turn ${turnNumber}: ${raw.action}`;
      }
      return;
    }
  }

  // Find similar existing signal (by keyword overlap)
  const existing = findSimilarSignal(store, raw.hypothesis);

  if (existing && existing.status !== "suppressed") {
    // Merge into existing signal
    existing.evidenceEvents.push(event);
    existing.lastUpdated = turnNumber;
    existing.confidence = computeConfidence(existing.evidenceEvents, turnNumber);
    existing.status = computeStatus(existing.confidence, existing.evidenceEvents, turnNumber);

    // Update adaptation consequence if the new one is non-empty
    if (raw.adaptationConsequence) {
      existing.adaptationConsequence = raw.adaptationConsequence;
    }
    if (raw.contradictionCriteria) {
      existing.contradictionCriteria = raw.contradictionCriteria;
    }
  } else {
    // New signal
    const scope = (["this_story", "this_genre", "global"].includes(raw.scope)
      ? raw.scope
      : "this_story") as "this_story" | "this_genre" | "global";

    const newSignal: BehaviorSignal = {
      id: generateSignalId(),
      hypothesis: raw.hypothesis,
      evidenceEvents: [event],
      confidence: computeConfidence([event], turnNumber),
      scope,
      category: raw.category ?? inferCategory(raw.hypothesis),
      status: "candidate",
      adaptationConsequence: raw.adaptationConsequence ?? "",
      contradictionCriteria: raw.contradictionCriteria ?? "",
      firstSeen: turnNumber,
      lastUpdated: turnNumber,
    };

    // Compute initial status
    newSignal.status = computeStatus(newSignal.confidence, newSignal.evidenceEvents, turnNumber);

    store.push(newSignal);
  }
}

// ─── Confidence decay ───

/**
 * Signals not reinforced within 3 turns lose confidence gradually.
 * This prevents stale signals from dominating.
 */
function applyConfidenceDecay(ledger: UserPsychologyLedger, currentTurn: number): void {
  for (const signal of ledger.signalStore) {
    if (signal.status === "suppressed") continue;

    const turnsSinceUpdate = currentTurn - signal.lastUpdated;
    if (turnsSinceUpdate >= 3) {
      // Decay: -0.05 per turn beyond the 3-turn grace period
      const decayAmount = (turnsSinceUpdate - 2) * 0.05;
      signal.confidence = Math.max(0, Math.round((signal.confidence - decayAmount) * 100) / 100);

      // Re-evaluate status
      signal.status = computeStatus(signal.confidence, signal.evidenceEvents, currentTurn);
      if (signal.confidence <= 0.05 && signal.evidenceEvents.length > 1) {
        signal.status = "suppressed";
        signal.suppressionReason = `Decayed: no reinforcement for ${turnsSinceUpdate} turns`;
      }
    }
  }
}

// ─── Signal store management ───

function capSignalStore(ledger: UserPsychologyLedger): void {
  const store = ledger.signalStore;
  if (store.length <= 12) return;

  // Sort: suppressed first (to be dropped), then by confidence (low first), then by age
  store.sort((a, b) => {
    const statusRank: Record<SignalStatus, number> = { suppressed: 0, candidate: 1, active: 2, stable: 3 };
    const statusDiff = statusRank[a.status] - statusRank[b.status];
    if (statusDiff !== 0) return statusDiff;
    const confDiff = a.confidence - b.confidence;
    if (Math.abs(confDiff) > 0.01) return confDiff;
    return a.lastUpdated - b.lastUpdated;
  });

  ledger.signalStore = store.slice(store.length - 12);
}

// ─── Similarity detection ───

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "to", "of", "in", "for",
  "and", "or", "but", "with", "they", "their", "this", "that", "user",
  "prefers", "wants", "likes", "tends", "shows", "seems",
]);

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\W+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

function findSimilarSignal(
  store: BehaviorSignal[],
  text: string,
): BehaviorSignal | undefined {
  const keywords = extractKeywords(text);
  if (keywords.length === 0) return undefined;

  let bestMatch: BehaviorSignal | undefined;
  let bestOverlap = 0;

  for (const s of store) {
    if (s.status === "suppressed") continue;
    const existingKeywords = new Set(extractKeywords(s.hypothesis));
    const overlap = keywords.filter(k => existingKeywords.has(k)).length;
    const overlapRatio = overlap / keywords.length;
    if (overlapRatio > 0.5 && overlap > bestOverlap) {
      bestOverlap = overlap;
      bestMatch = s;
    }
  }

  return bestMatch;
}

// ─── Category inference (fallback when LLM doesn't provide one) ───

const CATEGORY_KEYWORDS: Record<SignalCategory, string[]> = {
  content_preferences: ["prefer", "want", "desire", "enjoy", "like", "theme", "genre", "aesthetic", "tone", "mood", "explicit", "body", "physical", "romantic", "dark", "light"],
  control_orientation: ["control", "direct", "guide", "surprise", "agency", "lead", "follow", "decide", "choice", "steer", "driver", "typed", "clicked", "chip"],
  power_dynamics: ["power", "hierarchy", "authority", "dominan", "submiss", "command", "serve", "obey", "status", "rank"],
  tonal_risk: ["risk", "boundary", "taboo", "push", "edge", "transgress", "bold", "safe", "comfort", "provocat", "absurd"],
  narrative_ownership: ["vision", "ownership", "protect", "specific", "particular", "image", "brand", "audience", "protective"],
  engagement_satisfaction: ["engage", "interest", "bore", "excit", "satisf", "enjoy", "frustrat", "pace", "momentum", "energy"],
};

function inferCategory(hypothesis: string): SignalCategory {
  const lower = hypothesis.toLowerCase();
  let bestCategory: SignalCategory = "content_preferences";
  let bestScore = 0;

  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS) as [SignalCategory, string[]][]) {
    const score = keywords.filter(kw => lower.includes(kw)).length;
    if (score > bestScore) {
      bestScore = score;
      bestCategory = cat;
    }
  }

  return bestCategory;
}

// ─── Persistence tracking ───

/**
 * Check whether prior hypothesis-informed changes are still relevant.
 * A prior change is "faded" ONLY if there's broad dissatisfaction
 * (>75% change rate + declining satisfaction).
 */
export function checkPersistence(
  ledger: UserPsychologyLedger,
  turnNumber: number,
  currentActions: Record<string, "keep" | "alternative" | "freeform" | "not_ready">
): void {
  if (ledger.assumptionDeltas.length < 2) return;

  const currentDelta = ledger.assumptionDeltas[ledger.assumptionDeltas.length - 1];
  const priorDeltas = ledger.assumptionDeltas.slice(0, -1);

  const currentValues = Object.values(currentActions);
  const currentChangeCount = currentValues.filter(a => a === "alternative" || a === "freeform").length;
  const currentTotal = currentValues.filter(a => a !== "not_ready").length;
  const currentChangeRate = currentTotal > 0 ? currentChangeCount / currentTotal : 0;

  const satisfactionDeclining = ledger.heuristics.satisfaction?.trend === "declining";
  const broadDissatisfaction = currentChangeRate > 0.75 && satisfactionDeclining;

  const priorChanges: Array<{ hypothesis_id: string; change_applied: string; still_relevant: boolean }> = [];

  for (const delta of priorDeltas) {
    const priorChangeCount = Object.values(delta.actions).filter(
      a => a === "alternative" || a === "freeform"
    ).length;
    if (priorChangeCount === 0) continue;

    const relatedSignals = ledger.signalStore.filter(s =>
      s.status !== "suppressed" && s.lastUpdated === delta.turnNumber
    );

    for (const sig of relatedSignals) {
      priorChanges.push({
        hypothesis_id: sig.id,
        change_applied: `Turn ${delta.turnNumber}: user made ${priorChangeCount} changes, updating "${sig.hypothesis.slice(0, 50)}"`,
        still_relevant: !broadDissatisfaction,
      });
    }
  }

  if (priorChanges.length > 0 && currentDelta) {
    currentDelta.prior_changes = priorChanges;
  }
}

// ─── Satisfaction (LLM-assessed) ───

export function recordSatisfaction(
  ledger: UserPsychologyLedger,
  turnNumber: number,
  satisfaction?: { score: number; trend: "rising" | "stable" | "declining"; note: string }
): void {
  if (!satisfaction) return;

  ledger.heuristics.satisfaction = {
    score: Math.round(Math.max(0, Math.min(1, satisfaction.score)) * 100) / 100,
    trend: satisfaction.trend,
    last_computed_turn: turnNumber,
  };
}

// ─── Assumption delta (non-choice tracking — unchanged) ───

export function recordAssumptionDelta(
  ledger: UserPsychologyLedger,
  turnNumber: number,
  offeredIds: string[],
  respondedIds: string[],
  actions: Record<string, "keep" | "alternative" | "freeform" | "not_ready">
): void {
  const respondedSet = new Set(respondedIds);
  const ignored = offeredIds.filter(id => !respondedSet.has(id));

  ledger.assumptionDeltas.push({
    turnNumber,
    offered: offeredIds,
    responded: respondedIds,
    ignored,
    actions,
  });

  if (ledger.assumptionDeltas.length > 5) {
    ledger.assumptionDeltas = ledger.assumptionDeltas.slice(-5);
  }
}

// ─── Heuristics (v2: cross-module accumulation — unchanged) ───

export function updateHeuristics(
  ledger: UserPsychologyLedger,
  currentModuleStats: {
    typedCount: number;
    clickedCount: number;
    totalAssumptions: number;
    deferredAssumptions: number;
    changedAssumptions: number;
    responseLengths: number[];
  }
): void {
  const h = ledger.heuristics;

  const baseline = h._importedBaseline ?? {
    typedCount: 0, clickedCount: 0, totalAssumptions: 0,
    deferredAssumptions: 0, changedAssumptions: 0, responseLengths: [],
  };

  const currentTotal = currentModuleStats.typedCount + currentModuleStats.clickedCount;
  if (currentTotal === 0 && currentModuleStats.totalAssumptions === 0) return;

  const combined = {
    typedCount: baseline.typedCount + currentModuleStats.typedCount,
    clickedCount: baseline.clickedCount + currentModuleStats.clickedCount,
    totalAssumptions: baseline.totalAssumptions + currentModuleStats.totalAssumptions,
    deferredAssumptions: baseline.deferredAssumptions + currentModuleStats.deferredAssumptions,
    changedAssumptions: baseline.changedAssumptions + currentModuleStats.changedAssumptions,
    responseLengths: [...baseline.responseLengths, ...currentModuleStats.responseLengths],
  };

  const total = combined.typedCount + combined.clickedCount;

  h.totalInteractions = total + combined.totalAssumptions;
  h.typeRatio = total > 0 ? combined.typedCount / total : 0.5;
  h.deferralRate = combined.totalAssumptions > 0
    ? combined.deferredAssumptions / combined.totalAssumptions : 0;
  h.changeRate = combined.totalAssumptions > 0
    ? combined.changedAssumptions / combined.totalAssumptions : 0;

  const lengths = combined.responseLengths;
  if (lengths.length > 0) {
    h.avgResponseLength = Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length);
  }

  if (lengths.length >= 4) {
    const firstHalf = lengths.slice(0, Math.floor(lengths.length / 2));
    const secondHalf = lengths.slice(Math.floor(lengths.length / 2));
    const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
    if (avgSecond > avgFirst * 1.3) h.engagementTrend = 1;
    else if (avgSecond < avgFirst * 0.7) h.engagementTrend = -1;
    else h.engagementTrend = 0;
  }

  h._rawStats = combined;
}

export function snapshotBaselineForNewModule(ledger: UserPsychologyLedger): void {
  const h = ledger.heuristics;
  if (h._rawStats) {
    h._importedBaseline = { ...h._rawStats };
  } else if (h.totalInteractions > 0) {
    const total = h.totalInteractions;
    const hasAssumptions = h.changeRate > 0 || h.deferralRate > 0;
    const assumptionCount = hasAssumptions ? Math.round(total * 0.5) : 0;
    const responseCount = total - assumptionCount;
    h._importedBaseline = {
      typedCount: Math.round(responseCount * h.typeRatio),
      clickedCount: responseCount - Math.round(responseCount * h.typeRatio),
      totalAssumptions: assumptionCount,
      deferredAssumptions: Math.round(assumptionCount * h.deferralRate),
      changedAssumptions: Math.round(assumptionCount * h.changeRate),
      responseLengths: h.avgResponseLength > 0
        ? Array(Math.round(responseCount * h.typeRatio)).fill(h.avgResponseLength) : [],
    };
  } else {
    h._importedBaseline = {
      typedCount: 0, clickedCount: 0, totalAssumptions: 0,
      deferredAssumptions: 0, changedAssumptions: 0, responseLengths: [],
    };
  }
}

// ─── Formatting for prompts ───

/**
 * STORAGE vs PROMPT BOUNDARY
 * ===========================
 * The ledger stores everything. This formatter produces a CURATED view for the LLM.
 *
 * What goes into the prompt:
 *   - Interaction heuristics summary
 *   - Top signals by confidence (active + stable only), grouped by category
 *   - Suppressed signals (brief, so LLM doesn't repeat them)
 *   - Last turn's assumption delta
 *   - Last turn's behavior summary
 *   - Last turn's adaptation plan
 *
 * What stays in storage only:
 *   - Full signal store (all 12)
 *   - All evidence events on each signal
 *   - All assumption deltas (last 5 turns)
 *   - All per-turn reads (last 10)
 */
export function formatPsychologyLedgerForPrompt(
  ledger: UserPsychologyLedger | undefined
): string {
  if (!ledger) return "(No user observations yet — this is a new user)";

  // Guard imported/deserialized ledgers with missing fields
  ensureLedgerShape(ledger);

  const lines: string[] = [];
  const h = ledger.heuristics;

  // ── Interaction style summary ──
  if (h.totalInteractions >= 2) {
    const style =
      h.typeRatio > 0.65 ? "mostly types (directorial, detailed)"
      : h.typeRatio < 0.35 ? "mostly clicks options (explorer, fast)"
      : "mixed (types and clicks)";
    lines.push(`Interaction: ${style}, avg response ${h.avgResponseLength} words`);

    if (h.deferralRate > 0.3) {
      lines.push(`Note: defers ${Math.round(h.deferralRate * 100)}% of assumptions — may prefer bolder leading`);
    }
    if (h.changeRate > 0.4) {
      lines.push(`Note: changes ${Math.round(h.changeRate * 100)}% of assumptions — opinionated, give more to react to`);
    }
    if (h.engagementTrend === -1) {
      lines.push(`Warning: responses getting shorter — engagement may be dropping. Be more provocative.`);
    } else if (h.engagementTrend === 1) {
      lines.push(`Responses getting longer — engagement increasing. Match their energy.`);
    }
  }

  // ── Active + stable signals (prompt view: up to 6, category-aware) ──
  const signalStore = ledger.signalStore ?? ledger.hypothesisStore ?? [];
  const activeSignals = signalStore.filter(s => s.status === "active" || s.status === "stable");
  if (activeSignals.length > 0) {
    const sorted = [...activeSignals].sort((a, b) => b.confidence - a.confidence);

    // Category-aware selection
    const MAX_PROMPT_SIGNALS = 6;
    const selected = new Set<string>();
    const seenCategories = new Set<string>();

    // Pass 1: one per category
    for (const s of sorted) {
      if (!seenCategories.has(s.category) && selected.size < MAX_PROMPT_SIGNALS) {
        selected.add(s.id);
        seenCategories.add(s.category);
      }
    }
    // Pass 2: fill by confidence
    for (const s of sorted) {
      if (selected.size >= MAX_PROMPT_SIGNALS) break;
      if (!selected.has(s.id)) selected.add(s.id);
    }

    const promptSignals = sorted.filter(s => selected.has(s.id));
    const byCategory = new Map<string, typeof promptSignals>();
    for (const s of promptSignals) {
      if (!byCategory.has(s.category)) byCategory.set(s.category, []);
      byCategory.get(s.category)!.push(s);
    }

    lines.push("");
    lines.push("ACTIVE BEHAVIOR SIGNALS:");
    for (const [cat, sigs] of byCategory) {
      lines.push(`  [${cat}]`);
      for (const s of sigs) {
        const evCount = s.evidenceEvents.filter(e => e.valence === "supports").length;
        const lastAction = s.evidenceEvents.length > 0
          ? s.evidenceEvents[s.evidenceEvents.length - 1].action
          : "";
        const actionPreview = lastAction.length > 60 ? lastAction.slice(0, 57) + "..." : lastAction;
        lines.push(`    [${s.id}] (${s.status}, conf=${s.confidence}) "${s.hypothesis}"`);
        lines.push(`      evidence: ${evCount} events, latest: "${actionPreview}"`);
        if (s.adaptationConsequence) {
          lines.push(`      adapt: ${s.adaptationConsequence}`);
        }
      }
    }
    if (activeSignals.length > MAX_PROMPT_SIGNALS) {
      lines.push(`  (${activeSignals.length - MAX_PROMPT_SIGNALS} more in storage, not shown)`);
    }
    lines.push("  → Confirm, refine, or contradict these based on this turn's behavior.");
  }

  // ── Candidate signals (brief) ──
  const candidates = signalStore.filter(s => s.status === "candidate");
  if (candidates.length > 0) {
    lines.push("");
    lines.push(`CANDIDATE SIGNALS (${candidates.length} — need more evidence):`);
    for (const s of candidates.slice(0, 3)) {
      lines.push(`    [${s.id}] (conf=${s.confidence}) "${s.hypothesis}"`);
    }
    if (candidates.length > 3) {
      lines.push(`    (${candidates.length - 3} more candidates not shown)`);
    }
  }

  // ── Suppressed signals (so LLM doesn't repeat them) ──
  const suppressed = signalStore.filter(s => s.status === "suppressed");
  if (suppressed.length > 0) {
    lines.push("");
    lines.push("SUPPRESSED (do not repeat — contradicted or decayed):");
    for (const s of suppressed) {
      lines.push(`  [${s.id}] "${s.hypothesis}" — ${s.suppressionReason ?? "suppressed"}`);
    }
  }

  // ── Last turn's assumption delta ──
  const assumptionDeltas = ledger.assumptionDeltas ?? [];
  const lastDelta = assumptionDeltas.length > 0
    ? assumptionDeltas[assumptionDeltas.length - 1]
    : null;

  if (lastDelta && lastDelta.ignored.length > 0) {
    lines.push("");
    lines.push(`ASSUMPTIONS IGNORED LAST TURN (${lastDelta.ignored.length} of ${lastDelta.offered.length} offered):`);
    lines.push(`  Ignored IDs: ${lastDelta.ignored.join(", ")}`);
    lines.push("  → These areas may not matter to them yet. Don't force. Try different angles or wait.");
  }

  // ── Persistence summary ──
  if (lastDelta?.prior_changes && lastDelta.prior_changes.length > 0) {
    const stillActive = lastDelta.prior_changes.filter(p => p.still_relevant).length;
    const total = lastDelta.prior_changes.length;
    lines.push("");
    lines.push(`PERSISTENCE SUMMARY: ${stillActive} of ${total} prior changes still active`);
    if (stillActive < total) {
      const faded = lastDelta.prior_changes.filter(p => !p.still_relevant);
      for (const f of faded) {
        lines.push(`  [${f.hypothesis_id}] change faded: ${f.change_applied}`);
      }
    }
  }

  // ── Satisfaction signal ──
  if (h.satisfaction) {
    lines.push("");
    lines.push(`SATISFACTION: ${Math.round(h.satisfaction.score * 100)}% (${h.satisfaction.trend})`);
    if (h.satisfaction.trend === "declining") {
      lines.push("  Warning: user satisfaction declining — be more responsive to their vision, less formulaic.");
    }
  }

  // ── Last turn's behavior summary ──
  const lastRead = ledger.reads.length > 0 ? ledger.reads[ledger.reads.length - 1] : null;
  if (lastRead?.behaviorSummary) {
    const bs = lastRead.behaviorSummary;
    lines.push("");
    lines.push(`LAST TURN SUMMARY: "${bs.orientation}" | focus: ${bs.currentFocus} | mode: ${bs.engagementMode}`);
  } else if (lastRead?.overall_read) {
    lines.push("");
    lines.push(`Last turn synthesis: "${lastRead.overall_read}"`);
  }

  // ── Last turn's adaptation plan ──
  if (lastRead?.adaptationPlan && lastRead.adaptationPlan.moves.length > 0) {
    lines.push("");
    lines.push(`LAST ADAPTATION PLAN: "${lastRead.adaptationPlan.dominantNeed}"`);
    for (const move of lastRead.adaptationPlan.moves) {
      lines.push(`  → ${move.action} [targets: ${move.target}] [driven by: ${move.drivenBy.join(", ")}]`);
    }
    lines.push("  Check: did last turn's plan work? If not, adjust strategy.");
  }

  if (lines.length === 0) {
    return "(No user observations yet — read them from their first response)";
  }

  return lines.join("\n");
}

/**
 * Format signals specifically for builder/judge prompts.
 * Shorter than the full clarifier view — only active/stable signals + adaptation consequences.
 */
export function formatSignalsForBuilderJudge(
  ledger: UserPsychologyLedger | undefined
): string {
  if (!ledger) return "(No behavior signals — first-time user)";

  // Guard imported/deserialized ledgers with missing fields
  ensureLedgerShape(ledger);

  const lines: string[] = [];

  // Only active + stable signals
  const signals = ledger.signalStore
    .filter(s => s.status === "active" || s.status === "stable")
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);

  if (signals.length === 0) return "(No confirmed behavior signals yet)";

  lines.push("USER BEHAVIOR SIGNALS (shape your output accordingly):");
  for (const s of signals) {
    lines.push(`  [${s.id}] (${s.status}, conf=${s.confidence}) "${s.hypothesis}"`);
    if (s.adaptationConsequence) {
      lines.push(`    → ${s.adaptationConsequence}`);
    }
  }

  // Heuristics summary
  const h = ledger.heuristics;
  if (h.totalInteractions >= 2) {
    const style = h.typeRatio > 0.65 ? "directorial (types a lot)"
      : h.typeRatio < 0.35 ? "explorer (clicks options)"
      : "mixed";
    lines.push(`  User style: ${style}`);
  }

  if (h.satisfaction) {
    lines.push(`  Satisfaction: ${Math.round(h.satisfaction.score * 100)}% (${h.satisfaction.trend})`);
  }

  return lines.join("\n");
}

export { createEmptyLedger };
