/**
 * Mode test: regenerate ALL scenes from an existing project with different modes.
 *
 * Modes:
 *   --fast       Gemini Flash writer + parallel + skip judge + skip tension
 *   --erotica    Grok writer (more permissive with adult content)
 *   --haiku      Haiku writer (cheapest possible, test quality floor)
 *   (default)    Current pipeline settings (Sonnet writer, Haiku judge)
 *
 * Usage:
 *   npx tsx scripts/mode-test.ts                          # default mode
 *   npx tsx scripts/mode-test.ts --fast                   # fast mode (~$0.10, ~2min)
 *   npx tsx scripts/mode-test.ts --erotica                # grok writer
 *   npx tsx scripts/mode-test.ts --fast --project path    # custom project
 */

import dotenv from "dotenv";
dotenv.config();

import { readFile, writeFile, mkdir } from "fs/promises";
import { LLMClient } from "../backend/services/llmClient";
import { SceneGenerationService } from "../backend/services/v2/sceneGenerationService";
import { compressForScene, previousSceneDigest, buildCanonicalNames } from "../backend/services/v2/contextCompressor";
import { buildMustHonorBlock } from "../backend/services/mustHonorBlock";
import {
  SCENE_WRITER_SYSTEM,
  buildSceneWriterPrompt,
  formatScenePlanForWriter,
} from "../backend/services/v2/prompts/scenePrompts";
import { SCENE_WRITER_SCHEMA } from "../backend/services/v2/schemas/sceneSchemas";

const DEFAULT_PROJECT = "data/pipeline-output/v2_d23e8fc7-33b6-434a-9ad4-11d648cfd8eb.json";

const MODES = {
  fast: {
    label: "Fast (Gemini Flash + parallel + no judge)",
    writerModel: "gemini-2.5-flash",
    skipJudge: true,
    skipTension: true,
    parallel: true,
  },
  erotica: {
    label: "Erotica (Grok writer)",
    writerModel: "grok-4",
    skipJudge: false,
    skipTension: false,
    parallel: false,
  },
  haiku: {
    label: "Haiku (cheapest possible)",
    writerModel: "claude-haiku-4-5-20251001",
    skipJudge: true,
    skipTension: true,
    parallel: true,
  },
  default: {
    label: "Default (Sonnet writer, Haiku judge)",
    writerModel: undefined,
    skipJudge: false,
    skipTension: false,
    parallel: false,
  },
} as const;

type ModeName = keyof typeof MODES;

async function main() {
  const args = process.argv.slice(2);
  const projectPath = args.find(a => !a.startsWith("--")) ?? DEFAULT_PROJECT;

  // Detect mode
  let modeName: ModeName = "default";
  if (args.includes("--fast")) modeName = "fast";
  else if (args.includes("--erotica")) modeName = "erotica";
  else if (args.includes("--haiku")) modeName = "haiku";
  const mode = MODES[modeName];

  console.log(`Mode: ${mode.label}`);
  console.log(`Project: ${projectPath}`);

  const project = JSON.parse(await readFile(projectPath, "utf-8"));
  const llm = new LLMClient();
  const mustHonor = buildMustHonorBlock(project.constraintLedger ?? {});
  const canonicalNames = buildCanonicalNames(project.storyBible);
  const scenePlans = project.scenePlan?.scenes ?? [];
  const totalScenes = scenePlans.length;

  const cacheablePrefix = [
    `STORY BIBLE CONTEXT (shared across all scenes):`,
    `World: ${project.storyBible.world?.world_thesis ?? ""}`,
    `Locations: ${project.storyBible.world?.arena?.locations?.map((l: any) => l.name).join(", ") ?? ""}`,
    `Tone: ${project.storyBible.world?.scope?.tone_rule ?? ""}`,
    `\n${canonicalNames}`,
    mustHonor ? `\n${mustHonor}` : "",
  ].filter(Boolean).join("\n");

  console.log(`Generating ${totalScenes} scenes...\n`);
  const startTime = Date.now();

  // Build all writer prompts
  const prompts = scenePlans.map((plan: any, idx: number) => {
    const { characterProfiles, worldContext } = compressForScene(project.storyBible, plan);
    const prevDigest = ""; // Skip for parallel mode simplicity
    return {
      plan,
      prompt: buildSceneWriterPrompt({
        scenePlan: formatScenePlanForWriter(plan),
        characterProfiles,
        worldContext,
        previousSceneDigest: prevDigest,
        mustHonorBlock: mustHonor,
        tensionState: "",
      }),
    };
  });

  // Generate scenes — parallel or sequential
  type SceneResult = { plan: any; scene: any; durationMs: number };
  let results: SceneResult[];

  if (mode.parallel) {
    // All scenes in parallel
    console.log(`[parallel] Launching ${totalScenes} scenes simultaneously...`);
    results = await Promise.all(prompts.map(async ({ plan, prompt }: any) => {
      const sceneStart = Date.now();
      const raw = await llm.call("scene_writer", SCENE_WRITER_SYSTEM, prompt, {
        temperature: 0.85,
        maxTokens: 6000,
        jsonSchema: SCENE_WRITER_SCHEMA,
        truncationMode: "critical",
        cacheableUserPrefix: cacheablePrefix,
        ...(mode.writerModel ? { modelOverride: mode.writerModel } : {}),
      });
      const scene = JSON.parse(raw);
      const durationMs = Date.now() - sceneStart;
      console.log(`  ✓ ${plan.title ?? plan.scene_id} (${(durationMs / 1000).toFixed(1)}s)`);
      return { plan, scene, durationMs };
    }));
  } else {
    // Sequential
    results = [];
    for (const { plan, prompt } of prompts) {
      const sceneStart = Date.now();
      console.log(`  Writing: ${plan.title ?? plan.scene_id}...`);
      const raw = await llm.call("scene_writer", SCENE_WRITER_SYSTEM, prompt, {
        temperature: 0.85,
        maxTokens: 6000,
        jsonSchema: SCENE_WRITER_SCHEMA,
        truncationMode: "critical",
        cacheableUserPrefix: cacheablePrefix,
        ...(mode.writerModel ? { modelOverride: mode.writerModel } : {}),
      });
      const scene = JSON.parse(raw);
      const durationMs = Date.now() - sceneStart;
      console.log(`  ✓ ${plan.title ?? plan.scene_id} (${(durationMs / 1000).toFixed(1)}s)`);
      results.push({ plan, scene, durationMs });
    }
  }

  const totalDuration = Date.now() - startTime;
  console.log(`\nDone: ${totalScenes} scenes in ${(totalDuration / 1000).toFixed(1)}s`);

  // Format output
  const output: string[] = [
    `# Mode Test: ${mode.label}`,
    ``,
    `Generated ${totalScenes} scenes in ${(totalDuration / 1000).toFixed(1)}s`,
    `Writer model: ${mode.writerModel ?? "default (Sonnet)"}`,
    `Judge: ${mode.skipJudge ? "skipped" : "enabled"}`,
    `Tension tracking: ${mode.skipTension ? "skipped" : "enabled"}`,
    `Parallel: ${mode.parallel ? "yes" : "no (sequential)"}`,
    ``,
    `---`,
    ``,
  ];

  for (const { plan, scene, durationMs } of results) {
    output.push(`## ${scene.title ?? plan.title ?? plan.scene_id} (${(durationMs / 1000).toFixed(1)}s)`);
    output.push(`Setting: ${scene.setting ?? ""}`);
    output.push(``);
    output.push("```");

    for (const line of (scene.lines ?? [])) {
      const speaker = line.speaker ?? "???";
      const emotion = line.emotion ? ` (${line.emotion})` : "";
      const delivery = line.delivery ? ` ${line.delivery}` : "";
      const stage = line.stage_direction ? `  [${line.stage_direction}]` : "";

      if (speaker === "NARRATION") {
        output.push(`  ${line.text}${stage}`);
      } else if (speaker === "INTERNAL") {
        output.push(`  *${line.text}*${emotion}`);
      } else {
        output.push(`${speaker}${emotion}${delivery}: "${line.text}"${stage}`);
      }
    }

    output.push("```");
    output.push(``);
  }

  // Save
  await mkdir("data/mode-tests", { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outPath = `data/mode-tests/${modeName}-${ts}.md`;
  await writeFile(outPath, output.join("\n"), "utf-8");
  console.log(`Output saved to: ${outPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
