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
import { SCENE_WRITER_SYSTEM, SCENE_JUDGE_SYSTEM, buildSceneWriterPrompt, buildSceneJudgePrompt, formatScenePlanForWriter } from "./prompts/scenePrompts";
import { SCENE_WRITER_SCHEMA, SCENE_JUDGE_SCHEMA } from "./schemas/sceneSchemas";
import { compressForScene, previousSceneDigest, buildCanonicalNames } from "./contextCompressor";
import { emitProgress, emitSceneComplete } from "./progressEmitter";
import { getAbortSignal } from "./orchestrator";

const DEFAULT_BATCH_SIZE = 3;
const MAX_SCENE_RETRIES = 2;  // retry on name hallucination or judge failure

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
    const canonicalNames = buildCanonicalNames(project.storyBible);
    const cacheablePrefix = [
      `STORY BIBLE CONTEXT (shared across all scenes):`,
      `World: ${project.storyBible.world?.world_thesis ?? ""}`,
      `Locations: ${project.storyBible.world?.arena?.locations?.map((l: any) => l.name).join(", ") ?? ""}`,
      `Tone: ${project.storyBible.world?.scope?.tone_rule ?? ""}`,
      `\n${canonicalNames}`,
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

        const traces: StepTrace[] = [];
        let bestScene: GeneratedScene | null = null;

        // Retry loop: generate → check names → judge → retry if needed
        for (let attempt = 0; attempt <= MAX_SCENE_RETRIES; attempt++) {
          if (abortSignal?.aborted) throw new DOMException("Aborted", "AbortError");

          const startMs = Date.now();
          const writerRaw = await this.llm.call("scene_writer", SCENE_WRITER_SYSTEM, writerPrompt, {
            temperature: 0.85,
            maxTokens: 6000,
            jsonSchema: SCENE_WRITER_SCHEMA,
            truncationMode: "critical",
            abortSignal,
            cacheableUserPrefix: cacheablePrefix,
          });
          traces.push(this.makeTrace(project.operationId, "scene_writer", startMs, plan.scene_id));

          let vnScene: any;
          try {
            vnScene = JSON.parse(writerRaw);
          } catch {
            throw new Error(`Failed to parse scene writer output for ${plan.scene_id}`);
          }

          const readable = this.toReadable(vnScene);

          // ── Name validation (speakers + in-text entities) ──
          const nameIssues = this.checkNameConsistency(
            readable.screenplay_text,
            project.storyBible,
            plan.scene_id,
          );

          if (nameIssues.length > 0 && attempt < MAX_SCENE_RETRIES) {
            console.warn(`[scene-gen] ${plan.scene_id} attempt ${attempt + 1}: name issues found, retrying — ${nameIssues.join("; ")}`);
            continue; // retry — fresh generation, not revision
          }

          // ── Scene judge (compliance + vitality) ──
          const judgeStartMs = Date.now();
          let judgeResult: { pass: boolean; issues: string[]; repaired: boolean; vitality?: any } = {
            pass: true, issues: nameIssues, repaired: false,
          };

          try {
            const judgePrompt = buildSceneJudgePrompt({
              scene: readable.screenplay_text,
              scenePlan: JSON.stringify(plan, null, 2), // judge gets the FULL plan
              mustHonorBlock: mustHonor,
            });

            const judgeRaw = await this.llm.call("scene_judge", SCENE_JUDGE_SYSTEM, judgePrompt, {
              temperature: 0,
              maxTokens: 2000,
              jsonSchema: SCENE_JUDGE_SCHEMA,
              truncationMode: "critical",
              abortSignal,
            });
            traces.push(this.makeTrace(project.operationId, "scene_judge", judgeStartMs, plan.scene_id));

            const judgeOutput = JSON.parse(judgeRaw);
            const judgeIssueStrings = (judgeOutput.issues ?? []).map(
              (i: any) => `[${i.category}] ${i.problem}`,
            );

            judgeResult = {
              pass: judgeOutput.pass,
              issues: [...nameIssues, ...judgeIssueStrings],
              repaired: false,
              vitality: judgeOutput.vitality,
            };

            // Log vitality summary
            if (judgeOutput.vitality) {
              const v = judgeOutput.vitality;
              const vitalityFlags = [
                v.has_failed_intention ? "✓fail_intent" : "✗fail_intent",
                v.has_non_optimal_response ? "✓non_optimal" : "✗non_optimal",
                v.has_behavioral_turn ? "✓behav_turn" : "✗behav_turn",
                v.has_asymmetry ? "✓asymmetry" : "✗asymmetry",
                v.has_discovery ? "✓discovery" : "✗discovery",
                `overexplain=${v.over_explanation_lines ?? "?"}`,
              ].join(" ");
              console.log(`[judge] ${plan.scene_id}: pass=${judgeOutput.pass} | ${vitalityFlags}`);
            }

            // If judge fails and we have retries left, try again
            if (!judgeOutput.pass && attempt < MAX_SCENE_RETRIES) {
              console.warn(`[scene-gen] ${plan.scene_id} attempt ${attempt + 1}: judge failed, retrying`);
              continue;
            }
          } catch (judgeErr: any) {
            // Judge failure is non-fatal — accept the scene with a warning
            console.warn(`[scene-gen] ${plan.scene_id}: judge call failed (${judgeErr.message}), accepting scene without judge`);
            traces.push(this.makeTrace(project.operationId, "scene_judge", judgeStartMs, plan.scene_id));
          }

          bestScene = {
            scene_id: plan.scene_id,
            state: "completed",
            operationId: project.operationId,
            plan,
            vn_scene: vnScene,
            readable,
            judge_result: judgeResult,
          };
          break; // scene accepted
        }

        if (!bestScene) {
          throw new Error(`Failed to generate acceptable scene for ${plan.scene_id} after ${MAX_SCENE_RETRIES + 1} attempts`);
        }

        return { scene: bestScene, traces };
      });

      // Await all scenes in this batch
      const batchResults = await Promise.all(batchPromises);

      for (const result of batchResults) {
        traces.push(...result.traces);
        const scene = result.scene;
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

  /**
   * Check generated scene text for name contamination.
   * Validates both speaker names AND in-text named entity references
   * against the bible's canonical character/entity list.
   * Returns issues array (empty if clean).
   */
  private checkNameConsistency(
    sceneText: string,
    bible: any,
    sceneId: string,
  ): string[] {
    const issues: string[] = [];

    // Build the set of all known names (full names, first names, nicknames)
    const knownNames = new Set(Object.keys(bible.characters ?? {}));
    const allKnownTokens = new Set<string>();

    for (const name of knownNames) {
      allKnownTokens.add(name);
      const parts = name.split(/\s+/);
      if (parts.length > 1) {
        allKnownTokens.add(parts[0]); // First name
        const nickMatch = name.match(/'([^']+)'/);
        if (nickMatch) allKnownTokens.add(nickMatch[1]);
      }
    }

    // Also collect names mentioned in character descriptions (offscreen characters)
    // These are extracted by buildCanonicalNames and should be treated as known
    for (const profile of Object.values(bible.characters ?? {})) {
      const desc = (profile as any).description ?? "";
      const relPatterns = desc.match(
        /(?:wife|husband|spouse|partner|daughter|son|sister|brother|mother|father|colleague|friend)\s+([A-ZÀ-Ö][a-zà-ö]+(?:\s+[A-ZÀ-Ö][a-zà-ö-]+)*)/g,
      );
      if (relPatterns) {
        for (const match of relPatterns) {
          const extractedName = match.replace(/^(?:wife|husband|spouse|partner|daughter|son|sister|brother|mother|father|colleague|friend)\s+/, "");
          allKnownTokens.add(extractedName);
          // Also add first name only
          const first = extractedName.split(/\s+/)[0];
          if (first) allKnownTokens.add(first);
        }
      }
    }

    // Also collect from relationships
    for (const rel of (bible.relationships ?? [])) {
      for (const name of (rel.between ?? [])) {
        allKnownTokens.add(name);
        const parts = name.split(/\s+/);
        if (parts.length > 1) allKnownTokens.add(parts[0]);
      }
    }

    // ── Check 1: Speaker names ──
    const speakerPattern = /^([A-ZÀ-Ö][A-ZÀ-Öa-zà-ö\s'-]+?)(?:\s*\[|:)/gm;
    const speakers = new Set<string>();
    let match;
    while ((match = speakerPattern.exec(sceneText)) !== null) {
      const speaker = match[1].trim();
      if (speaker !== "NARRATION" && speaker !== "INTERNAL") {
        speakers.add(speaker);
      }
    }

    for (const speaker of speakers) {
      const isKnown = allKnownTokens.has(speaker) ||
        [...allKnownTokens].some(k => k.includes(speaker) || speaker.includes(k));
      if (!isKnown) {
        issues.push(`[${sceneId}] Unknown speaker "${speaker}" — possible name hallucination`);
        console.warn(`[name-check] ${sceneId}: Unknown speaker "${speaker}"`);
      }
    }

    // ── Check 2: In-text entity references ──
    // Look for capitalized proper names in dialogue/narration that aren't in our known set.
    // Only flag names that appear as if they're character references (not place names or common words).
    const commonWords = new Set([
      "The", "She", "Her", "His", "He", "But", "And", "Not", "When", "Then", "What", "How",
      "This", "That", "There", "Here", "They", "Does", "Did", "Was", "Are", "Will", "Can",
      "All", "One", "Two", "Just", "Now", "Still", "Even", "Also", "Very", "Too", "Yet",
      "Session", "Commander", "Doctor", "Captain", "Ensign", "Sir", "God", "Tuesday",
      "Wednesday", "Thursday", "Friday", "Saturday", "Sunday", "Monday", "January",
      "February", "March", "April", "May", "June", "July", "August", "September",
      "October", "November", "December", "Christmas", "Easter",
    ]);

    // Match patterns that look like character name references in narration/dialogue
    // e.g., "Priya said", "told Elena", "asked Marc about"
    const entityPattern = /(?:told|asked|said|called|named|about|with|for|from|to|and|of)\s+([A-ZÀ-Ö][a-zà-ö]{2,}(?:\s+[A-ZÀ-Ö][a-zà-ö-]+)?)/g;
    const suspectEntities = new Set<string>();
    while ((match = entityPattern.exec(sceneText)) !== null) {
      const entity = match[1].trim();
      if (!commonWords.has(entity) && !allKnownTokens.has(entity)) {
        // Check if it's a partial match (e.g., "Édouard" matching "Édouard Fontaine")
        const isPartialMatch = [...allKnownTokens].some(k =>
          k.includes(entity) || entity.includes(k),
        );
        if (!isPartialMatch) {
          suspectEntities.add(entity);
        }
      }
    }

    for (const entity of suspectEntities) {
      issues.push(`[${sceneId}] Suspect entity "${entity}" in text — not in canonical names`);
      console.warn(`[name-check] ${sceneId}: Suspect in-text entity "${entity}"`);
    }

    return issues;
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
