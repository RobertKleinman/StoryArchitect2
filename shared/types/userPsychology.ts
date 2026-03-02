/**
 * User Psychology Ledger — accumulates across modules.
 * Drives adaptive engine behavior: question style, option density,
 * assumption boldness, pacing, and emotional targeting.
 */

// ─── LLM-assessed signal (one per clarifier turn) ───

export interface UserPsychologyRead {
  turnNumber: number;
  module: "hook" | "character";
  /** Free-form LLM observation about this user: what excites them, what they gravitate
   *  toward, engagement shifts, narrative preferences, emotional drivers.
   *  Max 2-3 sentences. The LLM self-assesses confidence within the text. */
  observation: string;
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
  /** LLM observations accumulated across turns. Most recent last. */
  reads: UserPsychologyRead[];
  /** Service-computed interaction heuristics. Updated after each turn. */
  heuristics: UserInteractionHeuristics;
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
  };
}
