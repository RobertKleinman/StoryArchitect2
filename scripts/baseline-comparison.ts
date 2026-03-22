#!/usr/bin/env tsx
/**
 * HEAD-TO-HEAD BASELINE COMPARISON
 * ═════════════════════════════════
 * Compares Story Architect pipeline output against raw Claude conversations
 * to determine whether the app adds measurable creative value.
 *
 * Usage:
 *   npx tsx scripts/baseline-comparison.ts                         # Full run (5 seeds × 3 reps)
 *   npx tsx scripts/baseline-comparison.ts --quick                 # Dev mode (1 seed × 1 rep)
 *   npx tsx scripts/baseline-comparison.ts --seeds 3 --reps 2     # Custom sample size
 *   npx tsx scripts/baseline-comparison.ts --baseline naive        # Only naive baseline
 *   npx tsx scripts/baseline-comparison.ts --baseline chained      # Only chained baseline
 *   npx tsx scripts/baseline-comparison.ts --unconstrained         # Skip budget-matched mode
 *
 * Requires: backend running on localhost:3001 (or set PIPELINE_BASE_URL)
 *
 * PRE-REGISTERED DECISION RULE:
 *   PRIMARY endpoint = budget-matched + normalized judging
 *   App wins if ≥60% of head-to-head comparisons. 50-60% = inconclusive. <50% = net negative.
 */

import "dotenv/config";
import { createHash } from "crypto";
import { mkdir, writeFile } from "fs/promises";

// ── Config ───────────────────────────────────────────────────────────

const BASE_URL = process.env.PIPELINE_BASE_URL ?? "http://localhost:3001";
const API = `${BASE_URL}/api`;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) { console.error("ANTHROPIC_API_KEY required"); process.exit(1); }

const BASELINE_MODEL  = "claude-sonnet-4-6";     // same as app's STRONG tier
const SIM_MODEL       = "claude-haiku-4-5-20251001";
const JUDGE_MODEL     = "claude-sonnet-4-6";
const NORMALIZER_MODEL = "claude-haiku-4-5-20251001";
const MAX_TURNS       = 4;  // per module-equivalent stage

// ── Prompt Version Hashing ───────────────────────────────────────────

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

// ── Types ────────────────────────────────────────────────────────────

interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

interface ArmResult {
  arm: "app" | "naive_baseline" | "chained_baseline";
  rawOutput: string;       // raw text or JSON string of locked packs
  normalizedOutput: string; // plain-text narrative after normalization
  tokensUsed: TokenUsage;
  durationMs: number;
  turnCount: number;
  errors: string[];
}

interface JudgingResult {
  positionA: "app" | "baseline";
  dimensions: Array<{
    name: string;
    score_a: number;
    score_b: number;
    winner: "A" | "B" | "TIE";
  }>;
  overallWinner: "A" | "B" | "TIE";
  reasoning: string;
}

interface Comparison {
  seed: string;
  rep: number;
  baselineType: "naive" | "chained";
  budgetMode: "matched" | "unconstrained";
  appResult: ArmResult;
  baselineResult: ArmResult;
  judgingNormalized: { run1: JudgingResult; run2: JudgingResult; finalVerdict: "app" | "baseline" | "tie" };
  judgingRaw: { run1: JudgingResult; run2: JudgingResult; finalVerdict: "app" | "baseline" | "tie" };
}

interface WinRateSummary {
  appWins: number;
  baselineWins: number;
  ties: number;
  total: number;
  winRate: number;
  ci95: [number, number];
  perDimension: Record<string, { appWins: number; baselineWins: number; ties: number }>;
}

interface RunRecord {
  runId: string;
  startedAt: string;
  completedAt: string;
  configSnapshot: Record<string, string>;
  promptHashes: Record<string, string>;
  seeds: string[];
  repsPerSeed: number;
  comparisons: Comparison[];
  summary: {
    naive_matched?: WinRateSummary;
    naive_unconstrained?: WinRateSummary;
    chained_matched?: WinRateSummary;
    chained_unconstrained?: WinRateSummary;
    primary?: WinRateSummary;
    decisionRule: "app_wins" | "inconclusive" | "net_negative" | "no_data";
  };
}

// ── CLI Args ─────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const result: {
    quick: boolean; seeds: number; reps: number;
    baseline: "both" | "naive" | "chained";
    unconstrained: boolean;
  } = { quick: false, seeds: 5, reps: 3, baseline: "both", unconstrained: false };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--quick": result.quick = true; result.seeds = 1; result.reps = 1; break;
      case "--seeds": result.seeds = parseInt(args[++i], 10); break;
      case "--reps": result.reps = parseInt(args[++i], 10); break;
      case "--baseline": result.baseline = args[++i] as any; break;
      case "--unconstrained": result.unconstrained = true; break;
    }
  }
  return result;
}

// ── Seeds ────────────────────────────────────────────────────────────

const SEEDS = [
  "A burned-out nurse discovers her hospital's AI triage system is quietly deprioritizing patients who can't pay, and the only person who can help her prove it is the engineer who built it — her estranged sister.",
  "Two rival food cart owners in a gentrifying neighborhood realize they're both being played by the same developer. Enemies-to-allies romance with actual stakes.",
  "A deepfake victim discovers the fake video of her was generated by someone she trusts. She has 48 hours before it goes viral. Thriller with a moral maze at its center.",
  "An aging yakuza accountant wants to retire but his boss's grandson — a crypto-obsessed Gen Z kid — needs him for one last job that's actually a money laundering scheme disguised as an NFT drop.",
  "A grief counselor who's secretly terrible at processing her own grief gets assigned to a support group for people who lost loved ones to a cult. One of the cult members is in the group.",
];

// ── HTTP Helpers ─────────────────────────────────────────────────────

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

async function put(path: string, body: any): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(`PUT ${path} failed (${res.status}): ${JSON.stringify(data)}`);
  }
  return data;
}

// ── LLM Helpers (direct Anthropic API) ───────────────────────────────

interface LLMResponse {
  text: string;
  usage: { input: number; output: number };
}

async function callLLM(
  system: string,
  user: string,
  model: string,
  maxTokens: number = 1000,
): Promise<LLMResponse> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY!,
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
  return {
    text: data.content?.[0]?.text ?? "",
    usage: { input: data.usage?.input_tokens ?? 0, output: data.usage?.output_tokens ?? 0 },
  };
}

/** Multi-turn conversation call */
async function callLLMConversation(
  system: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  model: string,
  maxTokens: number = 2000,
): Promise<LLMResponse> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages }),
  });

  const data = await res.json() as any;
  if (data.error) throw new Error(`LLM conversation failed: ${JSON.stringify(data.error)}`);
  return {
    text: data.content?.[0]?.text ?? "",
    usage: { input: data.usage?.input_tokens ?? 0, output: data.usage?.output_tokens ?? 0 },
  };
}

// ── Budget Tracker ───────────────────────────────────────────────────

class BudgetTracker {
  input = 0;
  output = 0;

  record(usage: { input: number; output: number }) {
    this.input += usage.input;
    this.output += usage.output;
  }

  get total(): number { return this.input + this.output; }

  snapshot(): TokenUsage {
    return { input: this.input, output: this.output, total: this.total };
  }
}

// ── App Sim User (structured option picker) ──────────────────────────

const APP_SIM_USER_SYSTEM = `You are a creative person using a visual novel story creation tool. You are testing the tool by making interesting, coherent creative choices.

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

// ── Baseline Sim User (open-ended creative collaborator) ─────────────

const BASELINE_SIM_USER_SYSTEM = `You are a creative person developing a visual novel story with an AI assistant. You have a clear seed idea and specific creative preferences.

Your job: drive the creative conversation by giving specific direction, answering questions thoughtfully, and building on the assistant's ideas. You are NOT picking from a menu — you are an active creative partner.

RULES:
- Give specific, opinionated feedback on what the assistant proposes
- Add your own ideas — don't just react, contribute new elements
- Push back when something feels generic or cliché
- Ask for alternatives when you're not satisfied
- Be specific about tone, character motivations, and thematic concerns
- Reference the seed idea and keep the conversation coherent
- Keep responses concise but substantive (2-4 sentences)

Respond in JSON:
{
  "message": "Your response to the assistant (what you'd actually type in a chat)",
  "reasoning": "Why you said this (1 sentence, for logging only)"
}`;

// ── App Sim User Choice Parser ───────────────────────────────────────

async function simulateAppUserChoice(
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

  const prompt = `Story so far: ${storyContext}\nTurn ${turnNumber}.\n\nOPTIONS:\n${options || "(none)"}\n\nASSUMPTIONS:\n${assumptions || "(none)"}\n\nPick a choice. Respond in JSON only.`;

  const resp = await callLLM(APP_SIM_USER_SYSTEM, prompt, SIM_MODEL, 500);

  try {
    const jsonMatch = resp.text.match(/\{[\s\S]*\}/);
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
      const match = (clarifierResponse.options ?? []).find((o: any) => o.id === selection.optionId);
      selection.label = match?.label ?? selection.optionId;
    }

    const assumptionResponses = (parsed.assumption_responses ?? []).map((ar: any) => ({
      assumptionId: ar.assumptionId,
      category: (clarifierResponse.assumptions ?? []).find((a: any) => a.id === ar.assumptionId)?.category ?? "",
      action: ar.action ?? "keep",
      originalValue: (clarifierResponse.assumptions ?? []).find((a: any) => a.id === ar.assumptionId)?.assumption ?? "",
      newValue: ar.newValue ?? "",
    }));

    return { selection, assumptionResponses, reasoning: parsed.reasoning ?? "(no reasoning)" };
  } catch {
    const firstOption = (clarifierResponse.options ?? [])[0];
    return {
      selection: { type: firstOption ? "option" : "surprise_me", optionId: firstOption?.id, label: firstOption?.label ?? "surprise me" },
      assumptionResponses: [],
      reasoning: "(parse failed, defaulting)",
    };
  }
}

// ── Baseline Sim User ────────────────────────────────────────────────

async function simulateBaselineUser(
  assistantMessage: string,
  storyContext: string,
  turnNumber: number,
): Promise<{ message: string; reasoning: string }> {
  const prompt = `Original seed: ${storyContext}\n\nTurn ${turnNumber}. The AI assistant just said:\n\n"${assistantMessage.slice(0, 3000)}"\n\nRespond as the creative collaborator. JSON only.`;

  const resp = await callLLM(BASELINE_SIM_USER_SYSTEM, prompt, SIM_MODEL, 500);

  try {
    const jsonMatch = resp.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON");
    const parsed = JSON.parse(jsonMatch[0]);
    return { message: parsed.message ?? resp.text, reasoning: parsed.reasoning ?? "" };
  } catch {
    return { message: "That sounds interesting. Can you develop the characters more? I want specific psychological depth, not generic archetypes.", reasoning: "(parse failed, using default)" };
  }
}

// ══════════════════════════════════════════════════════════════════════
// APP ARM — runs the pipeline via backend API
// ══════════════════════════════════════════════════════════════════════

const MODULE_ORDER = ["hook", "character", "world", "plot", "scene"];
const MODULE_API_PATHS: Record<string, string> = {
  hook: "hook", character: "character", world: "world", plot: "plot", scene: "scene",
};

async function runAppArm(seed: string): Promise<ArmResult> {
  const start = Date.now();
  const errors: string[] = [];
  const ts = Date.now().toString(36);
  const projectIds: Record<string, string> = {
    hook: `bcomp_${ts}_hook`, character: `bcomp_${ts}_char`,
    world: `bcomp_${ts}_world`, plot: `bcomp_${ts}_plot`, scene: `bcomp_${ts}_scene`,
  };

  // Get token baseline from backend
  let tokensBefore: any;
  try { tokensBefore = await get("/debug/tokens"); } catch { tokensBefore = { input: 0, output: 0 }; }

  const allLocked: Record<string, any> = {};
  let totalTurns = 0;

  for (const mod of MODULE_ORDER) {
    log("app", `Running ${mod}...`);
    try {
      if (mod === "scene") {
        // Scene has a different flow
        await post("/scene/plan", { projectId: projectIds.scene, plotProjectId: projectIds.plot });
        await post("/scene/confirm-plan", { projectId: projectIds.scene });
        const genResult = await post("/scene/generate-all", { projectId: projectIds.scene });
        try { await post("/scene/final-judge", { projectId: projectIds.scene }); } catch { /* non-fatal */ }
        const lockResult = await post("/scene/complete", { projectId: projectIds.scene });
        allLocked.scene = lockResult ?? genResult;
      } else {
        // Standard clarify → generate → lock flow
        const upstreamRefs: Record<string, string> = {};
        if (mod !== "hook") upstreamRefs.hookProjectId = projectIds.hook;
        if (["world", "plot"].includes(mod)) upstreamRefs.characterProjectId = projectIds.character;
        if (mod === "plot") upstreamRefs.worldProjectId = projectIds.world;

        const firstBody: any = { projectId: projectIds[mod], ...upstreamRefs };
        if (mod === "hook") firstBody.seedInput = seed;

        let clarifyResult = await post(`/${MODULE_API_PATHS[mod]}/clarify`, firstBody);
        let turnNumber = 1;
        let storyContext = seed;

        while (turnNumber < MAX_TURNS) {
          const cr = clarifyResult.clarifier ?? clarifyResult;
          const readyFlag = cr.ready_for_build ?? cr.ready_for_hook ?? cr.ready_to_generate ?? false;

          if (readyFlag && turnNumber >= 2) {
            log("app", `  ${mod} ready at turn ${turnNumber}`);
            break;
          }

          const sim = await simulateAppUserChoice(cr, storyContext, turnNumber);
          storyContext += ` → ${sim.selection.label ?? sim.selection.optionId}`;

          clarifyResult = await post(`/${MODULE_API_PATHS[mod]}/clarify`, {
            projectId: projectIds[mod],
            ...upstreamRefs,
            userSelection: sim.selection,
            assumptionResponses: sim.assumptionResponses.length > 0 ? sim.assumptionResponses : undefined,
          });
          turnNumber++;
        }
        totalTurns += turnNumber;

        const genResult = await post(`/${MODULE_API_PATHS[mod]}/generate`, { projectId: projectIds[mod] });
        const lockResult = await post(`/${MODULE_API_PATHS[mod]}/lock`, { projectId: projectIds[mod] });
        allLocked[mod] = lockResult;
        log("app", `  ${mod} locked (judge: ${genResult.judge?.passed ? "PASS" : "FAIL"})`);
      }
    } catch (err: any) {
      errors.push(`${mod}: ${err.message}`);
      log("app", `  ${mod} FAILED: ${err.message.slice(0, 100)}`);
      break; // stop pipeline on failure
    }
  }

  // Get token delta from backend
  let tokensAfter: any;
  try { tokensAfter = await get("/debug/tokens"); } catch { tokensAfter = tokensBefore; }
  const inputTokens = (tokensAfter.input ?? 0) - (tokensBefore.input ?? 0);
  const outputTokens = (tokensAfter.output ?? 0) - (tokensBefore.output ?? 0);

  // Build raw output as readable text from locked packs
  const rawOutput = Object.entries(allLocked)
    .map(([mod, data]) => `=== ${mod.toUpperCase()} ===\n${JSON.stringify(data, null, 2).slice(0, 8000)}`)
    .join("\n\n");

  return {
    arm: "app",
    rawOutput,
    normalizedOutput: "", // filled later
    tokensUsed: { input: inputTokens, output: outputTokens, total: inputTokens + outputTokens },
    durationMs: Date.now() - start,
    turnCount: totalTurns,
    errors,
  };
}

// ══════════════════════════════════════════════════════════════════════
// NAIVE BASELINE — single continuous Claude conversation
// ══════════════════════════════════════════════════════════════════════

const NAIVE_BASELINE_SYSTEM = `You are a collaborative visual novel story creator. You'll work with the user to develop a complete visual novel blueprint through conversation.

Your process:
1. Start by exploring the seed idea — ask 2-3 focused questions about tone, themes, and what excites them
2. Through conversation, iteratively develop: a hook/premise, detailed characters with psychology, world/setting, plot arc with beats, and scene outlines
3. Build on the user's input — don't just generate everything at once
4. After the conversational phase, produce a final comprehensive blueprint

Be specific and creative. Avoid generic archetypes. Ground characters in real psychology and culture. Make the world feel lived-in. Create plot beats with genuine tension.`;

const NAIVE_BASELINE_FINAL_PROMPT = `Now produce the final visual novel blueprint based on our conversation. Include ALL of the following sections with full detail:

HOOK: The core premise in 1-3 sentences — what makes this story compelling and unique.

CHARACTERS: For each character, include: name, age, background, core psychological trait, motivation, internal conflict, key relationships, and how they change over the story. At least 3 characters with real depth.

WORLD: Setting details, atmosphere, social dynamics, rules of the world, sensory details. Make it feel specific and lived-in, not generic.

PLOT: Full arc — inciting incident, rising action beats (at least 5), midpoint turn, escalation, climax, resolution. Include specific scene ideas.

SCENES: Outline 8-12 key scenes with: location, characters present, what happens, emotional beat, and how it advances the plot.

Be comprehensive and specific. This should be a complete creative blueprint someone could use to write the actual visual novel.`;

async function runNaiveBaseline(seed: string, tokenBudget: number | null): Promise<ArmResult> {
  const start = Date.now();
  const budget = new BudgetTracker();
  const errors: string[] = [];
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];

  // Total turns across all "module-equivalent" stages
  const totalConversationTurns = MAX_TURNS * MODULE_ORDER.length;

  // First user message: the seed
  messages.push({ role: "user", content: `I want to create a visual novel. Here's my seed idea:\n\n${seed}\n\nWhat questions do you have? Let's develop this together.` });

  let turnCount = 0;

  // Conversation phase
  for (let turn = 0; turn < totalConversationTurns; turn++) {
    // Check budget
    if (tokenBudget && budget.total >= tokenBudget) {
      log("naive", `  Budget exhausted at turn ${turn}`);
      break;
    }

    try {
      const resp = await callLLMConversation(
        NAIVE_BASELINE_SYSTEM, messages, BASELINE_MODEL, 2000,
      );
      budget.record(resp.usage);
      messages.push({ role: "assistant", content: resp.text });
      turnCount++;

      // Sim user responds
      const sim = await simulateBaselineUser(resp.text, seed, turn + 1);
      messages.push({ role: "user", content: sim.message });
      log("naive", `  Turn ${turn + 1}: sim said "${sim.message.slice(0, 60)}..."`);
    } catch (err: any) {
      errors.push(`Turn ${turn}: ${err.message}`);
      break;
    }
  }

  // Final generation prompt
  messages.push({ role: "user", content: NAIVE_BASELINE_FINAL_PROMPT });

  try {
    const finalResp = await callLLMConversation(
      NAIVE_BASELINE_SYSTEM, messages, BASELINE_MODEL, 8000,
    );
    budget.record(finalResp.usage);
    messages.push({ role: "assistant", content: finalResp.text });

    return {
      arm: "naive_baseline",
      rawOutput: finalResp.text,
      normalizedOutput: "", // filled later
      tokensUsed: budget.snapshot(),
      durationMs: Date.now() - start,
      turnCount,
      errors,
    };
  } catch (err: any) {
    errors.push(`Final generation: ${err.message}`);
    // Return whatever we have
    const lastAssistant = messages.filter(m => m.role === "assistant").pop();
    return {
      arm: "naive_baseline",
      rawOutput: lastAssistant?.content ?? "(generation failed)",
      normalizedOutput: "",
      tokensUsed: budget.snapshot(),
      durationMs: Date.now() - start,
      turnCount,
      errors,
    };
  }
}

// ══════════════════════════════════════════════════════════════════════
// CHAINED BASELINE — module-by-module Claude conversations
// ══════════════════════════════════════════════════════════════════════

const CHAINED_STAGES = [
  {
    name: "hook",
    system: `You are developing the HOOK (core premise) for a visual novel. Through conversation with the user, develop a compelling, specific premise that includes: the central conflict, what makes it unique, the emotional core, and the tone. Be creative and specific — avoid generic setups.`,
    finalPrompt: `Now produce the final hook. Include: hook sentence (1-2 sentences that capture the premise), tone, genre, thematic concerns, target audience, and what makes this story worth telling. Be specific and compelling.`,
  },
  {
    name: "character",
    system: `You are developing the CHARACTER CAST for a visual novel. You have the hook/premise from the previous stage. Through conversation, develop detailed characters with: real psychology (not archetypes), specific motivations, internal conflicts, relationships, and clear arcs. At least 3 major characters with genuine depth.`,
    finalPrompt: `Now produce the final character profiles. For each character include: name, age, background, core psychology, motivation, internal conflict, key relationships, arc (how they change), speech patterns, and visual description. Be specific — these should feel like real people, not types.`,
  },
  {
    name: "world",
    system: `You are developing the WORLD/SETTING for a visual novel. You have the hook and characters from previous stages. Through conversation, develop a world that feels specific, lived-in, and integral to the story — not just a backdrop. Include: physical setting, social dynamics, atmosphere, sensory details, rules/constraints, and how the world shapes the characters.`,
    finalPrompt: `Now produce the final world document. Include: primary locations (at least 4, with sensory detail), social dynamics, atmosphere, world rules, how the setting creates or intensifies conflict, cultural texture, and time period specifics. Make it feel real and specific.`,
  },
  {
    name: "plot",
    system: `You are developing the PLOT ARC for a visual novel. You have the hook, characters, and world from previous stages. Through conversation, develop a plot with genuine tension, surprising turns, and character-driven beats. Avoid formulaic structure — let the characters drive the plot.`,
    finalPrompt: `Now produce the final plot outline. Include: inciting incident, at least 6 major beats with specific scene ideas, midpoint turn, escalation, climax, and resolution. For each beat: what happens, which characters are involved, the emotional stakes, and how it connects to the theme. Include at least 2 choice points where the player's decisions meaningfully branch the story.`,
  },
  {
    name: "scene",
    system: `You are writing SCENE OUTLINES for a visual novel. You have the complete story foundation from previous stages. Write detailed scene outlines that bring the plot to life with specific dialogue moments, visual staging, emotional beats, and pacing.`,
    finalPrompt: `Now produce the final scene outlines. Write 8-12 scene outlines, each with: scene number, title, location, characters present, what happens (3-5 sentences), key dialogue moment (1-2 lines of actual dialogue), emotional beat, visual/staging notes, and how it connects to the next scene. These should read like a director's shooting script.`,
  },
];

async function runChainedBaseline(seed: string, tokenBudget: number | null): Promise<ArmResult> {
  const start = Date.now();
  const budget = new BudgetTracker();
  const errors: string[] = [];
  const stageOutputs: Record<string, string> = {};
  let totalTurns = 0;

  for (const stage of CHAINED_STAGES) {
    log("chained", `Stage: ${stage.name}...`);

    // Build context from previous stages
    const priorContext = Object.entries(stageOutputs)
      .map(([name, output]) => `=== ${name.toUpperCase()} ===\n${output.slice(0, 4000)}`)
      .join("\n\n");

    const systemWithContext = priorContext
      ? `${stage.system}\n\nPREVIOUS STAGES (your work must be consistent with these):\n${priorContext}`
      : stage.system;

    const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
    messages.push({
      role: "user",
      content: stage.name === "hook"
        ? `Here's my seed idea for a visual novel:\n\n${seed}\n\nLet's develop the ${stage.name} together. What questions do you have?`
        : `Let's develop the ${stage.name} for this story. What ideas do you have based on what we've established?`,
    });

    // Conversation turns for this stage
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      if (tokenBudget && budget.total >= tokenBudget) {
        log("chained", `  Budget exhausted at ${stage.name} turn ${turn}`);
        break;
      }

      try {
        const resp = await callLLMConversation(systemWithContext, messages, BASELINE_MODEL, 2000);
        budget.record(resp.usage);
        messages.push({ role: "assistant", content: resp.text });
        totalTurns++;

        const sim = await simulateBaselineUser(resp.text, seed, turn + 1);
        messages.push({ role: "user", content: sim.message });
      } catch (err: any) {
        errors.push(`${stage.name} turn ${turn}: ${err.message}`);
        break;
      }
    }

    // Final generation for this stage
    messages.push({ role: "user", content: stage.finalPrompt });
    try {
      const finalResp = await callLLMConversation(systemWithContext, messages, BASELINE_MODEL, 4000);
      budget.record(finalResp.usage);
      stageOutputs[stage.name] = finalResp.text;
      log("chained", `  ${stage.name} complete (${finalResp.text.length} chars)`);
    } catch (err: any) {
      errors.push(`${stage.name} final: ${err.message}`);
      stageOutputs[stage.name] = "(generation failed)";
    }
  }

  const rawOutput = Object.entries(stageOutputs)
    .map(([name, output]) => `=== ${name.toUpperCase()} ===\n${output}`)
    .join("\n\n");

  return {
    arm: "chained_baseline",
    rawOutput,
    normalizedOutput: "",
    tokensUsed: budget.snapshot(),
    durationMs: Date.now() - start,
    turnCount: totalTurns,
    errors,
  };
}

// ══════════════════════════════════════════════════════════════════════
// NORMALIZATION — convert both outputs to identical plain-text format
// ══════════════════════════════════════════════════════════════════════

const NORMALIZER_SYSTEM = `You are a faithful reformatter. Convert the given creative output into a standardized plain-text blueprint format. Do NOT add, improve, embellish, or remove any creative content. Only reformat. If information is missing from a section, write "(not specified)" — do not invent it.`;

const NORMALIZER_TEMPLATE = `Convert this output into a plain-text story blueprint with EXACTLY these sections. Be faithful to the source — reformat only, do not add or improve content.

HOOK: The core premise in 1-3 sentences.

CHARACTERS: For each character: name, age, role, core psychology, motivation, internal conflict, key relationships, arc.

WORLD: Setting, atmosphere, social dynamics, sensory details, rules.

PLOT: Arc summary, major beats (numbered), key turning points.

SCENES: Scene outlines (numbered) with location, characters, what happens, emotional beat.

SOURCE OUTPUT:
`;

async function normalizeOutput(raw: string): Promise<string> {
  const resp = await callLLM(
    NORMALIZER_SYSTEM,
    NORMALIZER_TEMPLATE + raw.slice(0, 15000),
    NORMALIZER_MODEL,
    4000,
  );
  return resp.text;
}

// ══════════════════════════════════════════════════════════════════════
// COMPARATIVE JUDGE — blind A/B with position swap
// ══════════════════════════════════════════════════════════════════════

const JUDGE_SYSTEM = `You are a rigorous, impartial judge comparing two visual novel story blueprints. You will see Output A and Output B — you do NOT know which system produced which. Judge purely on creative quality, not formatting or length. Be specific in your reasoning.`;

const JUDGE_DIMENSIONS = [
  "COHERENCE: Internal consistency and logical connections between all story elements",
  "CULTURAL_DEPTH: Real-world texture, specific cultural grounding, contemporary resonance",
  "CHARACTER_SPECIFICITY: Distinct psychology, behavior patterns, real motivations (not generic archetypes)",
  "PLOT_STRUCTURE: Arc quality, tension, stakes, pacing, surprising-yet-inevitable beats",
  "CROSS_MODULE_CONSISTENCY: Do characters fit the world? Does the plot honor the hook? Do scenes serve the arc?",
  "OVERALL_QUALITY: Would this make a compelling, publishable visual novel?",
];

function buildJudgePrompt(seedText: string, outputA: string, outputB: string): string {
  return `SEED (both outputs started from this): ${seedText}

=== OUTPUT A ===
${outputA.slice(0, 12000)}

=== OUTPUT B ===
${outputB.slice(0, 12000)}

Compare these two story blueprints on each dimension. For each: score both A and B from 1-10, then pick a winner (A, B, or TIE).

Dimensions:
${JUDGE_DIMENSIONS.map((d, i) => `${i + 1}. ${d}`).join("\n")}

Then give an OVERALL WINNER (A, B, or TIE) with reasoning.

IMPORTANT: Judge on creative substance, not formatting or length. A shorter, sharper blueprint can beat a longer, blander one.

Respond in JSON:
{
  "dimensions": [
    {"name": "COHERENCE", "score_a": 7, "score_b": 6, "winner": "A", "reasoning": "..."},
    ...
  ],
  "overall_winner": "A" | "B" | "TIE",
  "reasoning": "1-2 sentences on why the overall winner is better"
}`;
}

async function runJudging(
  seed: string,
  appOutput: string,
  baselineOutput: string,
): Promise<{ run1: JudgingResult; run2: JudgingResult; finalVerdict: "app" | "baseline" | "tie" }> {
  // Run 1: app=A, baseline=B
  const prompt1 = buildJudgePrompt(seed, appOutput, baselineOutput);
  const resp1 = await callLLM(JUDGE_SYSTEM, prompt1, JUDGE_MODEL, 2000);
  const judging1 = parseJudgingResponse(resp1.text, "app");

  // Run 2: baseline=A, app=B (position swap)
  const prompt2 = buildJudgePrompt(seed, baselineOutput, appOutput);
  const resp2 = await callLLM(JUDGE_SYSTEM, prompt2, JUDGE_MODEL, 2000);
  const judging2 = parseJudgingResponse(resp2.text, "baseline");

  // Determine final verdict: if both runs agree, that's the answer. If they disagree, TIE.
  const winner1 = resolveWinner(judging1.overallWinner, judging1.positionA);
  const winner2 = resolveWinner(judging2.overallWinner, judging2.positionA);

  let finalVerdict: "app" | "baseline" | "tie";
  if (winner1 === winner2) {
    finalVerdict = winner1;
  } else {
    finalVerdict = "tie";
  }

  return { run1: judging1, run2: judging2, finalVerdict };
}

function resolveWinner(
  winner: "A" | "B" | "TIE",
  positionA: "app" | "baseline",
): "app" | "baseline" | "tie" {
  if (winner === "TIE") return "tie";
  if (winner === "A") return positionA === "app" ? "app" : "baseline";
  return positionA === "app" ? "baseline" : "app";
}

function parseJudgingResponse(raw: string, positionA: "app" | "baseline"): JudgingResult {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON");
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      positionA,
      dimensions: (parsed.dimensions ?? []).map((d: any) => ({
        name: d.name ?? "unknown",
        score_a: d.score_a ?? 0,
        score_b: d.score_b ?? 0,
        winner: d.winner ?? "TIE",
      })),
      overallWinner: parsed.overall_winner ?? "TIE",
      reasoning: parsed.reasoning ?? "",
    };
  } catch {
    return {
      positionA,
      dimensions: [],
      overallWinner: "TIE",
      reasoning: `(parse failed: ${raw.slice(0, 200)})`,
    };
  }
}

// ══════════════════════════════════════════════════════════════════════
// STATISTICS — Wilson score confidence interval
// ══════════════════════════════════════════════════════════════════════

function wilsonCI(wins: number, total: number, z = 1.96): [number, number] {
  if (total === 0) return [0, 0];
  const p = wins / total;
  const denom = 1 + z * z / total;
  const center = (p + z * z / (2 * total)) / denom;
  const margin = (z * Math.sqrt(p * (1 - p) / total + z * z / (4 * total * total))) / denom;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

function computeWinRate(comparisons: Comparison[], key: "judgingNormalized" | "judgingRaw"): WinRateSummary {
  let appWins = 0, baselineWins = 0, ties = 0;
  const perDim: Record<string, { appWins: number; baselineWins: number; ties: number }> = {};

  for (const c of comparisons) {
    const verdict = c[key].finalVerdict;
    if (verdict === "app") appWins++;
    else if (verdict === "baseline") baselineWins++;
    else ties++;

    // Per-dimension tracking from run1 (primary position)
    for (const dim of c[key].run1.dimensions) {
      if (!perDim[dim.name]) perDim[dim.name] = { appWins: 0, baselineWins: 0, ties: 0 };
      const dimWinner = resolveWinner(dim.winner, c[key].run1.positionA);
      if (dimWinner === "app") perDim[dim.name].appWins++;
      else if (dimWinner === "baseline") perDim[dim.name].baselineWins++;
      else perDim[dim.name].ties++;
    }
  }

  const total = comparisons.length;
  const nonTies = appWins + baselineWins;
  const winRate = nonTies > 0 ? appWins / nonTies : 0.5;
  const ci95 = wilsonCI(appWins, nonTies);

  return { appWins, baselineWins, ties, total, winRate, ci95, perDimension: perDim };
}

// ══════════════════════════════════════════════════════════════════════
// CONFIG INJECTION & VERIFICATION
// ══════════════════════════════════════════════════════════════════════

async function injectAndVerifyConfig(): Promise<Record<string, string>> {
  // Read DEFAULT_MODEL_CONFIG from backend
  const currentConfig = await get("/models");
  log("config", `Current config has ${Object.keys(currentConfig).length} roles`);

  // Re-inject to ensure it's fresh (PUT with current = identity, but forces re-application)
  const verified = await put("/models", currentConfig);

  // Verify every role matches
  for (const [role, model] of Object.entries(currentConfig)) {
    if ((verified as any)[role] !== model) {
      throw new Error(`Config verification failed: ${role} expected ${model}, got ${(verified as any)[role]}`);
    }
  }
  log("config", "Config injected and verified");
  return currentConfig;
}

// ══════════════════════════════════════════════════════════════════════
// LOGGING
// ══════════════════════════════════════════════════════════════════════

function log(tag: string, msg: string) {
  const time = new Date().toISOString().slice(11, 19);
  console.log(`[${time}] [${tag.toUpperCase().padEnd(10)}] ${msg}`);
}

// ══════════════════════════════════════════════════════════════════════
// REPORT GENERATION
// ══════════════════════════════════════════════════════════════════════

function generateReport(record: RunRecord): string {
  const lines: string[] = [
    "═".repeat(65),
    "  HEAD-TO-HEAD BASELINE COMPARISON REPORT",
    "═".repeat(65),
    "",
    `Run ID: ${record.runId}`,
    `Started: ${record.startedAt}`,
    `Completed: ${record.completedAt}`,
    `Seeds: ${record.seeds.length} × ${record.repsPerSeed} reps = ${record.comparisons.length} comparisons`,
    "",
  ];

  // Config snapshot
  lines.push("─── CONFIG SNAPSHOT ───");
  for (const [role, model] of Object.entries(record.configSnapshot).slice(0, 5)) {
    lines.push(`  ${role}: ${model}`);
  }
  lines.push(`  ... (${Object.keys(record.configSnapshot).length} roles total)`);
  lines.push("");

  // Prompt hashes
  lines.push("─── PROMPT HASHES ───");
  for (const [name, hash] of Object.entries(record.promptHashes)) {
    lines.push(`  ${name}: ${hash}`);
  }
  lines.push("");

  // Per-comparison results
  lines.push("─── INDIVIDUAL COMPARISONS ───");
  for (const c of record.comparisons) {
    const seedShort = c.seed.slice(0, 60);
    lines.push(`  [${c.baselineType}/${c.budgetMode}] Seed: "${seedShort}..." Rep ${c.rep}`);
    lines.push(`    Normalized: ${c.judgingNormalized.finalVerdict.toUpperCase()} | Raw: ${c.judgingRaw.finalVerdict.toUpperCase()}`);
    lines.push(`    App tokens: ${c.appResult.tokensUsed.total} | Baseline tokens: ${c.baselineResult.tokensUsed.total}`);
    lines.push(`    App time: ${(c.appResult.durationMs / 1000).toFixed(1)}s | Baseline time: ${(c.baselineResult.durationMs / 1000).toFixed(1)}s`);
    if (c.appResult.errors.length) lines.push(`    App errors: ${c.appResult.errors.join("; ")}`);
    if (c.baselineResult.errors.length) lines.push(`    Baseline errors: ${c.baselineResult.errors.join("; ")}`);
  }
  lines.push("");

  // Summary tables
  const summaryKeys = ["naive_matched", "naive_unconstrained", "chained_matched", "chained_unconstrained", "primary"] as const;
  for (const key of summaryKeys) {
    const s = record.summary[key as keyof typeof record.summary];
    if (!s || typeof s === "string") continue;
    const ws = s as WinRateSummary;
    lines.push(`─── ${key.toUpperCase().replace("_", " ")} ───`);
    lines.push(`  App wins: ${ws.appWins} | Baseline wins: ${ws.baselineWins} | Ties: ${ws.ties}`);
    lines.push(`  Win rate: ${(ws.winRate * 100).toFixed(1)}% [${(ws.ci95[0] * 100).toFixed(1)}% – ${(ws.ci95[1] * 100).toFixed(1)}%] (95% CI)`);

    if (Object.keys(ws.perDimension).length > 0) {
      lines.push("  Per dimension:");
      for (const [dim, counts] of Object.entries(ws.perDimension)) {
        lines.push(`    ${dim}: App ${counts.appWins} / Baseline ${counts.baselineWins} / Tie ${counts.ties}`);
      }
    }
    lines.push("");
  }

  // Decision
  lines.push("═".repeat(65));
  const d = record.summary.decisionRule;
  const label = d === "app_wins" ? "APP WINS — the pipeline adds measurable value"
    : d === "net_negative" ? "NET NEGATIVE — the app does not outperform raw Claude"
    : d === "inconclusive" ? "INCONCLUSIVE — results are mixed, need more data or manual review"
    : "NO DATA";
  lines.push(`  DECISION: ${label}`);
  lines.push("═".repeat(65));

  return lines.join("\n");
}

// ══════════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════════

async function main() {
  const args = parseArgs();
  const selectedSeeds = SEEDS.slice(0, args.seeds);

  console.log("\n" + "═".repeat(65));
  console.log("  HEAD-TO-HEAD BASELINE COMPARISON");
  console.log("═".repeat(65));
  console.log(`Seeds: ${selectedSeeds.length} × ${args.reps} reps`);
  console.log(`Baselines: ${args.baseline}`);
  console.log(`Budget modes: ${args.unconstrained ? "unconstrained only" : "matched + unconstrained"}`);
  console.log(`Decision rule: budget-matched + normalized ≥60% = app wins`);
  console.log("═".repeat(65) + "\n");

  // Check backend
  try {
    await fetch(`${BASE_URL}/api/hook/list-sessions`);
  } catch {
    console.error(`\nBackend not reachable at ${BASE_URL}. Start it with: npm run dev:backend\n`);
    process.exit(1);
  }

  // Inject and verify config
  const configSnapshot = await injectAndVerifyConfig();

  // Build prompt hashes
  const promptHashes: Record<string, string> = {
    app_sim_user: sha256(APP_SIM_USER_SYSTEM),
    baseline_sim_user: sha256(BASELINE_SIM_USER_SYSTEM),
    naive_baseline_system: sha256(NAIVE_BASELINE_SYSTEM),
    naive_final_prompt: sha256(NAIVE_BASELINE_FINAL_PROMPT),
    normalizer_system: sha256(NORMALIZER_SYSTEM),
    normalizer_template: sha256(NORMALIZER_TEMPLATE),
    judge_system: sha256(JUDGE_SYSTEM),
    judge_dimensions: sha256(JUDGE_DIMENSIONS.join("\n")),
  };
  for (const stage of CHAINED_STAGES) {
    promptHashes[`chained_${stage.name}_system`] = sha256(stage.system);
    promptHashes[`chained_${stage.name}_final`] = sha256(stage.finalPrompt);
  }

  const ts = Date.now().toString(36);
  const record: RunRecord = {
    runId: `bcomp_${ts}`,
    startedAt: new Date().toISOString(),
    completedAt: "",
    configSnapshot,
    promptHashes,
    seeds: selectedSeeds,
    repsPerSeed: args.reps,
    comparisons: [],
    summary: { decisionRule: "no_data" },
  };

  const baselineTypes: Array<"naive" | "chained"> =
    args.baseline === "both" ? ["naive", "chained"]
    : [args.baseline as "naive" | "chained"];

  // ── Main loop ──
  for (const seed of selectedSeeds) {
    for (let rep = 1; rep <= args.reps; rep++) {
      for (const blType of baselineTypes) {
        log("main", `\nSeed ${selectedSeeds.indexOf(seed) + 1}/${selectedSeeds.length}, rep ${rep}, baseline: ${blType}`);
        log("main", `"${seed.slice(0, 70)}..."`);

        // Run app arm
        log("main", "Running app arm...");
        const appResult = await runAppArm(seed);
        log("main", `App arm done: ${appResult.errors.length} errors, ${(appResult.durationMs / 1000).toFixed(1)}s`);

        // Determine budget for matched mode
        const appTokenBudget = appResult.tokensUsed.total;

        // Run baseline arm(s) — budget-matched then unconstrained
        const budgetModes: Array<"matched" | "unconstrained"> =
          args.unconstrained ? ["unconstrained"] : ["matched", "unconstrained"];

        for (const budgetMode of budgetModes) {
          const tokenBudget = budgetMode === "matched" ? appTokenBudget : null;
          log("main", `Running ${blType} baseline (${budgetMode}, budget: ${tokenBudget ?? "unlimited"})...`);

          let baselineResult: ArmResult;
          if (blType === "naive") {
            baselineResult = await runNaiveBaseline(seed, tokenBudget);
          } else {
            baselineResult = await runChainedBaseline(seed, tokenBudget);
          }
          log("main", `Baseline done: ${baselineResult.errors.length} errors, ${(baselineResult.durationMs / 1000).toFixed(1)}s`);

          // Normalize both outputs
          log("main", "Normalizing outputs...");
          appResult.normalizedOutput = await normalizeOutput(appResult.rawOutput);
          baselineResult.normalizedOutput = await normalizeOutput(baselineResult.rawOutput);

          // Judge: normalized
          log("main", "Judging (normalized)...");
          const judgingNormalized = await runJudging(seed, appResult.normalizedOutput, baselineResult.normalizedOutput);
          log("main", `Normalized verdict: ${judgingNormalized.finalVerdict}`);

          // Judge: raw
          log("main", "Judging (raw)...");
          const judgingRaw = await runJudging(seed, appResult.rawOutput, baselineResult.rawOutput);
          log("main", `Raw verdict: ${judgingRaw.finalVerdict}`);

          record.comparisons.push({
            seed,
            rep,
            baselineType: blType,
            budgetMode,
            appResult: { ...appResult }, // snapshot since normalizedOutput was just set
            baselineResult: { ...baselineResult },
            judgingNormalized,
            judgingRaw,
          });
        }
      }
    }
  }

  // ── Compute summaries ──
  const groupBy = (bl: "naive" | "chained", bm: "matched" | "unconstrained") =>
    record.comparisons.filter(c => c.baselineType === bl && c.budgetMode === bm);

  for (const bl of baselineTypes) {
    const matched = groupBy(bl, "matched");
    const unconstrained = groupBy(bl, "unconstrained");
    if (matched.length > 0) {
      (record.summary as any)[`${bl}_matched`] = computeWinRate(matched, "judgingNormalized");
    }
    if (unconstrained.length > 0) {
      (record.summary as any)[`${bl}_unconstrained`] = computeWinRate(unconstrained, "judgingNormalized");
    }
  }

  // Primary endpoint: all budget-matched + normalized comparisons
  const primaryComparisons = record.comparisons.filter(c => c.budgetMode === "matched");
  if (primaryComparisons.length > 0) {
    const primary = computeWinRate(primaryComparisons, "judgingNormalized");
    record.summary.primary = primary;

    if (primary.winRate >= 0.6) record.summary.decisionRule = "app_wins";
    else if (primary.winRate >= 0.5) record.summary.decisionRule = "inconclusive";
    else record.summary.decisionRule = "net_negative";
  }

  record.completedAt = new Date().toISOString();

  // ── Output ──
  const reportText = generateReport(record);
  console.log("\n\n" + reportText);

  const dir = "./data/baseline-comparisons";
  await mkdir(dir, { recursive: true });
  const reportPath = `${dir}/report_${ts}.txt`;
  const jsonPath = `${dir}/report_${ts}.json`;
  await writeFile(reportPath, reportText, "utf-8");
  await writeFile(jsonPath, JSON.stringify(record, null, 2), "utf-8");
  console.log(`\nReport: ${reportPath}`);
  console.log(`JSON:   ${jsonPath}`);
}

main().catch(err => {
  console.error("Baseline comparison failed:", err);
  process.exit(1);
});
