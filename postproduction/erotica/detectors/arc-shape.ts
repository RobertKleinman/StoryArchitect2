/**
 * SUB ARC SHAPE DETECTOR (report-only)
 * ======================================
 * Measures the emotional arc shape of submissive characters per scene.
 * Not fixable in postprod — this is an upstream planning issue.
 * Provides baselines for measuring scene planner prompt changes.
 */

import type { IdentifiedScene, PipelineStoryBible } from "../../types";
import { normalizeSpecialSpeaker } from "../../types";
import type { ArcShapeMetrics, DetectorResult } from "../types";

// Emotion registers for arc classification
const DEFIANT_WORDS = /defian|resist|sarcas|mock|bitter|rebel|snark|angry|fury|rage|hostile/i;
const YIELDING_WORDS = /yield|surrender|submit|comply|accept|obey|give in|broke|dissolv/i;
const AROUSAL_WORDS = /arous|desire|heat|want|hunger|lust|need|daze|haze|intoxicat/i;
const VULNERABLE_WORDS = /vulnerab|soft|tender|gentle|afraid|scared|trembl|quiet|pleading|exposed/i;
const CONFLICTED_WORDS = /conflict|torn|ambival|uncertain|doubt|confusion|mixed/i;

type EmotionBucket = "defiant" | "yielding" | "aroused" | "vulnerable" | "conflicted" | "other";

function classifyEmotion(emotion: string): EmotionBucket {
  if (DEFIANT_WORDS.test(emotion)) return "defiant";
  if (YIELDING_WORDS.test(emotion)) return "yielding";
  if (AROUSAL_WORDS.test(emotion)) return "aroused";
  if (VULNERABLE_WORDS.test(emotion)) return "vulnerable";
  if (CONFLICTED_WORDS.test(emotion)) return "conflicted";
  return "other";
}

/**
 * Identify sub-role characters from the story bible.
 * In erotica, the protagonist is typically the sub. Verify via text signals.
 */
function findSubCharacters(bible: PipelineStoryBible): Set<string> {
  const subs = new Set<string>();
  const SUB_SIGNALS = /\bsub\b|submissive|captive|prisoner|slave|claimed|obedien|defiant|torn between|reluctant/i;

  for (const [name, char] of Object.entries(bible.characters)) {
    const role = (char.role ?? "").toLowerCase();
    const desc = (char.description ?? "").toLowerCase();
    const allText = [
      role, desc,
      ...(char.core_dials ? Object.values(char.core_dials) : []),
      ...Object.values(char.psychological_profile ?? {} as Record<string, string>),
    ].join(" ");

    if (SUB_SIGNALS.test(allText) || role === "protagonist") {
      subs.add(name.toUpperCase());
    }
  }

  // Also check relationships
  if (bible.relationships) {
    for (const rel of bible.relationships) {
      const nature = (rel.nature ?? "").toLowerCase();
      const stated = (rel.stated_dynamic ?? "").toLowerCase();
      if (/submissive|captive|slave|claimed/.test(nature + " " + stated)) {
        for (const charName of rel.between) {
          const charData = bible.characters[charName];
          if (charData && /protagonist/.test((charData.role ?? "").toLowerCase())) {
            subs.add(charName.toUpperCase());
          }
        }
      }
    }
  }

  return subs;
}

/**
 * Compress a full emotion sequence into a simplified arc shape string.
 * e.g., ["defiant", "defiant", "aroused", "conflicted", "yielding"] → "defiant→aroused→conflicted→yielding"
 */
function compressArc(buckets: EmotionBucket[]): string {
  if (buckets.length === 0) return "empty";
  // Remove consecutive duplicates
  const compressed: EmotionBucket[] = [buckets[0]];
  for (let i = 1; i < buckets.length; i++) {
    if (buckets[i] !== compressed[compressed.length - 1]) {
      compressed.push(buckets[i]);
    }
  }
  return compressed.join("→");
}

export function detect(
  scenes: IdentifiedScene[],
  bible: PipelineStoryBible,
): DetectorResult<ArcShapeMetrics> {
  const subNames = findSubCharacters(bible);
  const arcShapes: Array<{ scene_id: string; shape: string }> = [];
  const openingEmotions: Record<string, number> = {};

  for (const scene of scenes) {
    const subEmotions: EmotionBucket[] = [];

    for (const line of scene.lines) {
      const speaker = (line.speaker ?? "").toUpperCase();
      if (normalizeSpecialSpeaker(speaker) !== null) continue;
      if (!subNames.has(speaker)) continue;

      const bucket = classifyEmotion(line.emotion ?? "");
      subEmotions.push(bucket);
    }

    if (subEmotions.length === 0) {
      arcShapes.push({ scene_id: scene.scene_id, shape: "no_sub_lines" });
      continue;
    }

    // Track opening emotion
    const opening = subEmotions[0];
    openingEmotions[opening] = (openingEmotions[opening] ?? 0) + 1;

    const shape = compressArc(subEmotions);
    arcShapes.push({ scene_id: scene.scene_id, shape });
  }

  // Find dominant arc shape
  const shapeCounts: Record<string, number> = {};
  for (const { shape } of arcShapes) {
    shapeCounts[shape] = (shapeCounts[shape] ?? 0) + 1;
  }
  let dominantShape: string | null = null;
  let dominantFreq = 0;
  for (const [shape, count] of Object.entries(shapeCounts)) {
    if (count > dominantFreq) {
      dominantShape = shape;
      dominantFreq = count;
    }
  }

  const uniqueShapes = new Set(arcShapes.map(a => a.shape));
  const diversityScore = arcShapes.length > 0 ? uniqueShapes.size / arcShapes.length : 0;

  return {
    metrics: {
      scene_count: scenes.length,
      arc_shapes: arcShapes,
      opening_emotion_distribution: openingEmotions,
      dominant_arc_shape: dominantShape,
      dominant_arc_frequency: dominantFreq,
      shape_diversity_score: diversityScore,
    },
    flagged: [], // report-only, no fixable flags
  };
}
