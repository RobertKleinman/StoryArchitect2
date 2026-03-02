// ─── HookClarifier ───

export interface HookClarifierOption {
  id: string;        // "A" | "B" | "C" | "D" | "E"
  label: string;     // max ~60 chars
}

export interface HookAssumption {
  id: string;                   // "a1", "a2", etc.
  category: string;             // e.g. "setting", "tone", "character_role", "genre", "relationship", "scope"
  assumption: string;           // what the engine assumed, e.g. "The story is set in a medieval court"
  alternatives: string[];       // 2–4 wildly different options
}

// ─── Constraint Ledger ───

export interface ConstraintLedgerEntry {
  key: string;                  // dimension: "setting", "tone", "protagonist_gender", "protagonist_desire", etc.
  value: string;                // current value
  source: "user_chose" | "user_typed" | "user_kept_assumption" | "user_changed_assumption" | "user_freeform" | "llm_inferred";
  confidence: "confirmed" | "inferred";  // confirmed = user explicitly acted; inferred = LLM assumed, user hasn't weighed in
  turnNumber: number;           // when it was last set
  assumptionId?: string;        // if this came from an assumption response, which one
}

/** Structured assumption response from the user (sent from frontend, processed by backend) */
export interface AssumptionResponse {
  assumptionId: string;         // "a1", "a2", etc.
  category: string;             // mirrors the assumption's category
  action: "keep" | "alternative" | "freeform" | "not_ready";
  originalValue: string;        // the assumption text that was shown
  newValue: string;             // what the user chose (alternative text, freeform text, or original if kept)
}

export interface HookStateUpdate {
  hook_engine?: string;
  stakes?: string;
  taboo_or_tension?: string;
  opening_image_seed?: string;
  setting_anchor?: string;
  protagonist_role?: string;
  antagonist_form?: string;
  tone_chips?: string[];
  bans?: string[];
}

export interface HookClarifierResponse {
  hypothesis_line: string;
  question: string;
  options: HookClarifierOption[];
  allow_free_text: boolean;
  ready_for_hook: boolean;
  readiness_pct: number;
  readiness_note: string;
  missing_signal: string;
  conflict_flag: string;
  assumptions: HookAssumption[];
  state_update: HookStateUpdate;
  /** Structured hypotheses about the user + brief synthesis */
  user_read: {
    hypotheses: {
      hypothesis: string;
      evidence: string;
      confidence: "low" | "medium" | "high";
      scope: "this_story" | "this_genre" | "global";
    }[];
    overall_read: string;
  };
}

// ─── HookBuilder ───

export interface CollisionSource {
  source: string;
  element_extracted: string;
}

export interface HookBuilderOutput {
  hook_sentence: string;
  emotional_promise: string;
  premise: string;
  opening_image: string;
  page_1_splash_prompt: string;
  page_turn_trigger: string;
  why_addictive: [string, string, string];
  collision_sources: CollisionSource[];
}

// ─── HookJudge ───

export interface HookJudgeScores {
  specificity: number;
  drawability: number;
  page_turn: number;
  mechanism: number;
  freshness: number;
}

export interface HookJudgeOutput {
  pass: boolean;
  hard_fail_reasons: string[];
  scores: HookJudgeScores;
  most_generic_part: string;
  one_fix_instruction: string;
}

// ─── HookPack (module handoff) ───

export interface HookPack {
  module: "hook";
  locked: {
    hook_sentence: string;
    emotional_promise: string;
    premise: string;
    page1_splash: string;
    page_turn_trigger: string;
    core_engine: {
      hook_engine: string;
      stakes: string;
      taboo_or_tension: string;
      protagonist_role: string;
      antagonist_form: string;
      setting_anchor: string;
    };
  };
  preferences: {
    tone_chips: string[];
    bans: string[];
  };
  source_dna: CollisionSource[];
  open_threads: string[];
  /** Elements surfaced as assumptions but not used in the final hook — may be useful for later stages */
  unused_assumptions: Array<{ category: string; assumption: string; status: string }>;
  /** User behavior signals observed during clarification */
  user_style: {
    control_preference: "director" | "explorer" | "mixed";
    typed_vs_clicked: "mostly_typed" | "mostly_clicked" | "mixed";
    total_turns: number;
  };
  state_summary: string;
  /** User psychology ledger accumulated during hook module — carries to next module */
  psychologyLedger?: import("./userPsychology").UserPsychologyLedger;
}

// ─── Prompt Preview ───

export interface PromptPreview {
  stage: "clarifier" | "builder" | "judge" | "summary";
  system: string;
  user: string;
}

export interface PromptOverrides {
  system?: string;
  user?: string;
}

// ─── Prompt History (tracking edits for analysis) ───

export interface PromptHistoryEntry {
  timestamp: string;            // ISO
  stage: "clarifier" | "builder" | "judge" | "summary";
  turnNumber: number;
  /** The default prompt the system would have sent */
  defaultSystem: string;
  defaultUser: string;
  /** What was actually sent (only present if the user edited it) */
  editedSystem?: string;
  editedUser?: string;
  /** Whether the user made any edits */
  wasEdited: boolean;
  /** LLM response summary (first 500 chars) for context */
  responseSummary?: string;
}

// ─── Tournament Progress (crash recovery) ───

export interface TournamentProgress {
  startedAt: string;  // ISO timestamp
  builderResults: Array<{ raw: string; parsed: HookBuilderOutput | null }>;
  judgeResults: Array<{ raw: string; parsed: HookJudgeOutput | null }>;
  phase: "builders" | "judges" | "selecting";
}

// ─── Session state ───

export interface HookSessionState {
  projectId: string;
  seedInput: string;
  turns: HookTurn[];
  currentState: HookStateUpdate;
  /** Structured constraint ledger — deterministically updated from user actions */
  constraintLedger?: ConstraintLedgerEntry[];
  revealedHook?: HookBuilderOutput;
  revealedJudge?: HookJudgeOutput;
  hookPack?: HookPack;
  rerollCount: number;
  status: "clarifying" | "generating" | "revealed" | "locked";
  /** Crash recovery: in-progress tournament state */
  tournamentProgress?: TournamentProgress;
  /** Last saved timestamp for crash detection */
  lastSavedAt?: string;
  /** Prompt edit history for analysis and export */
  promptHistory?: PromptHistoryEntry[];
  /** Consecutive turns where readiness_pct >= 75 — used for convergence safety net */
  consecutiveHighReadiness?: number;
  /** User psychology ledger — accumulates LLM reads + interaction heuristics */
  psychologyLedger?: import("./userPsychology").UserPsychologyLedger;
}

export interface HookTurn {
  turnNumber: number;
  clarifierResponse: HookClarifierResponse;
  userSelection: {
    type: "option" | "free_text" | "surprise_me";
    optionId?: string;   // "A", "B", etc. — set when type is "option"
    label: string;       // display text: option label, free text, or "surprise_me"
  } | null;
  /** Structured assumption responses — processed by backend into the constraint ledger */
  assumptionResponses?: AssumptionResponse[];
}
