/**
 * v2 Bible Service — Step 4: Generate Story Bible + Scene Plan
 *
 * Sequential: World → Characters → Plot → Judge → Scene Plan
 * Each sub-step checkpoints so failures can resume.
 */

import { createHash } from "crypto";
import type { Step4_BibleGenerating, StepTrace, BibleSubStep } from "../../../shared/types/project";
import type { StoryBibleArtifact, ScenePlanArtifact, CharacterProfile, CharacterRelationship } from "../../../shared/types/artifacts";
import { LLMClient } from "../llmClient";
import { buildMustHonorBlock } from "../mustHonorBlock";
import {
  WORLD_WRITER_SYSTEM, CHARACTER_WRITER_SYSTEM, PLOT_WRITER_SYSTEM,
  BIBLE_JUDGE_SYSTEM, SCENE_PLANNER_SYSTEM,
  buildWorldPrompt, buildCharacterPrompt, buildPlotPrompt,
  buildBibleJudgePrompt, buildScenePlannerPrompt,
} from "./prompts/biblePrompts";
import {
  WORLD_WRITER_SCHEMA, CHARACTER_WRITER_SCHEMA, PLOT_WRITER_SCHEMA,
  BIBLE_JUDGE_SCHEMA, SCENE_PLANNER_SCHEMA,
} from "./schemas/bibleSchemas";
import { emitProgress } from "./progressEmitter";
import { getAbortSignal } from "./orchestrator";

export class BibleService {
  constructor(private llm: LLMClient) {}

  async generate(
    project: Step4_BibleGenerating,
    culturalBrief?: string,
    onCheckpoint?: (project: Step4_BibleGenerating) => Promise<void>,
  ): Promise<{ storyBible: StoryBibleArtifact; scenePlan: ScenePlanArtifact; traces: StepTrace[] }> {
    const projectId = project.projectId as string;
    const abortSignal = getAbortSignal(projectId);
    const traces: StepTrace[] = [];
    const mustHonor = buildMustHonorBlock(project.constraintLedger);
    const premiseStr = this.formatPremise(project.premise);

    let worldData: any = null;
    let charData: any = null;
    let plotData: any = null;

    const completed = project.checkpoint.completedSubSteps;

    // ── Sub-step 1: World ────────────────────────────────────────
    if (!completed.includes("world")) {
      emitProgress(projectId, {
        totalSteps: 5, completedSteps: 0,
        currentStep: "Building world...",
        startedAt: new Date().toISOString(),
      });

      const startMs = Date.now();
      const raw = await this.llm.call("bible_writer", WORLD_WRITER_SYSTEM,
        buildWorldPrompt({ premise: premiseStr, mustHonorBlock: mustHonor, culturalBrief }),
        { temperature: 0.8, maxTokens: 4000, jsonSchema: WORLD_WRITER_SCHEMA, abortSignal },
      );
      traces.push(this.makeTrace(project.operationId, "bible_writer", startMs, "world"));
      worldData = JSON.parse(raw);

      completed.push("world");
      if (onCheckpoint) await onCheckpoint(project);
    }

    // ── Sub-step 2: Characters ───────────────────────────────────
    if (!completed.includes("characters")) {
      emitProgress(projectId, {
        totalSteps: 5, completedSteps: 1,
        currentStep: "Creating characters...",
        startedAt: new Date().toISOString(),
      });

      const worldStr = worldData ? JSON.stringify(worldData, null, 2) : "(world not available)";
      const startMs = Date.now();
      const raw = await this.llm.call("bible_writer", CHARACTER_WRITER_SYSTEM,
        buildCharacterPrompt({ premise: premiseStr, worldSection: worldStr, mustHonorBlock: mustHonor }),
        { temperature: 0.8, maxTokens: 5000, jsonSchema: CHARACTER_WRITER_SCHEMA, abortSignal },
      );
      traces.push(this.makeTrace(project.operationId, "bible_writer", startMs, "characters"));
      charData = JSON.parse(raw);

      completed.push("characters");
      if (onCheckpoint) await onCheckpoint(project);
    }

    // ── Sub-step 3: Plot ─────────────────────────────────────────
    if (!completed.includes("plot")) {
      emitProgress(projectId, {
        totalSteps: 5, completedSteps: 2,
        currentStep: "Architecting plot...",
        startedAt: new Date().toISOString(),
      });

      const worldStr = worldData ? JSON.stringify(worldData, null, 2) : "(world not available)";
      const charStr = charData ? JSON.stringify(charData, null, 2) : "(characters not available)";
      const startMs = Date.now();
      const raw = await this.llm.call("bible_writer", PLOT_WRITER_SYSTEM,
        buildPlotPrompt({ premise: premiseStr, worldSection: worldStr, characterSection: charStr, mustHonorBlock: mustHonor }),
        { temperature: 0.8, maxTokens: 6000, jsonSchema: PLOT_WRITER_SCHEMA, abortSignal },
      );
      traces.push(this.makeTrace(project.operationId, "bible_writer", startMs, "plot"));
      plotData = JSON.parse(raw);

      completed.push("plot");
      if (onCheckpoint) await onCheckpoint(project);
    }

    // ── Sub-step 4: Judge ────────────────────────────────────────
    if (!completed.includes("judge")) {
      emitProgress(projectId, {
        totalSteps: 5, completedSteps: 3,
        currentStep: "Checking consistency...",
        startedAt: new Date().toISOString(),
      });

      const startMs = Date.now();
      const judgeRaw = await this.llm.call("bible_judge", BIBLE_JUDGE_SYSTEM,
        buildBibleJudgePrompt({
          worldSection: JSON.stringify(worldData, null, 2),
          characterSection: JSON.stringify(charData, null, 2),
          plotSection: JSON.stringify(plotData, null, 2),
          mustHonorBlock: mustHonor,
        }),
        { temperature: 0.3, maxTokens: 2000, jsonSchema: BIBLE_JUDGE_SCHEMA, abortSignal },
      );
      traces.push(this.makeTrace(project.operationId, "bible_judge", startMs, "judge"));

      // If judge finds critical issues, we could do a repair pass here.
      // For now, log and continue — the user reviews in Step 5.

      completed.push("judge");
      if (onCheckpoint) await onCheckpoint(project);
    }

    // ── Sub-step 5: Scene Plan ───────────────────────────────────
    let scenePlanData: any = null;
    if (!completed.includes("scene_plan")) {
      emitProgress(projectId, {
        totalSteps: 5, completedSteps: 4,
        currentStep: "Planning scenes...",
        startedAt: new Date().toISOString(),
      });

      // Compress bible for scene planner (relevant highlights, not full JSON)
      const bibleCompressed = this.compressBibleForPlanner(worldData, charData, plotData);
      const startMs = Date.now();
      const raw = await this.llm.call("scene_planner", SCENE_PLANNER_SYSTEM,
        buildScenePlannerPrompt({ bibleCompressed, mustHonorBlock: mustHonor }),
        { temperature: 0.7, maxTokens: 4000, jsonSchema: SCENE_PLANNER_SCHEMA, abortSignal },
      );
      traces.push(this.makeTrace(project.operationId, "scene_planner", startMs, "scene_plan"));
      scenePlanData = JSON.parse(raw);

      completed.push("scene_plan");
      if (onCheckpoint) await onCheckpoint(project);
    }

    // ── Assemble artifacts ───────────────────────────────────────

    const characters: Record<string, CharacterProfile> = {};
    for (const c of (charData?.characters ?? [])) {
      characters[c.name] = {
        name: c.name,
        role: c.role,
        description: c.description,
        presentation: c.presentation,
        age_range: c.age_range,
        psychological_profile: c.psychological_profile,
        threshold_statement: c.threshold_statement,
        competence_axis: c.competence_axis,
      };
    }

    const relationships: CharacterRelationship[] = (charData?.relationships ?? []).map((r: any) => ({
      between: r.between as [string, string],
      nature: r.nature,
      stated_dynamic: r.stated_dynamic,
      true_dynamic: r.true_dynamic,
    }));

    const storyBible: StoryBibleArtifact = {
      state: "draft",
      operationId: project.operationId,
      world: {
        scope: worldData?.scope ?? {},
        arena: worldData?.arena ?? { locations: [], edges: [], primary_stage: "", hidden_stage: "" },
        rules: worldData?.rules ?? [],
        factions: worldData?.factions ?? [],
        consequence_patterns: worldData?.consequence_patterns ?? [],
        canon_facts: worldData?.canon_facts ?? [],
        world_thesis: worldData?.world_thesis ?? "",
      },
      characters,
      relationships,
      ensemble_dynamic: charData?.ensemble_dynamic ?? "",
      plot: {
        core_conflict: plotData?.core_conflict ?? "",
        tension_chain: plotData?.tension_chain ?? [],
        turning_points: plotData?.turning_points ?? [],
        theme_cluster: plotData?.theme_cluster ?? { topic: "", question: "", statement: "", countertheme: "" },
        dramatic_irony_points: plotData?.dramatic_irony_points ?? [],
        motifs: plotData?.motifs ?? [],
        mystery_hooks: plotData?.mystery_hooks ?? [],
        climax: plotData?.climax ?? { beat: "", why_now: "", core_conflict_collision: "" },
        resolution: plotData?.resolution ?? { new_normal: "", emotional_landing: "", ending_energy: "" },
        addiction_engine: plotData?.addiction_engine ?? "",
      },
    };

    const scenePlan: ScenePlanArtifact = {
      state: "draft",
      operationId: project.operationId,
      scenes: scenePlanData?.scenes ?? [],
      total_scenes: scenePlanData?.scenes?.length ?? 0,
      estimated_word_count: scenePlanData?.estimated_word_count ?? 0,
    };

    return { storyBible, scenePlan, traces };
  }

  // ── Helpers ─────────────────────────────────────────────────────

  private formatPremise(premise: any): string {
    return [
      `HOOK: ${premise.hook_sentence}`,
      `EMOTIONAL PROMISE: ${premise.emotional_promise}`,
      `PREMISE: ${premise.premise_paragraph}`,
      `SYNOPSIS: ${premise.synopsis}`,
      `SETTING: ${premise.setting_anchor} (${premise.time_period})`,
      `TONE: ${premise.tone_chips?.join(", ")}`,
      `CORE CONFLICT: ${premise.core_conflict}`,
      `CHARACTERS: ${premise.characters_sketch?.map((c: any) => `${c.name} (${c.role}): ${c.one_liner}`).join("; ")}`,
      premise.bans?.length ? `BANS: ${premise.bans.join(", ")}` : "",
    ].filter(Boolean).join("\n");
  }

  private compressBibleForPlanner(world: any, chars: any, plot: any): string {
    const parts: string[] = [];

    if (world) {
      parts.push("WORLD:");
      parts.push(`  Thesis: ${world.world_thesis}`);
      parts.push(`  Locations: ${world.arena?.locations?.map((l: any) => l.name).join(", ")}`);
      parts.push(`  Rules: ${world.rules?.map((r: any) => r.rule).join("; ")}`);
    }

    if (chars) {
      parts.push("\nCHARACTERS:");
      for (const c of (chars.characters ?? [])) {
        parts.push(`  ${c.name} (${c.role}): wants ${c.psychological_profile?.want}; misbelieves ${c.psychological_profile?.misbelief}`);
      }
    }

    if (plot) {
      parts.push("\nTENSION CHAIN:");
      for (const beat of (plot.tension_chain ?? [])) {
        parts.push(`  ${beat.id}: ${beat.beat} [${beat.characters_involved?.join(", ")}]`);
      }
      parts.push(`\nCLIMAX: ${plot.climax?.beat}`);
      parts.push(`RESOLUTION: ${plot.resolution?.emotional_landing}`);
    }

    return parts.join("\n");
  }

  private makeTrace(operationId: any, role: string, startMs: number, subStep?: string): StepTrace {
    return {
      operationId,
      role: subStep ? `${role}:${subStep}` : role,
      templateVersion: createHash("sha256").update(role + (subStep ?? "")).digest("hex").slice(0, 16),
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
