/**
 * Story Architect v2 — Artifact Types
 *
 * Output structures for each step of the pipeline.
 * Each artifact carries an ArtifactState for lifecycle tracking.
 */

import type { ArtifactState, OperationId } from "./project";

// Reuse existing domain types
import type { WorldScope, Arena, WorldRule, Faction, ConsequencePattern } from "./world";
import type {
  TensionBeat, TurningPoint, ThemeCluster,
  DramaticIronyPoint, Motif, MysteryHook,
} from "./plot";
import type {
  ScenePlan, VNScene, ReadableScene,
} from "./scene";

// ── Premise Artifact (output of Step 2) ─────────────────────────────

export interface CharacterSketch {
  name: string;
  role: "protagonist" | "antagonist" | "supporting" | "catalyst";
  one_liner: string;
}

export interface PremiseArtifact {
  state: ArtifactState;
  operationId: OperationId;

  hook_sentence: string;
  emotional_promise: string;
  premise_paragraph: string;         // 2-3 sentences
  synopsis: string;                  // 3-5 sentences, the full story arc

  tone_chips: string[];
  bans: string[];
  setting_anchor: string;
  time_period: string;

  characters_sketch: CharacterSketch[];
  core_conflict: string;
  suggested_length: "short" | "medium" | "long";
  suggested_cast: "duo" | "triangle" | "small_ensemble" | "large_ensemble";
}

// ── Character Profile (used in Story Bible) ─────────────────────────

export interface CharacterProfile {
  name: string;
  role: string;
  description: string;
  presentation: string;
  age_range: string;

  psychological_profile: {
    want: string;                    // what they actively pursue
    misbelief: string;              // the lie they believe
    stress_style: string;           // how they behave under pressure
    break_point: string;            // what pushes them past their limit
    voice_pattern: string;          // distinctive speech/thought patterns
  };

  threshold_statement: string;       // "X will do anything to Y, but never Z"
  competence_axis: string;           // what they're good at
}

export interface CharacterRelationship {
  between: [string, string];
  nature: string;
  stated_dynamic: string;
  true_dynamic: string;
}

// ── Story Bible Artifact (output of Step 4) ─────────────────────────

export interface StoryBibleArtifact {
  state: ArtifactState;
  operationId: OperationId;

  world: {
    scope: WorldScope;
    arena: Arena;
    rules: WorldRule[];
    factions: Faction[];
    consequence_patterns: ConsequencePattern[];
    canon_facts: string[];
    world_thesis: string;
  };

  characters: Record<string, CharacterProfile>;
  relationships: CharacterRelationship[];
  ensemble_dynamic: string;

  plot: {
    core_conflict: string;
    tension_chain: TensionBeat[];
    turning_points: TurningPoint[];
    theme_cluster: ThemeCluster;
    dramatic_irony_points: DramaticIronyPoint[];
    motifs: Motif[];
    mystery_hooks: MysteryHook[];
    climax: {
      beat: string;
      why_now: string;
      core_conflict_collision: string;
    };
    resolution: {
      new_normal: string;
      emotional_landing: string;
      ending_energy: string;
    };
    addiction_engine: string;
  };
}

// ── Scene Plan Artifact (also output of Step 4) ─────────────────────

export interface ScenePlanArtifact {
  state: ArtifactState;
  operationId: OperationId;
  scenes: ScenePlan[];
  total_scenes: number;
  estimated_word_count: number;
}

// ── Generated Scene (output of Step 6, per-scene) ───────────────────

export interface GeneratedScene {
  scene_id: string;
  state: ArtifactState;
  operationId: OperationId;
  plan: ScenePlan;
  vn_scene: VNScene;
  readable: ReadableScene;
  judge_result?: {
    pass: boolean;
    issues: string[];
    repaired: boolean;
  };
}
