#!/usr/bin/env tsx
/**
 * AUTOMATED PIPELINE RUNNER + EVALUATOR
 * ══════════════════════════════════════
 * Runs the full story generation pipeline (or a subset) automatically,
 * using an LLM as a simulated user to make choices, then evaluates
 * each module's output quality.
 *
 * Usage:
 *   npx tsx scripts/pipeline-runner.ts                          # Full pipeline, random seed
 *   npx tsx scripts/pipeline-runner.ts --seed "A noir detective story set in 2040s Tokyo"
 *   npx tsx scripts/pipeline-runner.ts --through character      # Stop after character
 *   npx tsx scripts/pipeline-runner.ts --only hook              # Just hook module
 *   npx tsx scripts/pipeline-runner.ts --turns 3                # Max 3 clarifier turns per module
 *   npx tsx scripts/pipeline-runner.ts --skip-review            # Skip LLM evaluation
 *   npx tsx scripts/pipeline-runner.ts --skip-images            # Skip character image module
 *
 * Requires: backend running on localhost:3001 (or set BASE_URL env var)
 */

import "dotenv/config";

// ── Config ──

const BASE_URL = process.env.PIPELINE_BASE_URL ?? "http://localhost:3001";
const API = `${BASE_URL}/api`;
const MAX_TURNS_DEFAULT = 4;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SIM_MODEL = process.env.PIPELINE_SIM_MODEL ?? "claude-haiku-4-5-20251001";
const REVIEW_MODEL = process.env.PIPELINE_REVIEW_MODEL ?? "claude-sonnet-4-6";

// ── Types ──

interface ModuleResult {
  module: string;
  projectId: string;
  turns: number;
  clarifierTurns: TurnLog[];
  generateResult: any;
  lockResult: any;
  review?: ModuleReview;
  errors: string[];
  durationMs: number;
}

interface TurnLog {
  turnNumber: number;
  options: string[];
  assumptions: string[];
  simChoice: string;
  simReasoning: string;
}

interface ModuleReview {
  overallScore: number;  // 1-10
  strengths: string[];
  weaknesses: string[];
  culturalEngineVerdict: string;
  insightsAccumulatorVerdict: string;
  contemporaryResonanceVerdict: string;
  recommendations: string[];
}

interface PipelineReport {
  seed: string;
  startedAt: string;
  completedAt: string;
  modules: ModuleResult[];
  overallReview?: string;
  totalDurationMs: number;
}

// ── Arg parsing ──

function parseArgs(): {
  seed?: string;
  through?: string;
  only?: string;
  maxTurns: number;
  skipReview: boolean;
  skipImages: boolean;
} {
  const args = process.argv.slice(2);
  const result: any = { maxTurns: MAX_TURNS_DEFAULT, skipReview: false, skipImages: false };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--seed": result.seed = args[++i]; break;
      case "--through": result.through = args[++i]; break;
      case "--only": result.only = args[++i]; break;
      case "--turns": result.maxTurns = parseInt(args[++i], 10); break;
      case "--skip-review": result.skipReview = true; break;
      case "--skip-images": result.skipImages = true; break;
    }
  }
  return result;
}

// ── HTTP helpers ──

async function post(path: string, body: any): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(`POST ${path} failed (${res.status}): ${JSON.stringify(data)}`);
  }
  return data;
}

async function get(path: string): Promise<any> {
  const res = await fetch(`${API}${path}`);
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(`GET ${path} failed (${res.status}): ${JSON.stringify(data)}`);
  }
  return data;
}

// ── LLM helpers (direct Anthropic API for sim user + reviewer) ──

async function callLLM(
  system: string,
  user: string,
  model: string,
  maxTokens: number = 1000,
): Promise<string> {
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY required for pipeline runner");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  const data = await res.json() as any;
  if (data.error) throw new Error(`LLM call failed: ${JSON.stringify(data.error)}`);
  return data.content?.[0]?.text ?? "";
}

// ── Simulated User ──

const SIM_USER_SYSTEM = `You are a creative person using a visual novel story creation tool. You are testing the tool by making interesting, coherent creative choices.

Your job: given the clarifier's options and assumptions, pick a choice that leads to an interesting story. You can:
- Pick an option by ID (e.g., "A", "B", "C")
- Type free text if you want something not offered
- Respond to assumptions (keep, change, or defer)

RULES:
- Be a REAL creative person — have opinions, not just "whatever sounds good"
- Sometimes pick the surprising option, not the safe one
- Sometimes type free text to steer in an unexpected direction
- Keep assumptions sometimes, change them sometimes — be realistic
- Be concise — your choice should be 1-2 sentences max for free text

Respond in JSON:
{
  "choice_type": "option" | "free_text" | "surprise_me",
  "option_id": "A" | "B" | "C" | "D" | "E" | null,
  "free_text": "..." | null,
  "assumption_responses": [{ "assumptionId": "a1", "action": "keep" | "alternative" | "freeform", "newValue": "..." }] | [],
  "reasoning": "Why I made this choice (1 sentence)"
}`;

async function simulateUserChoice(
  clarifierResponse: any,
  storyContext: string,
  turnNumber: number,
): Promise<{ selection: any; assumptionResponses: any[]; reasoning: string }> {
  const options = (clarifierResponse.options ?? [])
    .map((o: any) => `${o.id}: ${o.label}`)
    .join("\n");

  const assumptions = (clarifierResponse.assumptions ?? [])
    .map((a: any) => `${a.id} [${a.category}]: "${a.assumption}" — alternatives: ${(a.alternatives ?? []).join(", ")}`)
    .join("\n");

  const prompt = `Story so far: ${storyContext}
Turn ${turnNumber}.

OPTIONS:
${options || "(none)"}

ASSUMPTIONS (respond to these if present):
${assumptions || "(none)"}

${clarifierResponse.hypothesis_line ? `Hypothesis: ${clarifierResponse.hypothesis_line}` : ""}
${clarifierResponse.missing_signal ? `Missing: ${clarifierResponse.missing_signal}` : ""}

Pick a choice. Respond in JSON only.`;

  const raw = await callLLM(SIM_USER_SYSTEM, prompt, SIM_MODEL, 500);

  try {
    // Extract JSON from response (may have markdown fences)
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");
    const parsed = JSON.parse(jsonMatch[0]);

    const selection: any = {};
    if (parsed.choice_type === "free_text" && parsed.free_text) {
      selection.type = "free_text";
      selection.label = parsed.free_text;
    } else if (parsed.choice_type === "surprise_me") {
      selection.type = "surprise_me";
      selection.label = "surprise me";
    } else {
      selection.type = "option";
      selection.optionId = parsed.option_id ?? "A";
      const matchingOption = (clarifierResponse.options ?? []).find((o: any) => o.id === selection.optionId);
      selection.label = matchingOption?.label ?? selection.optionId;
    }

    const assumptionResponses = (parsed.assumption_responses ?? []).map((ar: any) => ({
      assumptionId: ar.assumptionId,
      category: (clarifierResponse.assumptions ?? []).find((a: any) => a.id === ar.assumptionId)?.category ?? "",
      action: ar.action ?? "keep",
      originalValue: (clarifierResponse.assumptions ?? []).find((a: any) => a.id === ar.assumptionId)?.assumption ?? "",
      newValue: ar.newValue ?? ar.originalValue ?? "",
    }));

    return {
      selection,
      assumptionResponses,
      reasoning: parsed.reasoning ?? "(no reasoning)",
    };
  } catch (err) {
    // Fallback: pick first option
    const firstOption = (clarifierResponse.options ?? [])[0];
    return {
      selection: {
        type: firstOption ? "option" : "surprise_me",
        optionId: firstOption?.id ?? undefined,
        label: firstOption?.label ?? "surprise me",
      },
      assumptionResponses: [],
      reasoning: `(parse failed, defaulting to first option: ${err})`,
    };
  }
}

// ── Module Reviewer ──

async function reviewModule(
  moduleName: string,
  lockResult: any,
  generateResult: any,
  turnLogs: TurnLog[],
  seed: string,
): Promise<ModuleReview> {
  const prompt = `You are reviewing the output of the "${moduleName}" module in a visual novel story creation tool.

ORIGINAL SEED: ${seed}

LOCKED OUTPUT:
${JSON.stringify(lockResult, null, 2).slice(0, 6000)}

JUDGE SCORES (from generation):
${JSON.stringify(generateResult?.judge ?? {}, null, 2).slice(0, 2000)}

CLARIFIER TURNS (${turnLogs.length} total):
${turnLogs.map(t => `Turn ${t.turnNumber}: chose "${t.simChoice}" — ${t.simReasoning}`).join("\n")}

Evaluate this module's output on these dimensions:
1. OVERALL QUALITY (1-10): Is this a good foundation for a visual novel?
2. STRENGTHS: What works well? (2-3 bullet points)
3. WEAKNESSES: What's weak or generic? (2-3 bullet points)
4. CULTURAL ENGINE: Did the cultural intelligence engine contribute meaningfully? Look for evidence of cultural grounding, real-world texture, or specific cultural connections in the output. If no cultural engine data is visible, say so.
5. INSIGHTS ACCUMULATOR: Are there signs of accumulated creative insights being used? Cross-module continuity? If this is the first module, note that.
6. CONTEMPORARY RESONANCE: Does the output feel connected to current cultural conversations? Or does it feel timeless/generic?
7. RECOMMENDATIONS: What should be fixed or improved? (2-3 bullet points)

Respond in JSON:
{
  "overallScore": number,
  "strengths": ["..."],
  "weaknesses": ["..."],
  "culturalEngineVerdict": "...",
  "insightsAccumulatorVerdict": "...",
  "contemporaryResonanceVerdict": "...",
  "recommendations": ["..."]
}`;

  const raw = await callLLM(
    "You are a quality reviewer for a story creation engine. Be honest, specific, and constructive. Respond in JSON only.",
    prompt,
    REVIEW_MODEL,
    1500,
  );

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");
    return JSON.parse(jsonMatch[0]) as ModuleReview;
  } catch {
    return {
      overallScore: 0,
      strengths: ["(review parse failed)"],
      weaknesses: ["(review parse failed)"],
      culturalEngineVerdict: "(review parse failed)",
      insightsAccumulatorVerdict: "(review parse failed)",
      contemporaryResonanceVerdict: "(review parse failed)",
      recommendations: [`Raw review: ${raw.slice(0, 500)}`],
    };
  }
}

// ── Module Runners ──

async function runHookModule(
  projectId: string,
  seed: string,
  maxTurns: number,
  skipReview: boolean,
): Promise<ModuleResult> {
  const start = Date.now();
  const errors: string[] = [];
  const turnLogs: TurnLog[] = [];
  let storyContext = seed;

  log("hook", `Starting with seed: "${seed.slice(0, 80)}..."`);

  // First clarifier turn
  let clarifyResult = await post("/hook/clarify", { projectId, seedInput: seed });
  let turnNumber = 1;

  // Clarifier loop
  while (turnNumber < maxTurns) {
    const cr = clarifyResult.clarifier ?? clarifyResult;
    const readyForHook = cr.ready_for_hook ?? false;
    const readinessPct = cr.readiness_pct ?? 0;

    log("hook", `Turn ${turnNumber} — readiness: ${readinessPct}%, ready: ${readyForHook}`);

    if (readyForHook && turnNumber >= 2) {
      log("hook", "Clarifier says ready — moving to generate");
      break;
    }

    const sim = await simulateUserChoice(cr, storyContext, turnNumber);
    turnLogs.push({
      turnNumber,
      options: (cr.options ?? []).map((o: any) => `${o.id}: ${o.label}`),
      assumptions: (cr.assumptions ?? []).map((a: any) => `${a.id}: ${a.assumption}`),
      simChoice: sim.selection.label ?? sim.selection.optionId ?? "surprise_me",
      simReasoning: sim.reasoning,
    });

    log("hook", `  Sim chose: ${sim.selection.type} — "${(sim.selection.label ?? "").slice(0, 60)}"`);
    storyContext += ` → ${sim.selection.label ?? sim.selection.optionId}`;

    try {
      clarifyResult = await post("/hook/clarify", {
        projectId,
        userSelection: sim.selection,
        assumptionResponses: sim.assumptionResponses.length > 0 ? sim.assumptionResponses : undefined,
      });
      turnNumber++;
    } catch (err: any) {
      errors.push(`Clarify turn ${turnNumber + 1}: ${err.message}`);
      break;
    }
  }

  // Generate
  log("hook", "Running tournament...");
  let generateResult: any;
  try {
    generateResult = await post("/hook/generate", { projectId });
    log("hook", `Judge: ${generateResult.judge?.passed ? "PASS" : "FAIL"} — scores: ${JSON.stringify(generateResult.judge?.scores ?? {})}`);
  } catch (err: any) {
    errors.push(`Generate: ${err.message}`);
    return { module: "hook", projectId, turns: turnNumber, clarifierTurns: turnLogs, generateResult: null, lockResult: null, errors, durationMs: Date.now() - start };
  }

  // Lock
  log("hook", "Locking...");
  let lockResult: any;
  try {
    lockResult = await post("/hook/lock", { projectId });
    log("hook", `Locked: "${(lockResult.locked?.hook_sentence ?? "").slice(0, 80)}"`);
  } catch (err: any) {
    errors.push(`Lock: ${err.message}`);
    return { module: "hook", projectId, turns: turnNumber, clarifierTurns: turnLogs, generateResult, lockResult: null, errors, durationMs: Date.now() - start };
  }

  // Review
  let review: ModuleReview | undefined;
  if (!skipReview) {
    log("hook", "Running LLM review...");
    review = await reviewModule("hook", lockResult, generateResult, turnLogs, seed);
    log("hook", `Review: ${review.overallScore}/10`);
  }

  return { module: "hook", projectId, turns: turnNumber, clarifierTurns: turnLogs, generateResult, lockResult, review, errors, durationMs: Date.now() - start };
}

async function runClarifyGenerateLockModule(
  moduleName: string,
  apiPath: string,
  projectId: string,
  upstreamRefs: Record<string, string>,
  maxTurns: number,
  skipReview: boolean,
  seed: string,
  moduleSeedKey?: string,
): Promise<ModuleResult> {
  const start = Date.now();
  const errors: string[] = [];
  const turnLogs: TurnLog[] = [];
  let storyContext = seed;

  log(moduleName, "Starting...");

  // First clarifier turn (with upstream refs)
  const firstBody: any = { projectId, ...upstreamRefs };
  if (moduleSeedKey) firstBody[moduleSeedKey] = undefined; // Let it auto-generate

  let clarifyResult: any;
  try {
    clarifyResult = await post(`/${apiPath}/clarify`, firstBody);
  } catch (err: any) {
    errors.push(`First clarify: ${err.message}`);
    return { module: moduleName, projectId, turns: 0, clarifierTurns: [], generateResult: null, lockResult: null, errors, durationMs: Date.now() - start };
  }

  let turnNumber = 1;

  // Clarifier loop
  while (turnNumber < maxTurns) {
    const cr = clarifyResult.clarifier ?? clarifyResult;
    const readinessPct = cr.readiness_pct ?? 0;
    const readyFlag = cr.ready_for_build ?? cr.ready_for_hook ?? cr.ready_to_generate ?? false;

    log(moduleName, `Turn ${turnNumber} — readiness: ${readinessPct}%`);

    if (readyFlag && turnNumber >= 2) {
      log(moduleName, "Ready — moving to generate");
      break;
    }

    const sim = await simulateUserChoice(cr, storyContext, turnNumber);
    turnLogs.push({
      turnNumber,
      options: (cr.options ?? []).map((o: any) => `${o.id}: ${o.label}`),
      assumptions: (cr.assumptions ?? []).map((a: any) => `${a.id}: ${a.assumption}`),
      simChoice: sim.selection.label ?? sim.selection.optionId ?? "surprise_me",
      simReasoning: sim.reasoning,
    });

    log(moduleName, `  Sim chose: ${sim.selection.type} — "${(sim.selection.label ?? "").slice(0, 60)}"`);
    storyContext += ` → ${sim.selection.label ?? sim.selection.optionId}`;

    try {
      clarifyResult = await post(`/${apiPath}/clarify`, {
        projectId,
        userSelection: sim.selection,
        assumptionResponses: sim.assumptionResponses.length > 0 ? sim.assumptionResponses : undefined,
      });
      turnNumber++;
    } catch (err: any) {
      errors.push(`Clarify turn ${turnNumber + 1}: ${err.message}`);
      break;
    }
  }

  // Generate
  log(moduleName, "Running tournament...");
  let generateResult: any;
  try {
    generateResult = await post(`/${apiPath}/generate`, { projectId });
    const judge = generateResult.judge ?? {};
    log(moduleName, `Judge: ${judge.passed ? "PASS" : "FAIL"} — scores: ${JSON.stringify(judge.scores ?? {})}`);
  } catch (err: any) {
    errors.push(`Generate: ${err.message}`);
    return { module: moduleName, projectId, turns: turnNumber, clarifierTurns: turnLogs, generateResult: null, lockResult: null, errors, durationMs: Date.now() - start };
  }

  // Lock
  log(moduleName, "Locking...");
  let lockResult: any;
  try {
    lockResult = await post(`/${apiPath}/lock`, { projectId });
    log(moduleName, "Locked successfully");
  } catch (err: any) {
    errors.push(`Lock: ${err.message}`);
    return { module: moduleName, projectId, turns: turnNumber, clarifierTurns: turnLogs, generateResult, lockResult: null, errors, durationMs: Date.now() - start };
  }

  // Review
  let review: ModuleReview | undefined;
  if (!skipReview) {
    log(moduleName, "Running LLM review...");
    review = await reviewModule(moduleName, lockResult, generateResult, turnLogs, seed);
    log(moduleName, `Review: ${review.overallScore}/10`);
  }

  return { module: moduleName, projectId, turns: turnNumber, clarifierTurns: turnLogs, generateResult, lockResult, review, errors, durationMs: Date.now() - start };
}

// ── Scene module (different flow) ──

async function runSceneModule(
  projectId: string,
  plotProjectId: string,
  skipReview: boolean,
  seed: string,
): Promise<ModuleResult> {
  const start = Date.now();
  const errors: string[] = [];
  const turnLogs: TurnLog[] = [];

  log("scene", "Planning...");

  // Plan
  let planResult: any;
  try {
    planResult = await post("/scene/plan", { projectId, plotProjectId });
    log("scene", `Plan created: ${planResult.planner?.scenes?.length ?? "?"} scenes`);
  } catch (err: any) {
    errors.push(`Plan: ${err.message}`);
    return { module: "scene", projectId, turns: 0, clarifierTurns: [], generateResult: null, lockResult: null, errors, durationMs: Date.now() - start };
  }

  // Confirm plan (skip plan-clarify for automation)
  try {
    await post("/scene/confirm-plan", { projectId });
    log("scene", "Plan confirmed");
  } catch (err: any) {
    errors.push(`Confirm plan: ${err.message}`);
    return { module: "scene", projectId, turns: 0, clarifierTurns: [], generateResult: planResult, lockResult: null, errors, durationMs: Date.now() - start };
  }

  // Generate all scenes
  log("scene", "Building all scenes...");
  let generateResult: any;
  try {
    generateResult = await post("/scene/generate-all", { projectId });
    log("scene", `Built ${generateResult.builtScenes?.length ?? "?"} scenes`);
  } catch (err: any) {
    errors.push(`Generate-all: ${err.message}`);
    return { module: "scene", projectId, turns: 0, clarifierTurns: [], generateResult: planResult, lockResult: null, errors, durationMs: Date.now() - start };
  }

  // Final judge
  log("scene", "Running final judge...");
  let judgeResult: any;
  try {
    judgeResult = await post("/scene/final-judge", { projectId });
    log("scene", `Final judge: ${JSON.stringify(judgeResult.judge?.scores ?? {})}`);
  } catch (err: any) {
    errors.push(`Final judge: ${err.message} (non-fatal)`);
  }

  // Complete
  log("scene", "Completing...");
  let lockResult: any;
  try {
    lockResult = await post("/scene/complete", { projectId });
    log("scene", "Scene module complete");
  } catch (err: any) {
    errors.push(`Complete: ${err.message}`);
  }

  // Review
  let review: ModuleReview | undefined;
  if (!skipReview) {
    log("scene", "Running LLM review...");
    review = await reviewModule("scene", lockResult ?? generateResult, judgeResult ?? generateResult, turnLogs, seed);
    log("scene", `Review: ${review.overallScore}/10`);
  }

  return { module: "scene", projectId, turns: 0, clarifierTurns: turnLogs, generateResult, lockResult, review, errors, durationMs: Date.now() - start };
}

// ── Seed generation ──

const SAMPLE_SEEDS = [
  "A burned-out nurse discovers her hospital's AI triage system is quietly deprioritizing patients who can't pay, and the only person who can help her prove it is the engineer who built it — her estranged sister.",
  "Two rival food cart owners in a gentrifying neighborhood realize they're both being played by the same developer. Enemies-to-allies romance with actual stakes.",
  "A deepfake victim discovers the fake video of her was generated by someone she trusts. She has 48 hours before it goes viral. Thriller with a moral maze at its center.",
  "An aging yakuza accountant wants to retire but his boss's grandson — a crypto-obsessed Gen Z kid — needs him for one last job that's actually a money laundering scheme disguised as an NFT drop.",
  "A grief counselor who's secretly terrible at processing her own grief gets assigned to a support group for people who lost loved ones to a cult. One of the cult members is in the group.",
];

function randomSeed(): string {
  return SAMPLE_SEEDS[Math.floor(Math.random() * SAMPLE_SEEDS.length)];
}

// ── Logging ──

function log(module: string, msg: string) {
  const time = new Date().toISOString().slice(11, 19);
  console.log(`[${time}] [${module.toUpperCase().padEnd(10)}] ${msg}`);
}

// ── Report generation ──

function generateReport(report: PipelineReport): string {
  const lines: string[] = [
    "═══════════════════════════════════════════════════════",
    "  PIPELINE RUN REPORT",
    "═══════════════════════════════════════════════════════",
    "",
    `Seed: ${report.seed}`,
    `Started: ${report.startedAt}`,
    `Completed: ${report.completedAt}`,
    `Total duration: ${(report.totalDurationMs / 1000).toFixed(1)}s`,
    `Modules run: ${report.modules.length}`,
    "",
  ];

  for (const mod of report.modules) {
    lines.push(`─── ${mod.module.toUpperCase()} ───`);
    lines.push(`  Project ID: ${mod.projectId}`);
    lines.push(`  Clarifier turns: ${mod.turns}`);
    lines.push(`  Duration: ${(mod.durationMs / 1000).toFixed(1)}s`);
    lines.push(`  Errors: ${mod.errors.length === 0 ? "none" : mod.errors.join("; ")}`);

    if (mod.review) {
      lines.push(`  Score: ${mod.review.overallScore}/10`);
      lines.push(`  Strengths:`);
      for (const s of mod.review.strengths) lines.push(`    + ${s}`);
      lines.push(`  Weaknesses:`);
      for (const w of mod.review.weaknesses) lines.push(`    - ${w}`);
      lines.push(`  Cultural Engine: ${mod.review.culturalEngineVerdict}`);
      lines.push(`  Insights Accumulator: ${mod.review.insightsAccumulatorVerdict}`);
      lines.push(`  Contemporary Resonance: ${mod.review.contemporaryResonanceVerdict}`);
      lines.push(`  Recommendations:`);
      for (const r of mod.review.recommendations) lines.push(`    → ${r}`);
    }

    if (mod.clarifierTurns.length > 0) {
      lines.push(`  Turns:`);
      for (const t of mod.clarifierTurns) {
        lines.push(`    T${t.turnNumber}: ${t.simChoice.slice(0, 60)} — ${t.simReasoning.slice(0, 60)}`);
      }
    }
    lines.push("");
  }

  if (report.overallReview) {
    lines.push("═══ OVERALL ASSESSMENT ═══");
    lines.push(report.overallReview);
  }

  return lines.join("\n");
}

// ── Main ──

async function main() {
  const args = parseArgs();
  const seed = args.seed ?? randomSeed();

  const MODULE_ORDER = ["hook", "character", "character_image", "world", "plot", "scene"];

  // Determine which modules to run
  let modulesToRun: string[];
  if (args.only) {
    modulesToRun = [args.only];
  } else if (args.through) {
    const idx = MODULE_ORDER.indexOf(args.through);
    modulesToRun = idx >= 0 ? MODULE_ORDER.slice(0, idx + 1) : MODULE_ORDER;
  } else {
    modulesToRun = [...MODULE_ORDER];
  }

  if (args.skipImages) {
    modulesToRun = modulesToRun.filter(m => m !== "character_image");
  }

  console.log("\n" + "═".repeat(60));
  console.log("  PIPELINE RUNNER");
  console.log("═".repeat(60));
  console.log(`Seed: ${seed}`);
  console.log(`Modules: ${modulesToRun.join(" → ")}`);
  console.log(`Max turns per module: ${args.maxTurns}`);
  console.log(`Review: ${args.skipReview ? "SKIPPED" : "ON"}`);
  console.log("═".repeat(60) + "\n");

  // Check backend is running
  try {
    await fetch(`${BASE_URL}/api/hook/list-sessions`);
  } catch {
    console.error(`\n❌ Backend not reachable at ${BASE_URL}. Start it with: npm run dev:backend\n`);
    process.exit(1);
  }

  const report: PipelineReport = {
    seed,
    startedAt: new Date().toISOString(),
    completedAt: "",
    modules: [],
    totalDurationMs: 0,
  };

  const pipelineStart = Date.now();
  const ts = Date.now().toString(36);

  // Track project IDs across modules
  const projectIds: Record<string, string> = {
    hook: `pr_${ts}_hook`,
    character: `pr_${ts}_char`,
    character_image: `pr_${ts}_img`,
    world: `pr_${ts}_world`,
    plot: `pr_${ts}_plot`,
    scene: `pr_${ts}_scene`,
  };

  for (const moduleName of modulesToRun) {
    console.log(`\n${"▸".repeat(40)}`);
    console.log(`  MODULE: ${moduleName.toUpperCase()}`);
    console.log(`${"▸".repeat(40)}\n`);

    let result: ModuleResult;

    try {
      switch (moduleName) {
        case "hook":
          result = await runHookModule(projectIds.hook, seed, args.maxTurns, args.skipReview);
          break;

        case "character":
          result = await runClarifyGenerateLockModule(
            "character", "character", projectIds.character,
            { hookProjectId: projectIds.hook },
            args.maxTurns, args.skipReview, seed, "characterSeed",
          );
          break;

        case "character_image":
          result = await runClarifyGenerateLockModule(
            "character_image", "character-image", projectIds.character_image,
            { characterProjectId: projectIds.character },
            args.maxTurns, args.skipReview, seed, "visualSeed",
          );
          break;

        case "world":
          result = await runClarifyGenerateLockModule(
            "world", "world", projectIds.world,
            {
              hookProjectId: projectIds.hook,
              characterProjectId: projectIds.character,
              ...(modulesToRun.includes("character_image") ? { characterImageProjectId: projectIds.character_image } : {}),
            },
            args.maxTurns, args.skipReview, seed, "worldSeed",
          );
          break;

        case "plot":
          result = await runClarifyGenerateLockModule(
            "plot", "plot", projectIds.plot,
            {
              hookProjectId: projectIds.hook,
              characterProjectId: projectIds.character,
              worldProjectId: projectIds.world,
              ...(modulesToRun.includes("character_image") ? { characterImageProjectId: projectIds.character_image } : {}),
            },
            args.maxTurns, args.skipReview, seed, "plotSeed",
          );
          break;

        case "scene":
          result = await runSceneModule(
            projectIds.scene, projectIds.plot, args.skipReview, seed,
          );
          break;

        default:
          log(moduleName, `Unknown module — skipping`);
          continue;
      }
    } catch (err: any) {
      log(moduleName, `FATAL: ${err.message}`);
      result = {
        module: moduleName,
        projectId: projectIds[moduleName],
        turns: 0,
        clarifierTurns: [],
        generateResult: null,
        lockResult: null,
        errors: [`Fatal: ${err.message}`],
        durationMs: 0,
      };
    }

    report.modules.push(result);

    // If module failed fatally, stop the pipeline
    if (result.errors.some(e => e.startsWith("Fatal") || e.includes("Generate:") || e.includes("Lock:"))) {
      log("pipeline", `Module ${moduleName} failed — stopping pipeline`);
      break;
    }
  }

  report.completedAt = new Date().toISOString();
  report.totalDurationMs = Date.now() - pipelineStart;

  // Overall review
  if (!args.skipReview && report.modules.length > 1) {
    log("pipeline", "Running overall review...");
    const moduleScores = report.modules
      .filter(m => m.review)
      .map(m => `${m.module}: ${m.review!.overallScore}/10`);

    const overallPrompt = `Pipeline ran ${report.modules.length} modules. Scores: ${moduleScores.join(", ")}. Seed: "${seed}".

Key findings from module reviews:
${report.modules.filter(m => m.review).map(m => `${m.module}: strengths=${m.review!.strengths.join("; ")} weaknesses=${m.review!.weaknesses.join("; ")}`).join("\n")}

Write a 3-4 sentence overall assessment: Is the pipeline producing coherent, grounded, culturally-textured stories? What's the biggest systemic issue?`;

    try {
      report.overallReview = await callLLM(
        "You are reviewing a story generation pipeline's output. Be direct and specific.",
        overallPrompt,
        REVIEW_MODEL,
        500,
      );
    } catch {
      report.overallReview = "(overall review failed)";
    }
  }

  // Print report
  const reportText = generateReport(report);
  console.log("\n\n" + reportText);

  // Save report
  const reportPath = `./data/pipeline-reports/report_${ts}.txt`;
  const jsonPath = `./data/pipeline-reports/report_${ts}.json`;
  try {
    const { mkdir, writeFile } = await import("fs/promises");
    await mkdir("./data/pipeline-reports", { recursive: true });
    await writeFile(reportPath, reportText, "utf-8");
    await writeFile(jsonPath, JSON.stringify(report, null, 2), "utf-8");
    console.log(`\nReport saved to: ${reportPath}`);
    console.log(`JSON data saved to: ${jsonPath}`);
  } catch (err) {
    console.error("Failed to save report:", err);
  }
}

main().catch(err => {
  console.error("Pipeline runner failed:", err);
  process.exit(1);
});
