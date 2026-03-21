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
import type { RetrievalService } from "./retrievalService";
import type {
  CulturalBrief,
  CulturalModule,
  ResearchContract,
  EvidenceItem,
  CreativeApplication,
  CulturalProposal,
  CulturalDecisionLedger,
  GroundingBrief,
  GroundingItem,
  CreativeInsight,
} from "../../shared/types/cultural";
import {
  CULTURAL_SUMMARIZER_SYSTEM,
  CULTURAL_SUMMARIZER_USER_TEMPLATE,
  CULTURAL_RESEARCHER_SYSTEM,
  CULTURAL_RESEARCHER_USER_TEMPLATE,
  CULTURAL_CONTEXT_CLARIFIER_HEADER,
  CULTURAL_CONTEXT_BUILDER_HEADER,
  GROUNDING_RESEARCHER_SYSTEM,
  GROUNDING_RESEARCHER_USER_TEMPLATE,
  GROUNDING_CONTEXT_CLARIFIER_HEADER,
} from "./culturalPrompts";
import {
  RESEARCH_CONTRACT_SCHEMA,
  CULTURAL_BRIEF_SCHEMA,
  GROUNDING_BRIEF_SCHEMA,
} from "./culturalSchemas";
import { RESEARCH_DIVERSITY_MODEL } from "../../shared/modelConfig";

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
  // User-provided cultural context (articles, cultural moments, current events)
  culturalContext?: string;
}

export class CulturalResearchService {
  constructor(
    private store: CulturalStore,
    private llm: LLMClient,
    private retrieval?: RetrievalService,
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

    // Check cache for this module
    const cached = await this.store.getCachedBrief(
      context.projectId,
      context.module,
      context.turnNumber,
    );
    if (cached) return cached;

    // Cross-module fallback: if this is the first turn of a new module,
    // bridge with the most recent brief from any previous module while
    // generating a fresh one in the background.
    if (context.turnNumber <= 1) {
      const crossModuleBrief = await this.store.getMostRecentBriefAnyModule(context.projectId);
      if (crossModuleBrief) {
        // Use the previous module's brief as a bridge for this turn.
        // The background research (fired after this turn) will generate
        // a module-specific brief that includes the previous evidence as seed.
        return crossModuleBrief;
      }
    }

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
   * Get the cached grounding brief for a clarifier prompt.
   * Returns null if no cached brief or grounding is disabled.
   */
  async getGroundingBriefForClarifier(
    projectId: string,
    module: CulturalModule,
    turnNumber: number,
  ): Promise<GroundingBrief | null> {
    if (!process.env.ENABLE_CULTURAL_ENGINE) return null;
    return this.store.getCachedGroundingBrief(projectId, module, turnNumber);
  }

  /**
   * Format a grounding brief as a prompt-injectable block for a clarifier.
   * Returns empty string if no brief available.
   */
  formatGroundingBriefForClarifier(brief: GroundingBrief | null): string {
    if (!brief || brief.items.length === 0) return "";
    const lines: string[] = [GROUNDING_CONTEXT_CLARIFIER_HEADER, ""];

    for (const item of brief.items) {
      lines.push(`▸ [${item.domain}/${item.confidence}] ${item.reference}`);
      lines.push(`  Relevance: ${item.relevance}`);
      lines.push(`  Narrative fuel: ${item.narrative_fuel}`);
      lines.push("");
    }

    if (brief.thematic_tension) {
      lines.push(`THEMATIC TENSION: ${brief.thematic_tension}`);
    }

    return lines.join("\n");
  }

  /**
   * Get the decision ledger for a project.
   */
  async getDecisionLedger(projectId: string): Promise<CulturalDecisionLedger> {
    return this.store.getLedger(projectId);
  }

  /**
   * Get top accumulated insights for injection into downstream modules.
   * Sorted by times_utilized (descending), then confidence.
   */
  async getTopInsights(projectId: string, limit: number = 5): Promise<CreativeInsight[]> {
    const ledger = await this.store.getInsights(projectId);
    return ledger.insights
      .filter(i => i.status === "active")
      .sort((a, b) => {
        // Sort by utilization count descending, then confidence
        const aUtil = a.times_utilized.filter(Boolean).length;
        const bUtil = b.times_utilized.filter(Boolean).length;
        if (bUtil !== aUtil) return bUtil - aUtil;
        return a.confidence === "high" ? -1 : 1;
      })
      .slice(0, limit);
  }

  /**
   * Format accumulated insights as a prompt-injectable block.
   */
  formatInsightsForPrompt(insights: CreativeInsight[]): string {
    if (insights.length === 0) return "";
    const lines: string[] = [
      "═══ PROJECT-LEVEL CREATIVE INSIGHTS (proven useful — build on these) ═══",
      "",
    ];
    for (const insight of insights) {
      const utilCount = insight.times_utilized.filter(Boolean).length;
      const utilTag = utilCount > 0 ? ` (used ${utilCount}×)` : "";
      lines.push(`▸ [${insight.source}/${insight.domain}] ${insight.claim}${utilTag}`);
      lines.push(`  Fuel: ${insight.narrative_fuel}`);
      lines.push("");
    }
    return lines.join("\n");
  }

  /**
   * Mark insights as utilized by a module (called at lock time).
   */
  async markInsightsUtilized(projectId: string, insightIds: string[]): Promise<void> {
    await this.store.markUtilized(projectId, insightIds);
  }

  // ── Private ──

  private async generateBrief(
    context: CulturalResearchContext,
  ): Promise<CulturalBrief | null> {
    try {
      // Step 1: Generate research contract (compress creative state)
      const ledger = await this.store.getLedger(context.projectId);

      // Build previous research summary: decision history + best evidence from prior modules
      const decisionSummaries = ledger.decisions
        .slice(-5)
        .map(d => d.offered)
        .join("; ");

      // Carry forward key evidence from previous modules so research builds on itself
      let carryForwardEvidence = "";
      const prevModuleBrief = await this.store.getMostRecentBriefAnyModule(context.projectId);
      if (prevModuleBrief && prevModuleBrief.module !== context.module) {
        const topEvidence = prevModuleBrief.evidenceBrief.items
          .filter(item => item.confidence === "high" || item.confidence === "medium")
          .slice(0, 3)
          .map(item => `[${item.sourceFamily}] ${item.claim} — ${item.specificDetail}`)
          .join("\n");
        if (topEvidence) {
          carryForwardEvidence = `\nKey findings from ${prevModuleBrief.module} module (build on these, don't repeat):\n${topEvidence}`;
        }
      }

      // Inject accumulated insights (top 5 by utilization)
      const topInsights = await this.getTopInsights(context.projectId, 5);
      let accumulatedInsightsSection = "";
      if (topInsights.length > 0) {
        const insightLines = topInsights.map(i =>
          `[${i.source}/${i.domain}] ${i.claim} — ${i.narrative_fuel}`
        ).join("\n");
        accumulatedInsightsSection = `\nAccumulated creative insights (proven useful across modules — build on these):\n${insightLines}`;
        // Track injection count
        for (const insight of topInsights) {
          insight.times_injected++;
        }
        const insightsLedger = await this.store.getInsights(context.projectId);
        const idSet = new Set(topInsights.map(i => i.id));
        for (const insight of insightsLedger.insights) {
          if (idSet.has(insight.id)) {
            insight.times_injected++;
          }
        }
        insightsLedger.lastUpdatedAt = new Date().toISOString();
        await this.store.saveInsights(insightsLedger);
      }

      const previousBriefSummaries = (decisionSummaries || "(first research)") + carryForwardEvidence + accumulatedInsightsSection;

      const contractPrompt = CULTURAL_SUMMARIZER_USER_TEMPLATE
        .replace("{{LOCKED_PACKS}}", context.lockedPacksSummary || "(none locked yet)")
        .replace("{{MODULE}}", context.module)
        .replace("{{CURRENT_STATE}}", JSON.stringify(context.currentState, null, 2))
        .replace("{{CONSTRAINT_LEDGER}}", context.constraintLedger)
        .replace("{{PSYCHOLOGY_SUMMARY}}", context.psychologySummary || "(no psychology data yet)")
        .replace("{{DIRECTED_REFERENCES}}", this.buildDirectedReferencesSection(context))
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

      // Step 1b: Run retrieval in parallel (non-blocking)
      let externalSourcesSection = "";
      if (this.retrieval?.isAvailable) {
        try {
          const retrievalResult = await this.retrieval.searchForStoryContext(
            contract.storyEssence,
            contract.emotionalCore,
            contract.openQuestions,
            context.culturalContext,
          );
          externalSourcesSection = this.retrieval.formatSourcesForResearchContract(retrievalResult);
          if (retrievalResult.fallbackReason) {
            console.log(`[RETRIEVAL] Fallback: ${retrievalResult.fallbackReason}`);
          }
        } catch (retrievalErr) {
          console.warn("[RETRIEVAL] Failed (non-fatal, using training data only):", retrievalErr);
        }
      }

      // Step 2: Run cultural researcher AND grounding researcher in parallel
      let researchPrompt = CULTURAL_RESEARCHER_USER_TEMPLATE
        .replace("{{STORY_ESSENCE}}", contract.storyEssence)
        .replace("{{EMOTIONAL_CORE}}", contract.emotionalCore)
        .replace("{{CONFIRMED_ELEMENTS}}", contract.confirmedElements.join("\n") || "(none)")
        .replace("{{OPEN_QUESTIONS}}", contract.openQuestions.join("\n") || "(none)")
        .replace("{{USER_STYLE_SIGNALS}}", contract.userStyleSignals.join("\n") || "(none)")
        .replace("{{DIRECTED_REFERENCES}}", contract.directedReferences.join("\n") || "(none)")
        .replace("{{NEGATIVE_PROFILE}}", contract.negativeProfile.join("\n") || "(none)")
        .replace("{{MODULE}}", context.module)
        .replace("{{TURN_NUMBER}}", String(context.turnNumber));

      let groundingPrompt = GROUNDING_RESEARCHER_USER_TEMPLATE
        .replace("{{STORY_ESSENCE}}", contract.storyEssence)
        .replace("{{EMOTIONAL_CORE}}", contract.emotionalCore)
        .replace("{{CONFIRMED_ELEMENTS}}", contract.confirmedElements.join("\n") || "(none)")
        .replace("{{OPEN_QUESTIONS}}", contract.openQuestions.join("\n") || "(none)")
        .replace("{{NEGATIVE_PROFILE}}", contract.negativeProfile.join("\n") || "(none)")
        .replace("{{MODULE}}", context.module)
        .replace("{{TURN_NUMBER}}", String(context.turnNumber));

      // Inject retrieved external sources into both researcher prompts
      if (externalSourcesSection) {
        researchPrompt += "\n\n" + externalSourcesSection;
        groundingPrompt += "\n\n" + externalSourcesSection;
      }

      // Fire primary + diversity researchers in parallel — same prompts, different models
      const [researchRaw, groundingRaw, culturalDiversityRaw, groundingDiversityRaw] = await Promise.all([
        this.llm.call(
          "cultural_researcher",
          CULTURAL_RESEARCHER_SYSTEM,
          researchPrompt,
          {
            temperature: 0.8,
            maxTokens: 4096,
            jsonSchema: CULTURAL_BRIEF_SCHEMA,
          },
        ),
        this.llm.call(
          "grounding_researcher",
          GROUNDING_RESEARCHER_SYSTEM,
          groundingPrompt,
          {
            temperature: 0.7,
            maxTokens: 2048,
            jsonSchema: GROUNDING_BRIEF_SCHEMA,
          },
        ).catch(err => {
          console.warn("[GROUNDING] Researcher failed (non-fatal):", err);
          return null;
        }),
        // Diversity: cultural researcher with fast cheap model
        this.llm.call(
          "cultural_researcher",
          CULTURAL_RESEARCHER_SYSTEM,
          researchPrompt,
          {
            temperature: 0.8,
            maxTokens: 4096,
            jsonSchema: CULTURAL_BRIEF_SCHEMA,
            modelOverride: RESEARCH_DIVERSITY_MODEL,
          },
        ).catch(err => {
          console.warn("[CULTURAL] Diversity call failed (non-fatal):", err);
          return null;
        }),
        // Diversity: grounding researcher with fast cheap model
        this.llm.call(
          "grounding_researcher",
          GROUNDING_RESEARCHER_SYSTEM,
          groundingPrompt,
          {
            temperature: 0.7,
            maxTokens: 2048,
            jsonSchema: GROUNDING_BRIEF_SCHEMA,
            modelOverride: RESEARCH_DIVERSITY_MODEL,
          },
        ).catch(err => {
          console.warn("[GROUNDING] Diversity call failed (non-fatal):", err);
          return null;
        }),
      ]);

      const parsed = JSON.parse(researchRaw);

      // Merge diversity cultural items (deduplicate by claim similarity)
      if (culturalDiversityRaw) {
        try {
          const diversityParsed = JSON.parse(culturalDiversityRaw);
          const existingClaims = new Set(
            (parsed.evidenceItems ?? []).map((item: any) => item.claim?.toLowerCase().slice(0, 60))
          );
          for (const item of (diversityParsed.evidenceItems ?? [])) {
            const claimKey = item.claim?.toLowerCase().slice(0, 60);
            if (claimKey && !existingClaims.has(claimKey)) {
              parsed.evidenceItems.push(item);
              existingClaims.add(claimKey);
            }
          }
          console.log(`[CULTURAL] Merged diversity items: ${(diversityParsed.evidenceItems ?? []).length} candidates`);
        } catch {
          console.warn("[CULTURAL] Failed to parse diversity output");
        }
      }

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

      // Step 4: Cache cultural brief
      await this.store.saveBrief(brief);

      // Step 4b: Accumulate high-value cultural evidence into insights ledger
      await this.accumulateCulturalInsights(context, brief, ledger);

      // Step 5: Package and cache grounding brief (if it succeeded)
      if (groundingRaw) {
        try {
          const groundingParsed = JSON.parse(groundingRaw);
          const groundingItems = (groundingParsed.groundingItems ?? []).map((item: any) => ({
            ...item,
            source_mode: "stable_memory" as const,
          }));

          // Merge diversity grounding items
          if (groundingDiversityRaw) {
            try {
              const diversityParsed = JSON.parse(groundingDiversityRaw);
              const existingRefs = new Set(
                groundingItems.map((item: any) => item.reference?.toLowerCase().slice(0, 60))
              );
              for (const item of (diversityParsed.groundingItems ?? [])) {
                const refKey = item.reference?.toLowerCase().slice(0, 60);
                if (refKey && !existingRefs.has(refKey)) {
                  groundingItems.push({ ...item, source_mode: "stable_memory" as const });
                  existingRefs.add(refKey);
                }
              }
              console.log(`[GROUNDING] Merged diversity items: ${(diversityParsed.groundingItems ?? []).length} candidates`);
            } catch {
              console.warn("[GROUNDING] Failed to parse diversity output");
            }
          }

          const groundingBrief: GroundingBrief = {
            id: `gb_${context.module}_${context.turnNumber}_${Date.now()}`,
            projectId: context.projectId,
            module: context.module,
            generatedAt: new Date().toISOString(),
            afterTurn: context.turnNumber,
            items: groundingItems as GroundingItem[],
            thematic_tension: groundingParsed.thematic_tension,
          };
          await this.store.saveGroundingBrief(groundingBrief);
          // Accumulate high-value grounding items into insights ledger
          await this.accumulateGroundingInsights(context, groundingBrief);
          console.log(`[GROUNDING] Brief generated: ${groundingBrief.items.length} items for ${context.module} turn ${context.turnNumber}`);
        } catch (parseErr) {
          console.warn("[GROUNDING] Failed to parse grounding brief:", parseErr);
        }
      }

      return brief;
    } catch (err) {
      console.error("[CULTURAL] Brief generation failed:", err);
      return null;
    }
  }

  private buildDirectedReferencesSection(context: CulturalResearchContext): string {
    const parts: string[] = [];
    if (context.directedReferences.length > 0) {
      parts.push(...context.directedReferences);
    }
    if (context.culturalContext) {
      parts.push(`[User-provided cultural context]: ${context.culturalContext}`);
    }
    return parts.length > 0 ? parts.join("\n") : "(none)";
  }

  private async accumulateCulturalInsights(
    context: CulturalResearchContext,
    brief: CulturalBrief,
    ledger: CulturalDecisionLedger,
  ): Promise<void> {
    try {
      // Only persist items with high/medium confidence from briefs where
      // past decisions were accepted or modified (not rejected/ignored).
      // On the very first brief (no decisions yet), persist anyway.
      const hasPositiveHistory = ledger.decisions.length === 0 ||
        ledger.decisions.some(d => d.outcome === "accepted" || d.outcome === "modified");
      if (!hasPositiveHistory) return;

      const candidates = brief.evidenceBrief.items
        .filter(item => item.confidence === "high" || item.confidence === "medium");

      for (const item of candidates) {
        const insight: CreativeInsight = {
          id: `ci_cultural_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          source: "cultural",
          module_origin: context.module,
          turn_origin: context.turnNumber,
          claim: item.claim,
          narrative_fuel: item.specificDetail,
          domain: item.sourceFamily,
          confidence: item.confidence as "high" | "medium",
          times_injected: 0,
          times_utilized: [],
          status: "active",
        };
        await this.store.addInsight(context.projectId, insight);
      }
    } catch (err) {
      console.warn("[INSIGHTS] Cultural accumulation failed (non-fatal):", err);
    }
  }

  private async accumulateGroundingInsights(
    context: CulturalResearchContext,
    brief: GroundingBrief,
  ): Promise<void> {
    try {
      const candidates = brief.items
        .filter(item =>
          (item.confidence === "strong" || item.confidence === "moderate") &&
          item.narrative_fuel
        );

      for (const item of candidates) {
        const insight: CreativeInsight = {
          id: `ci_grounding_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          source: "grounding",
          module_origin: context.module,
          turn_origin: context.turnNumber,
          claim: item.reference,
          narrative_fuel: item.narrative_fuel,
          domain: item.domain,
          confidence: item.confidence === "strong" ? "high" : "medium",
          times_injected: 0,
          times_utilized: [],
          status: "active",
        };
        await this.store.addInsight(context.projectId, insight);
      }
    } catch (err) {
      console.warn("[INSIGHTS] Grounding accumulation failed (non-fatal):", err);
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
