/**
 * EXPORT FOR REWRITE
 * ════════════════════
 * Exports generated scenes as readable .txt files for manual dialogue rewriting.
 *
 * Usage:
 *   npx tsx scripts/export-for-rewrite.ts story1_export.json
 *   npx tsx scripts/export-for-rewrite.ts story1_export.json --scene 2
 *   npx tsx scripts/export-for-rewrite.ts story1_export.json --out rewrites/story1
 *
 * Output: One .txt file per scene in screenplay-like format.
 * Edit the dialogue, then import back with import-from-rewrite.ts.
 */

import { readFileSync, mkdirSync, writeFileSync } from "fs";
import { resolve, basename } from "path";

interface ExportLine {
  speaker: string;
  text: string;
  emotion?: string | null;
  stage_direction?: string | null;
  delivery?: string | null;
}

interface ExportScene {
  scene_id: string;
  title: string;
  setting: string | { location: string; time?: string };
  characters_present: string[];
  pov_character?: string;
  lines: ExportLine[];
  transition_out: string;
}

function formatSetting(s: string | { location: string; time?: string }): string {
  if (typeof s === "string") return s;
  return s.time ? `${s.location} — ${s.time}` : s.location;
}

function formatScene(scene: ExportScene, index: number, charNotes: Map<string, string>): string {
  const parts: string[] = [];

  // Header
  parts.push(`SCENE ${index + 1}: "${scene.title}"`);
  parts.push(`Setting: ${formatSetting(scene.setting)}`);
  parts.push(`Characters: ${scene.characters_present.join(", ")}`);
  if (scene.pov_character) parts.push(`POV: ${scene.pov_character}`);
  parts.push("");

  // Character reference (short descriptions from bible)
  const sceneChars = scene.characters_present
    .map(name => {
      const note = charNotes.get(name);
      return note ? `  ${name}: ${note}` : null;
    })
    .filter(Boolean);
  if (sceneChars.length > 0) {
    parts.push("CHARACTER REFERENCE:");
    parts.push(...(sceneChars as string[]));
    parts.push("");
  }

  // Divider
  parts.push("---");
  parts.push("");

  // Lines
  for (const line of scene.lines) {
    if (line.speaker === "NARRATION" || line.speaker === "narration") {
      // Stage direction on narration
      if (line.stage_direction) {
        parts.push(`NARRATION: ${line.text} {${line.stage_direction}}`);
      } else {
        parts.push(`NARRATION: ${line.text}`);
      }
    } else if (line.speaker === "INTERNAL" || line.speaker.startsWith("INTERNAL")) {
      const emotion = line.emotion ? ` (${line.emotion})` : "";
      parts.push(`INTERNAL${emotion}: ${line.text}`);
    } else {
      // Character dialogue
      const emotion = line.emotion ? ` (${line.emotion})` : "";
      const delivery = line.delivery ? ` ${line.delivery}` : "";
      const stage = line.stage_direction ? ` {${line.stage_direction}}` : "";
      parts.push(`[${line.speaker}]${emotion}${delivery} ${line.text}${stage}`);
    }
  }

  parts.push("");
  parts.push(`--- TRANSITION: ${scene.transition_out} ---`);

  return parts.join("\n");
}

function buildStoryOverview(data: any, chars: Record<string, any>): string {
  const parts: string[] = [];

  // Title / seed
  parts.push("STORY OVERVIEW");
  parts.push("══════════════");
  if (data.seedInput) {
    parts.push("");
    parts.push("SEED:");
    parts.push(data.seedInput);
  }

  // Synopsis
  const synopsis = data.premise?.synopsis || data.premise?.premise_paragraph;
  if (synopsis) {
    parts.push("");
    parts.push("SYNOPSIS:");
    parts.push(synopsis);
  }

  // Core conflict
  if (data.premise?.core_conflict) {
    parts.push("");
    parts.push("CORE CONFLICT:");
    parts.push(data.premise.core_conflict);
  }

  // Characters
  parts.push("");
  parts.push("════════════════");
  parts.push("CHARACTERS");
  parts.push("════════════════");
  for (const [name, c] of Object.entries(chars) as [string, any][]) {
    parts.push("");
    parts.push(`${name} (${c.role || "unknown"})`);
    if (c.description) parts.push(`  ${c.description}`);
    const pp = c.psychological_profile || {};
    if (pp.voice_pattern) parts.push(`  Voice: ${pp.voice_pattern}`);
    if (pp.speech_card) {
      const sc = pp.speech_card;
      if (sc.typical_length) parts.push(`  Typical length: ${sc.typical_length}`);
      if (sc.under_pressure) parts.push(`  Under pressure: ${sc.under_pressure}`);
      if (sc.deflection_style) parts.push(`  Deflection: ${sc.deflection_style}`);
    }
    if (c.core_dials) {
      const dials = Object.entries(c.core_dials).map(([k, v]) => `${k}: ${v}`).join(", ");
      parts.push(`  Core dials: ${dials}`);
    }
  }

  // Relationships
  const rels = data.storyBible?.relationships || [];
  if (rels.length > 0) {
    parts.push("");
    parts.push("RELATIONSHIPS:");
    for (const r of rels) {
      const between = (r.between || []).join(" ↔ ");
      const nature = r.stated_dynamic || r.nature || "";
      const truth = r.true_dynamic ? ` (truth: ${r.true_dynamic})` : "";
      parts.push(`  ${between}: ${nature}${truth}`);
    }
  }

  // Scene plan
  const scenePlan = data.scenePlan?.scenes || [];
  if (scenePlan.length > 0) {
    parts.push("");
    parts.push("════════════════");
    parts.push("SCENE-BY-SCENE PLAN");
    parts.push("════════════════");
    for (let i = 0; i < scenePlan.length; i++) {
      const s = scenePlan[i];
      parts.push("");
      parts.push(`SCENE ${i + 1}: "${s.title}"`);
      parts.push(`  Setting: ${s.setting}`);
      parts.push(`  Purpose: ${s.purpose}`);
      parts.push(`  Want: ${s.objective?.want || ""}`);
      parts.push(`  Opposition: ${s.objective?.opposition || ""}`);
      parts.push(`  Stakes: ${s.objective?.stakes || ""}`);
      if (s.emotion_arc) {
        parts.push(`  Arc: ${s.emotion_arc.start} → ${s.emotion_arc.trigger} → ${s.emotion_arc.end}`);
      }
      parts.push(`  Exit hook: ${s.exit_hook || ""}`);
      if (s.content_directives?.length > 0) {
        parts.push(`  Content: ${s.content_directives.join("; ")}`);
      }
    }
  }

  return parts.join("\n");
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log("Usage: npx tsx scripts/export-for-rewrite.ts <story-export.json> [--scene N] [--out dir]");
    process.exit(1);
  }

  const inputPath = resolve(args[0]);
  const data = JSON.parse(readFileSync(inputPath, "utf-8"));

  // Parse options
  const sceneFilter = args.indexOf("--scene") !== -1
    ? parseInt(args[args.indexOf("--scene") + 1]) - 1
    : undefined;

  const outDirArg = args.indexOf("--out") !== -1
    ? args[args.indexOf("--out") + 1]
    : undefined;

  const storyName = basename(inputPath, ".json").replace(/_export$/, "");
  const outDir = resolve(outDirArg ?? `data/rewrites/${storyName}`);
  mkdirSync(outDir, { recursive: true });

  // Extract scenes
  const scenes: ExportScene[] = (data.scenes || data.generatedScenes || [])
    .map((s: any) => s.vn_scene || s)
    .filter((s: any) => s?.lines?.length > 0);

  if (scenes.length === 0) {
    console.error("No scenes found in export.");
    process.exit(1);
  }

  // Build character notes from bible
  const charNotes = new Map<string, string>();
  const chars = data.storyBible?.characters || {};
  for (const [name, c] of Object.entries(chars) as [string, any][]) {
    const role = c.role ? `(${c.role})` : "";
    const desc = (c.description || "").substring(0, 100);
    const voice = c.psychological_profile?.voice_pattern || "";
    const parts = [`${role} ${desc}`.trim()];
    if (voice) parts.push(`voice: ${voice.substring(0, 80)}`);
    charNotes.set(name, parts.join(" | "));
  }

  // Export
  const scenesToExport = sceneFilter !== undefined
    ? [{ scene: scenes[sceneFilter], idx: sceneFilter }]
    : scenes.map((scene, idx) => ({ scene, idx }));

  // Write story overview
  const overviewPath = resolve(outDir, "_STORY_OVERVIEW.txt");
  writeFileSync(overviewPath, buildStoryOverview(data, chars), "utf-8");

  // Write format guide
  const guidePath = resolve(outDir, "_FORMAT_GUIDE.txt");
  writeFileSync(guidePath, `REWRITE FORMAT GUIDE
════════════════════

HOW TO EDIT:
- Edit dialogue text freely — change words, rewrite entirely, add/remove lines
- Keep the [SPEAKER] tags matching character names exactly
- Keep NARRATION: and INTERNAL: prefixes for those line types

LINE FORMATS:
  [Character Name] (emotion) text here
  [Character Name] (emotion) (whispered) text here {stage direction}
  NARRATION: Description of action. {optional stage direction}
  INTERNAL (emotion): Character's inner thought.

RULES:
- (emotion) is optional — delete it or change it
- (delivery) like (whispered) is optional — add in parens after emotion
- {stage direction} is optional — add in curly braces at end of line
- To DELETE a line: remove the entire line
- To ADD a line: just write a new line in the right format
- To REORDER: just move lines around
- Don't edit the SCENE header, CHARACTER REFERENCE, or TRANSITION lines
- The importer ignores blank lines and the header/reference sections

AFTER EDITING:
  npx tsx scripts/import-from-rewrite.ts <original-export.json> <rewrites-dir>
`);

  for (const { scene, idx } of scenesToExport) {
    const filename = `scene_${String(idx + 1).padStart(2, "0")}_${scene.scene_id}.txt`;
    const content = formatScene(scene, idx, charNotes);
    const filepath = resolve(outDir, filename);
    writeFileSync(filepath, content, "utf-8");
    console.log(`  ${filename} — "${scene.title}" (${scene.lines.length} lines)`);
  }

  console.log(`\n${scenesToExport.length} scene(s) exported to: ${outDir}`);
  console.log(`Format guide: ${guidePath}`);
}

main();
