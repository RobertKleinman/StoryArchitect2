/**
 * CONTENT PRESERVATION VALIDATOR (Scene-Level)
 * ===============================================
 * Validates that a rewritten scene preserves content quality.
 * Compares whole scenes, not individual diffs.
 */

import type { IdentifiedLine } from "../types";
import type { ContentValidationResult } from "./types";

// Explicit content keywords — if these appear in the original scene, they should
// survive somewhere in the rewritten scene.
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
  "submit", "obey", "serve", "master", "sir",
  "slave", "permission",
]);

function extractKeywords(lines: Array<{ text: string }>): Set<string> {
  const found = new Set<string>();
  for (const line of lines) {
    const words = line.text.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/);
    for (const w of words) {
      if (EXPLICIT_KEYWORDS.has(w)) found.add(w);
    }
  }
  return found;
}

function totalWordCount(lines: Array<{ text: string }>): number {
  return lines.reduce((sum, l) => sum + l.text.split(/\s+/).filter(Boolean).length, 0);
}

/**
 * Validate that a rewritten scene preserves content compared to the original.
 */
export function validateSceneRewrite(
  originalLines: IdentifiedLine[],
  rewrittenLines: Array<{ speaker: string; text: string; emotion?: string | null }>,
): ContentValidationResult {
  const reasons: string[] = [];

  // Word count comparison
  const origWords = totalWordCount(originalLines);
  const newWords = totalWordCount(rewrittenLines);
  const ratio = origWords > 0 ? newWords / origWords : 1;

  if (ratio < 0.8) {
    reasons.push(`Word count dropped ${origWords}→${newWords} (${((1 - ratio) * 100).toFixed(0)}% reduction) — below 80% threshold`);
  }
  if (ratio > 1.3) {
    reasons.push(`Word count grew ${origWords}→${newWords} (${((ratio - 1) * 100).toFixed(0)}% increase) — above 130% threshold`);
  }

  // Explicit content survival
  const origKeywords = extractKeywords(originalLines);
  const newKeywords = extractKeywords(rewrittenLines);
  const lost: string[] = [];
  for (const kw of origKeywords) {
    if (!newKeywords.has(kw)) lost.push(kw);
  }
  if (lost.length > 0) {
    reasons.push(`Explicit keywords lost: ${lost.join(", ")}`);
  }

  // Character survival — every character who spoke in original should speak in rewrite
  const origSpeakers = new Set(originalLines.map(l => l.speaker.toUpperCase()).filter(s => s !== "NARRATION" && s !== "INTERNAL"));
  const newSpeakers = new Set(rewrittenLines.map(l => l.speaker.toUpperCase()).filter(s => s !== "NARRATION" && s !== "INTERNAL"));
  const missingSpeakers: string[] = [];
  for (const sp of origSpeakers) {
    if (!newSpeakers.has(sp)) missingSpeakers.push(sp);
  }
  if (missingSpeakers.length > 0) {
    reasons.push(`Characters missing from rewrite: ${missingSpeakers.join(", ")}`);
  }

  // Hard reject only on word count — keyword loss and missing speakers are warnings
  const valid = ratio >= 0.8 && ratio <= 1.3;

  return {
    valid,
    rejected_diffs: valid ? [] : ["scene_rewrite"],
    reasons,
  };
}
