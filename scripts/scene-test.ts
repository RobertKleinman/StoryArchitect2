/**
 * SCENE GENERATION TEST HARNESS
 * ================================
 * Feeds saved bible + scene plan into scene generation,
 * then runs the erotica diagnostic on the output.
 *
 * Usage:
 *   npx tsx scripts/scene-test.ts                              # default: arena_rivals
 *   npx tsx scripts/scene-test.ts --bible <bible-test.json> --seed arena_rivals
 */

import "dotenv/config";
import { randomUUID } from "crypto";
import { readFile, writeFile, mkdir } from "fs/promises";
import { resolve } from "path";
import { LLMClient } from "../backend/services/llmClient";
import { SceneGenerationService } from "../backend/services/v2/sceneGenerationService";
import {
  EROTICA_FAST_V2_MODEL_CONFIG,
  EROTICA_HYBRID_V2_MODEL_CONFIG,
} from "../shared/modelConfig";
import { createProjectId, createOperationId } from "../shared/types/project";
import type { Step6_SceneGenerating, GenerationMode } from "../shared/types/project";
import type { PremiseArtifact, StoryBibleArtifact, ScenePlanArtifact } from "../shared/types/artifacts";
import { loadFromCombinedJSON, extractVNScene } from "../postproduction/loader";
import type { VNScene, IdentifiedScene, IdentifiedLine } from "../postproduction/types";
import { runEroticaDiagnostic, formatReport } from "../postproduction/erotica/diagnostic";

function assignLineIds(scene: VNScene): IdentifiedScene {
  const lines: IdentifiedLine[] = scene.lines.map((line, i) => ({
    ...line,
    _lid: `${scene.scene_id}_L${String(i).padStart(3, "0")}`,
  }));
  return { ...scene, lines };
}

function makeProject(
  premise: PremiseArtifact,
  bible: StoryBibleArtifact,
  scenePlan: ScenePlanArtifact,
  mode: GenerationMode,
): Step6_SceneGenerating {
  const now = new Date().toISOString();
  return {
    step: "scene_generating" as const,
    projectId: createProjectId(`v2_stest_${randomUUID()}`),
    operationId: createOperationId(randomUUID()),
    createdAt: now,
    updatedAt: now,
    traces: [],
    psychologyLedger: {
      signalStore: [],
      reads: [],
      assumptionDeltas: [],
      probeHistory: [],
      heuristics: {
        typeRatio: 0.5,
        avgResponseLength: 0,
        deferralRate: 0,
        changeRate: 0,
        totalInteractions: 0,
        engagementTrend: 0,
      },
    },
    constraintLedger: [],
    culturalInsights: [],
    mode,
    premise,
    storyBible: bible,
    scenePlan,
    generatedScenes: [],
    checkpoint: {
      totalScenes: scenePlan.scenes.length,
      completedSceneIds: [],
    },
  };
}

async function main() {
  const args = process.argv.slice(2);

  // Find the latest bible test results
  const bibleTestPath = args.find(a => a.startsWith("--bible"))
    ? args[args.indexOf("--bible") + 1]
    : undefined;
  const seedId = args.find(a => a.startsWith("--seed"))
    ? args[args.indexOf("--seed") + 1]
    : "arena_rivals";

  // Load bible test results
  let bibleResults: any[];
  if (bibleTestPath) {
    bibleResults = JSON.parse(await readFile(resolve(bibleTestPath), "utf-8"));
  } else {
    // Find the latest bible test file
    const { readdir } = await import("fs/promises");
    const dir = resolve("data/postproduction/bible-tests");
    const files = (await readdir(dir)).filter(f => f.endsWith(".json")).sort().reverse();
    if (files.length === 0) throw new Error("No bible test results found");
    bibleResults = JSON.parse(await readFile(resolve(dir, files[0]), "utf-8"));
    console.log(`Using latest bible test: ${files[0]}`);
  }

  const bibleEntry = bibleResults.find((r: any) => r.seedId === seedId && r.bible);
  if (!bibleEntry) throw new Error(`No bible found for seed "${seedId}"`);

  // Load the matching premise
  const premiseFile = await readFile(resolve("data/postproduction/premise-tests/premise-test-2026-04-04T16-36-51.json"), "utf-8");
  const premiseResults = JSON.parse(premiseFile);
  const premiseEntry = premiseResults.find((r: any) => r.seedId === seedId && r.mode === "erotica-hybrid" && r.premise);
  if (!premiseEntry) throw new Error(`No premise found for seed "${seedId}"`);

  // Backfill orientation
  if (!premiseEntry.premise.erotica_orientation && premiseEntry.seed) {
    const seedLower = premiseEntry.seed.toLowerCase();
    if (/\bgay\s+m(ale|en)\b|\ball[- ]male\b|\bmen\s+only\b/.test(seedLower)) {
      premiseEntry.premise.erotica_orientation = "gay male";
    }
  }

  const mode: GenerationMode = "erotica-fast";
  const config = EROTICA_FAST_V2_MODEL_CONFIG;

  console.log(`═══ SCENE GENERATION TEST: ${seedId} (${mode}) ═══`);
  console.log(`Scenes to generate: ${bibleEntry.scenePlan.scenes.length}`);
  console.log(`Characters: ${Object.keys(bibleEntry.bible.characters).join(", ")}`);
  console.log();

  const llm = new LLMClient(undefined, config);
  const service = new SceneGenerationService(llm);
  const project = makeProject(premiseEntry.premise, bibleEntry.bible, bibleEntry.scenePlan, mode);

  const startMs = Date.now();
  const result = await service.generate(
    project,
    async (updated) => {
      const done = updated.checkpoint.completedSceneIds.length;
      const total = updated.checkpoint.totalScenes;
      console.log(`  [${done}/${total}] Scene completed`);
    },
    { batchSize: 4, skipJudge: true, skipTension: true },
  );
  const durationMs = Date.now() - startMs;

  console.log(`\n✓ Generated ${result.scenes.length} scenes in ${(durationMs / 1000).toFixed(0)}s\n`);

  // Show scene summaries
  for (const scene of result.scenes) {
    const lineCount = scene.vn_scene?.lines?.length ?? 0;
    const wordCount = (scene.vn_scene?.lines ?? []).reduce((s: number, l: any) => s + (l.text?.split(/\s+/).length ?? 0), 0);
    console.log(`  ${scene.scene_id}: "${scene.vn_scene?.title ?? "?"}" — ${lineCount} lines, ${wordCount} words`);
  }

  // Run erotica diagnostic
  console.log("\n═══ DIAGNOSTIC ═══\n");
  const vnScenes: IdentifiedScene[] = [];
  for (const scene of result.scenes) {
    if (scene.vn_scene?.lines?.length > 0) {
      vnScenes.push(assignLineIds(scene.vn_scene));
    }
  }

  if (vnScenes.length > 0) {
    const report = runEroticaDiagnostic(vnScenes, bibleEntry.bible, seedId);
    console.log(formatReport(report));

    // Save everything
    const outDir = resolve("data/postproduction/scene-tests");
    await mkdir(outDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const outPath = resolve(outDir, `scene-test-${ts}.json`);
    await writeFile(outPath, JSON.stringify({
      seedId,
      mode,
      durationMs,
      scenes: result.scenes,
      diagnostic: report,
    }, null, 2));
    console.log(`\nResults saved: ${outPath}`);
  } else {
    console.log("No scenes with lines generated.");
  }
}

main().catch(err => {
  console.error("Fatal:", err.message ?? err);
  process.exit(1);
});
