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
  StabilityClass,
  SignalSource,
  PsychologyModule,
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
  if (!ledger.probeHistory) ledger.probeHistory = [];
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

// ─── Signal ID generation (per-ledger, not global) ───

/**
 * Generate a unique signal ID scoped to the given ledger.
 * Uses the ledger's own counter to avoid cross-session collisions.
 */
function generateSignalId(ledger: UserPsychologyLedger): string {
  if (ledger.nextSignalId == null) {
    // Bootstrap from existing signals for ledgers imported from older versions
    const existingMax = ledger.signalStore.reduce((max, s) => {
      const num = parseInt(s.id.replace(/^s/, ""), 10);
      return Number.isFinite(num) && num > max ? num : max;
    }, 0);
    ledger.nextSignalId = existingMax + 1;
  }
  return `s${ledger.nextSignalId++}`;
}

/** @deprecated No-op — signal IDs are now per-ledger */
export function resetSignalIdCounter(): void { /* no-op */ }

/** @deprecated No-op — signal IDs are now per-ledger */
export function resetHypothesisIdCounter(): void { /* no-op */ }

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
  if (events.length === 0) return 0;

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
  module: PsychologyModule,
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
  module: PsychologyModule,
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

// ─── Stability classification ───

/**
 * Derive stability class from category and source.
 * Core categories (content_preferences, tonal_risk) are always core.
 * Explicit signals from direct user statements get promoted to at least medium.
 * engagement_satisfaction signals are volatile (micro-tactics).
 */
function deriveStabilityClass(category: SignalCategory, source: SignalSource): StabilityClass {
  // Foundational creative preferences — always core
  if (category === "content_preferences" || category === "tonal_risk") {
    return "core";
  }
  // Engagement micro-tactics — always volatile
  if (category === "engagement_satisfaction") {
    return "volatile";
  }
  // Explicit user statements about other categories get medium (not volatile)
  // Inferred signals about other categories get medium too (default)
  return source === "explicit" ? "medium" : "medium";
}

// ─── Core signal processing ───

function processRawSignal(
  ledger: UserPsychologyLedger,
  turnNumber: number,
  module: PsychologyModule,
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

  // Handle explicit reinforcement of a named signal (preferred path —
  // avoids relying on keyword overlap for signal deduplication)
  if (raw.reinforcesSignalId) {
    const target = store.find(s => s.id === raw.reinforcesSignalId);
    if (target && target.status !== "suppressed") {
      target.evidenceEvents.push(event);
      target.lastUpdated = turnNumber;
      target.confidence = computeConfidence(target.evidenceEvents, turnNumber);
      target.status = computeStatus(target.confidence, target.evidenceEvents, turnNumber);
      if (raw.adaptationConsequence) {
        target.adaptationConsequence = raw.adaptationConsequence;
      }
      if (raw.contradictionCriteria) {
        target.contradictionCriteria = raw.contradictionCriteria;
      }
      return;
    }
    // If the named signal doesn't exist (stale ID), fall through to keyword match
  }

  // Fallback: find similar existing signal (by keyword overlap)
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

    const category = raw.category ?? inferCategory(raw.hypothesis);
    const source = raw.source ?? "inferred";
    // Core stability for foundational categories, or if LLM marks as explicit
    const stabilityClass = deriveStabilityClass(category, source);

    const newSignal: BehaviorSignal = {
      id: generateSignalId(ledger),
      hypothesis: raw.hypothesis,
      evidenceEvents: [event],
      confidence: computeConfidence([event], turnNumber),
      scope,
      category,
      status: "candidate",
      adaptationConsequence: raw.adaptationConsequence ?? "",
      contradictionCriteria: raw.contradictionCriteria ?? "",
      firstSeen: turnNumber,
      lastUpdated: turnNumber,
      source,
      stabilityClass,
    };

    // Compute initial status
    newSignal.status = computeStatus(newSignal.confidence, newSignal.evidenceEvents, turnNumber);

    store.push(newSignal);
  }
}

// ─── Confidence decay ───

/**
 * Signals not reinforced within a grace period lose confidence gradually.
 * Decay rate and grace period depend on stability class:
 *   - core:     6-turn grace, 0.025/turn decay, floor at 0.10 (never fully suppresses)
 *   - medium:   3-turn grace, 0.05/turn decay, standard suppression at 0.05
 *   - volatile: 3-turn grace, 0.05/turn decay, standard suppression at 0.05
 *
 * This prevents foundational creative preferences (genre, tone, boundaries)
 * from vanishing because the user spent a few turns on local details.
 */
function applyConfidenceDecay(ledger: UserPsychologyLedger, currentTurn: number): void {
  for (const signal of ledger.signalStore) {
    if (signal.status === "suppressed") continue;

    const stability = signal.stabilityClass ?? "medium";
    const gracePeriod = stability === "core" ? 6 : 3;
    const decayRate = stability === "core" ? 0.025 : 0.05;
    const confidenceFloor = stability === "core" ? 0.10 : 0;

    const turnsSinceUpdate = currentTurn - signal.lastUpdated;
    if (turnsSinceUpdate >= gracePeriod) {
      const decayAmount = (turnsSinceUpdate - (gracePeriod - 1)) * decayRate;
      signal.confidence = Math.max(confidenceFloor, Math.round((signal.confidence - decayAmount) * 100) / 100);

      // Re-evaluate status
      signal.status = computeStatus(signal.confidence, signal.evidenceEvents, currentTurn);

      // Core signals never fully suppress from decay — they can go low but not disappear
      if (stability !== "core" && signal.confidence <= 0.05 && signal.evidenceEvents.length > 1) {
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
  // Mark any unconsumed probe as consumed so it doesn't leak into the new module.
  // The probe was generated for the previous module's context and would confuse the
  // new module's clarifier if injected.
  if (ledger.lastConsolidation && !ledger.lastConsolidation.probeConsumed) {
    ledger.lastConsolidation.probeConsumed = true;
  }

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

  // Only active + stable signals — top 3 by confidence (focused, not overwhelming)
  const signals = ledger.signalStore
    .filter(s => s.status === "active" || s.status === "stable")
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3);

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

// ─── Engine Dials: derive concrete settings from signals ───

/**
 * Derived settings that directly shape prompt behavior.
 * Computed from the signal store + heuristics — not from the LLM.
 * These are injected into prompts as structured directives.
 */
export interface EngineDials {
  /** How many options to offer (2-5). Explorers get more, convergers get fewer. */
  optionCount: number;
  /** How bold assumptions should be. "conservative" = safe inferences, "provocative" = challenge the user */
  assumptionBoldness: "conservative" | "moderate" | "provocative";
  /** Tone register for questions. "playful" / "direct" / "warm" */
  questionTone: "playful" | "direct" | "warm";
  /** How much to lead vs follow. 0 = pure follower, 1 = pure leader */
  leadingStrength: number;
  /** Content emphasis — which categories to prioritize in output */
  contentEmphasis: string[];
  /** Things to avoid based on signals */
  avoidances: string[];
}

/**
 * Compute engine dials from the psychology ledger.
 * These are deterministic derivations, not LLM output.
 */
export function computeEngineDials(
  ledger: UserPsychologyLedger | undefined
): EngineDials {
  const defaults: EngineDials = {
    optionCount: 4,
    assumptionBoldness: "moderate",
    questionTone: "playful",
    leadingStrength: 0.5,
    contentEmphasis: [],
    avoidances: [],
  };

  if (!ledger) return defaults;
  ensureLedgerShape(ledger);

  const h = ledger.heuristics;
  const activeSignals = ledger.signalStore
    .filter(s => s.status === "active" || s.status === "stable")
    .sort((a, b) => b.confidence - a.confidence);

  // ── STEP 1: Heuristic-based defaults (from interaction metrics) ──

  // Option count: explorers get more choices, convergers get fewer
  if (h.typeRatio < 0.35) {
    // Clicker — likes guided choices
    defaults.optionCount = 4;
  } else if (h.typeRatio > 0.65) {
    // Typer — has their own vision, fewer preset options
    defaults.optionCount = 3;
  }

  // Assumption boldness: high change rate + rising satisfaction = they want provocation
  if (h.changeRate > 0.4 && h.satisfaction?.trend !== "declining") {
    defaults.assumptionBoldness = "provocative";
  } else if (h.satisfaction?.trend === "declining") {
    defaults.assumptionBoldness = "conservative";
  }

  // Question tone: match engagement
  if (h.engagementTrend === -1 || h.satisfaction?.trend === "declining") {
    defaults.questionTone = "direct"; // stop being cute, get to the point
  } else if (h.engagementTrend === 1) {
    defaults.questionTone = "playful"; // they're having fun, match it
  }

  // Leading strength: high deferrals = they want more leading
  if (h.deferralRate > 0.3) {
    defaults.leadingStrength = 0.7;
  } else if (h.changeRate > 0.5) {
    defaults.leadingStrength = 0.3; // they're opinionated, follow more
  }

  // ── STEP 2: Engagement mode modulation (from most recent behaviorSummary) ──
  // The engagement mode is a structured field — more contextual than raw heuristics.
  // When it contradicts the heuristic, the engagement mode wins.
  const lastRead = ledger.reads.length > 0 ? ledger.reads[ledger.reads.length - 1] : null;
  const engagementMode = lastRead?.behaviorSummary?.engagementMode;

  if (engagementMode === "exploring") {
    // User is exploring — give them more options even if they type a lot
    defaults.optionCount = Math.max(defaults.optionCount, 4);
  } else if (engagementMode === "converging") {
    // User is narrowing — fewer options, more focused
    defaults.optionCount = Math.min(defaults.optionCount, 3);
  } else if (engagementMode === "stuck") {
    // User is stuck — be bolder and lead harder to break the loop
    defaults.assumptionBoldness = "provocative";
    defaults.leadingStrength = Math.max(defaults.leadingStrength, 0.7);
  } else if (engagementMode === "disengaged") {
    // User is losing interest — switch to direct tone, be more provocative
    defaults.questionTone = "direct";
    defaults.assumptionBoldness = "provocative";
    defaults.leadingStrength = Math.max(defaults.leadingStrength, 0.6);
  }

  // ── STEP 3: Signal-aware overrides (high-confidence signals trump heuristics) ──
  // Scan the top signals for adaptation consequences that directly conflict with
  // dial settings. Only override when confidence >= 0.5 (reliable pattern).
  for (const s of activeSignals) {
    if (s.confidence < 0.5) break; // sorted by confidence, so we can stop early

    const conseq = s.adaptationConsequence.toLowerCase();

    // Option count overrides
    if (/\bmore\s+(options|choices|chips)\b/.test(conseq)) {
      defaults.optionCount = Math.max(defaults.optionCount, 5);
    } else if (/\bfewer\s+(options|choices|chips)\b/.test(conseq)) {
      defaults.optionCount = Math.min(defaults.optionCount, 3);
    }

    // Boldness overrides
    if (/\bbolder\b|\bmore\s+provocat/.test(conseq)) {
      defaults.assumptionBoldness = "provocative";
    } else if (/\bsafer\b|\bmore\s+conservat|\bgentle/.test(conseq)) {
      defaults.assumptionBoldness = "conservative";
    }

    // Leading strength overrides
    if (/\blead\s+more\b|\bmore\s+leading\b|\bstronger\s+proposals\b/.test(conseq)) {
      defaults.leadingStrength = Math.max(defaults.leadingStrength, 0.7);
    } else if (/\bfollow\b|\btheir\s+vision\b|\bless\s+leading\b|\bmore\s+space\b/.test(conseq)) {
      defaults.leadingStrength = Math.min(defaults.leadingStrength, 0.3);
    }
  }

  // ── Content emphasis: from top signals ──
  for (const s of activeSignals.slice(0, 3)) {
    if (s.adaptationConsequence) {
      defaults.contentEmphasis.push(s.adaptationConsequence);
    }
  }

  // ── Avoidances: from suppressed signals ──
  for (const s of ledger.signalStore.filter(s => s.status === "suppressed")) {
    if (s.adaptationConsequence) {
      defaults.avoidances.push(`AVOID (contradicted): ${s.adaptationConsequence}`);
    }
  }

  return defaults;
}

/**
 * Format engine dials as a prompt fragment for injection.
 */
export function formatEngineDialsForPrompt(
  ledger: UserPsychologyLedger | undefined
): string {
  const dials = computeEngineDials(ledger);

  const lines: string[] = [];
  lines.push("═══ ENGINE DIALS (follow these — they're computed from observed behavior) ═══");
  lines.push(`Options to offer: ${dials.optionCount}`);
  lines.push(`Assumption boldness: ${dials.assumptionBoldness}`);
  lines.push(`Question tone: ${dials.questionTone}`);
  lines.push(`Leading strength: ${dials.leadingStrength.toFixed(1)} (0=follow their vision, 1=lead boldly)`);

  if (dials.contentEmphasis.length > 0) {
    lines.push("PRIORITIZE in your output:");
    for (const e of dials.contentEmphasis) {
      lines.push(`  → ${e}`);
    }
  }

  if (dials.avoidances.length > 0) {
    lines.push("AVOID in your output:");
    for (const a of dials.avoidances) {
      lines.push(`  → ${a}`);
    }
  }

  return lines.join("\n");
}

// ─── Background consolidation (runs during user think-time) ───

import {
  CONSOLIDATION_SYSTEM,
  CONSOLIDATION_USER_TEMPLATE,
  CONSOLIDATION_SCHEMA,
} from "./consolidationPrompts";
import type { LLMClient } from "./llmClient";
import type {
  ConsolidationResult,
  ConsolidatedSignal,
  ConsolidationSnapshot,
} from "../../shared/types/userPsychology";

/**
 * Run background psychology consolidation. Called async after each clarifier
 * response — does NOT block the user-facing response.
 *
 * The LLM receives the full signal store + recent reads and decides what
 * to do: merge, prune, promote, suggest probes, or do nothing.
 *
 * Returns the ConsolidationSnapshot, or null if the consolidation was
 * skipped (too early, no signals, or LLM call failed).
 */
export async function runConsolidation(
  ledger: UserPsychologyLedger,
  turnNumber: number,
  module: PsychologyModule,
  llm: LLMClient,
): Promise<ConsolidationSnapshot | null> {
  // Guard: skip if no signals to consolidate
  if (!ledger.signalStore || ledger.signalStore.length === 0) {
    return null;
  }

  // Guard: skip on first turn — not enough data
  if (turnNumber <= 1) {
    return null;
  }

  // Guard: skip if last consolidation was this same turn (prevent double-fire)
  if (ledger.lastConsolidation?.afterTurn === turnNumber) {
    return null;
  }

  ensureLedgerShape(ledger);

  // Evaluate the outcome of any previously injected probe before this consolidation
  evaluateProbeOutcome(ledger);

  // Build the prompt
  const signalStoreJson = JSON.stringify(
    ledger.signalStore.map(s => ({
      id: s.id,
      hypothesis: s.hypothesis,
      confidence: s.confidence,
      status: s.status,
      category: s.category,
      scope: s.scope,
      adaptationConsequence: s.adaptationConsequence,
      contradictionCriteria: s.contradictionCriteria,
      evidenceCount: s.evidenceEvents.length,
      supportingCount: s.evidenceEvents.filter(e => e.valence === "supports").length,
      contradictingCount: s.evidenceEvents.filter(e => e.valence === "contradicts").length,
      firstSeen: s.firstSeen,
      lastUpdated: s.lastUpdated,
      // Include last 2 evidence events for context
      recentEvidence: s.evidenceEvents.slice(-2).map(e => ({
        turn: e.turn,
        action: e.action,
        valence: e.valence,
      })),
    })),
    null,
    2
  );

  // Recent reads (last 2-3)
  const recentReads = ledger.reads.slice(-3).map(r => ({
    turnNumber: r.turnNumber,
    module: r.module,
    signals: r.signals?.slice(0, 3) ?? [],
    behaviorSummary: r.behaviorSummary,
    adaptationPlan: r.adaptationPlan,
  }));

  const heuristicsJson = JSON.stringify({
    typeRatio: ledger.heuristics.typeRatio,
    avgResponseLength: ledger.heuristics.avgResponseLength,
    deferralRate: ledger.heuristics.deferralRate,
    changeRate: ledger.heuristics.changeRate,
    totalInteractions: ledger.heuristics.totalInteractions,
    engagementTrend: ledger.heuristics.engagementTrend,
    satisfaction: ledger.heuristics.satisfaction,
  }, null, 2);

  // Build probe outcome section if available
  let probeOutcomeSection = "";
  if (ledger.lastConsolidation?.probeOutcome) {
    const po = ledger.lastConsolidation.probeOutcome;
    const probe = ledger.lastConsolidation.result.suggestedProbe;
    probeOutcomeSection = `═══ LAST PROBE OUTCOME ═══
Probe injected on turn ${po.injectedOnTurn}: "${probe?.angle ?? "(unknown)"}"
Targeted signals: ${probe?.targetSignalIds?.join(", ") ?? "(unknown)"}
Outcome: ${po.outcome}${po.answeredOnTurn ? ` (user responded on turn ${po.answeredOnTurn})` : ""}
${po.outcome === "confirmed" ? "→ The probe worked. Consider probing a different ambiguity this time." :
  po.outcome === "contradicted" ? "→ The probe surfaced a contradiction. Check if related signals need updating." :
  po.outcome === "ignored" ? "→ The probe was ignored. Try a different angle or don't probe this turn." :
  "→ Inconclusive. The user responded but it didn't clearly resolve the ambiguity."}`;
  }

  const userPrompt = CONSOLIDATION_USER_TEMPLATE
    .replace("{{SIGNAL_STORE_JSON}}", signalStoreJson)
    .replace("{{RECENT_READS_JSON}}", JSON.stringify(recentReads, null, 2))
    .replace("{{HEURISTICS_JSON}}", heuristicsJson)
    .replace("{{PROBE_OUTCOME_SECTION}}", probeOutcomeSection)
    .replace("{{MODULE}}", module)
    .replace("{{TURN_NUMBER}}", String(turnNumber));

  try {
    const raw = await llm.call("psych_consolidator", CONSOLIDATION_SYSTEM, userPrompt, {
      temperature: 0.3,  // low temp — this is analytical, not creative
      maxTokens: 2000,
      jsonSchema: CONSOLIDATION_SCHEMA,
    });

    const result: ConsolidationResult = JSON.parse(raw);

    // Apply the consolidation to the ledger
    applyConsolidation(ledger, result, turnNumber, module);

    // Store the snapshot
    const snapshot: ConsolidationSnapshot = {
      timestamp: new Date().toISOString(),
      afterTurn: turnNumber,
      module,
      result,
      probeConsumed: false,
    };

    ledger.lastConsolidation = snapshot;

    console.log(
      `[PSYCH] Consolidation after turn ${turnNumber}: ` +
      `${ledger.signalStore.length} signals, ` +
      `probe=${result.suggestedProbe ? "yes" : "no"}, ` +
      `reasoning=${result.reasoning?.slice(0, 80) ?? "none"}`
    );

    return snapshot;
  } catch (err) {
    // Consolidation failure is non-fatal — the system works without it
    console.error(`[PSYCH] Consolidation failed (turn ${turnNumber}):`, err);
    return null;
  }
}

/**
 * Apply the LLM's consolidation result to the ledger.
 * Replaces the signal store with the consolidated version,
 * preserving evidence events from the original signals.
 */
export function applyConsolidation(
  ledger: UserPsychologyLedger,
  result: ConsolidationResult,
  turnNumber: number,
  module: PsychologyModule = "hook",
): void {
  if (!result.updatedSignals || result.updatedSignals.length === 0) {
    return; // LLM returned empty — don't wipe the store
  }

  // Build a lookup of existing signals by ID for evidence preservation
  const existingById = new Map<string, BehaviorSignal>();
  for (const s of ledger.signalStore) {
    existingById.set(s.id, s);
  }

  // Build the new signal store
  const newStore: BehaviorSignal[] = [];

  for (const cs of result.updatedSignals) {
    // Collect evidence events: from the signal itself + any absorbed signals
    const allEvidence: EvidenceEvent[] = [];

    // Evidence from the primary signal (if it existed)
    const primary = existingById.get(cs.id);
    if (primary) {
      allEvidence.push(...primary.evidenceEvents);
    }

    // Evidence from absorbed signals
    for (const absorbedId of cs.absorbedIds) {
      const absorbed = existingById.get(absorbedId);
      if (absorbed) {
        allEvidence.push(...absorbed.evidenceEvents);
      }
    }

    // Deduplicate evidence events by turn + action
    const seen = new Set<string>();
    const dedupedEvidence: EvidenceEvent[] = [];
    for (const ev of allEvidence) {
      const key = `${ev.turn}:${ev.action.slice(0, 50)}`;
      if (!seen.has(key)) {
        seen.add(key);
        dedupedEvidence.push(ev);
      }
    }

    // If no existing evidence (new merge ID?), create a synthetic event
    if (dedupedEvidence.length === 0) {
      dedupedEvidence.push({
        turn: turnNumber,
        module,
        action: "consolidated from prior observations",
        valence: "supports",
      });
    }

    // Preserve source and stability from the primary signal, or derive from absorbed signals.
    // If merging, promote to the most protective source/stability among merged signals.
    const mergedSignals = [primary, ...cs.absorbedIds.map(id => existingById.get(id))].filter(Boolean) as BehaviorSignal[];
    const bestSource = mergedSignals.some(s => s.source === "explicit") ? "explicit" as const : (primary?.source ?? "inferred" as const);
    const bestStability = mergedSignals.some(s => s.stabilityClass === "core") ? "core" as const
      : mergedSignals.some(s => s.stabilityClass === "medium") ? "medium" as const
      : deriveStabilityClass(cs.category, bestSource);

    const signal: BehaviorSignal = {
      id: cs.id,
      hypothesis: cs.hypothesis,
      evidenceEvents: dedupedEvidence,
      confidence: Math.max(0, Math.min(1, cs.confidence)),
      scope: cs.scope,
      category: cs.category,
      status: cs.status,
      adaptationConsequence: cs.adaptationConsequence,
      contradictionCriteria: cs.contradictionCriteria,
      firstSeen: primary?.firstSeen ?? turnNumber,
      lastUpdated: turnNumber,
      suppressionReason: cs.status === "suppressed"
        ? `Suppressed by consolidation at turn ${turnNumber}`
        : undefined,
      source: bestSource,
      stabilityClass: bestStability,
    };

    newStore.push(signal);
  }

  // Replace the store (cap at 8 as specified in prompt)
  ledger.signalStore = newStore.slice(0, 8);
}

/**
 * Format the suggested probe for injection into the next clarifier prompt.
 * Returns empty string if no probe is pending, already consumed, or if
 * the probe targets signals that were recently ignored (re-probe block).
 */
export function formatSuggestedProbeForPrompt(
  ledger: UserPsychologyLedger | undefined
): string {
  if (!ledger?.lastConsolidation) return "";
  if (ledger.lastConsolidation.probeConsumed) return "";

  const probe = ledger.lastConsolidation.result.suggestedProbe;
  if (!probe) return "";

  // ── Re-probe block: skip if these targets were probed and ignored recently ──
  if (probe.targetSignalIds && probe.targetSignalIds.length > 0 && ledger.probeHistory) {
    const targetSet = new Set(probe.targetSignalIds);
    const recentIgnored = ledger.probeHistory.filter(ph => {
      if (ph.outcome !== "ignored") return false;
      // "Recently" = within last 3 turns
      const snap = ledger.lastConsolidation;
      if (!snap) return false;
      const turnsSinceProbe = snap.afterTurn - ph.injectedOnTurn;
      return turnsSinceProbe <= 3;
    });

    // If ANY of the target signals were in a recently-ignored probe, skip
    for (const ignored of recentIgnored) {
      const overlap = ignored.targetSignalIds.some(id => targetSet.has(id));
      if (overlap) {
        console.log(
          `[PSYCH] Re-probe blocked: targets ${probe.targetSignalIds.join(",")} overlap with ` +
          `ignored probe from turn ${ignored.injectedOnTurn}`
        );
        return "";
      }
    }
  }

  const ambiguity = ledger.lastConsolidation.result.unresolvedAmbiguity;

  const lines: string[] = [];
  lines.push("═══ BACKGROUND PSYCHOLOGY ANALYSIS (steering hint — use or ignore) ═══");

  if (ambiguity) {
    lines.push(`Unresolved: ${ambiguity.description}`);
    lines.push(`Why it matters: ${ambiguity.whyItMatters}`);
  }

  lines.push(`Suggested angle: ${probe.angle}`);
  lines.push(`What responses would tell us: ${probe.interpretationGuide}`);
  lines.push("");
  lines.push("This is a HINT from background analysis. If it fits your creative moment,");
  lines.push("weave it into your question or assumptions naturally. If it doesn't fit, ignore it.");
  lines.push("Do NOT make it sound like a personality test.");

  return lines.join("\n");
}

/**
 * Mark the current probe as consumed so it isn't re-injected.
 * Also records the turn it was injected on for outcome tracking.
 */
export function markProbeConsumed(ledger: UserPsychologyLedger, injectedOnTurn?: number): void {
  if (ledger.lastConsolidation) {
    ledger.lastConsolidation.probeConsumed = true;
    // Initialize probe outcome tracking if there's a probe and we know the turn
    if (ledger.lastConsolidation.result.suggestedProbe && injectedOnTurn !== undefined) {
      if (!ledger.lastConsolidation.probeOutcome) {
        ledger.lastConsolidation.probeOutcome = {
          injectedOnTurn,
          outcome: "ignored", // default; updated by next consolidation
        };
      }
    }
  }
}

/**
 * Evaluate the outcome of a previously injected probe.
 * Called during the NEXT consolidation after the probe was consumed.
 * Checks if any of the target signals changed since probe injection.
 * Records the result in probeHistory for re-probe blocking.
 */
export function evaluateProbeOutcome(ledger: UserPsychologyLedger): void {
  const snap = ledger.lastConsolidation;
  if (!snap?.probeOutcome || !snap.result.suggestedProbe) return;
  // Already evaluated (has a final outcome AND has been recorded in history)
  if (snap.probeOutcome.outcome !== "ignored" && snap.probeOutcome.answeredOnTurn) return;

  const probe = snap.result.suggestedProbe;
  const injectedTurn = snap.probeOutcome.injectedOnTurn;

  // Check if any target signals got new evidence after the probe was injected
  const targetIds = new Set(probe.targetSignalIds ?? []);
  if (targetIds.size === 0) return;

  let anyUpdated = false;
  let anyContradicted = false;

  for (const signal of ledger.signalStore) {
    if (!targetIds.has(signal.id)) continue;
    // Evidence added after probe injection?
    const postProbeEvidence = signal.evidenceEvents.filter(e => e.turn > injectedTurn);
    if (postProbeEvidence.length > 0) {
      anyUpdated = true;
      if (postProbeEvidence.some(e => e.valence === "contradicts")) {
        anyContradicted = true;
      }
    }
  }

  let finalOutcome: "confirmed" | "contradicted" | "inconclusive" | "ignored";

  if (anyContradicted) {
    finalOutcome = "contradicted";
    snap.probeOutcome.outcome = "contradicted";
    snap.probeOutcome.answeredOnTurn = injectedTurn + 1;
  } else if (anyUpdated) {
    finalOutcome = "confirmed";
    snap.probeOutcome.outcome = "confirmed";
    snap.probeOutcome.answeredOnTurn = injectedTurn + 1;
  } else {
    // Check if user responded at all on the next turn (via reads)
    const postProbeReads = ledger.reads.filter(r => r.turnNumber > injectedTurn);
    if (postProbeReads.length > 0) {
      finalOutcome = "inconclusive";
      snap.probeOutcome.outcome = "inconclusive";
      snap.probeOutcome.answeredOnTurn = injectedTurn + 1;
    } else {
      finalOutcome = "ignored";
      // Leave as "ignored"
    }
  }

  // Record in probe history for re-probe blocking
  if (!ledger.probeHistory) ledger.probeHistory = [];
  // Avoid duplicate entries for the same probe
  const probeIds = [...(probe.targetSignalIds ?? [])].sort().join(",");
  const alreadyRecorded = ledger.probeHistory.some(
    ph => ph.injectedOnTurn === injectedTurn &&
      [...ph.targetSignalIds].sort().join(",") === probeIds
  );
  if (!alreadyRecorded) {
    ledger.probeHistory.push({
      targetSignalIds: probe.targetSignalIds ?? [],
      injectedOnTurn: injectedTurn,
      outcome: finalOutcome,
    });
    // Cap history at 10 entries (keep most recent)
    if (ledger.probeHistory.length > 10) {
      ledger.probeHistory = ledger.probeHistory.slice(-10);
    }
  }
}

// ─── Module Boundary Consolidation ───

/**
 * Lightweight ledger cleanup performed at module lock time (module boundaries).
 * Drops low-confidence noise and caps the active signal count so downstream
 * modules inherit a focused, high-quality signal store.
 *
 * Rules:
 *   1. Drop signals with confidence < 0.2 (noise / decayed)
 *   2. Cap remaining signals at 8 (keep highest confidence)
 */
export function moduleBoundaryConsolidation(ledger: UserPsychologyLedger): UserPsychologyLedger {
  if (ledger.signalStore) {
    // 1. Drop signals with confidence < 0.2
    ledger.signalStore = ledger.signalStore.filter(s => (s.confidence ?? 1) >= 0.2);
    // 2. Cap active signals at 8 (keep highest confidence)
    ledger.signalStore.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
    ledger.signalStore = ledger.signalStore.slice(0, 8);
  }
  return ledger;
}

export { createEmptyLedger };
