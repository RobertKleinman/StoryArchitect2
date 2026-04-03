/**
 * DETERMINISTIC NAME POOL
 * =======================
 * Strips naming authority from the LLM. The character writer outputs a NameSpec;
 * this module resolves it to an actual name from a curated pool, mechanically
 * excluding fingerprint-used names.
 *
 * Zero extra LLM calls. Pure deterministic resolution.
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { StoryFingerprint } from "./fingerprint";
import { extractFirstNames } from "./fingerprint";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Types ───────────────────────────────────────────────────────────

export const CULTURE_FAMILIES = [
  "east_asian", "south_asian", "west_african", "east_african",
  "arabic", "latin_american", "slavic", "mediterranean",
  "northern_european", "southeast_asian", "pacific_islander",
  "persian", "caribbean",
] as const;

export type CultureFamily = typeof CULTURE_FAMILIES[number];

export interface NameSpec {
  culture: CultureFamily;
  gender_presentation: "masculine" | "feminine" | "neutral";
  feel: "formal" | "casual" | "diminutive" | "archaic";
}

export interface LinkedName {
  given: string;
  surname?: string;
  culture: CultureFamily;
  gender_presentation: "masculine" | "feminine" | "neutral";
  display_order: "given_first" | "family_first";
  display_name: string;
}

export interface NameProfile {
  world_type: "real_world" | "fantasy" | "hybrid";
  allowed_families: CultureFamily[];
  naming_style: "formal" | "casual" | "mixed";
}

// ── Pool Loading ────────────────────────────────────────────────────

let cachedPool: LinkedName[] | null = null;

export function loadNamePool(): LinkedName[] {
  if (cachedPool) return cachedPool;
  const poolPath = join(__dirname, "data", "namePool.json");
  cachedPool = JSON.parse(readFileSync(poolPath, "utf-8")) as LinkedName[];
  return cachedPool;
}

/** Clear cache (for testing) */
export function resetPoolCache(): void {
  cachedPool = null;
}

// ── Exclusion Set ───────────────────────────────────────────────────

/**
 * Build a set of names to exclude from the pool.
 * Includes all full names and overused first names (2+) from recent fingerprints.
 */
export function buildExclusionSet(fingerprints: StoryFingerprint[]): Set<string> {
  const excluded = new Set<string>();
  const recent = fingerprints.slice(-15);

  // All full names (both given and display_name forms)
  for (const fp of recent) {
    for (const name of fp.character_names) {
      excluded.add(name.toLowerCase());
      // Also exclude the first name individually
      const parts = name.split(/\s+/);
      if (parts[0]?.length >= 2) excluded.add(parts[0].toLowerCase());
    }
  }

  // First names appearing 2+ times across stories
  const allNames = recent.flatMap(fp => fp.character_names);
  const firstNameCounts = extractFirstNames(allNames);
  // Count per-story occurrences (more accurate)
  const storyCounts = new Map<string, number>();
  for (const fp of recent) {
    const firsts = extractFirstNames(fp.character_names);
    for (const name of firsts) {
      storyCounts.set(name.toLowerCase(), (storyCounts.get(name.toLowerCase()) ?? 0) + 1);
    }
  }
  for (const [name, count] of storyCounts) {
    if (count >= 2) excluded.add(name);
  }

  return excluded;
}

// ── Name Resolution ─────────────────────────────────────────────────

/**
 * Resolve a NameSpec to an actual name from the pool.
 * Fallback chain: exact match → widen gender → widen culture → any remaining → fantasy name.
 */
export function resolveName(
  spec: NameSpec,
  excluded: Set<string>,
  pool: LinkedName[],
  allowedFamilies?: CultureFamily[],
): LinkedName | null {
  // Helper to check if a name is excluded
  const isExcluded = (n: LinkedName): boolean => {
    return excluded.has(n.given.toLowerCase()) ||
      excluded.has(n.display_name.toLowerCase()) ||
      (n.surname ? excluded.has(n.surname.toLowerCase()) : false);
  };

  // Step 1: exact culture + gender match
  let candidates = pool.filter(n =>
    n.culture === spec.culture &&
    n.gender_presentation === spec.gender_presentation &&
    !isExcluded(n),
  );
  if (candidates.length > 0) return pickRandom(candidates);

  // Step 2: widen gender (same culture, any gender)
  candidates = pool.filter(n =>
    n.culture === spec.culture &&
    !isExcluded(n),
  );
  if (candidates.length > 0) return pickRandom(candidates);

  // Step 3: widen culture (allowed families, same gender)
  const families = allowedFamilies ?? CULTURE_FAMILIES as unknown as CultureFamily[];
  candidates = pool.filter(n =>
    families.includes(n.culture) &&
    n.gender_presentation === spec.gender_presentation &&
    !isExcluded(n),
  );
  if (candidates.length > 0) return pickRandom(candidates);

  // Step 4: any remaining non-excluded name
  candidates = pool.filter(n => !isExcluded(n));
  if (candidates.length > 0) return pickRandom(candidates);

  // Step 5: pool exhausted — generate a fantasy name
  return null;
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── Fantasy Name Generator ──────────────────────────────────────────

// Simple bigram-based syllable templates per culture family
const SYLLABLE_TABLES: Record<string, string[][]> = {
  east_asian: [["Ki", "Mi", "Shi", "Ta", "Yu", "Na", "Ha", "Ri", "Ko", "To"], ["ra", "to", "ki", "na", "shi", "mi", "ru", "ko", "en", "da"]],
  south_asian: [["Aa", "De", "Vi", "Pra", "Ne", "Ka", "Su", "Ma", "Ra", "In"], ["vi", "ya", "na", "ra", "ka", "ti", "shi", "la", "mi", "ta"]],
  west_african: [["Ko", "Ada", "Chi", "Olu", "Ama", "Efe", "Obi", "Ba"], ["fi", "ra", "di", "ma", "le", "wu", "ke", "na"]],
  east_african: [["Za", "Ja", "Ba", "Wa", "Fa", "Na", "Ki", "Mu"], ["ri", "ni", "la", "ku", "shi", "ra", "di", "ma"]],
  arabic: [["Sa", "Na", "Fa", "Ha", "Za", "Ra", "Ka", "La", "Ma", "Ya"], ["mir", "dia", "ris", "lil", "riq", "nia", "sim", "yed", "lid", "dan"]],
  latin_american: [["Ma", "Lu", "Ca", "Ra", "Is", "So", "Te", "Re", "Vi", "Jo"], ["teo", "cia", "fael", "nuel", "dora", "lia", "ren", "miro", "bel", "nas"]],
  slavic: [["Ni", "Ka", "An", "Mi", "Bo", "Zo", "Iv", "Ve", "Da", "Le"], ["kai", "lena", "drei", "sha", "dan", "ra", "sna", "mir", "kov", "ta"]],
  mediterranean: [["Lu", "Sta", "Em", "Chi", "Ni", "El", "Ma", "Id"], ["ca", "ros", "re", "ara", "kos", "lis", "rta", "il"]],
  northern_european: [["Er", "In", "Os", "Si", "Fr", "Ca", "Wi", "Ma"], ["ik", "grid", "kar", "gne", "eya", "llum", "llem", "eve"]],
  southeast_asian: [["Ba", "Mi", "Li", "Tha", "Si", "Ri", "Da", "Pu"], ["o", "nh", "tri", "ni", "zal", "ko", "nah", "ang"]],
  pacific_islander: [["Ma", "Ta", "Si", "La", "Mo", "Ar", "Ka", "Wa"], ["lu", "ne", "one", "ni", "ana", "oha", "hi", "iru"]],
  persian: [["Da", "Shi", "Cy", "Pa", "Be", "Na", "Ka", "Ar"], ["rius", "rin", "rus", "risa", "rouz", "sim", "mran", "dash"]],
  caribbean: [["Le", "So", "Ce", "Na", "De", "Lu", "Ro", "Ma"], ["ander", "lange", "dric", "ya", "smond", "cien", "wan", "rcel"]],
};

/**
 * Generate a fantasy/sci-fi name using culture-inspired syllable patterns.
 * Not a real name from any culture — a phonetically inspired invention.
 */
export function generateFantasyName(
  spec: NameSpec,
  excluded: Set<string>,
  maxAttempts = 20,
): string {
  const table = SYLLABLE_TABLES[spec.culture] ?? SYLLABLE_TABLES.east_asian;
  const [starts, ends] = table;

  for (let i = 0; i < maxAttempts; i++) {
    const start = pickRandom(starts);
    const end = pickRandom(ends);
    const name = start + end;
    if (!excluded.has(name.toLowerCase()) && name.length >= 3 && name.length <= 12) {
      return name;
    }
  }

  // Last resort: random consonant+vowel combo
  const consonants = "bcdfghjklmnprstvwyz";
  const vowels = "aeiou";
  const c1 = consonants[Math.floor(Math.random() * consonants.length)];
  const v1 = vowels[Math.floor(Math.random() * vowels.length)];
  const c2 = consonants[Math.floor(Math.random() * consonants.length)];
  const v2 = vowels[Math.floor(Math.random() * vowels.length)];
  return (c1 + v1 + c2 + v2 + c1).charAt(0).toUpperCase() + (c1 + v1 + c2 + v2).slice(1);
}

// ── Name Profile Resolution ─────────────────────────────────────────

/**
 * Derive a NameProfile from world data and premise.
 * Deterministic heuristic — no LLM calls.
 */
export function resolveNameProfile(
  worldData: any,
  premiseToneChips?: string[],
  premiseSettingAnchor?: string,
): NameProfile {
  const worldThesis = (worldData?.world_thesis ?? "").toLowerCase();
  const settingAnchor = (premiseSettingAnchor ?? "").toLowerCase();
  const combined = worldThesis + " " + settingAnchor;

  // Detect world type
  let worldType: NameProfile["world_type"] = "hybrid"; // default for sci-fi with cultural characters
  if (/fantasy|magic|arcane|mythic|realm|kingdom|enchant/.test(combined)) {
    worldType = "fantasy";
  } else if (/contemporary|modern|present[- ]day|real[- ]world|20[0-2]\d/.test(combined)) {
    worldType = "real_world";
  }

  // Detect cultures from setting keywords
  const detectedFamilies = new Set<CultureFamily>();
  const cultureSignals: [RegExp, CultureFamily][] = [
    [/japan|tokyo|osaka|kyoto|japanese/, "east_asian"],
    [/korea|seoul|korean|busan/, "east_asian"],
    [/china|chinese|beijing|shanghai|hong kong/, "east_asian"],
    [/india|mumbai|delhi|indian|hindu|sikh|tamil/, "south_asian"],
    [/pakistan|banglad|sri lanka|nepal/, "south_asian"],
    [/nigeria|ghana|lagos|accra|igbo|yoruba|west afric/, "west_african"],
    [/kenya|tanzania|ethiopia|nairobi|east afric|somali/, "east_african"],
    [/arab|dubai|cairo|egypt|lebano|syria|iraq|jordan|saudi/, "arabic"],
    [/brazil|mexico|colombia|argentina|latin|rio|buenos|caribbean coast/, "latin_american"],
    [/russia|poland|czech|ukraine|serbia|slavic|moscow|warsaw/, "slavic"],
    [/italy|greece|turkey|spain|portugal|mediterranean|rome|athens|istanbul/, "mediterranean"],
    [/scandinav|sweden|norway|denmark|finland|iceland|ireland|scotland|dutch|german|berlin|london|british/, "northern_european"],
    [/vietnam|thai|philipp|indonesia|malaysia|singapore|manila|bangkok/, "southeast_asian"],
    [/hawaii|samoa|tonga|fiji|maori|polynesi|pacific/, "pacific_islander"],
    [/iran|persian|tehran|isfahan|persia/, "persian"],
    [/caribbean|jamaica|haiti|trinidad|barbados|cuba|puerto rico/, "caribbean"],
  ];

  for (const [pattern, culture] of cultureSignals) {
    if (pattern.test(combined)) detectedFamilies.add(culture);
  }

  // Ensure minimum 3 families
  if (detectedFamilies.size < 3) {
    // Add diverse defaults that complement whatever was detected
    const defaults: CultureFamily[] = [
      "east_asian", "west_african", "latin_american", "south_asian",
      "arabic", "mediterranean", "slavic", "caribbean",
    ];
    for (const d of defaults) {
      if (detectedFamilies.size >= 3) break;
      detectedFamilies.add(d);
    }
  }

  // Detect naming style
  let namingStyle: NameProfile["naming_style"] = "mixed";
  const toneStr = (premiseToneChips ?? []).join(" ").toLowerCase();
  if (/formal|courtly|diplomatic|military|institutional/.test(toneStr + " " + combined)) {
    namingStyle = "formal";
  } else if (/casual|intimate|slice.of.life|comedy|found.family/.test(toneStr + " " + combined)) {
    namingStyle = "casual";
  }

  return {
    world_type: worldType,
    allowed_families: [...detectedFamilies],
    naming_style: namingStyle,
  };
}

// ── Full Resolution Pipeline ────────────────────────────────────────

export interface ResolvedCharacter {
  placeholder: string;
  resolvedName: string;
  nameSpec: NameSpec;
  source: "pool" | "fantasy" | "user_provided" | "llm_fallback";
}

/**
 * Resolve all character names from LLM output.
 * Returns a map of placeholder → resolved name for string replacement.
 */
export function resolveAllNames(
  characters: any[],
  fingerprints: StoryFingerprint[],
  worldData: any,
  premiseToneChips?: string[],
  premiseSettingAnchor?: string,
  userProvidedNames?: Set<string>,
): ResolvedCharacter[] {
  const pool = loadNamePool();
  const excluded = buildExclusionSet(fingerprints);
  const profile = resolveNameProfile(worldData, premiseToneChips, premiseSettingAnchor);
  const resolved: ResolvedCharacter[] = [];

  // Track names assigned in this story to prevent intra-story duplicates
  const storyExcluded = new Set(excluded);

  for (const char of characters) {
    // If user explicitly provided this name, keep it
    if (char.name && userProvidedNames?.has(char.name)) {
      resolved.push({
        placeholder: char.name_spec?.placeholder ?? char.name,
        resolvedName: char.name,
        nameSpec: char.name_spec ?? { culture: "northern_european", gender_presentation: "neutral", feel: "casual" },
        source: "user_provided",
      });
      storyExcluded.add(char.name.toLowerCase());
      const firstName = char.name.split(/\s+/)[0];
      if (firstName) storyExcluded.add(firstName.toLowerCase());
      continue;
    }

    // If LLM output a name_spec, resolve from pool
    if (char.name_spec) {
      const spec: NameSpec = {
        culture: CULTURE_FAMILIES.includes(char.name_spec.culture) ? char.name_spec.culture : pickRandom([...profile.allowed_families]),
        gender_presentation: ["masculine", "feminine", "neutral"].includes(char.name_spec.gender_presentation)
          ? char.name_spec.gender_presentation : "neutral",
        feel: char.name_spec.feel ?? "casual",
      };

      let resolvedName: string;
      let source: ResolvedCharacter["source"];

      if (profile.world_type === "fantasy") {
        // Fantasy world: use procedural generator
        resolvedName = generateFantasyName(spec, storyExcluded);
        source = "fantasy";
      } else {
        // Real or hybrid world: try pool first, then fantasy fallback
        const poolResult = resolveName(spec, storyExcluded, pool, profile.allowed_families);
        if (poolResult) {
          resolvedName = poolResult.display_name;
          source = "pool";
        } else {
          resolvedName = generateFantasyName(spec, storyExcluded);
          source = "fantasy";
        }
      }

      resolved.push({
        placeholder: char.name_spec.placeholder ?? `__CHAR_${resolved.length}__`,
        resolvedName,
        nameSpec: spec,
        source,
      });

      // Exclude this name from future picks
      storyExcluded.add(resolvedName.toLowerCase());
      const firstName = resolvedName.split(/\s+/)[0];
      if (firstName) storyExcluded.add(firstName.toLowerCase());

    } else if (char.name) {
      // LLM ignored name_spec schema, output a name directly — use it as fallback
      console.warn(`[namePool] Character "${char.name}" has no name_spec — using LLM-provided name as fallback`);
      resolved.push({
        placeholder: char.name,
        resolvedName: char.name,
        nameSpec: { culture: "northern_european", gender_presentation: "neutral", feel: "casual" },
        source: "llm_fallback",
      });
      storyExcluded.add(char.name.toLowerCase());
    }
  }

  return resolved;
}

/**
 * Replace all placeholders in a text string with resolved names.
 */
export function replacePlaceholders(text: string, resolved: ResolvedCharacter[]): string {
  let result = text;
  for (const r of resolved) {
    if (!r.placeholder) continue;
    // Word-boundary-aware replacement for distinctive placeholders
    const escaped = r.placeholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(escaped, "g"), r.resolvedName);
  }
  return result;
}
