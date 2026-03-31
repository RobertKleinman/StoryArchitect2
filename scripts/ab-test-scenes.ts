/**
 * Quick A/B test: regenerate 3 scenes from an existing project with current prompts.
 * Outputs a markdown file comparing old vs new that can be pasted to ChatGPT.
 *
 * Usage: npx tsx scripts/ab-test-scenes.ts [project-json] [scene-indices]
 * Example: npx tsx scripts/ab-test-scenes.ts data/pipeline-output/v2_d23e8fc7.json 0,1,8
 *
 * Default: uses the sci-fi story and scenes 0 (Weight of Service), 1 (Audit), 8 (final)
 */

import dotenv from "dotenv";
dotenv.config();

import { readFile, writeFile, mkdir } from "fs/promises";
import { LLMClient } from "../backend/services/llmClient";
import {
  SCENE_WRITER_SYSTEM,
  buildSceneWriterPrompt,
  formatScenePlanForWriter,
} from "../backend/services/v2/prompts/scenePrompts";
import { SCENE_WRITER_SCHEMA } from "../backend/services/v2/schemas/sceneSchemas";
import { compressForScene, previousSceneDigest, buildCanonicalNames } from "../backend/services/v2/contextCompressor";
import { buildMustHonorBlock } from "../backend/services/mustHonorBlock";

const DEFAULT_PROJECT = "data/pipeline-output/v2_d23e8fc7-33b6-434a-9ad4-11d648cfd8eb.json";
const DEFAULT_SCENE_INDICES = [0, 1, 8]; // confrontation, procedural, intimate

async function main() {
  const projectPath = process.argv[2] ?? DEFAULT_PROJECT;
  const sceneIndices = process.argv[3]
    ? process.argv[3].split(",").map(Number)
    : DEFAULT_SCENE_INDICES;

  console.log(`Loading project: ${projectPath}`);
  const project = JSON.parse(await readFile(projectPath, "utf-8"));

  const llm = new LLMClient();
  const mustHonor = buildMustHonorBlock(project.constraintLedger ?? {});
  const canonicalNames = buildCanonicalNames(project.storyBible);

  const cacheablePrefix = [
    `STORY BIBLE CONTEXT (shared across all scenes):`,
    `World: ${project.storyBible.world?.world_thesis ?? ""}`,
    `Locations: ${project.storyBible.world?.arena?.locations?.map((l: any) => l.name).join(", ") ?? ""}`,
    `Tone: ${project.storyBible.world?.scope?.tone_rule ?? ""}`,
    `\n${canonicalNames}`,
    mustHonor ? `\n${mustHonor}` : "",
  ].filter(Boolean).join("\n");

  const scenes = project.generatedScenes ?? project.scenes ?? [];
  const scenePlans = project.scenePlan?.scenes ?? [];

  const output: string[] = [
    "# A/B Scene Comparison",
    "",
    "Below are 3 scenes shown twice: the **original** output from the pipeline,",
    "and a **regenerated** version using updated prompts (Phase 1 changes: emotion",
    "tag guidance, repetition awareness). Same seed, bible, scene plan.",
    "",
    "Please evaluate each pair on:",
    "1. **Thematic leakage** — do characters articulate the scene's theme directly?",
    "2. **Dialogue naturalness** — does speech sound like real people or thesis statements?",
    "3. **Character distinctiveness** — can you tell who's speaking without labels?",
    "4. **Emotion tags** — are they specific and accurate, or defaulting to neutral?",
    "5. **Overall** — which version is better and why?",
    "",
  ];

  for (const idx of sceneIndices) {
    if (idx >= scenes.length || idx >= scenePlans.length) {
      console.warn(`Scene index ${idx} out of range (${scenes.length} scenes), skipping`);
      continue;
    }

    const plan = scenePlans[idx];
    const originalScene = scenes[idx];
    const title = plan.title ?? plan.scene_id;

    console.log(`\nRegenerating scene ${idx}: "${title}"...`);

    // Build writer prompt (same as pipeline would)
    const { characterProfiles, worldContext } = compressForScene(project.storyBible, plan);
    const prevDigest = idx > 0 ? previousSceneDigest(scenes.slice(0, idx)) : "";

    const writerPrompt = buildSceneWriterPrompt({
      scenePlan: formatScenePlanForWriter(plan),
      characterProfiles,
      worldContext,
      previousSceneDigest: prevDigest,
      mustHonorBlock: mustHonor,
      tensionState: "", // no tension state for cleaner comparison
    });

    // Generate new version
    const writerRaw = await llm.call("scene_writer", SCENE_WRITER_SYSTEM, writerPrompt, {
      temperature: 0.85,
      maxTokens: 6000,
      jsonSchema: SCENE_WRITER_SCHEMA,
      truncationMode: "critical",
      cacheableUserPrefix: cacheablePrefix,
    });

    let newScene: any;
    try {
      newScene = JSON.parse(writerRaw);
    } catch {
      console.error(`Failed to parse regenerated scene ${idx}`);
      continue;
    }

    // Format both scenes as readable text
    const originalText = formatSceneForComparison(originalScene);
    const newText = formatSceneForComparison({ vn_scene: newScene });

    output.push(`---`);
    output.push(`## Scene ${idx + 1}: "${title}"`);
    output.push("");
    output.push("### VERSION A (Original)");
    output.push("```");
    output.push(originalText);
    output.push("```");
    output.push("");
    output.push("### VERSION B (Regenerated with Phase 1 changes)");
    output.push("```");
    output.push(newText);
    output.push("```");
    output.push("");
  }

  // Save output
  await mkdir("data/ab-tests", { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outPath = `data/ab-tests/ab-comparison-${ts}.md`;
  await writeFile(outPath, output.join("\n"), "utf-8");
  console.log(`\nComparison saved to: ${outPath}`);
  console.log(`Paste the contents to ChatGPT for evaluation.`);
}

function formatSceneForComparison(scene: any): string {
  const vn = scene.vn_scene ?? scene;
  const lines: string[] = [];

  lines.push(`[${vn.title ?? "Untitled"}]`);
  lines.push(`Setting: ${vn.setting ?? ""}`);
  lines.push("");

  for (const line of (vn.lines ?? [])) {
    const speaker = line.speaker ?? "???";
    const emotion = line.emotion ? ` (${line.emotion})` : "";
    const delivery = line.delivery ? ` ${line.delivery}` : "";
    const stage = line.stage_direction ? `  [${line.stage_direction}]` : "";

    if (speaker === "NARRATION") {
      lines.push(`  ${line.text}${stage}`);
    } else if (speaker === "INTERNAL") {
      lines.push(`  *${line.text}*${emotion}`);
    } else {
      lines.push(`${speaker}${emotion}${delivery}: "${line.text}"${stage}`);
    }
  }

  return lines.join("\n");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
