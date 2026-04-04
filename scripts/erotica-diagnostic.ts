/**
 * EROTICA DIALOGUE DIAGNOSTIC CLI
 * =================================
 * Standalone CLI for running structural analysis on erotica story exports.
 *
 * Usage:
 *   npx tsx scripts/erotica-diagnostic.ts <story-export.json>
 *   npx tsx scripts/erotica-diagnostic.ts <story-export.json> --json
 *   npx tsx scripts/erotica-diagnostic.ts <story-export.json> --compare <prev-report.json>
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { resolve } from "path";
import { loadFromCombinedJSON, extractVNScene } from "../postproduction/loader";
import type { VNScene, IdentifiedScene, IdentifiedLine } from "../postproduction/types";
import { runEroticaDiagnostic, formatReport, compareReports } from "../postproduction/erotica/diagnostic";
import type { EroticaDiagnosticReport } from "../postproduction/erotica/types";

// ── Line ID Assignment (mirrors pass1-structural.ts:assignLineIds) ──

function assignLineIds(scene: VNScene): IdentifiedScene {
  const lines: IdentifiedLine[] = scene.lines.map((line, i) => ({
    ...line,
    _lid: `${scene.scene_id}_L${String(i).padStart(3, "0")}`,
  }));
  return { ...scene, lines };
}

// ── Main ──

async function main() {
  const args = process.argv.slice(2);
  const inputPath = args.find(a => !a.startsWith("--"));
  const jsonOnly = args.includes("--json");
  const compareIdx = args.indexOf("--compare");
  const comparePath = compareIdx >= 0 ? args[compareIdx + 1] : null;

  if (!inputPath) {
    console.error("Usage: npx tsx scripts/erotica-diagnostic.ts <story-export.json> [--json] [--compare <prev.json>]");
    process.exit(1);
  }

  const fullPath = resolve(inputPath);

  // Load the story
  const input = await loadFromCombinedJSON(fullPath);

  // Extract and identify scenes
  const scenes: IdentifiedScene[] = [];
  for (const pScene of input.scenes) {
    const vnScene = extractVNScene(pScene);
    if (vnScene && vnScene.lines?.length > 0) {
      scenes.push(assignLineIds(vnScene));
    }
  }

  if (scenes.length === 0) {
    console.error("No scenes with lines found in the input file.");
    process.exit(1);
  }

  // Run diagnostic
  const report = runEroticaDiagnostic(scenes, input.storyBible, inputPath);

  // Save JSON report
  const outDir = resolve("data/postproduction/diagnostics");
  await mkdir(outDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outPath = resolve(outDir, `diagnostic-${ts}.json`);
  await writeFile(outPath, JSON.stringify(report, null, 2));

  if (jsonOnly) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatReport(report));
    console.log(`\nReport saved: ${outPath}`);
  }

  // Compare mode
  if (comparePath) {
    const prevReport: EroticaDiagnosticReport = JSON.parse(
      await readFile(resolve(comparePath), "utf-8"),
    );
    console.log("\n" + compareReports(prevReport, report));
  }
}

main().catch(err => {
  console.error("Error:", err.message ?? err);
  process.exit(1);
});
