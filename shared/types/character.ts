// ─── Character Clarifier ───

export interface CharacterClarifierOption {
  id: string;        // "A" | "B" | "C" | "D" | "E"
  label: string;     // max ~60 chars
}

export interface CharacterAssumption {
  id: string;                    // "a1", "a2", etc.
  characterRole: string;         // which character: "protagonist", "antagonist", "supporting_1", or "relationship"
  category: string;              // e.g. "want", "misbelief", "stress_style", "relationship_dynamic"
  assumption: string;            // what the engine assumed
  alternatives: string[];        // 2–4 wildly different options
}

export interface CharacterAssumptionResponse {
  assumptionId: string;
  characterRole: string;
  category: string;
  action: "keep" | "alternative" | "freeform" | "not_ready";
  originalValue: string;
  newValue: string;
}

// ─── Constraint Ledger (reuse shape from hook, add character scoping) ───

export interface CharacterLedgerEntry {
  key: string;                   // scoped: "protagonist.want", "antagonist.moral_logic", "relationship.protagonist_antagonist"
  value: string;
  source: "user_chose" | "user_typed" | "user_kept_assumption" | "user_changed_assumption" | "user_freeform" | "llm_inferred" | "hook_imported";
  confidence: "confirmed" | "inferred" | "imported";
  turnNumber: number;
  assumptionId?: string;
}

// ─── Per-Character State ───

export interface CharacterStateUpdate {
  want?: string;
  want_urgency?: string;
  misbelief?: string;
  stakes?: string;
  break_point?: string;
  leverage?: string;
  secret?: string;
  secret_trigger?: string;
  sacrifice_threshold?: string;
  temptation?: string;
  stress_style?: string;
  optimization_function?: string;
  backstory?: string;
  competence?: string;
  vulnerability?: string;
  tell?: string;
  voice_pattern?: string;
  // Antagonist-specific
  moral_logic?: string;
  strategy_under_constraint?: string;
  targeted_attack?: string;
  // Supporting-specific
  role_function?: string;       // mirror | temptation | blocker | knife
  misread?: string;
  // Relationship context
  relationship_to_protagonist?: string;
  relationship_to_antagonist?: string;
}

// ─── Clarifier Response ───

export interface CharacterRelationshipUpdate {
  characterA: string;
  characterB: string;
  statedDynamic: string;         // what they'd say it is
  trueDynamic: string;           // what's actually going on
}

export interface CharacterSurfaced {
  role: string;                  // "protagonist", "antagonist", "supporting_1", etc.
  newToConversation: boolean;
  assumptions: CharacterAssumption[];
}

export interface CharacterClarifierResponse {
  psychology_strategy?: string;
  hypothesis_line: string;       // evolving cast dynamic, not just one character
  question: string;
  options: CharacterClarifierOption[];
  allow_free_text: boolean;
  character_focus: string | null; // which character/relationship being shaped this turn
  ready_for_characters: boolean;
  readiness_pct: number;
  readiness_note: string;
  missing_signal: string;
  conflict_flag: string;
  characters_surfaced: CharacterSurfaced[];
  relationship_updates: CharacterRelationshipUpdate[];
  state_updates: Record<string, CharacterStateUpdate>;  // keyed by role
  /** Structured hypotheses about the user + brief synthesis */
  user_read: {
    hypotheses: {
      hypothesis: string;
      evidence: string;
      confidence: "low" | "medium" | "high";
      scope: "this_story" | "this_genre" | "global";
    }[];
    overall_read: string;
    satisfaction?: {
      score: number;
      trend: "rising" | "stable" | "declining";
      note: string;
    };
  };
}

// ─── Builder Output ───

export interface CharacterProfile {
  role: string;
  description: string;           // 1-2 paragraphs, user-facing
  core_dials: {
    want: string;
    want_urgency: string;
    misbelief: string;
    stakes: string;
    break_point: string;
  };
  secondary_dials: {
    leverage: string;
    secret: string;
    secret_trigger: string;
    sacrifice_threshold: string;
    temptation: string;
    stress_style: string;
    optimization_function: string;
    backstory: string;
    competence: string;
    vulnerability: string;
    tell: string;
    voice_pattern: string;
  };
  // Role-specific (may be empty strings for non-applicable roles)
  antagonist_dials: {
    moral_logic: string;
    strategy_under_constraint: string;
    targeted_attack: string;
  };
  supporting_dials: {
    role_function: string;
    misread: string;
  };
  // Top-level character fields (new)
  threshold_statement: string;   // "I will never ___" — in their voice
  competence_axis: string;       // what they can reliably win at
  cost_type: string;             // what kind of loss destabilizes them
  volatility: string;            // how fast they destabilize + what accelerates it
}

export interface RelationshipTension {
  pair: [string, string];        // role ids
  stated_dynamic: string;        // what they'd say
  true_dynamic: string;          // what's really going on
  tension_mechanism: string;     // what creates pressure between them
}

export interface CharacterCollisionSource {
  source: string;
  element_extracted: string;
  applied_to: string;            // which character role
}

export interface CharacterBuilderOutput {
  characters: Record<string, CharacterProfile>;
  ensemble_dynamic: string;
  relationship_tensions: RelationshipTension[];
  structural_diversity: {
    diverse: boolean;
    explanation: string;
  };
  collision_sources: CharacterCollisionSource[];
}

// ─── Judge Output ───

export interface CharacterJudgeScores {
  psychological_depth: number;
  relationship_dynamics: number;
  diversity: number;
  mechanism_clarity: number;
  specificity: number;
}

export interface CharacterJudgeOutput {
  pass: boolean;
  hard_fail_reasons: string[];
  scores: CharacterJudgeScores;
  weakest_character: string;     // role id
  one_fix_instruction: string;
  /** Per-character weaknesses for downstream modules to develop further */
  weaknesses?: Array<{
    role: string;
    weakness: string;
    development_opportunity: string;
  }>;
}

// ─── Character Pack (module handoff) ───

export interface CharacterPack {
  module: "character";
  locked: {
    characters: Record<string, {
      role: string;
      description: string;
      psychological_profile: CharacterProfile["core_dials"] & CharacterProfile["secondary_dials"];
      antagonist_dials?: CharacterProfile["antagonist_dials"];
      supporting_dials?: CharacterProfile["supporting_dials"];
      threshold_statement: string;
      competence_axis: string;
      cost_type: string;
      volatility: string;
    }>;
    ensemble_dynamic: string;
    relationship_tensions: RelationshipTension[];
    cast_count: number;
  };
  preferences: {
    tone_chips: string[];
    bans: string[];
  };
  source_dna: CharacterCollisionSource[];
  /** Weaknesses identified by the judge — downstream modules should develop these */
  weaknesses?: Array<{
    role: string;
    weakness: string;
    development_opportunity: string;
  }>;
  user_style: {
    control_preference: "director" | "explorer" | "mixed";
    typed_vs_clicked: "mostly_typed" | "mostly_clicked" | "mixed";
    total_turns: number;
  };
  state_summary: string;
  /** Reference to the hook module's export — load separately by ID, not embedded */
  hookpack_reference: { hookProjectId: string };
}

// ─── Prompt Preview & History (reuse pattern) ───

export interface CharacterPromptPreview {
  stage: "clarifier" | "builder" | "judge" | "polish" | "summary";
  system: string;
  user: string;
}

export interface CharacterPromptOverrides {
  system?: string;
  user?: string;
}

export interface CharacterPromptHistoryEntry {
  timestamp: string;
  stage: "clarifier" | "builder" | "judge" | "polish" | "summary";
  turnNumber: number;
  defaultSystem: string;
  defaultUser: string;
  editedSystem?: string;
  editedUser?: string;
  wasEdited: boolean;
  responseSummary?: string;
}

// ─── Session State ───

export interface CharacterSessionState {
  projectId: string;
  hookProjectId: string;
  sourceHook: import("./hook").HookPack;
  seedInput: string;              // original seed from hook module, for context
  characterSeed?: string;         // free-form opening answer: "what sort of characters do you want?"
  characters: Record<string, CharacterStateUpdate>;  // keyed by role
  activeFocus: string | null;     // current character/relationship being shaped
  turns: CharacterTurn[];
  constraintLedger: CharacterLedgerEntry[];
  revealedCharacters?: CharacterBuilderOutput;
  revealedJudge?: CharacterJudgeOutput;
  /** characterPack is no longer stored on session — it's saved as an export via charStore.saveExport() */
  status: "clarifying" | "generating" | "revealed" | "locked";
  lastSavedAt?: string;
  promptHistory?: CharacterPromptHistoryEntry[];
  consecutiveHighReadiness?: number;
  /** User psychology ledger — imported from hook module + accumulated here */
  psychologyLedger?: import("./userPsychology").UserPsychologyLedger;
}

export interface CharacterTurn {
  turnNumber: number;
  clarifierResponse: CharacterClarifierResponse;
  userSelection: {
    type: "option" | "free_text" | "surprise_me";
    optionId?: string;
    label: string;
  } | null;
  assumptionResponses?: CharacterAssumptionResponse[];
}
