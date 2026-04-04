/**
 * DOM COMMAND MONOTONY DETECTOR
 * =============================
 * Detects when dominant characters speak almost exclusively in short barked imperatives.
 * Measures variety of dom speech patterns and flags monotonous scenes.
 */

import type { IdentifiedScene, PipelineStoryBible } from "../../types";
import { normalizeSpecialSpeaker } from "../../types";
import type { DomCommandMetrics, DetectorResult, FlaggedLine } from "../types";

// Words that signal soft/vulnerable register in dom speech
const SOFT_WORDS = new Set([
  "please", "sorry", "afraid", "careful", "gentle", "easy", "okay",
  "need", "want", "wish", "hope", "worry", "miss", "feel",
]);

/**
 * Identify dom-role characters from the story bible.
 * Uses multiple signals: role, description, psychological profile, and relationships.
 * Erotica stories typically cast antagonist as dom, but we verify via text signals.
 */
function findDomCharacters(bible: PipelineStoryBible): Set<string> {
  const doms = new Set<string>();
  const DOM_SIGNALS = /\bdom\b|dominant|dominan|master|commander|champion|captor|sadis|commanding|humiliat|enforc|control/i;

  for (const [name, char] of Object.entries(bible.characters)) {
    const role = (char.role ?? "").toLowerCase();
    const desc = (char.description ?? "").toLowerCase();
    // Check all string values in the character for dom signals
    const allText = [
      role, desc,
      ...(char.core_dials ? Object.values(char.core_dials) : []),
      ...Object.values(char.psychological_profile ?? {} as Record<string, string>),
    ].join(" ");

    if (DOM_SIGNALS.test(allText)) {
      doms.add(name.toUpperCase());
    }
  }

  // Also check relationships for dominant-submissive dynamics
  if (bible.relationships) {
    for (const rel of bible.relationships) {
      const nature = (rel.nature ?? "").toLowerCase();
      const stated = (rel.stated_dynamic ?? "").toLowerCase();
      if (/dominant|master|captor|commander/.test(nature + " " + stated)) {
        // The character whose name appears alongside "dominant"/"master" in the relationship
        for (const charName of rel.between) {
          const charData = bible.characters[charName];
          if (charData && /antagonist|supporting/.test((charData.role ?? "").toLowerCase())) {
            doms.add(charName.toUpperCase());
          }
        }
      }
    }
  }

  return doms;
}

/**
 * Classify a dialogue line into one of the dom speech variety categories.
 */
function classifyDomLine(text: string): keyof DomCommandMetrics["dom_speech_variety"] {
  const words = text.split(/\s+/).length;
  const hasQuestion = text.includes("?");
  const lowerText = text.toLowerCase();
  const hasSoftWord = lowerText.split(/\s+/).some(w => SOFT_WORDS.has(w.replace(/[^a-z]/g, "")));

  if (hasSoftWord) return "vulnerable_or_soft";
  if (hasQuestion) return "question";
  if (words > 10) return "tease_or_longer";
  if (words >= 7) return "medium_statement";
  return "short_imperative";
}

export function detect(
  scenes: IdentifiedScene[],
  bible: PipelineStoryBible,
): DetectorResult<DomCommandMetrics> {
  const domNames = findDomCharacters(bible);
  const flagged: FlaggedLine[] = [];

  let totalDomLines = 0;
  let longestDomSpeech = 0;
  const variety: DomCommandMetrics["dom_speech_variety"] = {
    short_imperative: 0,
    question: 0,
    tease_or_longer: 0,
    vulnerable_or_soft: 0,
    medium_statement: 0,
  };
  const commandShapes = new Set<string>();

  for (const scene of scenes) {
    // Count short imperatives per scene for this dom
    let sceneShortImperatives = 0;
    let sceneDomLines = 0;

    for (const line of scene.lines) {
      const speaker = (line.speaker ?? "").toUpperCase();
      if (normalizeSpecialSpeaker(speaker) !== null) continue;
      if (!domNames.has(speaker)) continue;

      totalDomLines++;
      sceneDomLines++;
      const words = line.text.split(/\s+/).length;
      if (words > longestDomSpeech) longestDomSpeech = words;

      const category = classifyDomLine(line.text);
      variety[category]++;

      if (category === "short_imperative") {
        sceneShortImperatives++;
        // Track the normalized shape for uniqueness
        const shape = line.text.toLowerCase()
          .replace(/[^a-z\s]/g, "")
          .split(/\s+/)
          .slice(0, 3)
          .join(" ");
        commandShapes.add(shape);
      }
    }

    // Flag scene if >50% of dom lines are short imperatives
    if (sceneDomLines >= 3 && sceneShortImperatives / sceneDomLines > 0.5) {
      for (const line of scene.lines) {
        const speaker = (line.speaker ?? "").toUpperCase();
        if (!domNames.has(speaker)) continue;
        if (classifyDomLine(line.text) === "short_imperative") {
          flagged.push({
            line_id: line._lid,
            scene_id: scene.scene_id,
            issue_type: "dom_command",
            reason: `Short imperative in scene where ${((sceneShortImperatives / sceneDomLines) * 100).toFixed(0)}% of dom lines are short imperatives`,
            current_text: line.text,
            speaker: line.speaker,
          });
        }
      }
    }
  }

  const shortImpRate = totalDomLines > 0 ? variety.short_imperative / totalDomLines : 0;

  return {
    metrics: {
      total_dom_lines: totalDomLines,
      short_imperative_count: variety.short_imperative,
      short_imperative_rate: shortImpRate,
      unique_command_shapes: commandShapes.size,
      monotony_score: shortImpRate, // directly proportional for now
      longest_dom_speech_words: longestDomSpeech,
      dom_speech_variety: variety,
      flagged_line_ids: flagged.map(f => f.line_id),
    },
    flagged,
  };
}
