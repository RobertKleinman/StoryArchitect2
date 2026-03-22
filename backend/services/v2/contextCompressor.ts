/**
 * v2 Context Compressor
 *
 * Extracts relevant slices of the story bible for each scene,
 * preventing context window exhaustion during scene generation.
 */

import type { StoryBibleArtifact } from "../../../shared/types/artifacts";
import type { ScenePlan } from "../../../shared/types/scene";
import type { GeneratedScene } from "../../../shared/types/artifacts";

/**
 * Extract only the characters, locations, and world rules relevant to a specific scene.
 */
export function compressForScene(
  bible: StoryBibleArtifact,
  scenePlan: ScenePlan,
): { characterProfiles: string; worldContext: string } {
  // Extract only characters present in this scene
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

  // Extract relevant relationships
  for (const rel of bible.relationships) {
    const [a, b] = rel.between;
    if (scenePlan.characters_present.includes(a) && scenePlan.characters_present.includes(b)) {
      charLines.push(`\n${a} ↔ ${b}: ${rel.nature}`);
      charLines.push(`  Stated: ${rel.stated_dynamic}`);
      charLines.push(`  True: ${rel.true_dynamic}`);
    }
  }

  // Extract relevant location
  const worldLines: string[] = [];
  const settingStr = typeof scenePlan.setting === "string"
    ? scenePlan.setting
    : (scenePlan.setting as any).location ?? "";
  const location = bible.world.arena.locations.find(
    l => l.name.toLowerCase().includes(settingStr.toLowerCase()) ||
         settingStr.toLowerCase().includes(l.name.toLowerCase()),
  );
  if (location) {
    worldLines.push(`Location: ${location.name} — ${location.description}`);
    worldLines.push(`  Affordances: ${location.affordances.join(", ")}`);
  } else {
    worldLines.push(`Setting: ${settingStr}`);
  }

  // Add scope rules
  worldLines.push(`\nTone: ${bible.world.scope.tone_rule}`);
  worldLines.push(`Violence level: ${bible.world.scope.violence_level}`);

  // Add relevant world rules (max 5 most relevant)
  if (bible.world.rules.length > 0) {
    worldLines.push("\nActive rules:");
    for (const rule of bible.world.rules.slice(0, 5)) {
      worldLines.push(`  - ${rule.rule} → ${rule.consequence_if_broken}`);
    }
  }

  return {
    characterProfiles: charLines.join("\n"),
    worldContext: worldLines.join("\n"),
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
    // Use last ~500 chars of readable text for continuity
    const text = scene.readable.screenplay_text;
    if (text.length > 500) {
      parts.push(`[...] ${text.slice(-500)}`);
    } else {
      parts.push(text);
    }
  }

  return parts.join("\n");
}
