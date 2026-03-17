/**
 * Cultural Intelligence Engine — Research Service
 *
 * Orchestrates cultural research for module clarifiers and builders.
 * Runs during user think-time (like divergenceExplorer), caches results,
 * and provides formatted context blocks for prompt injection.
 *
 * Integration: each module service calls this from its buildClarifierPrompt()
 * and buildBuilderPrompt() methods.
 */

import type { LLMClient } from "./llmClient";
import type { CulturalStore } from "../storage/culturalStore";
import type {
  CulturalBrief,
  CulturalModule,
  ResearchContract,
  EvidenceItem,
  CreativeApplication,
  CulturalProposal,
  CulturalDecisionLedger,
} from "../../shared/types/cultural";
import {
  CULTURAL_SUMMARIZER_SYSTEM,
  CULTURAL_SUMMARIZER_USER_TEMPLATE,
  CULTURAL_RESEARCHER_SYSTEM,
  CULTURAL_RESEARCHER_USER_TEMPLATE,
  CULTURAL_CONTEXT_CLARIFIER_HEADER,
  CULTURAL_CONTEXT_BUILDER_HEADER,
} from "./culturalPrompts";
import {
  RESEARCH_CONTRACT_SCHEMA,
  CULTURAL_BRIEF_SCHEMA,
} from "./culturalSchemas";

// ── Context needed to generate a brief ──

export interface CulturalResearchContext {
  projectId: string;
  module: CulturalModule;
  turnNumber: number;
  // Upstream locked packs (JSON-stringified summaries, NOT full packs)
  lockedPacksSummary: string;
  // Current module state
  currentState: Record<string, unknown>;
  constraintLedger: string;
  // Psychology
  psychologySummary: string;
  // User-named references detected in free-text input
  directedReferences: string[];
}

export class CulturalResearchService {
  constructor(
    private store: CulturalStore,
    private llm: LLMClient,
  ) {}

  /**
   * Get or generate a cultural brief for a clarifier turn.
   * Returns null if the engine decides not to run (e.g., too early, no signal).
   *
   * This is the main entry point called by module services.
   */
  async getBriefForClarifier(
    context: CulturalResearchContext,
  ): Promise<CulturalBrief | null> {
    // Feature flag check
    if (!process.env.ENABLE_CULTURAL_ENGINE) return null;

    // Turn 1 is fine — the seed input alone provides rich cultural research signal

    // Check cache
    const cached = await this.store.getCachedBrief(
      context.projectId,
      context.module,
      context.turnNumber,
    );
    if (cached) return cached;

    // Generate new brief
    return this.generateBrief(context);
  }

  /**
   * Get the cached brief for a builder prompt.
   * Does NOT generate a new one — the clarifier phase should have generated it.
   * Returns null if no cached brief exists.
   */
  async getBriefForBuilder(
    projectId: string,
    module: CulturalModule,
    turnNumber: number,
  ): Promise<CulturalBrief | null> {
    // Feature flag check
    if (!process.env.ENABLE_CULTURAL_ENGINE) return null;

    return this.store.getCachedBrief(projectId, module, turnNumber);
  }

  /**
   * Fire-and-forget: generate a brief in the background during user think-time.
   * Called after a clarifier turn completes (alongside divergence and consolidation).
   * If the brief finishes before the user's next submission, the NEXT clarifier
   * turn gets cultural context. If not, no harm.
   */
  async fireBackgroundResearch(context: CulturalResearchContext): Promise<void> {
    // Feature flag check
    if (!process.env.ENABLE_CULTURAL_ENGINE) return;

    try {
      await this.generateBrief(context);
    } catch (err) {
      console.error("[CULTURAL] Background research failed:", err);
    }
  }

  /**
   * Format a brief as a prompt-injectable block for a clarifier.
   * Returns empty string if no brief available.
   */
  formatBriefForClarifier(brief: CulturalBrief | null): string {
    if (!brief) return "";
    return this.formatBrief(brief, CULTURAL_CONTEXT_CLARIFIER_HEADER);
  }

  /**
   * Format a brief as a prompt-injectable block for a builder.
   * Returns empty string if no brief available.
   */
  formatBriefForBuilder(brief: CulturalBrief | null): string {
    if (!brief) return "";
    return this.formatBrief(brief, CULTURAL_CONTEXT_BUILDER_HEADER);
  }

  /**
   * Get the decision ledger for a project.
   */
  async getDecisionLedger(projectId: string): Promise<CulturalDecisionLedger> {
    return this.store.getLedger(projectId);
  }

  // ── Private ──

  private async generateBrief(
    context: CulturalResearchContext,
  ): Promise<CulturalBrief | null> {
    try {
      // Step 1: Generate research contract (compress creative state)
      const ledger = await this.store.getLedger(context.projectId);
      const previousBriefSummaries = ledger.decisions
        .slice(-5)
        .map(d => d.offered)
        .join("; ");

      const contractPrompt = CULTURAL_SUMMARIZER_USER_TEMPLATE
        .replace("{{LOCKED_PACKS}}", context.lockedPacksSummary || "(none locked yet)")
        .replace("{{MODULE}}", context.module)
        .replace("{{CURRENT_STATE}}", JSON.stringify(context.currentState, null, 2))
        .replace("{{CONSTRAINT_LEDGER}}", context.constraintLedger)
        .replace("{{PSYCHOLOGY_SUMMARY}}", context.psychologySummary || "(no psychology data yet)")
        .replace("{{DIRECTED_REFERENCES}}", context.directedReferences.length > 0
          ? context.directedReferences.join("\n")
          : "(none)")
        .replace("{{PREVIOUS_BRIEF_SUMMARIES}}", previousBriefSummaries || "(first research)")
        .replace("{{NEGATIVE_PROFILE}}", ledger.negativeProfile.length > 0
          ? ledger.negativeProfile.join("\n")
          : "(none)");

      const contractRaw = await this.llm.call(
        "cultural_summarizer",
        CULTURAL_SUMMARIZER_SYSTEM,
        contractPrompt,
        {
          temperature: 0.3,  // Low temp for accurate summarization
          maxTokens: 1500,
          jsonSchema: RESEARCH_CONTRACT_SCHEMA,
        },
      );

      const contract = JSON.parse(contractRaw) as ResearchContract;

      // Step 2: Run cultural researcher with the contract
      const researchPrompt = CULTURAL_RESEARCHER_USER_TEMPLATE
        .replace("{{STORY_ESSENCE}}", contract.storyEssence)
        .replace("{{EMOTIONAL_CORE}}", contract.emotionalCore)
        .replace("{{CONFIRMED_ELEMENTS}}", contract.confirmedElements.join("\n") || "(none)")
        .replace("{{OPEN_QUESTIONS}}", contract.openQuestions.join("\n") || "(none)")
        .replace("{{USER_STYLE_SIGNALS}}", contract.userStyleSignals.join("\n") || "(none)")
        .replace("{{DIRECTED_REFERENCES}}", contract.directedReferences.join("\n") || "(none)")
        .replace("{{NEGATIVE_PROFILE}}", contract.negativeProfile.join("\n") || "(none)")
        .replace("{{MODULE}}", context.module)
        .replace("{{TURN_NUMBER}}", String(context.turnNumber));

      const researchRaw = await this.llm.call(
        "cultural_researcher",
        CULTURAL_RESEARCHER_SYSTEM,
        researchPrompt,
        {
          temperature: 0.8,  // Higher temp for creative research
          maxTokens: 4096,
          jsonSchema: CULTURAL_BRIEF_SCHEMA,
        },
      );

      const parsed = JSON.parse(researchRaw);

      // Step 3: Package into CulturalBrief
      const briefId = `cb_${context.module}_${context.turnNumber}_${Date.now()}`;
      const brief: CulturalBrief = {
        id: briefId,
        projectId: context.projectId,
        module: context.module,
        generatedAt: new Date().toISOString(),
        afterTurn: context.turnNumber,
        evidenceBrief: {
          items: (parsed.evidenceItems ?? []) as EvidenceItem[],
          searchDimensions: (parsed.searchDimensions ?? []) as string[],
          negativeProfile: ledger.negativeProfile,
        },
        creativeApplications: (parsed.creativeApplications ?? []) as CreativeApplication[],
        proposals: (parsed.proposals ?? []).map((p: any, i: number) => ({
          id: `cp_${briefId}_${i}`,
          ...p,
        })) as CulturalProposal[],
      };

      // Step 4: Cache
      await this.store.saveBrief(brief);

      return brief;
    } catch (err) {
      console.error("[CULTURAL] Brief generation failed:", err);
      return null;
    }
  }

  private formatBrief(brief: CulturalBrief, header: string): string {
    const lines: string[] = [header, ""];

    // Evidence items
    if (brief.evidenceBrief.items.length > 0) {
      lines.push("EVIDENCE:");
      for (const item of brief.evidenceBrief.items) {
        lines.push(`  [${item.sourceFamily}/${item.confidence}] ${item.claim}`);
        lines.push(`    Detail: ${item.specificDetail}`);
        lines.push(`    Story dimension: ${item.storyDimension}`);
      }
      lines.push("");
    }

    // Creative applications
    if (brief.creativeApplications.length > 0) {
      lines.push("CREATIVE APPLICATIONS:");
      for (const app of brief.creativeApplications) {
        lines.push(`  [${app.mode}] ${app.connection}`);
        lines.push(`    Suggested use: ${app.suggestedUse}`);
        if (app.antiDerivative) {
          lines.push(`    ⚠ DERIVATIVE RISK: ${app.antiDerivative}`);
        }
      }
      lines.push("");
    }

    // Proactive proposals (clarifier only)
    if (brief.proposals.length > 0) {
      lines.push("PROACTIVE PROPOSALS (consider surfacing as options if they fit this moment):");
      for (const p of brief.proposals) {
        lines.push(`  [${p.confidence}] ${p.connection}`);
        lines.push(`    Evidence: ${p.evidence}`);
        lines.push(`    As option: ${p.suggestedOption}`);
      }
      lines.push("");
    }

    // Negative profile
    if (brief.evidenceBrief.negativeProfile.length > 0) {
      lines.push(`AVOID (user has rejected): ${brief.evidenceBrief.negativeProfile.join(", ")}`);
    }

    return lines.join("\n");
  }
}

// ── Throttling helper ──

/**
 * Determine whether cultural research should fire after this turn.
 * Follows the same pattern as backgroundThrottling.ts.
 *
 * Fires when:
 * - Turn >= 2 (need some creative state)
 * - User typed free text OR assumption was changed OR every 3rd turn
 * - No cached brief exists for this turn (avoid redundant work)
 */
export interface CulturalThrottlingInfo {
  turnNumber: number;
  userSelection?: { type: string } | null;
  hasCachedBrief: boolean;
}

export function shouldRunCulturalResearch(info: CulturalThrottlingInfo): boolean {
  if (info.hasCachedBrief) return false;

  // Turn 1: always fire — seed input is the richest moment for cultural grounding
  if (info.turnNumber <= 1) return true;

  const meaningfulInput = info.userSelection?.type === "free_text";
  const cadenceFallback = info.turnNumber % 3 === 0;

  return meaningfulInput || cadenceFallback;
}

// ── Directed reference detector ──

/**
 * Detect explicit cultural references in user free-text input.
 * Looks for patterns like "looks like X", "similar to X", "inspired by X",
 * "like in X", "structure of X", "based on X", quoted proper nouns, etc.
 *
 * Returns array of detected reference strings.
 */
export function detectDirectedReferences(userText: string): string[] {
  if (!userText || userText.length < 5) return [];

  const references: string[] = [];

  // Pattern: "looks like X", "similar to X", "inspired by X", "based on X",
  //          "like in X", "structure of X", "reminds me of X", "think of X"
  const patterns = [
    /(?:looks?\s+like|similar\s+to|inspired\s+by|based\s+on|like\s+in|structure\s+(?:of|like)|reminds?\s+(?:me\s+)?of|think\s+(?:of|about))\s+["']?([^"'.!?]+?)["']?(?:\.|,|!|\?|$)/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(userText)) !== null) {
      const ref = match[1].trim();
      if (ref.length > 2 && ref.length < 100) {
        references.push(ref);
      }
    }
  }

  // Pattern: quoted proper nouns (potential references)
  const quotedPattern = /["']([A-Z][^"']{2,50})["']/g;
  let match;
  while ((match = quotedPattern.exec(userText)) !== null) {
    references.push(match[1].trim());
  }

  // Deduplicate
  return [...new Set(references)];
}
