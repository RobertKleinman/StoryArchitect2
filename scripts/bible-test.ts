/**
 * BIBLE GENERATION TEST HARNESS
 * ================================
 * Feeds saved premises into bible generation to test upstream constraints.
 * Uses premises from the premise test run — no re-generation needed.
 *
 * Usage:
 *   npx tsx scripts/bible-test.ts                          # 3 default seeds, hybrid mode
 *   npx tsx scripts/bible-test.ts --mode fast              # fast mode
 *   npx tsx scripts/bible-test.ts --seeds bathhouse,prison_ship
 */

import "dotenv/config";
import { randomUUID } from "crypto";
import { readFile, writeFile, mkdir } from "fs/promises";
import { resolve } from "path";
import { LLMClient } from "../backend/services/llmClient";
import { BibleService } from "../backend/services/v2/bibleService";
import {
  EROTICA_HYBRID_V2_MODEL_CONFIG,
  EROTICA_FAST_V2_MODEL_CONFIG,
} from "../shared/modelConfig";
import { createProjectId, createOperationId } from "../shared/types/project";
import type { Step4_BibleGenerating, GenerationMode } from "../shared/types/project";
import type { PremiseArtifact } from "../shared/types/artifacts";

// ── Defaults ──

const DEFAULT_SEEDS = ["cargo_smugglers", "prison_ship", "ocean_planet"];
const DEFAULT_MODE: GenerationMode = "erotica-hybrid";

// ── Build project from saved premise ──

function makeProject(premise: PremiseArtifact, mode: GenerationMode): Step4_BibleGenerating {
  const now = new Date().toISOString();
  return {
    step: "bible_generating" as const,
    projectId: createProjectId(`v2_btest_${randomUUID()}`),
    operationId: createOperationId(randomUUID()),
    createdAt: now,
    updatedAt: now,
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
    premise,
    checkpoint: { completedSubSteps: [] },
  };
}

// ── Analysis ──

function analyzeBible(bible: any, scenePlan: any, seed: string): Record<string, any> {
  const FETISH = /foot|feet|toes?|sole|heel|arch|worship|lick|suck|smell|musk|sweat|sniff|inhale|fetish|kink/gi;

  // Characters
  const chars = Object.entries(bible.characters || {});
  const femaleChars = chars.filter(([, c]: any) => {
    const p = (c.presentation || "").toLowerCase();
    return p === "feminine" || p === "female";
  });
  const charsWithNonFetishWant = chars.filter(([, c]: any) => {
    const want = (c.psychological_profile?.want || "").toLowerCase();
    FETISH.lastIndex = 0;
    return !FETISH.test(want);
  });

  // Locations
  const locs = bible.world?.arena?.locations || [];
  const nonFetishLocs = locs.filter((l: any) => {
    const desc = (l.description || "").toLowerCase();
    FETISH.lastIndex = 0;
    return !FETISH.test(desc);
  });

  // Plot beats
  const beats = bible.plot?.tension_chain || [];
  const nonFetishBeats = beats.filter((b: any) => {
    const text = (b.beat || "").toLowerCase();
    FETISH.lastIndex = 0;
    return !FETISH.test(text);
  });

  // Scene plan
  const scenes = scenePlan?.scenes || [];
  const scenesWithoutDirectives = scenes.filter((s: any) =>
    !s.content_directives || s.content_directives.length === 0
  );

  // Voice patterns — check for fetish-narrator characters
  const fetishNarrators = chars.filter(([, c]: any) => {
    const voice = (c.psychological_profile?.voice_pattern || "").toLowerCase();
    return /erotic|fetish|worship|lick|suck/i.test(voice);
  });

  return {
    total_chars: chars.length,
    female_chars: femaleChars.map(([n]: any) => n),
    chars_with_non_fetish_want: charsWithNonFetishWant.length,
    total_locations: locs.length,
    non_fetish_locations: nonFetishLocs.length,
    fetish_narrator_chars: fetishNarrators.map(([n]: any) => n),
    total_beats: beats.length,
    non_fetish_beats: nonFetishBeats.length,
    non_fetish_beat_pct: beats.length > 0 ? Math.round((nonFetishBeats.length / beats.length) * 100) : 0,
    total_scenes: scenes.length,
    scenes_without_directives: scenesWithoutDirectives.length,
    scenes_without_directives_pct: scenes.length > 0 ? Math.round((scenesWithoutDirectives.length / scenes.length) * 100) : 0,
  };
}

// ── Main ──

async function main() {
  const args = process.argv.slice(2);
  const modeArg = args.find(a => a.startsWith("--mode"))
    ? (args[args.indexOf("--mode") + 1] === "fast" ? "erotica-fast" : "erotica-hybrid")
    : DEFAULT_MODE;
  const seedArg = args.find(a => a.startsWith("--seeds"))
    ? args[args.indexOf("--seeds") + 1].split(",")
    : DEFAULT_SEEDS;

  // Load saved premises
  const premiseFile = await readFile(resolve("data/postproduction/premise-tests/premise-test-2026-04-04T16-36-51.json"), "utf-8");
  const premiseResults = JSON.parse(premiseFile);

  // Find matching premises (prefer hybrid mode for quality)
  const selectedPremises: Array<{ seedId: string; premise: PremiseArtifact }> = [];
  for (const seedId of seedArg) {
    const match = premiseResults.find((r: any) => r.seedId === seedId && r.mode === "erotica-hybrid" && r.premise);
    if (match) {
      // Backfill orientation from seed if not stored on premise (for older test data)
      if (!match.premise.erotica_orientation && match.seed) {
        const seedLower = match.seed.toLowerCase();
        if (/\bgay\s+m(ale|en)\b|\ball[- ]male\b|\bmen\s+only\b/.test(seedLower)) {
          match.premise.erotica_orientation = "gay male";
        } else if (/\blesbian\b|\bgay\s+female\b|\ball[- ]female\b/.test(seedLower)) {
          match.premise.erotica_orientation = "lesbian";
        }
      }
      selectedPremises.push({ seedId, premise: match.premise });
    } else {
      console.log(`WARNING: No premise found for seed "${seedId}" — skipping`);
    }
  }

  const mode = modeArg as GenerationMode;
  const skipJudge = mode === "erotica-fast";
  const config = mode === "erotica-hybrid" ? EROTICA_HYBRID_V2_MODEL_CONFIG : EROTICA_FAST_V2_MODEL_CONFIG;

  console.log(`Running ${selectedPremises.length} bibles in ${mode} mode (judge: ${skipJudge ? "SKIPPED" : "ENABLED"})\n`);

  const results: Array<{
    seedId: string;
    mode: GenerationMode;
    bible: any;
    scenePlan: any;
    analysis: Record<string, any>;
    durationMs: number;
    error?: string;
  }> = [];

  for (const { seedId, premise } of selectedPremises) {
    console.log(`═══ ${seedId} ═══`);
    console.log(`Hook: ${premise.hook_sentence?.substring(0, 80)}...`);

    const llm = new LLMClient(undefined, config);
    const service = new BibleService(llm);
    const project = makeProject(premise, mode);
    const startMs = Date.now();

    try {
      const result = await service.generate(
        project,
        undefined,
        async (updated) => {
          const steps = updated.checkpoint.completedSubSteps;
          console.log(`  [checkpoint] ${steps[steps.length - 1]}`);
        },
        skipJudge ? { skipJudge: true, skipStepBack: true } : undefined,
      );

      const durationMs = Date.now() - startMs;
      const analysis = analyzeBible(result.storyBible, result.scenePlan, seedId);

      console.log(`  ✓ Done (${(durationMs / 1000).toFixed(0)}s)`);
      console.log(`  Characters: ${analysis.total_chars} (female: ${analysis.female_chars.length > 0 ? analysis.female_chars.join(", ") : "none"})`);
      console.log(`  Non-fetish wants: ${analysis.chars_with_non_fetish_want}/${analysis.total_chars}`);
      console.log(`  Fetish narrators: ${analysis.fetish_narrator_chars.length > 0 ? analysis.fetish_narrator_chars.join(", ") : "none"}`);
      console.log(`  Locations: ${analysis.non_fetish_locations}/${analysis.total_locations} non-fetish`);
      console.log(`  Plot beats: ${analysis.non_fetish_beats}/${analysis.total_beats} non-fetish (${analysis.non_fetish_beat_pct}%)`);
      console.log(`  Scenes w/o directives: ${analysis.scenes_without_directives}/${analysis.total_scenes} (${analysis.scenes_without_directives_pct}%)`);
      console.log();

      results.push({
        seedId,
        mode,
        bible: result.storyBible,
        scenePlan: result.scenePlan,
        analysis,
        durationMs,
      });
    } catch (err: any) {
      const durationMs = Date.now() - startMs;
      console.log(`  ✗ ERROR (${(durationMs / 1000).toFixed(0)}s): ${err.message}`);
      console.log();
      results.push({ seedId, mode, bible: null, scenePlan: null, analysis: {}, durationMs, error: err.message });
    }
  }

  // Summary
  const ok = results.filter(r => r.bible);
  if (ok.length > 0) {
    console.log("╔══════════════════════════════════════════════════════╗");
    console.log("║              BIBLE GENERATION SUMMARY               ║");
    console.log("╚══════════════════════════════════════════════════════╝\n");

    console.log("Seed             Chars  Female  NonFetWant  FetNarr  Locs  NFLocs  Beats  NFBeats  Scenes  NoDirec");
    console.log("───────────────  ─────  ──────  ──────────  ───────  ────  ──────  ─────  ───────  ──────  ───────");
    for (const r of ok) {
      const a = r.analysis;
      console.log(
        `${r.seedId.padEnd(15)}  ` +
        `${String(a.total_chars).padStart(5)}  ` +
        `${String(a.female_chars.length).padStart(6)}  ` +
        `${String(a.chars_with_non_fetish_want).padStart(10)}  ` +
        `${String(a.fetish_narrator_chars.length).padStart(7)}  ` +
        `${String(a.total_locations).padStart(4)}  ` +
        `${String(a.non_fetish_locations).padStart(6)}  ` +
        `${String(a.total_beats).padStart(5)}  ` +
        `${(a.non_fetish_beat_pct + "%").padStart(7)}  ` +
        `${String(a.total_scenes).padStart(6)}  ` +
        `${(a.scenes_without_directives_pct + "%").padStart(7)}`
      );
    }
  }

  // Save
  const outDir = resolve("data/postproduction/bible-tests");
  await mkdir(outDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outPath = resolve(outDir, `bible-test-${ts}.json`);
  await writeFile(outPath, JSON.stringify(results, null, 2));
  console.log(`\nResults saved: ${outPath}`);
}

main().catch(err => {
  console.error("Fatal:", err.message ?? err);
  process.exit(1);
});
