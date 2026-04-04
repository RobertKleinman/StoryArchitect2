/**
 * REWRITE REVIEW HTML GENERATOR
 * ================================
 * Generates a side-by-side HTML comparison of before/after rewrites
 * with changed lines highlighted.
 *
 * Usage: npx tsx scripts/rewrite-review-html.ts
 *   → opens data/postproduction/rewrite-tests/review.html
 */

import { readFile, readdir, writeFile } from "fs/promises";
import { resolve } from "path";

interface Line {
  speaker: string;
  text: string;
  emotion: string | null;
  _lid: string;
}

interface Scene {
  scene_id: string;
  title: string;
  lines: Line[];
}

interface TestData {
  source: string;
  mode: string;
  results: Array<{
    scene_id: string;
    status: string;
    diffs_applied: number;
    diffs_rejected: number;
    issues_addressed: string[];
  }>;
  before: Scene[];
  after: Scene[];
  before_report: any;
  after_report: any;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function speakerClass(speaker: string): string {
  const upper = speaker.toUpperCase();
  if (upper === "NARRATION") return "narration";
  if (upper === "INTERNAL") return "internal";
  return "dialogue";
}

function renderLine(line: Line): string {
  const cls = speakerClass(line.speaker);
  const emotion = line.emotion ? `<span class="emotion">(${escapeHtml(line.emotion)})</span> ` : "";
  const speaker = cls === "narration"
    ? `<span class="speaker-tag nar-tag">NARRATION</span>`
    : cls === "internal"
    ? `<span class="speaker-tag int-tag">INTERNAL</span>`
    : `<span class="speaker-tag dial-tag">${escapeHtml(line.speaker)}</span>`;

  return `<div class="line ${cls}">${speaker} ${emotion}${escapeHtml(line.text)}</div>`;
}

function didLineChange(before: Line, after: Line): boolean {
  return before.text !== after.text || before.emotion !== after.emotion || before.speaker !== after.speaker;
}

function renderMetricRow(label: string, before: number, after: number, unit: string, lowerBetter: boolean): string {
  const diff = after - before;
  const good = (lowerBetter && diff < 0) || (!lowerBetter && diff > 0);
  const cls = diff === 0 ? "metric-neutral" : good ? "metric-good" : "metric-bad";
  const arrow = diff === 0 ? "=" : diff > 0 ? "▲" : "▼";
  return `<tr class="${cls}">
    <td>${label}</td>
    <td>${before.toFixed(1)}${unit}</td>
    <td>${after.toFixed(1)}${unit}</td>
    <td>${arrow}${Math.abs(diff).toFixed(1)}${unit}</td>
  </tr>`;
}

async function main() {
  const dir = resolve("data/postproduction/rewrite-tests");
  const files = (await readdir(dir)).filter(f => f.endsWith(".json")).sort();

  const tests: TestData[] = [];
  for (const f of files) {
    tests.push(JSON.parse(await readFile(resolve(dir, f), "utf-8")));
  }

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Erotica Rewrite Review</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', system-ui, sans-serif; background: #0d1117; color: #c9d1d9; padding: 20px; }
  h1 { color: #58a6ff; margin-bottom: 20px; font-size: 1.4em; }
  h2 { color: #8b949e; margin: 30px 0 10px; font-size: 1.1em; border-bottom: 1px solid #21262d; padding-bottom: 6px; }
  h3 { color: #c9d1d9; margin: 20px 0 8px; font-size: 1em; }

  .test-block { margin-bottom: 50px; border: 1px solid #30363d; border-radius: 8px; padding: 20px; background: #161b22; }
  .source-info { color: #8b949e; font-size: 0.85em; margin-bottom: 15px; }

  .scene-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 0; margin-bottom: 30px; border: 1px solid #30363d; border-radius: 6px; overflow: hidden; }
  .scene-col { padding: 12px; }
  .scene-col.before { background: #1c1e24; border-right: 2px solid #30363d; }
  .scene-col.after { background: #1a1e25; }
  .col-header { font-weight: 600; font-size: 0.85em; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 1px solid #30363d; }
  .col-header.before-header { color: #f85149; }
  .col-header.after-header { color: #3fb950; }

  .line { padding: 4px 8px; margin: 2px 0; border-radius: 3px; font-size: 0.85em; line-height: 1.5; }
  .line.narration { color: #8b949e; font-style: italic; }
  .line.internal { color: #d2a8ff; }
  .line.dialogue { color: #c9d1d9; }
  .line.changed { background: rgba(56, 139, 253, 0.1); border-left: 3px solid #388bfd; }
  .line.unchanged { opacity: 0.7; }

  .speaker-tag { font-weight: 600; font-size: 0.8em; padding: 1px 5px; border-radius: 3px; margin-right: 4px; }
  .nar-tag { background: #21262d; color: #8b949e; }
  .int-tag { background: #2d1f4e; color: #d2a8ff; }
  .dial-tag { background: #1c3a5f; color: #58a6ff; }
  .emotion { color: #7ee787; font-size: 0.85em; }

  /* Metrics table */
  .metrics { margin: 15px 0; }
  .metrics table { border-collapse: collapse; font-size: 0.85em; }
  .metrics th, .metrics td { padding: 4px 12px; text-align: left; border-bottom: 1px solid #21262d; }
  .metrics th { color: #8b949e; font-weight: 500; }
  .metric-good { color: #3fb950; }
  .metric-bad { color: #f85149; }
  .metric-neutral { color: #8b949e; }

  .results-list { font-size: 0.85em; margin: 10px 0; }
  .results-list li { margin: 3px 0; color: #8b949e; }
  .results-list .fixed { color: #3fb950; }
</style>
</head>
<body>
<h1>Erotica Dialogue Rewrite — Side-by-Side Review</h1>
`;

  for (const test of tests) {
    const br = test.before_report;
    const ar = test.after_report;

    html += `<div class="test-block">`;
    html += `<div class="source-info">Source: ${escapeHtml(test.source)} | Mode: ${test.mode}</div>`;

    // Metrics comparison
    html += `<div class="metrics"><table>
      <tr><th>Metric</th><th>Before</th><th>After</th><th>Delta</th></tr>
      ${renderMetricRow("Severity", br.summary.severity_score, ar.summary.severity_score, "", true)}
      ${renderMetricRow("Fixable issues", br.summary.fixable_issues, ar.summary.fixable_issues, "", true)}
      ${renderMetricRow("Dom monotony", br.metrics.dom_commands.monotony_score * 100, ar.metrics.dom_commands.monotony_score * 100, "%", true)}
      ${renderMetricRow("Nickname rate", br.metrics.nickname_overuse.address_rate * 100, ar.metrics.nickname_overuse.address_rate * 100, "%", true)}
      ${renderMetricRow("Internal uniformity", br.metrics.internal_template.template_uniformity_score * 100, ar.metrics.internal_template.template_uniformity_score * 100, "%", true)}
      ${renderMetricRow("Sentence <8w", br.metrics.rob_style.under_8_words_rate * 100, ar.metrics.rob_style.under_8_words_rate * 100, "%", true)}
      ${renderMetricRow("Rhetorical Q", br.metrics.rob_style.internal_question_rate * 100, ar.metrics.rob_style.internal_question_rate * 100, "%", true)}
      ${renderMetricRow("Exclamation", br.metrics.rob_style.exclamation_rate * 100, ar.metrics.rob_style.exclamation_rate * 100, "%", true)}
      ${renderMetricRow("Vulnerability", br.metrics.vulnerability.vulnerability_rate * 100, ar.metrics.vulnerability.vulnerability_rate * 100, "%", false)}
    </table></div>`;

    // Results summary
    html += `<ul class="results-list">`;
    for (const r of test.results) {
      html += `<li class="${r.status === "fixed" ? "fixed" : ""}">${escapeHtml(r.scene_id)}: ${r.diffs_applied} applied, ${r.diffs_rejected} rejected`;
      for (const a of r.issues_addressed) {
        html += ` — ${escapeHtml(a)}`;
      }
      html += `</li>`;
    }
    html += `</ul>`;

    // Scene-by-scene comparison
    for (let i = 0; i < test.before.length; i++) {
      const before = test.before[i];
      const after = test.after[i];
      const maxLines = Math.max(before.lines.length, after.lines.length);

      html += `<h3>${escapeHtml(before.title)}</h3>`;
      html += `<div class="scene-pair">`;

      // Before column
      html += `<div class="scene-col before">`;
      html += `<div class="col-header before-header">Before</div>`;
      for (let j = 0; j < maxLines; j++) {
        if (j < before.lines.length) {
          const changed = j < after.lines.length && didLineChange(before.lines[j], after.lines[j]);
          html += `<div class="line ${speakerClass(before.lines[j].speaker)} ${changed ? "changed" : "unchanged"}">`;
          const emotion = before.lines[j].emotion ? `<span class="emotion">(${escapeHtml(before.lines[j].emotion)})</span> ` : "";
          const stag = speakerClass(before.lines[j].speaker) === "narration"
            ? `<span class="speaker-tag nar-tag">NAR</span>`
            : speakerClass(before.lines[j].speaker) === "internal"
            ? `<span class="speaker-tag int-tag">INT</span>`
            : `<span class="speaker-tag dial-tag">${escapeHtml(before.lines[j].speaker)}</span>`;
          html += `${stag} ${emotion}${escapeHtml(before.lines[j].text)}</div>`;
        }
      }
      html += `</div>`;

      // After column
      html += `<div class="scene-col after">`;
      html += `<div class="col-header after-header">After</div>`;
      for (let j = 0; j < maxLines; j++) {
        if (j < after.lines.length) {
          const changed = j < before.lines.length && didLineChange(before.lines[j], after.lines[j]);
          html += `<div class="line ${speakerClass(after.lines[j].speaker)} ${changed ? "changed" : "unchanged"}">`;
          const emotion = after.lines[j].emotion ? `<span class="emotion">(${escapeHtml(after.lines[j].emotion)})</span> ` : "";
          const stag = speakerClass(after.lines[j].speaker) === "narration"
            ? `<span class="speaker-tag nar-tag">NAR</span>`
            : speakerClass(after.lines[j].speaker) === "internal"
            ? `<span class="speaker-tag int-tag">INT</span>`
            : `<span class="speaker-tag dial-tag">${escapeHtml(after.lines[j].speaker)}</span>`;
          html += `${stag} ${emotion}${escapeHtml(after.lines[j].text)}</div>`;
        }
      }
      html += `</div>`;

      html += `</div>`; // scene-pair
    }

    html += `</div>`; // test-block
  }

  html += `</body></html>`;

  const outPath = resolve("data/postproduction/rewrite-tests/review.html");
  await writeFile(outPath, html);
  console.log(`Review page saved: ${outPath}`);
}

main().catch(console.error);
