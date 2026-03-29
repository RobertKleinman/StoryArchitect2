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

    // Restore persisted intermediate artifacts from checkpoint (for resume)
    let worldData: any = project.checkpoint.worldData ?? null;
    let charData: any = project.checkpoint.charData ?? null;
    let plotData: any = project.checkpoint.plotData ?? null;

    const completed = project.checkpoint.completedSubSteps;

    // ── Sub-step 1: World ────────────────────────────────────────
    if (!completed.includes("world")) {
      emitProgress(projectId, {
        totalSteps: 5, completedSteps: 0,
        currentStep: "Building world...",
        startedAt: new Date().toISOString(),
      });

      const startMs = Date.now();
      // World is structural (locations, rules, factions) — faster model is fine
      const raw = await this.llm.call("bible_writer", WORLD_WRITER_SYSTEM,
        buildWorldPrompt({ premise: premiseStr, mustHonorBlock: mustHonor, culturalBrief }),
        { temperature: 0.8, maxTokens: 4000, jsonSchema: WORLD_WRITER_SCHEMA, abortSignal,
          modelOverride: "gemini-3-flash-preview" },
      );
      traces.push(this.makeTrace(project.operationId, "bible_writer", startMs, "world"));
      worldData = JSON.parse(raw);

      completed.push("world");
      project.checkpoint.worldData = worldData;
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
      project.checkpoint.charData = charData;
      if (onCheckpoint) await onCheckpoint(project);
    }

    // ── Sub-step 3: Plot ─────────────────────────────────────────
    if (!completed.includes("plot")) {
      emitProgress(projectId, {
        totalSteps: 5, completedSteps: 2,
        currentStep: "Architecting plot...",
        startedAt: new Date().toISOString(),
      });

      // Compress world + chars for plot writer (no full JSON — just what plot needs)
      const worldForPlot = this.compressWorldForPlot(worldData);
      const charsForPlot = this.compressCharsForPlot(charData);
      const startMs = Date.now();
      const raw = await this.llm.call("bible_writer", PLOT_WRITER_SYSTEM,
        buildPlotPrompt({ premise: premiseStr, worldSection: worldForPlot, characterSection: charsForPlot, mustHonorBlock: mustHonor }),
        { temperature: 0.8, maxTokens: 8000, jsonSchema: PLOT_WRITER_SCHEMA, abortSignal },
      );
      traces.push(this.makeTrace(project.operationId, "bible_writer", startMs, "plot"));
      plotData = JSON.parse(raw);

      completed.push("plot");
      project.checkpoint.plotData = plotData;
      if (onCheckpoint) await onCheckpoint(project);
    }

    // ── Sub-step 4: Judge (blocking gate) ─────────────────────────
    // Bible judge evaluates consistency AND dramatic quality.
    // If it fails, plot is regenerated with judge feedback (max 2 retries).
    if (!completed.includes("judge")) {
      emitProgress(projectId, {
        totalSteps: 5, completedSteps: 3,
        currentStep: "Judging quality...",
        startedAt: new Date().toISOString(),
      });

      const MAX_JUDGE_RETRIES = 2;
      for (let attempt = 0; attempt <= MAX_JUDGE_RETRIES; attempt++) {
        const startMs = Date.now();
        const judgeRaw = await this.llm.call("bible_judge", BIBLE_JUDGE_SYSTEM,
          buildBibleJudgePrompt({
            worldSection: this.compressWorldForPlot(worldData),
            characterSection: this.compressCharsForPlot(charData),
            plotSection: JSON.stringify(plotData),
            mustHonorBlock: mustHonor,
          }),
          { temperature: 0.3, maxTokens: 2000, jsonSchema: BIBLE_JUDGE_SCHEMA, abortSignal },
        );
        traces.push(this.makeTrace(project.operationId, "bible_judge", startMs, "judge"));

        try {
          const judgeResult = JSON.parse(judgeRaw);

          // Collect critical/major issues that warrant regeneration
          const criticalIssues = [
            ...(judgeResult.consistency_issues ?? []).filter((i: any) => i.severity === "critical"),
            ...(judgeResult.quality_issues ?? []).filter((i: any) => i.severity === "critical" || i.severity === "major"),
          ];

          if (judgeResult.pass || criticalIssues.length === 0 || attempt === MAX_JUDGE_RETRIES) {
            if (criticalIssues.length > 0) {
              console.warn(`[v2] Bible judge failed but max retries reached (${attempt}). Issues:`,
                JSON.stringify(criticalIssues.map((i: any) => i.issue)).slice(0, 500));
            }
            break; // Accept output (either passed or exhausted retries)
          }

          // Regenerate plot with judge feedback
          console.log(`[v2] Bible judge failed (attempt ${attempt + 1}/${MAX_JUDGE_RETRIES + 1}). Regenerating plot...`);
          const feedback = criticalIssues.map((i: any) => `- [${i.severity}] ${i.issue}: ${i.fix_instruction}`).join("\n");

          emitProgress(projectId, {
            totalSteps: 5, completedSteps: 2,
            currentStep: `Revising plot (attempt ${attempt + 2})...`,
            startedAt: new Date().toISOString(),
          });

          // Remove plot from completed to force regeneration
          const plotIdx = completed.indexOf("plot");
          if (plotIdx !== -1) completed.splice(plotIdx, 1);

          const worldForPlot = this.compressWorldForPlot(worldData);
          const charsForPlot = this.compressCharsForPlot(charData);
          const regenStartMs = Date.now();
          const plotPrompt = buildPlotPrompt({
            premise: premiseStr, worldSection: worldForPlot,
            characterSection: charsForPlot, mustHonorBlock: mustHonor,
          });
          const augmentedPrompt = plotPrompt + `\n\nPREVIOUS ATTEMPT FAILED QUALITY REVIEW. Fix these issues:\n${feedback}`;

          const regenRaw = await this.llm.call("bible_writer", PLOT_WRITER_SYSTEM, augmentedPrompt,
            { temperature: 0.8, maxTokens: 8000, jsonSchema: PLOT_WRITER_SCHEMA, abortSignal },
          );
          traces.push(this.makeTrace(project.operationId, "bible_writer", regenStartMs, "plot"));
          plotData = JSON.parse(regenRaw);

          completed.push("plot");
          project.checkpoint.plotData = plotData;
          if (onCheckpoint) await onCheckpoint(project);
        } catch {
          console.warn("[v2] Bible judge parse failed, accepting output as-is");
          break;
        }
      }

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

      // Step-back prompt: force architectural thinking before scene distribution
      const bibleCompressed = this.compressBibleForPlanner(worldData, charData, plotData);
      let architecturalContext = "";
      try {
        const stepBackStartMs = Date.now();
        const stepBackRaw = await this.llm.call("scene_planner", `You are a story architect. Answer these questions briefly and precisely — one sentence each. Do not plan scenes yet. Just think about the story's shape.`, [
          `STORY BIBLE:\n${bibleCompressed}`,
          `\nAnswer these questions:`,
          `1. What is the ONE dramatic question this story must answer by the end?`,
          `2. What is the point of no return — the moment where the protagonist cannot go back to who they were?`,
          `3. Which relationship is the engine of the story? Where must that relationship be at the midpoint versus the climax?`,
          `4. What is the one scene the reader will remember a week later? What makes it unforgettable — a revelation, a betrayal, a silence, a choice?`,
          `5. Where should the story's emotional register BREAK — the moment that is tonally different from everything around it?`,
        ].join("\n"), {
          temperature: 0.5,
          maxTokens: 800,
          abortSignal,
        });
        traces.push(this.makeTrace(project.operationId, "scene_planner", stepBackStartMs, "step_back"));
        architecturalContext = `\nSTORY ARCHITECTURE (think about these while planning):\n${stepBackRaw}\n`;
        console.log(`[v2] Step-back architectural context: ${stepBackRaw.slice(0, 200)}...`);
      } catch (err: any) {
        // Non-fatal — scene planner can work without it
        console.warn(`[v2] Step-back prompt failed (${err.message}), proceeding without architectural context`);
      }

      const startMs = Date.now();
      const raw = await this.llm.call("scene_planner", SCENE_PLANNER_SYSTEM,
        buildScenePlannerPrompt({ bibleCompressed, mustHonorBlock: mustHonor }) + architecturalContext,
        { temperature: 0.7, maxTokens: 6000, jsonSchema: SCENE_PLANNER_SCHEMA, abortSignal },
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
        dirty_hands: plotData?.dirty_hands ?? undefined,
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

  /** Compress world to just what the plot writer needs: locations, rules, factions, thesis */
  private compressWorldForPlot(world: any): string {
    if (!world) return "(world not available)";
    const parts = [
      `Thesis: ${world.world_thesis ?? ""}`,
      `Locations: ${(world.arena?.locations ?? []).map((l: any) => l.name).join(", ")}`,
      `Rules: ${(world.rules ?? []).map((r: any) => r.rule).join("; ")}`,
      `Factions: ${(world.factions ?? []).map((f: any) => `${f.name}: ${f.goal}`).join("; ")}`,
    ];
    return parts.join("\n");
  }

  /** Compress characters to just what the plot writer needs: want, misbelief, relationships */
  private compressCharsForPlot(chars: any): string {
    if (!chars) return "(characters not available)";
    const parts: string[] = [];
    for (const c of (chars.characters ?? [])) {
      const pp = c.psychological_profile ?? {};
      parts.push(`${c.name} (${c.role}): wants ${pp.want ?? "?"}; misbelieves ${pp.misbelief ?? "?"}; breaks when ${pp.break_point ?? "?"}`);
    }
    if (chars.relationships?.length) {
      parts.push("");
      for (const r of chars.relationships) {
        parts.push(`${(r.between ?? []).join(" + ")}: ${r.nature} (stated: ${r.stated_dynamic}; true: ${r.true_dynamic})`);
      }
    }
    return parts.join("\n");
  }

  private compressBibleForPlanner(world: any, chars: any, plot: any): string {
    const parts: string[] = [];

    if (world) {
      parts.push("WORLD:");
      parts.push(`  Thesis: ${world.world_thesis}`);
      parts.push("  LOCATIONS:");
      for (const loc of (world.arena?.locations ?? [])) {
        parts.push(`    ${loc.name}: ${(loc.description ?? "").slice(0, 80)}`);
        if (loc.affordances?.length) {
          parts.push(`      Affordances: ${loc.affordances.join("; ")}`);
        }
      }
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
