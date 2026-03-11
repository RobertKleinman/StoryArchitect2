// ═══ Plot & Theme Module Types ═══
// Module #5 in the pipeline: Hook → Character → CharacterImage → World → Plot
//
// The Plot module builds the story's TENSION SPINE — a causally linked chain
// of beats where every beat connects to the previous via "but" (complication)
// or "therefore" (consequence). Never "and then."
//
// Theme is INFERRED from upstream (character misbeliefs + world pressures +
// hook premise), not asked of the user directly. The app does the heavy lifting.
//
// Design principle: entertainment-first, not literary. Every structure exists
// to make the reader unable to stop clicking.

import type { HookPack } from "./hook";
import type { CharacterPack } from "./character";
import type { WorldPack } from "./world";
import type { UserPsychologyLedger } from "./userPsychology";

// ─── Plot Clarifier ───

export interface PlotClarifierOption {
  id: string;        // "A" | "B" | "C" | "D" | "E"
  label: string;     // max ~60 chars
}

export interface PlotAssumption {
  id: string;                    // "a1", "a2", etc.
  category: string;              // "pacing", "twist", "stakes", "ending", "mystery", "irony", "theme_direction"
  assumption: string;            // what the engine assumed about the plot
  alternatives: string[];        // 2–4 wildly different options
}

export interface PlotAssumptionResponse {
  assumptionId: string;
  category: string;
  action: "keep" | "alternative" | "freeform" | "not_ready";
  originalValue: string;
  newValue: string;
}

// ─── Constraint Ledger (plot decisions) ───

export interface PlotLedgerEntry {
  key: string;                   // scoped: "pacing.preference", "twist.midpoint_reversal", "stakes.ceiling", "ending.energy"
  value: string;
  source: "user_chose" | "user_typed" | "user_kept_assumption" | "user_changed_assumption" | "user_freeform" | "llm_inferred" | "hook_imported" | "character_imported" | "world_imported";
  confidence: "confirmed" | "inferred" | "imported";
  turnNumber: number;
  assumptionId?: string;
}

// ─── Tension Beat (the causal spine) ───

export interface TensionBeat {
  /** Stable ID: "b1", "b2", etc. */
  id: string;
  /** What happens — concrete, specific, max 2 sentences */
  beat: string;
  /** How this beat causally follows from the previous one. Must describe a complication ("but") or consequence ("therefore") — never just sequence ("and then"). The causal logic should be embedded in the prose, not labeled. */
  causal_logic: string;
  /** What new question this beat opens in the reader's mind */
  question_opened: string;
  /** What prior question this beat pays off (if any) */
  question_answered?: string;
  /** What the reader feels during this beat — one phrase */
  emotional_register: string;
  /** Tension level 1-10. Should generally escalate over the chain (dips before jumps are fine). */
  stakes_level: number;
  /** Which characters are active in this beat */
  characters_involved: string[];
}

// ─── Turning Points (major reversals) ───

export interface TurningPoint {
  /** References a TensionBeat.id */
  beat_id: string;
  /** Short vivid name: "The Betrayal", "The Floor Drops" */
  label: string;
  /** What the reader believed before this moment */
  believed_before: string;
  /** What they learn/discover */
  learned_after: string;
  /** Direction of emotional whiplash: "hope → dread", "trust → betrayal", "safety → danger" */
  whiplash_direction: string;
}

// ─── Dramatic Irony Points ───

export interface DramaticIronyPoint {
  /** References a TensionBeat.id where the irony is active */
  beat_id: string;
  /** What the reader knows */
  reader_knows: string;
  /** What the character(s) believe (incorrectly) */
  character_believes: string;
  /** What tension this gap creates */
  tension_created: string;
}

// ─── Theme Cluster (inferred, not user-authored) ───

export interface ThemeCluster {
  /** One word or short phrase: "loyalty", "power", "identity" */
  topic: string;
  /** What the story TESTS about the topic: "Can loyalty survive betrayal?" */
  question: string;
  /** What the story's events argue (may be ambiguous): "Loyalty that isn't tested isn't loyalty at all" */
  statement: string;
  /** The counter-argument the antagonist/world embodies: "Loyalty is a cage that keeps the smart from acting" */
  countertheme: string;
  /** Brief explanation of what upstream elements implied this theme */
  inferred_from: string;
}

// ─── Motifs ───

export interface Motif {
  /** Name: "broken mirrors", "the red thread", "locked doors" */
  name: string;
  /** Where it first appears in the tension chain */
  first_appearance: string;
  /** How it recurs and evolves */
  recurrences: string;
  /** How it reinforces or complicates the theme */
  thematic_function: string;
}

// ─── Mystery Hooks ───

export interface MysteryHook {
  /** The unanswered question planted for the reader */
  question: string;
  /** References a TensionBeat.id where this question is planted */
  planted_at_beat: string;
  /** References a TensionBeat.id where it's paid off (optional — some mysteries persist) */
  payoff_beat?: string;
  /** How long this mystery sustains curiosity */
  sustains_through: string;
}

// ─── Builder Output ───

export interface PlotBuilderOutput {
  /** The central collision — refined from hook's premise using characters + world */
  core_conflict: string;
  /** The causal spine: 12-20 beats linked by but/therefore. THE core output. */
  tension_chain: TensionBeat[];
  /** Major reversals flagged from the chain. Minimum 2, typically 3-4. */
  turning_points: TurningPoint[];
  /** Maximum tension — where the core conflict collides head-on */
  climax: {
    /** What happens at the peak */
    beat: string;
    /** Why this is the moment of maximum tension */
    why_now: string;
    /** How this resolves (or fails to resolve) the core conflict */
    core_conflict_collision: string;
  };
  /** What the new normal looks like after the climax */
  resolution: {
    /** The world/characters after the dust settles */
    new_normal: string;
    /** How the reader should feel */
    emotional_landing: string;
    /** The energy of the ending */
    ending_energy: "triumphant" | "bittersweet" | "dark" | "ambiguous" | "open";
  };
  /** Moments where reader knows something characters don't */
  dramatic_irony_points: DramaticIronyPoint[];
  /** Theme INFERRED from upstream — not user-authored */
  theme_cluster: ThemeCluster;
  /** Which tension chain beats carry thematic weight and how */
  theme_beats: Array<{
    beat_id: string;
    resonance: string;   // how this beat tests/illuminates the theme
  }>;
  /** Recurring images/symbols that reinforce the theme */
  motifs: Motif[];
  /** Unanswered questions deliberately planted to sustain curiosity */
  mystery_hooks: MysteryHook[];
  /** 1-2 sentences: why can't the reader stop? Name the specific psychological hooks. */
  addiction_engine: string;
  /** Sources from upstream that shaped specific plot decisions */
  collision_sources: Array<{
    source: string;      // "hook.emotional_promise", "character.protagonist.misbelief", "world.faction.corporate.pressure"
    element_extracted: string;
    applied_to: string;  // which beat or structural decision
  }>;
}

// ─── Judge Output ───

export interface PlotJudgeScores {
  /** Do stakes generally rise? Is there momentum? */
  tension_escalation: number;
  /** Is EVERY beat causally linked? Does the causal_logic field describe a genuine complication or consequence — never just sequence? */
  causal_integrity: number;
  /** Are turning points surprising yet earned? */
  twist_quality: number;
  /** Enough unanswered questions to sustain curiosity? */
  mystery_hook_density: number;
  /** Does the reader-character knowledge gap create tension? */
  dramatic_irony_payoff: number;
  /** Does climax resolve core conflict? Feel inevitable AND surprising? */
  climax_earned: number;
  /** Does resolution land emotionally per user's ending energy preference? */
  ending_satisfaction: number;
  /** Matches user psychology signals? */
  user_fit: number;
}

export interface PlotJudgeOutput {
  pass: boolean;
  hard_fail_reasons: string[];
  scores: PlotJudgeScores;
  weakest_element: string;       // "tension_chain" | "turning_points" | "climax" | "theme" | "mystery_hooks"
  one_fix_instruction: string;
  /** Weaknesses for downstream modules to develop */
  weaknesses?: Array<{
    area: string;
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

// ─── Development Targets (carried across modules) ───

export interface PlotDevelopmentTarget {
  id: string;
  source_module: "hook" | "character" | "character_image" | "world" | "plot";
  target: string;                // what's weak: "antagonist moral logic", "tension chain plateaus mid-story"
  status: "unaddressed" | "partially_addressed" | "addressed";
  addressed_by?: string;         // which module/turn addressed it
  notes?: string;                // how it was addressed or development opportunity
}

// ─── Clarifier Response ───

export interface PlotClarifierResponse {
  /** Private reasoning about what to ask and why */
  psychology_strategy: string;
  /** Evolving hypothesis about the most addictive plot spine for this user */
  hypothesis_line: string;
  /** ONE question — fun to answer, plot-relevant */
  question: string;
  /** 3-5 mutually exclusive options */
  options: PlotClarifierOption[];
  /** Always true — user can always type */
  allow_free_text: boolean;
  /** Current focus area, or null */
  plot_focus: string | null;    // "pacing" | "twists" | "stakes" | "endings" | "mysteries" | "irony" | null
  /** Is the clarifier ready to hand off to the builder? */
  ready_for_plot: boolean;
  /** 0-100: how close to having enough to build */
  readiness_pct: number;
  /** User-facing note about readiness */
  readiness_note: string;
  /** What signal is missing before we can build */
  missing_signal: string;
  /** Any contradictions detected */
  conflict_flag: string;
  /** Assumptions to surface to user */
  assumptions: PlotAssumption[];
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

// ─── Session State ───

export interface PlotTurn {
  turnNumber: number;
  clarifierResponse: PlotClarifierResponse;
  userSelection: {
    type: "option" | "free_text" | "surprise_me";
    optionId?: string;
    label: string;
  } | null;
  assumptionResponses?: PlotAssumptionResponse[];
}

export interface PlotPromptOverrides {
  system?: string;
  user?: string;
}

export interface PlotPromptPreview {
  stage: string;
  system: string;
  user: string;
}

/** Prompt history entry for audit trail */
export interface PlotPromptHistoryEntry {
  timestamp: string;
  stage: "clarifier" | "builder" | "judge" | "summary";
  turnNumber: number;
  defaultSystem: string;
  defaultUser: string;
  editedSystem?: string;
  editedUser?: string;
  wasEdited: boolean;
  responseSummary?: string;
}

/** Tournament progress for crash recovery */
export interface PlotTournamentProgress {
  startedAt: string;
  builderResults: Array<{ output?: PlotBuilderOutput; error?: string }>;
  judgeResults: Array<{ output?: PlotJudgeOutput; error?: string }>;
  phase: "builders" | "judges" | "complete";
}

export interface PlotSessionState {
  projectId: string;

  // ─── Upstream references ───
  worldProjectId: string;
  characterProjectId: string;
  characterImageProjectId?: string;
  hookProjectId: string;

  // ─── Upstream packs (loaded at session creation) ───
  sourceWorldPack: WorldPack;
  sourceCharacterPack: CharacterPack;
  sourceCharacterImagePack?: import("./characterImage").CharacterImagePack;
  sourceHookPack: HookPack;

  // ─── Plot-specific ───
  plotSeed?: string;                          // optional user seed text
  turns: PlotTurn[];
  constraintLedger: PlotLedgerEntry[];
  developmentTargets: PlotDevelopmentTarget[];  // carried from upstream

  // ─── Generation outputs ───
  revealedPlot?: PlotBuilderOutput;
  revealedJudge?: PlotJudgeOutput;
  plotPack?: PlotPack;

  // ─── Lifecycle ───
  status: "clarifying" | "generating" | "revealed" | "locked";
  rerollCount: number;
  consecutiveHighReadiness?: number;

  // ─── Psychology ───
  psychologyLedger?: UserPsychologyLedger;

  // ─── Audit ───
  promptHistory?: PlotPromptHistoryEntry[];
  tournamentProgress?: PlotTournamentProgress;
  lastSavedAt?: string;
}

// ─── Plot Pack (module handoff to downstream) ───

export interface PlotPack {
  module: "plot";
  locked: {
    core_conflict: string;
    tension_chain: TensionBeat[];
    turning_points: TurningPoint[];
    climax: PlotBuilderOutput["climax"];
    resolution: PlotBuilderOutput["resolution"];
    dramatic_irony_points: DramaticIronyPoint[];
    theme_cluster: ThemeCluster;
    theme_beats: PlotBuilderOutput["theme_beats"];
    motifs: Motif[];
    mystery_hooks: MysteryHook[];
    addiction_engine: string;
    collision_sources: PlotBuilderOutput["collision_sources"];
  };
  preferences: {
    tone_chips: string[];
    bans: string[];
  };
  /** Accumulated development debt — unresolved weaknesses from ALL prior modules */
  development_targets: PlotDevelopmentTarget[];
  /** Weaknesses specific to the plot output */
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
  /** References to all upstream modules */
  worldPack_reference: { worldProjectId: string };
  characterImagePack_reference?: { characterImageProjectId: string };
  characterPack_reference: { characterProjectId: string };
  hookPack_reference: { hookProjectId: string };
  /** User psychology ledger accumulated across all modules */
  psychologyLedger?: UserPsychologyLedger;
}
