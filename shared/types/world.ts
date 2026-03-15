// ═══ World Module Types ═══
// The World module builds the constraint layer for later plot/scene modules.
// It inherits from Hook + Character + CharacterImage and produces the "stage"
// on which the story plays out: locations, rules, factions, consequences, canon.
//
// Design principle: world as SIMULATION FRAME, not prose worldbuilding.
// Everything here should constrain or enable downstream generation.

// ─── World Clarifier ───

export interface WorldClarifierOption {
  id: string;        // "A" | "B" | "C" | "D" | "E"
  label: string;     // max ~60 chars
}

export interface WorldAssumption {
  id: string;                    // "a1", "a2", etc.
  category: string;              // e.g. "arena", "rule", "faction", "consequence", "scope", "resource"
  assumption: string;            // what the engine assumed about the world
  alternatives: string[];        // 2–4 wildly different options
}

export interface WorldAssumptionResponse {
  assumptionId: string;
  category: string;
  action: "keep" | "alternative" | "freeform" | "not_ready";
  originalValue: string;
  newValue: string;
}

// ─── Constraint Ledger (world decisions) ───

export interface WorldLedgerEntry {
  key: string;                   // scoped: "arena.backroom.access", "rule.institutional.audit_schedule", "faction.corporate.goal"
  value: string;
  source: "user_chose" | "user_typed" | "user_kept_assumption" | "user_changed_assumption" | "user_freeform" | "llm_inferred" | "hook_imported" | "character_imported";
  confidence: "confirmed" | "inferred" | "imported";
  turnNumber: number;
  assumptionId?: string;
}

// ─── World Scope ───

export interface WorldScope {
  reality_level: string;          // "realistic" | "heightened" | "magical" | "sci_fi" | "surreal"
  tone_rule: string;             // 1-sentence: what's normal vs absurd in this world
  violence_level: string;         // "none" | "implied" | "moderate" | "graphic"
  time_pressure: string;         // what's the clock? "2 weeks until audit" / "graduation in 3 months" / "no explicit deadline"
  camera_rule: string;           // POV constraint: "close third on protagonist" / "omniscient" / "rotating POV"
}

// ─── Arena (locations as a graph of affordances) ───

export interface ArenaLocation {
  id: string;                    // "backroom", "store_floor", "parking_lot", etc.
  name: string;                  // display name
  description: string;           // 1-2 sentences: what it feels like, not what it looks like
  affordances: string[];         // what can happen here that can't happen elsewhere
  access: string;                // who can be here and when: "manager_only", "public_hours", "anyone"
  emotional_register: string;    // what kind of scenes play well here: "confrontation", "intimacy", "revelation"
  characters_associated?: string[]; // (optional — trimmed from schema to reduce grammar size)
  scene_types?: string[];         // (optional — trimmed from schema)
}

export interface ArenaEdge {
  from: string;                  // location id
  to: string;                    // location id
  traversal: string;             // what moving between these spaces means: "visible to everyone", "requires key", "through the crowd"
  tension_potential?: string;     // (optional — trimmed from schema)
}

export interface Arena {
  locations: ArenaLocation[];
  edges: ArenaEdge[];
  primary_stage: string;         // location id: where most scenes will happen
  hidden_stage: string;          // location id: the space that matters but isn't obvious
}

// ─── World Rules ───

export interface WorldRule {
  id: string;                    // "r1", "r2", etc.
  domain: string;                 // "physical" | "institutional" | "social" | "technological"
  rule: string;                  // the constraint, stated clearly: "Security cameras cover every aisle but the loading dock"
  consequence_if_broken: string; // what happens if someone violates this: "footage reviewed within 24h by corporate"
  who_enforces: string;          // faction or character role responsible
  exploit_potential?: string;     // (optional — trimmed from schema)
}

// ─── Factions / Power Map ───

export interface Faction {
  id: string;                    // "corporate", "regulators", "community", etc.
  name: string;                  // display name
  goal: string;                  // what they want
  methods: string[];             // how they pursue it (2-4 methods)
  resources?: string[];           // (optional — trimmed from schema)
  constraints: string[];         // what limits them
  associated_characters?: string[]; // (optional — trimmed from schema)
  pressure_on_protagonist: string; // how this faction creates problems for the protagonist specifically
  internal_tensions?: string[];   // (optional — trimmed from schema)
}

// ─── Consequence Patterns (pressure vectors, not deterministic IF/THEN) ───

export interface ConsequencePattern {
  id: string;                    // "c1", "c2", etc.
  trigger: string;               // what kind of action sets this off: "protagonist misses a delivery deadline"
  world_response: string;        // what the world does: "corporate sends a surprise inspection team"
  second_order?: string;          // (optional — trimmed from schema)
  escalation_speed: string;       // how fast this plays out
  reversible: boolean;           // can the characters undo this?
}

// ─── Canon Register (immutable facts from all modules + new world facts) ───

export interface CanonFact {
  id: string;                    // "cf1", "cf2", etc.
  fact: string;                  // 1-line immutable statement
  source_module: string;          // "hook" | "character" | "character_image" | "world"
  category?: string;              // (optional — trimmed from schema)
  locked_at_turn?: number;        // (optional — trimmed from schema)
}

// ─── Development Debt Ledger (weakness tracking across modules) ───

export interface DevelopmentTarget {
  id: string;                    // "dt1", "dt2", etc.
  source_module: "hook" | "character" | "character_image" | "world";
  target: string;                // what's weak: "antagonist moral logic", "protagonist lacks clear competence"
  status: "unaddressed" | "partially_addressed" | "addressed" | "deferred";
  addressed_by?: string;         // which module/turn addressed it
  notes?: string;                // how it was addressed
  /** Which downstream module is best positioned to address this */
  best_module_to_address?: "character" | "character_image" | "world" | "plot" | "scene" | "dialogue";
  /** What specifically is missing or weak right now */
  current_gap?: string;
  /** Concrete actionable suggestion for how to address it */
  suggestion?: string;
  /** Quality of the fix when status is addressed or partially_addressed */
  quality?: "weak" | "partial" | "strong";
}

// ─── Clarifier Response ───

export interface WorldClarifierResponse {
  psychology_strategy: string;
  hypothesis_line: string;       // evolving world-building read
  question: string;
  options: WorldClarifierOption[];
  allow_free_text: boolean;
  world_focus: string | null;    // what aspect of the world being shaped: "arena", "rules", "factions", "consequences", null if general
  ready_for_world: boolean;
  readiness_pct: number;
  readiness_note: string;
  missing_signal: string;
  conflict_flag: string;
  assumptions: WorldAssumption[];
  /** Structured behavior signals about the user */
  user_read: import("./userPsychology").StructuredUserRead;
}

// ─── Information Access (truth matrix) ───

export interface InformationLayer {
  id: string;                    // "il1", "il2", etc.
  truth: string;                 // the actual fact
  who_knows: string[];           // character roles who know this
  who_suspects?: string[];        // (optional — trimmed from schema)
  who_is_wrong?: string[];        // (optional — trimmed from schema)
  dramatic_irony: string;        // what the READER knows that characters don't
}

// ─── Volatility Points (live wires) ───

export interface VolatilityPoint {
  id: string;                    // "vp1", "vp2", etc.
  element: string;               // what could change: "the court's unified silence", "the envoy's willingness to lie"
  trigger: string;               // what would cause it to change
  consequence: string;           // what happens if it does change
  likelihood?: string;            // (optional — trimmed from schema)
}

// ─── Builder Output ───

export interface WorldBuilderOutput {
  scope: WorldScope;
  arena: Arena;
  rules: WorldRule[];
  factions: Faction[];
  consequence_patterns: ConsequencePattern[];
  canon_register: CanonFact[];
  information_access: InformationLayer[];  // who knows what — for generating dramatic irony
  volatility: VolatilityPoint[];  // things in this world that could change — live wires for scene generation
  /** How the world serves the hook's emotional promise */
  world_thesis: string;          // 1-2 sentences: the design intent
  /** What the world does to the characters */
  pressure_summary: string;      // 1-2 sentences: how this world squeezes these specific characters
}

// ─── Judge Output ───

export interface WorldJudgeScores {
  constraint_density: number;    // enough rules to generate distinct scenes? (not generic)
  arena_distinction: number;     // are locations mechanically different? (not just name changes)
  faction_pressure: number;      // do factions create real pressure on characters? (not decorative)
  internal_consistency: number;  // do rules contradict each other or locked packs?
  consequence_realism: number;   // are consequence patterns believable and story-useful?
  user_fit: number;              // matches user behavior signals?
  scene_variety: number;         // can varied scenes be generated? or will every scene look the same?
  information_asymmetry: number; // do characters operate on different information? dramatic irony?
}

export interface WorldJudgeOutput {
  pass: boolean;
  hard_fail_reasons: string[];
  scores: WorldJudgeScores;
  weakest_element: string;       // "arena" | "rules" | "factions" | "consequences"
  one_fix_instruction: string;
  /** Weaknesses for downstream modules to develop */
  weaknesses?: Array<{
    area: string;                // "arena", "rules", "factions", "consequences", "scope"
    weakness: string;
    development_opportunity: string;
  }>;
  /** Assessment of whether upstream targets were addressed */
  upstream_target_assessment?: Array<{
    target_id: string;
    status: "addressed" | "partially_addressed" | "unaddressed";
    notes?: string;
  }>;
}

// ─── World Pack (module handoff) ───

export interface WorldPack {
  module: "world";
  locked: {
    scope: WorldScope;
    arena: Arena;
    rules: WorldRule[];
    factions: Faction[];
    consequence_patterns: ConsequencePattern[];
    canon_register: CanonFact[];
    information_access: InformationLayer[];
    volatility: VolatilityPoint[];
    world_thesis: string;
    pressure_summary: string;
  };
  preferences: {
    tone_chips: string[];
    bans: string[];
  };
  /** Accumulated development debt — unresolved weaknesses from ALL prior modules */
  development_targets: DevelopmentTarget[];
  /** Weaknesses specific to the world output */
  weaknesses?: Array<{
    area: string;
    weakness: string;
    development_opportunity: string;
  }>;
  user_style: {
    control_preference: "director" | "explorer" | "mixed";
    typed_vs_clicked: "mostly_typed" | "mostly_clicked" | "mixed";
    total_turns: number;
  };
  state_summary: string;
  /** Reference to character image module's export (optional if skipped) */
  characterImagePack_reference?: { characterImageProjectId: string };
  /** Reference to character module's export */
  characterPack_reference: { characterProjectId: string };
  /** Reference to hook module's export */
  hookPack_reference: { hookProjectId: string };
  /** User psychology ledger accumulated across all modules */
  psychologyLedger?: import("./userPsychology").UserPsychologyLedger;
}

// ─── Prompt Preview & History ───

export interface WorldPromptPreview {
  stage: "clarifier" | "builder" | "judge" | "polish" | "summary";
  system: string;
  user: string;
}

export interface WorldPromptOverrides {
  system?: string;
  user?: string;
}

export interface WorldPromptHistoryEntry {
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

export interface WorldSessionState {
  projectId: string;
  characterImageProjectId?: string;
  characterProjectId: string;
  hookProjectId: string;
  sourceCharacterImagePack?: import("./characterImage").CharacterImagePack;
  sourceCharacterPack: import("./character").CharacterPack;
  sourceHookPack: import("./hook").HookPack;
  worldSeed?: string;            // free-form opening: user's vision for the world
  turns: WorldTurn[];
  constraintLedger: WorldLedgerEntry[];
  revealedWorld?: WorldBuilderOutput;
  revealedJudge?: WorldJudgeOutput;
  /** Accumulated development targets from all prior modules */
  developmentTargets: DevelopmentTarget[];
  status: "clarifying" | "generating" | "revealed" | "locked";
  lastSavedAt?: string;
  promptHistory?: WorldPromptHistoryEntry[];
  consecutiveHighReadiness?: number;
  /** User psychology ledger — imported from charImage module + accumulated here */
  psychologyLedger?: import("./userPsychology").UserPsychologyLedger;
  /** Live build/judge progress — polled by frontend during generation */
  buildProgress?: import("./api").BuildProgress;
}

export interface WorldTurn {
  turnNumber: number;
  clarifierResponse: WorldClarifierResponse;
  userSelection: {
    type: "option" | "free_text" | "surprise_me";
    optionId?: string;
    label: string;
  } | null;
  assumptionResponses?: WorldAssumptionResponse[];
}
