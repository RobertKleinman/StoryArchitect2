/**
 * v2 Scene Generation Service — Step 6: Generate VN Scenes
 *
 * Generates scenes in configurable batches (default 3) for speed.
 * Uses playable briefs instead of raw plan JSON — the writer receives
 * situation + constraints, not interpretive analysis.
 *
 * Set batchSize=1 for sequential generation (useful for A/B testing).
 */

import { createHash } from "crypto";
import type { Step6_SceneGenerating, StepTrace } from "../../../shared/types/project";
import type { GeneratedScene } from "../../../shared/types/artifacts";
import type { ReadableScene } from "../../../shared/types/scene";
import { LLMClient } from "../llmClient";
import { buildMustHonorBlock } from "../mustHonorBlock";
import { SCENE_WRITER_SYSTEM, buildSceneWriterPrompt, formatScenePlanForWriter } from "./prompts/scenePrompts";
import { SCENE_WRITER_SCHEMA } from "./schemas/sceneSchemas";
import { compressForScene, previousSceneDigest } from "./contextCompressor";
import { emitProgress, emitSceneComplete } from "./progressEmitter";
import { getAbortSignal } from "./orchestrator";

const DEFAULT_BATCH_SIZE = 3;

export class SceneGenerationService {
  constructor(private llm: LLMClient) {}

  async generate(
    project: Step6_SceneGenerating,
    onCheckpoint?: (project: Step6_SceneGenerating) => Promise<void>,
    options?: { batchSize?: number },
  ): Promise<{ scenes: GeneratedScene[]; traces: StepTrace[] }> {
    const batchSize = options?.batchSize ?? DEFAULT_BATCH_SIZE;
    const projectId = project.projectId as string;
    const abortSignal = getAbortSignal(projectId);
    const traces: StepTrace[] = [];
    const allScenes: GeneratedScene[] = [...project.generatedScenes];
    const totalScenes = project.scenePlan.scenes.length;

    // Get scenes still to generate
    const remaining = project.scenePlan.scenes.filter(
      plan => !project.checkpoint.completedSceneIds.includes(plan.scene_id),
    );

    // Build cacheable prefix: shared context across all scene calls
    // This gets cached by the Anthropic API so scenes 2-9 skip re-processing it
    const mustHonor = buildMustHonorBlock(project.constraintLedger);
    const cacheablePrefix = [
      `STORY BIBLE CONTEXT (shared across all scenes):`,
      `World: ${project.storyBible.world?.world_thesis ?? ""}`,
      `Locations: ${project.storyBible.world?.arena?.locations?.map((l: any) => l.name).join(", ") ?? ""}`,
      `Tone: ${project.storyBible.world?.scope?.tone_rule ?? ""}`,
      mustHonor ? `\n${mustHonor}` : "",
    ].filter(Boolean).join("\n");

    // Process in batches
    for (let batchStart = 0; batchStart < remaining.length; batchStart += batchSize) {
      if (abortSignal?.aborted) throw new DOMException("Aborted", "AbortError");

      const batch = remaining.slice(batchStart, batchStart + batchSize);
      const batchNum = Math.floor(batchStart / batchSize) + 1;
      const totalBatches = Math.ceil(remaining.length / batchSize);

      emitProgress(projectId, {
        totalSteps: totalScenes,
        completedSteps: allScenes.length,
        currentStep: `Writing scenes batch ${batchNum}/${totalBatches}: ${batch.map(p => p.title).join(", ")}`,
        startedAt: new Date().toISOString(),
      });

      // Build continuity digest from all completed scenes so far
      const prevDigest = previousSceneDigest(allScenes);

      // Launch all scenes in this batch in parallel
      const batchPromises = batch.map(async (plan) => {
        const { characterProfiles, worldContext } = compressForScene(
          project.storyBible, plan,
        );

        const writerPrompt = buildSceneWriterPrompt({
          scenePlan: formatScenePlanForWriter(plan),
          characterProfiles,
          worldContext,
          previousSceneDigest: prevDigest,
          mustHonorBlock: mustHonor,
        });

        const startMs = Date.now();
        const writerRaw = await this.llm.call("scene_writer", SCENE_WRITER_SYSTEM, writerPrompt, {
          temperature: 0.85,
          maxTokens: 6000,
          jsonSchema: SCENE_WRITER_SCHEMA,
          abortSignal,
          cacheableUserPrefix: cacheablePrefix,
        });
        const trace = this.makeTrace(project.operationId, "scene_writer", startMs, plan.scene_id);

        let vnScene: any;
        try {
          vnScene = JSON.parse(writerRaw);
        } catch {
          throw new Error(`Failed to parse scene writer output for ${plan.scene_id}`);
        }

        const readable = this.toReadable(vnScene);

        const generatedScene: GeneratedScene = {
          scene_id: plan.scene_id,
          state: "completed",
          operationId: project.operationId,
          plan,
          vn_scene: vnScene,
          readable,
        };

        return { scene: generatedScene, trace };
      });

      // Await all scenes in this batch
      const batchResults = await Promise.all(batchPromises);

      for (const { scene, trace } of batchResults) {
        traces.push(trace);
        allScenes.push(scene);
        project.generatedScenes = allScenes;
        project.checkpoint.completedSceneIds.push(scene.scene_id);
        emitSceneComplete(projectId, scene.scene_id, allScenes.length, totalScenes);
      }

      // Checkpoint after each batch
      if (onCheckpoint) await onCheckpoint(project);
    }

    return { scenes: allScenes, traces };
  }

  private toReadable(vnScene: any): ReadableScene {
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

  private makeTrace(operationId: any, role: string, startMs: number, sceneId: string): StepTrace {
    return {
      operationId,
      role: `${role}:${sceneId}`,
      templateVersion: createHash("sha256").update(role).digest("hex").slice(0, 16),
      schemaVersion: 1,
      model: "unknown",
      provider: "unknown",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      durationMs: Date.now() - startMs,
      retryCount: 0,
      timestamp: new Date().toISOString(),
    };
  }
}
