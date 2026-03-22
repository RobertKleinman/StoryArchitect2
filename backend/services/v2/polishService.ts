/**
 * v2 Polish Service — Step 6.5: De-LLM-ification
 *
 * Two sequential passes per scene:
 *   Pass A (mechanical): fast model — banned phrases, structural clichés, adverb/hedge cleanup
 *   Pass B (judgment): strong model — subtext removal, voice differentiation, emotional pacing
 *
 * Runs after all scenes are generated. Edits in-place with minimal changes.
 */

import { createHash } from "crypto";
import type { StepTrace } from "../../../shared/types/project";
import type { GeneratedScene } from "../../../shared/types/artifacts";
import type { StoryBibleArtifact } from "../../../shared/types/artifacts";
import { LLMClient } from "../llmClient";
import {
  MECHANICAL_POLISH_SYSTEM, buildMechanicalPolishPrompt,
  JUDGMENT_POLISH_SYSTEM, buildJudgmentPolishPrompt,
} from "./prompts/polishPrompts";
import { emitProgress } from "./progressEmitter";

export class PolishService {
  constructor(private llm: LLMClient) {}

  async polishAll(
    projectId: string,
    scenes: GeneratedScene[],
    bible: StoryBibleArtifact,
    abortSignal?: AbortSignal,
    onProgress?: (completed: number, total: number, sceneName: string) => void,
  ): Promise<{ scenes: GeneratedScene[]; traces: StepTrace[] }> {
    const traces: StepTrace[] = [];
    const polished: GeneratedScene[] = [];
    const total = scenes.length;

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      if (abortSignal?.aborted) throw new DOMException("Aborted", "AbortError");

      const title = scene.readable?.title ?? scene.scene_id;
      if (onProgress) onProgress(i, total * 2, `Mechanical polish: "${title}"`);
      emitProgress(projectId, {
        totalSteps: total * 2,
        completedSteps: i * 2,
        currentStep: `Polishing "${title}" (mechanical)...`,
        startedAt: new Date().toISOString(),
      });

      // ── Pass A: Mechanical ─────────────────────────────────────
      let vnScene = scene.vn_scene;
      const mechStart = Date.now();
      try {
        const sceneJson = JSON.stringify(vnScene, null, 2);
        const mechRaw = await this.llm.call(
          "v2_summarizer", // fast model for mechanical edits
          MECHANICAL_POLISH_SYSTEM,
          buildMechanicalPolishPrompt(sceneJson),
          { temperature: 0.2, maxTokens: 8000, abortSignal },
        );
        const mechParsed = this.parseScene(mechRaw);
        if (mechParsed) vnScene = mechParsed;
        traces.push(this.makeTrace(`polish_mech:${scene.scene_id}`, mechStart));
      } catch (err: any) {
        if (err.name === "AbortError") throw err;
        console.warn(`[polish] Mechanical pass failed for ${scene.scene_id}: ${err.message}`);
        traces.push(this.makeTrace(`polish_mech:${scene.scene_id}`, mechStart));
      }

      if (abortSignal?.aborted) throw new DOMException("Aborted", "AbortError");

      // ── Pass B: Judgment ────────────────────────────────────────
      if (onProgress) onProgress(i, total * 2, `Judgment polish: "${title}"`);
      emitProgress(projectId, {
        totalSteps: total * 2,
        completedSteps: i * 2 + 1,
        currentStep: `Polishing "${title}" (judgment)...`,
        startedAt: new Date().toISOString(),
      });

      const charProfiles = this.buildCharProfiles(bible, vnScene.characters_present ?? []);
      const judgStart = Date.now();
      try {
        const sceneJson = JSON.stringify(vnScene, null, 2);
        const judgRaw = await this.llm.call(
          "scene_judge", // strong model for judgment calls
          JUDGMENT_POLISH_SYSTEM,
          buildJudgmentPolishPrompt(sceneJson, charProfiles),
          { temperature: 0.3, maxTokens: 8000, abortSignal },
        );
        const judgParsed = this.parseScene(judgRaw);
        if (judgParsed) vnScene = judgParsed;
        traces.push(this.makeTrace(`polish_judg:${scene.scene_id}`, judgStart));
      } catch (err: any) {
        if (err.name === "AbortError") throw err;
        console.warn(`[polish] Judgment pass failed for ${scene.scene_id}: ${err.message}`);
        traces.push(this.makeTrace(`polish_judg:${scene.scene_id}`, judgStart));
      }

      // Rebuild readable from polished VN scene
      const readable = this.toReadable(vnScene);

      polished.push({
        ...scene,
        vn_scene: vnScene,
        readable,
      });
    }

    return { scenes: polished, traces };
  }

  private parseScene(raw: string): any | null {
    try {
      // Try direct parse first
      return JSON.parse(raw);
    } catch {
      // Try extracting JSON from markdown fences
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return JSON.parse(match[0]);
        } catch {
          return null;
        }
      }
      return null;
    }
  }

  private buildCharProfiles(bible: StoryBibleArtifact, presentNames: string[]): string {
    const lines: string[] = [];
    for (const name of presentNames) {
      const c = bible.characters[name];
      if (!c) continue;
      const pp = c.psychological_profile;
      lines.push(`${name} (${c.role}):`);
      lines.push(`  Voice: ${pp.voice_pattern}`);
      lines.push(`  Want: ${pp.want}`);
      lines.push(`  Stress: ${pp.stress_style}`);
      lines.push(`  Should sound: ${c.role === "Protagonist" ? "concrete, physical, inarticulate about feelings" : c.role}`);
    }
    return lines.join("\n");
  }

  private toReadable(vnScene: any): { scene_id: string; title: string; screenplay_text: string; word_count: number } {
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

  private makeTrace(role: string, startMs: number): StepTrace {
    return {
      operationId: "" as any,
      role,
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
