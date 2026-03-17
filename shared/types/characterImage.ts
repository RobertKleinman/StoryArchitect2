// ─── Character Image Clarifier ───

export interface CharacterImageClarifierOption {
  id: string;        // "A" | "B" | "C" | "D" | "E"
  label: string;     // max ~60 chars
}

export interface CharacterImageAssumption {
  id: string;                    // "a1", "a2", etc.
  characterRole: string;         // which character: "protagonist", "antagonist", "supporting_1", or "ensemble"
  category: string;              // e.g. "color_palette", "silhouette", "expression", "pose", "garment", "distinguishing_mark", "visual_vibe"
  assumption: string;            // what the engine assumed visually
  alternatives: string[];        // 2–4 wildly different visual options
}

export interface CharacterImageAssumptionResponse {
  assumptionId: string;
  characterRole: string;
  category: string;
  action: "keep" | "alternative" | "freeform" | "not_ready";
  originalValue: string;
  newValue: string;
}

// ─── Constraint Ledger (visual decisions) ───

export interface CharacterImageLedgerEntry {
  key: string;                   // scoped: "protagonist.color_palette", "antagonist.silhouette", "ensemble.art_style"
  value: string;
  source: "user_chose" | "user_typed" | "user_kept_assumption" | "user_changed_assumption" | "user_freeform" | "llm_inferred" | "character_imported";
  confidence: "confirmed" | "inferred" | "imported";
  turnNumber: number;
  assumptionId?: string;
}

// ─── Visual Anchors (per-character visual identity) ───

export interface VisualAnchor {
  hair_description: string;       // style, color, length, distinctive features
  eyes_description: string;       // color, shape, expression default
  signature_garment: string;      // the ONE outfit piece that defines them
  distinguishing_marks: string;   // scars, tattoos, accessories, etc.
  body_type: string;              // build, proportions
  pose_baseline: string;          // default stance/posture
  expression_baseline: string;    // resting emotional state
  color_palette: string[];        // 3-5 dominant colors
  visual_vibe: string;            // 1-sentence mood/energy
}

// ─── Visual Description (builder output per character) ───

export interface VisualDescription {
  role: string;
  full_body_description: string;  // detailed text description for review
  visual_anchors: VisualAnchor;
  /** Natural language prompt for the anime-gen API (Grok converts to tags) */
  image_generation_prompt: string;
}

// ─── Clarifier Response ───

export interface CharacterImageClarifierResponse {
  psychology_strategy: string;
  hypothesis_line: string;       // evolving visual identity read
  question: string;
  options: CharacterImageClarifierOption[];
  allow_free_text: boolean;
  character_focus: string | null; // which character's visuals being shaped this turn
  ready_for_images: boolean;
  readiness_pct: number;
  readiness_note: string;
  missing_signal: string;
  conflict_flag: string;
  assumptions: CharacterImageAssumption[];
  /** Structured behavior signals about the user */
  user_read: import("./userPsychology").StructuredUserRead;
}

// ─── Builder Output ───

export interface CharacterImageBuilderOutput {
  characters: Record<string, VisualDescription>;
  ensemble_cohesion_note: string;   // how the cast visually fits together
  style_recommendation: string;     // recommended checkpoint/style
  style_reasoning: string;          // why this style fits the story
}

// ─── Judge Output ───

export interface CharacterImageJudgeScores {
  visual_distinctiveness: number;   // can you tell them apart?
  psychology_match: number;         // do they look like who they are?
  ensemble_cohesion: number;        // same art style/world?
  tone_fit: number;                 // matches story mood?
  user_fit: number;                 // matches user behavior signals?
}

export interface CharacterImageJudgeOutput {
  pass: boolean;
  hard_fail_reasons: string[];
  scores: CharacterImageJudgeScores;
  distinctiveness_notes: string;    // specific notes on character differentiation
  one_fix_instruction: string;
}

// ─── Generated Image (actual anime-gen output per character) ───

export interface GeneratedCharacterImage {
  role: string;
  checkpoint: string;
  lora: string | null;
  quality: string;
  seed: number;
  /** @deprecated Use image_ref instead. Kept for migration-on-load compat. */
  image_base64?: string;
  /** Path to extracted base64 file (relative to data dir), replaces inline image_base64 */
  image_ref?: string;
  enhanced_prompt: string;         // what anime-gen actually used (tag-expanded)
  generation_time_ms: number;
  approved: boolean;
  reroll_count: number;
}

// ─── Character Image Pack (module handoff) ───

export interface CharacterImagePack {
  module: "character_image";
  /** When true, the character image module was skipped (no visual design or images generated).
   *  Downstream modules should treat this pack as a passthrough from the character module. */
  skipped?: boolean;
  locked: {
    characters: Record<string, {
      role: string;
      visual_description: VisualDescription;
      /** @deprecated Use image_ref instead */
      image_base64?: string;
      /** Path to extracted base64 file */
      image_ref?: string;
      enhanced_prompt: string;
    }>;
    ensemble_cohesion_note: string;
    cast_count: number;
  };
  generation_settings: {
    checkpoint: string;
    lora: string | null;
    quality: string;
  };
  style_used: string;
  preferences: {
    tone_chips: string[];
    bans: string[];
  };
  user_style: {
    control_preference: "director" | "explorer" | "mixed";
    typed_vs_clicked: "mostly_typed" | "mostly_clicked" | "mixed";
    total_turns: number;
  };
  state_summary: string;
  /** Reference to character module's export — load separately by ID */
  characterpack_reference: { characterProjectId: string };
  /** User psychology ledger accumulated across all modules */
  psychologyLedger?: import("./userPsychology").UserPsychologyLedger;
}

// ─── Prompt Preview & History ───

export interface CharacterImagePromptPreview {
  stage: "clarifier" | "builder" | "judge" | "summary";
  system: string;
  user: string;
}

export interface CharacterImagePromptOverrides {
  system?: string;
  user?: string;
}

export interface CharacterImagePromptHistoryEntry {
  timestamp: string;
  stage: "clarifier" | "builder" | "judge" | "summary";
  turnNumber: number;
  defaultSystem: string;
  defaultUser: string;
  editedSystem?: string;
  editedUser?: string;
  wasEdited: boolean;
  responseSummary?: string;
  provider?: string;
  model?: string;
}

// ─── Session State ───

export interface CharacterImageSessionState {
  schemaVersion?: number;
  projectId: string;
  characterProjectId: string;
  sourceCharacterPack: import("./character").CharacterPack;
  visualSeed?: string;             // free-form opening: "what visual style do you have in mind?"
  /** User's chosen art style — set between clarifier and builder */
  artStylePreference?: {
    style: string;        // e.g. "soft-painterly", "cel-shaded", "gritty-realistic"
    customNote?: string;  // optional user freeform addition
  };
  turns: CharacterImageTurn[];
  constraintLedger: CharacterImageLedgerEntry[];
  revealedSpecs?: CharacterImageBuilderOutput;
  revealedJudge?: CharacterImageJudgeOutput;
  generatedImages: Record<string, GeneratedCharacterImage>;  // keyed by role
  /** Model/quality locked after first approved image */
  modelPreferences?: {
    checkpoint: string;
    lora: string | null;
    quality: string;
  };
  status: "seeding" | "clarifying" | "generating" | "revealed" | "generating_images" | "image_review" | "locked";
  lastSavedAt?: string;
  promptHistory?: CharacterImagePromptHistoryEntry[];
  consecutiveHighReadiness?: number;
  /** User psychology ledger — imported from character module + accumulated here */
  psychologyLedger?: import("./userPsychology").UserPsychologyLedger;
}

export interface CharacterImageTurn {
  turnNumber: number;
  clarifierResponse: CharacterImageClarifierResponse;
  userSelection: {
    type: "option" | "free_text" | "surprise_me";
    optionId?: string;
    label: string;
  } | null;
  assumptionResponses?: CharacterImageAssumptionResponse[];
}
