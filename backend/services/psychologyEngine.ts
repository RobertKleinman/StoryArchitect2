/**
 * Psychology Engine — shared utilities for computing and formatting
 * the user psychology ledger across modules.
 *
 * v2: Structured hypothesis store with evidence/confidence tracking,
 *     plus service-level non-choice (assumption delta) tracking.
 */

import {
  UserPsychologyLedger,
  UserHypothesis,
  AssumptionDelta,
  UserInteractionHeuristics,
  HypothesisCategory,
  createEmptyLedger,
} from "../../shared/types/userPsychology";

// ─── Hypothesis ID counter (per-session) ───

let nextHypothesisId = 1;

/** Reset ID counter (call when starting a fresh session) */
export function resetHypothesisIdCounter(): void {
  nextHypothesisId = 1;
}

function generateHypothesisId(): string {
  return `h${nextHypothesisId++}`;
}

// ─── Record structured hypotheses from LLM ───

/**
 * Record the LLM's structured user_read output into the ledger.
 * Stores the per-turn read AND merges hypotheses into the hypothesis store.
 */
export function recordHypotheses(
  ledger: UserPsychologyLedger,
  turnNumber: number,
  module: "hook" | "character" | "character_image",
  hypotheses: {
    hypothesis: string;
    evidence: string;
    confidence: "low" | "medium" | "high";
    scope: string;
    category?: HypothesisCategory;
  }[],
  overall_read: string,
  satisfaction?: { score: number; trend: "rising" | "stable" | "declining"; note: string }
): void {
  // Record LLM-assessed satisfaction if provided
  if (satisfaction) {
    recordSatisfaction(ledger, turnNumber, satisfaction);
  }

  if (!hypotheses || hypotheses.length === 0) return;

  // Store the per-turn read
  ledger.reads.push({
    turnNumber,
    module,
    hypotheses,
    overall_read: overall_read?.trim() ?? "",
  });

  // Cap reads at 10
  if (ledger.reads.length > 10) {
    ledger.reads = ledger.reads.slice(-10);
  }

  // Merge each hypothesis into the hypothesis store
  for (const h of hypotheses) {
    mergeHypothesis(ledger, turnNumber, h);
  }
}

/**
 * Merge a single hypothesis into the store.
 * If a similar one exists, update its evidence and potentially bump confidence.
 * Otherwise, create a new entry.
 */
/**
 * Hard confidence cap based on turn number.
 * The LLM is instructed to follow these rules in the prompt,
 * but we enforce them here as a safety net.
 */
/**
 * Hard confidence cap based on turn number.
 * The LLM is instructed to follow these rules in the prompt,
 * but we enforce them here as a safety net.
 *
 * globalTurnEstimate accounts for prior modules: if the hypothesis store
 * already has entries, we're not truly on "turn 1" of the user's experience.
 */
function capConfidenceByTurn(
  confidence: "low" | "medium" | "high",
  turnNumber: number,
  priorHypothesisCount?: number
): "low" | "medium" | "high" {
  // If there are prior hypotheses from earlier modules, the user isn't new.
  // Estimate global turn count by adding prior hypothesis count as a proxy.
  const globalEstimate = turnNumber + (priorHypothesisCount ?? 0 > 0 ? 3 : 0);

  if (globalEstimate <= 1) return "low";                         // True first turn: always low
  if (globalEstimate <= 3 && confidence === "high") return "medium"; // Early turns: medium max
  return confidence;                                              // Established user: trust the LLM
}

function mergeHypothesis(
  ledger: UserPsychologyLedger,
  turnNumber: number,
  incoming: {
    hypothesis: string;
    evidence: string;
    confidence: "low" | "medium" | "high";
    scope: string;
    category?: HypothesisCategory;
  }
): void {
  const store = ledger.hypothesisStore;

  // Enforce confidence cap by turn number (accounting for prior module hypotheses)
  const cappedConfidence = capConfidenceByTurn(incoming.confidence, turnNumber, store.length);

  // Simple similarity check: look for overlapping keywords
  const existing = findSimilarHypothesis(store, incoming.hypothesis);

  const incomingCategory: HypothesisCategory = incoming.category ?? inferCategory(incoming.hypothesis);

  if (existing) {
    // Update existing — append evidence, potentially bump confidence
    existing.evidence = `${existing.evidence}; ${incoming.evidence}`;
    existing.lastUpdated = turnNumber;

    // Keep the more specific category (incoming may be more precise)
    if (existing.category !== incomingCategory && incomingCategory !== "content_preferences") {
      existing.category = incomingCategory;
    }

    // Bump confidence if incoming (after cap) is higher
    const confidenceRank = { low: 0, medium: 1, high: 2 };
    if (confidenceRank[cappedConfidence] > confidenceRank[existing.confidence]) {
      existing.confidence = cappedConfidence;
    }
    // If the LLM surfaced it again with same or higher confidence, that's confirmation
    // But still respect the turn cap
    if (existing.confidence === "low" && cappedConfidence === "low" && turnNumber >= 2) {
      // Seen twice at low, and we're past turn 1 → upgrade to medium
      existing.confidence = "medium";
    }
  } else {
    // New hypothesis
    const scope = (["this_story", "this_genre", "global"].includes(incoming.scope)
      ? incoming.scope
      : "this_story") as "this_story" | "this_genre" | "global";

    store.push({
      id: generateHypothesisId(),
      hypothesis: incoming.hypothesis,
      evidence: incoming.evidence,
      confidence: cappedConfidence,
      scope,
      category: incomingCategory,
      firstSeen: turnNumber,
      lastUpdated: turnNumber,
    });
  }

  // Cap store at 10 hypotheses — fewer but deeper
  // Drop oldest low-confidence ones first
  if (store.length > 10) {
    store.sort((a, b) => {
      const confRank = { low: 0, medium: 1, high: 2 };
      const confDiff = confRank[a.confidence] - confRank[b.confidence];
      if (confDiff !== 0) return confDiff; // low confidence first (to be dropped)
      return a.lastUpdated - b.lastUpdated; // older first
    });
    ledger.hypothesisStore = store.slice(store.length - 10);
  }
}

/**
 * Simple keyword overlap to find a similar hypothesis.
 * Strips common words and checks if >50% of keywords overlap.
 */
function findSimilarHypothesis(
  store: UserHypothesis[],
  text: string
): UserHypothesis | undefined {
  const stopWords = new Set(["the", "a", "an", "is", "are", "was", "were", "to", "of", "in", "for", "and", "or", "but", "with", "they", "their", "this", "that"]);
  const keywords = text
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));

  if (keywords.length === 0) return undefined;

  let bestMatch: UserHypothesis | undefined;
  let bestOverlap = 0;

  for (const h of store) {
    if (h.disconfirmedBy) continue; // skip disconfirmed
    const existingKeywords = new Set(
      h.hypothesis
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => w.length > 2 && !stopWords.has(w))
    );
    const overlap = keywords.filter((k) => existingKeywords.has(k)).length;
    const overlapRatio = overlap / keywords.length;
    if (overlapRatio > 0.5 && overlap > bestOverlap) {
      bestOverlap = overlap;
      bestMatch = h;
    }
  }

  return bestMatch;
}

// ─── Category inference (fallback when LLM doesn't provide one) ───

const CATEGORY_KEYWORDS: Record<HypothesisCategory, string[]> = {
  content_preferences: ["prefer", "want", "desire", "enjoy", "like", "theme", "genre", "kink", "fetish", "aesthetic", "tone", "mood", "explicit", "erotic", "body", "physical"],
  control_orientation: ["control", "direct", "guide", "surprise", "agency", "lead", "follow", "decide", "choice", "steer", "driver"],
  power_dynamics: ["power", "hierarchy", "authority", "dominan", "submiss", "worship", "command", "serve", "obey", "status", "rank"],
  tonal_risk: ["risk", "boundary", "taboo", "push", "edge", "transgress", "bold", "safe", "comfort", "provocat", "absurd"],
  narrative_ownership: ["vision", "ownership", "protect", "MY story", "specific", "particular", "image", "brand", "reputation", "audience"],
  engagement_satisfaction: ["engage", "interest", "bore", "excit", "satisf", "enjoy", "frustrat", "pace", "momentum"],
};

function inferCategory(hypothesis: string): HypothesisCategory {
  const lower = hypothesis.toLowerCase();
  let bestCategory: HypothesisCategory = "content_preferences";
  let bestScore = 0;

  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS) as [HypothesisCategory, string[]][]) {
    const score = keywords.filter((kw) => lower.includes(kw)).length;
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
 * Called after each turn to track if the user's prior choices "stuck."
 *
 * v2: Per-category tracking instead of raw keep-vs-change counts.
 * A user who changed "tone" last turn and "character_role" this turn hasn't
 * invalidated the tone change — they're engaged and opinionated about different things.
 *
 * A prior change is "faded" ONLY if:
 *   1. The hypothesis was explicitly disconfirmed (already tracked elsewhere), OR
 *   2. The user is making changes at a very high rate (>75%) AND satisfaction is declining
 *      — suggesting broad dissatisfaction, not targeted refinement
 *
 * Otherwise, prior changes are assumed to still be relevant. Changing different
 * things across turns is a POSITIVE signal (engaged, opinionated user).
 */
export function checkPersistence(
  ledger: UserPsychologyLedger,
  turnNumber: number,
  currentActions: Record<string, "keep" | "alternative" | "freeform" | "not_ready">
): void {
  if (ledger.assumptionDeltas.length < 2) return;

  const currentDelta = ledger.assumptionDeltas[ledger.assumptionDeltas.length - 1];
  const priorDeltas = ledger.assumptionDeltas.slice(0, -1);

  // Current turn stats
  const currentValues = Object.values(currentActions);
  const currentChangeCount = currentValues.filter((a) => a === "alternative" || a === "freeform").length;
  const currentTotal = currentValues.filter((a) => a !== "not_ready").length;
  const currentChangeRate = currentTotal > 0 ? currentChangeCount / currentTotal : 0;

  // Check satisfaction trend — declining satisfaction + high change rate suggests real dissatisfaction
  const satisfactionDeclining = ledger.heuristics.satisfaction?.trend === "declining";
  const broadDissatisfaction = currentChangeRate > 0.75 && satisfactionDeclining;

  // Find hypotheses that were updated by user changes in prior turns
  const priorChanges: Array<{ hypothesis_id: string; change_applied: string; still_relevant: boolean }> = [];

  for (const delta of priorDeltas) {
    // Count how many changes the user made in this prior turn
    const priorChangeCount = Object.values(delta.actions).filter(
      (a) => a === "alternative" || a === "freeform"
    ).length;
    if (priorChangeCount === 0) continue;

    // Find hypotheses that were updated around that turn
    const relatedHyps = ledger.hypothesisStore.filter((h) =>
      !h.disconfirmedBy && h.lastUpdated === delta.turnNumber
    );

    for (const hyp of relatedHyps) {
      // Default: prior change is still relevant (user changing different things is normal)
      // Only mark as faded if there's evidence of broad dissatisfaction
      const stillRelevant = !broadDissatisfaction;

      priorChanges.push({
        hypothesis_id: hyp.id,
        change_applied: `Turn ${delta.turnNumber}: user made ${priorChangeCount} changes, updating "${hyp.hypothesis.slice(0, 50)}"`,
        still_relevant: stillRelevant,
      });
    }
  }

  if (priorChanges.length > 0 && currentDelta) {
    currentDelta.prior_changes = priorChanges;
  }
}

// ─── Satisfaction (LLM-assessed) ───

/**
 * Store the LLM's satisfaction assessment from user_read output.
 * The LLM has full conversational context and is much better at judging
 * user satisfaction than any hardcoded formula.
 */
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

// ─── Assumption delta (non-choice tracking) ───

/**
 * Record what assumptions were offered vs responded to.
 * The service calls this after processing assumption responses each turn.
 */
export function recordAssumptionDelta(
  ledger: UserPsychologyLedger,
  turnNumber: number,
  offeredIds: string[],
  respondedIds: string[],
  actions: Record<string, "keep" | "alternative" | "freeform" | "not_ready">
): void {
  const respondedSet = new Set(respondedIds);
  const ignored = offeredIds.filter((id) => !respondedSet.has(id));

  ledger.assumptionDeltas.push({
    turnNumber,
    offered: offeredIds,
    responded: respondedIds,
    ignored,
    actions,
  });

  // Keep last 5 turns
  if (ledger.assumptionDeltas.length > 5) {
    ledger.assumptionDeltas = ledger.assumptionDeltas.slice(-5);
  }
}

// ─── Heuristics (v2: cross-module accumulation) ───

/**
 * Compute interaction heuristics from turn data.
 * Works with both hook and character turn shapes.
 *
 * v2: Accumulates raw stats across module boundaries. Each module passes its
 * OWN turn stats (from session.turns), and this function adds them to the
 * baseline _rawStats carried from previous modules. Derived fields (typeRatio,
 * changeRate, etc.) are computed from the combined totals.
 */
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

  // Get the frozen baseline from previous modules (set once at module init)
  const baseline = h._importedBaseline ?? {
    typedCount: 0,
    clickedCount: 0,
    totalAssumptions: 0,
    deferredAssumptions: 0,
    changedAssumptions: 0,
    responseLengths: [],
  };

  // If current module has no data yet, preserve existing heuristics
  const currentTotal = currentModuleStats.typedCount + currentModuleStats.clickedCount;
  if (currentTotal === 0 && currentModuleStats.totalAssumptions === 0) {
    return;
  }

  // Combine baseline (previous modules) + current module stats
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
    ? combined.deferredAssumptions / combined.totalAssumptions
    : 0;
  h.changeRate = combined.totalAssumptions > 0
    ? combined.changedAssumptions / combined.totalAssumptions
    : 0;

  const lengths = combined.responseLengths;
  if (lengths.length > 0) {
    h.avgResponseLength = Math.round(
      lengths.reduce((a, b) => a + b, 0) / lengths.length
    );
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

  // Store combined raw stats — next module reads this to set its _importedBaseline
  h._rawStats = combined;
}

/**
 * Snapshot the current module's raw stats as the baseline for the next module.
 * Call this when a module imports a psychology ledger from a previous module.
 * The _rawStats from the previous module become this module's _importedBaseline.
 */
export function snapshotBaselineForNewModule(ledger: UserPsychologyLedger): void {
  const h = ledger.heuristics;
  // Use _rawStats from previous module if available, otherwise back-compute from heuristics
  if (h._rawStats) {
    h._importedBaseline = { ...h._rawStats };
  } else if (h.totalInteractions > 0) {
    // Legacy ledger without _rawStats — approximate from derived fields
    const total = h.totalInteractions;
    // Estimate split between response interactions and assumptions
    // Use a heuristic: if changeRate or deferralRate > 0, assumptions exist
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
        ? Array(Math.round(responseCount * h.typeRatio)).fill(h.avgResponseLength)
        : [],
    };
  } else {
    // Empty ledger — no baseline
    h._importedBaseline = {
      typedCount: 0,
      clickedCount: 0,
      totalAssumptions: 0,
      deferredAssumptions: 0,
      changedAssumptions: 0,
      responseLengths: [],
    };
  }
}

// ─── Formatting for prompts ───

/**
 * STORAGE vs PROMPT BOUNDARY
 * ===========================
 * The psychology ledger stores EVERYTHING (full hypothesis history, all deltas, all reads).
 * This formatter produces a CURATED view for the LLM prompt — deliberately smaller than storage.
 *
 * What goes into the prompt (curated):
 *   - Interaction heuristics summary (always)
 *   - Top 6 active hypotheses by confidence (not all 10 in store)
 *   - Disconfirmed hypotheses (brief, so LLM doesn't repeat them)
 *   - Last turn's assumption delta only (not all 5 stored)
 *   - Last turn's overall_read synthesis
 *
 * What stays in storage only (never sent to LLM):
 *   - Full hypothesis store (all 10, including ones not shown in prompt)
 *   - All assumption deltas (last 5 turns)
 *   - All per-turn reads (last 10)
 *   - Full evidence chains on hypotheses (prompt gets truncated version)
 */
export function formatPsychologyLedgerForPrompt(
  ledger: UserPsychologyLedger | undefined
): string {
  if (!ledger) return "(No user observations yet — this is a new user)";

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
      lines.push(`⚠ Responses getting shorter — engagement may be dropping. Be more provocative.`);
    } else if (h.engagementTrend === 1) {
      lines.push(`Responses getting longer — engagement increasing. Match their energy.`);
    }
  }

  // ── Hypothesis store (PROMPT VIEW: up to 5, ensuring category coverage) ──
  const activeHypotheses = ledger.hypothesisStore.filter((hyp) => !hyp.disconfirmedBy);
  if (activeHypotheses.length > 0) {
    // Sort: high first, then medium, then low. Within same confidence, most recently updated first.
    const sorted = [...activeHypotheses].sort((a, b) => {
      const confRank = { high: 2, medium: 1, low: 0 };
      const confDiff = confRank[b.confidence] - confRank[a.confidence];
      if (confDiff !== 0) return confDiff;
      return b.lastUpdated - a.lastUpdated;
    });

    // Category-aware selection: pick top 1 per active category first, then fill by confidence
    const MAX_PROMPT_HYPOTHESES = 5;
    const selected = new Set<string>(); // hypothesis IDs
    const seenCategories = new Set<string>();

    // Pass 1: one per category (ensures no category goes dark)
    for (const hyp of sorted) {
      const cat = hyp.category ?? "content_preferences";
      if (!seenCategories.has(cat) && selected.size < MAX_PROMPT_HYPOTHESES) {
        selected.add(hyp.id);
        seenCategories.add(cat);
      }
    }

    // Pass 2: fill remaining slots by confidence
    for (const hyp of sorted) {
      if (selected.size >= MAX_PROMPT_HYPOTHESES) break;
      if (!selected.has(hyp.id)) {
        selected.add(hyp.id);
      }
    }

    const promptHypotheses = sorted.filter((h) => selected.has(h.id));

    // Group by category for structure
    const byCategory = new Map<string, typeof promptHypotheses>();
    for (const hyp of promptHypotheses) {
      const cat = hyp.category ?? "content_preferences";
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat)!.push(hyp);
    }

    lines.push("");
    lines.push("YOUR PRIOR HYPOTHESES ABOUT THIS USER:");
    for (const [cat, hyps] of byCategory) {
      lines.push(`  [${cat}]`);
      for (const hyp of hyps) {
        const evidence = hyp.evidence.length > 80
          ? "..." + hyp.evidence.slice(-77)
          : hyp.evidence;
        lines.push(`    [${hyp.id}] (${hyp.confidence}) "${hyp.hypothesis}" — ${evidence}`);
      }
    }
    if (activeHypotheses.length > MAX_PROMPT_HYPOTHESES) {
      lines.push(`  (${activeHypotheses.length - MAX_PROMPT_HYPOTHESES} more in storage, not shown)`);
    }
    lines.push("  → Update these: confirm, refine, or disconfirm based on this turn's behavior.");
  }

  // ── Disconfirmed hypotheses (brief, so LLM doesn't repeat them) ──
  const disconfirmed = ledger.hypothesisStore.filter((hyp) => hyp.disconfirmedBy);
  if (disconfirmed.length > 0) {
    lines.push("");
    lines.push("DISCONFIRMED (do not repeat these):");
    for (const hyp of disconfirmed) {
      lines.push(`  [${hyp.id}] "${hyp.hypothesis}" — disconfirmed: ${hyp.disconfirmedBy}`);
    }
  }

  // ── Last turn's assumption delta only (storage keeps 5, prompt gets 1) ──
  const lastDelta = ledger.assumptionDeltas.length > 0
    ? ledger.assumptionDeltas[ledger.assumptionDeltas.length - 1]
    : null;

  if (lastDelta && lastDelta.ignored.length > 0) {
    lines.push("");
    lines.push(`ASSUMPTIONS IGNORED LAST TURN (${lastDelta.ignored.length} of ${lastDelta.offered.length} offered):`);
    lines.push(`  Ignored IDs: ${lastDelta.ignored.join(", ")}`);
    lines.push("  → These areas may not matter to them yet. Don't force. Try different angles or wait.");
  }

  // ── Persistence summary ──
  if (lastDelta?.prior_changes && lastDelta.prior_changes.length > 0) {
    const stillActive = lastDelta.prior_changes.filter((p) => p.still_relevant).length;
    const total = lastDelta.prior_changes.length;
    lines.push("");
    lines.push(`PERSISTENCE SUMMARY: ${stillActive} of ${total} prior changes still active`);
    if (stillActive < total) {
      const faded = lastDelta.prior_changes.filter((p) => !p.still_relevant);
      for (const f of faded) {
        lines.push(`  [${f.hypothesis_id}] change faded: ${f.change_applied}`);
      }
      lines.push("  → These changes didn't stick. Go deeper on those dimensions or try new angles.");
    }
  }

  // ── Satisfaction signal ──
  if (h.satisfaction) {
    lines.push("");
    lines.push(`SATISFACTION: ${Math.round(h.satisfaction.score * 100)}% (${h.satisfaction.trend})`);
    if (h.satisfaction.trend === "declining") {
      lines.push("  ⚠ User satisfaction declining — be more responsive to their vision, less formulaic.");
    }
  }

  // ── Overall read from last turn ──
  const lastRead = ledger.reads.length > 0 ? ledger.reads[ledger.reads.length - 1] : null;
  if (lastRead?.overall_read) {
    lines.push("");
    lines.push(`Last turn synthesis: "${lastRead.overall_read}"`);
  }

  if (lines.length === 0) {
    return "(No user observations yet — read them from their first response)";
  }

  return lines.join("\n");
}

export { createEmptyLedger };
