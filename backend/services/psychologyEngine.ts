/**
 * Psychology Engine — shared utilities for computing and formatting
 * the user psychology ledger across modules.
 */

import {
  UserPsychologyLedger,
  UserPsychologyRead,
  UserInteractionHeuristics,
  createEmptyLedger,
} from "../../shared/types/userPsychology";

/**
 * Record a new LLM user_read observation into the ledger.
 * Keeps only the last 10 reads to bound token cost.
 */
export function recordUserRead(
  ledger: UserPsychologyLedger,
  turnNumber: number,
  module: "hook" | "character",
  observation: string
): void {
  if (!observation || !observation.trim()) return;
  ledger.reads.push({ turnNumber, module, observation: observation.trim() });
  // Cap at 10 most recent reads
  if (ledger.reads.length > 10) {
    ledger.reads = ledger.reads.slice(-10);
  }
}

/**
 * Compute interaction heuristics from turn data.
 * Works with both hook and character turn shapes.
 * Pass the raw counts — this function computes ratios and trends.
 */
export function updateHeuristics(
  ledger: UserPsychologyLedger,
  stats: {
    typedCount: number;
    clickedCount: number;
    totalAssumptions: number;
    deferredAssumptions: number;
    changedAssumptions: number;
    responseLengths: number[]; // word counts of typed responses, chronological
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

  // Average response length
  const lengths = stats.responseLengths;
  if (lengths.length > 0) {
    h.avgResponseLength = Math.round(
      lengths.reduce((a, b) => a + b, 0) / lengths.length
    );
  }

  // Engagement trend: compare last 3 responses to first 3
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

/**
 * Format the psychology ledger for injection into a prompt.
 * Keeps it concise to minimize token cost.
 */
export function formatPsychologyLedgerForPrompt(
  ledger: UserPsychologyLedger | undefined
): string {
  if (!ledger) return "(No user observations yet — this is a new user)";

  const lines: string[] = [];
  const h = ledger.heuristics;

  // Interaction style summary
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

  // LLM observations (most recent 3 for the prompt — keep it tight)
  const recentReads = ledger.reads.slice(-3);
  if (recentReads.length > 0) {
    lines.push("");
    lines.push("Your observations about this user:");
    for (const read of recentReads) {
      lines.push(`  [${read.module} turn ${read.turnNumber}] ${read.observation}`);
    }
  }

  if (lines.length === 0) {
    return "(No user observations yet — read them from their first response)";
  }

  return lines.join("\n");
}

export { createEmptyLedger };
