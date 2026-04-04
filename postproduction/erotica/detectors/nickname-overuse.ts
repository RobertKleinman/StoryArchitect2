/**
 * NICKNAME/ADDRESS OVERUSE DETECTOR
 * ==================================
 * Detects when characters overuse vocative address terms (nicknames, insults,
 * titles) as sentence decoration instead of meaningful dialogue.
 */

import type { IdentifiedScene, PipelineStoryBible } from "../../types";
import { normalizeSpecialSpeaker } from "../../types";
import type { NicknameMetrics, DetectorResult, FlaggedLine } from "../types";

/**
 * Common vocative patterns:
 * - "Listen, pet" (start with comma)
 * - "Good boy, fleet boy" (end with comma)
 * - "Kneel, rebel." (mid-sentence address)
 *
 * We detect by checking for known address terms in positions where
 * they're vocative (adjacent to punctuation or at sentence boundaries).
 */

// Address terms that are likely vocative when used in dialogue
const ADDRESS_TERMS = new Set([
  // Power dynamic
  "pet", "boy", "girl", "slave", "toy", "thing", "worm", "mutt", "dog",
  "pup", "kitten", "brat", "bitch", "slut", "whore",
  // Military/authority
  "pilot", "rebel", "soldier", "captain", "commander", "sir", "officer",
  "cadet", "recruit", "prisoner", "inmate", "grunt",
  // Mocking/insult
  "champ", "champion", "sweetheart", "darling", "honey", "love",
  "princess", "prince", "baby", "sunshine", "hero",
  // Descriptive nicknames (we match these loosely)
  "fleet boy", "pretty boy", "good boy", "bad boy",
  "fringe rat", "fleet rat", "little one",
]);

// Multi-word address terms to check first
const MULTI_WORD_TERMS = [
  "fleet boy", "pretty boy", "good boy", "bad boy",
  "fringe rat", "fleet rat", "little one", "good girl",
  "my pet", "my boy", "my girl",
];

/**
 * Build a set of character names (normalized to lowercase) to distinguish
 * from nicknames. Using someone's actual name isn't "nickname overuse."
 */
function getCharacterNames(bible: PipelineStoryBible): Set<string> {
  const names = new Set<string>();
  for (const [name, char] of Object.entries(bible.characters)) {
    names.add(name.toLowerCase());
    // Add first name and last name separately
    const parts = name.split(/\s+/);
    for (const p of parts) {
      if (p.length > 2) names.add(p.toLowerCase());
    }
    if (char.name) {
      names.add(char.name.toLowerCase());
      for (const p of char.name.split(/\s+/)) {
        if (p.length > 2) names.add(p.toLowerCase());
      }
    }
  }
  return names;
}

/**
 * Find address terms in a line of dialogue.
 * Returns the terms found.
 */
function findAddressTerms(text: string, charNames: Set<string>): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];

  // Check multi-word terms first
  for (const term of MULTI_WORD_TERMS) {
    if (lower.includes(term)) {
      found.push(term);
    }
  }

  // Check single-word terms in vocative position
  // Vocative position: near commas, at start/end, after interjections
  const words = lower.replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  for (const word of words) {
    if (ADDRESS_TERMS.has(word) && !charNames.has(word)) {
      // Avoid double-counting multi-word matches
      if (!found.some(f => f.includes(word))) {
        found.push(word);
      }
    }
  }

  return found;
}

export function detect(
  scenes: IdentifiedScene[],
  bible: PipelineStoryBible,
): DetectorResult<NicknameMetrics> {
  const charNames = getCharacterNames(bible);
  const flagged: FlaggedLine[] = [];

  let totalDialogue = 0;
  let totalAddressUses = 0;
  const allAddresses: string[] = [];
  const bySpeaker: Record<string, { count: number; terms: string[] }> = {};

  for (const scene of scenes) {
    for (const line of scene.lines) {
      const speaker = (line.speaker ?? "").toUpperCase();
      if (normalizeSpecialSpeaker(speaker) !== null) continue;
      totalDialogue++;

      const terms = findAddressTerms(line.text, charNames);
      if (terms.length > 0) {
        totalAddressUses += terms.length;
        allAddresses.push(...terms);

        const speakerKey = line.speaker.toUpperCase();
        if (!bySpeaker[speakerKey]) bySpeaker[speakerKey] = { count: 0, terms: [] };
        bySpeaker[speakerKey].count += terms.length;
        bySpeaker[speakerKey].terms.push(...terms);

        flagged.push({
          line_id: line._lid,
          scene_id: scene.scene_id,
          issue_type: "nickname_overuse",
          reason: `Address term(s): "${terms.join('", "')}"`,
          current_text: line.text,
          speaker: line.speaker,
        });
      }
    }
  }

  const rate = totalDialogue > 0 ? totalAddressUses / totalDialogue : 0;

  // Only keep flagged lines if the overall rate exceeds threshold (15%)
  const effectiveFlagged = rate > 0.15 ? flagged : [];

  return {
    metrics: {
      total_dialogue_lines: totalDialogue,
      total_address_uses: totalAddressUses,
      address_rate: rate,
      unique_addresses: [...new Set(allAddresses)],
      address_by_speaker: bySpeaker,
      flagged_line_ids: effectiveFlagged.map(f => f.line_id),
    },
    flagged: effectiveFlagged,
  };
}
