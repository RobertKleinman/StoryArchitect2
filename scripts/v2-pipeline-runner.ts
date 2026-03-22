#!/usr/bin/env tsx
/**
 * V2 PIPELINE RUNNER + BASELINE COMPARISON
 * ═════════════════════════════════════════
 * Tests the v2 pipeline end-to-end AND compares it against a single
 * Claude conversation producing the same deliverables.
 *
 * Usage:
 *   npx tsx scripts/v2-pipeline-runner.ts                                # Full run with comparison
 *   npx tsx scripts/v2-pipeline-runner.ts --seed "A cyberpunk heist..."  # Custom seed
 *   npx tsx scripts/v2-pipeline-runner.ts --no-baseline                  # Skip baseline comparison
 *   npx tsx scripts/v2-pipeline-runner.ts --no-judge                     # Skip judging
 *
 * Requires: backend running on localhost:3001 (or set PIPELINE_BASE_URL)
 */

import "dotenv/config";
import { mkdir, writeFile } from "fs/promises";

// ── Config ───────────────────────────────────────────────────────────

const BASE_URL = process.env.PIPELINE_BASE_URL ?? "http://localhost:3001";
const V2_API = `${BASE_URL}/api/v2/project`;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) { console.error("ANTHROPIC_API_KEY required"); process.exit(1); }

const SIM_MODEL = "claude-haiku-4-5-20251001";
const BASELINE_MODEL = "claude-sonnet-4-6";
const JUDGE_MODEL = "claude-sonnet-4-6";

const SEEDS = [
  "A burned-out paramedic in rural Japan discovers she can hear the last thoughts of the dying — but the voices don't stop when she clocks out",
  "Two rival street food vendors in Lagos discover their late grandmothers were best friends who made a pact that could change both their futures",
  "A Soviet-era cosmonaut wakes up on the ISS in 2026 with no memory of the last 40 years, and nobody on Earth can explain how he got there",
];

// ── CLI Args ─────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const customSeed = args.includes("--seed") ? args[args.indexOf("--seed") + 1] : null;
const skipBaseline = args.includes("--no-baseline");
const skipJudge = args.includes("--no-judge");
const seed = customSeed ?? SEEDS[Math.floor(Math.random() * SEEDS.length)];

// ── Helpers ──────────────────────────────────────────────────────────

function log(section: string, msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] [${section}] ${msg}`);
}

async function callLLM(
  system: string, user: string, model: string, maxTokens = 4000,
): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
  });
  const data = await res.json() as any;
  if (data.error) throw new Error(`LLM: ${JSON.stringify(data.error)}`);
  return data.content?.[0]?.text ?? "";
}

async function api(method: string, path: string, body?: any): Promise<any> {
  const url = `${V2_API}${path}`;
  const opts: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text, _status: res.status };
  }
}

async function poll(path: string, statusField: string, projectId: string, timeoutMs = 600_000): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    // Check the specific endpoint first
    const result = await api("GET", path);
    if (result[statusField] === "complete") return result;
    if (result[statusField] === "failed") throw new Error(`Failed: ${result.error}`);

    // Also check project state directly (handles race conditions)
    const project = await api("GET", `/${projectId}`);
    const step = project?.project?.step;
    if (step === "failed") throw new Error(`Failed: ${project.project.error}`);

    const elapsed = ((Date.now() - start) / 1000).toFixed(0);
    const subSteps = project?.project?.checkpoint?.completedSubSteps;
    if (subSteps) {
      log("poll", `${elapsed}s — sub-steps: ${subSteps.join(", ") || "starting..."}`);
    }

    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error(`Timeout polling ${path} after ${timeoutMs}ms`);
}

// ── V2 Pipeline Run ──────────────────────────────────────────────────

async function runV2Pipeline(seed: string): Promise<{ output: string; durationMs: number; calls: number }> {
  const start = Date.now();
  log("v2", `Seed: "${seed.slice(0, 60)}..."`);

  // Step 1: Create project + intake
  log("v2", "Step 1: Creating project...");
  const { projectId } = await api("POST", "", { seedInput: seed });
  log("v2", `  Project: ${projectId}`);

  // Run intake turn
  const intakeResult = await api("POST", `/${projectId}/intake`, { seedInput: seed });
  log("v2", `  Intake: ready=${intakeResult.readyForPremise}, turn=${intakeResult.turnNumber}`);

  // If not ready, do one more turn with sim user
  if (!intakeResult.readyForPremise && intakeResult.question) {
    const simResponse = await simulateIntake(intakeResult, seed);
    const intake2 = await api("POST", `/${projectId}/intake`, {
      userResponse: simResponse,
      assumptionResponses: [],
    });
    log("v2", `  Intake turn 2: ready=${intake2.readyForPremise}`);
  }

  // Step 2: Generate premise
  log("v2", "Step 2: Generating premise...");
  await api("POST", `/${projectId}/generate-premise`);
  const premiseResult = await poll(`/${projectId}/premise`, "status", projectId);
  log("v2", `  Premise: "${premiseResult.premise?.hook_sentence?.slice(0, 60)}..."`);

  // Step 3: Auto-approve premise
  log("v2", "Step 3: Approving premise...");
  await api("POST", `/${projectId}/review-premise`, { action: "approve" });

  // Step 4: Generate bible
  log("v2", "Step 4: Generating bible...");
  await api("POST", `/${projectId}/generate-bible`);
  const bibleResult = await poll(`/${projectId}/bible`, "status", projectId);
  const charCount = Object.keys(bibleResult.storyBible?.characters ?? {}).length;
  const sceneCount = bibleResult.scenePlan?.scenes?.length ?? 0;
  log("v2", `  Bible: ${charCount} characters, ${sceneCount} scenes planned`);

  // Step 5: Auto-approve scene plan
  log("v2", "Step 5: Approving scene plan...");
  await api("POST", `/${projectId}/review-scenes`, { action: "approve" });

  // Step 6: Generate scenes
  log("v2", "Step 6: Generating scenes...");
  await api("POST", `/${projectId}/generate-scenes`);
  const scenesResult = await poll(`/${projectId}/scenes`, "status", projectId);
  log("v2", `  Generated ${scenesResult.scenes?.length ?? 0} scenes`);

  // Get full export
  const fullExport = await api("GET", `/${projectId}/export`);
  const traceCount = fullExport.traces?.length ?? 0;
  const durationMs = Date.now() - start;

  // Build readable output for judging
  const output = formatV2Output(fullExport);

  log("v2", `Done in ${(durationMs / 1000).toFixed(1)}s, ${traceCount} LLM calls`);
  return { output, durationMs, calls: traceCount };
}

function formatV2Output(project: any): string {
  const parts: string[] = [];

  if (project.premise) {
    parts.push("=== PREMISE ===");
    parts.push(`Hook: ${project.premise.hook_sentence}`);
    parts.push(`Promise: ${project.premise.emotional_promise}`);
    parts.push(`Premise: ${project.premise.premise_paragraph}`);
    parts.push(`Synopsis: ${project.premise.synopsis}`);
    parts.push(`Tone: ${project.premise.tone_chips?.join(", ")}`);
    parts.push(`Setting: ${project.premise.setting_anchor}`);
    parts.push(`Core conflict: ${project.premise.core_conflict}`);
    parts.push(`Characters: ${project.premise.characters_sketch?.map((c: any) => `${c.name} (${c.role})`).join(", ")}`);
  }

  if (project.storyBible) {
    parts.push("\n=== WORLD ===");
    parts.push(`Thesis: ${project.storyBible.world?.world_thesis}`);
    parts.push(`Locations: ${project.storyBible.world?.arena?.locations?.map((l: any) => l.name).join(", ")}`);

    parts.push("\n=== CHARACTERS ===");
    for (const [name, char] of Object.entries(project.storyBible.characters ?? {})) {
      const c = char as any;
      parts.push(`\n${name} (${c.role}): ${c.description}`);
      parts.push(`  Want: ${c.psychological_profile?.want}`);
      parts.push(`  Misbelief: ${c.psychological_profile?.misbelief}`);
      parts.push(`  Voice: ${c.psychological_profile?.voice_pattern}`);
    }

    parts.push("\n=== PLOT ===");
    parts.push(`Conflict: ${project.storyBible.plot?.core_conflict}`);
    for (const beat of (project.storyBible.plot?.tension_chain ?? [])) {
      parts.push(`  ${beat.id}: ${beat.beat}`);
    }
  }

  if (project.scenes) {
    parts.push("\n=== SCENES ===");
    for (const scene of project.scenes) {
      parts.push(`\n--- ${scene.readable?.title ?? scene.scene_id} ---`);
      parts.push(scene.readable?.screenplay_text ?? "(no text)");
    }
  }

  return parts.join("\n");
}

// ── Baseline: Single Claude Conversation ─────────────────────────────

async function runBaseline(seed: string): Promise<{ output: string; durationMs: number }> {
  const start = Date.now();
  log("baseline", `Running single-conversation baseline...`);

  const system = `You are a visual novel story creator. Given a story concept, produce a complete visual novel package in one response:

1. PREMISE: Hook sentence, emotional promise, 2-3 sentence premise, 3-5 sentence synopsis
2. WORLD: Setting description, key locations, world rules, factions
3. CHARACTERS: 3-5 characters with names, roles, descriptions, psychological profiles (want, misbelief, voice pattern), and relationships
4. PLOT: Core conflict, 12-20 tension beats (each causally linked to the next), turning points, climax, resolution
5. SCENES: 6-10 complete scenes written in visual novel format:
   - Each scene has a title, setting, characters present
   - Written as dialogue lines with speaker names, emotions, and stage directions
   - Format: SPEAKER [emotion] (delivery): "dialogue"
   - Include NARRATION lines and INTERNAL thought lines
   - Each scene should advance the plot and end with a hook

Be specific, not generic. Characters should have distinctive voices. The plot should have genuine tension.
Make it as good as you possibly can — this is a head-to-head comparison.`;

  const output = await callLLM(system, `Create a complete visual novel from this concept:\n\n"${seed}"`, BASELINE_MODEL, 16000);
  const durationMs = Date.now() - start;

  log("baseline", `Done in ${(durationMs / 1000).toFixed(1)}s`);
  return { output, durationMs };
}

// ── Sim User for Intake ──────────────────────────────────────────────

async function simulateIntake(intakeResult: any, seed: string): Promise<string> {
  const prompt = `You're testing a story creation tool. It asked you this question about your story idea:

Your idea: "${seed}"
Question: ${intakeResult.question}
${intakeResult.assumptions?.length ? `\nAssumptions it made:\n${intakeResult.assumptions.map((a: any) => `- ${a.category}: ${a.assumption}`).join("\n")}` : ""}

Give a brief, opinionated answer (1-2 sentences). Be a real creative person with preferences.`;

  return await callLLM("You are a creative person testing a tool. Be concise.", prompt, SIM_MODEL, 200);
}

// ── Blind Comparative Judge ──────────────────────────────────────────

interface JudgeResult {
  dimensions: Array<{ name: string; winner: "A" | "B" | "TIE"; reasoning: string }>;
  overallWinner: "A" | "B" | "TIE";
  summary: string;
}

async function blindJudge(outputA: string, outputB: string, positionAIsApp: boolean): Promise<JudgeResult> {
  log("judge", "Running blind comparative judge...");

  const system = `You are an expert judge evaluating two visual novel story packages. You will see Output A and Output B. One was created by a multi-stage AI pipeline, the other by a single AI conversation. You don't know which is which.

Evaluate on these dimensions, picking a winner for each:

1. **Coherence**: Internal consistency — do characters, world, and plot fit together?
2. **Character Depth**: Are characters psychologically rich with distinct voices?
3. **World Specificity**: Is the setting vivid and specific, not generic?
4. **Plot Structure**: Is there genuine tension with causal beat-to-beat progression?
5. **Scene Quality**: Are scenes dramatic with good dialogue and pacing?
6. **Creative Originality**: Does it feel fresh or formulaic?
7. **Cross-Element Consistency**: Do scenes use the actual characters/world/plot, or drift?

For each dimension, pick "A", "B", or "TIE".
Then pick an overall winner.

Respond in JSON:
{
  "dimensions": [{ "name": "...", "winner": "A"|"B"|"TIE", "reasoning": "..." }],
  "overallWinner": "A"|"B"|"TIE",
  "summary": "1-2 sentence overall assessment"
}`;

  const user = `=== OUTPUT A ===
${outputA.slice(0, 12000)}

=== OUTPUT B ===
${outputB.slice(0, 12000)}

Judge these two outputs. Respond in JSON only.`;

  const raw = await callLLM(system, user, JUDGE_MODEL, 3000);
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Judge did not return JSON");

  const result = JSON.parse(jsonMatch[0]) as JudgeResult;

  // Unblind: map A/B back to app/baseline
  const appLabel = positionAIsApp ? "A" : "B";
  const baseLabel = positionAIsApp ? "B" : "A";

  log("judge", `Position A = ${positionAIsApp ? "APP" : "BASELINE"}`);
  log("judge", `Overall winner: ${result.overallWinner} (${result.overallWinner === appLabel ? "APP" : result.overallWinner === baseLabel ? "BASELINE" : "TIE"})`);

  for (const dim of result.dimensions) {
    const who = dim.winner === appLabel ? "APP" : dim.winner === baseLabel ? "BASELINE" : "TIE";
    log("judge", `  ${dim.name}: ${who} — ${dim.reasoning}`);
  }

  log("judge", `Summary: ${result.summary}`);
  return result;
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log("╔═══════════════════════════════════════════════════╗");
  console.log("║  V2 Pipeline Runner + Baseline Comparison        ║");
  console.log("╚═══════════════════════════════════════════════════╝");
  console.log();
  log("main", `Seed: "${seed}"`);
  log("main", `Baseline: ${skipBaseline ? "SKIP" : "ON"}, Judge: ${skipJudge ? "SKIP" : "ON"}`);
  console.log();

  // Run v2 pipeline
  let v2Result: { output: string; durationMs: number; calls: number };
  try {
    v2Result = await runV2Pipeline(seed);
  } catch (err: any) {
    log("v2", `FAILED: ${err.message}`);
    console.error(err);
    process.exit(1);
  }

  // Run baseline (if enabled)
  let baselineResult: { output: string; durationMs: number } | null = null;
  if (!skipBaseline) {
    try {
      baselineResult = await runBaseline(seed);
    } catch (err: any) {
      log("baseline", `FAILED: ${err.message}`);
    }
  }

  // Save outputs
  const outDir = `./data/v2-runs/${new Date().toISOString().replace(/[:.]/g, "-")}`;
  await mkdir(outDir, { recursive: true });
  await writeFile(`${outDir}/seed.txt`, seed);
  await writeFile(`${outDir}/v2-output.txt`, v2Result.output);
  if (baselineResult) {
    await writeFile(`${outDir}/baseline-output.txt`, baselineResult.output);
  }

  // Judge (if both outputs available and judging enabled)
  if (baselineResult && !skipJudge) {
    // Randomize position to prevent bias
    const appIsA = Math.random() > 0.5;
    const outputA = appIsA ? v2Result.output : baselineResult.output;
    const outputB = appIsA ? baselineResult.output : v2Result.output;

    try {
      const judgeResult = await blindJudge(outputA, outputB, appIsA);
      await writeFile(`${outDir}/judge-result.json`, JSON.stringify({
        seed,
        appPosition: appIsA ? "A" : "B",
        ...judgeResult,
        stats: {
          v2: { durationMs: v2Result.durationMs, calls: v2Result.calls },
          baseline: { durationMs: baselineResult.durationMs },
        },
      }, null, 2));
    } catch (err: any) {
      log("judge", `FAILED: ${err.message}`);
    }
  }

  // Summary
  console.log();
  console.log("╔═══════════════════════════════════════════════════╗");
  console.log("║  Results                                         ║");
  console.log("╠═══════════════════════════════════════════════════╣");
  console.log(`║  V2 Pipeline: ${(v2Result.durationMs / 1000).toFixed(1)}s, ${v2Result.calls} LLM calls`);
  console.log(`║  V2 Output:   ${v2Result.output.length} chars`);
  if (baselineResult) {
    console.log(`║  Baseline:    ${(baselineResult.durationMs / 1000).toFixed(1)}s, 1 LLM call`);
    console.log(`║  Base Output: ${baselineResult.output.length} chars`);
  }
  console.log(`║  Saved to:    ${outDir}`);
  console.log("╚═══════════════════════════════════════════════════╝");
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
