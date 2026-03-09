/**
 * User Psychology Ledger — accumulates across modules.
 * Drives adaptive engine behavior: question style, option density,
 * assumption boldness, pacing, and emotional targeting.
 *
 * v2: Structured hypothesis store replaces freeform observation strings.
 *     Non-choice (assumption delta) tracking added.
 * v3: Hypothesis categories, satisfaction signal, assumption persistence tracking.
 * v4: BehaviorSignal replaces UserHypothesis.
 *     - Evidence must reference specific turns + actions (not prose)
 *     - Confidence is numeric (0–1), computed by backend from evidence count + recency + contradictions
 *     - Signal lifecycle: candidate → active → stable → suppressed
 *     - Each signal carries an adaptation_consequence (LLM-authored natural language)
 *     - Contradiction criteria are machine-checkable
 *     - psychology_strategy replaced by structured AdaptationPlan
 *     - overall_read replaced by behavior_summary (structured)
 */

// ─── Signal categories (unchanged) ───

export type SignalCategory =
  | "content_preferences"      // explicit themes, genres, aesthetics
  | "control_orientation"      // do they want to drive or be surprised?
  | "power_dynamics"           // hierarchy, authority, submission patterns
  | "tonal_risk"               // how far they push boundaries
  | "narrative_ownership"      // how protective of their vision?
  | "engagement_satisfaction"; // how they're feeling about the experience

/** @deprecated Use SignalCategory — kept for back-compat during migration */
export type HypothesisCategory = SignalCategory;

// ─── Signal lifecycle ───

export type SignalStatus =
  | "candidate"   // first impression, < 2 evidence events
  | "active"      // 2+ evidence events, no contradictions
  | "stable"      // 4+ evidence events across 3+ turns, high confidence
  | "suppressed"; // contradicted or decayed

// ─── Evidence event (references a specific user action) ───

export interface EvidenceEvent {
  /** Turn number where the evidence occurred */
  turn: number;
  /** Module where observed */
  module: "hook" | "character" | "character_image" | "world";
  /** What the user actually did */
  action: string;   // e.g. "chose 'dark romance' chip", "typed 'I want the villain to be sympathetic'"
  /** Whether this supports or contradicts the signal */
  valence: "supports" | "contradicts";
}

// ─── BehaviorSignal (replaces UserHypothesis) ───

export interface BehaviorSignal {
  /** Stable ID for tracking across turns ("s1", "s2", etc.) */
  id: string;
  /** The observation/inference — concrete, not literary. Max ~20 words. */
  hypothesis: string;
  /** Specific user actions that support or contradict this signal */
  evidenceEvents: EvidenceEvent[];
  /**
   * Numeric confidence, 0–1. Computed by backend from:
   *   - Evidence count (more events = higher)
   *   - Recency (recent evidence weighted more)
   *   - Contradictions (reduce confidence)
   *   - Turn number (early turns capped)
   * LLM never sets this directly.
   */
  confidence: number;
  /** How broadly this applies */
  scope: "this_story" | "this_genre" | "global";
  /** Which behavioral dimension */
  category: SignalCategory;
  /** Signal lifecycle status — managed by backend */
  status: SignalStatus;
  /** What the pipeline should DO differently because of this signal.
   *  LLM-authored natural language, e.g. "offer more morally complex antagonist options"
   *  Updated when new evidence arrives. */
  adaptationConsequence: string;
  /** Machine-checkable: what user action would CONTRADICT this signal?
   *  e.g. "user chooses simple/clear morality options 2+ times" */
  contradictionCriteria: string;
  /** Turn number when first surfaced */
  firstSeen: number;
  /** Turn number when last updated */
  lastUpdated: number;
  /** If suppressed, why */
  suppressionReason?: string;
}

// ─── Backward compat alias ───
/** @deprecated Use BehaviorSignal */
export type UserHypothesis = BehaviorSignal;

// ─── LLM raw output (what the LLM produces each turn — backend processes this) ───

/**
 * Raw signal observation from the LLM. The LLM does NOT set confidence or status —
 * those are computed by the backend. The LLM provides the insight + evidence + consequences.
 */
export interface RawSignalObservation {
  /** The observation — concrete, specific, max ~20 words */
  hypothesis: string;
  /** What specific user action supports this — must reference the turn */
  action: string;
  /** Does this support or contradict a prior signal? */
  valence: "supports" | "contradicts";
  /** How broadly this applies */
  scope: "this_story" | "this_genre" | "global";
  /** Which behavioral dimension */
  category: SignalCategory;
  /** What the pipeline should do differently because of this */
  adaptationConsequence: string;
  /** What would contradict this signal? */
  contradictionCriteria: string;
  /** If contradicting a prior signal, which signal ID? */
  contradictsSignalId?: string;
}

/**
 * Structured behavior summary — replaces freeform overall_read.
 * The LLM produces this each turn as a structured assessment.
 */
export interface BehaviorSummary {
  /** 1-sentence summary of user's current creative orientation */
  orientation: string;
  /** What the user is most invested in right now (1-2 words) */
  currentFocus: string;
  /** Are they exploring, converging, stuck, or disengaged? */
  engagementMode: "exploring" | "converging" | "stuck" | "disengaged";
  /** Satisfaction assessment */
  satisfaction: {
    score: number;           // 0–1
    trend: "rising" | "stable" | "declining";
    reason: string;          // max ~15 words, what tells you this
  };
}

/**
 * Structured adaptation plan — replaces freeform psychology_strategy.
 * Machine-checkable: each item maps to a concrete pipeline behavior.
 */
export interface AdaptationPlan {
  /** What is the user's dominant need this turn? */
  dominantNeed: string;
  /** Concrete moves for this turn (2-4 items) */
  moves: AdaptationMove[];
}

export interface AdaptationMove {
  /** What to do — concrete and specific */
  action: string;
  /** Which signal(s) drive this move (signal IDs) */
  drivenBy: string[];
  /** Which pipeline stage this affects */
  target: "question" | "options" | "assumptions" | "builder_tone" | "builder_content" | "judge_criteria";
}

/**
 * What the LLM outputs each turn — structured signals + summary + plan.
 * Replaces StructuredUserRead.
 */
export interface StructuredUserRead {
  /** Raw signal observations — backend processes these into BehaviorSignals */
  signals: RawSignalObservation[];
  /** Structured behavior summary */
  behaviorSummary: BehaviorSummary;
  /** Structured adaptation plan */
  adaptationPlan: AdaptationPlan;

  // ─── Backward compat (deprecated, will be removed) ───
  /** @deprecated Use signals */
  hypotheses?: {
    hypothesis: string;
    evidence: string;
    confidence: "low" | "medium" | "high";
    scope: "this_story" | "this_genre" | "global";
    category?: SignalCategory;
  }[];
  /** @deprecated Use behaviorSummary.orientation */
  overall_read?: string;
  /** @deprecated Use behaviorSummary.satisfaction */
  satisfaction?: {
    score: number;
    trend: "rising" | "stable" | "declining";
    note: string;
  };
}

// ─── Per-turn read record (stored in ledger.reads) ───

export interface UserPsychologyRead {
  turnNumber: number;
  module: "hook" | "character" | "character_image" | "world";
  /** Raw signal observations from this turn */
  signals: RawSignalObservation[];
  /** Structured behavior summary */
  behaviorSummary: BehaviorSummary;
  /** Structured adaptation plan */
  adaptationPlan: AdaptationPlan;

  // ─── Backward compat ───
  /** @deprecated */
  hypotheses?: {
    hypothesis: string;
    evidence: string;
    confidence: "low" | "medium" | "high";
    scope: string;
    category?: SignalCategory;
  }[];
  /** @deprecated */
  overall_read?: string;
}

// ─── Assumption delta (non-choice tracking — unchanged) ───

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

// ─── Psychology consolidation (background think-time step) ───

/**
 * LLM-produced consolidation output. Runs during user think-time after each
 * clarifier response. The LLM decides what's worth doing — all fields optional
 * except `updatedSignals`. This is adaptive, not a fixed checklist.
 */
export interface ConsolidationResult {
  /**
   * The merged/pruned signal list. This REPLACES the current signalStore.
   * The LLM may merge semantically similar signals, boost confidence for
   * converging evidence, or drop dead weight. It returns the full list
   * because partial diffs are error-prone.
   */
  updatedSignals: ConsolidatedSignal[];

  /**
   * Optional: the most important unresolved ambiguity about this user.
   * Only present when the LLM judges there's a meaningful fork worth testing.
   */
  unresolvedAmbiguity?: {
    description: string;
    whyItMatters: string;
    signalIds: string[];
  };

  /**
   * Optional: a story-framed probe the next clarifier can weave in naturally.
   * This is a HINT, not a command. The clarifier may ignore it if the creative
   * moment doesn't fit.
   */
  suggestedProbe?: {
    /** A story question or assumption angle — not a psych test */
    angle: string;
    /** Which signal this would help disambiguate */
    targetSignalIds: string[];
    /** What each possible user response would tell us */
    interpretationGuide: string;
  };

  /**
   * Optional: brief reasoning about what the consolidation did and why.
   * Stored for debugging, never shown to user.
   */
  reasoning?: string;
}

/**
 * A signal as output by the consolidation LLM. Similar to BehaviorSignal
 * but the LLM sets confidence/status directly (it has the full picture).
 */
export interface ConsolidatedSignal {
  /** Keep the original ID if this signal existed, or "merged_N" for merges */
  id: string;
  /** Tightened hypothesis — may be a rewrite of the original */
  hypothesis: string;
  /** IDs of signals that were merged into this one (empty if unchanged) */
  absorbedIds: string[];
  /** LLM-assessed confidence after considering all evidence (0-1) */
  confidence: number;
  /** LLM-assessed status */
  status: SignalStatus;
  category: SignalCategory;
  scope: "this_story" | "this_genre" | "global";
  /** Updated adaptation consequence */
  adaptationConsequence: string;
  /** Updated contradiction criteria */
  contradictionCriteria: string;
}

/**
 * Stored on the ledger: the last consolidation result + metadata.
 * The next clarifier reads the suggestedProbe from here.
 */
export interface ConsolidationSnapshot {
  /** When this consolidation ran */
  timestamp: string;
  /** Which turn it ran after */
  afterTurn: number;
  /** Which module was active */
  module: "hook" | "character" | "character_image" | "world";
  /** The full result */
  result: ConsolidationResult;
  /** Whether the suggestedProbe was consumed by the next clarifier turn */
  probeConsumed: boolean;
}

// ─── The full ledger ───

export interface UserPsychologyLedger {
  /** LLM reads accumulated across turns. Most recent last. */
  reads: UserPsychologyRead[];
  /** Service-computed interaction heuristics. Updated after each turn. */
  heuristics: UserInteractionHeuristics;
  /** Accumulated behavior signals — deduplicated, lifecycle-managed */
  signalStore: BehaviorSignal[];
  /** Last N turns of offered-vs-responded assumption tracking */
  assumptionDeltas: AssumptionDelta[];
  /** Last background consolidation result. Updated async during user think-time. */
  lastConsolidation?: ConsolidationSnapshot;

  // ─── Backward compat ───
  /** @deprecated Use signalStore */
  hypothesisStore?: BehaviorSignal[];
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
    signalStore: [],
    assumptionDeltas: [],
  };
}
