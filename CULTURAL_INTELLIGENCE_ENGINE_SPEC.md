# Cultural Intelligence Engine — Implementation Specification

## For Claude Code: Read This First

This spec describes a **cross-cutting layer** (not a module) called the Cultural Intelligence Engine. It runs alongside the existing module pipeline (Hook → Character → CharacterImage → World → Plot → Scene) and provides cultural grounding, relevance, and pop culture awareness to every module's clarifier and builder stages.

**Do not create a new UI tab or module.** This is invisible infrastructure that enriches existing modules.

**Key design principle: adaptive, not deterministic.** There are no fixed taxonomies, no hardcoded categories, no deterministic scoring. The engine uses LLM intelligence to make contextual decisions.

---

## 1. Architecture Overview

The Cultural Intelligence Engine has four components:

1. **CulturalResearchService** — orchestrates research, caching, and brief generation
2. **CulturalStore** — file-based JSON persistence for briefs and decision ledger
3. **Prompts + Schemas** — LLM prompts for the researcher and summarizer roles
4. **Integration hooks** — modifications to existing module services to consume engine output

### Data Flow

```
Module clarifier turn starts
  → CulturalResearchService.getBriefForClarifier(projectId, module, creativeStateSummary)
    → Check brief cache (hit? return cached brief)
    → Miss? Run creative-state summarizer LLM call → research contract
    → Run cultural researcher LLM call with research contract → raw research
    → Package into CulturalBrief (evidence layer + creative application layer)
    → Cache brief, return it
  → Module's buildClarifierPrompt() injects brief as {{CULTURAL_CONTEXT}} block
  → Clarifier LLM sees cultural context, uses it to inflect options naturally

Module builder stage starts
  → CulturalResearchService.getBriefForBuilder(projectId, module)
    → Return cached brief (already generated during clarifier phase)
    → Plus: any accepted proposals from decision ledger
  → Module's buildBuilderPrompt() injects brief as {{CULTURAL_CONTEXT}} block
  → Builder LLM uses cultural context for grounding and specificity
```

### Three Modes

**Ambient (default):** Engine output is injected into clarifier/builder prompts silently. The clarifier naturally uses cultural context to make its options more grounded and relevant. The user never sees "the engine suggested X." They just see better, more culturally-textured options.

**Proactive:** When the engine identifies a strong cultural connection the user hasn't thought of, it surfaces it as a special option in the clarifier response. This works through a `cultural_proposals` field added to clarifier output — the clarifier decides whether to surface it based on relevance. Example: engine recognizes that a betrayal-in-a-luxury-setting story maps onto housing crisis dynamics and proposes it as an option.

**Directed:** When a user explicitly names a reference ("looks like Chalamet", "structure like Drag Race", "about the housing crisis"), the engine does deep targeted research on that specific reference. This is triggered by detecting named references in user free-text input.

---

## 2. New Files to Create

### 2.1 Types — `shared/types/cultural.ts`

```typescript
/**
 * Cultural Intelligence Engine types.
 * Cross-cutting layer — consumed by all module services.
 */

// ── Evidence Brief (what research actually supports) ──

export type SourceFamily =
  | "encyclopedia"      // Wikipedia, encyclopedic knowledge
  | "news"              // Current events, journalism
  | "entertainment"     // TV, film, music, games metadata
  | "criticism"         // Reviews, essays, analysis
  | "social_discourse"  // Trends, memes, public conversation
  | "historical"        // Historical events, periods, figures
  | "subcultural";      // Niche communities, subcultures, fandoms

export interface EvidenceItem {
  claim: string;                    // What the research found
  sourceFamily: SourceFamily;       // Type of source
  confidence: "high" | "medium" | "speculative";
  specificDetail: string;           // Concrete detail: mechanic, sensory texture, language pattern, contradiction
  storyDimension: string;           // Which aspect of the story this maps to (thematic, structural, emotional, visual, social, dynamic)
}

export interface EvidenceBrief {
  items: EvidenceItem[];            // 3-8 evidence items
  searchDimensions: string[];       // What domains were searched
  negativeProfile: string[];        // "What this story is NOT" — from rejection history
}

// ── Creative Application Brief (how evidence could inform the story) ──

export interface CreativeApplication {
  connection: string;               // How this evidence connects to the story
  mode: "abstract" | "anchor" | "transform";
  // abstract: decomposed traits only, no named reference
  // anchor: explicit named reference (user opted in or engine proposed, user accepted)
  // transform: starts from real anchor, becomes fictional
  suggestedUse: string;             // Concrete suggestion for how builder/clarifier could use this
  antiDerivative?: string;          // Warning if this risks being too close to a known work
}

export interface CulturalBrief {
  id: string;                       // Brief ID for tracking
  projectId: string;
  module: CulturalModule;
  generatedAt: string;              // ISO timestamp
  afterTurn: number;
  evidenceBrief: EvidenceBrief;
  creativeApplications: CreativeApplication[];
  // Proactive proposals — the engine's suggested cultural connections
  // Clarifier may surface these as options, or ignore them
  proposals: CulturalProposal[];
}

export type CulturalModule = "hook" | "character" | "character_image" | "world" | "plot" | "scene";

// ── Proactive Proposals ──

export interface CulturalProposal {
  id: string;
  connection: string;               // "Your betrayal architecture maps onto housing crisis dynamics"
  evidence: string;                  // Brief supporting evidence
  suggestedOption: string;           // How this could appear as a clarifier option
  confidence: "strong" | "moderate";
}

// ── Decision Ledger (tracks what was offered, accepted, rejected, ignored) ──

export interface CulturalDecision {
  id: string;
  briefId: string;                   // Which brief this came from
  module: CulturalModule;
  turnNumber: number;
  timestamp: string;
  proposalId?: string;               // If this was a proactive proposal
  offered: string;                   // What was offered
  outcome: "accepted" | "rejected" | "ignored" | "modified";
  userModification?: string;         // If modified, what the user said
}

export interface CulturalDecisionLedger {
  decisions: CulturalDecision[];
  negativeProfile: string[];         // Accumulated "what this story is not" from rejections
}

// ── Research Contract (compressed creative state for the engine) ──

export interface ResearchContract {
  storyEssence: string;             // 2-3 sentence distillation of the story so far
  emotionalCore: string;            // The feeling the story is going for
  confirmedElements: string[];      // Key confirmed constraints (from constraint ledger)
  openQuestions: string[];           // What's still being decided
  userStyleSignals: string[];       // From psychology ledger — what kind of creator this is
  previousResearch: string[];       // Brief IDs already generated (avoid repetition)
  directedReferences: string[];     // Any explicit references the user named
  negativeProfile: string[];        // "What this story is not"
}

// ── Influence Log (inspectable audit trail for ambient mode) ──

export interface InfluenceLogEntry {
  briefId: string;
  module: CulturalModule;
  turnNumber: number;
  injectedContext: string;           // What was actually injected into the prompt
  builderUtilized: boolean;         // Did the builder output reflect this? (set post-hoc)
}

export interface CulturalInfluenceLog {
  entries: InfluenceLogEntry[];
}

// ── Cache types ──

export interface BriefCacheEntry {
  brief: CulturalBrief;
  createdAt: string;
  staleAfterTurn: number;           // Brief becomes stale after this turn number
}
```

### 2.2 Schemas — `backend/services/culturalSchemas.ts`

Create JSON schemas for structured LLM output. Follow the exact pattern in `hookSchemas.ts` — all objects must have `additionalProperties: false`.

```typescript
/**
 * JSON schemas for Cultural Intelligence Engine structured output.
 */

export const RESEARCH_CONTRACT_SCHEMA = {
  type: "object" as const,
  properties: {
    storyEssence: { type: "string" as const },
    emotionalCore: { type: "string" as const },
    confirmedElements: { type: "array" as const, items: { type: "string" as const } },
    openQuestions: { type: "array" as const, items: { type: "string" as const } },
    userStyleSignals: { type: "array" as const, items: { type: "string" as const } },
    directedReferences: { type: "array" as const, items: { type: "string" as const } },
    negativeProfile: { type: "array" as const, items: { type: "string" as const } },
  },
  required: ["storyEssence", "emotionalCore", "confirmedElements", "openQuestions", "userStyleSignals", "directedReferences", "negativeProfile"],
  additionalProperties: false,
};

export const CULTURAL_BRIEF_SCHEMA = {
  type: "object" as const,
  properties: {
    evidenceItems: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          claim: { type: "string" as const },
          sourceFamily: {
            type: "string" as const,
            enum: ["encyclopedia", "news", "entertainment", "criticism", "social_discourse", "historical", "subcultural"],
          },
          confidence: { type: "string" as const, enum: ["high", "medium", "speculative"] },
          specificDetail: { type: "string" as const },
          storyDimension: { type: "string" as const },
        },
        required: ["claim", "sourceFamily", "confidence", "specificDetail", "storyDimension"],
        additionalProperties: false,
      },
    },
    searchDimensions: { type: "array" as const, items: { type: "string" as const } },
    creativeApplications: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          connection: { type: "string" as const },
          mode: { type: "string" as const, enum: ["abstract", "anchor", "transform"] },
          suggestedUse: { type: "string" as const },
          antiDerivative: { type: "string" as const },
        },
        required: ["connection", "mode", "suggestedUse"],
        additionalProperties: false,
      },
    },
    proposals: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          connection: { type: "string" as const },
          evidence: { type: "string" as const },
          suggestedOption: { type: "string" as const },
          confidence: { type: "string" as const, enum: ["strong", "moderate"] },
        },
        required: ["connection", "evidence", "suggestedOption", "confidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["evidenceItems", "searchDimensions", "creativeApplications", "proposals"],
  additionalProperties: false,
};
```

### 2.3 Prompts — `backend/services/culturalPrompts.ts`

Two LLM prompt sets: the creative-state summarizer and the cultural researcher.

```typescript
/**
 * Prompts for the Cultural Intelligence Engine.
 *
 * Two roles:
 * 1. cultural_summarizer — compresses full project state into a research contract
 * 2. cultural_researcher — takes research contract, produces evidence brief + creative applications
 */

// ═══ CREATIVE-STATE SUMMARIZER ═══
// Compresses the full creative state into a compact research contract.
// The researcher NEVER sees raw packs — only this summarized contract.

export const CULTURAL_SUMMARIZER_SYSTEM = `You are a creative-state summarizer. Your job is to read the full creative state of a story project and compress it into a compact research contract that a cultural researcher can use.

You receive: locked packs (hook, character, world, plot — whichever exist), psychology ledger summary, constraint ledger, and any user-named references.

You produce a research contract with these fields:
- storyEssence: 2-3 sentences distilling what this story IS. Not a plot summary — the emotional and structural DNA. What makes it THIS story and not another?
- emotionalCore: The specific feeling the story is going for. Not a genre label. A texture. "The queasy intimacy of depending on someone who could destroy you" not "dark romance."
- confirmedElements: Key confirmed creative choices from the constraint ledger. Only include things that are load-bearing for research — skip trivial confirmations.
- openQuestions: What's still being decided? These are the dimensions where cultural research could be most useful.
- userStyleSignals: From the psychology ledger — what kind of creator is this? Do they gravitate toward darkness, humor, spectacle, intimacy? Are they a director or explorer? This shapes what kind of cultural connections will resonate.
- directedReferences: Any explicit references the user has named ("looks like X", "structure like Y", "inspired by Z"). These get special deep-dive treatment.
- negativeProfile: "What this story is NOT." Accumulated from rejections. If the user rejected a sci-fi direction, the researcher should not bring sci-fi connections.

CRITICAL RULES:
- Be SPECIFIC. "A dark romance" is useless. "A captor-captive dynamic where the captive has leverage through a skill the captor needs" is useful.
- The storyEssence should make a researcher immediately think of 5-10 different cultural touchpoints. If it's too generic to spark associations, you've failed.
- Include CONTRADICTIONS and TENSIONS in the story — these are the most fertile ground for cultural research.
- The openQuestions should be phrased as research-actionable questions, not vague "what genre?" questions.

Return ONLY valid JSON matching the schema. No markdown fences.`;

export const CULTURAL_SUMMARIZER_USER_TEMPLATE = `Compress this creative state into a research contract.

═══ LOCKED PACKS (available upstream output) ═══
{{LOCKED_PACKS}}

═══ CURRENT MODULE STATE ═══
Module: {{MODULE}}
Current state: {{CURRENT_STATE}}
Constraint ledger: {{CONSTRAINT_LEDGER}}

═══ PSYCHOLOGY SUMMARY ═══
{{PSYCHOLOGY_SUMMARY}}

═══ USER-NAMED REFERENCES ═══
{{DIRECTED_REFERENCES}}

═══ PREVIOUS RESEARCH (avoid repetition) ═══
{{PREVIOUS_BRIEF_SUMMARIES}}

═══ NEGATIVE PROFILE (what this story is NOT) ═══
{{NEGATIVE_PROFILE}}

Produce a research contract that would let a cultural researcher find the most grounding, relevant, imagination-sparking material for THIS specific story.`;


// ═══ CULTURAL RESEARCHER ═══
// Takes a research contract and produces evidence brief + creative applications.

export const CULTURAL_RESEARCHER_SYSTEM = `You are a cultural researcher for a story creation engine. You receive a compact research contract describing a story being developed, and you produce cultural intelligence that grounds the story in real-world texture.

YOUR VALUE PROPOSITION:
1. GROUNDING — connect fictional stories to real emotional, social, and physical textures
2. RELEVANCE — identify connections to current culture, events, and discourse that make stories feel alive
3. SPECIFICITY — provide concrete mechanics, sensory details, language patterns, and contradictions that a writer can USE, not vague labels
4. DISCOVERY — find connections the creator hasn't thought of, across deliberately different domains

═══ SEARCH STRATEGY ═══
Cast a WIDE net. Decompose the story into multiple searchable dimensions and search across deliberately different domains:

THEMATIC: What real-world tensions does this story echo? (power dynamics, social structures, institutional pressures)
STRUCTURAL: What narrative patterns does this resemble? (specific TV shows, films, myths, games — extract mechanics, not just titles)
EMOTIONAL: What real experiences produce the same emotional texture? (specific subcultures, professions, relationships, situations)
VISUAL: What real places, aesthetics, subcultures, or eras look like this story's world?
SOCIAL: What current discourse, events, or cultural moments connect to this story's themes?
DYNAMIC: What real-world systems create the same kind of tension? (economics, politics, ecology, technology, social media dynamics)

You MUST search at least 4 different dimensions. Cross-domain resonance is where the best material comes from.

═══ OUTPUT QUALITY ═══
For each evidence item, provide:
- claim: What you found. Be specific.
- sourceFamily: Tag the source type honestly. Encyclopedia facts are high-confidence. Social discourse is speculative. This lets downstream consumers weight appropriately.
- confidence: How solid is this? "high" = well-established fact. "medium" = reasonable inference. "speculative" = creative leap.
- specificDetail: THIS IS THE MOST IMPORTANT FIELD. Not "Japanese culture values hierarchy" but "In Japanese corporate culture, the practice of 'nemawashi' (root-binding) requires privately gaining consensus before any public meeting — decisions are performed, not made, in the room. The meeting itself is theater." Give the writer material they can USE: mechanics, sensory textures, contradictions, physical details, language patterns, emotional dynamics.
- storyDimension: Which dimension this maps to (thematic, structural, emotional, visual, social, dynamic).

═══ CREATIVE APPLICATIONS ═══
For each application:
- connection: How this evidence connects to THIS specific story. Not generic.
- mode: Choose carefully:
  - "abstract": Decomposed traits only. Use when the connection is structural/emotional, not a direct reference. DEFAULT for early-project briefs.
  - "anchor": Explicit named reference. ONLY when user has named the reference, OR the connection is so strong and specific it would be dishonest not to name it.
  - "transform": Starts from a real anchor but becomes fictional. "What if nemawashi, but the consensus is about who gets sacrificed?"
- suggestedUse: HOW the builder/clarifier could use this. Concrete. "The clarifier could offer an option where the power dynamic operates through performed consensus rather than direct command."
- antiDerivative: If this connection risks making the story too derivative of a known work, say so. "This mechanism is very close to The Hunger Games' tribute selection — consider distancing by [specific suggestion]."

═══ PROACTIVE PROPOSALS ═══
If you identify a strong cultural connection the creator probably hasn't thought of, include it as a proposal. These should be:
- SURPRISING: Not obvious. The creator would say "oh, I hadn't thought of that" not "yeah, obviously."
- GROUNDED: Backed by specific evidence, not vibes.
- ACTIONABLE: Phrased as something the clarifier could offer as an option.
- CONFIDENT: Only include "strong" proposals if the connection is genuinely illuminating. "moderate" for interesting-but-speculative.

═══ ANTI-FIXATION RULES ═══
- For EARLY-PROJECT briefs (turn < 4): be deliberately PLURAL. Offer connections from 4+ different domains. Do NOT collapse around a single cultural anchor. The creative space should feel expansive, not narrow.
- For LATER briefs: can be more focused, following the story's confirmed direction.
- If the negative profile says "not X", do NOT bring connections from X's domain unless they're specifically about how to be different from X.
- If you notice the story drifting dangerously close to a known work/event, include an anti-derivative warning.

═══ CRITICAL RULES ═══
- NEVER include vague labels. "Japanese aesthetics" is worthless. "The specific way a kaiseki meal is structured — each course is a narrative beat, the meal has rising action and resolution, and the diner's role is to receive, not choose" is gold.
- Each evidence item must be DETAILED enough that a writer could use it in a scene without further research.
- Search BROADLY. If all your evidence comes from one domain, you've failed.
- Include at least one CONTRADICTORY or SURPRISING finding — something that complicates the obvious reading.
- The creative applications must reference THIS story specifically. "This could be used in many stories" means you've failed.

Return ONLY valid JSON matching the schema. No markdown fences.`;

export const CULTURAL_RESEARCHER_USER_TEMPLATE = `Research cultural connections for this story.

═══ RESEARCH CONTRACT ═══
Story essence: {{STORY_ESSENCE}}
Emotional core: {{EMOTIONAL_CORE}}

Confirmed elements:
{{CONFIRMED_ELEMENTS}}

Open questions (high-value research targets):
{{OPEN_QUESTIONS}}

User style signals:
{{USER_STYLE_SIGNALS}}

Directed references (deep-dive these):
{{DIRECTED_REFERENCES}}

Negative profile (what this story is NOT — avoid these domains):
{{NEGATIVE_PROFILE}}

Module: {{MODULE}}
Turn: {{TURN_NUMBER}}

Produce a cultural intelligence brief with evidence items, creative applications, and any proactive proposals.`;


// ═══ FORMAT HELPERS ═══

/**
 * Format a CulturalBrief into a prompt-injectable block for clarifiers.
 * Returns empty string if no brief is available.
 */
export const CULTURAL_CONTEXT_CLARIFIER_HEADER = `═══ CULTURAL INTELLIGENCE (use to enrich your options — DO NOT show this machinery to the user) ═══
The Cultural Intelligence Engine has identified these connections for this story.
Use them to make your options more grounded, specific, and culturally textured.
You do NOT need to use all of them. Cherry-pick what enriches THIS turn's question/options.
If any proposals are included, consider whether they would make a compelling option for the user — but only if they genuinely fit this moment.`;

/**
 * Format a CulturalBrief into a prompt-injectable block for builders.
 */
export const CULTURAL_CONTEXT_BUILDER_HEADER = `═══ CULTURAL INTELLIGENCE (use for grounding and specificity) ═══
These cultural connections have been identified for this story. Use them to:
- Ground fictional mechanisms in real-world textures and details
- Add sensory specificity drawn from real places, practices, and dynamics
- Ensure the story feels connected to recognizable human experience
- Avoid generic or derivative territory (see anti-derivative warnings)
You do NOT need to use all connections. Use what serves the story.`;
```

### 2.4 Store — `backend/storage/culturalStore.ts`

Follow the exact `ProjectStore` pattern — file-based JSON storage.

```typescript
/**
 * File-based storage for Cultural Intelligence Engine data.
 *
 * Stores:
 * - Brief cache: ./data/cultural/briefs/{projectId}_{module}_{turn}.json
 * - Decision ledger: ./data/cultural/ledgers/{projectId}.json
 * - Influence log: ./data/cultural/influence/{projectId}.json
 *
 * Follow the same pattern as ProjectStore (backend/storage/projectStore.ts).
 */

import * as fs from "fs/promises";
import * as path from "path";
import type {
  CulturalBrief,
  CulturalDecisionLedger,
  CulturalDecision,
  CulturalInfluenceLog,
  InfluenceLogEntry,
  BriefCacheEntry,
  CulturalModule,
} from "../../shared/types/cultural";

const DATA_DIR = path.join(process.cwd(), "data", "cultural");
const BRIEFS_DIR = path.join(DATA_DIR, "briefs");
const LEDGERS_DIR = path.join(DATA_DIR, "ledgers");
const INFLUENCE_DIR = path.join(DATA_DIR, "influence");

export class CulturalStore {
  private initialized = false;

  private async ensureDirs(): Promise<void> {
    if (this.initialized) return;
    await fs.mkdir(BRIEFS_DIR, { recursive: true });
    await fs.mkdir(LEDGERS_DIR, { recursive: true });
    await fs.mkdir(INFLUENCE_DIR, { recursive: true });
    this.initialized = true;
  }

  // ── Brief Cache ──

  async getCachedBrief(
    projectId: string,
    module: CulturalModule,
    currentTurn: number,
  ): Promise<CulturalBrief | null> {
    await this.ensureDirs();
    // Look for most recent brief for this project+module
    const files = await fs.readdir(BRIEFS_DIR).catch(() => []);
    const prefix = `${projectId}_${module}_`;
    const matching = files
      .filter(f => f.startsWith(prefix) && f.endsWith(".json"))
      .sort()
      .reverse();

    if (matching.length === 0) return null;

    const latest = JSON.parse(
      await fs.readFile(path.join(BRIEFS_DIR, matching[0]), "utf-8"),
    ) as BriefCacheEntry;

    // Stale check: brief is stale if generated more than 2 turns ago
    if (latest.staleAfterTurn < currentTurn) return null;

    return latest.brief;
  }

  async saveBrief(brief: CulturalBrief): Promise<void> {
    await this.ensureDirs();
    const entry: BriefCacheEntry = {
      brief,
      createdAt: new Date().toISOString(),
      staleAfterTurn: brief.afterTurn + 2, // Stale after 2 turns
    };
    const filename = `${brief.projectId}_${brief.module}_${String(brief.afterTurn).padStart(3, "0")}.json`;
    await fs.writeFile(
      path.join(BRIEFS_DIR, filename),
      JSON.stringify(entry, null, 2),
    );
  }

  // ── Decision Ledger ──

  async getLedger(projectId: string): Promise<CulturalDecisionLedger> {
    await this.ensureDirs();
    try {
      const raw = await fs.readFile(
        path.join(LEDGERS_DIR, `${projectId}.json`),
        "utf-8",
      );
      return JSON.parse(raw) as CulturalDecisionLedger;
    } catch {
      return { decisions: [], negativeProfile: [] };
    }
  }

  async saveLedger(projectId: string, ledger: CulturalDecisionLedger): Promise<void> {
    await this.ensureDirs();
    await fs.writeFile(
      path.join(LEDGERS_DIR, `${projectId}.json`),
      JSON.stringify(ledger, null, 2),
    );
  }

  async recordDecision(projectId: string, decision: CulturalDecision): Promise<void> {
    const ledger = await this.getLedger(projectId);
    ledger.decisions.push(decision);
    // Update negative profile from rejections
    if (decision.outcome === "rejected") {
      ledger.negativeProfile.push(decision.offered);
      // Keep negative profile bounded (last 20 rejections)
      if (ledger.negativeProfile.length > 20) {
        ledger.negativeProfile = ledger.negativeProfile.slice(-20);
      }
    }
    await this.saveLedger(projectId, ledger);
  }

  // ── Influence Log ──

  async getInfluenceLog(projectId: string): Promise<CulturalInfluenceLog> {
    await this.ensureDirs();
    try {
      const raw = await fs.readFile(
        path.join(INFLUENCE_DIR, `${projectId}.json`),
        "utf-8",
      );
      return JSON.parse(raw) as CulturalInfluenceLog;
    } catch {
      return { entries: [] };
    }
  }

  async logInfluence(projectId: string, entry: InfluenceLogEntry): Promise<void> {
    const log = await this.getInfluenceLog(projectId);
    log.entries.push(entry);
    // Keep bounded (last 50 entries)
    if (log.entries.length > 50) {
      log.entries = log.entries.slice(-50);
    }
    await fs.writeFile(
      path.join(INFLUENCE_DIR, `${projectId}.json`),
      JSON.stringify(log, null, 2),
    );
  }

  // ── Cleanup ──

  async deleteProject(projectId: string): Promise<void> {
    await this.ensureDirs();
    // Delete all briefs for this project
    const files = await fs.readdir(BRIEFS_DIR).catch(() => []);
    for (const f of files) {
      if (f.startsWith(`${projectId}_`)) {
        await fs.unlink(path.join(BRIEFS_DIR, f)).catch(() => {});
      }
    }
    // Delete ledger and influence log
    await fs.unlink(path.join(LEDGERS_DIR, `${projectId}.json`)).catch(() => {});
    await fs.unlink(path.join(INFLUENCE_DIR, `${projectId}.json`)).catch(() => {});
  }
}
```

### 2.5 Service — `backend/services/culturalResearchService.ts`

This is the main orchestrator. Follow the `divergenceExplorer.ts` pattern for fire-and-forget async operations.

```typescript
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
    // Skip on turn 1 — not enough creative state to research
    if (context.turnNumber < 2) return null;

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
    return this.store.getCachedBrief(projectId, module, turnNumber);
  }

  /**
   * Fire-and-forget: generate a brief in the background during user think-time.
   * Called after a clarifier turn completes (alongside divergence and consolidation).
   * If the brief finishes before the user's next submission, the NEXT clarifier
   * turn gets cultural context. If not, no harm.
   */
  async fireBackgroundResearch(context: CulturalResearchContext): Promise<void> {
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
          maxTokens: 800,
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
          maxTokens: 2500,
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
  if (info.turnNumber < 2) return false;
  if (info.hasCachedBrief) return false;

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
```

### 2.6 Throttling addition — `backend/services/backgroundThrottling.ts`

Add cultural research to the existing throttling module. Add this export to the existing file:

```typescript
// Add to the existing backgroundThrottling.ts file:

/**
 * Determine whether cultural research should fire after this turn.
 * Lighter cadence than consolidation/divergence — every 3rd turn or on free text.
 */
export function shouldResearchCulture(
  turn: ThrottlingTurnInfo,
  _session: ThrottlingSessionInfo,
): boolean {
  if (turn.turnNumber < 2) return false;
  const meaningfulInput = turn.userSelection?.type === "free_text";
  const cadenceFallback = turn.turnNumber % 3 === 0;
  return meaningfulInput || cadenceFallback;
}
```

---

## 3. Files to Modify

### 3.1 `shared/modelConfig.ts`

**Add to `HookRole` type (line 5-12):**
```typescript
| "cultural_summarizer" | "cultural_researcher"
```

**Add to `ModelConfig` interface (after line 49, before closing brace):**
```typescript
  /** Cultural Intelligence Engine — compresses creative state */
  cultural_summarizer: string;
  /** Cultural Intelligence Engine — produces evidence briefs */
  cultural_researcher: string;
```

**Add to `CREATIVE_ROLES` array (line 116-125):**
```typescript
  "cultural_summarizer",
  "cultural_researcher",
```

**Add to `DEFAULT_MODEL_CONFIG` (after line 186, before closing brace):**
```typescript
  // Cultural Intelligence Engine
  cultural_summarizer: FAST,        // compression task — fast tier
  cultural_researcher: FAST,        // background research — fast tier
```

### 3.2 `backend/services/runtime.ts`

**Add imports (after line 15):**
```typescript
import { CulturalStore } from "../storage/culturalStore";
import { CulturalResearchService } from "./culturalResearchService";
```

**Add to `activeModelConfig` (after line 53):**
```typescript
  cultural_summarizer: envModel("CULTURAL_MODEL_SUMMARIZER", DEFAULT_MODEL_CONFIG.cultural_summarizer),
  cultural_researcher: envModel("CULTURAL_MODEL_RESEARCHER", DEFAULT_MODEL_CONFIG.cultural_researcher),
```

**Add instantiation (after sceneService, around line 77):**
```typescript
export const culturalStore = new CulturalStore();
export const culturalResearchService = new CulturalResearchService(culturalStore, llmClient);
```

### 3.3 `backend/services/hookService.ts`

This is the primary integration point. The pattern is the same for all module services.

**Add imports:**
```typescript
import { culturalResearchService } from "./runtime";
import { detectDirectedReferences, shouldRunCulturalResearch } from "./culturalResearchService";
import type { CulturalResearchContext } from "./culturalResearchService";
```

**Modify `buildClarifierPrompt()` (around line 907-944):**

After the existing dynamic suffix is built (line 930-938), add:

```typescript
    // ─── Cultural Intelligence Engine injection ───
    // Get cached cultural brief (generated by background research on previous turn)
    // This is synchronous — just reads from cache. Does NOT trigger new research.
    const culturalBrief = await this.getCulturalBrief(session, session.turns.length + 1);
    const culturalText = culturalResearchService.formatBriefForClarifier(culturalBrief);
    if (culturalText) {
      dynamic += "\n\n" + culturalText;
    }
```

**NOTE:** This means `buildClarifierPrompt` becomes `async`. Update its signature and all call sites accordingly.

**Modify `buildBuilderPrompt()` (around line 947-971):**

Same pattern — add after the dynamic suffix:

```typescript
    const culturalBrief = await this.getCulturalBriefForBuilder(session);
    const culturalText = culturalResearchService.formatBriefForBuilder(culturalBrief);
    if (culturalText) {
      dynamic += "\n\n" + culturalText;
    }
```

**Add background research firing (around line 365-374):**

After the existing divergence and consolidation firing, add:

```typescript
    // Fire background cultural research (non-blocking, throttled)
    const hasCachedBrief = !!(await culturalResearchService.getBriefForBuilder(
      session.projectId, "hook", turn.turnNumber,
    ).catch(() => null));
    if (shouldRunCulturalResearch({ turnNumber: turn.turnNumber, userSelection: turn.userSelection, hasCachedBrief })) {
      this.fireBackgroundCulturalResearch(session, turn.turnNumber)
        .catch(err => console.error("[CULTURAL] Background research fire failed:", err));
    }
```

**Add helper methods to HookService class:**

```typescript
  /**
   * Get cultural brief for a clarifier turn (from cache).
   */
  private async getCulturalBrief(
    session: HookSessionState,
    turnNumber: number,
  ): Promise<import("../../shared/types/cultural").CulturalBrief | null> {
    return culturalResearchService.getBriefForClarifier({
      projectId: session.projectId,
      module: "hook",
      turnNumber,
      lockedPacksSummary: "", // Hook is first module — no upstream packs
      currentState: session.currentState as Record<string, unknown>,
      constraintLedger: this.formatLedgerForPrompt(session.constraintLedger ?? []),
      psychologySummary: formatPsychologyLedgerForPrompt(session.psychologyLedger) ?? "",
      directedReferences: this.extractDirectedReferences(session),
    });
  }

  private async getCulturalBriefForBuilder(
    session: HookSessionState,
  ): Promise<import("../../shared/types/cultural").CulturalBrief | null> {
    return culturalResearchService.getBriefForBuilder(
      session.projectId, "hook", session.turns.length,
    );
  }

  /**
   * Fire-and-forget background cultural research.
   */
  private async fireBackgroundCulturalResearch(
    session: HookSessionState,
    turnNumber: number,
  ): Promise<void> {
    const context: CulturalResearchContext = {
      projectId: session.projectId,
      module: "hook",
      turnNumber,
      lockedPacksSummary: "",
      currentState: session.currentState as Record<string, unknown>,
      constraintLedger: this.formatLedgerForPrompt(session.constraintLedger ?? []),
      psychologySummary: formatPsychologyLedgerForPrompt(session.psychologyLedger) ?? "",
      directedReferences: this.extractDirectedReferences(session),
    };
    await culturalResearchService.fireBackgroundResearch(context);
  }

  /**
   * Extract directed references from recent user free-text inputs.
   */
  private extractDirectedReferences(session: HookSessionState): string[] {
    const refs: string[] = [];
    // Check last 3 turns for free-text input
    const recentTurns = session.turns.slice(-3);
    for (const t of recentTurns) {
      if (t.userSelection?.type === "free_text" && t.userSelection.text) {
        refs.push(...detectDirectedReferences(t.userSelection.text));
      }
    }
    return [...new Set(refs)];
  }
```

### 3.4 Apply same pattern to other module services

Apply the EXACT same integration pattern to:

- **`backend/services/characterService.ts`** — module = "character", lockedPacksSummary = hook pack summary
- **`backend/services/characterImageService.ts`** — module = "character_image", lockedPacksSummary = hook + character pack summaries
- **`backend/services/worldService.ts`** — module = "world", lockedPacksSummary = hook + character + characterImage pack summaries
- **`backend/services/plotService.ts`** — module = "plot", lockedPacksSummary = all upstream pack summaries
- **`backend/services/sceneService.ts`** — module = "scene", lockedPacksSummary = all upstream pack summaries (LOWEST priority — scene inherits most from upstream)

For each service:
1. Import `culturalResearchService`, `detectDirectedReferences`, `shouldRunCulturalResearch`, `CulturalResearchContext`
2. Add `getCulturalBrief()`, `getCulturalBriefForBuilder()`, `fireBackgroundCulturalResearch()`, `extractDirectedReferences()` helper methods
3. Inject cultural context into `buildClarifierPrompt()` dynamic suffix
4. Inject cultural context into `buildBuilderPrompt()` dynamic suffix
5. Fire background research after clarifier turn (alongside existing divergence/consolidation)

**Important for downstream modules:** The `lockedPacksSummary` should be a COMPRESSED summary of upstream packs, not full JSON. Use this pattern:

```typescript
private buildLockedPacksSummary(session: WorldSessionState): string {
  const parts: string[] = [];
  if (session.sourceHookPack) {
    parts.push(`HOOK: ${session.sourceHookPack.hookSentence} — ${session.sourceHookPack.emotionalPromise}`);
  }
  if (session.sourceCharacterPack) {
    const chars = session.sourceCharacterPack.characters
      .map((c: any) => `${c.name}: ${c.role}, desire="${c.desire}", misbelief="${c.misbelief}"`)
      .join("; ");
    parts.push(`CHARACTERS: ${chars}`);
  }
  // ... etc for each upstream pack
  return parts.join("\n\n");
}
```

### 3.5 `backend/services/hookPrompts.ts`

No changes to the system prompt. The cultural context is injected into the USER prompt's dynamic section via the `buildClarifierPrompt()` and `buildBuilderPrompt()` modifications above. The clarifier system prompt already says "read the user in real-time" and "do whatever creates the most exciting moment" — cultural context naturally enriches this.

The builder system prompt at line 351 already uses a "COLLISION METHOD" that references "real sources" — cultural context provides those sources.

### 3.6 Feature flag — `backend/services/culturalResearchService.ts`

Add a feature flag check at the top of `getBriefForClarifier()` and `fireBackgroundResearch()`:

```typescript
  // At the top of getBriefForClarifier and fireBackgroundResearch:
  if (!process.env.ENABLE_CULTURAL_ENGINE) return null;
```

This allows the engine to be disabled entirely via environment variable. Default: off (must set `ENABLE_CULTURAL_ENGINE=true` to enable).

---

## 4. What This Does NOT Include

- **No new UI components.** The engine is invisible. Cultural context flows through existing clarifier options and builder output.
- **No new routes.** The engine has no HTTP API. It's called internally by module services. (Optional: add a `GET /api/debug/cultural/:projectId` route for development inspection of briefs and decision ledger — follow the pattern in existing debug routes.)
- **No web search integration.** The researcher LLM uses its training knowledge. Web search can be added later as an enhancement but is NOT part of this implementation. The LLM's knowledge is sufficient for the grounding/relevance value proposition.
- **No changes to clarifier JSON schemas.** The clarifier output schema stays the same. Cultural proposals are surfaced through existing `options` and `question` fields — the clarifier decides how to use them.

---

## 5. Token Budget and Performance

**Per clarifier turn (when cultural research fires):**
- Summarizer call: ~800 input tokens, ~400 output tokens (FAST tier)
- Researcher call: ~1200 input tokens, ~1500 output tokens (FAST tier)
- Total: ~2000 input + ~1900 output = ~3900 tokens on FAST tier

**Per clarifier turn (cache hit):**
- 0 additional LLM calls
- Cultural context injection into clarifier prompt: ~300-500 tokens added to existing prompt

**Background execution:** Both LLM calls run during user think-time (fire-and-forget). They do NOT block the clarifier response. The pattern is identical to `fireBackgroundDivergence()`.

**Cache policy:** Briefs are valid for 2 turns. A typical 6-turn clarifier session will generate 2-3 briefs total. Storage per brief: ~2-4KB JSON.

---

## 6. Implementation Order

1. `shared/types/cultural.ts` — types first
2. `backend/services/culturalSchemas.ts` — schemas
3. `backend/services/culturalPrompts.ts` — prompts
4. `backend/storage/culturalStore.ts` — storage
5. `backend/services/culturalResearchService.ts` — service
6. Modify `shared/modelConfig.ts` — add roles
7. Modify `backend/services/runtime.ts` — instantiation
8. Modify `backend/services/hookService.ts` — first integration
9. Test with hook module (run a clarifier session, check console for `[CULTURAL]` logs)
10. Apply same pattern to characterService, worldService, plotService
11. Apply to characterImageService, sceneService (lower priority)

---

## 7. Advice for Claude Code

**Do not make the user a middle manager.** The ambient mode is the default. The user should never feel like they're "approving research reports." They should just notice that the options are more grounded, more specific, more culturally alive. The machinery is invisible.

**Anti-fixation is critical for early turns.** The researcher prompt enforces plural, multi-domain results for turns < 4. Do not override this. Early creative space must stay expansive.

**The `buildClarifierPrompt()` and `buildBuilderPrompt()` methods become async.** This is the biggest structural change. Every call site that invokes these methods must be updated to `await` them. Search for all usages.

**The `lockedPacksSummary` must be SHORT.** The summarizer prompt enforces compression, but the input to the summarizer should also be pre-compressed. Do NOT pass full JSON packs. Pass 1-2 sentence summaries of each upstream pack's key elements (hook sentence, character desires/misbeliefs, world pressure systems, plot core conflict).

**Race safety:** The brief cache uses file-based storage, same as all other stores. The background research writes to a file keyed by `projectId_module_turn`. Two concurrent background jobs for the same project+module+turn are unlikely but harmless — last write wins, both produce valid briefs.

**The influence log is optional for V1.** Implement it but don't block on it. The critical path is: store → service → integration with hookService → verify cultural context appears in clarifier prompts.

**Test strategy:** After integrating with hookService, start a new hook session with a seed like "a story about a scribe who survives a warlord by worshipping his feet." After turn 2, check:
1. Console shows `[CULTURAL]` log lines for background research
2. The clarifier's options have more grounded, culturally-specific texture
3. The brief cache in `./data/cultural/briefs/` has entries
4. Setting `ENABLE_CULTURAL_ENGINE=false` disables the engine cleanly
