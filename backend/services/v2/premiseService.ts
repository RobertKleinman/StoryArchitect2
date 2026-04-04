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
import { getForcingFunctions, formatForcingBlock } from "../../../shared/narrativeForcingFunctions";

// ── Deterministic Tone Chip Scrubber (erotica only) ──────────────

// Words that describe content, not mood — strip from multi-word chips
const PURPLE_WORDS = new Set([
  // Content descriptors (describe what's in the story, not how it feels)
  "fetishistic", "fetish", "erotic", "eroticism", "pornographic",
  "sexual", "sensual", "sensuality", "carnal", "lustful", "orgasmic",
  "seduction", "seductive", "arousal", "aroused",
  "foot", "feet", "toe", "sole", "barefoot",
  "worship", "submission", "domination",
  // Purple intensifiers
  "exquisite", "intoxicating", "overwhelming", "devastating",
  "scorching", "searing", "blazing", "electrifying",
  "delicious", "sumptuous", "luscious", "tantalizing",
  "feverish", "primal", "visceral",
  // Vague space-filler
  "cosmic", "galactic", "stellar", "interstellar", "nebular", "celestial",
]);

// Chips that are entirely content — drop completely
const DROP_CHIPS = new Set([
  "erotic", "eroticism", "fetish", "kink", "smut",
  "foot worship", "toe sucking", "sensuality", "seduction",
  "erotic tension", "erotic anticipation",
  "foot-focused", "toe-focused",
]);

export function scrubToneChips(chips: string[]): string[] {
  const result: string[] = [];
  for (const chip of chips) {
    const lower = chip.toLowerCase().trim();
    if (DROP_CHIPS.has(lower)) continue;

    const words = chip.split(/\s+/);
    const cleaned = words.filter(w => !PURPLE_WORDS.has(w.toLowerCase().replace(/[^a-z]/g, "")));
    if (cleaned.length === 0) continue;
    const scrubbed = cleaned.join(" ");

    if (!result.some(r => r.toLowerCase() === scrubbed.toLowerCase())) {
      result.push(scrubbed);
    }
  }
  return result;
}

export class PremiseService {
  constructor(private llm: LLMClient) {}

  /**
   * Step 2: Generate premise from intake conversation.
   * Single writer call + single judge call. If judge fails, one repair attempt.
   */
  async generate(
    project: Step2_PremiseGenerating,
    culturalBrief?: string,
    options?: { skipJudge?: boolean },
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

    const forcingBlock = formatForcingBlock(getForcingFunctions(project.mode, "premise"));
    const writerPrompt = buildPremiseWriterPrompt({
      seedInput: project.seedInput,
      conversationTurns: project.conversationTurns,
      constraintBlock: this.formatConstraints(project.constraintLedger),
      mustHonorBlock: mustHonor,
      culturalBrief,
      psychologyBlock: psychBlock,
      forcingBlock,
      mode: project.mode,
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

    // ── Judge call (skipped in fast mode) ─────────────────────────
    if (!options?.skipJudge) {
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
        maxTokens: 800,
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
          mode: project.mode,
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
    }

    // ── Deterministic post-generation scrubs (erotica only) ─────
    const isErotica = project.mode?.startsWith("erotica");
    if (isErotica) {
      // Gender enforcement: detect orientation from seed, fix any mismatches
      const seedLower = (project.seedInput + " " + (premiseData.hook_sentence ?? "")).toLowerCase();
      let requiredPresentation: string | undefined;
      if (/\bgay\s+m(ale|en)\b|\ball[- ]male\b|\bmen\s+only\b/.test(seedLower)) {
        requiredPresentation = "masculine";
      } else if (/\blesbian\b|\bgay\s+female\b|\ball[- ]female\b|\bwomen\s+only\b/.test(seedLower)) {
        requiredPresentation = "feminine";
      }
      if (requiredPresentation && premiseData.characters_sketch) {
        for (const c of premiseData.characters_sketch) {
          const pres = (c.presentation ?? "").toLowerCase();
          if (pres && pres !== requiredPresentation && pres !== "unspecified") {
            console.log(`[premise] Gender fix: ${c.name} presentation "${c.presentation}" → "${requiredPresentation}"`);
            c.presentation = requiredPresentation;
          }
        }
      }

      // Tone chip scrub: remove purple/fetish adjectives, keep mood words
      if (premiseData.tone_chips) {
        premiseData.tone_chips = scrubToneChips(premiseData.tone_chips);
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
      mode: project.mode,
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
