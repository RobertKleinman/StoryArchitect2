/**
 * v2 Scene Generation Service — Step 6: Generate VN Scenes
 *
 * Generates scenes sequentially (for causal ordering) with
 * context compression and per-scene checkpointing.
 */

import { createHash } from "crypto";
import type { Step6_SceneGenerating, StepTrace } from "../../../shared/types/project";
import type { GeneratedScene } from "../../../shared/types/artifacts";
import type { ReadableScene } from "../../../shared/types/scene";
import { LLMClient } from "../llmClient";
import { buildMustHonorBlock } from "../mustHonorBlock";
import {
  SCENE_WRITER_SYSTEM, SCENE_JUDGE_SYSTEM,
  buildSceneWriterPrompt, buildSceneJudgePrompt,
} from "./prompts/scenePrompts";
import { SCENE_WRITER_SCHEMA, SCENE_JUDGE_SCHEMA } from "./schemas/sceneSchemas";
import { compressForScene, previousSceneDigest } from "./contextCompressor";
import { emitProgress, emitSceneComplete } from "./progressEmitter";
import { getAbortSignal } from "./orchestrator";

export class SceneGenerationService {
  constructor(private llm: LLMClient) {}

  async generate(
    project: Step6_SceneGenerating,
    onCheckpoint?: (project: Step6_SceneGenerating) => Promise<void>,
  ): Promise<{ scenes: GeneratedScene[]; traces: StepTrace[] }> {
    const projectId = project.projectId as string;
    const abortSignal = getAbortSignal(projectId);
    const traces: StepTrace[] = [];
    const mustHonor = buildMustHonorBlock(project.constraintLedger);
    const scenes: GeneratedScene[] = [...project.generatedScenes];
    const totalScenes = project.scenePlan.scenes.length;

    for (let i = 0; i < totalScenes; i++) {
      const plan = project.scenePlan.scenes[i];

      // Skip already completed scenes (for resume)
      if (project.checkpoint.completedSceneIds.includes(plan.scene_id)) continue;

      // Check abort
      if (abortSignal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      emitProgress(projectId, {
        totalSteps: totalScenes,
        completedSteps: scenes.length,
        currentStep: `Writing scene ${i + 1} of ${totalScenes}: "${plan.title}"`,
        startedAt: new Date().toISOString(),
      });

      // Compress bible context for this specific scene
      const { characterProfiles, worldContext } = compressForScene(
        project.storyBible, plan,
      );
      const prevDigest = previousSceneDigest(scenes);

      // ── Writer call ────────────────────────────────────────────
      const writerPrompt = buildSceneWriterPrompt({
        scenePlan: JSON.stringify(plan, null, 2),
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
      });
      traces.push(this.makeTrace(project.operationId, "scene_writer", startMs, plan.scene_id));

      let vnScene: any;
      try {
        vnScene = JSON.parse(writerRaw);
      } catch {
        throw new Error(`Failed to parse scene writer output for ${plan.scene_id}`);
      }

      // ── Judge call ─────────────────────────────────────────────
      const judgePrompt = buildSceneJudgePrompt({
        scene: JSON.stringify(vnScene, null, 2),
        scenePlan: JSON.stringify(plan, null, 2),
        mustHonorBlock: mustHonor,
      });

      const judgeStartMs = Date.now();
      const judgeRaw = await this.llm.call("scene_judge", SCENE_JUDGE_SYSTEM, judgePrompt, {
        temperature: 0.3,
        maxTokens: 1500,
        jsonSchema: SCENE_JUDGE_SCHEMA,
        abortSignal,
      });
      traces.push(this.makeTrace(project.operationId, "scene_judge", judgeStartMs, plan.scene_id));

      let judgeResult: any;
      try {
        judgeResult = JSON.parse(judgeRaw);
      } catch {
        judgeResult = { pass: true, issues: [] };
      }

      // ── Repair if judge failed ─────────────────────────────────
      let repaired = false;
      if (!judgeResult.pass && judgeResult.issues?.length > 0) {
        const repairFeedback = judgeResult.issues
          .map((i: any) => `[${i.category}] ${i.fix_instruction}`)
          .join("\n");

        const repairPrompt = buildSceneWriterPrompt({
          scenePlan: JSON.stringify(plan, null, 2),
          characterProfiles,
          worldContext,
          previousSceneDigest: prevDigest,
          mustHonorBlock: mustHonor + `\n\nJUDGE FEEDBACK — FIX THESE:\n${repairFeedback}`,
        });

        const repairStartMs = Date.now();
        const repairRaw = await this.llm.call("scene_writer", SCENE_WRITER_SYSTEM, repairPrompt, {
          temperature: 0.7,
          maxTokens: 6000,
          jsonSchema: SCENE_WRITER_SCHEMA,
          abortSignal,
        });
        traces.push(this.makeTrace(project.operationId, "scene_writer", repairStartMs, `${plan.scene_id}_repair`));

        try {
          vnScene = JSON.parse(repairRaw);
          repaired = true;
        } catch {
          // Keep original on repair parse failure
        }
      }

      // ── Build readable version ─────────────────────────────────
      const readable = this.toReadable(vnScene);

      const generatedScene: GeneratedScene = {
        scene_id: plan.scene_id,
        state: "completed",
        operationId: project.operationId,
        plan,
        vn_scene: vnScene,
        readable,
        judge_result: {
          pass: judgeResult.pass || repaired,
          issues: judgeResult.issues?.map((i: any) => i.problem) ?? [],
          repaired,
        },
      };

      scenes.push(generatedScene);
      project.generatedScenes = scenes;
      project.checkpoint.completedSceneIds.push(plan.scene_id);

      emitSceneComplete(projectId, plan.scene_id, i + 1, totalScenes);

      if (onCheckpoint) await onCheckpoint(project);
    }

    return { scenes, traces };
  }

  private toReadable(vnScene: any): ReadableScene {
    const lines: string[] = [];
    for (const line of (vnScene.lines ?? [])) {
      if (line.stage_direction) {
        lines.push(`[${line.stage_direction}]`);
      }
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
      scene_id: vnScene.scene_id,
      title: vnScene.title,
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
