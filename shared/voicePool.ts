/**
 * DETERMINISTIC VOICE PATTERN POOL
 * ==================================
 * Strips voice pattern generation from the LLM. The character writer outputs
 * a character with a generic voice_pattern; this module replaces it with a
 * mechanically distinct pattern from a curated pool.
 *
 * Same approach as namePool.ts — curated data, deterministic assignment,
 * zero LLM calls.
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Types ───────────────────────────────────────────────────────────

export interface VoicePattern {
  id: string;
  voice_pattern: string;
  speech_card: {
    typical_length: string;
    under_pressure: string;
    never_articulates: string;
    deflection_style: string;
  };
  tags: string[];
}

// ── Pool Loading ────────────────────────────────────────────────────

let cachedPool: VoicePattern[] | null = null;

export function loadVoicePool(): VoicePattern[] {
  if (cachedPool) return cachedPool;
  const poolPath = join(__dirname, "data", "voicePool.json");
  cachedPool = JSON.parse(readFileSync(poolPath, "utf-8")) as VoicePattern[];
  return cachedPool;
}

// ── Assignment ──────────────────────────────────────────────────────

/**
 * Tag preferences by character role.
 * These bias the selection but don't hard-constrain it.
 */
const ROLE_TAG_PREFERENCES: Record<string, string[]> = {
  protagonist: ["honest", "vulnerable", "spontaneous", "cautious"],
  antagonist: ["controlling", "intimidating", "domineering", "direct"],
  catalyst: ["charismatic", "playful", "warm", "probing"],
  supporting: ["observant", "systematic", "dry", "reactive"],
};

/**
 * Assign distinct voice patterns to a set of characters.
 * Guarantees no two characters in the same story share a voice pattern.
 *
 * @param characters Array of character objects with at least { role, name }
 * @param usedVoiceIds Voice IDs to exclude (from fingerprints, if desired)
 * @returns Map of character name → assigned VoicePattern
 */
export function assignVoicePatterns(
  characters: Array<{ name: string; role?: string }>,
  usedVoiceIds?: Set<string>,
): Map<string, VoicePattern> {
  const pool = loadVoicePool();
  const available = pool.filter(v => !usedVoiceIds?.has(v.id));
  const assigned = new Map<string, VoicePattern>();
  const usedInStory = new Set<string>();

  for (const char of characters) {
    const role = (char.role ?? "").toLowerCase();
    const preferredTags = ROLE_TAG_PREFERENCES[role] ?? [];

    // Score each available voice by tag overlap with role preference
    const candidates = available
      .filter(v => !usedInStory.has(v.id))
      .map(v => {
        const tagOverlap = v.tags.filter(t => preferredTags.includes(t)).length;
        return { voice: v, score: tagOverlap };
      })
      .sort((a, b) => b.score - a.score);

    if (candidates.length === 0) {
      // Pool exhausted — wrap around with a warning
      console.warn(`[voice] Pool exhausted for ${char.name} — reusing from full pool`);
      const fallback = pool.find(v => !usedInStory.has(v.id)) ?? pool[0];
      assigned.set(char.name, fallback);
      usedInStory.add(fallback.id);
      continue;
    }

    // Pick the best match (or random from top tier if tied)
    const topScore = candidates[0].score;
    const topCandidates = candidates.filter(c => c.score === topScore);
    // Deterministic selection: hash the character name to pick from ties
    const hash = char.name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
    const picked = topCandidates[hash % topCandidates.length].voice;

    assigned.set(char.name, picked);
    usedInStory.add(picked.id);
  }

  return assigned;
}

/**
 * Apply assigned voice patterns to character data.
 * Overwrites voice_pattern and speech_card in psychological_profile.
 */
export function applyVoicePatterns(
  charData: any,
  assignments: Map<string, VoicePattern>,
): void {
  for (const c of (charData.characters ?? [])) {
    const name = c.name;
    const assigned = assignments.get(name);
    if (!assigned) continue;

    if (!c.psychological_profile) c.psychological_profile = {};
    const oldVoice = c.psychological_profile.voice_pattern;
    c.psychological_profile.voice_pattern = assigned.voice_pattern;
    c.psychological_profile.speech_card = assigned.speech_card;

    console.log(`[voice] ${name}: "${oldVoice?.substring(0, 40)}..." → "${assigned.id}"`);
  }
}
