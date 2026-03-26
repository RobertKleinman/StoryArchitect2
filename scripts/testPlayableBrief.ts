/**
 * Test script: Regenerate scenes using the playable brief approach.
 *
 * Reads the full_export.json (existing bible + scene plan), regenerates
 * all 8 scenes with batchSize=1 (sequential), and writes the output
 * alongside the old scenes for side-by-side comparison.
 *
 * Usage: npx tsx scripts/testPlayableBrief.ts
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
import { buildPlayableBrief, previousSceneDigest } from "../backend/services/v2/contextCompressor";
import { buildMustHonorBlock } from "../backend/services/mustHonorBlock";
import type { StoryBibleArtifact, GeneratedScene } from "../shared/types/artifacts";
import type { ScenePlan, ReadableScene } from "../shared/types/scene";

// ── Load test data ──
const exportPath = path.resolve(__dirname, "../data/v2-runs/full_export.json");
const oldScenesPath = path.resolve(__dirname, "../data/v2-runs/rewrite_scenes.json");
const outputDir = path.resolve(__dirname, "../data/v2-runs/playable-brief-test");

const exportData = JSON.parse(fs.readFileSync(exportPath, "utf-8"));
const oldScenes = JSON.parse(fs.readFileSync(oldScenesPath, "utf-8")).scenes;

const bible: StoryBibleArtifact = exportData.storyBible;
const scenePlan: { scenes: ScenePlan[] } = exportData.scenePlan;
const constraintLedger = exportData.constraintLedger ?? [];

// ── Setup ──
// Use default model config — no overrides needed
const llm = new LLMClient();

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

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });

  const mustHonor = buildMustHonorBlock(constraintLedger);
  const cacheablePrefix = [
    `STORY BIBLE CONTEXT (shared across all scenes):`,
    `World: ${bible.world?.world_thesis ?? ""}`,
    `Locations: ${bible.world?.arena?.locations?.map((l: any) => l.name).join(", ") ?? ""}`,
    `Tone: ${bible.world?.scope?.tone_rule ?? ""}`,
    mustHonor ? `\n${mustHonor}` : "",
  ].filter(Boolean).join("\n");

  const completedScenes: GeneratedScene[] = [];
  const newScenes: any[] = [];

  console.log(`\nRegenerating ${scenePlan.scenes.length} scenes with playable brief (sequential)...\n`);

  for (const plan of scenePlan.scenes) {
    console.log(`  [${plan.scene_id}] ${plan.title}...`);

    // Build playable brief (the new way)
    const playableBrief = buildPlayableBrief(bible, plan);

    // Log the brief for inspection
    fs.writeFileSync(
      path.join(outputDir, `brief_${plan.scene_id}.txt`),
      playableBrief,
      "utf-8",
    );

    const prevDigest = previousSceneDigest(completedScenes);

    const writerPrompt = buildSceneWriterPrompt({
      playableBrief,
      previousSceneDigest: prevDigest,
      mustHonorBlock: mustHonor,
    });

    const startMs = Date.now();
    const writerRaw = await llm.call("scene_writer", SCENE_WRITER_SYSTEM, writerPrompt, {
      temperature: 0.85,
      maxTokens: 6000,
      jsonSchema: SCENE_WRITER_SCHEMA,
      cacheableUserPrefix: cacheablePrefix,
    });
    const durationMs = Date.now() - startMs;

    let vnScene: any;
    try {
      vnScene = JSON.parse(writerRaw);
    } catch {
      console.error(`    FAILED to parse output for ${plan.scene_id}`);
      continue;
    }

    const readable = toReadable(vnScene);
    console.log(`    Done (${readable.word_count} words, ${(durationMs / 1000).toFixed(1)}s)`);

    const generatedScene: GeneratedScene = {
      scene_id: plan.scene_id,
      state: "completed",
      operationId: "playable-brief-test",
      plan,
      vn_scene: vnScene,
      readable,
    };
    completedScenes.push(generatedScene);
    newScenes.push(vnScene);
  }

  // Write results
  fs.writeFileSync(
    path.join(outputDir, "new_scenes.json"),
    JSON.stringify({ scenes: newScenes }, null, 2),
    "utf-8",
  );

  // Write side-by-side comparison
  const comparison: string[] = [];
  for (let i = 0; i < scenePlan.scenes.length; i++) {
    const plan = scenePlan.scenes[i];
    const oldScene = oldScenes[i];
    const newScene = completedScenes[i];

    comparison.push(`${"=".repeat(80)}`);
    comparison.push(`SCENE ${plan.scene_id}: ${plan.title}`);
    comparison.push(`${"=".repeat(80)}`);
    comparison.push("");

    comparison.push(`--- OLD (raw JSON plan) ---`);
    comparison.push("");
    if (oldScene) {
      const oldLines: string[] = [];
      for (const line of (oldScene.lines ?? [])) {
        if (line.stage_direction) oldLines.push(`[${line.stage_direction}]`);
        if (line.speaker === "NARRATION") {
          oldLines.push(line.text);
        } else if (line.speaker === "INTERNAL") {
          oldLines.push(`(${line.text})`);
        } else {
          const delivery = line.delivery ? ` ${line.delivery}` : "";
          const emotion = line.emotion ? ` [${line.emotion}]` : "";
          oldLines.push(`${line.speaker}${emotion}${delivery}: ${line.text}`);
        }
      }
      comparison.push(oldLines.join("\n"));
    } else {
      comparison.push("[No old scene available]");
    }

    comparison.push("");
    comparison.push(`--- NEW (playable brief) ---`);
    comparison.push("");
    if (newScene) {
      comparison.push(newScene.readable.screenplay_text);
    } else {
      comparison.push("[Generation failed]");
    }

    comparison.push("\n\n");
  }

  const comparisonPath = path.join(outputDir, "comparison.txt");
  fs.writeFileSync(comparisonPath, comparison.join("\n"), "utf-8");
  console.log(`\nComparison written to: ${comparisonPath}`);
  console.log(`Briefs written to: ${outputDir}/brief_*.txt`);
  console.log(`\nDone.`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
