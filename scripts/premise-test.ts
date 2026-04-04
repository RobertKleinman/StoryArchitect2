/**
 * PREMISE GENERATION TEST HARNESS
 * ==================================
 * Runs seeds through premise generation in both erotica-hybrid and erotica-fast modes.
 * Hybrid runs the premise judge; fast skips it.
 * Outputs readable results + metrics for review.
 *
 * Usage:
 *   npx tsx scripts/premise-test.ts                    # run all 10 seeds × 2 modes
 *   npx tsx scripts/premise-test.ts --mode hybrid      # only hybrid
 *   npx tsx scripts/premise-test.ts --mode fast        # only fast
 *   npx tsx scripts/premise-test.ts --seed 0,3,5       # specific seed indices
 */

import "dotenv/config";
import { randomUUID } from "crypto";
import { writeFile, mkdir } from "fs/promises";
import { resolve } from "path";
import { LLMClient } from "../backend/services/llmClient";
import { PremiseService } from "../backend/services/v2/premiseService";
import {
  EROTICA_HYBRID_V2_MODEL_CONFIG,
  EROTICA_FAST_V2_MODEL_CONFIG,
} from "../shared/modelConfig";
import { createProjectId, createOperationId } from "../shared/types/project";
import type { Step2_PremiseGenerating, GenerationMode } from "../shared/types/project";

// ── Seeds ──────────────────────────────────────────────────────────

const SEEDS: Array<{ id: string; seed: string }> = [
  {
    id: "bathhouse",
    seed: "Gay male foot fetish erotica. A demon-run bathhouse on a space station where twinks come to get clean but end up worshipping demon feet in the steam rooms. One regular — a shy, skinny twink mechanic — develops an obsession with a particular demon bouncer.",
  },
  {
    id: "military_academy",
    seed: "Gay male foot fetish erotica. A demon prince disguised as a human enrolls at a galactic military academy. His disguise is perfect except his feet — they're too large, too hot, and they smell like smoke. His roommate, a suspicious cadet, starts investigating.",
  },
  {
    id: "freighter_gym",
    seed: "Gay men only foot fetish erotica. A zero-gravity gym on a deep-space freighter where muscular crew members train barefoot. The ship's mechanic — quiet, enormous, covered in grease — has been stealing glances at the navigator's feet during workout sessions.",
  },
  {
    id: "prison_ship",
    seed: "Gay men only foot fetish erotica. A prison transport ship where inmates are kept barefoot for security. Two cellmates — a disgraced soldier and a con artist — are forced into close quarters during a six-month voyage to a penal colony.",
  },
  {
    id: "tattoo_parlor",
    seed: "Gay men only foot fetish erotica. A high-end galactic tattoo parlor that specializes in foot tattoos. The tattooist — lean, precise, covered in ink — takes on a new client: a nervous first-timer who's been fantasizing about this for years.",
  },
  {
    id: "bounty_hunter",
    seed: "Gay male foot fetish erotica. A twink bounty hunter tracks a rogue demon through abandoned space stations. The demon leaves musky footprints the twink can smell from corridors away. The chase becomes an obsession that blurs the line between hunter and prey.",
  },
  {
    id: "diplomatic_gala",
    seed: "Gay male foot worship erotica. A diplomatic gala aboard a crystalline space station. Ambassadors from rival star nations attend a treaty summit — but the real negotiations happen in private chambers where power is expressed through submission and worship.",
  },
  {
    id: "ocean_planet",
    seed: "Gay male foot worship erotica set on Thalassa, a bioluminescent ocean planet where humans live on floating reef-cities. A young xenobiologist discovers that the native symbiotic organisms bond through the feet — and a local fisherman offers to show him.",
  },
  {
    id: "cargo_smugglers",
    seed: "Gay male erotica with foot worship elements. A ragtag crew of smugglers on a beaten-up cargo ship. The captain is a scarred veteran who rules through loyalty, not fear. His newest crew member — young, cocky, trying to prove himself — keeps pushing boundaries.",
  },
  {
    id: "arena_rivals",
    seed: "Gay male erotica. Two rival fighters in an underground barefoot fighting circuit on a lawless asteroid colony. One is the reigning champion — arrogant, undefeated. The other is a newcomer with something to prove. Enemies to lovers through competition and grudging respect.",
  },
];

// ── Metrics ────────────────────────────────────────────────────────

interface PremiseMetrics {
  // Does the world make sense without the fetish?
  world_independence: number; // 0-1: how much of the premise works without fetish
  // Do characters have non-sexual functions?
  character_depth: number; // 0-1: fraction of characters with non-sexual roles
  // Is there conflict beyond the kink?
  conflict_independence: number; // 0-1: could the core conflict exist without the fetish
  // Does the synopsis suggest scene variety?
  scene_variety_signal: number; // 0-1: synopsis mentions non-fetish activities
  // Gender appropriateness
  gender_correct: boolean; // all characters match the orientation
  // Word counts
  hook_words: number;
  synopsis_words: number;
  // Character count
  character_count: number;
}

function computeMetrics(premise: any, seed: string): PremiseMetrics {
  const hook = premise.hook_sentence ?? "";
  const synopsis = premise.synopsis ?? "";
  const conflict = premise.core_conflict ?? "";
  const chars = premise.characters_sketch ?? [];
  const allText = `${hook} ${synopsis} ${conflict} ${premise.premise_paragraph ?? ""}`.toLowerCase();

  // Fetish keyword density
  const FETISH_WORDS = /\bfoot\b|feet|toes?|sole|heel|arch|worship|lick|suck|smell|musk|sweat|sniff|inhale|fetish|kink/gi;
  const allWords = allText.split(/\s+/).length;
  const fetishMatches = allText.match(FETISH_WORDS) ?? [];
  const fetishDensity = fetishMatches.length / allWords;

  // World independence: lower fetish density in setting/premise_paragraph = more independent
  const settingText = `${premise.setting_anchor ?? ""} ${premise.premise_paragraph ?? ""}`.toLowerCase();
  const settingFetish = (settingText.match(FETISH_WORDS) ?? []).length;
  const settingWords = settingText.split(/\s+/).length;
  const worldIndep = Math.max(0, 1 - (settingFetish / Math.max(settingWords, 1)) * 5);

  // Character depth: how many chars have roles beyond fetish
  const FETISH_ONLY_ROLES = /worship|fetish|foot|dom|sub|slave|master|kink/i;
  const charsWithDepth = chars.filter((c: any) => {
    const oneLiner = (c.one_liner ?? "").toLowerCase();
    const role = (c.role ?? "").toLowerCase();
    // Has the character got anything beyond fetish in their one-liner?
    const nonFetishContent = oneLiner.replace(FETISH_WORDS, "").trim();
    return nonFetishContent.length > oneLiner.length * 0.3 && !FETISH_ONLY_ROLES.test(role);
  });
  const charDepth = chars.length > 0 ? charsWithDepth.length / chars.length : 0;

  // Conflict independence: does core_conflict work without fetish?
  const conflictFetish = (conflict.match(FETISH_WORDS) ?? []).length;
  const conflictWords = conflict.split(/\s+/).length;
  const conflictIndep = Math.max(0, 1 - (conflictFetish / Math.max(conflictWords, 1)) * 3);

  // Scene variety signal: synopsis mentions non-fetish activities
  const DRAMA_WORDS = /betray|discover|reveal|confront|negotiate|argue|plan|escape|fight|trust|lie|secret|ally|rival|strategy|politics|career|ambition|fear|guilt|debt|duty|friendship|humor|comedy/gi;
  const dramaMatches = synopsis.match(DRAMA_WORDS) ?? [];
  const sceneVariety = Math.min(1, dramaMatches.length / 5); // 5+ drama words = max

  // Gender check: for "gay male" seeds, all chars should be male-presenting
  const isGayMale = /gay\s+m(ale|en)/i.test(seed);
  const genderCorrect = !isGayMale || chars.every((c: any) => {
    const pres = (c.presentation ?? "").toLowerCase();
    return pres === "masculine" || pres === "male" || pres === "";
  });

  return {
    world_independence: Math.round(worldIndep * 100) / 100,
    character_depth: Math.round(charDepth * 100) / 100,
    conflict_independence: Math.round(conflictIndep * 100) / 100,
    scene_variety_signal: Math.round(sceneVariety * 100) / 100,
    gender_correct: genderCorrect,
    hook_words: hook.split(/\s+/).length,
    synopsis_words: synopsis.split(/\s+/).length,
    character_count: chars.length,
  };
}

// ── Project Factory ────────────────────────────────────────────────

function makeProject(seed: string, mode: GenerationMode): Step2_PremiseGenerating {
  return {
    step: "premise_generating" as const,
    projectId: createProjectId(`v2_test_${randomUUID()}`),
    operationId: createOperationId(randomUUID()),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    seedInput: seed,
    conversationTurns: [],
    traces: [],
    psychologyLedger: {
      signalStore: [],
      reads: [],
      assumptionDeltas: [],
      probeHistory: [],
      heuristics: {
        typeRatio: 0.5,
        avgResponseLength: 0,
        deferralRate: 0,
        changeRate: 0,
        totalInteractions: 0,
        engagementTrend: 0,
      },
    },
    constraintLedger: [],
    culturalInsights: [],
    mode,
  };
}

// ── Main ───────────────────────────────────────────────────────────

interface TestResult {
  seedId: string;
  seed: string;
  mode: GenerationMode;
  premise: any;
  metrics: PremiseMetrics;
  judgeRan: boolean;
  judgePassed: boolean | null;
  judgeIssues: string[];
  durationMs: number;
  error?: string;
}

async function main() {
  const args = process.argv.slice(2);
  const modeFilter = args.find(a => a.startsWith("--mode="))?.split("=")[1]
    ?? (args.includes("--mode") ? args[args.indexOf("--mode") + 1] : null);
  const seedFilter = args.find(a => a.startsWith("--seed="))?.split("=")[1]
    ?? (args.includes("--seed") ? args[args.indexOf("--seed") + 1] : null);

  const modes: GenerationMode[] = modeFilter === "hybrid" ? ["erotica-hybrid"]
    : modeFilter === "fast" ? ["erotica-fast"]
    : ["erotica-hybrid", "erotica-fast"];

  const seedIndices = seedFilter
    ? seedFilter.split(",").map(Number)
    : SEEDS.map((_, i) => i);

  const selectedSeeds = seedIndices.map(i => SEEDS[i]).filter(Boolean);

  console.log(`Running ${selectedSeeds.length} seeds × ${modes.length} modes = ${selectedSeeds.length * modes.length} premises\n`);

  const results: TestResult[] = [];

  for (const mode of modes) {
    const config = mode === "erotica-hybrid" ? EROTICA_HYBRID_V2_MODEL_CONFIG : EROTICA_FAST_V2_MODEL_CONFIG;
    const llm = new LLMClient(undefined, config);
    const service = new PremiseService(llm);
    const skipJudge = mode === "erotica-fast";

    console.log(`═══ MODE: ${mode} (judge: ${skipJudge ? "SKIPPED" : "ENABLED"}) ═══\n`);

    for (const { id, seed } of selectedSeeds) {
      const project = makeProject(seed, mode);
      const startMs = Date.now();

      try {
        const result = await service.generate(project, undefined, skipJudge ? { skipJudge: true } : undefined);
        const durationMs = Date.now() - startMs;
        const premise = result.premise;
        const metrics = computeMetrics(premise, seed);

        // Check if judge ran by looking at traces
        const judgeTrace = result.traces.find(t => t.role === "premise_judge");
        const judgeRan = !!judgeTrace;

        // Try to extract judge result from traces/logs (not directly available)
        // We can infer from whether a repair trace exists
        const repairTrace = result.traces.find(t => t.substep === "repair");
        const judgePassed = judgeRan ? !repairTrace : null;

        results.push({
          seedId: id,
          seed,
          mode,
          premise,
          metrics,
          judgeRan,
          judgePassed,
          judgeIssues: [], // would need to capture from judge output
          durationMs,
        });

        console.log(`  ✓ ${id} (${(durationMs / 1000).toFixed(1)}s) — hook: "${premise.hook_sentence?.substring(0, 80)}..."`);
        console.log(`    metrics: world=${metrics.world_independence} chars=${metrics.character_depth} conflict=${metrics.conflict_independence} variety=${metrics.scene_variety_signal} gender=${metrics.gender_correct ? "OK" : "FAIL"}`);

      } catch (err: any) {
        const durationMs = Date.now() - startMs;
        console.log(`  ✗ ${id} — ERROR: ${err.message}`);
        results.push({
          seedId: id,
          seed,
          mode,
          premise: null,
          metrics: {} as PremiseMetrics,
          judgeRan: false,
          judgePassed: null,
          judgeIssues: [],
          durationMs,
          error: err.message,
        });
      }
    }
    console.log();
  }

  // ── Summary Table ──
  console.log("╔══════════════════════════════════════════════════════════════════════════════╗");
  console.log("║                    PREMISE GENERATION — SUMMARY                            ║");
  console.log("╚══════════════════════════════════════════════════════════════════════════════╝\n");

  console.log("Seed             Mode            World  Chars  Conflict  Variety  Gender  Hook  Synopsis  Judge");
  console.log("───────────────  ──────────────  ─────  ─────  ────────  ───────  ──────  ────  ────────  ─────");

  for (const r of results) {
    if (!r.premise) {
      console.log(`${r.seedId.padEnd(15)}  ${r.mode.padEnd(14)}  ERROR: ${r.error?.substring(0, 50)}`);
      continue;
    }
    const m = r.metrics;
    console.log(
      `${r.seedId.padEnd(15)}  ${r.mode.padEnd(14)}  ` +
      `${m.world_independence.toFixed(2).padStart(5)}  ` +
      `${m.character_depth.toFixed(2).padStart(5)}  ` +
      `${m.conflict_independence.toFixed(2).padStart(8)}  ` +
      `${m.scene_variety_signal.toFixed(2).padStart(7)}  ` +
      `${(m.gender_correct ? "OK" : "FAIL").padStart(6)}  ` +
      `${String(m.hook_words).padStart(4)}  ` +
      `${String(m.synopsis_words).padStart(8)}  ` +
      `${r.judgeRan ? (r.judgePassed ? "PASS" : "FAIL→FIX") : "skip"}`
    );
  }

  // Aggregate by mode
  console.log("\n── AGGREGATE BY MODE ──");
  for (const mode of modes) {
    const modeResults = results.filter(r => r.mode === mode && r.premise);
    if (modeResults.length === 0) continue;
    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    console.log(`\n${mode}:`);
    console.log(`  World independence:    ${(avg(modeResults.map(r => r.metrics.world_independence)) * 100).toFixed(1)}%`);
    console.log(`  Character depth:       ${(avg(modeResults.map(r => r.metrics.character_depth)) * 100).toFixed(1)}%`);
    console.log(`  Conflict independence: ${(avg(modeResults.map(r => r.metrics.conflict_independence)) * 100).toFixed(1)}%`);
    console.log(`  Scene variety signal:  ${(avg(modeResults.map(r => r.metrics.scene_variety_signal)) * 100).toFixed(1)}%`);
    console.log(`  Gender correct:        ${modeResults.filter(r => r.metrics.gender_correct).length}/${modeResults.length}`);
    console.log(`  Avg duration:          ${(avg(modeResults.map(r => r.durationMs)) / 1000).toFixed(1)}s`);
  }

  // ── Save results ──
  const outDir = resolve("data/postproduction/premise-tests");
  await mkdir(outDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const jsonPath = resolve(outDir, `premise-test-${ts}.json`);
  await writeFile(jsonPath, JSON.stringify(results, null, 2));
  console.log(`\nResults saved: ${jsonPath}`);

  // ── Generate HTML review ──
  const htmlPath = resolve(outDir, `premise-test-${ts}.html`);
  await writeFile(htmlPath, generateHTML(results, modes));
  console.log(`Review page: ${htmlPath}`);
}

// ── HTML Generator ─────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function generateHTML(results: TestResult[], modes: GenerationMode[]): string {
  let html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<title>Premise Test Results</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', system-ui, sans-serif; background: #0d1117; color: #c9d1d9; padding: 20px; max-width: 1400px; margin: 0 auto; }
  h1 { color: #58a6ff; margin-bottom: 20px; font-size: 1.4em; }
  h2 { color: #8b949e; margin: 25px 0 10px; font-size: 1.1em; border-bottom: 1px solid #21262d; padding-bottom: 6px; }
  h3 { color: #c9d1d9; margin: 15px 0 6px; font-size: 1em; }

  .seed-group { margin-bottom: 40px; }
  .seed-label { color: #d2a8ff; font-weight: 600; font-size: 0.9em; margin-bottom: 4px; }
  .seed-text { color: #8b949e; font-size: 0.8em; margin-bottom: 12px; font-style: italic; }

  .mode-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; }
  .premise-card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 14px; }
  .premise-card.single { grid-column: 1 / -1; max-width: 50%; }
  .mode-badge { display: inline-block; font-size: 0.75em; font-weight: 600; padding: 2px 8px; border-radius: 3px; margin-bottom: 8px; }
  .mode-badge.hybrid { background: #1f3d2b; color: #3fb950; }
  .mode-badge.fast { background: #3d2b1f; color: #d29922; }

  .field { margin-bottom: 8px; }
  .field-label { color: #8b949e; font-size: 0.75em; text-transform: uppercase; letter-spacing: 0.05em; }
  .field-value { color: #c9d1d9; font-size: 0.85em; line-height: 1.5; }
  .field-value.hook { color: #58a6ff; font-weight: 500; }

  .metrics-bar { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 8px; padding-top: 8px; border-top: 1px solid #21262d; }
  .metric { font-size: 0.75em; padding: 2px 6px; border-radius: 3px; }
  .metric.good { background: #1f3d2b; color: #3fb950; }
  .metric.mid { background: #3d3520; color: #d29922; }
  .metric.bad { background: #3d1f1f; color: #f85149; }

  .chars-list { margin-top: 4px; }
  .char-item { font-size: 0.8em; color: #8b949e; margin-left: 12px; }
  .char-item .name { color: #c9d1d9; font-weight: 500; }

  .judge-badge { font-size: 0.75em; padding: 2px 8px; border-radius: 3px; }
  .judge-badge.pass { background: #1f3d2b; color: #3fb950; }
  .judge-badge.fail { background: #3d1f1f; color: #f85149; }
  .judge-badge.skip { background: #21262d; color: #8b949e; }

  .review-area { margin-top: 8px; }
  .review-area textarea { width: 100%; background: #0d1117; border: 1px solid #30363d; color: #c9d1d9; padding: 6px; border-radius: 4px; font-size: 0.8em; min-height: 40px; resize: vertical; }
</style></head><body>
<h1>Premise Generation Test — Erotica Modes</h1>
`;

  // Group by seed
  const seedIds = [...new Set(results.map(r => r.seedId))];

  for (const seedId of seedIds) {
    const seedResults = results.filter(r => r.seedId === seedId);
    const seed = seedResults[0]?.seed ?? "";

    html += `<div class="seed-group">`;
    html += `<div class="seed-label">${esc(seedId)}</div>`;
    html += `<div class="seed-text">${esc(seed.substring(0, 200))}${seed.length > 200 ? "..." : ""}</div>`;

    html += `<div class="mode-pair">`;

    for (const r of seedResults) {
      if (!r.premise) {
        html += `<div class="premise-card"><span class="mode-badge ${r.mode.includes("hybrid") ? "hybrid" : "fast"}">${esc(r.mode)}</span><p style="color:#f85149">ERROR: ${esc(r.error ?? "unknown")}</p></div>`;
        continue;
      }

      const m = r.metrics;
      const modeClass = r.mode.includes("hybrid") ? "hybrid" : "fast";

      html += `<div class="premise-card">`;
      html += `<span class="mode-badge ${modeClass}">${esc(r.mode)}</span> `;
      html += `<span class="judge-badge ${r.judgeRan ? (r.judgePassed ? "pass" : "fail") : "skip"}">${r.judgeRan ? (r.judgePassed ? "Judge: PASS" : "Judge: FAIL→REPAIR") : "Judge: skipped"}</span>`;
      html += ` <span style="color:#8b949e;font-size:0.75em">${(r.durationMs / 1000).toFixed(1)}s</span>`;

      html += `<div class="field"><div class="field-label">Hook</div><div class="field-value hook">${esc(r.premise.hook_sentence ?? "")}</div></div>`;
      html += `<div class="field"><div class="field-label">Core Conflict</div><div class="field-value">${esc(r.premise.core_conflict ?? "")}</div></div>`;
      html += `<div class="field"><div class="field-label">Synopsis</div><div class="field-value">${esc(r.premise.synopsis ?? "")}</div></div>`;
      html += `<div class="field"><div class="field-label">Setting</div><div class="field-value">${esc(r.premise.setting_anchor ?? "")}</div></div>`;
      html += `<div class="field"><div class="field-label">Tone</div><div class="field-value">${esc((r.premise.tone_chips ?? []).join(", "))}</div></div>`;

      // Characters
      html += `<div class="field"><div class="field-label">Characters (${r.premise.characters_sketch?.length ?? 0})</div><div class="chars-list">`;
      for (const c of (r.premise.characters_sketch ?? [])) {
        html += `<div class="char-item"><span class="name">${esc(c.name ?? "?")}</span> (${esc(c.role ?? "?")}): ${esc(c.one_liner ?? "")}</div>`;
      }
      html += `</div></div>`;

      // Metrics
      const metricClass = (val: number, lo: number, hi: number) => val >= hi ? "good" : val >= lo ? "mid" : "bad";
      html += `<div class="metrics-bar">`;
      html += `<span class="metric ${metricClass(m.world_independence, 0.3, 0.6)}">World: ${(m.world_independence * 100).toFixed(0)}%</span>`;
      html += `<span class="metric ${metricClass(m.character_depth, 0.3, 0.5)}">CharDepth: ${(m.character_depth * 100).toFixed(0)}%</span>`;
      html += `<span class="metric ${metricClass(m.conflict_independence, 0.3, 0.5)}">Conflict: ${(m.conflict_independence * 100).toFixed(0)}%</span>`;
      html += `<span class="metric ${metricClass(m.scene_variety_signal, 0.3, 0.6)}">Variety: ${(m.scene_variety_signal * 100).toFixed(0)}%</span>`;
      html += `<span class="metric ${m.gender_correct ? "good" : "bad"}">Gender: ${m.gender_correct ? "OK" : "FAIL"}</span>`;
      html += `</div>`;

      // Review textarea
      html += `<div class="review-area"><textarea placeholder="Your notes on this premise..."></textarea></div>`;

      html += `</div>`; // premise-card
    }

    html += `</div>`; // mode-pair
    html += `</div>`; // seed-group
  }

  html += `</body></html>`;
  return html;
}

main().catch(err => {
  console.error("Fatal:", err.message ?? err);
  process.exit(1);
});
