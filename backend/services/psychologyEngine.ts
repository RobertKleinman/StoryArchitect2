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
/**
 * Hard confidence cap based on turn number.
 * The LLM is instructed to follow these rules in the prompt,
 * but we enforce them here as a safety net.
 */
function capConfidenceByTurn(
  confidence: "low" | "medium" | "high",
  turnNumber: number
): "low" | "medium" | "high" {
  if (turnNumber <= 1) return "low";                         // Turn 1: always low
  if (turnNumber <= 3 && confidence === "high") return "medium"; // Turn 2-3: medium max
  return confidence;                                          // Turn 4+: trust the LLM
}

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

  // Enforce confidence cap by turn number
  const cappedConfidence = capConfidenceByTurn(incoming.confidence, turnNumber);

  // Simple similarity check: look for overlapping keywords
  const existing = findSimilarHypothesis(store, incoming.hypothesis);

  if (existing) {
    // Update existing — append evidence, potentially bump confidence
    existing.evidence = `${existing.evidence}; ${incoming.evidence}`;
    existing.lastUpdated = turnNumber;

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

  // ── Hypothesis store (PROMPT VIEW: top 6 by confidence, not full store) ──
  const activeHypotheses = ledger.hypothesisStore.filter((hyp) => !hyp.disconfirmedBy);
  if (activeHypotheses.length > 0) {
    // Sort: high first, then medium, then low. Within same confidence, most recently updated first.
    const sorted = [...activeHypotheses].sort((a, b) => {
      const confRank = { high: 2, medium: 1, low: 0 };
      const confDiff = confRank[b.confidence] - confRank[a.confidence];
      if (confDiff !== 0) return confDiff;
      return b.lastUpdated - a.lastUpdated;
    });
    // Cap at 6 for the prompt — keeps context tight
    const promptHypotheses = sorted.slice(0, 6);

    lines.push("");
    lines.push("YOUR PRIOR HYPOTHESES ABOUT THIS USER:");
    for (const hyp of promptHypotheses) {
      // Truncate evidence to last ~80 chars if it's gotten long from accumulation
      const evidence = hyp.evidence.length > 80
        ? "..." + hyp.evidence.slice(-77)
        : hyp.evidence;
      lines.push(`  [${hyp.id}] (${hyp.confidence}) "${hyp.hypothesis}" — evidence: ${evidence} [scope: ${hyp.scope}]`);
    }
    if (activeHypotheses.length > 6) {
      lines.push(`  (${activeHypotheses.length - 6} more in storage, not shown — focus on these)`);
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
