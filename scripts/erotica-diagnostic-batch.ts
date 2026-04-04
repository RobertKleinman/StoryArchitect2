/**
 * BATCH EROTICA DIAGNOSTIC
 * ==========================
 * Runs the diagnostic on all erotica stories in data/v2/ and produces
 * a summary table + individual reports.
 *
 * Usage: npx tsx scripts/erotica-diagnostic-batch.ts
 */

import { readFile, readdir, writeFile, mkdir } from "fs/promises";
import { resolve, join } from "path";
import { loadFromCombinedJSON, extractVNScene } from "../postproduction/loader";
import type { VNScene, IdentifiedScene, IdentifiedLine } from "../postproduction/types";
import { runEroticaDiagnostic } from "../postproduction/erotica/diagnostic";
import type { EroticaDiagnosticReport } from "../postproduction/erotica/types";

function assignLineIds(scene: VNScene): IdentifiedScene {
  const lines: IdentifiedLine[] = scene.lines.map((line, i) => ({
    ...line,
    _lid: `${scene.scene_id}_L${String(i).padStart(3, "0")}`,
  }));
  return { ...scene, lines };
}

interface StoryResult {
  file: string;
  mode: string;
  title: string;
  scenes: number;
  report: EroticaDiagnosticReport;
}

async function main() {
  const v2Dir = resolve("data/v2");
  const files = (await readdir(v2Dir)).filter(f => f.endsWith(".json"));

  const results: StoryResult[] = [];
  let skipped = 0;

  for (const file of files) {
    const fullPath = join(v2Dir, file);
    try {
      const raw = JSON.parse(await readFile(fullPath, "utf-8"));
      const mode = raw.mode || "unknown";
      if (!mode.includes("erotica")) continue;

      const input = await loadFromCombinedJSON(fullPath);
      const scenes: IdentifiedScene[] = [];
      for (const pScene of input.scenes) {
        const vnScene = extractVNScene(pScene);
        if (vnScene && vnScene.lines?.length > 0) {
          scenes.push(assignLineIds(vnScene));
        }
      }

      if (scenes.length === 0) { skipped++; continue; }

      const report = runEroticaDiagnostic(scenes, input.storyBible, file);
      const title = raw.premise?.hook_sentence?.substring(0, 55) || "(no title)";
      results.push({ file, mode, title, scenes: scenes.length, report });
    } catch (err: any) {
      console.error(`  SKIP ${file}: ${err.message}`);
      skipped++;
    }
  }

  // Sort by severity score descending
  results.sort((a, b) => b.report.summary.severity_score - a.report.summary.severity_score);

  // Print summary table
  console.log("╔══════════════════════════════════════════════════════════════════════════════════════════════╗");
  console.log("║                       EROTICA DIALOGUE DIAGNOSTIC — BATCH RESULTS                         ║");
  console.log("╚══════════════════════════════════════════════════════════════════════════════════════════════╝");
  console.log(`\nAnalyzed: ${results.length} stories  |  Skipped: ${skipped}\n`);

  // Header
  console.log(
    "Sev  Sc  DomMon  Nick%  IntUnf  ArcDiv  Vuln%  <8w%  Rhet%  Excl%  Fix  Mode           Title"
  );
  console.log("───  ──  ──────  ─────  ──────  ──────  ─────  ────  ─────  ─────  ───  ─────────────  " + "─".repeat(55));

  for (const r of results) {
    const s = r.report.summary;
    const m = r.report.metrics;
    console.log(
      `${String(s.severity_score).padStart(3)}  ` +
      `${String(r.scenes).padStart(2)}  ` +
      `${(m.dom_commands.monotony_score * 100).toFixed(0).padStart(4)}%   ` +
      `${(m.nickname_overuse.address_rate * 100).toFixed(0).padStart(3)}%   ` +
      `${(m.internal_template.template_uniformity_score * 100).toFixed(0).padStart(4)}%   ` +
      `${(m.arc_shape.shape_diversity_score * 100).toFixed(0).padStart(4)}%   ` +
      `${(m.vulnerability.vulnerability_rate * 100).toFixed(0).padStart(3)}%  ` +
      `${(m.rob_style.under_8_words_rate * 100).toFixed(0).padStart(3)}%  ` +
      `${(m.rob_style.internal_question_rate * 100).toFixed(0).padStart(3)}%   ` +
      `${(m.rob_style.exclamation_rate * 100).toFixed(0).padStart(3)}%  ` +
      `${String(s.fixable_issues).padStart(3)}  ` +
      `${r.mode.padEnd(13)}  ` +
      `${r.title}`
    );
  }

  // Aggregate stats
  console.log("\n── AGGREGATE STATS ──────────────────────────────────────────────");
  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const severities = results.map(r => r.report.summary.severity_score);
  const domScores = results.map(r => r.report.metrics.dom_commands.monotony_score);
  const nickRates = results.map(r => r.report.metrics.nickname_overuse.address_rate);
  const intScores = results.map(r => r.report.metrics.internal_template.template_uniformity_score);
  const arcDiversity = results.map(r => r.report.metrics.arc_shape.shape_diversity_score);
  const vulnRates = results.map(r => r.report.metrics.vulnerability.vulnerability_rate);

  console.log(`Severity:       mean=${avg(severities).toFixed(1)}  min=${Math.min(...severities)}  max=${Math.max(...severities)}`);
  console.log(`Dom monotony:   mean=${(avg(domScores)*100).toFixed(1)}%`);
  console.log(`Nickname rate:  mean=${(avg(nickRates)*100).toFixed(1)}%`);
  console.log(`Internal unif:  mean=${(avg(intScores)*100).toFixed(1)}%`);
  console.log(`Arc diversity:  mean=${(avg(arcDiversity)*100).toFixed(1)}%`);
  console.log(`Vulnerability:  mean=${(avg(vulnRates)*100).toFixed(1)}%`);
  const under8Rates = results.map(r => r.report.metrics.rob_style.under_8_words_rate);
  const rhetRates = results.map(r => r.report.metrics.rob_style.internal_question_rate);
  const exclRates = results.map(r => r.report.metrics.rob_style.exclamation_rate);
  console.log(`Sentence <8w:   mean=${(avg(under8Rates)*100).toFixed(1)}%  (Rob zone: 8-18 words)`);
  console.log(`Rhetorical Q:   mean=${(avg(rhetRates)*100).toFixed(1)}%  (Rob: avoid in internal)`);
  console.log(`Exclamation:    mean=${(avg(exclRates)*100).toFixed(1)}%  (Rob: almost never)`);

  // Save all reports
  const outDir = resolve("data/postproduction/diagnostics");
  await mkdir(outDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const batchPath = resolve(outDir, `batch-${ts}.json`);
  await writeFile(batchPath, JSON.stringify(results.map(r => ({
    file: r.file, mode: r.mode, title: r.title, scenes: r.scenes, report: r.report,
  })), null, 2));
  console.log(`\nBatch report saved: ${batchPath}`);
}

main().catch(err => {
  console.error("Error:", err.message ?? err);
  process.exit(1);
});
