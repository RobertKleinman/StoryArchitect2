/**
 * IMPORT FROM REWRITE
 * ════════════════════
 * Reads manually rewritten .txt scene files and merges them back into
 * the original story export JSON, producing a new export ready for packaging.
 *
 * Usage:
 *   npx tsx scripts/import-from-rewrite.ts story1_export.json data/rewrites/story1
 *   npx tsx scripts/import-from-rewrite.ts story1_export.json data/rewrites/story1 --out story1_rewritten.json
 *
 * What it does:
 * - Parses each .txt file back into VNScene lines
 * - Replaces the lines in the matching scene (by scene_id from filename)
 * - Preserves all other story data (bible, premise, plan, etc.)
 * - Outputs a new export JSON with the rewritten dialogue
 */

import { readFileSync, readdirSync, writeFileSync } from "fs";
import { resolve, basename } from "path";

interface ParsedLine {
  speaker: string;
  text: string;
  emotion: string | null;
  stage_direction: string | null;
  delivery: string | null;
}

function parseLine(raw: string): ParsedLine | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("SCENE ") || trimmed.startsWith("Setting:") ||
      trimmed.startsWith("Characters:") || trimmed.startsWith("POV:") ||
      trimmed.startsWith("CHARACTER REFERENCE:") || trimmed.startsWith("  ") ||
      trimmed === "---" || trimmed.startsWith("--- TRANSITION:")) {
    return null;
  }

  // NARRATION: text {stage direction}
  if (trimmed.startsWith("NARRATION:")) {
    const content = trimmed.slice("NARRATION:".length).trim();
    const { text, stageDirection } = extractStageDirection(content);
    return { speaker: "NARRATION", text, emotion: null, stage_direction: stageDirection, delivery: null };
  }

  // INTERNAL (emotion): text
  if (trimmed.startsWith("INTERNAL")) {
    const internalMatch = trimmed.match(/^INTERNAL\s*(?:\(([^)]*)\))?\s*:\s*(.+)$/);
    if (internalMatch) {
      return {
        speaker: "INTERNAL",
        text: internalMatch[2].trim(),
        emotion: internalMatch[1]?.trim() || null,
        stage_direction: null,
        delivery: null,
      };
    }
  }

  // [Speaker] (emotion) (delivery) text {stage direction}
  const dialogueMatch = trimmed.match(/^\[([^\]]+)\]\s*(.*)$/);
  if (dialogueMatch) {
    const speaker = dialogueMatch[1].trim();
    let rest = dialogueMatch[2].trim();

    // Extract emotion: first (parens)
    let emotion: string | null = null;
    const emotionMatch = rest.match(/^\(([^)]*)\)\s*/);
    if (emotionMatch) {
      emotion = emotionMatch[1].trim();
      rest = rest.slice(emotionMatch[0].length);
    }

    // Extract delivery: second (parens) — but only if it looks like a delivery cue
    let delivery: string | null = null;
    const deliveryMatch = rest.match(/^\(([^)]*)\)\s*/);
    if (deliveryMatch) {
      delivery = `(${deliveryMatch[1].trim()})`;
      rest = rest.slice(deliveryMatch[0].length);
    }

    // Extract stage direction: {braces} at end
    const { text, stageDirection } = extractStageDirection(rest);

    return { speaker, text, emotion, stage_direction: stageDirection, delivery };
  }

  // If no pattern matched, skip the line (header/metadata)
  return null;
}

function extractStageDirection(text: string): { text: string; stageDirection: string | null } {
  // Match {content} at the end of the line
  const match = text.match(/\{([^}]+)\}\s*$/);
  if (match) {
    return {
      text: text.slice(0, match.index).trim(),
      stageDirection: match[1].trim(),
    };
  }
  return { text: text.trim(), stageDirection: null };
}

function parseSceneFile(content: string): ParsedLine[] {
  const lines: ParsedLine[] = [];
  for (const raw of content.split("\n")) {
    const parsed = parseLine(raw);
    if (parsed) lines.push(parsed);
  }
  return lines;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log("Usage: npx tsx scripts/import-from-rewrite.ts <original-export.json> <rewrites-dir> [--out file.json]");
    process.exit(1);
  }

  const originalPath = resolve(args[0]);
  const rewriteDir = resolve(args[1]);
  const outArg = args.indexOf("--out") !== -1 ? args[args.indexOf("--out") + 1] : undefined;

  const data = JSON.parse(readFileSync(originalPath, "utf-8"));

  // Find rewrite files
  const txtFiles = readdirSync(rewriteDir)
    .filter(f => f.startsWith("scene_") && f.endsWith(".txt"))
    .sort();

  if (txtFiles.length === 0) {
    console.error("No scene_*.txt files found in", rewriteDir);
    process.exit(1);
  }

  // Build scene list (use index-based matching since scene_ids can collide)
  const scenes: any[] = data.scenes || data.generatedScenes || [];

  let replaced = 0;
  let skipped = 0;

  for (const file of txtFiles) {
    // Extract scene index from filename: scene_01_S001.txt → index 0
    const match = file.match(/^scene_(\d+)_(.+)\.txt$/);
    if (!match) {
      console.log(`  SKIP ${file} — can't parse index from filename`);
      skipped++;
      continue;
    }
    const sceneIdx = parseInt(match[1]) - 1; // 1-based in filename
    const sceneEntry = scenes[sceneIdx];
    if (!sceneEntry) {
      console.log(`  SKIP ${file} — scene index ${sceneIdx} out of range (${scenes.length} scenes)`);
      skipped++;
      continue;
    }

    const content = readFileSync(resolve(rewriteDir, file), "utf-8");
    const newLines = parseSceneFile(content);

    const vnScene = sceneEntry.vn_scene || sceneEntry;
    const oldCount = vnScene.lines?.length ?? 0;
    vnScene.lines = newLines;

    console.log(`  ${file}: ${oldCount} → ${newLines.length} lines`);
    replaced++;
  }

  // Write output
  const outPath = outArg
    ? resolve(outArg)
    : originalPath.replace(/\.json$/, "_rewritten.json");
  writeFileSync(outPath, JSON.stringify(data, null, 2), "utf-8");

  console.log(`\n${replaced} scene(s) imported, ${skipped} skipped`);
  console.log(`Output: ${outPath}`);

  if (replaced > 0) {
    console.log(`\nNext steps:`);
    console.log(`  1. Run postproduction:  npx tsx postproduction/run.ts ${outPath}`);
    console.log(`  2. Or package directly: npx tsx postproduction/run.ts ${outPath} --skip-llm`);
  }
}

main();
