/**
 * STORY FINGERPRINT
 * =================
 * Extracts a small, deterministic fingerprint from a completed pipeline output.
 * Used for:
 * 1. Freshness injection — prevent new stories from repeating names/archetypes/settings
 * 2. Trend analysis — compare patterns across multiple generated stories
 *
 * No LLM calls. Pure extraction from existing data.
 */

import { readFile, writeFile, mkdir } from "fs/promises";

const FINGERPRINT_PATH = "./data/story-fingerprints.json";

export interface StoryFingerprint {
  id: string;
  date: string;
  seed_summary: string;                // first 120 chars of seed/premise
  setting_type: string;                // world thesis / tone
  character_names: string[];
  character_archetypes: string[];      // role + key trait
  character_wants: string[];           // psychological wants
  location_names: string[];
  plot_shape: string;                  // core conflict + climax summary
  themes: string[];                    // from plot theme_cluster
  motifs: string[];                    // from plot motifs
  scene_count: number;
  pacing_types: string[];              // distribution of scene pacing types
  total_lines: number;
}

/**
 * Extract a fingerprint from a pipeline output JSON.
 * Works with both raw pipeline output and exported project state.
 */
export function extractFingerprint(project: any): StoryFingerprint {
  const bible = project.storyBible ?? {};
  const premise = project.premise ?? {};
  const scenePlan = project.scenePlan ?? {};
  const scenes = project.scenes ?? project.generatedScenes ?? [];

  // Characters
  const characters = bible.characters ?? {};
  const charNames = Object.keys(characters);
  const charArchetypes = Object.values(characters).map((c: any) => {
    const role = c.role ?? "unknown";
    // Extract a short archetype from description — first clause
    const shortDesc = (c.description ?? "").split(/[.,;—]/)[0].trim().slice(0, 60);
    return `${role}: ${shortDesc}`;
  });
  const charWants = Object.values(characters).map((c: any) =>
    c.psychological_profile?.want ?? "unknown"
  );

  // World
  const world = bible.world ?? {};
  const locations = (world.arena?.locations ?? []).map((l: any) => l.name);
  const settingType = [
    world.world_thesis ?? "",
    world.scope?.tone_rule ?? "",
  ].filter(Boolean).join(" | ").slice(0, 150);

  // Plot
  const plot = bible.plot ?? {};
  const plotShape = [
    plot.core_conflict ? `Conflict: ${plot.core_conflict.slice(0, 80)}` : "",
    plot.climax ? `Climax: ${(typeof plot.climax === "string" ? plot.climax : plot.climax?.description ?? "").slice(0, 80)}` : "",
  ].filter(Boolean).join(". ");

  const themes = Array.isArray(plot.theme_cluster) ? plot.theme_cluster.slice(0, 5) :
    typeof plot.theme_cluster === "string" ? [plot.theme_cluster] : [];
  const motifs = Array.isArray(plot.motifs) ? plot.motifs.map((m: any) =>
    typeof m === "string" ? m : m.name ?? m.motif ?? JSON.stringify(m)
  ).slice(0, 5) : [];

  // Scene plan
  const scenePlans = scenePlan.scenes ?? [];
  const pacingTypes = scenePlans.map((s: any) => s.pacing_type).filter(Boolean);

  // Seed summary
  const seedSummary = (premise.premise_paragraph ?? premise.hook_sentence ?? project.seedInput ?? "").slice(0, 120);

  // Total lines
  const totalLines = scenes.reduce((sum: number, s: any) => {
    const vnScene = s.vn_scene ?? s;
    return sum + (vnScene.lines?.length ?? 0);
  }, 0);

  return {
    id: project.projectId ?? "unknown",
    date: new Date().toISOString().slice(0, 10),
    seed_summary: seedSummary,
    setting_type: settingType,
    character_names: charNames,
    character_archetypes: charArchetypes,
    character_wants: charWants,
    location_names: locations,
    plot_shape: plotShape,
    themes,
    motifs,
    scene_count: scenePlans.length || scenes.length,
    pacing_types: pacingTypes,
    total_lines: totalLines,
  };
}

/** Load all saved fingerprints (or empty array if none exist) */
export async function loadFingerprints(): Promise<StoryFingerprint[]> {
  try {
    return JSON.parse(await readFile(FINGERPRINT_PATH, "utf-8"));
  } catch {
    return [];
  }
}

/** Save a new fingerprint (appends to existing) */
export async function saveFingerprint(fp: StoryFingerprint): Promise<void> {
  const existing = await loadFingerprints();
  // Avoid duplicates by project ID
  const filtered = existing.filter(e => e.id !== fp.id);
  filtered.push(fp);
  await mkdir("./data", { recursive: true });
  await writeFile(FINGERPRINT_PATH, JSON.stringify(filtered, null, 2), "utf-8");
}

/**
 * Build a freshness constraint block for bible generation.
 * Returns a string to inject into character/world writer prompts,
 * or empty string if no fingerprints exist.
 *
 * Helpers below extract first-name frequency and recurring premise
 * patterns so the freshness block can flag overused elements.
 */

/** Extract first names from full names (e.g., "Ravi Chandrasekhar" → "Ravi") */
function extractFirstNames(fullNames: string[]): Set<string> {
  const firsts = new Set<string>();
  for (const name of fullNames) {
    const parts = name.split(/\s+/);
    if (parts.length > 0 && parts[0].length >= 2) {
      firsts.add(parts[0]);
    }
  }
  return firsts;
}

/** Count how many times each first name appears across fingerprints */
function findRepeatedFirstNames(fingerprints: StoryFingerprint[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const fp of fingerprints) {
    // Count each first name once per story (not per character)
    const firsts = extractFirstNames(fp.character_names);
    for (const name of firsts) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return counts;
}

/** Extract recurring premise patterns (e.g., "sweaty feet = power source") */
function findSettingPatterns(fingerprints: StoryFingerprint[]): string[] {
  // Extract short setting summaries and find common phrases
  const patterns: string[] = [];
  const seedWords = new Map<string, number>();
  for (const fp of fingerprints) {
    // Tokenize seed into 3-word phrases
    const words = fp.seed_summary.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter(w => w.length > 3);
    for (let i = 0; i < words.length - 2; i++) {
      const phrase = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
      seedWords.set(phrase, (seedWords.get(phrase) ?? 0) + 1);
    }
  }
  // Phrases appearing in 3+ stories are patterns
  for (const [phrase, count] of seedWords) {
    if (count >= 3) patterns.push(phrase);
  }
  return patterns;
}

export function buildFreshnessBlock(fingerprints: StoryFingerprint[]): string {
  if (fingerprints.length === 0) return "";

  const recent = fingerprints.slice(-15); // Last 15 stories

  const lines: string[] = [
    "FRESHNESS — AVOID REPEATING PREVIOUS STORIES:",
    "The following names, archetypes, settings, and themes have been used in recent stories.",
    "Create something distinctly different. Do NOT reuse these names or close variants.",
    "",
  ];

  // Collect all used full names
  const allNames = new Set<string>();
  const allArchetypes = new Set<string>();
  const allSettings = new Set<string>();
  const allThemes = new Set<string>();
  const allLocations = new Set<string>();

  for (const fp of recent) {
    fp.character_names.forEach(n => allNames.add(n));
    fp.character_archetypes.forEach(a => allArchetypes.add(a));
    if (fp.setting_type) allSettings.add(fp.setting_type.slice(0, 80));
    fp.themes.forEach(t => allThemes.add(typeof t === "string" ? t : JSON.stringify(t)));
    fp.location_names.forEach(l => allLocations.add(l));
  }

  if (allNames.size > 0) {
    lines.push(`Full names already used (DO NOT reuse): ${[...allNames].join(", ")}`);
  }

  // First name frequency — block names used 2+ times
  const firstNameCounts = findRepeatedFirstNames(recent);
  const overusedFirstNames = [...firstNameCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${name} (${count}x)`);
  if (overusedFirstNames.length > 0) {
    lines.push(`First names overused (DO NOT reuse these first names even with different surnames): ${overusedFirstNames.join(", ")}`);
  }

  if (allArchetypes.size > 0) {
    lines.push(`Archetypes already used (vary these): ${[...allArchetypes].slice(0, 15).join("; ")}`);
  }
  if (allLocations.size > 0) {
    lines.push(`Locations already used (create different ones): ${[...allLocations].join(", ")}`);
  }
  if (allThemes.size > 0) {
    lines.push(`Themes already explored (find fresh angles): ${[...allThemes].slice(0, 10).join(", ")}`);
  }

  // Detect recurring premise patterns
  const patterns = findSettingPatterns(recent);
  if (patterns.length > 0) {
    lines.push(`Recurring premise patterns to AVOID: ${patterns.join("; ")}`);
  }

  // Setting variety check — if settings are too similar, call it out
  if (allSettings.size > 0) {
    lines.push(`Settings already used (create a distinctly different premise and world): ${[...allSettings].slice(0, 8).join(" | ")}`);
  }

  lines.push("");
  lines.push("This is NOT a ban — you may explore similar territory if the execution is distinctly different.");
  lines.push("The goal is variety, not avoidance of all overlap.");

  return lines.join("\n");
}
