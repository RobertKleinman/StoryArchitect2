/**
 * User Psychology Ledger — accumulates across modules.
 * Drives adaptive engine behavior: question style, option density,
 * assumption boldness, pacing, and emotional targeting.
 *
 * v2: Structured hypothesis store replaces freeform observation strings.
 *     Non-choice (assumption delta) tracking added.
 */

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
  }[];
  overall_read: string;
}

/** Stored record of each turn's LLM read */
export interface UserPsychologyRead {
  turnNumber: number;
  module: "hook" | "character";
  /** Structured hypotheses from the LLM */
  hypotheses: {
    hypothesis: string;
    evidence: string;
    confidence: "low" | "medium" | "high";
    scope: string;
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
