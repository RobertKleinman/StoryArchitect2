#!/usr/bin/env tsx
/**
 * PROMPT A/B TEST
 * ═══════════════
 * Tests whether a simplified prompt improves scores for models that
 * underperformed on the Claude-optimized prompts.
 *
 * Runs: 3 bottom models × 5 contracts × 2 prompt styles × 3 reps = 90 calls + judge
 */

import "dotenv/config";
import { mkdir, writeFile } from "fs/promises";

import {
  CULTURAL_RESEARCHER_SYSTEM,
  CULTURAL_RESEARCHER_USER_TEMPLATE,
} from "../backend/services/culturalPrompts";
import { CULTURAL_BRIEF_SCHEMA } from "../backend/services/culturalSchemas";
import { detectProvider, type LLMProvider } from "../shared/modelConfig";

// ── Simplified prompt (less Claude-flavored) ──

const SIMPLIFIED_CULTURAL_SYSTEM = `You are a cultural researcher. Given a story description, find real-world cultural connections that could enrich the story.

RULES:
1. Be SPECIFIC. Name real mechanisms, phenomena, places, practices. Never give vague labels.
2. Each evidence item needs: a concrete claim, a specific detail that a writer could use in a scene, and which dimension it maps to.
3. Produce 3-5 evidence items, 2-3 creative applications, and 0-2 proposals.
4. Every item must explain HOW something works, not just THAT it exists.
5. Focus on what's useful for writing scenes — pressures, contradictions, sensory details, behavioral patterns.
6. Do not fabricate. If you don't know specifics, skip that area.
7. Creative applications must connect to THIS specific story, not generic themes.
8. Include at least one surprising or non-obvious connection.

Return ONLY valid JSON matching the schema. No markdown.`;

const SIMPLIFIED_CULTURAL_USER = `Find cultural connections for this story.

STORY: {{STORY_ESSENCE}}
EMOTIONAL CORE: {{EMOTIONAL_CORE}}

CONFIRMED: {{CONFIRMED_ELEMENTS}}
OPEN QUESTIONS: {{OPEN_QUESTIONS}}
STYLE: {{USER_STYLE_SIGNALS}}
REFERENCES: {{DIRECTED_REFERENCES}}
NOT THIS: {{NEGATIVE_PROFILE}}

Module: {{MODULE}}, Turn: {{TURN_NUMBER}}

Produce cultural evidence items, creative applications, and proposals. Be specific and scene-ready.`;

// ── Models to test ──

const MODELS = [
  "gemini-3-flash-preview",
  "claude-haiku-4-5-20251001",
];

const JUDGE_MODEL = "claude-sonnet-4-6";
const REPS = 3;
const CONCURRENCY = 6;

// ── Contracts (same as main test) ──

interface ResearchContract {
  label: string;
  storyEssence: string;
  emotionalCore: string;
  confirmedElements: string[];
  openQuestions: string[];
  userStyleSignals: string[];
  directedReferences: string[];
  negativeProfile: string[];
  module: string;
  turnNumber: number;
}

const CONTRACTS: ResearchContract[] = [
  {
    label: "Hospital AI Triage",
    storyEssence: "A burned-out nurse discovers algorithmic bias in hospital triage — patients who can't pay are being quietly deprioritized by an AI system. The only person who can help expose it is the engineer who built it: her estranged sister.",
    emotionalCore: "The sick feeling of knowing the system you serve is harming people, combined with the vertigo of needing help from someone who hurt you personally.",
    confirmedElements: ["Contemporary US hospital setting", "AI triage system as central antagonist-mechanism", "Two sisters estranged for years — nurse and engineer", "Tone: grounded thriller with moral complexity"],
    openQuestions: ["What specific mechanism does the AI use to deprioritize?", "Why are the sisters estranged?", "Who benefits from the AI system staying hidden?"],
    userStyleSignals: ["Gravitates toward institutional critique", "Wants moral complexity over clear heroes", "Prefers grounded realism"],
    directedReferences: [], negativeProfile: ["Not a simple whistleblower story", "Not anti-technology"],
    module: "hook", turnNumber: 3,
  },
  {
    label: "Sky Eden / Surface Survival",
    storyEssence: "A vertical class dystopia where a paradise floats above a wasteland. A group of surface-dwellers look up at what they can't have. The story is about whether reaching the sky means becoming what you hate.",
    emotionalCore: "The specific ache of being able to SEE paradise but not touch it. Mixed with the fierce loyalty of people who have nothing but each other.",
    confirmedElements: ["Sky Eden: floating utopia", "Surface: wasteland", "Ensemble cast of young friends", "Manga-influenced visual style"],
    openQuestions: ["What keeps the surface dwellers from reaching Eden?", "Is Eden actually paradise or does it have its own rot?"],
    userStyleSignals: ["Loves ensemble dynamics", "Drawn to visual spectacle", "Wants found-family themes"],
    directedReferences: [], negativeProfile: ["Not grimdark — hope matters", "Not a solo hero journey"],
    module: "world", turnNumber: 2,
  },
  {
    label: "Reincarnated Religious Woman",
    storyEssence: "A judgmental, miserable, deeply religious woman dies and is reincarnated as a cute catgirl in a fantasy world. Comedy of cognitive dissonance.",
    emotionalCore: "The comedy of unwilling transformation — whether someone cruel because they were unhappy can become kind when given a second chance.",
    confirmedElements: ["Comedy-first tone, manga pacing", "Isekai reincarnation as catgirl", "Protagonist retains memories", "Fantasy world is genuinely kind"],
    openQuestions: ["Does she remember her old life immediately or gradually?", "What religious beliefs clash hardest?"],
    userStyleSignals: ["Wants comedy with emotional depth", "Enjoys subversion", "Manga tone"],
    directedReferences: [], negativeProfile: ["Not mean-spirited toward religious people", "Not fanservice-focused"],
    module: "character", turnNumber: 3,
  },
  {
    label: "Sci-Fi Leather BDSM Hellraiser",
    storyEssence: "A sci-fi horror-erotica hybrid where BDSM culture has evolved into something ritualistic and quasi-religious in a far-future setting. Hellraiser-influenced.",
    emotionalCore: "The terrifying intimacy of surrendering completely to someone who might be more than human.",
    confirmedElements: ["Far-future sci-fi setting", "Hellraiser-influenced body horror/transcendence", "Gay male characters, explicit erotica", "BDSM as ritual/spiritual practice"],
    openQuestions: ["What is the sci-fi mechanism?", "Is BDSM mainstream or hidden order?"],
    userStyleSignals: ["Unapologetically explicit", "Wants horror and eroticism intertwined", "Visceral sensory detail"],
    directedReferences: ["Hellraiser (Clive Barker)"], negativeProfile: ["Not vanilla romance", "Not shame-based"],
    module: "world", turnNumber: 2,
  },
  {
    label: "Jock Sold to Elf Prince",
    storyEssence: "A college-age jock is stripped of his world and sold into servitude to an elf prince. The power inversion is the engine.",
    emotionalCore: "The vertigo of being reduced from someone who mattered to someone who is property.",
    confirmedElements: ["Isekai: modern jock to fantasy realm", "Elf prince as master", "Slavery is institutional", "Gay romance trajectory — slow burn"],
    openQuestions: ["Why was the jock taken?", "What does the prince want from him?"],
    userStyleSignals: ["Drawn to power dynamics", "Likes vulnerability in strong characters", "Fantasy worldbuilding"],
    directedReferences: [], negativeProfile: ["Not non-con apologia", "Not purely comedic"],
    module: "character", turnNumber: 4,
  },
];

// ── Provider callers (same as main test) ──

interface LLMCallResult { text: string; model: string; provider: LLMProvider; durationMs: number; error?: string; }

function stripAdditionalProperties(obj: any): any {
  if (Array.isArray(obj)) return obj.map(stripAdditionalProperties);
  if (obj && typeof obj === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === "additionalProperties") continue;
      out[k] = stripAdditionalProperties(v);
    }
    return out;
  }
  return obj;
}

function enforceAllRequired(obj: any): any {
  if (Array.isArray(obj)) return obj.map(enforceAllRequired);
  if (obj && typeof obj === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = enforceAllRequired(v);
    }
    if (out.properties && typeof out.properties === "object") {
      out.required = Object.keys(out.properties);
    }
    return out;
  }
  return obj;
}

async function callAnthropic(model: string, system: string, user: string, schema: Record<string, unknown>, maxTokens: number, temperature: number): Promise<LLMCallResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { text: "", model, provider: "anthropic", durationMs: 0, error: "ANTHROPIC_API_KEY not set" };
  const start = Date.now();
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model, max_tokens: maxTokens, temperature, system,
        messages: [{ role: "user", content: user }],
        tools: [{ name: "structured_output", description: "Return structured output", input_schema: schema }],
        tool_choice: { type: "tool", name: "structured_output" },
      }),
    });
    const data = await res.json() as any;
    if (data.error) throw new Error(JSON.stringify(data.error));
    const toolBlock = data.content?.find((b: any) => b.type === "tool_use");
    const text = toolBlock ? JSON.stringify(toolBlock.input) : data.content?.[0]?.text ?? "";
    return { text, model, provider: "anthropic", durationMs: Date.now() - start };
  } catch (err: any) {
    return { text: "", model, provider: "anthropic", durationMs: Date.now() - start, error: err.message };
  }
}

async function callGemini(model: string, system: string, user: string, schema: Record<string, unknown>, maxTokens: number, temperature: number): Promise<LLMCallResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { text: "", model, provider: "gemini", durationMs: 0, error: "GEMINI_API_KEY not set" };
  const start = Date.now();
  try {
    const cleanSchema = stripAdditionalProperties(schema);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    const res = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { temperature, maxOutputTokens: maxTokens, responseMimeType: "application/json", responseSchema: cleanSchema },
      }),
    });
    const data = await res.json() as any;
    if (data.error) throw new Error(JSON.stringify(data.error));
    return { text: data.candidates?.[0]?.content?.parts?.[0]?.text ?? "", model, provider: "gemini", durationMs: Date.now() - start };
  } catch (err: any) {
    return { text: "", model, provider: "gemini", durationMs: Date.now() - start, error: err.message };
  }
}

async function callOpenAICompatible(model: string, provider: "openai" | "grok", system: string, user: string, schema: Record<string, unknown>, maxTokens: number, temperature: number): Promise<LLMCallResult> {
  const envKey = provider === "grok" ? "GROK_API_KEY" : "OPENAI_API_KEY";
  const baseUrl = provider === "grok" ? "https://api.x.ai/v1" : "https://api.openai.com/v1";
  const key = process.env[envKey];
  if (!key) return { text: "", model, provider, durationMs: 0, error: `${envKey} not set` };
  const start = Date.now();
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        ...(provider === "openai" ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }),
        temperature,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        response_format: { type: "json_schema", json_schema: { name: "research_output", strict: true, schema: provider === "openai" ? enforceAllRequired(schema) : schema } },
      }),
    });
    const data = await res.json() as any;
    if (data.error) throw new Error(JSON.stringify(data.error));
    return { text: data.choices?.[0]?.message?.content ?? "", model, provider, durationMs: Date.now() - start };
  } catch (err: any) {
    return { text: "", model, provider, durationMs: Date.now() - start, error: err.message };
  }
}

async function callModel(model: string, system: string, user: string, schema: Record<string, unknown>, maxTokens: number, temperature: number): Promise<LLMCallResult> {
  const provider = detectProvider(model);
  switch (provider) {
    case "anthropic": return callAnthropic(model, system, user, schema, maxTokens, temperature);
    case "gemini": return callGemini(model, system, user, schema, maxTokens, temperature);
    case "openai":
    case "grok": return callOpenAICompatible(model, provider, system, user, schema, maxTokens, temperature);
    default: throw new Error(`Provider ${provider} not supported in this test`);
  }
}

// ── Build prompts ──

function buildOriginalPrompt(c: ResearchContract): string {
  return CULTURAL_RESEARCHER_USER_TEMPLATE
    .replace("{{STORY_ESSENCE}}", c.storyEssence).replace("{{EMOTIONAL_CORE}}", c.emotionalCore)
    .replace("{{CONFIRMED_ELEMENTS}}", c.confirmedElements.join("\n")).replace("{{OPEN_QUESTIONS}}", c.openQuestions.join("\n"))
    .replace("{{USER_STYLE_SIGNALS}}", c.userStyleSignals.join("\n")).replace("{{DIRECTED_REFERENCES}}", c.directedReferences.join("\n") || "(none)")
    .replace("{{NEGATIVE_PROFILE}}", c.negativeProfile.join("\n")).replace("{{MODULE}}", c.module).replace("{{TURN_NUMBER}}", String(c.turnNumber));
}

function buildSimplifiedPrompt(c: ResearchContract): string {
  return SIMPLIFIED_CULTURAL_USER
    .replace("{{STORY_ESSENCE}}", c.storyEssence).replace("{{EMOTIONAL_CORE}}", c.emotionalCore)
    .replace("{{CONFIRMED_ELEMENTS}}", c.confirmedElements.join("\n")).replace("{{OPEN_QUESTIONS}}", c.openQuestions.join("\n"))
    .replace("{{USER_STYLE_SIGNALS}}", c.userStyleSignals.join("\n")).replace("{{DIRECTED_REFERENCES}}", c.directedReferences.join("\n") || "(none)")
    .replace("{{NEGATIVE_PROFILE}}", c.negativeProfile.join("\n")).replace("{{MODULE}}", c.module).replace("{{TURN_NUMBER}}", String(c.turnNumber));
}

// ── Schema validation ──

const REQUIRED_FIELDS = ["evidenceItems", "searchDimensions", "creativeApplications", "proposals"];

function validate(raw: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  let parsed: any;
  try { parsed = JSON.parse(raw); } catch { return { valid: false, errors: ["Invalid JSON"] }; }
  for (const f of REQUIRED_FIELDS) {
    if (parsed[f] === undefined || parsed[f] === null) errors.push(`Missing: ${f}`);
  }
  const items = parsed.evidenceItems ?? [];
  if (!Array.isArray(items) || items.length === 0) errors.push("No evidence items");
  for (let i = 0; i < items.length; i++) {
    if (!items[i].claim || !items[i].specificDetail) errors.push(`Item ${i}: missing claim/specificDetail`);
  }
  return { valid: errors.length === 0, errors };
}

// ── Judge ──

const JUDGE_SYSTEM = `You are a quality evaluator for story research outputs. Score on a structured rubric. 3 is average, 5 is exceptional, 1 is useless.

RUBRIC:
- specificity (1-5): Concrete mechanisms, real references, specific details? Or vague labels?
- storyFuel (1-5): Could a writer use this to write a scene WITHOUT further research?
- surprise (1-5): Would the creator have thought of this without the engine?
- relevance (1-5): Does it connect to THIS specific story?

Return ONLY valid JSON: {"specificity": N, "storyFuel": N, "surprise": N, "relevance": N, "reasoning": "1-2 sentences"}`;

interface JudgeScores { specificity: number; storyFuel: number; surprise: number; relevance: number; composite: number; reasoning: string; }

async function judgeOutput(contractLabel: string, storyEssence: string, outputText: string): Promise<JudgeScores | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: JUDGE_MODEL, max_tokens: 300, temperature: 0, system: JUDGE_SYSTEM,
        messages: [{ role: "user", content: `Score this cultural research for "${contractLabel}".\n\nSTORY: ${storyEssence}\n\nOUTPUT:\n${outputText.slice(0, 6000)}` }],
      }),
    });
    const data = await res.json() as any;
    if (data.error) return null;
    const match = (data.content?.[0]?.text ?? "").match(/\{[\s\S]*\}/);
    if (!match) return null;
    const p = JSON.parse(match[0]);
    return { ...p, composite: Math.round((p.specificity + p.storyFuel + p.surprise + p.relevance) / 4 * 100) / 100 };
  } catch { return null; }
}

// ── Concurrency limiter ──

function createLimiter(max: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async function<T>(fn: () => Promise<T>): Promise<T> {
    while (active >= max) { await new Promise<void>(r => queue.push(r)); }
    active++;
    try { return await fn(); } finally { active--; queue.shift()?.(); }
  };
}

function log(msg: string) {
  const time = new Date().toISOString().slice(11, 19);
  console.log(`[${time}] ${msg}`);
}

// ── Main ──

interface RunResult {
  contractLabel: string; model: string; promptStyle: "original" | "simplified";
  rep: number; durationMs: number; valid: boolean; judge: JudgeScores | null; error?: string;
}

async function main() {
  const limit = createLimiter(CONCURRENCY);
  const results: RunResult[] = [];
  const totalCalls = MODELS.length * CONTRACTS.length * 2 * REPS; // 2 prompt styles

  console.log("\n" + "=".repeat(60));
  console.log("  PROMPT A/B TEST — Cultural Researcher");
  console.log("=".repeat(60));
  console.log(`Models:    ${MODELS.join(", ")}`);
  console.log(`Contracts: ${CONTRACTS.length}`);
  console.log(`Reps:      ${REPS}`);
  console.log(`Styles:    original (Claude-optimized) vs simplified`);
  console.log(`Calls:     ${totalCalls} model + up to ${totalCalls} judge`);
  console.log("=".repeat(60) + "\n");

  // Phase 1: Model calls
  log(`Phase 1: Running ${totalCalls} model calls...`);
  const p1Start = Date.now();

  const tasks: Promise<void>[] = [];
  for (const contract of CONTRACTS) {
    for (const model of MODELS) {
      for (const style of ["original", "simplified"] as const) {
        const system = style === "original" ? CULTURAL_RESEARCHER_SYSTEM : SIMPLIFIED_CULTURAL_SYSTEM;
        const user = style === "original" ? buildOriginalPrompt(contract) : buildSimplifiedPrompt(contract);
        for (let rep = 0; rep < REPS; rep++) {
          tasks.push(limit(async () => {
            const call = await callModel(model, system, user, CULTURAL_BRIEF_SCHEMA, 4096, 0.8);
            const validation = call.error ? { valid: false, errors: [call.error] } : validate(call.text);
            const shortModel = model.replace(/-20\d{6}/, "").slice(0, 18);
            const status = call.error ? "ERR" : validation.valid ? "OK" : "SCHEMA_FAIL";
            log(`  ${shortModel.padEnd(18)} ${style.padEnd(12)} ${contract.label.slice(0, 15).padEnd(15)} rep${rep + 1} ${status} ${call.durationMs}ms`);
            results.push({
              contractLabel: contract.label, model, promptStyle: style, rep,
              durationMs: call.durationMs, valid: validation.valid, judge: null, error: call.error,
            });
            // Store raw text for judging
            (results[results.length - 1] as any)._text = call.text;
          }));
        }
      }
    }
  }
  await Promise.all(tasks);
  log(`Phase 1 complete: ${results.length} calls in ${((Date.now() - p1Start) / 1000).toFixed(1)}s`);

  // Phase 2: Judge
  const validResults = results.filter(r => r.valid);
  log(`Phase 2: Judging ${validResults.length} valid outputs...`);
  const p2Start = Date.now();
  const judgeTasks = validResults.map(r =>
    limit(async () => {
      const contract = CONTRACTS.find(c => c.label === r.contractLabel)!;
      r.judge = await judgeOutput(r.contractLabel, contract.storyEssence, (r as any)._text);
    })
  );
  await Promise.all(judgeTasks);
  log(`Phase 2 complete in ${((Date.now() - p2Start) / 1000).toFixed(1)}s`);

  // ── Results ──
  const lines: string[] = [
    "=".repeat(70),
    "  PROMPT A/B TEST — RESULTS",
    "=".repeat(70), "",
  ];

  const pad = (s: string, n: number) => s.padEnd(n);
  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  // Per-model comparison
  for (const model of MODELS) {
    const shortModel = model.replace(/-20\d{6}/, "");
    lines.push("─".repeat(70));
    lines.push(`  ${shortModel}`);
    lines.push("─".repeat(70));
    lines.push(pad("Style", 14) + pad("Composite", 11) + pad("Spec", 6) + pad("Fuel", 6) + pad("Surp", 6) + pad("Relv", 6) + pad("Schema%", 9) + pad("Latency", 10));
    lines.push("-".repeat(68));

    for (const style of ["original", "simplified"] as const) {
      const runs = results.filter(r => r.model === model && r.promptStyle === style);
      const scored = runs.filter(r => r.judge);
      const validCount = runs.filter(r => r.valid).length;
      const comp = avg(scored.map(r => r.judge!.composite)).toFixed(2);
      const spec = avg(scored.map(r => r.judge!.specificity)).toFixed(1);
      const fuel = avg(scored.map(r => r.judge!.storyFuel)).toFixed(1);
      const surp = avg(scored.map(r => r.judge!.surprise)).toFixed(1);
      const relv = avg(scored.map(r => r.judge!.relevance)).toFixed(1);
      const schema = runs.length > 0 ? ((validCount / runs.length) * 100).toFixed(0) + "%" : "N/A";
      const lat = runs.filter(r => !r.error).length > 0 ? (avg(runs.filter(r => !r.error).map(r => r.durationMs)) / 1000).toFixed(1) + "s" : "N/A";
      lines.push(pad(style, 14) + pad(comp, 11) + pad(spec, 6) + pad(fuel, 6) + pad(surp, 6) + pad(relv, 6) + pad(schema, 9) + pad(lat, 10));
    }
    lines.push("");
  }

  // Per-contract breakdown
  lines.push("=".repeat(70));
  lines.push("  PER-CONTRACT DELTA (simplified - original composite)");
  lines.push("=".repeat(70));
  lines.push(pad("Contract", 30) + MODELS.map(m => pad(m.replace(/-20\d{6}/, "").slice(0, 12), 14)).join(""));
  lines.push("-".repeat(30 + MODELS.length * 14));

  for (const contract of CONTRACTS) {
    let line = pad(contract.label.slice(0, 28), 30);
    for (const model of MODELS) {
      const origScores = results.filter(r => r.contractLabel === contract.label && r.model === model && r.promptStyle === "original" && r.judge).map(r => r.judge!.composite);
      const simpScores = results.filter(r => r.contractLabel === contract.label && r.model === model && r.promptStyle === "simplified" && r.judge).map(r => r.judge!.composite);
      if (origScores.length > 0 && simpScores.length > 0) {
        const delta = avg(simpScores) - avg(origScores);
        const sign = delta >= 0 ? "+" : "";
        line += pad(`${sign}${delta.toFixed(2)}`, 14);
      } else {
        line += pad("N/A", 14);
      }
    }
    lines.push(line);
  }
  lines.push("");

  // Summary
  const allOrig = results.filter(r => r.promptStyle === "original" && r.judge);
  const allSimp = results.filter(r => r.promptStyle === "simplified" && r.judge);
  lines.push("=".repeat(70));
  lines.push(`  OVERALL: original=${avg(allOrig.map(r => r.judge!.composite)).toFixed(2)} vs simplified=${avg(allSimp.map(r => r.judge!.composite)).toFixed(2)}`);
  lines.push(`  Delta: ${(avg(allSimp.map(r => r.judge!.composite)) - avg(allOrig.map(r => r.judge!.composite)) >= 0 ? "+" : "")}${(avg(allSimp.map(r => r.judge!.composite)) - avg(allOrig.map(r => r.judge!.composite))).toFixed(2)}`);
  lines.push("=".repeat(70));

  // Save
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dir = "./data/blind-tests";
  await mkdir(dir, { recursive: true });
  const reportPath = `${dir}/ab_prompt_report_${ts}.txt`;
  await writeFile(reportPath, lines.join("\n"), "utf-8");

  console.log("\n" + lines.join("\n"));
  console.log(`\nReport: ${reportPath}`);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
