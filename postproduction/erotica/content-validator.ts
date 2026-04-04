/**
 * CONTENT PRESERVATION VALIDATOR
 * ================================
 * Validates that LLM rewrites don't shrink word count or strip explicit content.
 * This is the safety net — previous postproduction halved word counts and
 * removed fetish content that was the actual point of the stories.
 */

import type { IdentifiedLine, LineDiff, VNLine } from "../types";
import type { ContentValidationResult } from "./types";

// Explicit content keywords — if these appear in the original, they should
// survive somewhere in the scene (not necessarily the same line) after rewrite.
const EXPLICIT_KEYWORDS = new Set([
  // Body parts
  "cock", "dick", "shaft", "tip", "balls", "ass", "hole", "taint",
  "nipple", "nipples", "clit", "pussy", "cunt", "tits", "breasts",
  // Actions
  "lick", "suck", "fuck", "thrust", "stroke", "grind", "pound",
  "swallow", "gag", "choke", "kneel", "worship", "beg",
  // Fetish/kink
  "boot", "boots", "feet", "foot", "sole", "heel", "toe", "toes",
  "sock", "socks", "leather", "collar", "leash", "rope", "cuff",
  "sweat", "musk", "scent", "smell", "taste", "sniff", "inhale",
  // Power dynamic
  "submit", "obey", "kneel", "serve", "master", "sir", "pet",
  "slave", "beg", "please", "permission",
]);

/**
 * Extract explicit keywords from a text string.
 */
function findExplicitKeywords(text: string): Set<string> {
  const words = text.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/);
  const found = new Set<string>();
  for (const w of words) {
    if (EXPLICIT_KEYWORDS.has(w)) found.add(w);
  }
  return found;
}

/**
 * Count words in a text string.
 */
function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Validate that a set of diffs preserves content quality.
 * Returns which diffs should be rejected and why.
 */
export function validateContentPreservation(
  sceneLines: IdentifiedLine[],
  diffs: LineDiff[],
): ContentValidationResult {
  const rejected: string[] = [];
  const reasons: string[] = [];

  // Build a map of original lines by ID
  const lineMap = new Map<string, IdentifiedLine>();
  for (const line of sceneLines) {
    lineMap.set(line._lid, line);
  }

  // Track total word count change
  let totalOriginalWords = 0;
  let totalNewWords = 0;

  // Track explicit keywords before and after
  const originalKeywords = new Set<string>();
  for (const line of sceneLines) {
    for (const kw of findExplicitKeywords(line.text)) {
      originalKeywords.add(kw);
    }
  }

  // Validate each diff
  for (const diff of diffs) {
    const original = lineMap.get(diff.line_id);
    if (!original) {
      rejected.push(diff.line_id);
      reasons.push(`${diff.line_id}: line not found in scene`);
      continue;
    }

    if (diff.action === "delete") {
      // Deletion removes words entirely — check if it's a significant loss
      const origWords = wordCount(original.text);
      totalOriginalWords += origWords;
      // totalNewWords stays 0 for this line
      if (origWords > 10) {
        rejected.push(diff.line_id);
        reasons.push(`${diff.line_id}: deletion of ${origWords}-word line — too much content loss`);
      }
      continue;
    }

    if (diff.action === "replace" && diff.new_line) {
      const origWords = wordCount(original.text);
      const newWords = wordCount(diff.new_line.text);
      totalOriginalWords += origWords;
      totalNewWords += newWords;

      // Per-line check: reject if line shrinks more than 40%
      if (origWords > 5 && newWords < origWords * 0.6) {
        rejected.push(diff.line_id);
        reasons.push(`${diff.line_id}: word count dropped ${origWords}→${newWords} (${((1 - newWords / origWords) * 100).toFixed(0)}% reduction)`);
      }
    }

    if (diff.action === "insert_after" && diff.new_line) {
      totalNewWords += wordCount(diff.new_line.text);
    }
  }

  // Scene-level word count check: reject all diffs if total drops >20%
  if (totalOriginalWords > 0 && totalNewWords < totalOriginalWords * 0.8) {
    const reduction = ((1 - totalNewWords / totalOriginalWords) * 100).toFixed(0);
    // Reject ALL diffs — the rewrite as a whole shrinks too much
    for (const diff of diffs) {
      if (!rejected.includes(diff.line_id)) {
        rejected.push(diff.line_id);
      }
    }
    reasons.push(`Scene total: ${totalOriginalWords}→${totalNewWords} words (${reduction}% reduction) — all diffs rejected`);
  }

  // Explicit content survival check
  // Build the post-rewrite keyword set by applying diffs to a copy
  const postRewriteKeywords = new Set<string>();
  for (const line of sceneLines) {
    const diff = diffs.find(d => d.line_id === line._lid && !rejected.includes(d.line_id));
    if (diff?.action === "replace" && diff.new_line) {
      for (const kw of findExplicitKeywords(diff.new_line.text)) {
        postRewriteKeywords.add(kw);
      }
    } else if (diff?.action === "delete" && !rejected.includes(diff.line_id)) {
      // Line deleted, keywords lost from this line
    } else {
      for (const kw of findExplicitKeywords(line.text)) {
        postRewriteKeywords.add(kw);
      }
    }
  }

  // Check which keywords were lost
  const lostKeywords: string[] = [];
  for (const kw of originalKeywords) {
    if (!postRewriteKeywords.has(kw)) {
      lostKeywords.push(kw);
    }
  }
  if (lostKeywords.length > 0) {
    reasons.push(`Explicit content keywords lost: ${lostKeywords.join(", ")} — review diffs manually`);
    // Don't auto-reject for keyword loss — it's a warning, not a hard gate.
    // The word count check is the hard gate.
  }

  return {
    valid: rejected.length === 0,
    rejected_diffs: rejected,
    reasons,
  };
}
