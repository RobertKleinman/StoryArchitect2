/**
 * EROTICA REWRITE TEST HARNESS
 * ==============================
 * Runs pass 3C rewriter on selected scenes from a story, then outputs
 * before/after comparison + diagnostic delta for judging.
 *
 * Usage:
 *   npx tsx scripts/erotica-rewrite-test.ts <story.json> [scene-indices...]
 *   npx tsx scripts/erotica-rewrite-test.ts story1_export.json 0 2 4
 *   npx tsx scripts/erotica-rewrite-test.ts story1_export.json        # picks worst 3
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { resolve } from "path";
import { loadFromCombinedJSON, extractVNScene } from "../postproduction/loader";
import { buildConfig } from "../postproduction/config";
import type { VNScene, IdentifiedScene, IdentifiedLine, PostproductionConfig } from "../postproduction/types";
import { runEroticaDiagnostic, formatReport, compareReports } from "../postproduction/erotica/diagnostic";
import { runEroticaDialogueRewrite } from "../postproduction/erotica/rewriter";

function assignLineIds(scene: VNScene): IdentifiedScene {
  const lines: IdentifiedLine[] = scene.lines.map((line, i) => ({
    ...line,
    _lid: `${scene.scene_id}_L${String(i).padStart(3, "0")}`,
  }));
  return { ...scene, lines };
}

function formatScene(scene: IdentifiedScene): string {
  const lines: string[] = [];
  lines.push(`── ${scene.title} (${scene.scene_id}) ──`);
  for (const l of scene.lines) {
    const emotion = l.emotion ? ` (${l.emotion})` : "";
    lines.push(`  [${l.speaker}]${emotion} ${l.text}`);
  }
  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const inputPath = args.find(a => !a.startsWith("--"));
  const sceneIndices = args.filter(a => /^\d+$/.test(a)).map(Number);

  if (!inputPath) {
    console.error("Usage: npx tsx scripts/erotica-rewrite-test.ts <story.json> [scene-indices...]");
    process.exit(1);
  }

  const fullPath = resolve(inputPath);
  const input = await loadFromCombinedJSON(fullPath);

  // Extract all scenes
  const allScenes: IdentifiedScene[] = [];
  for (const pScene of input.scenes) {
    const vnScene = extractVNScene(pScene);
    if (vnScene && vnScene.lines?.length > 0) {
      allScenes.push(assignLineIds(vnScene));
    }
  }

  if (allScenes.length === 0) {
    console.error("No scenes found.");
    process.exit(1);
  }

  // Run diagnostic on all scenes to find the worst ones
  const fullReport = runEroticaDiagnostic(allScenes, input.storyBible, inputPath);

  // Pick scenes: either user-specified or worst 3 by flagged count
  let selectedIndices: number[];
  if (sceneIndices.length > 0) {
    selectedIndices = sceneIndices.filter(i => i < allScenes.length);
  } else {
    // Pick 3 scenes with most flagged issues
    const ranked = fullReport.per_scene
      .map((ps, i) => ({ i, flagged: ps.flagged_count }))
      .sort((a, b) => b.flagged - a.flagged)
      .slice(0, 3);
    selectedIndices = ranked.map(r => r.i);
    console.log(`Auto-selected scenes with most issues: ${selectedIndices.join(", ")}`);
  }

  const selectedScenes = selectedIndices.map(i => allScenes[i]);
  console.log(`\nTesting rewriter on ${selectedScenes.length} scenes:\n`);

  // Show BEFORE
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║                    BEFORE REWRITE                   ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");
  for (const scene of selectedScenes) {
    console.log(formatScene(scene));
    console.log();
  }

  // Run diagnostic on just the selected scenes (before)
  const beforeReport = runEroticaDiagnostic(selectedScenes, input.storyBible, "before");

  // Build config for erotica mode
  const mode = (input as any).mode || "erotica-hybrid";
  const config = buildConfig(mode.includes("erotica") ? mode : "erotica-hybrid");

  // Run rewriter on selected scenes only
  console.log("Running rewriter...\n");
  const { scenes: rewrittenScenes, results } = await runEroticaDialogueRewrite(
    selectedScenes, input, config, beforeReport,
  );

  // Show AFTER
  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║                    AFTER REWRITE                    ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");
  for (const scene of rewrittenScenes) {
    console.log(formatScene(scene));
    console.log();
  }

  // Show results
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║                   REWRITE RESULTS                   ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");
  for (const r of results) {
    console.log(`${r.scene_id}: ${r.status} — ${r.diffs_applied} applied, ${r.diffs_rejected} rejected`);
    for (const a of r.issues_addressed) {
      console.log(`  ✓ ${a}`);
    }
  }

  // Run diagnostic on rewritten scenes (after)
  const afterReport = runEroticaDiagnostic(rewrittenScenes, input.storyBible, "after");

  console.log("\n" + compareReports(beforeReport, afterReport));

  // Save before/after for manual review
  const outDir = resolve("data/postproduction/rewrite-tests");
  await mkdir(outDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outPath = resolve(outDir, `rewrite-test-${ts}.json`);
  await writeFile(outPath, JSON.stringify({
    source: inputPath,
    mode,
    scene_indices: selectedIndices,
    results,
    before: selectedScenes.map(s => ({ scene_id: s.scene_id, title: s.title, lines: s.lines })),
    after: rewrittenScenes.map(s => ({ scene_id: s.scene_id, title: s.title, lines: s.lines })),
    before_report: beforeReport,
    after_report: afterReport,
  }, null, 2));
  console.log(`\nTest saved: ${outPath}`);
}

main().catch(err => {
  console.error("Error:", err.message ?? err);
  process.exit(1);
});
