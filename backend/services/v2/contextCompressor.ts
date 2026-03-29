/**
 * v2 Context Compressor
 *
 * Extracts relevant slices of the story bible for each scene,
 * preventing context window exhaustion during scene generation.
 *
 * buildPlayableBrief() converts the interpretive scene plan into a
 * situation-based brief: facts, constraints, behavioral subtext.
 * The scene writer receives the brief, NOT the raw plan JSON.
 */

import type { StoryBibleArtifact } from "../../../shared/types/artifacts";
import type { ScenePlan } from "../../../shared/types/scene";
import type { GeneratedScene } from "../../../shared/types/artifacts";

/**
 * Build a playable brief for the scene writer.
 *
 * Strips interpretive fields (purpose, emotion_arc) and reframes
 * relationship dynamics as behavioral subtext directives.
 * The writer gets situation + constraints, not meaning.
 */
export function buildPlayableBrief(
  bible: StoryBibleArtifact,
  scenePlan: ScenePlan,
): string {
  const lines: string[] = [];

  // ── Scene header ──
  lines.push(`SCENE: ${scenePlan.title}`);
  const settingStr = typeof scenePlan.setting === "string"
    ? scenePlan.setting
    : `${(scenePlan.setting as any).location ?? ""} — ${(scenePlan.setting as any).time ?? ""}`;
  lines.push(`SETTING: ${settingStr}`);
  lines.push(`POV: ${scenePlan.pov_character} (you only know what ${scenePlan.pov_character} knows)`);
  lines.push(`PACING: ${scenePlan.pacing_type}`);

  // ── Objective (concrete, stays as-is) ──
  lines.push("");
  lines.push(`${scenePlan.pov_character.toUpperCase()} WANTS: ${scenePlan.objective.want}`);
  lines.push(`WHAT'S IN THE WAY: ${scenePlan.objective.opposition}`);
  lines.push(`IF THIS GOES WRONG: ${scenePlan.objective.stakes}`);

  // ── Exit hook (plot requirement) ──
  lines.push("");
  lines.push(`SCENE MUST END WITH: ${scenePlan.exit_hook}`);

  // ── Content directives (factual routing, if any) ──
  const directives = scenePlan.content_directives ?? [];
  if (directives.length > 0) {
    lines.push("");
    lines.push("CONTENT DIRECTIVES:");
    for (const d of directives) {
      lines.push(`- ${d}`);
    }
  }

  // ── Characters present (POV gets full psychology, non-POV gets external only) ──
  lines.push("");
  lines.push("CHARACTERS IN THIS SCENE:");
  const povCharName = scenePlan.pov_character;
  for (const charName of scenePlan.characters_present) {
    const profile = bible.characters[charName];
    if (profile) {
      const isPOV = charName === povCharName;
      lines.push(`\n${profile.name} (${profile.role})${isPOV ? " [POV CHARACTER]" : ""}:`);
      lines.push(`  Description: ${profile.description}`);
      lines.push(`  Voice: ${profile.psychological_profile.voice_pattern}`);
      if (isPOV) {
        // POV character: full interior access
        lines.push(`  Want: ${profile.psychological_profile.want}`);
        lines.push(`  Under stress: ${profile.psychological_profile.stress_style}`);
        lines.push(`  Break point: ${profile.psychological_profile.break_point}`);
      } else {
        // Non-POV character: external behavior only
        lines.push(`  [Write ${profile.name}'s actions and dialogue from what ${povCharName} can observe — not from their interior. You do not know what they want, feel, or intend. Show only what a camera and microphone would capture.]`);
      }
    }
  }

  // ── Relationships (stated + subtext behavioral directive) ──
  for (const rel of bible.relationships) {
    const [a, b] = rel.between;
    if (scenePlan.characters_present.includes(a) && scenePlan.characters_present.includes(b)) {
      lines.push(`\n${a} <-> ${b}: ${rel.nature}`);
      lines.push(`  How it looks: ${rel.stated_dynamic}`);
      // Reframe true_dynamic as behavioral subtext — never stated, shown through action
      if (rel.true_dynamic && rel.true_dynamic !== rel.stated_dynamic) {
        lines.push(`  Subtext (show through behavior, never state directly): ${rel.true_dynamic}`);
      }
    }
  }

  // ── World context ──
  lines.push("");
  const { worldContext } = compressWorldForScene(bible, scenePlan);
  lines.push(worldContext);

  return lines.join("\n");
}

/**
 * Extract world context for a scene (location, rules, tone).
 * Separated from character extraction for use in both
 * compressForScene (legacy) and buildPlayableBrief.
 */
function compressWorldForScene(
  bible: StoryBibleArtifact,
  scenePlan: ScenePlan,
): { worldContext: string } {
  const worldLines: string[] = [];
  const settingStr = typeof scenePlan.setting === "string"
    ? scenePlan.setting
    : (scenePlan.setting as any).location ?? "";
  const location = bible.world.arena.locations.find(
    l => l.name.toLowerCase().includes(settingStr.toLowerCase()) ||
         settingStr.toLowerCase().includes(l.name.toLowerCase()),
  );
  if (location) {
    worldLines.push(`WORLD CONTEXT:`);
    worldLines.push(`Location: ${location.name} — ${location.description}`);
    worldLines.push(`  Affordances: ${location.affordances.join(", ")}`);
  } else {
    worldLines.push(`WORLD CONTEXT:`);
    worldLines.push(`Setting: ${settingStr}`);
  }

  worldLines.push(`\nTone: ${bible.world.scope.tone_rule}`);
  worldLines.push(`Violence level: ${bible.world.scope.violence_level}`);

  if (bible.world.rules.length > 0) {
    worldLines.push("\nActive rules:");
    for (const rule of bible.world.rules.slice(0, 5)) {
      worldLines.push(`  - ${rule.rule} → ${rule.consequence_if_broken}`);
    }
  }

  return { worldContext: worldLines.join("\n") };
}

/**
 * Build a canonical names block for the scene writer.
 *
 * Lists ALL named entities in the story — not just characters present —
 * to prevent the writer from hallucinating alternative names at high temperature.
 * Dead/offscreen characters referenced in profiles are extracted too.
 */
export function buildCanonicalNames(bible: StoryBibleArtifact): string {
  const lines: string[] = ["CANONICAL NAMES (use these exact names — do not invent alternatives):"];

  // All bible characters
  for (const [name, profile] of Object.entries(bible.characters)) {
    lines.push(`- ${name}: ${profile.role}. ${profile.description.slice(0, 120)}`);
  }

  // Relationship partners (catches mentioned-but-not-present characters)
  for (const rel of bible.relationships) {
    for (const name of rel.between) {
      if (!bible.characters[name]) {
        lines.push(`- ${name}: mentioned in relationships`);
      }
    }
  }

  // Extract proper names from character descriptions that might be offscreen characters
  // (e.g., dead spouses, former colleagues). Heuristic: look for capitalized words
  // that appear after possessive/relational markers.
  const allBibleNames = new Set(Object.keys(bible.characters));
  const mentionedNames = new Set<string>();

  for (const profile of Object.values(bible.characters)) {
    // Match patterns like "her wife Elena", "husband Édouard", "daughter Marta"
    const namePatterns = profile.description.match(
      /(?:wife|husband|spouse|partner|daughter|son|sister|brother|mother|father|colleague|friend|mentor)\s+([A-ZÀ-Ö][a-zà-ö]+(?:\s+[A-ZÀ-Ö][a-zà-ö-]+)*)/g,
    );
    if (namePatterns) {
      for (const match of namePatterns) {
        const name = match.replace(/^(?:wife|husband|spouse|partner|daughter|son|sister|brother|mother|father|colleague|friend|mentor)\s+/, "");
        if (!allBibleNames.has(name) && !mentionedNames.has(name)) {
          mentionedNames.add(name);
          const relWord = match.split(/\s+/)[0];
          const owner = profile.name;
          lines.push(`- ${name}: ${owner}'s ${relWord} (offscreen/deceased — use this exact name)`);
        }
      }
    }
  }

  // Also scan plot beats for proper names
  if (bible.plot?.tension_chain) {
    for (const beat of bible.plot.tension_chain) {
      const beatNames = beat.beat?.match(/\b([A-ZÀ-Ö][a-zà-ö]+(?:\s+[A-ZÀ-Ö][a-zà-ö-]+)*)\b/g) ?? [];
      for (const name of beatNames) {
        if (!allBibleNames.has(name) && !mentionedNames.has(name) && name.length > 2) {
          // Skip common words that happen to be capitalized
          const skipWords = new Set(["The", "She", "Her", "His", "But", "And", "Not", "When", "Then", "What", "How", "Session", "Ros", "After", "Does", "During", "Over"]);
          if (!skipWords.has(name)) {
            mentionedNames.add(name);
            lines.push(`- ${name}: mentioned in plot`);
          }
        }
      }
    }
  }

  return lines.join("\n");
}

/**
 * Extract only the characters, locations, and world rules relevant to a specific scene.
 * (Legacy function — still used by scene judge and other consumers that need raw profiles.)
 */
export function compressForScene(
  bible: StoryBibleArtifact,
  scenePlan: ScenePlan,
): { characterProfiles: string; worldContext: string } {
  const charLines: string[] = [];
  for (const charName of scenePlan.characters_present) {
    const profile = bible.characters[charName];
    if (profile) {
      charLines.push(`${profile.name} (${profile.role}):`);
      charLines.push(`  Description: ${profile.description}`);
      charLines.push(`  Voice: ${profile.psychological_profile.voice_pattern}`);
      charLines.push(`  Want: ${profile.psychological_profile.want}`);
      charLines.push(`  Stress: ${profile.psychological_profile.stress_style}`);
      charLines.push(`  Break point: ${profile.psychological_profile.break_point}`);
      charLines.push(`  Threshold: ${profile.threshold_statement}`);
    }
  }

  for (const rel of bible.relationships) {
    const [a, b] = rel.between;
    if (scenePlan.characters_present.includes(a) && scenePlan.characters_present.includes(b)) {
      charLines.push(`\n${a} ↔ ${b}: ${rel.nature}`);
      charLines.push(`  Stated: ${rel.stated_dynamic}`);
      charLines.push(`  True: ${rel.true_dynamic}`);
    }
  }

  const { worldContext } = compressWorldForScene(bible, scenePlan);

  return {
    characterProfiles: charLines.join("\n"),
    worldContext,
  };
}

/**
 * Create a digest of the previous 1-2 scenes for continuity.
 * Uses the readable screenplay format, truncated.
 */
export function previousSceneDigest(
  completedScenes: GeneratedScene[],
  maxScenes = 2,
): string {
  if (completedScenes.length === 0) return "";

  const recent = completedScenes.slice(-maxScenes);
  const parts: string[] = ["PREVIOUS SCENES (for continuity):"];

  for (const scene of recent) {
    parts.push(`\n--- ${scene.plan.title} ---`);
    const text = scene.readable.screenplay_text;
    if (text.length > 500) {
      parts.push(`[...] ${text.slice(-500)}`);
    } else {
      parts.push(text);
    }
  }

  return parts.join("\n");
}
