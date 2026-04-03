/**
 * SENSORY VOCABULARY DIVERSITY
 * ============================
 * Tracks sensory descriptor frequency across scenes and flags overuse.
 * Works with a pre-generated palette (from bible step) to guide targeted rewrites.
 *
 * Architecture: cumulative tracker per scene → flagged words → surgical rewrite.
 * Scene prompts get ZERO vocabulary constraints.
 */

// ── Types ───────────────────────────────────────────────────────────

export interface SensoryPalette {
  textures: string[];
  temperatures: string[];
  sounds: string[];
  smells: string[];
  tastes: string[];
  movement_verbs: string[];
  light_descriptors: string[];
}

export interface DescriptorFrequency {
  counts: Map<string, { count: number; scenes: string[] }>;
  sceneCount: number;
}

// ── Sensory Word Set ────────────────────────────────────────────────

/**
 * Curated set of sensory words to track.
 * Only these words are counted — not all adjectives.
 * Focused on words that LLMs tend to overuse in descriptive passages.
 */
export const SENSORY_WORDS = new Set([
  // Texture
  "callused", "calloused", "rough", "smooth", "silky", "coarse", "gritty", "velvety",
  "slick", "oiled", "polished", "weathered", "scarred", "puckered", "ridged",
  "supple", "taut", "firm", "soft", "tender", "raw", "chapped", "cracked",
  // Temperature
  "warm", "cold", "cool", "hot", "feverish", "icy", "frigid", "scalding",
  "tepid", "chilled", "heated", "burning", "searing", "flushed",
  // Taste
  "salty", "sweet", "bitter", "metallic", "tangy", "acrid", "briny",
  // Smell
  "musky", "pungent", "acrid", "fragrant", "musty", "damp", "earthy",
  // Sound
  "whispered", "murmured", "growled", "hissed", "purred", "gasped", "moaned",
  "whimpered", "groaned", "sighed", "hummed", "rumbled",
  // Movement/body
  "arched", "curled", "trembled", "shuddered", "quivered", "tensed", "relaxed",
  "writhed", "squirmed", "flinched", "jerked", "pressed", "gripped",
  // Light/visual
  "glistened", "gleamed", "shimmered", "glowed", "flickered", "dimmed",
  "luminous", "iridescent", "translucent", "opalescent",
  // General overused
  "electric", "magnetic", "intoxicating", "overwhelming", "devastating",
  "exquisite", "delicate", "languid", "visceral",
]);

// ── Tracker Functions ───────────────────────────────────────────────

export function createTracker(): DescriptorFrequency {
  return { counts: new Map(), sceneCount: 0 };
}

/**
 * Update the frequency tracker with words from a new scene.
 * Deterministic — no LLM calls. Counts each tracked word once per scene.
 */
export function updateFrequency(
  tracker: DescriptorFrequency,
  sceneText: string,
  sceneId: string,
): DescriptorFrequency {
  tracker.sceneCount++;
  const lowerText = sceneText.toLowerCase();
  // Tokenize into words
  const words = lowerText.replace(/[^a-z\s]/g, "").split(/\s+/);
  const seenInScene = new Set<string>();

  for (const word of words) {
    if (SENSORY_WORDS.has(word) && !seenInScene.has(word)) {
      seenInScene.add(word);
      const entry = tracker.counts.get(word);
      if (entry) {
        entry.count++;
        entry.scenes.push(sceneId);
      } else {
        tracker.counts.set(word, { count: 1, scenes: [sceneId] });
      }
    }
  }

  return tracker;
}

/**
 * Find descriptors appearing in more than `threshold` fraction of scenes.
 * Only meaningful after 4+ scenes (returns empty before that).
 */
export function findOverusedDescriptors(
  tracker: DescriptorFrequency,
  threshold = 0.5,
): string[] {
  if (tracker.sceneCount < 4) return []; // too few scenes for meaningful detection
  const overused: string[] = [];
  for (const [word, { count }] of tracker.counts) {
    if (count / tracker.sceneCount > threshold) {
      overused.push(word);
    }
  }
  return overused.sort((a, b) => {
    const ca = tracker.counts.get(a)?.count ?? 0;
    const cb = tracker.counts.get(b)?.count ?? 0;
    return cb - ca;
  });
}

/**
 * Format a rewrite guidance block for the LLM rewriter.
 * Only used in the post-generation targeted rewrite step.
 */
export function formatPaletteForRewrite(
  palette: SensoryPalette,
  overused: string[],
): string {
  const lines = [
    "VOCABULARY DIVERSITY — REWRITE GUIDANCE:",
    `The following sensory words have been overused across scenes: ${overused.join(", ")}`,
    "Replace them with alternatives from this story's sensory palette:",
    "",
  ];
  const categories: [keyof SensoryPalette, string][] = [
    ["textures", "Textures"], ["temperatures", "Temperatures"],
    ["sounds", "Sounds"], ["smells", "Smells"], ["tastes", "Tastes"],
    ["movement_verbs", "Movement"], ["light_descriptors", "Light/Visual"],
  ];
  for (const [key, label] of categories) {
    if (palette[key]?.length > 0) {
      lines.push(`${label}: ${palette[key].join(", ")}`);
    }
  }
  lines.push("", "Rewrite ONLY lines containing the overused words. Keep everything else identical.");
  return lines.join("\n");
}

// ── Palette Schema for Bible Generation ─────────────────────────────

export const SENSORY_PALETTE_SYSTEM = `You are generating a sensory vocabulary palette for a specific story world. Given the world setting and tone, create diverse, specific sensory words and short phrases that belong in THIS world — not generic descriptors.

RULES:
- Every entry must be grounded in the specific textures, temperatures, sounds of THIS setting
- Avoid generic overused words: "callused", "arched", "oiled", "salty", "glistened", "trembled"
- Prefer unusual, evocative alternatives: "salt-rimed", "heat-swollen", "wire-taut"
- Include compound descriptors and short phrases, not just single words
- Each category should have 10-15 entries

OUTPUT FORMAT: JSON matching the provided schema.`;

export function buildSensoryPalettePrompt(args: {
  worldSection: string;
  settingAnchor: string;
  toneChips: string[];
}): string {
  return [
    `WORLD SETTING:\n${args.worldSection.slice(0, 1500)}`,
    `\nSETTING ANCHOR: ${args.settingAnchor}`,
    `\nTONE: ${args.toneChips.join(", ")}`,
    "\nGenerate a sensory vocabulary palette specific to this world.",
  ].join("\n");
}

export const SENSORY_PALETTE_SCHEMA = {
  type: "object" as const,
  properties: {
    textures: { type: "array" as const, items: { type: "string" as const }, description: "10-15 texture words/phrases specific to this story's world" },
    temperatures: { type: "array" as const, items: { type: "string" as const }, description: "8-10 temperature descriptors" },
    sounds: { type: "array" as const, items: { type: "string" as const }, description: "8-10 sound descriptors" },
    smells: { type: "array" as const, items: { type: "string" as const }, description: "6-8 smell descriptors" },
    tastes: { type: "array" as const, items: { type: "string" as const }, description: "6-8 taste descriptors" },
    movement_verbs: { type: "array" as const, items: { type: "string" as const }, description: "10-15 verbs for physical action" },
    light_descriptors: { type: "array" as const, items: { type: "string" as const }, description: "8-10 light/shadow descriptions" },
  },
  required: ["textures", "temperatures", "sounds", "smells", "tastes", "movement_verbs", "light_descriptors"],
  additionalProperties: false as const,
};
