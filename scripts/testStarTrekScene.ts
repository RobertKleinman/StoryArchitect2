/**
 * Test runner for Star Trek scenes — uses the 2026-03-27 pipeline run.
 *
 * Generates one scene using the new instability/pressure-packet approach.
 * Compare output against the original scenes in the run directory.
 *
 * Usage:
 *   npx tsx scripts/testStarTrekScene.ts S01          # Adaeze/SABLE
 *   npx tsx scripts/testStarTrekScene.ts S04           # Adaeze/Tomás
 *   npx tsx scripts/testStarTrekScene.ts S02           # Adaeze/Priya
 *   npx tsx scripts/testStarTrekScene.ts S01 --tag v2  # tag for comparison
 */

import dotenv from "dotenv";
dotenv.config();

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { LLMClient } from "../backend/services/llmClient";
import { SCENE_WRITER_SYSTEM, buildSceneWriterPrompt, formatScenePlanForWriter } from "../backend/services/v2/prompts/scenePrompts";
import { SCENE_WRITER_SCHEMA } from "../backend/services/v2/schemas/sceneSchemas";
import { compressForScene, previousSceneDigest } from "../backend/services/v2/contextCompressor";
import { buildMustHonorBlock } from "../backend/services/mustHonorBlock";
import type { StoryBibleArtifact, GeneratedScene } from "../shared/types/artifacts";
import type { ScenePlan, ReadableScene } from "../shared/types/scene";

// ── Parse args ──
const args = process.argv.slice(2);
const sceneId = args.find(a => a.startsWith("S")) ?? "S01";
const tagIdx = args.indexOf("--tag");
const tag = tagIdx >= 0 ? args[tagIdx + 1] : "instability";

// ── Load Star Trek data ──
const runDir = path.resolve(__dirname, "../data/v2-runs/2026-03-27T02-39-29-794Z");
const exportPath = path.join(runDir, "full_export.json");
const outputDir = path.resolve(__dirname, "../data/v2-runs/instability-test");

const exportData = JSON.parse(fs.readFileSync(exportPath, "utf-8"));
const bible: StoryBibleArtifact = exportData.storyBible;
const allPlans: ScenePlan[] = exportData.scenePlan.scenes;
const constraintLedger = exportData.constraintLedger ?? [];

const planIndex = allPlans.findIndex(p => p.scene_id === sceneId);
if (planIndex < 0) {
  console.error(`Scene ${sceneId} not found. Available: ${allPlans.map(p => p.scene_id).join(", ")}`);
  process.exit(1);
}
const plan = allPlans[planIndex];

// ── Build prior scenes from the original run for continuity ──
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

const priorScenes: GeneratedScene[] = [];
for (let i = 0; i < planIndex; i++) {
  const sceneFile = path.join(runDir, `scene_${allPlans[i].scene_id}.json`);
  if (fs.existsSync(sceneFile)) {
    const vnScene = JSON.parse(fs.readFileSync(sceneFile, "utf-8"));
    priorScenes.push({
      scene_id: allPlans[i].scene_id,
      state: "completed",
      operationId: "prior",
      plan: allPlans[i],
      vn_scene: vnScene,
      readable: toReadable(vnScene),
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

  // Use the new formatted plan (situation + background pressure)
  const formattedPlan = formatScenePlanForWriter(plan);

  const writerPrompt = buildSceneWriterPrompt({
    scenePlan: formattedPlan,
    characterProfiles,
    worldContext,
    previousSceneDigest: prevDigest,
    mustHonorBlock: mustHonor,
  });

  console.log(`\n${"=".repeat(60)}`);
  console.log(`INSTABILITY TEST: ${sceneId} — ${plan.title}`);
  console.log(`${"=".repeat(60)}`);
  console.log(`  POV: ${plan.pov_character}`);
  console.log(`  Characters: ${plan.characters_present.join(", ")}`);
  console.log(`  Pacing: ${plan.pacing_type}`);
  console.log(`  Prior scenes for continuity: ${priorScenes.length}`);
  console.log();

  // Log the formatted plan so we can inspect it
  const planLogFile = path.join(outputDir, `${sceneId}_formatted_plan.txt`);
  fs.writeFileSync(planLogFile, formattedPlan, "utf-8");
  console.log(`Formatted plan saved: ${planLogFile}`);
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
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outFile = path.join(outputDir, `${sceneId}_${tag}_${timestamp}.txt`);

  const output = [
    `SCENE: ${sceneId} — ${plan.title}`,
    `Generated: ${new Date().toISOString()}`,
    `Duration: ${(durationMs / 1000).toFixed(1)}s`,
    `Words: ${readable.word_count}`,
    `Tag: ${tag}`,
    `Approach: instability + background pressure (not raw JSON plan)`,
    "=".repeat(80),
    "",
    readable.screenplay_text,
    "",
    "=".repeat(80),
    "FORMATTED PLAN (what the writer received):",
    formattedPlan,
  ].join("\n");

  fs.writeFileSync(outFile, output, "utf-8");

  // Latest file for quick access
  const latestFile = path.join(outputDir, `${sceneId}_latest.txt`);
  fs.writeFileSync(latestFile, output, "utf-8");

  // Raw JSON
  const jsonFile = path.join(outputDir, `${sceneId}_${tag}_${timestamp}.json`);
  fs.writeFileSync(jsonFile, JSON.stringify(vnScene, null, 2), "utf-8");

  console.log(readable.screenplay_text);
  console.log();
  console.log(`${"=".repeat(60)}`);
  console.log(`${readable.word_count} words, ${(durationMs / 1000).toFixed(1)}s`);
  console.log(`Saved: ${outFile}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
