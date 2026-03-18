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
  | "historical_event"        // Well-documented past events
  | "institutional_system"    // How real institutions/bureaucracies/organizations work
  | "philosophical_framework" // Named philosophical or ethical frameworks
  | "cultural_touchstone"     // Canonical works, movements, or cultural moments
  | "scientific_finding"      // Psychology, sociology, behavioral economics
  | "social_pattern";         // Recurring human dynamics, power structures

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

// ── Cache types ──

export interface BriefCacheEntry {
  brief: CulturalBrief;
  createdAt: string;
  staleAfterTurn: number;           // Brief becomes stale after this turn number
}
