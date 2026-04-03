#!/usr/bin/env tsx
/**
 * POSTPRODUCTION CLI
 * ══════════════════
 * Runs editor (structural scan → continuity read → targeted fixes → verify)
 * then packager (extract → validate → emit) in sequence.
 *
 * Usage:
 *   npx tsx postproduction/run.ts <input-json>              # Scene export or combined JSON
 *   npx tsx postproduction/run.ts --run-id <id>             # Find pipeline output by run ID
 *   npx tsx postproduction/run.ts <input> --force            # Package even with unfixed scenes
 *   npx tsx postproduction/run.ts <input> --skip-llm         # Structural scan + packager only (no LLM)
 *   npx tsx postproduction/run.ts <input> --editor-only      # Run editor without packaging
 *   npx tsx postproduction/run.ts --repackage <snapshot>     # Re-run packager from saved editor snapshot (no LLM)
 */

import "dotenv/config";
import { mkdir, writeFile, readFile, readdir } from "fs/promises";
import { loadFromCombinedJSON, loadFromSceneExport } from "./loader";
import { runStructuralScan } from "./pass1-structural";
import { runContinuityRead } from "./pass2-continuity";
import { runTargetedFixes } from "./pass3-fixes";
import { runVerification } from "./pass4-verify";
import { runPackager } from "./packager";
import { mapEmotionsWithLLM } from "./emotion-mapper";
import type { EditorOutput, SceneEditResult, PipelineOutput, IdentifiedScene, PostproductionConfig } from "./types";
import { buildConfig } from "./config";
import { runEroticaCleanup } from "./pass3b-erotica-cleanup";

/** Everything the packager needs, saved after the editor completes */
interface EditorSnapshot {
  input: PipelineOutput;
  editedScenes: IdentifiedScene[];
  editResults: SceneEditResult[];
  savedAt: string;
}

// ── Arg parsing ──

interface Args {
  inputPath?: string;
  runId?: string;
  repackagePath?: string;
  mode?: string;
  force: boolean;
  skipLlm: boolean;
  editorOnly: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const result: Args = { force: false, skipLlm: false, editorOnly: false };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--run-id": result.runId = args[++i]; break;
      case "--repackage": result.repackagePath = args[++i]; break;
      case "--mode": result.mode = args[++i]; break;
      case "--force": result.force = true; break;
      case "--skip-llm": result.skipLlm = true; break;
      case "--editor-only": result.editorOnly = true; break;
      default:
        if (!args[i].startsWith("--")) result.inputPath = args[i];
    }
  }
  return result;
}

// ── Logging ──

function log(phase: string, msg: string) {
  const time = new Date().toISOString().slice(11, 19);
  console.log(`[${time}] [${phase.padEnd(10)}] ${msg}`);
}

// ── Resolve input path ──

async function resolveInputPath(args: Args): Promise<string> {
  if (args.inputPath) return args.inputPath;

  if (args.runId) {
    // Look in scene exports first
    const sceneDir = "./data/scenes/exports";
    try {
      const files = await readdir(sceneDir);
      const match = files.find(f => f.includes(args.runId!));
      if (match) return `${sceneDir}/${match}`;
    } catch { /* no scene exports */ }

    // Try pipeline reports
    const reportDir = "./data/pipeline-reports";
    try {
      const files = await readdir(reportDir);
      const match = files.find(f => f.includes(args.runId!) && f.endsWith(".json"));
      if (match) return `${reportDir}/${match}`;
    } catch { /* no reports */ }

    throw new Error(`No output found for run ID: ${args.runId}`);
  }

  // Default: latest scene export
  const sceneDir = "./data/scenes/exports";
  const files = await readdir(sceneDir);
  const jsonFiles = files.filter(f => f.endsWith(".json")).sort();
  if (jsonFiles.length === 0) throw new Error("No scene exports found. Provide an input path.");
  return `${sceneDir}/${jsonFiles[jsonFiles.length - 1]}`;
}

// ── Main ──

async function main() {
  const args = parseArgs();

  const config = buildConfig(args.mode ?? process.env.V2_MODE);

  console.log("\n" + "═".repeat(60));
  console.log("  POSTPRODUCTION");
  console.log("═".repeat(60));
  log("CONFIG", `Mode: ${config.mode} | Provider: ${config.llm.provider} | Model: ${config.llm.editorialModel}`);

  // ── Repackage mode: load snapshot and skip straight to packager ──
  if (args.repackagePath) {
    log("REPACKAGE", `Loading snapshot: ${args.repackagePath}`);
    const snapshot: EditorSnapshot = JSON.parse(await readFile(args.repackagePath, "utf-8"));
    log("REPACKAGE", `${snapshot.editedScenes.length} edited scenes from ${snapshot.savedAt}`);

    // Map emotions via LLM
    const allEmotions = snapshot.editedScenes.flatMap(s => s.lines.map(l => l.emotion).filter(Boolean) as string[]);
    const emotionCache = await mapEmotionsWithLLM(allEmotions);

    log("PACKAGER", "Packaging for VNBuilder...");
    const { pkg, manifest } = runPackager(snapshot.input, snapshot.editedScenes, snapshot.editResults, {
      forceUnfixed: args.force,
      emotionCache,
    });
    log("PACKAGER", `Status: ${manifest.package_status} | ${manifest.errors.length} errors, ${manifest.warnings.length} warnings`);

    const ts = Date.now().toString(36);
    await saveOutput(`vn-export-${ts}`, pkg);
    await saveOutput(`vn-manifest-${ts}`, manifest);

    console.log("\n" + "═".repeat(60));
    console.log("  REPACKAGE COMPLETE");
    console.log("═".repeat(60));
    if (manifest.package_status === "failed") process.exit(1);
    return;
  }

  // Load input
  const inputPath = await resolveInputPath(args);
  log("LOAD", `Loading from: ${inputPath}`);

  const input = inputPath.includes("scenes/exports")
    ? await loadFromSceneExport(inputPath)
    : await loadFromCombinedJSON(inputPath);

  log("LOAD", `Loaded: ${input.scenes.length} scenes, ${Object.keys(input.storyBible.characters).length} characters, ${input.storyBible.world.arena.locations.length} locations`);

  const startTime = Date.now();
  let llmCalls = 0;

  // ── Pass 1: Structural Scan ──
  log("PASS 1", "Running structural scan...");
  const { report: structuralReport, scenes } = runStructuralScan(input);
  log("PASS 1", `Found ${structuralReport.stats.error_count} errors, ${structuralReport.stats.warning_count} warnings`);

  for (const issue of structuralReport.issues.filter(i => i.severity === "error")) {
    log("PASS 1", `  ERROR: ${issue.message}`);
  }

  let editorialReport = null;
  let editResults: SceneEditResult[] = [];
  let verificationResults: any[] = [];
  let editedScenes = scenes;

  if (!args.skipLlm) {
    // ── Pass 2: Continuity Read ──
    const dualModel = config.llm.dualModel;
    log("PASS 2", `Running continuity read (${dualModel ? config.llm.editorialModel + " + " + config.llm.secondary?.model : config.llm.editorialModel + " only"})...`);
    editorialReport = await runContinuityRead(input, scenes, config);
    llmCalls += dualModel ? 2 : 1;
    log("PASS 2", `Found ${editorialReport.fixable_findings.length} fixable findings, ${editorialReport.report_only.length} report-only`);

    for (const f of editorialReport.fixable_findings) {
      log("PASS 2", `  [${f.category}] ${f.scene_id}: ${f.description.slice(0, 80)}`);
    }

    // ── Pass 3: Targeted Fixes ──
    const fixableFindings = editorialReport.fixable_findings;
    const autoFixableStructural = structuralReport.issues.filter(i => i.auto_fixable);

    if (fixableFindings.length > 0 || autoFixableStructural.length > 0) {
      log("PASS 3", `Fixing ${fixableFindings.length} editorial + ${autoFixableStructural.length} structural issues...`);
      const fixResult = await runTargetedFixes(
        scenes,
        fixableFindings,
        autoFixableStructural,
        editorialReport.continuity_ledger,
        input.seed ?? "(no seed)",
        config,
      );
      editedScenes = fixResult.scenes;
      editResults = fixResult.results;

      const fixed = editResults.filter(r => r.status === "fixed").length;
      const unfixed = editResults.filter(r => r.status === "unfixed" && r.issues_addressed.length > 0).length;
      llmCalls += editResults.filter(r => r.status !== "unchanged").length;
      log("PASS 3", `${fixed} scenes fixed, ${unfixed} unfixed`);
    } else {
      log("PASS 3", "No fixable issues — skipping");
    }

    // ── Pass 3B: Erotica Cleanup (only for erotica modes) ──
    if (config.runEroticaCleanup) {
      log("PASS 3B", "Running erotica-specific cleanup...");
      const cleanupResult = await runEroticaCleanup(editedScenes, input, config);
      editedScenes = cleanupResult.scenes;
      const cleanupFixed = cleanupResult.results.filter(r => r.status === "fixed").length;
      llmCalls += cleanupFixed;
      // Merge cleanup results into editResults
      for (const cr of cleanupResult.results) {
        const existing = editResults.find(r => r.scene_id === cr.scene_id);
        if (existing && cr.status === "fixed") {
          existing.diffs_applied += cr.diffs_applied;
          existing.issues_addressed.push(...cr.issues_addressed);
          existing.status = "fixed";
        } else if (!existing && cr.status === "fixed") {
          editResults.push(cr);
        }
      }
      log("PASS 3B", `${cleanupFixed} scenes cleaned up`);
    }

    // ── Pass 4+5: Verify ──
    const fixedCount = editResults.filter(r => r.status === "fixed").length;
    if (fixedCount > 0) {
      log("PASS 4+5", `Verifying ${fixedCount} fixed scenes (anti-slop + continuity)...`);
      verificationResults = await runVerification(
        editedScenes,
        scenes, // original pre-edit scenes for before/after comparison
        editResults,
        editorialReport.continuity_ledger,
        config,
      );
      llmCalls += fixedCount;

      for (const v of verificationResults) {
        const status = v.passed ? "PASS" : "FAIL";
        log("PASS 4+5", `  ${v.scene_id}: ${status} (slop: ${v.slop_score}, contradictions: ${v.new_contradictions.length})`);
      }
    } else {
      log("PASS 4+5", "No fixes to verify — skipping");
    }
  } else {
    log("SKIP", "Skipping LLM passes (--skip-llm)");
  }

  // ── Editor Summary ──
  const editorOutput: EditorOutput = {
    scenes: editedScenes,
    structural_report: structuralReport,
    editorial_report: editorialReport ?? {
      fixable_findings: [],
      report_only: [],
      continuity_ledger: { characters: [], promises: [], relationships: [], world_facts: [] },
    },
    scene_edit_results: editResults,
    verification_results: verificationResults,
    stats: {
      scenes_fixed: editResults.filter(r => r.status === "fixed").length,
      scenes_unfixed: editResults.filter(r => r.status === "unfixed" && r.issues_addressed.length > 0).length,
      scenes_unchanged: editResults.filter(r => r.status === "unchanged").length,
      total_diffs_applied: editResults.reduce((sum, r) => sum + r.diffs_applied, 0),
      llm_calls: llmCalls,
    },
  };

  // ── Save editor snapshot (crash-safe: packager can re-run without LLM) ──
  const ts = Date.now().toString(36);
  const snapshot: EditorSnapshot = {
    input,
    editedScenes,
    editResults,
    savedAt: new Date().toISOString(),
  };
  await saveOutput(`editor-snapshot-${ts}`, snapshot);
  log("SAVE", `Editor snapshot saved — use --repackage to re-run packager without LLM`);

  if (args.editorOnly) {
    log("DONE", "Editor-only mode — skipping packager");
    printSummary(editorOutput, null, null, Date.now() - startTime);
    return;
  }

  // ── Emotion mapping (1 cheap LLM call, cached) ──
  const allEmotions = editedScenes.flatMap(s => s.lines.map(l => l.emotion).filter(Boolean) as string[]);
  const emotionCache = await mapEmotionsWithLLM(allEmotions, config);

  // ── Packager ──
  log("PACKAGER", "Packaging for VNBuilder...");
  const { pkg, manifest } = runPackager(input, editedScenes, editResults, {
    forceUnfixed: args.force,
    emotionCache,
  });

  log("PACKAGER", `Status: ${manifest.package_status} | ${manifest.errors.length} errors, ${manifest.warnings.length} warnings`);

  // Save outputs (reuse ts from snapshot)
  await saveOutput(`vn-export-${ts}`, pkg);
  await saveOutput(`vn-manifest-${ts}`, manifest);
  await saveOutput(`editor-report-${ts}`, {
    structural: structuralReport,
    editorial: editorialReport,
    edits: editResults,
    verification: verificationResults,
    report_only: editorialReport?.report_only ?? [],
  });

  printSummary(editorOutput, pkg, manifest, Date.now() - startTime);

  if (manifest.package_status === "failed") {
    process.exit(1);
  }
}

// ── Output ──

async function saveOutput(name: string, data: any) {
  if (!data) return;
  // Route to organized subdirectories
  const subdir = name.startsWith("vn-export") ? "exports"
               : name.startsWith("editor-snapshot") ? "snapshots"
               : name.startsWith("editor-report") || name.startsWith("vn-manifest") ? "reports"
               : "";
  const dir = subdir ? `./data/postproduction/${subdir}` : "./data/postproduction";
  await mkdir(dir, { recursive: true });
  const path = `${dir}/${name}.json`;
  await writeFile(path, JSON.stringify(data, null, 2), "utf-8");
  log("SAVE", path);
}

function printSummary(
  editor: EditorOutput,
  pkg: any | null,
  manifest: any | null,
  durationMs: number,
) {
  console.log("\n" + "═".repeat(60));
  console.log("  POSTPRODUCTION SUMMARY");
  console.log("═".repeat(60));
  console.log(`Duration: ${(durationMs / 1000).toFixed(1)}s`);
  console.log(`LLM calls: ${editor.stats.llm_calls}`);
  console.log("");
  console.log("EDITOR:");
  console.log(`  Structural issues: ${editor.structural_report.issues.length}`);
  console.log(`  Editorial findings: ${editor.editorial_report.fixable_findings.length} fixable, ${editor.editorial_report.report_only.length} report-only`);
  console.log(`  Scenes fixed: ${editor.stats.scenes_fixed}`);
  console.log(`  Scenes unfixed: ${editor.stats.scenes_unfixed}`);
  console.log(`  Diffs applied: ${editor.stats.total_diffs_applied}`);

  if (manifest) {
    console.log("");
    console.log("PACKAGER:");
    console.log(`  Status: ${manifest.package_status}`);
    console.log(`  ${manifest.characters} characters, ${manifest.locations} locations, ${manifest.scenes} scenes, ${manifest.total_lines} lines`);
    if (manifest.errors.length > 0) {
      console.log(`  Errors: ${manifest.errors.length}`);
      for (const e of manifest.errors) console.log(`    - ${e}`);
    }
    if (manifest.warnings.length > 0) {
      console.log(`  Warnings: ${manifest.warnings.length}`);
    }
    if (manifest.unfixed_scenes.length > 0) {
      console.log(`  Unfixed scenes: ${manifest.unfixed_scenes.join(", ")}`);
    }
  }

  if (editor.editorial_report.report_only.length > 0) {
    console.log("");
    console.log("REPORT-ONLY (for human review):");
    for (const r of editor.editorial_report.report_only) {
      console.log(`  [${r.category}] ${r.description.slice(0, 100)}`);
    }
  }

  console.log("═".repeat(60));
}

main().catch(err => {
  console.error("Postproduction failed:", err);
  process.exit(1);
});
