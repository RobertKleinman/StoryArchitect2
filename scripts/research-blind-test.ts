#!/usr/bin/env tsx
/**
 * RESEARCH MODEL COMPARISON v2
 * ════════════════════════════
 * Runs ResearchContracts through multiple LLM models, validates schema,
 * scores outputs with an LLM judge (Sonnet), and presents ranked results.
 *
 * v2 improvements over v1:
 *   - 4 models instead of 2
 *   - 3 replications per contract/role/model (controls for temperature variance)
 *   - Schema compliance as hard gate (fail = 0 score)
 *   - LLM-as-judge (Sonnet) with structured rubric
 *   - Results as ranked summary table, not wall of text
 *
 * Usage:
 *   npx tsx scripts/research-blind-test.ts
 *   npx tsx scripts/research-blind-test.ts --models claude-haiku-4-5-20251001,gemini-3-flash-preview
 *   npx tsx scripts/research-blind-test.ts --contracts 3
 *   npx tsx scripts/research-blind-test.ts --roles cultural,grounding
 *   npx tsx scripts/research-blind-test.ts --reps 1          # quick mode
 *   npx tsx scripts/research-blind-test.ts --skip-judge       # skip Sonnet scoring
 *   npx tsx scripts/research-blind-test.ts --concurrency 4    # max parallel calls
 */

import "dotenv/config";
import { mkdir, writeFile } from "fs/promises";

import {
  CULTURAL_RESEARCHER_SYSTEM,
  CULTURAL_RESEARCHER_USER_TEMPLATE,
  GROUNDING_RESEARCHER_SYSTEM,
  GROUNDING_RESEARCHER_USER_TEMPLATE,
} from "../backend/services/culturalPrompts";
import {
  CULTURAL_BRIEF_SCHEMA,
  GROUNDING_BRIEF_SCHEMA,
} from "../backend/services/culturalSchemas";
import {
  DIVERGENCE_EXPLORER_SYSTEM,
  DIVERGENCE_EXPLORER_USER_TEMPLATE,
  DIVERGENCE_EXPLORER_SCHEMA,
} from "../backend/services/divergencePrompts";
import { detectProvider, type LLMProvider } from "../shared/modelConfig";

// ── Config ──

const MODELS_DEFAULT = [
  "claude-haiku-4-5-20251001",
  "gemini-3-flash-preview",
  "grok-4-fast",
  "grok-4-1-fast-reasoning",
];
const ALL_ROLES = ["cultural", "grounding", "divergence"] as const;
type Role = (typeof ALL_ROLES)[number];
const JUDGE_MODEL = "claude-sonnet-4-6";
const REPS_DEFAULT = 3;
const CONCURRENCY_DEFAULT = 6;

// ── Arg parsing ──

function parseArgs() {
  const args = process.argv.slice(2);
  let models = MODELS_DEFAULT;
  let maxContracts = Infinity;
  let roles: Role[] = [...ALL_ROLES];
  let reps = REPS_DEFAULT;
  let skipJudge = false;
  let concurrency = CONCURRENCY_DEFAULT;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--models": models = args[++i].split(","); break;
      case "--contracts": maxContracts = parseInt(args[++i], 10); break;
      case "--roles": roles = args[++i].split(",") as Role[]; break;
      case "--reps": reps = parseInt(args[++i], 10); break;
      case "--skip-judge": skipJudge = true; break;
      case "--concurrency": concurrency = parseInt(args[++i], 10); break;
    }
  }
  return { models, maxContracts, roles, reps, skipJudge, concurrency };
}

// ── Research Contracts ──

interface ResearchContract {
  label: string;
  storyEssence: string;
  emotionalCore: string;
  confirmedElements: string[];
  openQuestions: string[];
  userStyleSignals: string[];
  directedReferences: string[];
  negativeProfile: string[];
  seedInput: string;
  module: "hook" | "character" | "world" | "plot";
  turnNumber: number;
  confirmedConstraints: Record<string, string>;
  currentState: Record<string, unknown>;
  inferredAssumptions: Record<string, string>;
}

const CONTRACTS: ResearchContract[] = [
  {
    label: "Hospital AI Triage",
    seedInput: "A burned-out nurse discovers her hospital's AI triage system is quietly deprioritizing patients who can't pay, and the only person who can help her prove it is the engineer who built it — her estranged sister.",
    storyEssence: "A burned-out nurse discovers algorithmic bias in hospital triage — patients who can't pay are being quietly deprioritized by an AI system. The only person who can help expose it is the engineer who built it: her estranged sister. The story turns on whether institutional loyalty or family loyalty wins when both are weapons.",
    emotionalCore: "The sick feeling of knowing the system you serve is harming people, combined with the vertigo of needing help from someone who hurt you personally. Not righteous anger — exhausted complicity.",
    confirmedElements: ["Contemporary US hospital setting", "AI triage system as central antagonist-mechanism", "Two sisters estranged for years — nurse and engineer", "Tone: grounded thriller with moral complexity, not polemical"],
    openQuestions: ["What specific mechanism does the AI use to deprioritize?", "Why are the sisters estranged?", "Who benefits from the AI system staying hidden?", "Does the nurse have allies inside the hospital?"],
    userStyleSignals: ["Gravitates toward institutional critique", "Wants moral complexity over clear heroes", "Prefers grounded realism"],
    directedReferences: [],
    negativeProfile: ["Not a simple whistleblower story", "Not anti-technology", "Not a courtroom drama"],
    module: "hook", turnNumber: 3,
    confirmedConstraints: { setting: "Contemporary US hospital", tone: "Grounded thriller" },
    currentState: { hook_engine: "algorithmic_bias_discovery", protagonist_role: "nurse_whistleblower", antagonist_form: "institutional_system" },
    inferredAssumptions: { ending_shape: "ambiguous", sister_dynamic: "reluctant alliance" },
  },
  {
    label: "Sky Eden / Surface Survival",
    seedInput: "There's a super futuristic eden in the sky and the main character and a group of friends are stuck on the surface which is a wasteland.",
    storyEssence: "A vertical class dystopia where a paradise floats above a wasteland. A group of surface-dwellers — young, resourceful, bonded by survival — look up at what they can't have. The story is about whether reaching the sky means becoming what you hate.",
    emotionalCore: "The specific ache of being able to SEE paradise but not touch it. Not abstract class anger — the daily, grinding humiliation of being visibly beneath. Mixed with the fierce loyalty of people who have nothing but each other.",
    confirmedElements: ["Sky Eden: floating utopia, advanced tech", "Surface: wasteland, scavenging economy", "Ensemble cast of young friends", "Manga-influenced visual style"],
    openQuestions: ["What keeps the surface dwellers from reaching Eden?", "Is Eden actually paradise or does it have its own rot?", "What event triggers the ascent attempt?", "Are there allies in Eden?"],
    userStyleSignals: ["Loves ensemble dynamics", "Drawn to visual spectacle", "Wants found-family themes", "Manga/anime aesthetics"],
    directedReferences: [],
    negativeProfile: ["Not grimdark — hope matters", "Not a solo hero journey"],
    module: "world", turnNumber: 2,
    confirmedConstraints: { setting: "Vertical dystopia", style: "Manga-influenced" },
    currentState: { world_structure: "sky_eden_surface_wasteland", social_order: "vertical_class_separation" },
    inferredAssumptions: { eden_truth: "Not as perfect as it appears", access_barrier: "Technological/biological" },
  },
  {
    label: "Reincarnated Religious Woman",
    seedInput: "A funny and happy manga-like story about a mean and miserable and very religious fat 50 year old woman who dies and is reincarnated as a cute catgirl in a fantasy world.",
    storyEssence: "A judgmental, miserable, deeply religious woman dies and is reincarnated as the thing she would have despised most — a cute catgirl in a fantasy world. Comedy of cognitive dissonance: her rigid worldview colliding with a body and world that violate every rule she ever held sacred.",
    emotionalCore: "The comedy of unwilling transformation — laughing at rigidity dissolving. Underneath: whether someone cruel because they were unhappy can become kind when given a second chance in a body that invites affection.",
    confirmedElements: ["Comedy-first tone, manga pacing", "Isekai reincarnation as catgirl", "Protagonist retains memories", "Fantasy world is genuinely kind"],
    openQuestions: ["Does she remember her old life immediately or gradually?", "What religious beliefs clash hardest?", "Is there a straight-man character?", "Does she soften or stay rigid?"],
    userStyleSignals: ["Wants comedy with emotional depth", "Enjoys subversion", "Manga tone", "Interested in character growth beneath humor"],
    directedReferences: [],
    negativeProfile: ["Not mean-spirited toward religious people", "Not fanservice-focused", "Not edgy dark comedy"],
    module: "character", turnNumber: 3,
    confirmedConstraints: { tone: "Comedy with heart", genre: "Isekai reincarnation" },
    currentState: { protagonist_psychology: "rigid_judgmental_secretly_lonely", world_tone: "wholesome_fantasy" },
    inferredAssumptions: { arc_direction: "gradual softening", comedy_style: "fish out of water" },
  },
  {
    label: "Sci-Fi Leather BDSM Hellraiser",
    seedInput: "Sci fi, dom leather, hellraiser, erotic, BDSM and lots of foot worship. Gay erotica.",
    storyEssence: "A sci-fi horror-erotica hybrid where BDSM culture has evolved into something ritualistic and quasi-religious in a far-future setting. Hellraiser-influenced: the line between pain and transcendence is the story's central axis.",
    emotionalCore: "The terrifying intimacy of surrendering completely to someone who might be more than human. The genuine spiritual vertigo of consent pushed to its absolute limit.",
    confirmedElements: ["Far-future sci-fi setting", "Hellraiser-influenced body horror/transcendence", "Gay male characters, explicit erotica", "BDSM as ritual/spiritual practice", "Leather subculture elevated to civilization-level"],
    openQuestions: ["What is the sci-fi mechanism?", "Is BDSM mainstream or hidden order?", "What draws the protagonist in?", "Where is the horror line?"],
    userStyleSignals: ["Unapologetically explicit", "Wants horror and eroticism intertwined", "Subculture as worldbuilding", "Visceral sensory detail"],
    directedReferences: ["Hellraiser (Clive Barker)", "Leather subculture codes"],
    negativeProfile: ["Not vanilla romance", "Not shame-based", "Not comedy"],
    module: "world", turnNumber: 2,
    confirmedConstraints: { genre: "Sci-fi horror erotica", tone: "Visceral, ritualistic" },
    currentState: { world_type: "far_future_bdsm_civilization", horror_register: "body_transcendence" },
    inferredAssumptions: { society_type: "Order within larger society", protagonist_role: "Initiate or seeker" },
  },
  {
    label: "Jock Sold to Elf Prince",
    seedInput: "A muscular 20 year old jock sold as a slave to the elf prince.",
    storyEssence: "A college-age jock is stripped of his world and sold into servitude to an elf prince. The power inversion is the engine: everything that made him dominant is worthless here. The elf prince holds absolute power but may not be the villain.",
    emotionalCore: "The vertigo of being reduced from someone who mattered to someone who is property. The discovery that your entire identity was built on a status hierarchy that no longer exists.",
    confirmedElements: ["Isekai: modern jock to fantasy realm", "Elf prince as master", "Slavery is institutional", "Gay romance trajectory — slow burn"],
    openQuestions: ["Why was the jock taken?", "What does the prince want from him?", "Path to freedom or agency within constraint?", "How does physicality matter in a magic world?"],
    userStyleSignals: ["Drawn to power dynamics", "Likes vulnerability in strong characters", "Emotional complexity in erotic scenarios", "Fantasy worldbuilding"],
    directedReferences: [],
    negativeProfile: ["Not non-con apologia", "Not purely comedic", "Not a simple rescue arc"],
    module: "character", turnNumber: 4,
    confirmedConstraints: { protagonist: "Modern jock, 20, muscular", master: "Elf prince" },
    currentState: { character_dynamic: "power_inversion", relationship_arc: "slow_burn_from_ownership" },
    inferredAssumptions: { prince_alignment: "morally complex", freedom_arc: "agency within constraint" },
  },
];

// ── Provider API callers ──

interface LLMCallResult {
  text: string;
  model: string;
  provider: LLMProvider;
  durationMs: number;
  error?: string;
}

/** Recursively strip `additionalProperties` — Gemini API rejects it */
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

/** Recursively ensure all object `properties` keys are in `required` — OpenAI strict mode demands it */
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

async function callAnthropic(
  model: string, system: string, user: string, schema: Record<string, unknown>, maxTokens: number, temperature: number,
): Promise<LLMCallResult> {
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

async function callGemini(
  model: string, system: string, user: string, schema: Record<string, unknown>, maxTokens: number, temperature: number,
): Promise<LLMCallResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { text: "", model, provider: "gemini", durationMs: 0, error: "GEMINI_API_KEY not set" };
  const start = Date.now();
  try {
    const cleanSchema = stripAdditionalProperties(schema);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { temperature, maxOutputTokens: maxTokens, responseMimeType: "application/json", responseSchema: cleanSchema },
      }),
    });
    const data = await res.json() as any;
    if (data.error) throw new Error(JSON.stringify(data.error));
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    return { text, model, provider: "gemini", durationMs: Date.now() - start };
  } catch (err: any) {
    return { text: "", model, provider: "gemini", durationMs: Date.now() - start, error: err.message };
  }
}

async function callOpenAICompatible(
  model: string, provider: "openai" | "grok", system: string, user: string,
  schema: Record<string, unknown>, maxTokens: number, temperature: number,
): Promise<LLMCallResult> {
  const envKey = provider === "grok" ? "GROK_API_KEY" : "OPENAI_API_KEY";
  const baseUrl = provider === "grok" ? "https://api.x.ai/v1" : "https://api.openai.com/v1";
  const key = process.env[envKey];
  if (!key) return { text: "", model, provider, durationMs: 0, error: `${envKey} not set` };
  const start = Date.now();
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
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
    const text = data.choices?.[0]?.message?.content ?? "";
    return { text, model, provider, durationMs: Date.now() - start };
  } catch (err: any) {
    return { text: "", model, provider, durationMs: Date.now() - start, error: err.message };
  }
}

async function callModel(
  model: string, system: string, user: string, schema: Record<string, unknown>, maxTokens: number, temperature: number,
): Promise<LLMCallResult> {
  const provider = detectProvider(model);
  switch (provider) {
    case "anthropic": return callAnthropic(model, system, user, schema, maxTokens, temperature);
    case "gemini": return callGemini(model, system, user, schema, maxTokens, temperature);
    case "openai":
    case "grok": return callOpenAICompatible(model, provider, system, user, schema, maxTokens, temperature);
  }
}

// ── Build prompts ──

function buildCulturalPrompt(c: ResearchContract): string {
  return CULTURAL_RESEARCHER_USER_TEMPLATE
    .replace("{{STORY_ESSENCE}}", c.storyEssence).replace("{{EMOTIONAL_CORE}}", c.emotionalCore)
    .replace("{{CONFIRMED_ELEMENTS}}", c.confirmedElements.join("\n") || "(none)")
    .replace("{{OPEN_QUESTIONS}}", c.openQuestions.join("\n") || "(none)")
    .replace("{{USER_STYLE_SIGNALS}}", c.userStyleSignals.join("\n") || "(none)")
    .replace("{{DIRECTED_REFERENCES}}", c.directedReferences.join("\n") || "(none)")
    .replace("{{NEGATIVE_PROFILE}}", c.negativeProfile.join("\n") || "(none)")
    .replace("{{MODULE}}", c.module).replace("{{TURN_NUMBER}}", String(c.turnNumber));
}

function buildGroundingPrompt(c: ResearchContract): string {
  return GROUNDING_RESEARCHER_USER_TEMPLATE
    .replace("{{STORY_ESSENCE}}", c.storyEssence).replace("{{EMOTIONAL_CORE}}", c.emotionalCore)
    .replace("{{CONFIRMED_ELEMENTS}}", c.confirmedElements.join("\n") || "(none)")
    .replace("{{OPEN_QUESTIONS}}", c.openQuestions.join("\n") || "(none)")
    .replace("{{NEGATIVE_PROFILE}}", c.negativeProfile.join("\n") || "(none)")
    .replace("{{MODULE}}", c.module).replace("{{TURN_NUMBER}}", String(c.turnNumber));
}

function buildDivergencePrompt(c: ResearchContract): string {
  const constraints = Object.entries(c.confirmedConstraints).map(([k, v]) => `${k}: ${v}`).join("\n") || "(none)";
  const assumptions = Object.entries(c.inferredAssumptions).map(([k, v]) => `${k}: ${v}`).join("\n") || "(none)";
  return DIVERGENCE_EXPLORER_USER_TEMPLATE
    .replace("{{SEED_INPUT}}", c.seedInput).replace("{{CONFIRMED_CONSTRAINTS}}", constraints)
    .replace("{{CURRENT_STATE}}", JSON.stringify(c.currentState, null, 2))
    .replace("{{INFERRED_ASSUMPTIONS}}", assumptions)
    .replace("{{PSYCHOLOGY_SUMMARY}}", c.userStyleSignals.join("; ") || "(none)")
    .replace("{{ACCUMULATED_INSIGHTS}}", "").replace("{{PREVIOUS_FAMILIES}}", "(none — first exploration)")
    .replace("{{TURN_NUMBER}}", String(c.turnNumber)).replace("{{MODULE}}", c.module);
}

// ── Role configs ──

interface RoleConfig {
  system: string;
  buildPrompt: (c: ResearchContract) => string;
  schema: Record<string, unknown>;
  maxTokens: number;
  temperature: number;
  requiredFields: string[]; // top-level fields required for schema compliance
}

const ROLE_CONFIGS: Record<Role, RoleConfig> = {
  cultural: {
    system: CULTURAL_RESEARCHER_SYSTEM, buildPrompt: buildCulturalPrompt,
    schema: CULTURAL_BRIEF_SCHEMA, maxTokens: 4096, temperature: 0.8,
    requiredFields: ["evidenceItems", "searchDimensions", "creativeApplications", "proposals"],
  },
  grounding: {
    system: GROUNDING_RESEARCHER_SYSTEM, buildPrompt: buildGroundingPrompt,
    schema: GROUNDING_BRIEF_SCHEMA, maxTokens: 2048, temperature: 0.7,
    requiredFields: ["groundingItems"],
  },
  divergence: {
    system: DIVERGENCE_EXPLORER_SYSTEM, buildPrompt: buildDivergencePrompt,
    schema: DIVERGENCE_EXPLORER_SCHEMA, maxTokens: 4096, temperature: 0.9,
    requiredFields: ["families", "blindSpot", "convergenceNote"],
  },
};

// ── Schema validation ──

interface ValidationResult {
  valid: boolean;
  parsed: any;
  errors: string[];
}

function validateOutput(raw: string, role: Role): ValidationResult {
  const config = ROLE_CONFIGS[role];
  const errors: string[] = [];

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { valid: false, parsed: null, errors: ["Invalid JSON"] };
  }

  for (const field of config.requiredFields) {
    if (parsed[field] === undefined || parsed[field] === null) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Role-specific checks
  if (role === "cultural") {
    const items = parsed.evidenceItems ?? [];
    if (!Array.isArray(items) || items.length === 0) errors.push("No evidence items");
    for (let i = 0; i < items.length; i++) {
      if (!items[i].claim || !items[i].specificDetail) errors.push(`Evidence item ${i}: missing claim or specificDetail`);
    }
  } else if (role === "grounding") {
    const items = parsed.groundingItems ?? [];
    if (!Array.isArray(items) || items.length === 0) errors.push("No grounding items");
    for (let i = 0; i < items.length; i++) {
      if (!items[i].reference || !items[i].narrative_fuel) errors.push(`Grounding item ${i}: missing reference or narrative_fuel`);
    }
  } else if (role === "divergence") {
    const fams = parsed.families ?? [];
    if (!Array.isArray(fams) || fams.length === 0) errors.push("No families");
    for (let i = 0; i < fams.length; i++) {
      if (!fams[i].name || !Array.isArray(fams[i].futures) || fams[i].futures.length === 0) {
        errors.push(`Family ${i}: missing name or futures`);
      }
    }
    if (!parsed.blindSpot || parsed.blindSpot === "undefined") errors.push("Missing or invalid blindSpot");
    if (!parsed.convergenceNote || parsed.convergenceNote === "undefined") errors.push("Missing or invalid convergenceNote");
  }

  return { valid: errors.length === 0, parsed, errors };
}

// ── LLM Judge ──

interface JudgeScores {
  specificity: number;    // 1-5
  storyFuel: number;      // 1-5
  surprise: number;       // 1-5
  relevance: number;      // 1-5
  composite: number;      // average
  reasoning: string;
}

const JUDGE_SYSTEM = `You are a quality evaluator for a story creation engine's research outputs. You score outputs on a structured rubric. Be honest and calibrated — a 3 is average, 5 is exceptional, 1 is useless.

SCORING RUBRIC:
- specificity (1-5): Does it name concrete mechanisms, real references, and specific details? Or is it vague labels and abstractions? 5 = every item has a named mechanism or concrete detail. 1 = generic statements only.
- storyFuel (1-5): Could a writer use this to write a scene WITHOUT further research? 5 = scene-ready details, pressures, contradictions. 1 = needs extensive additional research to be useful.
- surprise (1-5): Would the creator have thought of this without the engine? 5 = genuinely unexpected connections. 1 = obvious first-google-result level.
- relevance (1-5): Does it connect to THIS specific story, not generic themes? 5 = every item clearly maps to specific story elements. 1 = could apply to any story.

Return ONLY valid JSON: {"specificity": N, "storyFuel": N, "surprise": N, "relevance": N, "reasoning": "1-2 sentences explaining your scores"}`;

async function judgeOutput(role: Role, contractLabel: string, storyEssence: string, outputText: string): Promise<JudgeScores | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;

  const prompt = `Score this ${role} research output for the story "${contractLabel}".

STORY ESSENCE: ${storyEssence}

OUTPUT TO SCORE:
${outputText.slice(0, 6000)}

Score on the rubric (specificity, storyFuel, surprise, relevance — each 1-5). Respond in JSON only.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: JUDGE_MODEL, max_tokens: 300, temperature: 0,
        system: JUDGE_SYSTEM,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await res.json() as any;
    if (data.error) return null;
    const raw = data.content?.[0]?.text ?? "";
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    const composite = (parsed.specificity + parsed.storyFuel + parsed.surprise + parsed.relevance) / 4;
    return { ...parsed, composite: Math.round(composite * 100) / 100 };
  } catch {
    return null;
  }
}

// ── Concurrency limiter ──

function createLimiter(max: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async function<T>(fn: () => Promise<T>): Promise<T> {
    while (active >= max) {
      await new Promise<void>(resolve => queue.push(resolve));
    }
    active++;
    try {
      return await fn();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}

// ── Logging ──

function log(msg: string) {
  const time = new Date().toISOString().slice(11, 19);
  console.log(`[${time}] ${msg}`);
}

// ── Result types ──

interface RunResult {
  contractLabel: string;
  role: Role;
  model: string;
  rep: number;
  call: LLMCallResult;
  validation: ValidationResult;
  judge: JudgeScores | null;
}

// ── Main ──

async function main() {
  const { models, maxContracts, roles, reps, skipJudge, concurrency } = parseArgs();
  const contracts = CONTRACTS.slice(0, maxContracts);
  const totalCalls = contracts.length * roles.length * models.length * reps;
  const totalJudge = skipJudge ? 0 : totalCalls;

  console.log("\n" + "=".repeat(60));
  console.log("  RESEARCH MODEL COMPARISON v2");
  console.log("=".repeat(60));
  console.log(`Models:      ${models.join(", ")}`);
  console.log(`Roles:       ${roles.join(", ")}`);
  console.log(`Contracts:   ${contracts.length}`);
  console.log(`Reps:        ${reps}`);
  console.log(`Concurrency: ${concurrency}`);
  console.log(`Test calls:  ${totalCalls}`);
  console.log(`Judge calls: ${totalJudge}`);
  console.log(`Total calls: ${totalCalls + totalJudge}`);
  console.log(`Judge:       ${skipJudge ? "SKIPPED" : JUDGE_MODEL}`);
  console.log("=".repeat(60) + "\n");

  // Check API keys
  for (const model of models) {
    const provider = detectProvider(model);
    const keyMap: Record<LLMProvider, string> = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", gemini: "GEMINI_API_KEY", grok: "GROK_API_KEY" };
    if (!process.env[keyMap[provider]]) {
      console.error(`Missing ${keyMap[provider]} for model ${model}`);
      process.exit(1);
    }
  }

  const limit = createLimiter(concurrency);
  const results: RunResult[] = [];

  // Phase 1: Run all model calls
  log(`Phase 1: Running ${totalCalls} model calls...`);
  const phase1Start = Date.now();

  const callTasks: Promise<void>[] = [];
  for (const contract of contracts) {
    for (const role of roles) {
      const config = ROLE_CONFIGS[role];
      const prompt = config.buildPrompt(contract);
      for (const model of models) {
        for (let rep = 0; rep < reps; rep++) {
          callTasks.push(limit(async () => {
            const call = await callModel(model, config.system, prompt, config.schema, config.maxTokens, config.temperature);
            const validation = call.error ? { valid: false, parsed: null, errors: [call.error] } : validateOutput(call.text, role);
            const shortModel = model.replace(/-20\d{6}/, "").slice(0, 20);
            const status = call.error ? "ERR" : validation.valid ? "OK" : "SCHEMA_FAIL";
            log(`  ${contract.label.slice(0, 15).padEnd(15)} ${role.padEnd(11)} ${shortModel.padEnd(20)} rep${rep + 1} ${status} ${call.durationMs}ms`);
            results.push({ contractLabel: contract.label, role, model, rep, call, validation, judge: null });
          }));
        }
      }
    }
  }
  await Promise.all(callTasks);
  log(`Phase 1 complete: ${results.length} calls in ${((Date.now() - phase1Start) / 1000).toFixed(1)}s`);

  // Phase 2: Judge valid outputs
  if (!skipJudge) {
    const validResults = results.filter(r => r.validation.valid);
    log(`Phase 2: Judging ${validResults.length} valid outputs with ${JUDGE_MODEL}...`);
    const phase2Start = Date.now();

    const judgeTasks = validResults.map(r =>
      limit(async () => {
        const contract = contracts.find(c => c.label === r.contractLabel)!;
        r.judge = await judgeOutput(r.role, r.contractLabel, contract.storyEssence, r.call.text);
      })
    );
    await Promise.all(judgeTasks);
    log(`Phase 2 complete in ${((Date.now() - phase2Start) / 1000).toFixed(1)}s`);
  }

  // ── Build summary tables ──

  const lines: string[] = [
    "=".repeat(70),
    "  RESEARCH MODEL COMPARISON v2 — RESULTS",
    "=".repeat(70),
    "",
    `Models: ${models.join(", ")}`,
    `Contracts: ${contracts.map(c => c.label).join(", ")}`,
    `Reps per combo: ${reps}`,
    `Judge: ${skipJudge ? "SKIPPED" : JUDGE_MODEL}`,
    "",
  ];

  // Overall rankings by role
  for (const role of roles) {
    lines.push("─".repeat(70));
    lines.push(`  ${role.toUpperCase()} RESEARCHER — MODEL RANKINGS`);
    lines.push("─".repeat(70));
    lines.push("");

    const modelStats: Record<string, {
      scores: number[]; latencies: number[]; schemaPass: number; schemaTotal: number; errors: number;
      specificity: number[]; storyFuel: number[]; surprise: number[]; relevance: number[];
    }> = {};

    for (const model of models) {
      modelStats[model] = { scores: [], latencies: [], schemaPass: 0, schemaTotal: 0, errors: 0,
        specificity: [], storyFuel: [], surprise: [], relevance: [] };
    }

    for (const r of results.filter(r => r.role === role)) {
      const s = modelStats[r.model];
      s.schemaTotal++;
      if (r.call.error) { s.errors++; continue; }
      s.latencies.push(r.call.durationMs);
      if (r.validation.valid) {
        s.schemaPass++;
        if (r.judge) {
          s.scores.push(r.judge.composite);
          s.specificity.push(r.judge.specificity);
          s.storyFuel.push(r.judge.storyFuel);
          s.surprise.push(r.judge.surprise);
          s.relevance.push(r.judge.relevance);
        }
      }
    }

    const avg = (arr: number[]) => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
    const pad = (s: string, n: number) => s.padEnd(n);

    // Header
    lines.push(pad("Model", 28) + pad("Composite", 11) + pad("Spec", 6) + pad("Fuel", 6) + pad("Surp", 6) + pad("Relv", 6) + pad("Schema%", 9) + pad("Latency", 10) + "Errors");
    lines.push("-".repeat(88));

    // Sort by composite score descending
    const sorted = models.slice().sort((a, b) => avg(modelStats[b].scores) - avg(modelStats[a].scores));

    for (const model of sorted) {
      const s = modelStats[model];
      const shortModel = model.replace(/-20\d{6}/, "");
      const composite = avg(s.scores).toFixed(2);
      const spec = avg(s.specificity).toFixed(1);
      const fuel = avg(s.storyFuel).toFixed(1);
      const surp = avg(s.surprise).toFixed(1);
      const relv = avg(s.relevance).toFixed(1);
      const schema = s.schemaTotal > 0 ? ((s.schemaPass / s.schemaTotal) * 100).toFixed(0) + "%" : "N/A";
      const latency = s.latencies.length > 0 ? (avg(s.latencies) / 1000).toFixed(1) + "s" : "N/A";
      lines.push(pad(shortModel, 28) + pad(composite, 11) + pad(spec, 6) + pad(fuel, 6) + pad(surp, 6) + pad(relv, 6) + pad(schema, 9) + pad(latency, 10) + s.errors);
    }
    lines.push("");
  }

  // Per-contract breakdown
  lines.push("=".repeat(70));
  lines.push("  PER-CONTRACT BREAKDOWN (avg composite across reps)");
  lines.push("=".repeat(70));
  lines.push("");

  for (const role of roles) {
    lines.push(`── ${role.toUpperCase()} ──`);
    const header = pad("Contract", 30) + models.map(m => pad(m.replace(/-20\d{6}/, "").slice(0, 15), 17)).join("");
    lines.push(header);
    lines.push("-".repeat(30 + models.length * 17));

    for (const contract of contracts) {
      let line = pad(contract.label.slice(0, 28), 30);
      for (const model of models) {
        const runs = results.filter(r => r.contractLabel === contract.label && r.role === role && r.model === model);
        const validScores = runs.filter(r => r.judge).map(r => r.judge!.composite);
        const schemaFails = runs.filter(r => !r.validation.valid).length;
        if (validScores.length > 0) {
          const avg = (validScores.reduce((a, b) => a + b, 0) / validScores.length).toFixed(2);
          const tag = schemaFails > 0 ? ` (${schemaFails}F)` : "";
          line += pad(`${avg}${tag}`, 17);
        } else {
          line += pad(schemaFails === runs.length ? "FAIL" : "N/A", 17);
        }
      }
      lines.push(line);
    }
    lines.push("");
  }

  // Schema compliance summary
  lines.push("=".repeat(70));
  lines.push("  SCHEMA COMPLIANCE");
  lines.push("=".repeat(70));
  lines.push("");
  const schemaHeader = pad("Model", 28) + roles.map(r => pad(r, 15)).join("");
  lines.push(schemaHeader);
  lines.push("-".repeat(28 + roles.length * 15));
  for (const model of models) {
    let line = pad(model.replace(/-20\d{6}/, ""), 28);
    for (const role of roles) {
      const runs = results.filter(r => r.model === model && r.role === role);
      const pass = runs.filter(r => r.validation.valid).length;
      line += pad(`${pass}/${runs.length}`, 15);
    }
    lines.push(line);
  }
  lines.push("");

  // Speed summary
  lines.push("=".repeat(70));
  lines.push("  AVERAGE LATENCY (seconds)");
  lines.push("=".repeat(70));
  lines.push("");
  const speedHeader = pad("Model", 28) + roles.map(r => pad(r, 15)).join("");
  lines.push(speedHeader);
  lines.push("-".repeat(28 + roles.length * 15));
  for (const model of models) {
    let line = pad(model.replace(/-20\d{6}/, ""), 28);
    for (const role of roles) {
      const latencies = results.filter(r => r.model === model && r.role === role && !r.call.error).map(r => r.call.durationMs);
      const avg = latencies.length > 0 ? (latencies.reduce((a, b) => a + b, 0) / latencies.length / 1000).toFixed(1) + "s" : "N/A";
      line += pad(avg, 15);
    }
    lines.push(line);
  }
  lines.push("");

  // Notable outputs (top 3 and bottom 3 by composite)
  if (!skipJudge) {
    const scored = results.filter(r => r.judge).sort((a, b) => b.judge!.composite - a.judge!.composite);
    if (scored.length > 0) {
      lines.push("=".repeat(70));
      lines.push("  TOP 5 OUTPUTS (by composite score)");
      lines.push("=".repeat(70));
      for (const r of scored.slice(0, 5)) {
        const shortModel = r.model.replace(/-20\d{6}/, "").slice(0, 20);
        lines.push(`  ${r.judge!.composite.toFixed(2)} | ${shortModel} | ${r.contractLabel} / ${r.role} | ${r.judge!.reasoning}`);
      }
      lines.push("");
      lines.push("=".repeat(70));
      lines.push("  BOTTOM 5 OUTPUTS (by composite score)");
      lines.push("=".repeat(70));
      for (const r of scored.slice(-5)) {
        const shortModel = r.model.replace(/-20\d{6}/, "").slice(0, 20);
        lines.push(`  ${r.judge!.composite.toFixed(2)} | ${shortModel} | ${r.contractLabel} / ${r.role} | ${r.judge!.reasoning}`);
      }
      lines.push("");
    }
  }

  function pad(s: string, n: number) { return s.padEnd(n); }

  // Save
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dir = "./data/blind-tests";
  await mkdir(dir, { recursive: true });

  const reportPath = `${dir}/v2_report_${ts}.txt`;
  const jsonPath = `${dir}/v2_raw_${ts}.json`;

  await Promise.all([
    writeFile(reportPath, lines.join("\n"), "utf-8"),
    writeFile(jsonPath, JSON.stringify(results, null, 2), "utf-8"),
  ]);

  // Print report to console
  console.log("\n" + lines.join("\n"));
  console.log(`\nReport: ${reportPath}`);
  console.log(`Raw JSON: ${jsonPath}`);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
