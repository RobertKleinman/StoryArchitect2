/**
 * User Psychology Ledger — accumulates across modules.
 * Drives adaptive engine behavior: question style, option density,
 * assumption boldness, pacing, and emotional targeting.
 *
 * v2: Structured hypothesis store replaces freeform observation strings.
 *     Non-choice (assumption delta) tracking added.
 * v3: Hypothesis categories, satisfaction signal, assumption persistence tracking.
 */

// ─── Hypothesis categories ───

export type HypothesisCategory =
  | "content_preferences"      // explicit themes, kinks, genres, aesthetics
  | "control_orientation"      // do they want to drive or be surprised?
  | "power_dynamics"           // hierarchy, authority, submission patterns
  | "tonal_risk"               // how far they push boundaries
  | "narrative_ownership"      // how protective of their vision?
  | "engagement_satisfaction"; // how they're feeling about the experience

// ─── Structured hypothesis (replaces freeform observation) ───

export interface UserHypothesis {
  /** Stable ID for tracking across turns ("h1", "h2", etc.) */
  id: string;
  /** The observation/inference about the user */
  hypothesis: string;
  /** What specific user action(s) support this */
  evidence: string;
  /** How confident we are — "low" = first impression, "medium" = pattern seen, "high" = repeatedly confirmed */
  confidence: "low" | "medium" | "high";
  /** How broadly this applies */
  scope: "this_story" | "this_genre" | "global";
  /** Which psychological dimension this hypothesis belongs to */
  category: HypothesisCategory;
  /** Turn number when first surfaced */
  firstSeen: number;
  /** Turn number when last updated */
  lastUpdated: number;
  /** If contradicted, what contradicted it */
  disconfirmedBy?: string;
}

// ─── LLM-assessed signal (one per clarifier turn) ───

/** What the LLM outputs each turn — structured hypotheses + brief synthesis */
export interface StructuredUserRead {
  hypotheses: {
    hypothesis: string;
    evidence: string;
    confidence: "low" | "medium" | "high";
    scope: "this_story" | "this_genre" | "global";
    category?: HypothesisCategory;
  }[];
  overall_read: string;
  satisfaction?: {
    score: number;
    trend: "rising" | "stable" | "declining";
    note: string;
  };
}

/** Stored record of each turn's LLM read */
export interface UserPsychologyRead {
  turnNumber: number;
  module: "hook" | "character" | "character_image";
  /** Structured hypotheses from the LLM */
  hypotheses: {
    hypothesis: string;
    evidence: string;
    confidence: "low" | "medium" | "high";
    scope: string;
    category?: HypothesisCategory;
  }[];
  /** Brief LLM synthesis — the overall vibe read */
  overall_read: string;
}

// ─── Assumption delta (non-choice tracking) ───

export interface AssumptionDelta {
  turnNumber: number;
  /** Assumption IDs that were shown to the user */
  offered: string[];
  /** Assumption IDs the user responded to (keep/change/freeform/not_ready) */
  responded: string[];
  /** Assumption IDs offered but not responded to — weak negative signal */
  ignored: string[];
  /** What action the user took on each responded assumption */
  actions: Record<string, "keep" | "alternative" | "freeform" | "not_ready">;
  /** Tracks whether prior hypothesis-informed changes persisted */
  prior_changes?: Array<{
    hypothesis_id: string;
    change_applied: string;
    still_relevant: boolean;
  }>;
}

// ─── Service-side heuristics (computed from behavior, no LLM cost) ───

export interface UserInteractionHeuristics {
  /** Ratio of typed responses to total responses (0-1). Drives question style. */
  typeRatio: number;
  /** Average word count of typed responses. High = detailed/directorial. */
  avgResponseLength: number;
  /** Fraction of assumptions the user deferred ("not_ready") (0-1). */
  deferralRate: number;
  /** Fraction of assumptions the user changed vs kept (0-1). Higher = more opinionated. */
  changeRate: number;
  /** Total interactions counted (clicks + types + assumption responses). */
  totalInteractions: number;
  /** Trend: are responses getting longer (+1), shorter (-1), or stable (0)? */
  engagementTrend: number;
  /** Computed satisfaction signal — how happy is the user with the experience? */
  satisfaction?: {
    score: number;           // 0-1
    trend: "rising" | "stable" | "declining";
    last_computed_turn: number;
  };
  /**
   * Baseline stats snapshot from previous modules. Set once at module init,
   * never updated during the module's lifetime. Current module's turn stats
   * are ADDED to this baseline to compute derived fields.
   */
  _importedBaseline?: {
    typedCount: number;
    clickedCount: number;
    totalAssumptions: number;
    deferredAssumptions: number;
    changedAssumptions: number;
    responseLengths: number[];
  };
  /**
   * Combined raw stats (baseline + current module). Updated every turn.
   * The NEXT module reads this to set its _importedBaseline at init time.
   */
  _rawStats?: {
    typedCount: number;
    clickedCount: number;
    totalAssumptions: number;
    deferredAssumptions: number;
    changedAssumptions: number;
    responseLengths: number[];
  };
}

// ─── The full ledger ───

export interface UserPsychologyLedger {
  /** LLM reads accumulated across turns. Most recent last. */
  reads: UserPsychologyRead[];
  /** Service-computed interaction heuristics. Updated after each turn. */
  heuristics: UserInteractionHeuristics;
  /** Accumulated hypotheses about the user — deduplicated, confidence-tracked */
  hypothesisStore: UserHypothesis[];
  /** Last N turns of offered-vs-responded assumption tracking */
  assumptionDeltas: AssumptionDelta[];
}

/** Empty ledger for initialization */
export function createEmptyLedger(): UserPsychologyLedger {
  return {
    reads: [],
    heuristics: {
      typeRatio: 0.5,
      avgResponseLength: 0,
      deferralRate: 0,
      changeRate: 0,
      totalInteractions: 0,
      engagementTrend: 0,
    },
    hypothesisStore: [],
    assumptionDeltas: [],
  };
}
