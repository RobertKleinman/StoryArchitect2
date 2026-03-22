/**
 * v2 Premise Service — Steps 2-3: Generate + Review Premise
 *
 * Step 2: Generate premise from intake conversation (1 writer + 1 judge call)
 * Step 3: Handle user review and revisions (0-3 revision calls)
 */

import { createHash } from "crypto";
import type { Step2_PremiseGenerating, Step3_PremiseReview, StepTrace } from "../../../shared/types/project";
import { createOperationId } from "../../../shared/types/project";
import type { PremiseArtifact } from "../../../shared/types/artifacts";
import { LLMClient } from "../llmClient";
import { buildMustHonorBlock } from "../mustHonorBlock";
import { formatPsychologyLedgerForPrompt } from "../psychologyEngine";
import {
  PREMISE_WRITER_SYSTEM, buildPremiseWriterPrompt,
  PREMISE_JUDGE_SYSTEM, buildPremiseJudgePrompt,
} from "./prompts/premisePrompts";
import { PREMISE_WRITER_SCHEMA, PREMISE_JUDGE_SCHEMA } from "./schemas/premiseSchemas";
import { emitProgress } from "./progressEmitter";
import { getAbortSignal } from "./orchestrator";

export class PremiseService {
  constructor(private llm: LLMClient) {}

  /**
   * Step 2: Generate premise from intake conversation.
   * Single writer call + single judge call. If judge fails, one repair attempt.
   */
  async generate(
    project: Step2_PremiseGenerating,
    culturalBrief?: string,
  ): Promise<{ premise: PremiseArtifact; traces: StepTrace[] }> {
    const projectId = project.projectId as string;
    const abortSignal = getAbortSignal(projectId);
    const traces: StepTrace[] = [];
    const mustHonor = buildMustHonorBlock(project.constraintLedger);
    const psychBlock = formatPsychologyLedgerForPrompt(project.psychologyLedger);

    // ── Writer call ──────────────────────────────────────────────
    emitProgress(projectId, {
      totalSteps: 2,
      completedSteps: 0,
      currentStep: "Writing premise...",
      startedAt: new Date().toISOString(),
    });

    const writerPrompt = buildPremiseWriterPrompt({
      seedInput: project.seedInput,
      conversationTurns: project.conversationTurns,
      constraintBlock: this.formatConstraints(project.constraintLedger),
      mustHonorBlock: mustHonor,
      culturalBrief,
      psychologyBlock: psychBlock,
    });

    const startMs = Date.now();
    const writerRaw = await this.llm.call("premise_writer", PREMISE_WRITER_SYSTEM, writerPrompt, {
      temperature: 0.8,
      maxTokens: 3000,
      jsonSchema: PREMISE_WRITER_SCHEMA,
      abortSignal,
    });
    traces.push(this.makeTrace(project.operationId, "premise_writer", startMs));

    let premiseData: any;
    try {
      premiseData = JSON.parse(writerRaw);
    } catch {
      throw new Error(`Failed to parse premise writer output: ${writerRaw.slice(0, 200)}`);
    }

    // ── Judge call ───────────────────────────────────────────────
    emitProgress(projectId, {
      totalSteps: 2,
      completedSteps: 1,
      currentStep: "Evaluating premise...",
      startedAt: new Date().toISOString(),
    });

    const judgePrompt = buildPremiseJudgePrompt({
      premise: JSON.stringify(premiseData, null, 2),
      mustHonorBlock: mustHonor,
    });

    const judgeStartMs = Date.now();
    const judgeRaw = await this.llm.call("premise_judge", PREMISE_JUDGE_SYSTEM, judgePrompt, {
      temperature: 0.3,
      maxTokens: 1500,
      jsonSchema: PREMISE_JUDGE_SCHEMA,
      abortSignal,
    });
    traces.push(this.makeTrace(project.operationId, "premise_judge", judgeStartMs));

    let judgeResult: any;
    try {
      judgeResult = JSON.parse(judgeRaw);
    } catch {
      // Judge parse failure — accept premise as-is
      judgeResult = { pass: true, issues: [], constraint_violations: [] };
    }

    // ── Repair if judge failed ───────────────────────────────────
    if (!judgeResult.pass && judgeResult.issues?.length > 0) {
      const repairPrompt = buildPremiseWriterPrompt({
        seedInput: project.seedInput,
        conversationTurns: project.conversationTurns,
        constraintBlock: this.formatConstraints(project.constraintLedger),
        mustHonorBlock: mustHonor,
        culturalBrief,
        psychologyBlock: psychBlock,
        revisionFeedback: judgeResult.issues.map((i: any) => `${i.field}: ${i.fix_instruction}`).join("\n"),
        currentPremise: JSON.stringify(premiseData, null, 2),
      });

      const repairStartMs = Date.now();
      const repairRaw = await this.llm.call("premise_writer", PREMISE_WRITER_SYSTEM, repairPrompt, {
        temperature: 0.7,
        maxTokens: 3000,
        jsonSchema: PREMISE_WRITER_SCHEMA,
        abortSignal,
      });
      traces.push(this.makeTrace(project.operationId, "premise_writer", repairStartMs, "fail_repaired"));

      try {
        premiseData = JSON.parse(repairRaw);
      } catch {
        // Repair parse failure — keep original
      }
    }

    const premise: PremiseArtifact = {
      state: "draft",
      operationId: project.operationId,
      hook_sentence: premiseData.hook_sentence,
      emotional_promise: premiseData.emotional_promise,
      premise_paragraph: premiseData.premise_paragraph,
      synopsis: premiseData.synopsis,
      tone_chips: premiseData.tone_chips ?? [],
      bans: premiseData.bans ?? [],
      setting_anchor: premiseData.setting_anchor,
      time_period: premiseData.time_period,
      characters_sketch: premiseData.characters_sketch ?? [],
      core_conflict: premiseData.core_conflict,
      suggested_length: premiseData.suggested_length ?? "medium",
      suggested_cast: premiseData.suggested_cast ?? "small_ensemble",
    };

    return { premise, traces };
  }

  /**
   * Step 3: Revise premise based on user feedback.
   * Single writer call to produce revised version.
   */
  async revise(
    project: Step3_PremiseReview,
    feedback: string,
    inlineEdits?: Record<string, string>,
  ): Promise<{ premise: PremiseArtifact; traces: StepTrace[] }> {
    const projectId = project.projectId as string;
    const abortSignal = getAbortSignal(projectId);
    const traces: StepTrace[] = [];
    const mustHonor = buildMustHonorBlock(project.constraintLedger);

    // Apply inline edits directly if no broader feedback
    if (inlineEdits && !feedback) {
      const updated = { ...project.premise };
      for (const [key, value] of Object.entries(inlineEdits)) {
        if (key in updated) {
          (updated as any)[key] = value;
        }
      }
      updated.state = "draft";
      return { premise: updated, traces };
    }

    // LLM revision
    const currentPremiseStr = JSON.stringify({
      hook_sentence: project.premise.hook_sentence,
      emotional_promise: project.premise.emotional_promise,
      premise_paragraph: project.premise.premise_paragraph,
      synopsis: project.premise.synopsis,
      tone_chips: project.premise.tone_chips,
      setting_anchor: project.premise.setting_anchor,
      characters_sketch: project.premise.characters_sketch,
      core_conflict: project.premise.core_conflict,
    }, null, 2);

    const operationId = createOperationId(`revise_r${project.reviewRound + 1}`);
    const prompt = buildPremiseWriterPrompt({
      seedInput: project.premise.hook_sentence,
      conversationTurns: [],
      constraintBlock: this.formatConstraints(project.constraintLedger),
      mustHonorBlock: mustHonor,
      revisionFeedback: feedback,
      currentPremise: currentPremiseStr,
    });

    const startMs = Date.now();
    const raw = await this.llm.call("premise_writer", PREMISE_WRITER_SYSTEM, prompt, {
      temperature: 0.7,
      maxTokens: 3000,
      jsonSchema: PREMISE_WRITER_SCHEMA,
      abortSignal,
    });
    traces.push(this.makeTrace(operationId, "premise_writer", startMs));

    let premiseData: any;
    try {
      premiseData = JSON.parse(raw);
    } catch {
      throw new Error(`Failed to parse revision output: ${raw.slice(0, 200)}`);
    }

    const premise: PremiseArtifact = {
      state: "draft",
      operationId,
      hook_sentence: premiseData.hook_sentence,
      emotional_promise: premiseData.emotional_promise,
      premise_paragraph: premiseData.premise_paragraph,
      synopsis: premiseData.synopsis,
      tone_chips: premiseData.tone_chips ?? project.premise.tone_chips,
      bans: premiseData.bans ?? project.premise.bans,
      setting_anchor: premiseData.setting_anchor,
      time_period: premiseData.time_period ?? project.premise.time_period,
      characters_sketch: premiseData.characters_sketch ?? project.premise.characters_sketch,
      core_conflict: premiseData.core_conflict,
      suggested_length: premiseData.suggested_length ?? project.premise.suggested_length,
      suggested_cast: premiseData.suggested_cast ?? project.premise.suggested_cast,
    };

    return { premise, traces };
  }

  // ── Helpers ─────────────────────────────────────────────────────

  private formatConstraints(ledger: any[]): string {
    if (!ledger || ledger.length === 0) return "";
    return ledger
      .filter(e => e.confidence === "confirmed")
      .map(e => `${e.key}: ${e.value}`)
      .join("\n");
  }

  private makeTrace(
    operationId: any,
    role: string,
    startMs: number,
    judgeOutcome?: StepTrace["judgeOutcome"],
  ): StepTrace {
    return {
      operationId,
      role,
      templateVersion: createHash("sha256").update(role).digest("hex").slice(0, 16),
      schemaVersion: 1,
      model: "unknown", // filled by caller if needed
      provider: "unknown",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      durationMs: Date.now() - startMs,
      judgeOutcome,
      retryCount: 0,
      timestamp: new Date().toISOString(),
    };
  }
}
