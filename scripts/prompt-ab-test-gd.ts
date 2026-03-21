#!/usr/bin/env tsx
/**
 * PROMPT A/B TEST — Grounding + Divergence
 * ═════════════════════════════════════════
 * Tests original vs simplified prompts for grounding and divergence roles
 * across all 5 competitive models.
 *
 * 5 models × 5 contracts × 2 roles × 2 styles × 3 reps = 300 calls + judge
 */

import "dotenv/config";
import { mkdir, writeFile } from "fs/promises";

import {
  GROUNDING_RESEARCHER_SYSTEM,
  GROUNDING_RESEARCHER_USER_TEMPLATE,
} from "../backend/services/culturalPrompts";
import { GROUNDING_BRIEF_SCHEMA } from "../backend/services/culturalSchemas";
import {
  DIVERGENCE_EXPLORER_SYSTEM,
  DIVERGENCE_EXPLORER_USER_TEMPLATE,
  DIVERGENCE_EXPLORER_SCHEMA,
} from "../backend/services/divergencePrompts";
import { detectProvider, type LLMProvider } from "../shared/modelConfig";

// ── Simplified prompts ──

const SIMPLIFIED_GROUNDING_SYSTEM = `You are a real-world grounding researcher. Given a story description, find real events, institutional dynamics, philosophical frameworks, and cultural patterns that could enrich the story.

RULES:
1. Name specific real-world references — events, cases, studies, institutions, phenomena. Never give vague labels.
2. Each item must explain HOW something works, not just THAT it exists. Describe mechanisms, pressures, contradictions.
3. Produce 2-3 grounding items. Each needs: a named reference, why it's relevant, and concrete narrative fuel a writer can use in a scene.
4. Avoid cliché references (Milgram, Stanford Prison, 1984, Panopticon). Your value is what the creator hasn't thought of.
5. Do not fabricate. If you don't know specifics about a domain, skip it.
6. Also identify the thematic tension — the real-world contradiction this story explores.

Return ONLY valid JSON matching the schema. No markdown.`;

const SIMPLIFIED_GROUNDING_USER = `Find real-world parallels for this story.

STORY: {{STORY_ESSENCE}}
EMOTIONAL CORE: {{EMOTIONAL_CORE}}

CONFIRMED: {{CONFIRMED_ELEMENTS}}
OPEN QUESTIONS: {{OPEN_QUESTIONS}}
NOT THIS: {{NEGATIVE_PROFILE}}

Module: {{MODULE}}, Turn: {{TURN_NUMBER}}

Produce 2-3 grounding items with specific real-world references and concrete narrative fuel. Identify the thematic tension.`;

const SIMPLIFIED_DIVERGENCE_SYSTEM = `You are a creative divergence engine. Given a story's current state, generate radically different directions it could go.

RULES:
1. Generate 8-10 story futures that are as DIFFERENT from each other as possible.
2. Respect confirmed constraints (hard rules). Challenge inferred assumptions (soft guesses).
3. Be SPECIFIC — each future should feel like a concrete story, not a genre label. Use vivid nouns, situations, dynamics.
4. Cover different emotional payoffs, conflict patterns, and power dynamics across your futures.
5. Include 3-4 wild cards the user probably hasn't considered, and 3-4 that lean into their preferences.
6. Cluster futures into 3-5 "direction families" with vivid names. Rate each family's novelty (0-1).
7. Identify the biggest blind spot — the most interesting unexplored direction.
8. Keep each future's sketch and hook to 1-2 sentences. Density over length.

Return ONLY valid JSON matching the schema. No markdown.`;

const SIMPLIFIED_DIVERGENCE_USER = `Explore story possibilities.

SEED: {{SEED_INPUT}}

CONFIRMED CONSTRAINTS (don't violate): {{CONFIRMED_CONSTRAINTS}}
CURRENT DIRECTION: {{CURRENT_STATE}}
ASSUMPTIONS (can challenge): {{INFERRED_ASSUMPTIONS}}
USER PREFERENCES: {{PSYCHOLOGY_SUMMARY}}
PREVIOUS FAMILIES: {{PREVIOUS_FAMILIES}}

Turn: {{TURN_NUMBER}}, Module: {{MODULE}}

Generate 8-10 radically different futures, cluster into 3-5 families, identify the blind spot.`;

// ── Models ──

const MODELS = [
  "gemini-3-flash-preview",
  "claude-haiku-4-5-20251001",
  "grok-4-fast",
  "gpt-5.4-nano",
  "gpt-5.4-mini",
];

const ALL_ROLES = ["grounding", "divergence"] as const;
type Role = (typeof ALL_ROLES)[number];

const JUDGE_MODEL = "claude-sonnet-4-6";
const REPS = 3;
const CONCURRENCY = 6;

// ── Contracts ──

interface ResearchContract {
  label: string; seedInput: string; storyEssence: string; emotionalCore: string;
  confirmedElements: string[]; openQuestions: string[]; userStyleSignals: string[];
  directedReferences: string[]; negativeProfile: string[];
  module: string; turnNumber: number;
  confirmedConstraints: Record<string, string>; currentState: Record<string, unknown>;
  inferredAssumptions: Record<string, string>;
}

const CONTRACTS: ResearchContract[] = [
  {
    label: "Hospital AI Triage",
    seedInput: "A burned-out nurse discovers her hospital's AI triage system is quietly deprioritizing patients who can't pay.",
    storyEssence: "A burned-out nurse discovers algorithmic bias in hospital triage — patients who can't pay are being quietly deprioritized by an AI system. The only person who can help expose it is the engineer who built it: her estranged sister.",
    emotionalCore: "The sick feeling of knowing the system you serve is harming people, combined with the vertigo of needing help from someone who hurt you personally.",
    confirmedElements: ["Contemporary US hospital setting", "AI triage system as central antagonist-mechanism", "Two sisters estranged for years — nurse and engineer", "Tone: grounded thriller with moral complexity"],
    openQuestions: ["What specific mechanism does the AI use to deprioritize?", "Why are the sisters estranged?", "Who benefits from the AI system staying hidden?"],
    userStyleSignals: ["Gravitates toward institutional critique", "Wants moral complexity over clear heroes", "Prefers grounded realism"],
    directedReferences: [], negativeProfile: ["Not a simple whistleblower story", "Not anti-technology"],
    module: "hook", turnNumber: 3,
    confirmedConstraints: { setting: "Contemporary US hospital", tone: "Grounded thriller" },
    currentState: { hook_engine: "algorithmic_bias_discovery", protagonist_role: "nurse_whistleblower" },
    inferredAssumptions: { ending_shape: "ambiguous", sister_dynamic: "reluctant alliance" },
  },
  {
    label: "Sky Eden / Surface Survival",
    seedInput: "There's a super futuristic eden in the sky and the main character and a group of friends are stuck on the surface which is a wasteland.",
    storyEssence: "A vertical class dystopia where a paradise floats above a wasteland. A group of surface-dwellers look up at what they can't have.",
    emotionalCore: "The specific ache of being able to SEE paradise but not touch it. Mixed with fierce loyalty of people who have nothing but each other.",
    confirmedElements: ["Sky Eden: floating utopia", "Surface: wasteland", "Ensemble cast of young friends", "Manga-influenced visual style"],
    openQuestions: ["What keeps the surface dwellers from reaching Eden?", "Is Eden actually paradise or does it have its own rot?"],
    userStyleSignals: ["Loves ensemble dynamics", "Drawn to visual spectacle", "Wants found-family themes"],
    directedReferences: [], negativeProfile: ["Not grimdark — hope matters", "Not a solo hero journey"],
    module: "world", turnNumber: 2,
    confirmedConstraints: { setting: "Vertical dystopia", style: "Manga-influenced" },
    currentState: { world_structure: "sky_eden_surface_wasteland", social_order: "vertical_class_separation" },
    inferredAssumptions: { eden_truth: "Not as perfect as it appears", access_barrier: "Technological/biological" },
  },
  {
    label: "Reincarnated Religious Woman",
    seedInput: "A funny and happy manga-like story about a mean religious fat 50 year old woman who dies and is reincarnated as a cute catgirl.",
    storyEssence: "A judgmental, miserable, deeply religious woman dies and is reincarnated as a cute catgirl in a fantasy world. Comedy of cognitive dissonance.",
    emotionalCore: "The comedy of unwilling transformation — whether someone cruel because they were unhappy can become kind when given a second chance.",
    confirmedElements: ["Comedy-first tone, manga pacing", "Isekai reincarnation as catgirl", "Protagonist retains memories", "Fantasy world is genuinely kind"],
    openQuestions: ["Does she remember her old life immediately or gradually?", "What religious beliefs clash hardest?"],
    userStyleSignals: ["Wants comedy with emotional depth", "Enjoys subversion", "Manga tone"],
    directedReferences: [], negativeProfile: ["Not mean-spirited toward religious people", "Not fanservice-focused"],
    module: "character", turnNumber: 3,
    confirmedConstraints: { tone: "Comedy with heart", genre: "Isekai reincarnation" },
    currentState: { protagonist_psychology: "rigid_judgmental_secretly_lonely", world_tone: "wholesome_fantasy" },
    inferredAssumptions: { arc_direction: "gradual softening", comedy_style: "fish out of water" },
  },
  {
    label: "Sci-Fi Leather BDSM Hellraiser",
    seedInput: "Sci fi, dom leather, hellraiser, erotic, BDSM and lots of foot worship. Gay erotica.",
    storyEssence: "A sci-fi horror-erotica hybrid where BDSM culture has evolved into something ritualistic and quasi-religious in a far-future setting. Hellraiser-influenced.",
    emotionalCore: "The terrifying intimacy of surrendering completely to someone who might be more than human.",
    confirmedElements: ["Far-future sci-fi setting", "Hellraiser-influenced body horror/transcendence", "Gay male characters, explicit erotica", "BDSM as ritual/spiritual practice"],
    openQuestions: ["What is the sci-fi mechanism?", "Is BDSM mainstream or hidden order?"],
    userStyleSignals: ["Unapologetically explicit", "Wants horror and eroticism intertwined", "Visceral sensory detail"],
    directedReferences: ["Hellraiser (Clive Barker)"], negativeProfile: ["Not vanilla romance", "Not shame-based"],
    module: "world", turnNumber: 2,
    confirmedConstraints: { genre: "Sci-fi horror erotica", tone: "Visceral, ritualistic" },
    currentState: { world_type: "far_future_bdsm_civilization", horror_register: "body_transcendence" },
    inferredAssumptions: { society_type: "Order within larger society", protagonist_role: "Initiate or seeker" },
  },
  {
    label: "Jock Sold to Elf Prince",
    seedInput: "A muscular 20 year old jock sold as a slave to the elf prince.",
    storyEssence: "A college-age jock is stripped of his world and sold into servitude to an elf prince. The power inversion is the engine.",
    emotionalCore: "The vertigo of being reduced from someone who mattered to someone who is property.",
    confirmedElements: ["Isekai: modern jock to fantasy realm", "Elf prince as master", "Slavery is institutional", "Gay romance trajectory — slow burn"],
    openQuestions: ["Why was the jock taken?", "What does the prince want from him?"],
    userStyleSignals: ["Drawn to power dynamics", "Likes vulnerability in strong characters", "Fantasy worldbuilding"],
    directedReferences: [], negativeProfile: ["Not non-con apologia", "Not purely comedic"],
    module: "character", turnNumber: 4,
    confirmedConstraints: { protagonist: "Modern jock, 20, muscular", master: "Elf prince" },
    currentState: { character_dynamic: "power_inversion", relationship_arc: "slow_burn_from_ownership" },
    inferredAssumptions: { prince_alignment: "morally complex", freedom_arc: "agency within constraint" },
  },
];

// ── Provider callers ──

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
    return { text: toolBlock ? JSON.stringify(toolBlock.input) : data.content?.[0]?.text ?? "", model, provider: "anthropic", durationMs: Date.now() - start };
  } catch (err: any) {
    return { text: "", model, provider: "anthropic", durationMs: Date.now() - start, error: err.message };
  }
}

async function callGemini(model: string, system: string, user: string, schema: Record<string, unknown>, maxTokens: number, temperature: number): Promise<LLMCallResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { text: "", model, provider: "gemini", durationMs: 0, error: "GEMINI_API_KEY not set" };
  const start = Date.now();
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    const res = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { temperature, maxOutputTokens: maxTokens, responseMimeType: "application/json", responseSchema: stripAdditionalProperties(schema) },
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
  }
}

// ── Prompt builders ──

function buildGroundingOriginal(c: ResearchContract): { system: string; user: string } {
  return {
    system: GROUNDING_RESEARCHER_SYSTEM,
    user: GROUNDING_RESEARCHER_USER_TEMPLATE
      .replace("{{STORY_ESSENCE}}", c.storyEssence).replace("{{EMOTIONAL_CORE}}", c.emotionalCore)
      .replace("{{CONFIRMED_ELEMENTS}}", c.confirmedElements.join("\n")).replace("{{OPEN_QUESTIONS}}", c.openQuestions.join("\n"))
      .replace("{{NEGATIVE_PROFILE}}", c.negativeProfile.join("\n")).replace("{{MODULE}}", c.module).replace("{{TURN_NUMBER}}", String(c.turnNumber)),
  };
}

function buildGroundingSimplified(c: ResearchContract): { system: string; user: string } {
  return {
    system: SIMPLIFIED_GROUNDING_SYSTEM,
    user: SIMPLIFIED_GROUNDING_USER
      .replace("{{STORY_ESSENCE}}", c.storyEssence).replace("{{EMOTIONAL_CORE}}", c.emotionalCore)
      .replace("{{CONFIRMED_ELEMENTS}}", c.confirmedElements.join("\n")).replace("{{OPEN_QUESTIONS}}", c.openQuestions.join("\n"))
      .replace("{{NEGATIVE_PROFILE}}", c.negativeProfile.join("\n")).replace("{{MODULE}}", c.module).replace("{{TURN_NUMBER}}", String(c.turnNumber)),
  };
}

function buildDivergenceOriginal(c: ResearchContract): { system: string; user: string } {
  const constraints = Object.entries(c.confirmedConstraints).map(([k, v]) => `${k}: ${v}`).join("\n") || "(none)";
  const assumptions = Object.entries(c.inferredAssumptions).map(([k, v]) => `${k}: ${v}`).join("\n") || "(none)";
  return {
    system: DIVERGENCE_EXPLORER_SYSTEM,
    user: DIVERGENCE_EXPLORER_USER_TEMPLATE
      .replace("{{SEED_INPUT}}", c.seedInput).replace("{{CONFIRMED_CONSTRAINTS}}", constraints)
      .replace("{{CURRENT_STATE}}", JSON.stringify(c.currentState, null, 2))
      .replace("{{INFERRED_ASSUMPTIONS}}", assumptions)
      .replace("{{PSYCHOLOGY_SUMMARY}}", c.userStyleSignals.join("; ") || "(none)")
      .replace("{{ACCUMULATED_INSIGHTS}}", "").replace("{{PREVIOUS_FAMILIES}}", "(none — first exploration)")
      .replace("{{TURN_NUMBER}}", String(c.turnNumber)).replace("{{MODULE}}", c.module),
  };
}

function buildDivergenceSimplified(c: ResearchContract): { system: string; user: string } {
  const constraints = Object.entries(c.confirmedConstraints).map(([k, v]) => `${k}: ${v}`).join("\n") || "(none)";
  const assumptions = Object.entries(c.inferredAssumptions).map(([k, v]) => `${k}: ${v}`).join("\n") || "(none)";
  return {
    system: SIMPLIFIED_DIVERGENCE_SYSTEM,
    user: SIMPLIFIED_DIVERGENCE_USER
      .replace("{{SEED_INPUT}}", c.seedInput).replace("{{CONFIRMED_CONSTRAINTS}}", constraints)
      .replace("{{CURRENT_STATE}}", JSON.stringify(c.currentState, null, 2))
      .replace("{{INFERRED_ASSUMPTIONS}}", assumptions)
      .replace("{{PSYCHOLOGY_SUMMARY}}", c.userStyleSignals.join("; ") || "(none)")
      .replace("{{PREVIOUS_FAMILIES}}", "(none — first exploration)")
      .replace("{{TURN_NUMBER}}", String(c.turnNumber)).replace("{{MODULE}}", c.module),
  };
}

// ── Role configs ──

interface RoleConfig {
  schema: Record<string, unknown>;
  maxTokens: number;
  temperature: number;
  requiredFields: string[];
  buildOriginal: (c: ResearchContract) => { system: string; user: string };
  buildSimplified: (c: ResearchContract) => { system: string; user: string };
}

const ROLE_CONFIGS: Record<Role, RoleConfig> = {
  grounding: {
    schema: GROUNDING_BRIEF_SCHEMA, maxTokens: 2048, temperature: 0.7,
    requiredFields: ["groundingItems"],
    buildOriginal: buildGroundingOriginal, buildSimplified: buildGroundingSimplified,
  },
  divergence: {
    schema: DIVERGENCE_EXPLORER_SCHEMA, maxTokens: 4096, temperature: 0.9,
    requiredFields: ["families", "blindSpot", "convergenceNote"],
    buildOriginal: buildDivergenceOriginal, buildSimplified: buildDivergenceSimplified,
  },
};

// ── Validation ──

function validate(raw: string, role: Role): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  let parsed: any;
  try { parsed = JSON.parse(raw); } catch { return { valid: false, errors: ["Invalid JSON"] }; }
  for (const f of ROLE_CONFIGS[role].requiredFields) {
    if (parsed[f] === undefined || parsed[f] === null) errors.push(`Missing: ${f}`);
  }
  if (role === "grounding") {
    const items = parsed.groundingItems ?? [];
    if (!Array.isArray(items) || items.length === 0) errors.push("No grounding items");
  } else if (role === "divergence") {
    const fams = parsed.families ?? [];
    if (!Array.isArray(fams) || fams.length === 0) errors.push("No families");
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

async function judgeOutput(role: string, contractLabel: string, storyEssence: string, outputText: string): Promise<JudgeScores | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: JUDGE_MODEL, max_tokens: 300, temperature: 0, system: JUDGE_SYSTEM,
        messages: [{ role: "user", content: `Score this ${role} research for "${contractLabel}".\n\nSTORY: ${storyEssence}\n\nOUTPUT:\n${outputText.slice(0, 6000)}` }],
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

// ── Concurrency ──

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
  contractLabel: string; model: string; role: Role; promptStyle: "original" | "simplified";
  rep: number; durationMs: number; valid: boolean; judge: JudgeScores | null; error?: string;
}

async function main() {
  const limit = createLimiter(CONCURRENCY);
  const results: RunResult[] = [];
  const totalCalls = MODELS.length * CONTRACTS.length * ALL_ROLES.length * 2 * REPS;

  console.log("\n" + "=".repeat(60));
  console.log("  PROMPT A/B TEST — Grounding + Divergence");
  console.log("=".repeat(60));
  console.log(`Models:    ${MODELS.join(", ")}`);
  console.log(`Roles:     ${ALL_ROLES.join(", ")}`);
  console.log(`Contracts: ${CONTRACTS.length}`);
  console.log(`Reps:      ${REPS}`);
  console.log(`Calls:     ${totalCalls} model + up to ${totalCalls} judge`);
  console.log("=".repeat(60) + "\n");

  log(`Phase 1: Running ${totalCalls} model calls...`);
  const p1Start = Date.now();

  const tasks: Promise<void>[] = [];
  for (const contract of CONTRACTS) {
    for (const role of ALL_ROLES) {
      const config = ROLE_CONFIGS[role];
      for (const model of MODELS) {
        for (const style of ["original", "simplified"] as const) {
          const { system, user } = style === "original" ? config.buildOriginal(contract) : config.buildSimplified(contract);
          for (let rep = 0; rep < REPS; rep++) {
            tasks.push(limit(async () => {
              const call = await callModel(model, system, user, config.schema, config.maxTokens, config.temperature);
              const validation = call.error ? { valid: false, errors: [call.error] } : validate(call.text, role);
              const shortModel = model.replace(/-20\d{6}/, "").slice(0, 18);
              const status = call.error ? "ERR" : validation.valid ? "OK" : "SCHEMA_FAIL";
              log(`  ${shortModel.padEnd(18)} ${role.padEnd(11)} ${style.padEnd(12)} ${contract.label.slice(0, 15).padEnd(15)} rep${rep + 1} ${status} ${call.durationMs}ms`);
              results.push({
                contractLabel: contract.label, model, role, promptStyle: style, rep,
                durationMs: call.durationMs, valid: validation.valid, judge: null, error: call.error,
              });
              (results[results.length - 1] as any)._text = call.text;
            }));
          }
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
  await Promise.all(validResults.map(r =>
    limit(async () => {
      const contract = CONTRACTS.find(c => c.label === r.contractLabel)!;
      r.judge = await judgeOutput(r.role, r.contractLabel, contract.storyEssence, (r as any)._text);
    })
  ));
  log(`Phase 2 complete in ${((Date.now() - p2Start) / 1000).toFixed(1)}s`);

  // ── Results ──
  const lines: string[] = [
    "=".repeat(70),
    "  PROMPT A/B TEST — Grounding + Divergence RESULTS",
    "=".repeat(70), "",
  ];

  const pad = (s: string, n: number) => s.padEnd(n);
  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  for (const role of ALL_ROLES) {
    lines.push("═".repeat(70));
    lines.push(`  ${role.toUpperCase()}`);
    lines.push("═".repeat(70));

    for (const model of MODELS) {
      const shortModel = model.replace(/-20\d{6}/, "");
      lines.push(`\n  ${shortModel}`);
      lines.push(pad("  Style", 16) + pad("Composite", 11) + pad("Spec", 6) + pad("Fuel", 6) + pad("Surp", 6) + pad("Relv", 6) + pad("Schema%", 9) + pad("Latency", 10));
      lines.push("  " + "-".repeat(66));

      for (const style of ["original", "simplified"] as const) {
        const runs = results.filter(r => r.model === model && r.role === role && r.promptStyle === style);
        const scored = runs.filter(r => r.judge);
        const validCount = runs.filter(r => r.valid).length;
        const comp = avg(scored.map(r => r.judge!.composite)).toFixed(2);
        const spec = avg(scored.map(r => r.judge!.specificity)).toFixed(1);
        const fuel = avg(scored.map(r => r.judge!.storyFuel)).toFixed(1);
        const surp = avg(scored.map(r => r.judge!.surprise)).toFixed(1);
        const relv = avg(scored.map(r => r.judge!.relevance)).toFixed(1);
        const schema = runs.length > 0 ? ((validCount / runs.length) * 100).toFixed(0) + "%" : "N/A";
        const lat = runs.filter(r => !r.error).length > 0 ? (avg(runs.filter(r => !r.error).map(r => r.durationMs)) / 1000).toFixed(1) + "s" : "N/A";
        lines.push(pad("  " + style, 16) + pad(comp, 11) + pad(spec, 6) + pad(fuel, 6) + pad(surp, 6) + pad(relv, 6) + pad(schema, 9) + pad(lat, 10));
      }
    }
    lines.push("");
  }

  // Summary deltas
  lines.push("=".repeat(70));
  lines.push("  DELTA SUMMARY (simplified - original)");
  lines.push("=".repeat(70));
  lines.push(pad("Model", 28) + pad("Grounding", 14) + pad("Divergence", 14));
  lines.push("-".repeat(56));
  for (const model of MODELS) {
    const shortModel = model.replace(/-20\d{6}/, "");
    let line = pad(shortModel, 28);
    for (const role of ALL_ROLES) {
      const orig = results.filter(r => r.model === model && r.role === role && r.promptStyle === "original" && r.judge);
      const simp = results.filter(r => r.model === model && r.role === role && r.promptStyle === "simplified" && r.judge);
      if (orig.length > 0 && simp.length > 0) {
        const delta = avg(simp.map(r => r.judge!.composite)) - avg(orig.map(r => r.judge!.composite));
        line += pad(`${delta >= 0 ? "+" : ""}${delta.toFixed(2)}`, 14);
      } else {
        line += pad("N/A", 14);
      }
    }
    lines.push(line);
  }

  // Overall
  const allOrigG = results.filter(r => r.role === "grounding" && r.promptStyle === "original" && r.judge);
  const allSimpG = results.filter(r => r.role === "grounding" && r.promptStyle === "simplified" && r.judge);
  const allOrigD = results.filter(r => r.role === "divergence" && r.promptStyle === "original" && r.judge);
  const allSimpD = results.filter(r => r.role === "divergence" && r.promptStyle === "simplified" && r.judge);
  lines.push("");
  lines.push(`Grounding overall:  original=${avg(allOrigG.map(r => r.judge!.composite)).toFixed(2)} vs simplified=${avg(allSimpG.map(r => r.judge!.composite)).toFixed(2)} (delta: ${(avg(allSimpG.map(r => r.judge!.composite)) - avg(allOrigG.map(r => r.judge!.composite))).toFixed(2)})`);
  lines.push(`Divergence overall: original=${avg(allOrigD.map(r => r.judge!.composite)).toFixed(2)} vs simplified=${avg(allSimpD.map(r => r.judge!.composite)).toFixed(2)} (delta: ${(avg(allSimpD.map(r => r.judge!.composite)) - avg(allOrigD.map(r => r.judge!.composite))).toFixed(2)})`);

  // Save
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dir = "./data/blind-tests";
  await mkdir(dir, { recursive: true });
  const reportPath = `${dir}/ab_gd_report_${ts}.txt`;
  await writeFile(reportPath, lines.join("\n"), "utf-8");

  console.log("\n" + lines.join("\n"));
  console.log(`\nReport: ${reportPath}`);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
