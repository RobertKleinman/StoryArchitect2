/**
 * OPEN-ENDED STRUCTURAL METRICS (report-only)
 * =============================================
 * Catches patterns we haven't theorized yet.
 * Measures line length distribution, speaker balance, bigram frequency,
 * scene opening/closing patterns, and consecutive speaker runs.
 */

import type { IdentifiedScene } from "../../types";
import { normalizeSpecialSpeaker } from "../../types";
import type { OpenEndedMetrics, DetectorResult } from "../types";

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)];
}

function stdev(values: number[], mean: number): number {
  if (values.length <= 1) return 0;
  const sumSq = values.reduce((acc, v) => acc + (v - mean) ** 2, 0);
  return Math.sqrt(sumSq / (values.length - 1));
}

/**
 * Abstract a line into a pattern token for scene opening/closing analysis.
 * e.g., "NARRATION" → "NAR", "TANAKA HARUKI" (dom) → "DIAL", "INTERNAL" → "INT"
 */
function linePattern(speaker: string): string {
  const upper = speaker.toUpperCase();
  const special = normalizeSpecialSpeaker(upper);
  if (special === "NARRATION") return "NAR";
  if (special === "INTERNAL") return "INT";
  return "DIAL";
}

export function detect(
  scenes: IdentifiedScene[],
): DetectorResult<OpenEndedMetrics> {
  const dialogueLengths: number[] = [];
  const speakerCounts: Record<string, number> = {};
  const bigramCounts: Record<string, number> = {};
  let maxConsecutiveSame = 0;

  const openingPatterns: Array<{ scene_id: string; pattern: string }> = [];
  const closingPatterns: Array<{ scene_id: string; pattern: string }> = [];

  for (const scene of scenes) {
    // Scene opening/closing patterns (first and last 3 lines)
    const first3 = scene.lines.slice(0, 3).map(l => linePattern(l.speaker)).join("→");
    const last3 = scene.lines.slice(-3).map(l => linePattern(l.speaker)).join("→");
    openingPatterns.push({ scene_id: scene.scene_id, pattern: first3 });
    closingPatterns.push({ scene_id: scene.scene_id, pattern: last3 });

    // Track consecutive same speaker
    let consecutive = 1;
    for (let i = 1; i < scene.lines.length; i++) {
      if (scene.lines[i].speaker === scene.lines[i - 1].speaker) {
        consecutive++;
        if (consecutive > maxConsecutiveSame) maxConsecutiveSame = consecutive;
      } else {
        consecutive = 1;
      }
    }

    // Per-line analysis
    for (const line of scene.lines) {
      const speaker = line.speaker ?? "";
      const upper = speaker.toUpperCase();
      if (normalizeSpecialSpeaker(upper) !== null) continue;

      // Dialogue line length
      const words = line.text.split(/\s+/);
      dialogueLengths.push(words.length);

      // Speaker balance (normalize casing)
      const speakerKey = speaker.toUpperCase();
      speakerCounts[speakerKey] = (speakerCounts[speakerKey] ?? 0) + 1;

      // Bigram extraction (from dialogue only)
      const normalized = line.text.toLowerCase().replace(/[^a-z'\s]/g, "").split(/\s+/).filter(Boolean);
      const seen = new Set<string>();
      for (let i = 0; i < normalized.length - 1; i++) {
        const bg = `${normalized[i]} ${normalized[i + 1]}`;
        if (!seen.has(bg)) {
          seen.add(bg);
          bigramCounts[bg] = (bigramCounts[bg] ?? 0) + 1;
        }
      }
    }
  }

  // Compute line length stats
  const sorted = [...dialogueLengths].sort((a, b) => a - b);
  const mean = sorted.length > 0 ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0;

  // Top bigrams (exclude ultra-common function-word pairs)
  const BORING_STARTS = new Set(["i", "you", "it", "the", "a", "to", "in", "on", "of", "is", "and", "but", "my", "your", "this", "that", "do", "don't", "not", "no", "he", "she", "we", "they"]);
  const topBigrams = Object.entries(bigramCounts)
    .filter(([bg, count]) => count >= 3 && !BORING_STARTS.has(bg.split(" ")[0]))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([bigram, count]) => ({ bigram, count }));

  return {
    metrics: {
      line_length: {
        mean: Math.round(mean * 10) / 10,
        median: median(sorted),
        stdev: Math.round(stdev(dialogueLengths, mean) * 10) / 10,
        p10: percentile(sorted, 0.1),
        p90: percentile(sorted, 0.9),
      },
      speaker_balance: speakerCounts,
      consecutive_same_speaker_max: maxConsecutiveSame,
      top_bigrams: topBigrams,
      scene_opening_patterns: openingPatterns,
      scene_closing_patterns: closingPatterns,
    },
    flagged: [], // open-ended, no specific flags
  };
}
