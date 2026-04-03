/**
 * v2 Scene Generation Service — Step 6: Generate VN Scenes
 *
 * Generates scenes with cumulative tension tracking:
 * - Default batchSize=1 for sequential generation with tension state
 * - After each scene: Haiku updates tension state, judge validates it
 * - Marginal scenes (low vitality) get a second candidate roll
 *
 * Set batchSize>1 for parallel generation (faster, no tension tracking).
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
import {
  createTracker, updateFrequency, findOverusedDescriptors, formatPaletteForRewrite,
  type DescriptorFrequency, type SensoryPalette,
} from "../../../shared/sensoryPalette";

const DEFAULT_BATCH_SIZE = 1;  // sequential by default for tension tracking
const MAX_SCENE_RETRIES = 2;
const VITALITY_REROLL_THRESHOLD = 3; // reroll if fewer than 3 of 5 vitality flags are true

/** Running state that accumulates across scenes — the story's memory */
interface TensionState {
  relationships: Record<string, { current: string; trajectory: string; last_shift: string }>;
  unresolved_threads: string[];
  emotional_temperature: number;
  register_history: string[];
  what_the_reader_knows: string[];
  what_hasnt_broken_yet: string[];
  scene_count: number;
  /** Phrases/motifs used across scenes — fed as negative constraints to prevent repetition */
  used_phrases: string[];
}

export class SceneGenerationService {
  constructor(private llm: LLMClient) {}

  async generate(
    project: Step6_SceneGenerating,
    onCheckpoint?: (project: Step6_SceneGenerating) => Promise<void>,
    options?: {
      batchSize?: number;
      /** Override the scene writer model (e.g., "gemini-2.5-flash" for fast mode, "grok-4" for erotica) */
      writerModel?: string;
      /** Skip the scene judge entirely — accept writer output as-is */
      skipJudge?: boolean;
      /** Skip tension state tracking between scenes (enables parallel generation) */
      skipTension?: boolean;
    },
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

    // ── Cumulative tension state — the story's running memory ──
    let tensionState: TensionState = {
      relationships: {},
      unresolved_threads: [],
      emotional_temperature: 3,
      register_history: [],
      what_the_reader_knows: [],
      what_hasnt_broken_yet: [],
      scene_count: 0,
      used_phrases: [],
    };

    // ── Sensory vocabulary tracker — flags overused descriptors ──
    let descriptorTracker: DescriptorFrequency = createTracker();
    const sensoryPalette: SensoryPalette | undefined = project.storyBible?.sensory_palette;

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

        // Build tension state block for the writer (empty for scene 1)
        const tensionBlock = tensionState.scene_count > 0
          ? this.formatTensionState(tensionState)
          : "";

        const writerPrompt = buildSceneWriterPrompt({
          scenePlan: formatScenePlanForWriter(plan),
          characterProfiles,
          worldContext,
          previousSceneDigest: prevDigest,
          mustHonorBlock: mustHonor,
          tensionState: tensionBlock,
        });

        // Generate and judge a single scene candidate
        const candidate = await this.generateAndJudgeScene(
          plan, writerPrompt, cacheablePrefix, mustHonor,
          project, abortSignal, options?.writerModel, options?.skipJudge,
        );

        // ── Candidate selection: if vitality is marginal, try a second roll ──
        let finalScene = candidate.scene;
        const allTraces = [...candidate.traces];

        if (!options?.skipJudge && candidate.scene.judge_result?.vitality && candidate.scene.judge_result.pass) {
          const vitalityScore = this.countVitalityFlags(candidate.scene.judge_result.vitality);
          if (vitalityScore < VITALITY_REROLL_THRESHOLD) {
            console.log(`[scene-gen] ${plan.scene_id}: vitality ${vitalityScore}/5, generating second candidate`);
            const candidate2 = await this.generateAndJudgeScene(
              plan, writerPrompt, cacheablePrefix, mustHonor,
              project, abortSignal, options?.writerModel, options?.skipJudge,
            );
            allTraces.push(...candidate2.traces);

            const vitality2 = candidate2.scene.judge_result?.vitality
              ? this.countVitalityFlags(candidate2.scene.judge_result.vitality)
              : 0;

            if (vitality2 > vitalityScore) {
              console.log(`[scene-gen] ${plan.scene_id}: candidate B wins (${vitality2}/5 vs ${vitalityScore}/5)`);
              finalScene = candidate2.scene;
            } else {
              console.log(`[scene-gen] ${plan.scene_id}: candidate A wins (${vitalityScore}/5 vs ${vitality2}/5)`);
            }
          }
        }

        return { scene: finalScene, traces: allTraces };
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

        // ── Update cumulative tension state after each accepted scene ──
        if (!options?.skipTension) {
          try {
            tensionState = await this.updateTensionState(
              tensionState, scene, project.storyBible, abortSignal,
            );
            traces.push(this.makeTrace(project.operationId, "tension_update", Date.now(), scene.scene_id));
          } catch (err: any) {
            console.warn(`[tension] Failed to update tension state after ${scene.scene_id}: ${err.message}`);
          }
        }

        // ── Extract and accumulate distinctive phrases (deterministic, no LLM) ──
        const newPhrases = this.extractDistinctivePhrases(scene);
        if (newPhrases.length > 0) {
          tensionState.used_phrases = [...(tensionState.used_phrases ?? []), ...newPhrases];
          // Keep only the last 60 phrases to avoid bloating the context
          if (tensionState.used_phrases.length > 60) {
            tensionState.used_phrases = tensionState.used_phrases.slice(-60);
          }
          console.log(`[repetition] Extracted ${newPhrases.length} phrases from ${scene.scene_id} (${tensionState.used_phrases.length} total tracked)`);
        }

        // ── Track sensory vocabulary frequency (deterministic, no LLM) ──
        const sceneText = scene.readable?.screenplay_text ?? "";
        if (sceneText) {
          descriptorTracker = updateFrequency(descriptorTracker, sceneText, scene.scene_id);
          const overused = findOverusedDescriptors(descriptorTracker);
          if (overused.length > 0 && sensoryPalette) {
            console.log(`[vocab] Overused descriptors in ${scene.scene_id}: ${overused.join(", ")} — targeted rewrite available but deferred to postproduction`);
            // NOTE: Targeted rewrite could run here via v2_summarizer.
            // For now, we log the overuse. A future iteration can add the LLM rewrite step.
            // The palette + overuse data is available for postproduction pass integration.
          }
        }
      }

      // Checkpoint after each batch
      if (onCheckpoint) await onCheckpoint(project);
    }

    return { scenes: allScenes, traces };
  }

  /**
   * Generate a single scene candidate: write → name check → judge.
   * Returns the scene and all traces from the attempt(s).
   */
  private async generateAndJudgeScene(
    plan: any,
    writerPrompt: string,
    cacheablePrefix: string,
    mustHonor: string,
    project: Step6_SceneGenerating,
    abortSignal?: AbortSignal,
    writerModel?: string,
    skipJudge?: boolean,
  ): Promise<{ scene: GeneratedScene; traces: StepTrace[] }> {
    const traces: StepTrace[] = [];

    for (let attempt = 0; attempt <= MAX_SCENE_RETRIES; attempt++) {
      if (abortSignal?.aborted) throw new DOMException("Aborted", "AbortError");

      console.log(`[scene-gen] ${plan.scene_id}: prompt ~${Math.round((SCENE_WRITER_SYSTEM.length + writerPrompt.length + cacheablePrefix.length) / 4)} tokens (sys=${SCENE_WRITER_SYSTEM.length} user=${writerPrompt.length} cache=${cacheablePrefix.length} chars)`);
      const startMs = Date.now();
      const writerRaw = await this.llm.call("scene_writer", SCENE_WRITER_SYSTEM, writerPrompt, {
        temperature: 0.85,
        maxTokens: 8000,
        jsonSchema: SCENE_WRITER_SCHEMA,
        truncationMode: "critical",
        abortSignal,
        cacheableUserPrefix: cacheablePrefix,
        ...(writerModel ? { modelOverride: writerModel } : {}),
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
      const { hardIssues, softIssues } = this.checkNameConsistency(
        readable.screenplay_text, project.storyBible, plan.scene_id,
      );
      const nameIssues = [...hardIssues, ...softIssues];

      // Only retry on hard issues (speaker hallucination). Soft issues (in-text entities) are warnings.
      if (hardIssues.length > 0 && attempt < MAX_SCENE_RETRIES) {
        console.warn(`[scene-gen] ${plan.scene_id} attempt ${attempt + 1}: speaker name issues, retrying`);
        continue;
      }
      if (softIssues.length > 0) {
        console.warn(`[scene-gen] ${plan.scene_id}: in-text entity warnings (non-blocking): ${softIssues.join("; ")}`);
      }

      // ── Scene judge (compliance + vitality) — skipped in fast mode ──
      const judgeStartMs = Date.now();
      let judgeResult: { pass: boolean; issues: string[]; repaired: boolean; vitality?: any } = {
        pass: true, issues: nameIssues, repaired: false,
      };

      if (!skipJudge) try {
        const judgePrompt = buildSceneJudgePrompt({
          scene: readable.screenplay_text,
          scenePlan: JSON.stringify(plan, null, 2),
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
          const flags = [
            v.has_failed_intention ? "✓fail" : "✗fail",
            v.has_non_optimal_response ? "✓nonopt" : "✗nonopt",
            v.has_behavioral_turn ? "✓behav" : "✗behav",
            v.has_asymmetry ? "✓asym" : "✗asym",
            v.has_discovery ? "✓disc" : "✗disc",
            `overexp=${v.over_explanation_lines ?? "?"}`,
          ].join(" ");
          console.log(`[judge] ${plan.scene_id}: pass=${judgeOutput.pass} | ${flags}`);
        }

        if (!judgeOutput.pass && attempt < MAX_SCENE_RETRIES) {
          console.warn(`[scene-gen] ${plan.scene_id} attempt ${attempt + 1}: judge failed, retrying`);
          continue;
        }
      } catch (judgeErr: any) {
        console.warn(`[scene-gen] ${plan.scene_id}: judge failed (${judgeErr.message}), accepting without judge`);
        traces.push(this.makeTrace(project.operationId, "scene_judge", judgeStartMs, plan.scene_id));
      }

      return {
        scene: {
          scene_id: plan.scene_id,
          state: "completed",
          operationId: project.operationId,
          plan,
          vn_scene: vnScene,
          readable,
          judge_result: judgeResult,
        },
        traces,
      };
    }

    throw new Error(`Failed to generate acceptable scene for ${plan.scene_id} after ${MAX_SCENE_RETRIES + 1} attempts`);
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
   * Validates both speaker names AND in-text named entity references.
   * Returns split results: hardIssues (speaker — trigger retry) vs softIssues (in-text — warn only).
   */
  private checkNameConsistency(
    sceneText: string,
    bible: any,
    sceneId: string,
  ): { hardIssues: string[]; softIssues: string[] } {
    const hardIssues: string[] = [];
    const softIssues: string[] = [];

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
        hardIssues.push(`[${sceneId}] Unknown speaker "${speaker}" — possible name hallucination`);
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
      softIssues.push(`[${sceneId}] Suspect entity "${entity}" in text — not in canonical names`);
    }

    return { hardIssues, softIssues };
  }

  /**
   * Update cumulative tension state after an accepted scene.
   * Haiku generates the update, then we validate it structurally.
   * Scene text is canonical — the state is derived and regenerable.
   */
  private async updateTensionState(
    current: TensionState,
    scene: GeneratedScene,
    bible: any,
    abortSignal?: AbortSignal,
  ): Promise<TensionState> {
    const prompt = [
      `You are tracking the cumulative dramatic state of a story in progress.`,
      `\nCURRENT STATE (after ${current.scene_count} scenes):\n${JSON.stringify(current, null, 2)}`,
      `\nSCENE JUST COMPLETED (${scene.scene_id} — "${scene.readable.title}"):\n${scene.readable.screenplay_text.slice(0, 2000)}`,
      `\nCHARACTERS IN STORY:\n${Object.keys(bible.characters ?? {}).join(", ")}`,
      `\nUpdate the tension state based on what happened in this scene. Be concrete and specific:`,
      `- relationships: update any relationships that shifted. Use character names as keys (e.g. "Ros-Nadège").`,
      `- unresolved_threads: add new threads, remove resolved ones. Be specific about what's unresolved.`,
      `- emotional_temperature: 1-10. Should generally climb across scenes but can dip after aftermath scenes.`,
      `- register_history: append this scene's dominant register (e.g., "tense_procedural", "warm_communal", "confrontational").`,
      `- what_the_reader_knows: add any new information the reader learned. Be factual.`,
      `- what_hasnt_broken_yet: list things that are under pressure but haven't ruptured. This is the most important field — it tells the next scene's writer what pressure is available to release.`,
      `\nOutput ONLY the updated JSON object. No commentary.`,
    ].join("\n");

    const raw = await this.llm.call("v2_summarizer",
      "You track cumulative dramatic state across scenes. Output ONLY a JSON object. No commentary.",
      prompt,
      { temperature: 0.2, maxTokens: 1500, abortSignal },
    );

    let updated: TensionState;
    try {
      // Extract JSON from response (may have markdown wrapping)
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found in tension state update");
      updated = JSON.parse(jsonMatch[0]);
    } catch {
      console.warn(`[tension] Failed to parse tension state update, keeping previous state`);
      return { ...current, scene_count: current.scene_count + 1 };
    }

    // Validate structure — if Haiku returned garbage, keep the previous state
    if (!updated.relationships || !updated.what_hasnt_broken_yet || !Array.isArray(updated.unresolved_threads)) {
      console.warn(`[tension] Tension state update has invalid structure, keeping previous state`);
      return { ...current, scene_count: current.scene_count + 1 };
    }

    // Clamp emotional temperature to 1-10
    updated.emotional_temperature = Math.max(1, Math.min(10, updated.emotional_temperature ?? current.emotional_temperature));
    updated.scene_count = current.scene_count + 1;

    console.log(`[tension] Updated after ${scene.scene_id}: temp=${updated.emotional_temperature}, threads=${updated.unresolved_threads.length}, unbroken=${updated.what_hasnt_broken_yet.length}`);
    return updated;
  }

  /** Format tension state as a context block for the scene writer */
  private formatTensionState(state: TensionState): string {
    const lines: string[] = [
      "=== STORY STATE (cumulative — what has happened so far) ===",
    ];

    // Relationships
    const rels = Object.entries(state.relationships);
    if (rels.length > 0) {
      lines.push("\nRELATIONSHIP STATE:");
      for (const [pair, info] of rels) {
        lines.push(`- ${pair}: ${info.current} (${info.trajectory}). Last shift: ${info.last_shift}`);
      }
    }

    // What hasn't broken yet — most important for the writer
    if (state.what_hasnt_broken_yet.length > 0) {
      lines.push("\nWHAT HASN'T BROKEN YET (pressure available to release):");
      for (const item of state.what_hasnt_broken_yet) {
        lines.push(`- ${item}`);
      }
    }

    // Unresolved threads
    if (state.unresolved_threads.length > 0) {
      lines.push("\nUNRESOLVED THREADS:");
      for (const thread of state.unresolved_threads) {
        lines.push(`- ${thread}`);
      }
    }

    // Reader knowledge
    if (state.what_the_reader_knows.length > 0) {
      lines.push("\nWHAT THE READER KNOWS:");
      for (const fact of state.what_the_reader_knows) {
        lines.push(`- ${fact}`);
      }
    }

    // Emotional temperature and register history
    lines.push(`\nEMOTIONAL TEMPERATURE: ${state.emotional_temperature}/10`);
    if (state.register_history.length > 0) {
      lines.push(`REGISTER HISTORY: ${state.register_history.join(" → ")}`);
    }

    // Repetition avoidance — phrases already used in previous scenes
    if (state.used_phrases && state.used_phrases.length > 0) {
      lines.push("\nPHRASES ALREADY USED IN PREVIOUS SCENES (find different language for similar ideas):");
      // Show the most recent 30 to avoid context bloat
      const recent = state.used_phrases.slice(-30);
      for (const phrase of recent) {
        lines.push(`- "${phrase}"`);
      }
      lines.push("A deliberate callback to an earlier scene is fine if it's spaced 4+ scenes apart and used once. But do NOT reuse the same short phrases or motifs scene after scene.");
    }

    return lines.join("\n");
  }

  /**
   * Count effective vitality score from judge output.
   * Handles both legacy boolean flags and new quality-graded format.
   * Penalizes high over-explanation even when boolean flags pass.
   */
  private countVitalityFlags(vitality: any): number {
    if (!vitality) return 0;

    // Handle both legacy (boolean) and graded (object with quality) formats
    const isGenuine = (flag: any): boolean => {
      if (typeof flag === "boolean") return flag;
      return flag?.present && flag?.quality === "genuine";
    };

    let score = [
      vitality.failed_intention ?? vitality.has_failed_intention,
      vitality.non_optimal_response ?? vitality.has_non_optimal_response,
      vitality.behavioral_turn ?? vitality.has_behavioral_turn,
      vitality.asymmetry ?? vitality.has_asymmetry,
      vitality.discovery ?? vitality.has_discovery,
    ].filter(isGenuine).length;

    // Penalize over-explanation: 4+ lines costs 1 flag, 7+ costs 2
    const overExp = vitality.over_explanation_lines ?? 0;
    if (overExp >= 7) score -= 2;
    else if (overExp >= 4) score -= 1;

    return Math.max(0, score);
  }

  /**
   * Deterministically extract distinctive phrases from a scene's dialogue and internal lines.
   * These get accumulated across scenes and fed as negative constraints to prevent repetition.
   *
   * Extracts: short punchy lines (<8 words) that are likely motifs/refrains,
   * and distinctive multi-word phrases that appear in internal monologue.
   */
  private extractDistinctivePhrases(scene: GeneratedScene): string[] {
    const lines = scene.vn_scene?.lines ?? [];
    const phrases: string[] = [];
    const seen = new Set<string>();

    for (const line of lines) {
      const speaker = (line.speaker ?? "").toUpperCase();
      const text = (line.text ?? "").trim();
      if (!text) continue;

      // Extract short punchy internal/dialogue lines as potential motifs
      // (e.g., "There it is.", "Stop.", "I think.")
      if ((speaker === "INTERNAL" || !["NARRATION"].includes(speaker)) && text.split(/\s+/).length <= 8) {
        const normalized = text.toLowerCase().replace(/[.!?,;:'"—\-]+$/g, "").trim();
        if (normalized.length >= 4 && !seen.has(normalized)) {
          seen.add(normalized);
          phrases.push(text);
        }
      }

      // Extract distinctive multi-word phrases from internal monologue
      // Look for repeated structural patterns: "something in my X", "the X of Y"
      if (speaker === "INTERNAL") {
        // Capture phrases 3-6 words long that feel like motifs
        const matches = text.match(/(?:there (?:it )?is|something in (?:my|his|her) \w+|the \w+ (?:of|in|at) \w+|I (?:don't|didn't|can't) know)/gi);
        if (matches) {
          for (const m of matches) {
            const norm = m.toLowerCase().trim();
            if (!seen.has(norm)) {
              seen.add(norm);
              phrases.push(m);
            }
          }
        }
      }
    }

    return phrases;
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
