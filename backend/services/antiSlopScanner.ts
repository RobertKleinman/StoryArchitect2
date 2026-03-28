/**
 * Anti-Slop Scanner — Rule-based detection of LLM writing patterns
 *
 * Zero LLM cost. Scans text against the tiered anti-slop data and
 * returns a structured report with scores, hits, and locations.
 *
 * Designed to be callable standalone (not coupled to the pipeline).
 */

import {
  TIER1_WORDS,
  TIER2_WORDS,
  TIER3_OVERUSE,
  TIER4_PHRASES,
  TIER5_PATTERNS,
  SCAN_CONFIG,
  type SlopHit,
  type ScanReport,
} from "../../shared/antiSlop";

// ═══════════════════════════════════════════════════════════════
// MAIN SCANNER
// ═══════════════════════════════════════════════════════════════

/**
 * Scan text for LLM-ism patterns across all tiers.
 *
 * @param text - The text to scan (scene screenplay, narration, etc.)
 * @param options - Optional configuration overrides
 * @returns Full scan report with hits, scores, and summary
 */
export function scanForSlop(
  text: string,
  options: ScanOptions = {},
): ScanReport {
  const lowerText = text.toLowerCase();
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  const tier1 = scanTier1(lowerText, text);
  const tier2Raw = scanTier2(lowerText, text);
  const tier3 = scanTier3(lowerText, text);
  const tier4 = scanTier4(lowerText, text);
  const tier5 = scanTier5(text);

  const threshold = options.tier2ClusterThreshold ?? SCAN_CONFIG.tier2ClusterThreshold;
  const clusterTriggered = tier2Raw.length >= threshold;

  const tier2 = {
    hits: tier2Raw,
    uniqueCount: tier2Raw.length,
    clusterThreshold: threshold,
  };

  // Compute composite score
  const weights = options.weights ?? SCAN_CONFIG.weights;
  let score = 0;

  // Tier 1: every occurrence counts heavily
  for (const hit of tier1) score += hit.count * weights.tier1;

  // Tier 2: only counts if cluster threshold is met
  if (clusterTriggered) {
    for (const hit of tier2Raw) score += weights.tier2;
  }

  // Tier 3: only count groups that exceeded their max
  for (const hit of tier3) score += weights.tier3;

  // Tier 4: every phrase occurrence
  for (const hit of tier4) score += hit.count * weights.tier4;

  // Tier 5: only patterns exceeding maxPerScene
  for (const hit of tier5) score += weights.tier5;

  // Normalize: cap at 100, scale by word count (longer text gets slightly more lenient)
  const lengthFactor = Math.max(1, wordCount / 500); // baseline 500 words
  score = Math.min(100, Math.round(score / lengthFactor));

  const failThreshold = options.failThreshold ?? SCAN_CONFIG.failThreshold;
  const pass = score <= failThreshold;

  const totalHits = tier1.length + (clusterTriggered ? tier2Raw.length : 0) +
    tier3.length + tier4.length + tier5.length;
  const totalOccurrences = [...tier1, ...tier4, ...tier5].reduce((s, h) => s + h.count, 0) +
    (clusterTriggered ? tier2Raw.reduce((s, h) => s + h.count, 0) : 0) +
    tier3.reduce((s, h) => s + h.count, 0);

  const summary = buildSummary(score, pass, failThreshold, tier1, tier2, tier3, tier4, tier5, wordCount);

  return {
    score,
    totalHits,
    totalOccurrences,
    wordCount,
    tier1,
    tier2,
    tier3,
    tier4,
    tier5,
    pass,
    summary,
  };
}

// ═══════════════════════════════════════════════════════════════
// OPTIONS
// ═══════════════════════════════════════════════════════════════

export interface ScanOptions {
  /** Override Tier 2 cluster threshold */
  tier2ClusterThreshold?: number;
  /** Override score weights per tier */
  weights?: typeof SCAN_CONFIG.weights;
  /** Override fail threshold */
  failThreshold?: number;
}

// ═══════════════════════════════════════════════════════════════
// TIER SCANNERS
// ═══════════════════════════════════════════════════════════════

function scanTier1(lower: string, original: string): SlopHit[] {
  const hits: SlopHit[] = [];

  for (const word of TIER1_WORDS) {
    const { count, positions } = findWord(lower, word);
    if (count > 0) {
      hits.push({
        term: word,
        tier: 1,
        count,
        positions,
        severity: "high",
        context: positions.slice(0, 3).map(p => extractContext(original, p, word.length)),
      });
    }
  }

  return hits;
}

function scanTier2(lower: string, original: string): SlopHit[] {
  const hits: SlopHit[] = [];

  for (const word of TIER2_WORDS) {
    const { count, positions } = findWord(lower, word);
    if (count > 0) {
      hits.push({
        term: word,
        tier: 2,
        count,
        positions,
        severity: "medium",
        context: positions.slice(0, 2).map(p => extractContext(original, p, word.length)),
      });
    }
  }

  return hits;
}

function scanTier3(lower: string, original: string): SlopHit[] {
  const hits: SlopHit[] = [];

  for (const group of TIER3_OVERUSE) {
    let totalCount = 0;
    const allPositions: number[] = [];

    for (const variant of group.variants) {
      const { count, positions } = findWord(lower, variant);
      totalCount += count;
      allPositions.push(...positions);
    }

    if (totalCount > group.max) {
      hits.push({
        term: `${group.root} (${totalCount}× / max ${group.max})`,
        tier: 3,
        count: totalCount,
        positions: allPositions.sort((a, b) => a - b),
        severity: totalCount >= group.max * 2 ? "high" : "medium",
        context: allPositions.slice(0, 3).map(p => extractContext(original, p, group.root.length)),
      });
    }
  }

  return hits;
}

function scanTier4(lower: string, original: string): SlopHit[] {
  const hits: SlopHit[] = [];

  for (const phrase of TIER4_PHRASES) {
    const { count, positions } = findPhrase(lower, phrase);
    if (count > 0) {
      hits.push({
        term: phrase,
        tier: 4,
        count,
        positions,
        severity: count >= 2 ? "high" : "medium",
        context: positions.slice(0, 3).map(p => extractContext(original, p, phrase.length)),
      });
    }
  }

  return hits;
}

function scanTier5(original: string): SlopHit[] {
  const hits: SlopHit[] = [];

  for (const pat of TIER5_PATTERNS) {
    // Algorithmic detections (placeholder patterns)
    if (pat.name === "sentence-length-uniformity") {
      const uniformityHits = detectSentenceUniformity(original);
      if (uniformityHits > pat.maxPerScene) {
        hits.push({
          term: pat.name,
          tier: 5,
          count: uniformityHits,
          positions: [],
          severity: uniformityHits >= pat.maxPerScene * 2 ? "high" : "medium",
          context: [pat.description],
        });
      }
      continue;
    }

    if (pat.name === "dramatic-fragment-cluster") {
      const fragmentHits = detectFragmentClusters(original);
      if (fragmentHits > pat.maxPerScene) {
        hits.push({
          term: pat.name,
          tier: 5,
          count: fragmentHits,
          positions: [],
          severity: fragmentHits >= pat.maxPerScene + 2 ? "high" : "medium",
          context: ["Clusters of 3+ consecutive short sentence fragments (literary prose poetry)"],
        });
      }
      continue;
    }

    if (pat.name === "narration-dialogue-ratio") {
      const ratio = detectNarrationRatio(original);
      if (ratio !== null && ratio > 0.60) {
        hits.push({
          term: pat.name,
          tier: 5,
          count: Math.round(ratio * 100),
          positions: [],
          severity: ratio > 0.75 ? "high" : "medium",
          context: [`Narration is ${Math.round(ratio * 100)}% of lines (VN should be dialogue-heavy, target <60%)`],
        });
      }
      continue;
    }

    // Reset regex state (global flag)
    const regex = new RegExp(pat.pattern.source, pat.pattern.flags);
    const positions: number[] = [];
    const contexts: string[] = [];
    let match: RegExpExecArray | null;

    while ((match = regex.exec(original)) !== null) {
      positions.push(match.index);
      if (contexts.length < 3) {
        contexts.push(extractContext(original, match.index, match[0].length));
      }
    }

    if (positions.length > pat.maxPerScene) {
      hits.push({
        term: pat.name,
        tier: 5,
        count: positions.length,
        positions,
        severity: positions.length >= pat.maxPerScene + 3 ? "high" : "medium",
        context: contexts,
      });
    }
  }

  return hits;
}

// ═══════════════════════════════════════════════════════════════
// MATCHING HELPERS
// ═══════════════════════════════════════════════════════════════

/** Find all word-boundary matches of a term in lowercase text */
function findWord(lowerText: string, word: string): { count: number; positions: number[] } {
  const positions: number[] = [];
  // Escape regex special chars in the word, then match with word boundaries
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`\\b${escaped}\\b`, "gi");
  let match: RegExpExecArray | null;
  while ((match = regex.exec(lowerText)) !== null) {
    positions.push(match.index);
  }
  return { count: positions.length, positions };
}

/** Find all substring matches of a phrase in lowercase text */
function findPhrase(lowerText: string, phrase: string): { count: number; positions: number[] } {
  const positions: number[] = [];
  let idx = 0;
  while ((idx = lowerText.indexOf(phrase, idx)) !== -1) {
    positions.push(idx);
    idx += phrase.length;
  }
  return { count: positions.length, positions };
}

/** Extract a context snippet around a match position */
function extractContext(text: string, pos: number, matchLen: number): string {
  const contextRadius = 40;
  const start = Math.max(0, pos - contextRadius);
  const end = Math.min(text.length, pos + matchLen + contextRadius);
  let snippet = text.slice(start, end).replace(/\n/g, " ");
  if (start > 0) snippet = "..." + snippet;
  if (end < text.length) snippet = snippet + "...";
  return snippet;
}

/** Detect runs of sentences with similar lengths (monotonous rhythm) */
function detectSentenceUniformity(text: string): number {
  const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 10);
  if (sentences.length < 4) return 0;

  const lengths = sentences.map(s => s.split(/\s+/).length);
  let uniformRuns = 0;
  let runLength = 1;

  for (let i = 1; i < lengths.length; i++) {
    const ratio = lengths[i] / lengths[i - 1];
    if (ratio >= 0.7 && ratio <= 1.3) {
      runLength++;
      if (runLength >= 4) {
        uniformRuns++;
        runLength = 1; // reset after counting a run
      }
    } else {
      runLength = 1;
    }
  }

  return uniformRuns;
}

/** Detect clusters of 3+ consecutive short sentence fragments (literary prose poetry) */
function detectFragmentClusters(text: string): number {
  // Split on newlines first (VN format), then look for fragment runs
  const lines = text.split(/\n/).map(l => l.trim()).filter(l => l.length > 0);
  let clusters = 0;
  let fragmentRun = 0;

  for (const line of lines) {
    // A "fragment" is a short line (≤8 words) that isn't dialogue or a stage direction
    const isDialogue = /^[A-Z]+\s*[\[:(\[]/.test(line) || /^"/.test(line) || /^\*\*/.test(line);
    const isStageDir = /^\[/.test(line);
    const wordCount = line.split(/\s+/).length;

    if (!isDialogue && !isStageDir && wordCount <= 8 && wordCount >= 2) {
      fragmentRun++;
      if (fragmentRun >= 3) {
        clusters++;
        fragmentRun = 0;
      }
    } else {
      fragmentRun = 0;
    }
  }

  return clusters;
}

/** Detect narration-to-dialogue ratio. Returns ratio (0–1) or null if not enough lines */
function detectNarrationRatio(text: string): number | null {
  const lines = text.split(/\n/).map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length < 10) return null;

  let narration = 0;
  let dialogue = 0;

  for (const line of lines) {
    // Stage directions / scene headers don't count
    if (/^\[/.test(line)) continue;
    if (/^INT\.|^EXT\.|^---/.test(line)) continue;

    // Internal thoughts count as narration
    if (/^\(/.test(line) || /^INTERNAL\b/i.test(line) || /^NARRATION\b/i.test(line)) {
      narration++;
      continue;
    }

    // Dialogue patterns (many formats):
    //   Kai [emotion]: text
    //   THE PRINCE (flat): text
    //   **SAYA [calm]:** text
    //   RENN: text
    //   "Quoted speech"
    const isDialogue =
      /^[A-Z][A-Za-z]*(?:\s+[A-Z][A-Za-z]*)?\s*[\[(:]/.test(line) ||  // Name + bracket/paren/colon
      /^\*\*[A-Z]/.test(line) ||                                       // Bold name
      /^[A-Z]{2,}(?:\s+[A-Z]{2,})*\s*[\[(:]/.test(line) ||            // ALL CAPS NAME + punct
      /^[A-Z][a-z]+\s*\[/.test(line) ||                                // Name [emotion]
      /^"/.test(line);                                                  // Quoted speech

    if (isDialogue) {
      dialogue++;
    }
    // Italic internal thoughts (*text*)
    else if (/^\*[^*]/.test(line) && !/^\*\*/.test(line)) {
      narration++;
    }
    // Plain text = narration
    else if (line.length > 15) {
      narration++;
    }
  }

  const total = narration + dialogue;
  if (total < 8) return null;
  return narration / total;
}

// ═══════════════════════════════════════════════════════════════
// REPORT FORMATTING
// ═══════════════════════════════════════════════════════════════

function buildSummary(
  score: number,
  pass: boolean,
  threshold: number,
  tier1: SlopHit[],
  tier2: ScanReport["tier2"],
  tier3: SlopHit[],
  tier4: SlopHit[],
  tier5: SlopHit[],
  wordCount: number,
): string {
  const lines: string[] = [];

  lines.push(`ANTI-SLOP SCAN — Score: ${score}/100 (threshold: ${threshold}) — ${pass ? "PASS" : "FAIL"}`);
  lines.push(`Text: ${wordCount} words`);
  lines.push("");

  if (tier1.length > 0) {
    lines.push(`TIER 1 — Kill on Sight [${tier1.length} hits]:`);
    for (const h of tier1) {
      lines.push(`  ✗ "${h.term}" ×${h.count}`);
      for (const c of h.context) lines.push(`    → ${c}`);
    }
    lines.push("");
  }

  if (tier2.uniqueCount >= tier2.clusterThreshold) {
    lines.push(`TIER 2 — Cluster Alarm [${tier2.uniqueCount} unique / threshold ${tier2.clusterThreshold}]:`);
    for (const h of tier2.hits.slice(0, 10)) {
      lines.push(`  ⚠ "${h.term}" ×${h.count}`);
    }
    if (tier2.hits.length > 10) lines.push(`  ... and ${tier2.hits.length - 10} more`);
    lines.push("");
  }

  if (tier3.length > 0) {
    lines.push(`TIER 3 — Overuse [${tier3.length} groups exceeded threshold]:`);
    for (const h of tier3) {
      lines.push(`  ⚠ ${h.term}`);
      for (const c of h.context) lines.push(`    → ${c}`);
    }
    lines.push("");
  }

  if (tier4.length > 0) {
    lines.push(`TIER 4 — Phrase Matches [${tier4.length} hits]:`);
    for (const h of tier4) {
      lines.push(`  ✗ "${h.term}" ×${h.count}`);
      for (const c of h.context) lines.push(`    → ${c}`);
    }
    lines.push("");
  }

  if (tier5.length > 0) {
    lines.push(`TIER 5 — Pattern Matches [${tier5.length} hits]:`);
    for (const h of tier5) {
      lines.push(`  ⚠ ${h.term} — ${h.count}× (max ${TIER5_PATTERNS.find(p => p.name === h.term)?.maxPerScene ?? "?"})`);
      for (const c of h.context) lines.push(`    → ${c}`);
    }
    lines.push("");
  }

  if (tier1.length === 0 && tier2.uniqueCount < tier2.clusterThreshold &&
      tier3.length === 0 && tier4.length === 0 && tier5.length === 0) {
    lines.push("No issues detected. Text is clean.");
  }

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════
// CONVENIENCE EXPORTS
// ═══════════════════════════════════════════════════════════════

/** Quick check — returns just the score (0–100) */
export function slopScore(text: string): number {
  return scanForSlop(text).score;
}

/** Extract just the flagged terms as a flat list */
export function flaggedTerms(text: string): string[] {
  const report = scanForSlop(text);
  const terms: string[] = [];
  for (const h of report.tier1) terms.push(h.term);
  if (report.tier2.uniqueCount >= report.tier2.clusterThreshold) {
    for (const h of report.tier2.hits) terms.push(h.term);
  }
  for (const h of report.tier3) terms.push(h.term);
  for (const h of report.tier4) terms.push(h.term);
  for (const h of report.tier5) terms.push(h.term);
  return terms;
}
