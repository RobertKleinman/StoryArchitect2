// ═══ Scene Module Types ═══
// Module #6 in the pipeline: Hook → Character → CharacterImage → World → Plot → Scene
//
// The Scene module transforms the plot's tension spine into playable VN scenes.
// It clusters beats into scenes, stages them with dramatic specificity, and
// produces structured VN output (speaker lines, stage directions, emotions).
//
// Three-phase flow:
//   Phase 0: PLANNING — cluster beats into scenes, derive dramatic fields, user confirms shape
//   Phase 1: CLARIFICATION — per-scene steering (selective, psych-driven auto-pass)
//   Phase 2: BUILDING — background VN writing + minor judge + retroactive N-1 review
//
// Design principle: adaptive, not deterministic. The system reads the user and adjusts
// how much interaction each scene gets. The goal is an addictive creation flow where
// the user feels like a director, not a project manager.

import type { PlotPack, TensionBeat, TurningPoint, DramaticIronyPoint, MysteryHook, Motif, ThemeCluster } from "./plot";
import type { CharacterPack } from "./character";
import type { WorldPack } from "./world";
import type { HookPack } from "./hook";
import type { UserPsychologyLedger } from "./userPsychology";

// ─── Scene Dramatic Spine (mandatory fields — the bones of every scene) ───

export interface SceneObjective {
  /** What the POV character wants RIGHT NOW in this scene (concrete, active verb) */
  want: string;
  /** What actively prevents that objective — a real opposing force */
  opposition: string;
  /** What hurts if the POV fails — immediate, felt, not abstract */
  stakes: string;
}

export interface SceneQuestion {
  /** What question is the reader leaning forward to answer? One line. */
  reader_question: string;
  /** Does this scene answer a question from a previous scene? */
  answers_from?: string; // scene_id reference
}

export interface EmotionArc {
  /** Emotional state at scene start */
  start: string;
  /** What pressure causes the shift */
  trigger: string;
  /** Emotional state at scene end */
  end: string;
}

export interface ValueShift {
  /** The dramatic value that changes: "safety → danger", "trust → suspicion", etc. */
  from: string;
  to: string;
  /** Brief note on what causes the shift */
  cause: string;
}

export interface InformationDelta {
  /** What new information is revealed in this scene */
  revealed: string[];
  /** What misinformation is reinforced */
  misinformation_reinforced: string[];
  /** What hidden truth is implied but not stated */
  hidden_truth_implied: string[];
  /** Key characters and what they now know after this scene */
  who_knows_what: Array<{ character: string; knows: string }>;
}

export type CompulsionVector =
  | "curiosity"
  | "dread"
  | "desire"
  | "outrage"
  | "tenderness"
  | "anticipation"
  | "taboo_fascination"
  | "dramatic_irony"
  | "defiance"
  | "longing"
  | "vindication";

export type PacingType =
  | "pressure_cooker"    // tight, escalating, mostly dialogue
  | "slow_burn"          // atmosphere, interiority, building tension
  | "whiplash"           // fast reversal, short sharp beats
  | "aftermath"          // processing what just happened, quiet
  | "set_piece";         // the big moment, fully staged

// ─── Scene Plan (the full dramatic schema, derived from tension chain) ───

export interface ScenePlan {
  /** Stable ID: "s1", "s2", etc. */
  scene_id: string;
  /** Which tension chain beat IDs this scene stages */
  beat_ids: string[];
  /** Short vivid scene title: "The Numbers Don't Add Up" */
  title: string;
  /** What this scene accomplishes in the story (one sentence) */
  purpose: string;
  /** Location and time */
  setting: { location: string; time: string };
  /** Characters present in this scene */
  characters_present: string[];
  /** Whose interiority we follow */
  pov_character: string;

  // ─── Mandatory dramatic spine ───
  objective: SceneObjective;
  scene_question: SceneQuestion;
  compulsion_vector: CompulsionVector;
  emotion_arc: EmotionArc;
  value_shift: ValueShift;
  information_delta: InformationDelta;
  exit_hook: string;

  // ─── Secondary fields (derivable, improve cohesion) ───
  pacing_type: PacingType;
  /** Concrete detail or line from previous scene that carries into this one */
  continuity_anchor?: string;
  /** Which motifs recur or are introduced in this scene */
  motif_notes?: string;
  /** How this scene stages a turning point (if applicable) */
  turning_point_ref?: string; // turning_point beat_id
  /** Active dramatic irony during this scene */
  active_irony?: DramaticIronyPoint[];
  /** Mystery hooks planted or paid off */
  mystery_hook_activity?: Array<{ hook_question: string; action: "planted" | "paid_off" | "sustained" }>;
  /** User steering directions merged from clarifier (populated by service, not LLM) */
  user_steering?: string;
}

// ─── Scene Rhythm (tracks pattern across scenes for variety) ───

export interface SceneRhythmSnapshot {
  /** Recent pacing types in order (last 3-4 scenes) */
  recent_pacing: PacingType[];
  /** Recent compulsion vectors in order */
  recent_compulsions: CompulsionVector[];
  /** Recent emotion end-states */
  recent_emotion_exits: string[];
  /** Are we in a run of same-type scenes? */
  monotony_risk: boolean;
  /** Suggested adjustment for next scene */
  rhythm_note: string;
}

// ─── VN Output (structured scene content) ───

export type VNLineSpeaker = string | "NARRATION" | "INTERNAL";

export interface VNLine {
  /** Speaker name, "NARRATION" for stage direction, "INTERNAL" for POV thoughts */
  speaker: VNLineSpeaker;
  /** The dialogue or narration text */
  text: string;
  /** Emotion state for the speaker (maps to character sprites) */
  emotion?: string;
  /** Stage direction for this beat (character action, camera, transition) */
  stage_direction?: string;
  /** Parenthetical delivery note for dialogue */
  delivery?: string;
}

export interface VNScene {
  scene_id: string;
  title: string;
  setting: { location: string; time: string };
  characters_present: string[];
  pov_character: string;
  /** The actual VN content */
  lines: VNLine[];
  /** Scene transition out (fade, cut, etc.) */
  transition_out?: string;
}

// ─── Screenplay-Style Readable Format ───

export interface ReadableScene {
  scene_id: string;
  title: string;
  /** Full screenplay-style text for user reading */
  screenplay_text: string;
  /** Word count */
  word_count: number;
}

// ─── Scene Builder Output (from LLM) ───

export interface SceneBuilderOutput {
  scene_id: string;
  /** Structured VN scene */
  vn_scene: VNScene;
  /** Screenplay-style readable version */
  readable: ReadableScene;
  /** Builder's notes on how it delivered the dramatic spine */
  delivery_notes: {
    objective_delivered: string;
    scene_question_status: "answered" | "mutated" | "sustained";
    value_shift_executed: string;
    exit_hook_planted: string;
  };
  /** 2-3 sentence continuity bridge for the next scene: where characters stand, what tension carries forward, what the reader expects */
  continuity_anchor: string;
}

// ─── Consistency Check (retroactive N-1 review) ───

export interface ConsistencyCheckResult {
  scene_id: string;
  /** Does this scene's content match the previous scene's exit state? */
  continuity_ok: boolean;
  /** Character voice consistent with their profile? */
  voice_ok: boolean;
  /** Information state consistent (no one knows something they shouldn't)? */
  information_ok: boolean;
  /** Issues found */
  issues: Array<{
    type: "continuity" | "voice" | "information" | "causal";
    description: string;
    severity: "minor" | "major";
    /** Reference to earlier scene if further back than N-1 */
    affects_scene?: string;
  }>;
}

// ─── Minor Scene Judge ───

export interface SceneMinorJudgeOutput {
  pass: boolean;
  /** Does the scene deliver its beat's core action? */
  beat_delivery: boolean;
  /** Does the objective/opposition/stakes land? */
  dramatic_spine_ok: boolean;
  /** Is the emotional arc coherent? */
  emotion_arc_ok: boolean;
  /** Does the scene question get answered or mutated (not ignored)? */
  scene_question_served: boolean;
  /** Does the exit hook create forward pull? */
  exit_hook_present: boolean;
  /** Consistency check against previous scene */
  consistency: ConsistencyCheckResult;
  /** One-line fix if not passing */
  fix_instruction?: string;
}

// ─── Final Intensive Judge ───

export interface FinalJudgeScores {
  /** Does tension generally escalate across the full work? */
  arc_momentum: number;
  /** Is there enough variety in scene shapes/pacing? */
  scene_rhythm_variety: number;
  /** Are open loops paid off or deliberately sustained? */
  loop_payoff_discipline: number;
  /** Does the work peak at the right moment? */
  climax_timing: number;
  /** Are characters voiced consistently across all scenes? */
  voice_consistency: number;
  /** Does the theme land through action, not statement? */
  theme_landing: number;
  /** Is the information state consistent (no one knows impossible things)? */
  information_integrity: number;
  /** Does the ending create the intended emotional landing? */
  ending_satisfaction: number;
}

export interface FinalJudgeOutput {
  pass: boolean;
  scores: FinalJudgeScores;
  /** Scenes that need revision */
  flagged_scenes: Array<{
    scene_id: string;
    issue: string;
    severity: "suggestion" | "should_fix" | "must_fix";
  }>;
  /** Arc-level problems */
  arc_issues: Array<{
    issue: string;
    affected_scenes: string[];
    severity: "suggestion" | "should_fix" | "must_fix";
  }>;
  /** Missing elements the user should address */
  missing_elements: string[];
  /** Overall assessment */
  overall_note: string;
}

// ─── Clarifier (per-scene, selective) ───

export interface SceneClarifierOption {
  id: string;       // "A" | "B" | "C"
  label: string;    // max ~80 chars — a specific staging choice
}

export interface SceneClarifierResponse {
  /** Private reasoning about what to surface */
  psychology_strategy: string;
  /** Scene summary for user (what happens, who's there, what it feels like) */
  scene_summary: string;
  /** Should the system ask anything, or auto-pass? */
  needs_input: boolean;
  /** If needs_input: ONE steering question */
  question?: string;
  /** If needs_input: 2-4 specific staging alternatives (from divergence) */
  options?: SceneClarifierOption[];
  /** Always true — user can always type */
  allow_free_text: boolean;
  /** Any assumptions the system made about staging */
  assumptions?: Array<{
    id: string;
    assumption: string;
    alternatives: string[];
  }>;
  /** Confidence that auto-pass would produce a good scene (0-1) */
  auto_pass_confidence: number;
  /** User psychology observations */
  user_read: {
    signals: Array<{
      hypothesis: string;
      action: string;
      valence: "supports" | "contradicts";
      scope: "this_story" | "this_genre" | "global";
      category: "content_preferences" | "control_orientation" | "power_dynamics" | "tonal_risk" | "narrative_ownership" | "engagement_satisfaction";
      adaptationConsequence: string;
      contradictionCriteria: string;
      contradictsSignalId?: string;
      reinforcesSignalId?: string;
    }>;
    behaviorSummary: {
      orientation: string;
      currentFocus: string;
      engagementMode: "exploring" | "converging" | "stuck" | "disengaged";
      satisfaction: {
        score: number;
        trend: "rising" | "stable" | "declining";
        reason: string;
      };
    };
    adaptationPlan: {
      dominantNeed: string;
      moves: Array<{
        action: string;
        drivenBy: string[];
        target: "question" | "options" | "assumptions" | "builder_tone" | "builder_content" | "judge_criteria";
      }>;
    };
  };
}

// ─── Scene Divergence (focused staging alternatives, not 15-20 futures) ───

export interface SceneStagingAlternative {
  /** Short label: "Public Confrontation", "Alone at 2am" */
  label: string;
  /** How this staging changes the scene's feel */
  sketch: string;
  /** Which dramatic fields would change */
  changes: string[];
  /** Why this alternative is interesting */
  hook: string;
}

export interface SceneDivergenceOutput {
  scene_id: string;
  /** 3-5 focused staging alternatives (not 15-20 broad futures) */
  alternatives: SceneStagingAlternative[];
  /** Should the clarifier surface these? (false = all alternatives are marginal) */
  worth_asking: boolean;
  /** Which alternative is most different from the current plan? */
  wildcard_index: number;
}

// ─── Narrative Preview (trailer-style, shown to user in planning phase) ───

export interface NarrativePreview {
  /** 2-3 paragraph "trailer" for the story — evocative, not technical */
  trailer_text: string;
  /** Estimated scene count */
  estimated_scene_count: number;
  /** Estimated reading time in minutes */
  estimated_reading_time: number;
}

// ─── Constraint Ledger (scene decisions) ───

export interface SceneLedgerEntry {
  key: string;             // "s3.pov", "s5.pacing", "plan.structure"
  value: string;
  source: "user_chose" | "user_typed" | "user_kept_assumption" | "user_changed_assumption" | "user_freeform" | "llm_inferred" | "plot_imported" | "character_imported" | "world_imported" | "hook_imported";
  confidence: "confirmed" | "inferred" | "imported";
  turnNumber: number;
  sceneId?: string;        // which scene this constraint applies to
  assumptionId?: string;
}

// ─── Development Targets ───

export interface SceneDevelopmentTarget {
  id: string;
  source_module: "hook" | "character" | "character_image" | "world" | "plot" | "scene";
  target: string;
  status: "unaddressed" | "partially_addressed" | "addressed" | "deferred";
  addressed_by?: string;
  notes?: string;
  /** Which downstream module is best positioned to address this */
  best_module_to_address?: "character" | "character_image" | "world" | "plot" | "scene" | "dialogue";
  /** What specifically is missing or weak right now */
  current_gap?: string;
  /** Concrete actionable suggestion for how to address it */
  suggestion?: string;
  /** Quality of the fix when status is addressed or partially_addressed */
  quality?: "weak" | "partial" | "strong";
}

// ─── Scene Staging State (per-scene user steering layer) ───

export interface SceneStagingState {
  scene_id: string;
  /** User's option selection (from clarifier) */
  user_selection?: { type: string; optionId?: string; label: string };
  /** Assumption overrides the user made for this scene */
  assumption_overrides: Record<string, string>;
  /** If the user picked a divergence alternative */
  divergence_choice?: string;
  /** The effective plan after merging user steering into the canonical plan */
  effective_plan: ScenePlan;
  /** Has the clarifier been resolved (user responded or auto-passed)? */
  resolved: boolean;
}

// ─── Planning Phase Types ───

export interface ScenePlannerOutput {
  /** The narrative preview / trailer */
  narrative_preview: NarrativePreview;
  /** Full scene plan with all dramatic fields */
  scenes: ScenePlan[];
  /** Planning notes: why beats were clustered this way */
  clustering_rationale: string;
  /** Soft scene count estimate */
  scene_count_estimate: number;
}

// ─── Session Turns ───

export interface ScenePlanningTurn {
  turnNumber: number;
  phase: "planning";
  clarifierResponse: SceneClarifierResponse;
  userSelection: {
    type: "option" | "free_text" | "confirm" | "surprise_me";
    optionId?: string;
    label: string;
  } | null;
  assumptionResponses?: Array<{
    assumptionId: string;
    action: "keep" | "alternative" | "freeform";
    originalValue: string;
    newValue: string;
  }>;
}

export interface SceneWritingTurn {
  turnNumber: number;
  phase: "scene_clarify";
  sceneId: string;
  clarifierResponse: SceneClarifierResponse;
  userSelection: {
    type: "option" | "free_text" | "confirm" | "auto_pass";
    optionId?: string;
    label: string;
  } | null;
  assumptionResponses?: Array<{
    assumptionId: string;
    action: "keep" | "alternative" | "freeform";
    originalValue: string;
    newValue: string;
  }>;
}

export type SceneTurn = ScenePlanningTurn | SceneWritingTurn;

// ─── Built Scene (scene + judge result, stored after background build) ───

export interface BuiltScene {
  scene_id: string;
  plan: ScenePlan;
  builder_output: SceneBuilderOutput;
  minor_judge: SceneMinorJudgeOutput | null;
  consistency_check: ConsistencyCheckResult | null;
  /** Flags for retroactive issues further back than N-1 */
  retroactive_flags: Array<{
    affects_scene_id: string;
    issue: string;
    severity: "minor" | "major";
  }>;
  built_at: string;
  /** Has the user flagged this scene for revision? */
  user_flagged?: boolean;
  user_notes?: string;
}

// ─── Prompt Overrides & Preview ───

export interface ScenePromptOverrides {
  system?: string;
  user?: string;
}

export interface ScenePromptPreview {
  stage: string;
  system: string;
  user: string;
}

export interface ScenePromptHistoryEntry {
  timestamp: string;
  stage: "planner" | "plan_clarifier" | "scene_clarifier" | "builder" | "minor_judge" | "final_judge" | "divergence";
  turnNumber: number;
  sceneId?: string;
  defaultSystem: string;
  defaultUser: string;
  editedSystem?: string;
  editedUser?: string;
  wasEdited: boolean;
  responseSummary?: string;
}

// ─── Session State ───

export interface SceneSessionState {
  projectId: string;

  // ─── Upstream references ───
  plotProjectId: string;
  worldProjectId: string;
  characterProjectId: string;
  characterImageProjectId?: string;
  hookProjectId: string;

  // ─── Upstream packs (loaded at session creation) ───
  sourcePlotPack: PlotPack;
  sourceWorldPack: WorldPack;
  sourceCharacterPack: CharacterPack;
  sourceCharacterImagePack?: import("./characterImage").CharacterImagePack;
  sourceHookPack: HookPack;

  // ─── Planning phase ───
  narrativePreview?: NarrativePreview;
  scenePlan?: ScenePlan[];
  scenePlanConfirmed: boolean;
  planningTurns: ScenePlanningTurn[];

  // ─── Scene-by-scene phase ───
  currentSceneIndex: number;
  /** Per-scene staging state: user steering merged into effective plan */
  sceneStagingStates: Record<string, SceneStagingState>;
  writingTurns: SceneWritingTurn[];
  builtScenes: BuiltScene[];
  /** Scene rhythm tracking for variety enforcement */
  rhythmSnapshot?: SceneRhythmSnapshot;

  // ─── Divergence ───
  sceneDivergenceResults: Record<string, SceneDivergenceOutput>; // keyed by scene_id

  // ─── Constraint ledger & development targets ───
  constraintLedger: SceneLedgerEntry[];
  developmentTargets: SceneDevelopmentTarget[];

  // ─── Final judge ───
  finalJudge?: FinalJudgeOutput;

  // ─── Lifecycle ───
  status:
    | "planning"           // phase 0: clustering beats, user confirms shape
    | "plan_clarifying"    // phase 0: user steering the plan
    | "plan_confirmed"     // plan locked, ready for scene-by-scene
    | "writing"            // phase 1-2: scene clarify + background build
    | "reviewing"          // all scenes built, user reading
    | "final_judging"      // final judge running
    | "complete";          // all done

  // ─── Psychology ───
  psychologyLedger?: UserPsychologyLedger;

  // ─── Audit ───
  promptHistory?: ScenePromptHistoryEntry[];
  lastSavedAt?: string;
}

// ─── Scene Pack (module handoff — the final VN output) ───

export interface ScenePack {
  module: "scene";
  /** All built scenes in order */
  scenes: BuiltScene[];
  /** The complete VN in readable format */
  readable_vn: ReadableScene[];
  /** Final judge results */
  final_judge?: FinalJudgeOutput;
  /** Scene plan that was used */
  scene_plan: ScenePlan[];
  /** Narrative preview shown to user */
  narrative_preview: NarrativePreview;
  /** Accumulated preferences */
  preferences: {
    tone_chips: string[];
    bans: string[];
  };
  /** Development targets status */
  development_targets: SceneDevelopmentTarget[];
  user_style: {
    control_preference: "director" | "explorer" | "mixed";
    typed_vs_clicked: "mostly_typed" | "mostly_clicked" | "mixed";
    total_turns: number;
    auto_passed_scenes: number;
    steered_scenes: number;
  };
  state_summary: string;
  /** References to all upstream modules */
  plotPack_reference: { plotProjectId: string };
  worldPack_reference: { worldProjectId: string };
  characterImagePack_reference?: { characterImageProjectId: string };
  characterPack_reference: { characterProjectId: string };
  hookPack_reference: { hookProjectId: string };
  /** User psychology ledger accumulated across all modules */
  psychologyLedger?: UserPsychologyLedger;
}

// ─── Scene Clarify Response (returned by clarifyScene endpoint) ───

export interface ClarifySceneResult {
  clarifier: SceneClarifierResponse;
  sceneId: string;
  sceneIndex: number;
  totalScenes: number;
  autoPassApplied: boolean;
  /** Present when auto-pass triggered an immediate background build */
  autoBuiltScene?: BuiltScene | null;
}
