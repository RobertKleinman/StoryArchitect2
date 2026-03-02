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
  module: "hook" | "character",
  hypotheses: {
    hypothesis: string;
    evidence: string;
    confidence: "low" | "medium" | "high";
    scope: string;
  }[],
  overall_read: string
): void {
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
function mergeHypothesis(
  ledger: UserPsychologyLedger,
  turnNumber: number,
  incoming: {
    hypothesis: string;
    evidence: string;
    confidence: "low" | "medium" | "high";
    scope: string;
  }
): void {
  const store = ledger.hypothesisStore;

  // Simple similarity check: look for overlapping keywords
  const existing = findSimilarHypothesis(store, incoming.hypothesis);

  if (existing) {
    // Update existing — append evidence, potentially bump confidence
    existing.evidence = `${existing.evidence}; ${incoming.evidence}`;
    existing.lastUpdated = turnNumber;

    // Bump confidence if LLM says it's higher now
    const confidenceRank = { low: 0, medium: 1, high: 2 };
    if (confidenceRank[incoming.confidence] > confidenceRank[existing.confidence]) {
      existing.confidence = incoming.confidence;
    }
    // If the LLM surfaced it again with same or higher confidence, that's confirmation
    if (existing.confidence === "low" && incoming.confidence === "low") {
      // Seen twice at low → upgrade to medium
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
      confidence: incoming.confidence,
      scope,
      firstSeen: turnNumber,
      lastUpdated: turnNumber,
    });
  }

  // Cap store at 20 hypotheses — drop oldest low-confidence ones first
  if (store.length > 20) {
    store.sort((a, b) => {
      const confRank = { low: 0, medium: 1, high: 2 };
      const confDiff = confRank[a.confidence] - confRank[b.confidence];
      if (confDiff !== 0) return confDiff; // low confidence first (to be dropped)
      return a.lastUpdated - b.lastUpdated; // older first
    });
    ledger.hypothesisStore = store.slice(store.length - 20);
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

// ─── Heuristics (unchanged from v1) ───

/**
 * Compute interaction heuristics from turn data.
 * Works with both hook and character turn shapes.
 */
export function updateHeuristics(
  ledger: UserPsychologyLedger,
  stats: {
    typedCount: number;
    clickedCount: number;
    totalAssumptions: number;
    deferredAssumptions: number;
    changedAssumptions: number;
    responseLengths: number[];
  }
): void {
  const total = stats.typedCount + stats.clickedCount;
  const h = ledger.heuristics;

  h.totalInteractions = total + stats.totalAssumptions;
  h.typeRatio = total > 0 ? stats.typedCount / total : 0.5;
  h.deferralRate = stats.totalAssumptions > 0
    ? stats.deferredAssumptions / stats.totalAssumptions
    : 0;
  h.changeRate = stats.totalAssumptions > 0
    ? stats.changedAssumptions / stats.totalAssumptions
    : 0;

  const lengths = stats.responseLengths;
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
}

// ─── Formatting for prompts ───

/**
 * Format the full psychology ledger for injection into a prompt.
 * Includes: heuristics summary, hypothesis store, and recent assumption deltas.
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

  // ── Hypothesis store ──
  const activeHypotheses = ledger.hypothesisStore.filter((h) => !h.disconfirmedBy);
  if (activeHypotheses.length > 0) {
    lines.push("");
    lines.push("YOUR PRIOR HYPOTHESES ABOUT THIS USER:");
    // Group by confidence: high first, then medium, then low
    for (const conf of ["high", "medium", "low"] as const) {
      const group = activeHypotheses.filter((h) => h.confidence === conf);
      for (const h of group) {
        lines.push(`  [${h.id}] (${h.confidence}) "${h.hypothesis}" — evidence: ${h.evidence} [scope: ${h.scope}]`);
      }
    }
    lines.push("  → Update these: confirm, refine, or disconfirm based on this turn's behavior.");
  }

  // ── Disconfirmed hypotheses (brief, so LLM doesn't repeat them) ──
  const disconfirmed = ledger.hypothesisStore.filter((h) => h.disconfirmedBy);
  if (disconfirmed.length > 0) {
    lines.push("");
    lines.push("DISCONFIRMED (do not repeat these):");
    for (const h of disconfirmed) {
      lines.push(`  [${h.id}] "${h.hypothesis}" — disconfirmed: ${h.disconfirmedBy}`);
    }
  }

  // ── Recent assumption deltas ──
  const lastDelta = ledger.assumptionDeltas.length > 0
    ? ledger.assumptionDeltas[ledger.assumptionDeltas.length - 1]
    : null;

  if (lastDelta && lastDelta.ignored.length > 0) {
    lines.push("");
    lines.push(`ASSUMPTIONS IGNORED LAST TURN (${lastDelta.ignored.length} of ${lastDelta.offered.length} offered):`);
    lines.push(`  Ignored IDs: ${lastDelta.ignored.join(", ")}`);
    lines.push("  → These areas may not matter to them yet. Don't force. Try different angles or wait.");
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
