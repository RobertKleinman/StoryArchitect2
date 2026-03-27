/**
 * Iterative single-scene test runner.
 *
 * Generates one scene using the production code path, outputs readable text.
 * Re-run after prompt changes to compare.
 *
 * Usage:
 *   npx tsx scripts/testScene.ts              # default: S03
 *   npx tsx scripts/testScene.ts S06          # specific scene
 *   npx tsx scripts/testScene.ts S03 --tag v1 # tag the output for comparison
 */

import dotenv from "dotenv";
dotenv.config();

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { LLMClient } from "../backend/services/llmClient";
import { SCENE_WRITER_SYSTEM, buildSceneWriterPrompt } from "../backend/services/v2/prompts/scenePrompts";
import { SCENE_WRITER_SCHEMA } from "../backend/services/v2/schemas/sceneSchemas";
import { compressForScene, previousSceneDigest } from "../backend/services/v2/contextCompressor";
import { buildMustHonorBlock } from "../backend/services/mustHonorBlock";
import type { StoryBibleArtifact, GeneratedScene } from "../shared/types/artifacts";
import type { ScenePlan, ReadableScene } from "../shared/types/scene";

// ── Parse args ──
const args = process.argv.slice(2);
const sceneId = args.find(a => a.startsWith("S")) ?? "S03";
const tagIdx = args.indexOf("--tag");
const tag = tagIdx >= 0 ? args[tagIdx + 1] : null;

// ── Load test data ──
const exportPath = path.resolve(__dirname, "../data/v2-runs/full_export.json");
const oldScenesPath = path.resolve(__dirname, "../data/v2-runs/rewrite_scenes.json");
const outputDir = path.resolve(__dirname, "../data/v2-runs/scene-iterations");

const exportData = JSON.parse(fs.readFileSync(exportPath, "utf-8"));
const oldScenesData = JSON.parse(fs.readFileSync(oldScenesPath, "utf-8")).scenes;

const bible: StoryBibleArtifact = exportData.storyBible;
const allPlans: ScenePlan[] = exportData.scenePlan.scenes;
const constraintLedger = exportData.constraintLedger ?? [];

const planIndex = allPlans.findIndex(p => p.scene_id === sceneId);
if (planIndex < 0) {
  console.error(`Scene ${sceneId} not found. Available: ${allPlans.map(p => p.scene_id).join(", ")}`);
  process.exit(1);
}
const plan = allPlans[planIndex];

// ── Build fake "completed scenes" from old data for continuity ──
function toReadable(vnScene: any): ReadableScene {
  const lines: string[] = [];
  for (const line of (vnScene.lines ?? [])) {
    if (line.stage_direction) lines.push(`[${line.stage_direction}]`);
    if (line.speaker === "NARRATION") {
      lines.push(line.text);
    } else if (line.speaker === "INTERNAL") {
      lines.push(`(${line.text})`);
    } else {
      const delivery = line.delivery ? ` ${line.delivery}` : "";
      const emotion = line.emotion ? ` [${line.emotion}]` : "";
      lines.push(`${line.speaker}${emotion}${delivery}: ${line.text}`);
    }
  }
  const text = lines.join("\n");
  return {
    scene_id: vnScene.scene_id ?? "",
    title: vnScene.title ?? "",
    screenplay_text: text,
    word_count: text.split(/\s+/).length,
  };
}

// Use old scenes as "prior context" for continuity
const priorScenes: GeneratedScene[] = [];
for (let i = 0; i < planIndex; i++) {
  if (oldScenesData[i]) {
    priorScenes.push({
      scene_id: allPlans[i].scene_id,
      state: "completed",
      operationId: "prior",
      plan: allPlans[i],
      vn_scene: oldScenesData[i],
      readable: toReadable(oldScenesData[i]),
    });
  }
}

// ── Generate ──
const llm = new LLMClient();

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });

  const mustHonor = buildMustHonorBlock(constraintLedger);
  const { characterProfiles, worldContext } = compressForScene(bible, plan);
  const prevDigest = previousSceneDigest(priorScenes);

  const writerPrompt = buildSceneWriterPrompt({
    scenePlan: JSON.stringify(plan, null, 2),
    characterProfiles,
    worldContext,
    previousSceneDigest: prevDigest,
    mustHonorBlock: mustHonor,
  });

  console.log(`\nGenerating ${sceneId}: ${plan.title}`);
  console.log(`  POV: ${plan.pov_character}`);
  console.log(`  Characters: ${plan.characters_present.join(", ")}`);
  console.log(`  Pacing: ${plan.pacing_type}`);
  console.log(`  Prior scenes for continuity: ${priorScenes.length}`);
  console.log();

  const startMs = Date.now();
  const writerRaw = await llm.call("scene_writer", SCENE_WRITER_SYSTEM, writerPrompt, {
    temperature: 0.85,
    maxTokens: 6000,
    jsonSchema: SCENE_WRITER_SCHEMA,
  });
  const durationMs = Date.now() - startMs;

  let vnScene: any;
  try {
    vnScene = JSON.parse(writerRaw);
  } catch {
    console.error("FAILED to parse scene writer output");
    console.error(writerRaw.slice(0, 500));
    process.exit(1);
  }

  const readable = toReadable(vnScene);

  // ── Output ──
  const suffix = tag ? `_${tag}` : "";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outFile = path.join(outputDir, `${sceneId}${suffix}_${timestamp}.txt`);

  const output = [
    `SCENE: ${sceneId} — ${plan.title}`,
    `Generated: ${new Date().toISOString()}`,
    `Duration: ${(durationMs / 1000).toFixed(1)}s`,
    `Words: ${readable.word_count}`,
    tag ? `Tag: ${tag}` : "",
    "=".repeat(80),
    "",
    readable.screenplay_text,
    "",
    "=".repeat(80),
    "PLAN (for reference):",
    JSON.stringify(plan, null, 2),
  ].filter(Boolean).join("\n");

  fs.writeFileSync(outFile, output, "utf-8");

  // Also write a "latest" file for quick access
  const latestFile = path.join(outputDir, `${sceneId}_latest.txt`);
  fs.writeFileSync(latestFile, output, "utf-8");

  // Write raw JSON too for programmatic comparison
  const jsonFile = path.join(outputDir, `${sceneId}${suffix}_${timestamp}.json`);
  fs.writeFileSync(jsonFile, JSON.stringify(vnScene, null, 2), "utf-8");

  console.log(readable.screenplay_text);
  console.log();
  console.log(`${"=".repeat(60)}`);
  console.log(`${readable.word_count} words, ${(durationMs / 1000).toFixed(1)}s`);
  console.log(`Saved: ${outFile}`);
  console.log(`Latest: ${latestFile}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
