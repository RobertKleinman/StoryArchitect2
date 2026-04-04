/**
 * INTERNAL TEMPLATE UNIFORMITY DETECTOR
 * ======================================
 * Detects when INTERNAL (thought) lines all follow the same structural template:
 * asterisk-wrapped + em-dash interruption + body sensation reference.
 * The words may vary but the shape is identical.
 */

import type { IdentifiedScene } from "../../types";
import { normalizeSpecialSpeaker } from "../../types";
import { SENSORY_WORDS } from "../../../shared/sensoryPalette";
import type { InternalTemplateMetrics, DetectorResult, FlaggedLine } from "../types";

// Additional body-specific words not in SENSORY_WORDS
const BODY_WORDS = new Set([
  "tongue", "teeth", "lips", "mouth", "throat", "skin", "chest", "stomach",
  "gut", "thigh", "thighs", "knee", "knees", "fingers", "hands", "palm",
  "wrist", "neck", "jaw", "spine", "hip", "hips", "ribs", "toes",
  "feet", "foot", "sole", "heel", "ankle", "calf", "sweat", "pulse",
  "breath", "heartbeat", "goosebumps", "shiver", "ache",
  // Sensation words
  "taste", "smell", "scent", "heat", "warmth", "salt", "musk",
]);

interface TemplateFeatures {
  asterisk_wrapped: boolean;
  self_interruption: boolean;  // em dash — or ellipsis ...
  body_sensation: boolean;
  rhetorical_question: boolean;
}

function analyzeTemplate(text: string): TemplateFeatures {
  const trimmed = text.trim();
  return {
    asterisk_wrapped: trimmed.startsWith("*") && trimmed.endsWith("*"),
    self_interruption: /[—]|\.{2,}|…/.test(text),
    body_sensation: hasBodySensation(text),
    rhetorical_question: /\?/.test(text),
  };
}

function hasBodySensation(text: string): boolean {
  const words = text.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/);
  return words.some(w => BODY_WORDS.has(w) || SENSORY_WORDS.has(w));
}

function fingerprint(features: TemplateFeatures): string {
  const parts: string[] = [];
  if (features.asterisk_wrapped) parts.push("asterisk");
  if (features.self_interruption) parts.push("interrupt");
  if (features.body_sensation) parts.push("body");
  if (features.rhetorical_question) parts.push("question");
  return parts.length > 0 ? parts.join("+") : "plain";
}

export function detect(
  scenes: IdentifiedScene[],
): DetectorResult<InternalTemplateMetrics> {
  const flagged: FlaggedLine[] = [];
  let totalInternal = 0;
  let asteriskCount = 0;
  let interruptCount = 0;
  let bodyCount = 0;
  let questionCount = 0;
  let twoOrMoreFeatures = 0;
  const fingerprints: Record<string, number> = {};

  // Collect all internal lines with their features
  const internalLines: Array<{
    line: { _lid: string; speaker: string; text: string };
    scene_id: string;
    features: TemplateFeatures;
    fp: string;
  }> = [];

  for (const scene of scenes) {
    for (const line of scene.lines) {
      const special = normalizeSpecialSpeaker(line.speaker);
      if (special !== "INTERNAL") continue;

      totalInternal++;
      const features = analyzeTemplate(line.text);
      const fp = fingerprint(features);
      fingerprints[fp] = (fingerprints[fp] ?? 0) + 1;

      if (features.asterisk_wrapped) asteriskCount++;
      if (features.self_interruption) interruptCount++;
      if (features.body_sensation) bodyCount++;
      if (features.rhetorical_question) questionCount++;

      const featureCount = [
        features.asterisk_wrapped,
        features.self_interruption,
        features.body_sensation,
      ].filter(Boolean).length;
      if (featureCount >= 2) twoOrMoreFeatures++;

      internalLines.push({ line, scene_id: scene.scene_id, features, fp });
    }
  }

  // Find the dominant fingerprint
  let dominantFp = "plain";
  let dominantCount = 0;
  for (const [fp, count] of Object.entries(fingerprints)) {
    if (count > dominantCount) {
      dominantFp = fp;
      dominantCount = count;
    }
  }

  // Flag lines that share 2+ features with the majority pattern.
  // The exact fingerprint is too granular ("asterisk+body" vs "asterisk+interrupt+body"
  // are really the same template with minor variation). Instead, flag any line that
  // shares >=2 of the 3 core template features (asterisk, interruption, body sensation).
  if (totalInternal >= 3 && twoOrMoreFeatures / totalInternal > 0.4) {
    for (const entry of internalLines) {
      const coreFeatureCount = [
        entry.features.asterisk_wrapped,
        entry.features.self_interruption,
        entry.features.body_sensation,
      ].filter(Boolean).length;
      if (coreFeatureCount >= 2) {
        flagged.push({
          line_id: entry.line._lid,
          scene_id: entry.scene_id,
          issue_type: "internal_template",
          reason: `Shares ${coreFeatureCount}/3 core template features (${((twoOrMoreFeatures / totalInternal) * 100).toFixed(0)}% of internals match this pattern)`,
          current_text: entry.line.text,
          speaker: entry.line.speaker,
        });
      }
    }
  }

  const uniformityScore = totalInternal > 0 ? twoOrMoreFeatures / totalInternal : 0;

  return {
    metrics: {
      total_internal_lines: totalInternal,
      asterisk_wrapped_rate: totalInternal > 0 ? asteriskCount / totalInternal : 0,
      self_interruption_rate: totalInternal > 0 ? interruptCount / totalInternal : 0,
      body_sensation_rate: totalInternal > 0 ? bodyCount / totalInternal : 0,
      rhetorical_question_rate: totalInternal > 0 ? questionCount / totalInternal : 0,
      template_uniformity_score: uniformityScore,
      structural_fingerprints: fingerprints,
      flagged_line_ids: flagged.map(f => f.line_id),
    },
    flagged,
  };
}
