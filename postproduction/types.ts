/**
 * POSTPRODUCTION TYPES
 * ════════════════════
 * Shared types for the editor and packager modules.
 */

// ── Pipeline Input (what we receive from the pipeline) ──

export interface PipelineOutput {
  premise: PipelinePremise;
  storyBible: PipelineStoryBible;
  scenes: PipelineScene[];
  seed?: string;
}

export interface PipelinePremise {
  hook_sentence: string;
  emotional_promise?: string;
  premise_paragraph?: string;
  synopsis?: string;
  tone_chips?: string[];
  setting_anchor?: string;
  core_conflict?: string;
  [key: string]: unknown;
}

export interface PipelineStoryBible {
  characters: Record<string, PipelineCharacter>;
  world: {
    arena: {
      locations: PipelineLocation[];
      edges?: unknown[];
    };
    [key: string]: unknown;
  };
  relationships?: PipelineRelationship[];
  [key: string]: unknown;
}

export interface PipelineCharacter {
  name?: string;
  role?: string;
  description?: string;
  presentation?: string;
  age_range?: string;
  core_dials?: Record<string, string>;
  secondary_dials?: Record<string, string>;
  [key: string]: unknown;
}

export interface PipelineLocation {
  id: string;
  name: string;
  description: string;
  affordances?: string[];
  access?: string;
  emotional_register?: string;
}

export interface PipelineRelationship {
  between: string[];
  nature?: string;
  stated_dynamic?: string;
  true_dynamic?: string;
}

export interface PipelineScene {
  scene_id?: string;
  state?: string;
  plan?: unknown;
  builder_output?: {
    vn_scene?: VNScene;
    [key: string]: unknown;
  };
  vn_scene?: VNScene;
  [key: string]: unknown;
}

export interface VNScene {
  scene_id: string;
  title: string;
  setting: string | { location: string; time?: string };
  characters_present: string[];
  pov_character?: string;
  lines: VNLine[];
  transition_out: string;
}

export interface VNLine {
  speaker: string;
  text: string;
  emotion?: string | null;
  stage_direction?: string | null;
  delivery?: string | null;
}

// ── Line Identity (stable IDs for diff-based editing) ──

export interface IdentifiedLine extends VNLine {
  _lid: string; // stable line ID, assigned once before Pass 3
}

export interface IdentifiedScene extends Omit<VNScene, "lines"> {
  lines: IdentifiedLine[];
}

// ── Editor Types ──

export type IssueSeverity = "error" | "warning" | "info";
export type IssueCategory =
  | "truncation"
  | "reference_mismatch"
  | "missing_data"
  | "vn_compatibility"
  | "seed_compliance"
  | "continuity_error"
  | "voice_drift";

export interface StructuralIssue {
  category: IssueCategory;
  severity: IssueSeverity;
  scene_id?: string;
  line_id?: string;
  field?: string;
  message: string;
  auto_fixable: boolean;
}

export interface StructuralReport {
  issues: StructuralIssue[];
  stats: {
    total_scenes: number;
    total_lines: number;
    error_count: number;
    warning_count: number;
  };
}

// Pass 2 findings (from LLM continuity read)

export interface EditorialFinding {
  category: "seed_compliance" | "continuity_error" | "voice_drift";
  severity: "major" | "minor";
  scene_id: string;
  line_id: string;
  quoted_text: string;
  description: string;
  fix_suggestion: string;
  // For continuity errors: whether this is single-scene or cross-scene
  affects_multiple_scenes: boolean;
  related_scene_ids?: string[];
}

export interface ContinuityLedger {
  characters: Array<{
    name: string;
    established_facts: string[];
    emotional_state_by_scene: Record<string, string>;
  }>;
  promises: Array<{
    setup: string;
    introduced_in: string;
    resolved_in?: string;
  }>;
  relationships: Array<{
    between: [string, string];
    state: string;
  }>;
  world_facts: string[];
}

export interface EditorialReport {
  fixable_findings: EditorialFinding[];
  report_only: Array<{
    category: "dead_setup" | "pacing" | "repeated_beat";
    description: string;
    scenes_affected: string[];
  }>;
  continuity_ledger: ContinuityLedger;
}

// Pass 3 diffs

export type EditAction = "replace" | "insert_after" | "delete";

export interface LineDiff {
  line_id: string;
  expected_old_text: string;
  action: EditAction;
  new_line?: Omit<VNLine, never>; // full new line for replace/insert
}

export interface SceneEditResult {
  scene_id: string;
  status: "fixed" | "unfixed" | "unchanged";
  diffs_applied: number;
  diffs_rejected: number;
  issues_addressed: string[]; // descriptions of what was fixed
}

// Post-fix verification

export interface VerificationResult {
  scene_id: string;
  passed: boolean;
  new_contradictions: string[];
  slop_score?: number;
  slop_passed?: boolean;
}

// Full editor output

export interface EditorOutput {
  scenes: IdentifiedScene[];
  structural_report: StructuralReport;
  editorial_report: EditorialReport;
  scene_edit_results: SceneEditResult[];
  verification_results: VerificationResult[];
  stats: {
    scenes_fixed: number;
    scenes_unfixed: number;
    scenes_unchanged: number;
    total_diffs_applied: number;
    llm_calls: number;
  };
}

// ── Packager Types ──

export type PackageStatus = "success" | "degraded" | "failed";

export interface PackagerManifest {
  version: 1;
  package_status: PackageStatus;
  title: string;
  characters: number;
  locations: number;
  scenes: number;
  total_lines: number;
  errors: string[];
  warnings: string[];
  unfixed_scenes: string[];
  emotion_mappings: Array<{
    original: string;
    mapped_to: string;
    confidence: "exact" | "fuzzy" | "default";
    scene_id: string;
    line_id: string;
  }>;
  generated_at: string;
}

export interface VNPackageCharacter {
  name: string;
  description: string;
  presentation: string;
  role: string;
}

export interface VNPackageLine {
  speaker: string;
  text: string;
  emotion: string | null;
  stage_direction: string | null;
  delivery: string | null;
}

export interface VNPackageScene {
  scene_id: string;
  title: string;
  setting: string;
  characters_present: string[];
  lines: VNPackageLine[];
  transition_out: string;
}

export interface VNPackage {
  title: string;
  characters: Record<string, VNPackageCharacter>;
  locations: Array<{
    id: string;
    name: string;
    description: string;
  }>;
  scenes: VNPackageScene[];
}

// ── Utilities ──

/** Special speakers that are not character names */
const SPECIAL_SPEAKERS = new Set(["NARRATION", "narration", "INTERNAL"]);

/**
 * Normalize speaker variants like "INTERNAL (WITNESS)" → "INTERNAL".
 * Returns the canonical special speaker name, or null if it's a character name.
 */
export function normalizeSpecialSpeaker(speaker: string): string | null {
  if (SPECIAL_SPEAKERS.has(speaker)) return speaker;
  // Handle parenthetical qualifiers: "INTERNAL (WITNESS)" → "INTERNAL"
  const base = speaker.split(/\s*\(/)[0].trim();
  if (SPECIAL_SPEAKERS.has(base)) return base;
  return null;
}
