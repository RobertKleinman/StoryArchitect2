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

// ── Real-World Grounding Layer ──

export type GroundingDomain =
  | "historical_behavioral_pattern"  // Real incidents revealing how power/deception/resistance operates
  | "institutional_mechanics"        // How real organizations distribute power (who decides/blocks/benefits/absorbs risk)
  | "material_lived_reality"         // Housing, money, transit, class signals, bodily routine — friction and constraint
  | "philosophical_framework"        // Named philosophical or ethical frameworks with specific useful concepts
  | "scientific_finding"             // Psychology, behavioral economics, sociology — named phenomena
  | "regional_local_specificity"     // How institutions/norms/daily life work in a specific confirmed setting
  | "durable_cultural_dynamic"        // Long-tail social forces with multi-year relevance
  | "contemporary_systemic_pattern";  // Ongoing structural dynamics shaping current life

export interface GroundingItem {
  /** The real-world reference — specific enough to be useful */
  reference: string;
  /** Why this connects to the creative direction */
  relevance: string;
  /** The concrete detail that makes this useful for fiction — a mechanism, dynamic, or texture */
  narrative_fuel: string;
  /** What domain this comes from */
  domain: GroundingDomain;
  /** How confident the connection is */
  confidence: "strong" | "moderate" | "speculative";
  /** Source type: stable_memory (LLM knowledge, historically settled) */
  source_mode: "stable_memory";
}

export interface GroundingBrief {
  id: string;
  projectId: string;
  module: CulturalModule;
  generatedAt: string;
  afterTurn: number;
  items: GroundingItem[];            // 2-3 items
  /** The real-world contradiction or tension this story could explore */
  thematic_tension?: string;
}

export interface GroundingCacheEntry {
  brief: GroundingBrief;
  createdAt: string;
  staleAfterTurn: number;           // Tighter window than cultural: 1 turn
}

// ── Creative Insights Accumulator ──

export interface CreativeInsight {
  id: string;                         // "ci_{source}_{timestamp}"
  source: "cultural" | "grounding" | "divergence";
  module_origin: CulturalModule;      // Which module generated it
  turn_origin: number;

  // The insight itself
  claim: string;                      // What was found (1-2 sentences)
  narrative_fuel: string;             // Concrete usable detail
  domain: string;                     // sourceFamily, GroundingDomain, or conflictPattern
  confidence: "high" | "medium";      // Only high/medium persisted

  // Lifecycle
  times_injected: number;             // How many modules received this
  times_utilized: boolean[];          // Per-module: did the builder use it?
  status: "active" | "superseded";    // Superseded if contradicted by later findings
}

export interface CreativeInsightsLedger {
  projectId: string;
  insights: CreativeInsight[];        // Bounded at 40
  lastUpdatedAt: string;
}

// ── Cache types ──

export interface BriefCacheEntry {
  brief: CulturalBrief;
  createdAt: string;
  staleAfterTurn: number;           // Brief becomes stale after this turn number
}
