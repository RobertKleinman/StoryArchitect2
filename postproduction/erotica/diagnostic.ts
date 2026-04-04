/**
 * EROTICA DIALOGUE DIAGNOSTIC ENGINE
 * ====================================
 * Pure-computation structural analysis of erotica scene dialogue.
 * Zero LLM calls. Runs all 6 detectors and assembles a report.
 *
 * Usage:
 *   import { runEroticaDiagnostic } from "./diagnostic";
 *   const report = runEroticaDiagnostic(scenes, storyBible, "story1.json");
 */

import type { IdentifiedScene, PipelineStoryBible } from "../types";
import { normalizeSpecialSpeaker } from "../types";
import type { EroticaDiagnosticReport, SceneDiagnostic } from "./types";

import { detect as detectDomCommands } from "./detectors/dom-commands";
import { detect as detectNicknameOveruse } from "./detectors/nickname-overuse";
import { detect as detectInternalTemplate } from "./detectors/internal-template";
import { detect as detectArcShape } from "./detectors/arc-shape";
import { detect as detectVulnerability } from "./detectors/vulnerability";
import { detect as detectStructural } from "./detectors/structural";
import { detect as detectRobStyle } from "./detectors/rob-style";

/**
 * Run the full diagnostic suite against a set of identified scenes.
 * Returns a complete report with metrics, flagged lines, and per-scene breakdowns.
 */
export function runEroticaDiagnostic(
  scenes: IdentifiedScene[],
  storyBible: PipelineStoryBible,
  inputSource: string,
): EroticaDiagnosticReport {
  // Run all 6 detectors
  const domResult = detectDomCommands(scenes, storyBible);
  const nicknameResult = detectNicknameOveruse(scenes, storyBible);
  const internalResult = detectInternalTemplate(scenes);
  const arcResult = detectArcShape(scenes, storyBible);
  const vulnResult = detectVulnerability(scenes);
  const structResult = detectStructural(scenes);
  const robResult = detectRobStyle(scenes);

  // Combine flagged lines from fixable detectors
  const allFlagged = [
    ...domResult.flagged,
    ...nicknameResult.flagged,
    ...internalResult.flagged,
    ...robResult.flagged,
  ];

  // Count line types (normalize speaker casing)
  let totalDialogue = 0;
  let totalInternal = 0;
  let totalNarration = 0;
  for (const scene of scenes) {
    for (const line of scene.lines) {
      const special = normalizeSpecialSpeaker((line.speaker ?? "").toUpperCase());
      if (special === "NARRATION" || special === "narration") totalNarration++;
      else if (special === "INTERNAL") totalInternal++;
      else totalDialogue++;
    }
  }

  // Build per-scene diagnostics
  const perScene: SceneDiagnostic[] = scenes.map(scene => {
    const sceneFlagged = allFlagged.filter(f => f.scene_id === scene.scene_id);
    const arcEntry = arcResult.metrics.arc_shapes.find(a => a.scene_id === scene.scene_id);

    // Vulnerability rate for this scene
    let sceneDialogue = 0;
    let sceneVulnerable = 0;
    for (const line of scene.lines) {
      const special = normalizeSpecialSpeaker((line.speaker ?? "").toUpperCase());
      if (special === null) {
        sceneDialogue++;
        // Simple check: reuse the vulnerability detector's regex logic
        const emotion = line.emotion ?? "";
        if (/vulnerab|tender|gentle|soft|warm|quiet|hesitant|afraid|scared|pleading|yielding|surrender/i.test(emotion)) {
          sceneVulnerable++;
        }
      }
    }

    return {
      scene_id: scene.scene_id,
      title: scene.title,
      total_lines: scene.lines.length,
      flagged_count: sceneFlagged.length,
      dom_command_count: sceneFlagged.filter(f => f.issue_type === "dom_command").length,
      nickname_count: sceneFlagged.filter(f => f.issue_type === "nickname_overuse").length,
      internal_template_count: sceneFlagged.filter(f => f.issue_type === "internal_template").length,
      arc_shape: arcEntry?.shape ?? "unknown",
      vulnerability_rate: sceneDialogue > 0 ? sceneVulnerable / sceneDialogue : 0,
    };
  });

  // Compute severity score (0-100)
  // Weighted: dom monotony 25, nickname overuse 10, internal template 15, arc sameness 20, vulnerability 8, rob style 22
  const robStylePenalty =
    Math.min(robResult.metrics.under_8_words_rate / 0.95, 1) * 8 +  // 95% under-8 = max penalty
    Math.min(robResult.metrics.internal_question_rate / 0.3, 1) * 7 + // 30% rhetorical Q = max
    Math.min(robResult.metrics.exclamation_rate / 0.15, 1) * 7;       // 15% excl = max
  const severityScore = Math.round(
    domResult.metrics.monotony_score * 25 +
    Math.min(nicknameResult.metrics.address_rate / 0.3, 1) * 10 +
    internalResult.metrics.template_uniformity_score * 15 +
    (1 - arcResult.metrics.shape_diversity_score) * 20 +
    (1 - Math.min(vulnResult.metrics.vulnerability_rate / 0.15, 1)) * 8 +
    robStylePenalty
  );

  const fixableIssues = allFlagged.length;
  const reportOnlyIssues =
    (arcResult.metrics.dominant_arc_frequency > scenes.length * 0.5 ? 1 : 0) +
    (vulnResult.metrics.vulnerability_rate < 0.05 ? 1 : 0);

  return {
    generated_at: new Date().toISOString(),
    input_source: inputSource,
    summary: {
      total_scenes: scenes.length,
      total_dialogue_lines: totalDialogue,
      total_internal_lines: totalInternal,
      total_narration_lines: totalNarration,
      fixable_issues: fixableIssues,
      report_only_issues: reportOnlyIssues,
      severity_score: Math.min(100, severityScore),
    },
    metrics: {
      dom_commands: domResult.metrics,
      nickname_overuse: nicknameResult.metrics,
      internal_template: internalResult.metrics,
      arc_shape: arcResult.metrics,
      vulnerability: vulnResult.metrics,
      structural: structResult.metrics,
      rob_style: robResult.metrics,
    },
    flagged_lines: allFlagged,
    per_scene: perScene,
  };
}

// ── Report Formatting ──────────────────────────────────────────────

/**
 * Format the diagnostic report as a human-readable string.
 */
export function formatReport(report: EroticaDiagnosticReport): string {
  const lines: string[] = [];
  const { summary: s, metrics: m } = report;

  lines.push("╔══════════════════════════════════════════════════════╗");
  lines.push("║       EROTICA DIALOGUE DIAGNOSTIC REPORT            ║");
  lines.push("╚══════════════════════════════════════════════════════╝");
  lines.push("");
  lines.push(`Source: ${report.input_source}`);
  lines.push(`Generated: ${report.generated_at}`);
  lines.push(`Severity Score: ${s.severity_score}/100`);
  lines.push("");
  lines.push(`Scenes: ${s.total_scenes}  |  Dialogue: ${s.total_dialogue_lines}  |  Internal: ${s.total_internal_lines}  |  Narration: ${s.total_narration_lines}`);
  lines.push(`Fixable issues: ${s.fixable_issues}  |  Report-only observations: ${s.report_only_issues}`);

  // Dom Commands
  lines.push("");
  lines.push("── DOM COMMAND MONOTONY ──────────────────────────────");
  const dc = m.dom_commands;
  lines.push(`Total dom lines: ${dc.total_dom_lines}  |  Short imperatives: ${dc.short_imperative_count} (${(dc.short_imperative_rate * 100).toFixed(1)}%)`);
  lines.push(`Monotony score: ${dc.monotony_score.toFixed(2)}  |  Unique shapes: ${dc.unique_command_shapes}  |  Longest speech: ${dc.longest_dom_speech_words} words`);
  lines.push(`Variety: imp=${dc.dom_speech_variety.short_imperative} question=${dc.dom_speech_variety.question} tease/long=${dc.dom_speech_variety.tease_or_longer} soft=${dc.dom_speech_variety.vulnerable_or_soft} medium=${dc.dom_speech_variety.medium_statement}`);
  if (dc.flagged_line_ids.length > 0) lines.push(`⚠ ${dc.flagged_line_ids.length} lines flagged for rewrite`);

  // Nickname Overuse
  lines.push("");
  lines.push("── NICKNAME/ADDRESS OVERUSE ──────────────────────────");
  const nn = m.nickname_overuse;
  lines.push(`Address rate: ${nn.total_address_uses}/${nn.total_dialogue_lines} (${(nn.address_rate * 100).toFixed(1)}%)`);
  lines.push(`Unique terms: ${nn.unique_addresses.join(", ") || "none"}`);
  for (const [speaker, data] of Object.entries(nn.address_by_speaker)) {
    const uniqueTerms = [...new Set(data.terms)].join(", ");
    lines.push(`  ${speaker}: ${data.count}x — ${uniqueTerms}`);
  }
  if (nn.flagged_line_ids.length > 0) lines.push(`⚠ ${nn.flagged_line_ids.length} lines flagged for rewrite`);

  // Internal Template
  lines.push("");
  lines.push("── INTERNAL TEMPLATE UNIFORMITY ─────────────────────");
  const it = m.internal_template;
  lines.push(`Total internals: ${it.total_internal_lines}`);
  lines.push(`Asterisk-wrapped: ${(it.asterisk_wrapped_rate * 100).toFixed(1)}%  |  Self-interruption: ${(it.self_interruption_rate * 100).toFixed(1)}%  |  Body sensation: ${(it.body_sensation_rate * 100).toFixed(1)}%`);
  lines.push(`Rhetorical questions: ${(it.rhetorical_question_rate * 100).toFixed(1)}%  |  Uniformity score: ${it.template_uniformity_score.toFixed(2)}`);
  lines.push("Fingerprints:");
  for (const [fp, count] of Object.entries(it.structural_fingerprints).sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${fp}: ${count}`);
  }
  if (it.flagged_line_ids.length > 0) lines.push(`⚠ ${it.flagged_line_ids.length} lines flagged for rewrite`);

  // Arc Shape (report-only)
  lines.push("");
  lines.push("── SUB ARC SHAPE (report-only) ──────────────────────");
  const arc = m.arc_shape;
  lines.push(`Scenes: ${arc.scene_count}  |  Diversity: ${arc.shape_diversity_score.toFixed(2)}  |  Dominant: "${arc.dominant_arc_shape}" (${arc.dominant_arc_frequency}x)`);
  lines.push("Opening emotions:");
  for (const [emotion, count] of Object.entries(arc.opening_emotion_distribution).sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${emotion}: ${count}`);
  }
  lines.push("Per-scene arcs:");
  for (const entry of arc.arc_shapes) {
    lines.push(`  ${entry.scene_id}: ${entry.shape}`);
  }

  // Vulnerability (report-only)
  lines.push("");
  lines.push("── VULNERABILITY (report-only) ──────────────────────");
  const vuln = m.vulnerability;
  lines.push(`Vulnerable lines: ${vuln.vulnerable_line_count}/${vuln.total_dialogue_lines} (${(vuln.vulnerability_rate * 100).toFixed(1)}%)`);
  for (const [speaker, data] of Object.entries(vuln.by_speaker)) {
    lines.push(`  ${speaker}: ${data.vulnerable}/${data.total} (${((data.vulnerable / data.total) * 100).toFixed(1)}%)`);
  }

  // Structural (open-ended)
  lines.push("");
  lines.push("── STRUCTURAL (open-ended) ──────────────────────────");
  const st = m.structural;
  lines.push(`Line length: mean=${st.line_length.mean} median=${st.line_length.median} stdev=${st.line_length.stdev} p10=${st.line_length.p10} p90=${st.line_length.p90}`);
  lines.push(`Max consecutive same speaker: ${st.consecutive_same_speaker_max}`);
  lines.push("Speaker balance:");
  for (const [speaker, count] of Object.entries(st.speaker_balance).sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${speaker}: ${count}`);
  }
  if (st.top_bigrams.length > 0) {
    lines.push("Top repeated bigrams (3+):");
    for (const { bigram, count } of st.top_bigrams) {
      lines.push(`  "${bigram}": ${count}x`);
    }
  }

  // Rob Style
  lines.push("");
  lines.push("── ROB STYLE DEVIATIONS ─────────────────────────────");
  const rs = m.rob_style;
  lines.push(`Sentence length: mean=${rs.mean_sentence_words} words  |  <8 words: ${(rs.under_8_words_rate * 100).toFixed(0)}%  |  8-18 zone: ${(rs.in_zone_rate * 100).toFixed(0)}%  |  >25: ${(rs.over_25_words_rate * 100).toFixed(0)}%`);
  lines.push(`Internal questions: ${rs.internal_question_count}/${m.internal_template.total_internal_lines} (${(rs.internal_question_rate * 100).toFixed(0)}%)  |  "Why/what/how" rhetorical: ${rs.why_what_how_count}`);
  lines.push(`Exclamation marks: ${rs.exclamation_line_count} lines (${(rs.exclamation_rate * 100).toFixed(0)}%)  [Rob: almost never]`);
  if (rs.flagged_line_ids.length > 0) lines.push(`⚠ ${rs.flagged_line_ids.length} lines flagged for rewrite`);

  // Per-scene summary
  lines.push("");
  lines.push("── PER-SCENE BREAKDOWN ─────────────────────────────");
  for (const ps of report.per_scene) {
    const flags = ps.flagged_count > 0 ? ` ⚠ ${ps.flagged_count} flagged` : "";
    lines.push(`  ${ps.scene_id} "${ps.title}" (${ps.total_lines} lines)${flags}`);
    lines.push(`    arc: ${ps.arc_shape}  |  vuln: ${(ps.vulnerability_rate * 100).toFixed(0)}%  |  dom: ${ps.dom_command_count}  nick: ${ps.nickname_count}  int: ${ps.internal_template_count}`);
  }

  return lines.join("\n");
}

// ── Report Comparison ──────────────────────────────────────────────

/**
 * Compare two diagnostic reports and produce a delta summary.
 */
export function compareReports(
  before: EroticaDiagnosticReport,
  after: EroticaDiagnosticReport,
): string {
  const lines: string[] = [];
  lines.push("╔══════════════════════════════════════════════════════╗");
  lines.push("║       DIAGNOSTIC COMPARISON                         ║");
  lines.push("╚══════════════════════════════════════════════════════╝");
  lines.push("");
  lines.push(`Before: ${before.input_source} (${before.generated_at})`);
  lines.push(`After:  ${after.input_source} (${after.generated_at})`);
  lines.push("");

  const delta = (label: string, before: number, after: number, unit = "", lower_better = true) => {
    const diff = after - before;
    const arrow = diff === 0 ? "=" : diff > 0 ? "▲" : "▼";
    const good = (lower_better && diff < 0) || (!lower_better && diff > 0);
    const marker = diff === 0 ? " " : good ? "✓" : "✗";
    lines.push(`${marker} ${label}: ${before}${unit} → ${after}${unit} (${arrow}${Math.abs(diff).toFixed(1)}${unit})`);
  };

  delta("Severity score", before.summary.severity_score, after.summary.severity_score);
  delta("Fixable issues", before.summary.fixable_issues, after.summary.fixable_issues);
  lines.push("");

  delta("Dom monotony", before.metrics.dom_commands.monotony_score * 100, after.metrics.dom_commands.monotony_score * 100, "%");
  delta("Dom short imp rate", before.metrics.dom_commands.short_imperative_rate * 100, after.metrics.dom_commands.short_imperative_rate * 100, "%");
  delta("Nickname rate", before.metrics.nickname_overuse.address_rate * 100, after.metrics.nickname_overuse.address_rate * 100, "%");
  delta("Internal uniformity", before.metrics.internal_template.template_uniformity_score * 100, after.metrics.internal_template.template_uniformity_score * 100, "%");
  delta("Arc diversity", before.metrics.arc_shape.shape_diversity_score * 100, after.metrics.arc_shape.shape_diversity_score * 100, "%", false);
  delta("Vulnerability rate", before.metrics.vulnerability.vulnerability_rate * 100, after.metrics.vulnerability.vulnerability_rate * 100, "%", false);
  lines.push("");
  delta("Sentence <8 words", before.metrics.rob_style.under_8_words_rate * 100, after.metrics.rob_style.under_8_words_rate * 100, "%");
  delta("Rhetorical Q rate", before.metrics.rob_style.internal_question_rate * 100, after.metrics.rob_style.internal_question_rate * 100, "%");
  delta("Exclamation rate", before.metrics.rob_style.exclamation_rate * 100, after.metrics.rob_style.exclamation_rate * 100, "%");

  return lines.join("\n");
}
