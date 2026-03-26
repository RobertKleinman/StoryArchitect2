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

  // ── Characters present (profiles + behavioral subtext) ──
  lines.push("");
  lines.push("CHARACTERS IN THIS SCENE:");
  for (const charName of scenePlan.characters_present) {
    const profile = bible.characters[charName];
    if (profile) {
      lines.push(`\n${profile.name} (${profile.role}):`);
      lines.push(`  Description: ${profile.description}`);
      lines.push(`  Voice: ${profile.psychological_profile.voice_pattern}`);
      lines.push(`  Want: ${profile.psychological_profile.want}`);
      lines.push(`  Under stress: ${profile.psychological_profile.stress_style}`);
      lines.push(`  Break point: ${profile.psychological_profile.break_point}`);
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
