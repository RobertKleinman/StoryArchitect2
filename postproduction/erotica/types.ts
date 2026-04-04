/**
 * EROTICA DIALOGUE DIAGNOSTIC TYPES
 * ==================================
 * Types for the erotica-only diagnostic and rewriter tools.
 * These never interact with non-erotica postproduction.
 */

import type { IdentifiedScene, IdentifiedLine, PipelineStoryBible } from "../types";

// ── Diagnostic Report ────────���─────────────────────────────────────

export interface EroticaDiagnosticReport {
  generated_at: string;
  input_source: string;
  summary: DiagnosticSummary;
  metrics: {
    dom_commands: DomCommandMetrics;
    nickname_overuse: NicknameMetrics;
    internal_template: InternalTemplateMetrics;
    arc_shape: ArcShapeMetrics;
    vulnerability: VulnerabilityMetrics;
    structural: OpenEndedMetrics;
    rob_style: RobStyleMetrics;
  };
  flagged_lines: FlaggedLine[];
  per_scene: SceneDiagnostic[];
}

export interface DiagnosticSummary {
  total_scenes: number;
  total_dialogue_lines: number;
  total_internal_lines: number;
  total_narration_lines: number;
  fixable_issues: number;
  report_only_issues: number;
  severity_score: number; // 0-100 weighted composite
}

// ── Per-Metric Types ────────────���──────────────────────────────────

export interface DomCommandMetrics {
  total_dom_lines: number;
  short_imperative_count: number;
  short_imperative_rate: number;    // fraction of dom lines
  unique_command_shapes: number;
  monotony_score: number;           // 0-1, higher = more monotonous
  longest_dom_speech_words: number;
  dom_speech_variety: {
    short_imperative: number;       // <=6 words, no question mark
    question: number;
    tease_or_longer: number;        // >10 words, non-imperative
    vulnerable_or_soft: number;
    medium_statement: number;       // 7-10 words, not imperative
  };
  flagged_line_ids: string[];
}

export interface NicknameMetrics {
  total_dialogue_lines: number;
  total_address_uses: number;
  address_rate: number;
  unique_addresses: string[];
  address_by_speaker: Record<string, { count: number; terms: string[] }>;
  flagged_line_ids: string[];
}

export interface InternalTemplateMetrics {
  total_internal_lines: number;
  asterisk_wrapped_rate: number;
  self_interruption_rate: number;
  body_sensation_rate: number;
  rhetorical_question_rate: number;
  template_uniformity_score: number; // 0-1, fraction sharing 2+ template features
  structural_fingerprints: Record<string, number>;
  flagged_line_ids: string[];
}

export interface ArcShapeMetrics {
  scene_count: number;
  arc_shapes: Array<{ scene_id: string; shape: string }>;
  opening_emotion_distribution: Record<string, number>;
  dominant_arc_shape: string | null;
  dominant_arc_frequency: number;   // how many scenes use the dominant shape
  shape_diversity_score: number;    // 0-1, unique shapes / total scenes
}

export interface VulnerabilityMetrics {
  total_dialogue_lines: number;
  vulnerable_line_count: number;
  vulnerability_rate: number;
  by_speaker: Record<string, { vulnerable: number; total: number }>;
}

export interface OpenEndedMetrics {
  line_length: {
    mean: number;
    median: number;
    stdev: number;
    p10: number;
    p90: number;
  };
  speaker_balance: Record<string, number>;
  consecutive_same_speaker_max: number;
  top_bigrams: Array<{ bigram: string; count: number }>;
  scene_opening_patterns: Array<{ scene_id: string; pattern: string }>;
  scene_closing_patterns: Array<{ scene_id: string; pattern: string }>;
}

// ── Rob Style Metrics ───────────────────────────────────────────

export interface RobStyleMetrics {
  dialogue_sentence_count: number;
  under_8_words_rate: number;
  in_zone_rate: number;          // 8-18 words
  over_25_words_rate: number;
  mean_sentence_words: number;
  internal_question_count: number;
  internal_question_rate: number;
  why_what_how_count: number;
  exclamation_line_count: number;
  exclamation_rate: number;
  flagged_line_ids: string[];
}

// ── Flagged Lines ────────���─────────────────────────────────────────

export type FlaggedIssueType = "dom_command" | "nickname_overuse" | "internal_template";

export interface FlaggedLine {
  line_id: string;
  scene_id: string;
  issue_type: FlaggedIssueType;
  reason: string;
  current_text: string;
  speaker: string;
}

export interface SceneDiagnostic {
  scene_id: string;
  title: string;
  total_lines: number;
  flagged_count: number;
  dom_command_count: number;
  nickname_count: number;
  internal_template_count: number;
  arc_shape: string;
  vulnerability_rate: number;
}

// ── Detector Interface ���──────────────────────────��─────────────────

export interface DetectorResult<M> {
  metrics: M;
  flagged: FlaggedLine[];
}

// ── Content Preservation ──────────���────────────────────────────────

export interface ContentValidationResult {
  valid: boolean;
  rejected_diffs: string[];  // line_ids that were rejected
  reasons: string[];
}
