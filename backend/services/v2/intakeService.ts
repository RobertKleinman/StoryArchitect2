/**
 * v2 Intake Service — Step 1: Get the Idea
 *
 * Single conversational intake: user describes their story idea,
 * system asks 1-2 targeted questions to nail down genre, tone,
 * and core "what if." Max 2 turns before readiness.
 */

import { createHash } from "crypto";
import type { Step1_IdeaGathering, IntakeTurn, StepTrace, OperationId } from "../../../shared/types/project";
import { createOperationId } from "../../../shared/types/project";
import type { IntakeResponse } from "../../../shared/types/apiV2";
import { LLMClient } from "../llmClient";
import { recordSignals, formatPsychologyLedgerForPrompt } from "../psychologyEngine";
import { buildMustHonorBlock } from "../mustHonorBlock";
import type { ConstraintLedgerEntry } from "../../../shared/types/hook";
import { INTAKE_SYSTEM_PROMPT, buildIntakeUserPrompt } from "./prompts/intakePrompts";
import { INTAKE_SCHEMA } from "./schemas/premiseSchemas";

interface IntakeLLMResponse {
  question?: string;
  assumptions: Array<{
    id: string;
    category: string;
    assumption: string;
    alternatives: string[];
  }>;
  readyForPremise: boolean;
  readiness_note: string;
  raw_signals?: Array<{
    hypothesis: string;
    category: string;
    evidence: string;
  }>;
  constraint_updates?: Array<{
    key: string;
    value: string;
    source: string;
  }>;
}

export class IntakeService {
  constructor(private llm: LLMClient) {}

  async runTurn(
    project: Step1_IdeaGathering,
    userInput: string,
    assumptionResponses?: Array<{ assumptionId: string; action: "keep" | "change"; newValue?: string }>,
  ): Promise<{ response: IntakeResponse; updatedProject: Step1_IdeaGathering }> {
    const turnNumber = project.conversationTurns.length + 1;

    // Update constraint ledger from assumption responses
    if (assumptionResponses) {
      for (const ar of assumptionResponses) {
        const entry: ConstraintLedgerEntry = {
          key: ar.assumptionId,
          value: ar.action === "change" ? (ar.newValue ?? "") : ar.assumptionId,
          source: ar.action === "change" ? "user_changed_assumption" : "user_kept_assumption",
          confidence: "confirmed",
          turnNumber,
        };
        project.constraintLedger.push(entry);
      }
    }

    // Update constraint ledger from user free text
    if (userInput && turnNumber === 1 && !project.seedInput) {
      project.seedInput = userInput;
    }

    // Build prompt
    const psychBlock = formatPsychologyLedgerForPrompt(project.psychologyLedger);
    const mustHonor = buildMustHonorBlock(project.constraintLedger);
    const userPrompt = buildIntakeUserPrompt({
      seedInput: project.seedInput ?? userInput,
      userInput,
      turnNumber,
      conversationHistory: project.conversationTurns,
      psychologyBlock: psychBlock,
      mustHonorBlock: mustHonor,
      culturalContext: project.culturalContext,
    });

    // LLM call
    const startMs = Date.now();
    const rawResponse = await this.llm.call("intake", INTAKE_SYSTEM_PROMPT, userPrompt, {
      temperature: 0.7,
      maxTokens: 2000,
      jsonSchema: INTAKE_SCHEMA,
    });
    const durationMs = Date.now() - startMs;

    // Parse response
    let parsed: IntakeLLMResponse;
    try {
      parsed = JSON.parse(rawResponse);
    } catch {
      throw new Error(`Failed to parse intake LLM response: ${rawResponse.slice(0, 200)}`);
    }

    // Force readiness after 2 turns (hard cap)
    if (turnNumber >= 2 && !parsed.readyForPremise) {
      parsed.readyForPremise = true;
      parsed.readiness_note = "Maximum intake turns reached — proceeding with available context.";
    }

    // Record psychology signals (map to full RawSignalObservation format)
    if (parsed.raw_signals && parsed.raw_signals.length > 0) {
      const fullSignals = parsed.raw_signals.map(s => ({
        hypothesis: s.hypothesis,
        action: s.evidence,
        valence: "supports" as const,
        scope: "this_story" as const,
        category: (s.category || "content_preferences") as any,
        adaptationConsequence: "Adjust tone and content to match observed preference",
        contradictionCriteria: `User explicitly states the opposite of: ${s.hypothesis}`,
      }));
      const defaultBehavior = {
        orientation: "Initial intake",
        currentFocus: "story concept",
        engagementMode: "exploring" as const,
        satisfaction: { score: 0.5, trend: "stable" as const, reason: "Initial turn" },
      };
      const defaultAdaptation = {
        dominantNeed: "Understand user's story concept",
        moves: [{
          action: "Gather enough detail for premise generation",
          drivenBy: [] as string[],
          target: "question" as const,
        }],
      };
      recordSignals(
        project.psychologyLedger,
        turnNumber,
        "hook",
        fullSignals,
        defaultBehavior,
        defaultAdaptation,
      );
    }

    // Update constraint ledger from LLM-inferred constraints
    if (parsed.constraint_updates) {
      for (const cu of parsed.constraint_updates) {
        const existing = project.constraintLedger.find(e => e.key === cu.key);
        if (!existing) {
          project.constraintLedger.push({
            key: cu.key,
            value: cu.value,
            source: "llm_inferred",
            confidence: "inferred",
            turnNumber,
          });
        }
      }
    }

    // Build turn record
    const turn: IntakeTurn = {
      turnNumber,
      userInput,
      systemResponse: {
        question: parsed.question,
        assumptions: parsed.assumptions ?? [],
        readyForPremise: parsed.readyForPremise,
        readiness_note: parsed.readiness_note,
      },
    };
    project.conversationTurns.push(turn);

    // Log trace
    const trace: StepTrace = {
      operationId: createOperationId(`intake_t${turnNumber}`),
      role: "intake",
      templateVersion: createHash("sha256").update(INTAKE_SYSTEM_PROMPT).digest("hex").slice(0, 16),
      schemaVersion: 1,
      model: (this.llm.getConfig() as any).intake ?? "unknown",
      provider: "unknown",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      durationMs,
      retryCount: 0,
      timestamp: new Date().toISOString(),
    };
    project.traces.push(trace);

    project.updatedAt = new Date().toISOString();

    const response: IntakeResponse = {
      question: parsed.question,
      assumptions: parsed.assumptions ?? [],
      readyForPremise: parsed.readyForPremise,
      readiness_note: parsed.readiness_note,
      turnNumber,
    };

    return { response, updatedProject: project };
  }
}
