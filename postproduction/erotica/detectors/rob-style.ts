/**
 * ROB STYLE DEVIATION DETECTOR
 * ==============================
 * Detects dialogue patterns that diverge from Rob's writing style:
 * 1. Sentences too short — >90% under 8 words (Rob's zone: 8-18)
 * 2. Rhetorical self-questioning in INTERNAL — "Why's it...?" (Rob: state, don't ask)
 * 3. Exclamation overuse — >5% of dialogue with ! (Rob: almost never)
 *
 * Issues 1 and 2 are fixable in postprod. Issue 3 is fixable but low-risk.
 */

import type { IdentifiedScene } from "../../types";
import { normalizeSpecialSpeaker } from "../../types";
import type { DetectorResult, FlaggedLine, RobStyleMetrics } from "../types";

// Rhetorical question patterns that Rob avoids in internal monologue
const RHETORICAL_SELF_Q = /\bwhy('s|'d| is| does| do| did| would| was)?\s/i;
const SELF_QUESTIONING = /\b(what (would|could|if|does)|how (long|far|much|can|does|did)|when (did|will|would))\b/i;

/**
 * Count words in individual sentences within a line.
 * Splits on sentence-ending punctuation.
 */
function sentenceWordCounts(text: string): number[] {
  return text
    .split(/[.!?]+/)
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .map(s => s.split(/\s+/).length);
}

export function detect(
  scenes: IdentifiedScene[],
): DetectorResult<RobStyleMetrics> {
  const flagged: FlaggedLine[] = [];

  // Sentence length tracking
  const allSentenceLengths: number[] = [];

  // Rhetorical question tracking
  let internalTotal = 0;
  let internalQuestions = 0;
  let whyWhatHow = 0;

  // Exclamation tracking
  let dialogueTotal = 0;
  let exclLines = 0;

  // Per-scene: track which scenes have too-short dialogue
  for (const scene of scenes) {
    const sceneSentenceLengths: number[] = [];
    let sceneDialogueCount = 0;

    for (const line of scene.lines) {
      const speaker = (line.speaker ?? "").toUpperCase();
      const special = normalizeSpecialSpeaker(speaker);

      if (special === "INTERNAL") {
        internalTotal++;
        const hasQ = line.text.includes("?");
        if (hasQ) {
          internalQuestions++;
          if (RHETORICAL_SELF_Q.test(line.text) || SELF_QUESTIONING.test(line.text)) {
            whyWhatHow++;
            flagged.push({
              line_id: line._lid,
              scene_id: scene.scene_id,
              issue_type: "internal_template", // reuse existing type — same rewriter handles it
              reason: `Rhetorical self-question ("${line.text.match(/why|what|how/i)?.[0] ?? "?"}...?") — Rob style: state it, don't ask it`,
              current_text: line.text,
              speaker: line.speaker,
            });
          }
        }
      } else if (special === null) {
        // Character dialogue
        dialogueTotal++;
        sceneDialogueCount++;

        // Exclamation check
        if (line.text.includes("!")) {
          exclLines++;
        }

        // Sentence lengths
        const lengths = sentenceWordCounts(line.text);
        sceneSentenceLengths.push(...lengths);
        allSentenceLengths.push(...lengths);
      }
    }

    // Flag scenes where dialogue is overwhelmingly too short
    // Only flag individual dom lines that are under 4 words — those are the rewrite targets
    // (The sentence-length issue overlaps with dom-command monotony)
  }

  // Exclamation: flag if rate > 5%
  if (dialogueTotal > 10 && exclLines / dialogueTotal > 0.05) {
    // Flag individual lines with exclamation marks in high-exclamation scenes
    for (const scene of scenes) {
      let sceneExcl = 0;
      let sceneDialogue = 0;
      for (const line of scene.lines) {
        const special = normalizeSpecialSpeaker((line.speaker ?? "").toUpperCase());
        if (special !== null) continue;
        sceneDialogue++;
        if (line.text.includes("!")) sceneExcl++;
      }
      // Flag exclamation lines in scenes with >10% rate
      if (sceneDialogue >= 5 && sceneExcl / sceneDialogue > 0.1) {
        for (const line of scene.lines) {
          const special = normalizeSpecialSpeaker((line.speaker ?? "").toUpperCase());
          if (special !== null) continue;
          if (line.text.includes("!")) {
            flagged.push({
              line_id: line._lid,
              scene_id: scene.scene_id,
              issue_type: "dom_command", // reuse — same rewriter can tone down
              reason: `Exclamation mark — Rob style: almost never. Quiet intensity > shouting`,
              current_text: line.text,
              speaker: line.speaker,
            });
          }
        }
      }
    }
  }

  // Compute stats
  const under8 = allSentenceLengths.filter(l => l < 8).length;
  const inZone = allSentenceLengths.filter(l => l >= 8 && l <= 18).length;
  const over25 = allSentenceLengths.filter(l => l > 25).length;
  const mean = allSentenceLengths.length > 0
    ? allSentenceLengths.reduce((a, b) => a + b, 0) / allSentenceLengths.length
    : 0;

  return {
    metrics: {
      dialogue_sentence_count: allSentenceLengths.length,
      under_8_words_rate: allSentenceLengths.length > 0 ? under8 / allSentenceLengths.length : 0,
      in_zone_rate: allSentenceLengths.length > 0 ? inZone / allSentenceLengths.length : 0,
      over_25_words_rate: allSentenceLengths.length > 0 ? over25 / allSentenceLengths.length : 0,
      mean_sentence_words: Math.round(mean * 10) / 10,
      internal_question_count: internalQuestions,
      internal_question_rate: internalTotal > 0 ? internalQuestions / internalTotal : 0,
      why_what_how_count: whyWhatHow,
      exclamation_line_count: exclLines,
      exclamation_rate: dialogueTotal > 0 ? exclLines / dialogueTotal : 0,
      flagged_line_ids: flagged.map(f => f.line_id),
    },
    flagged,
  };
}
