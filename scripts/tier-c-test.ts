#!/usr/bin/env tsx
/**
 * TIER C — CRITICAL PATH MODEL COMPARISON (Hook Module)
 * ═════════════════════════════════════════════════════
 * Tests clarifier, builder, and judge roles against powerful-tier models.
 * These are user-facing roles currently on Claude Sonnet.
 *
 * 4 models × 3 roles × 3 contracts × 2 reps = 72 calls + meta-judge
 * (2 reps instead of 3 to save costs — powerful models are expensive)
 */

import "dotenv/config";
import { mkdir, writeFile } from "fs/promises";

import {
  HOOK_CLARIFIER_SYSTEM, HOOK_CLARIFIER_USER_PREFIX, HOOK_CLARIFIER_USER_DYNAMIC,
  HOOK_BUILDER_SYSTEM, HOOK_BUILDER_USER_PREFIX, HOOK_BUILDER_USER_DYNAMIC,
  HOOK_JUDGE_SYSTEM, HOOK_JUDGE_USER_TEMPLATE,
} from "../backend/services/hookPrompts";
import { HOOK_CLARIFIER_SCHEMA, HOOK_BUILDER_SCHEMA, HOOK_JUDGE_SCHEMA } from "../backend/services/hookSchemas";
import { detectProvider, type LLMProvider } from "../shared/modelConfig";

// ── Models ──
const MODELS = [
  "claude-sonnet-4-6",          // current baseline
  "gpt-5.4",                    // OpenAI powerful
  "gemini-3.1-pro-preview",     // Google powerful
  "gpt-5.4-mini",               // dark horse — already proven on polish
];
const META_JUDGE_MODEL = "claude-sonnet-4-6"; // judge the outputs
const REPS = 2;
const CONCURRENCY = 4; // lower concurrency — expensive models

// ── Story contracts ──
const STORIES = [
  {
    label: "Hospital AI Triage",
    seed: "A burned-out nurse discovers her hospital's AI triage system is quietly deprioritizing patients who can't pay, and the only person who can help her prove it is the engineer who built it — her estranged sister.",
    priorTurns: `Turn 1 (clarifier): Surfaced assumptions about tone (grounded thriller), setting (US hospital), protagonist (female nurse), relationship (estranged sisters). User KEPT all, added: "Not a simple whistleblower story."
Turn 2 (user chose option): "exhausted complicity" over "righteous anger" for nurse's emotional state. User also typed: "She's been covering for the system — she's part of the problem."
Turn 3 (clarifier): Proposed hook directions. User chose: "The sister who built the AI left nursing because she thought algorithms could remove human bias. Now she has to prove her own system IS the bias."`,
    constraintLedger: `tone: "Grounded thriller with moral complexity" [CONFIRMED by user, turn 1]
setting: "Contemporary US hospital" [CONFIRMED by user, turn 1]
protagonist_role: "Nurse, burned out, complicit" [CONFIRMED by user, turn 2]
antagonist_form: "AI triage system (institutional, not personal)" [CONFIRMED by user, turn 1]
relationship: "Estranged sisters — nurse and engineer" [CONFIRMED by user, turn 3]
protagonist_desire: "To expose the system without destroying her own career" [INFERRED]
emotional_promise: "Exhausted complicity, not righteous anger" [CONFIRMED by user, turn 2]`,
    currentState: JSON.stringify({ hook_engine: "algorithmic_bias_discovery", stakes: "patients_dying_quietly", protagonist_role: "nurse_whistleblower", antagonist_form: "AI_triage_system", setting_anchor: "US_hospital_night_shift", tone_chips: ["grounded", "thriller", "moral_complexity"] }),
    psychologySignals: "Gravitates toward institutional critique. Prefers moral complexity. Director orientation for character details. High engagement with systemic mechanics.",
    banList: "delicate dance, simmering tension, lurking beneath",
    toneChips: "grounded, thriller, moral complexity",
    // Builder-specific: a candidate hook to judge
    candidateHook: JSON.stringify({
      hook_sentence: "What if a nurse discovered her hospital's AI was letting poor patients die — and the only person who could prove it was the sister who built it, the sister she hasn't spoken to since their mother died on the same hospital floor?",
      emotional_promise: "The sick vertigo of needing help from someone who hurt you, while the system you serve quietly kills the people you swore to protect.",
      premise: "Sarah Chen has been an ER nurse for twelve years. She stayed when everyone else burned out, told herself the system worked, covered extra shifts, looked away when the numbers felt wrong. Then the AI triage system arrived — and the numbers got worse in a pattern she can't unsee. Patients with thin insurance consistently score lower, wait longer, get seen later. The evidence is statistical, not dramatic: no smoking gun, just a slow bleed of worse outcomes that maps perfectly onto who can pay. The only person with the technical skills to prove algorithmic bias is Dr. Rachel Chen — Sarah's younger sister, who left nursing to build the very system that's now killing people. Rachel believed algorithms could remove human error from triage. She built the system after their mother died from a misread chart — a human mistake that an AI would never make. Now Sarah needs Rachel to prove her own creation is the error. They haven't spoken in three years.",
      opening_image: "A nurse stares at an override log on a cracked monitor at 3am, coffee gone cold, highlighter bleeding through the printout where the pattern lives.",
      page_1_splash_prompt: "A tired nurse at a dimly lit nursing station, hunched over a monitor showing patient triage scores, yellow highlighter marks on a printed spreadsheet beside her, the hospital corridor dark and empty behind her.",
      page_turn_trigger: "Sarah runs the numbers a third time and the pattern holds — every patient below the poverty line scored at least 15% lower by the AI.",
      why_addictive: ["The sister who built the weapon is the only one who can disarm it", "The nurse is complicit — she's been covering for the system", "The AI isn't evil, it's optimizing — and that's worse", "Their mother's death connects them to the same hospital floor"],
      collision_sources: [{ source: "Optum algorithm scandal (UnitedHealth)", element_extracted: "AI using insurance data as proxy for medical need" }, { source: "UK Post Office Horizon scandal", element_extracted: "Workers blamed for system failures they couldn't see" }, { source: "Boeing 737 MAX crashes", element_extracted: "Engineers who believed their system couldn't fail" }],
    }),
  },
  {
    label: "Catgirl Isekai",
    seed: "A funny and happy manga-like story about a mean and miserable and very religious fat 50 year old woman who dies and is reincarnated as a cute catgirl in a fantasy world.",
    priorTurns: `Turn 1 (clarifier): Surfaced assumptions about tone (comedy with heart), genre (isekai), protagonist (retains memories), world (genuinely kind). User KEPT all, added: "Not mean-spirited toward religious people."
Turn 2 (user chose option): "she was lonely, not evil" for why Margaret was so mean. User typed: "I want you to feel bad for her even while laughing."
Turn 3 (clarifier): Proposed hook directions. User chose: "Her body betrays her — she purrs when petted, her tail wags at children, her ears flatten when she lies. Her old personality is trapped in a body that keeps saying yes to everything she spent 52 years saying no to."`,
    constraintLedger: `tone: "Comedy with emotional depth" [CONFIRMED by user, turn 1]
genre: "Isekai reincarnation" [CONFIRMED by user, turn 1]
protagonist_role: "Reincarnated catgirl who retains old memories" [CONFIRMED by user, turn 1]
world_tone: "Fantasy world that is genuinely kind" [CONFIRMED by user, turn 1]
protagonist_wound: "Lonely, not evil — cruelty from isolation" [CONFIRMED by user, turn 2]
hook_engine: "Body betrayal — catgirl instincts vs religious rigidity" [CONFIRMED by user, turn 3]
negative_profile: "Not mean-spirited toward religious people, not fanservice" [CONFIRMED by user, turn 1]`,
    currentState: JSON.stringify({ hook_engine: "cognitive_dissonance_comedy", protagonist_role: "reincarnated_judgmental_woman", setting_anchor: "wholesome_fantasy_village", tone_chips: ["comedy", "heart", "manga"] }),
    psychologySignals: "Explorer orientation — likes surprises. Enjoys ironic comedy with emotional depth. Manga pacing preferences. Said 'surprise me' on turn 3.",
    banList: "heartwarming journey, unlikely friendship, discover what truly matters",
    toneChips: "comedy, heart, manga, ironic",
    candidateHook: JSON.stringify({
      hook_sentence: "What if a judgmental church lady died mid-sermon and woke up as the one thing she'd have condemned most — a cute catgirl in a world where everyone is kind, and her new body keeps purring at the affection she spent 52 years refusing?",
      emotional_promise: "The comedy of a wall crumbling from the inside — laughing at rigidity dissolving while quietly realizing the cruelty came from loneliness.",
      premise: "Margaret Chen spent fifty-two years building walls. Judging sinners from the pulpit. Making sure nobody got close enough to see she was lonely. Then she died mid-sermon — heart attack, face-first into the lectern, the irony not lost on whatever cosmic entity decided her next life. She wakes up as Mira: small, fluffy-eared, amber-eyed, and equipped with a tail that wags when children wave at her. Her internal monologue hasn't changed — she's still mentally categorizing everyone as sinners. But her body has other ideas. She purrs when the village baker pets her ears. Her tail goes rigid when she tries to lecture someone. She attempts to pray and accidentally meows. The fantasy world she's landed in is aggressively kind. Strangers hug each other. The healer offers free checkups. A child asks if she's lost and Mira's ears flatten against her skull because the honest answer is yes.",
      opening_image: "A petite catgirl sits on a village bench, arms crossed, tail wagging furiously behind her while she glares at a group of laughing children who keep trying to pet her ears.",
      page_1_splash_prompt: "A grumpy petite catgirl with white fluffy ears and a traitorous wagging tail, sitting on a wooden bench in a sunny fantasy village, arms crossed defiantly while smiling children reach for her ears. Manga art style, warm colors.",
      page_turn_trigger: "A child hugs Mira without warning and she purrs so loudly the entire market square turns to look — and for the first time in either life, she doesn't pull away.",
      why_addictive: ["Her body keeps saying yes to everything she spent 52 years refusing", "The comedy IS the character arc — every laugh is a wall crumbling", "She was lonely the whole time and this world won't let her be", "Involuntary purring as emotional betrayal"],
      collision_sources: [{ source: "Kafka's Metamorphosis", element_extracted: "Identity crisis through unwanted body transformation" }, { source: "Japanese cat cafe culture", element_extracted: "Physical affection as therapy — touch-starved people seeking comfort" }, { source: "Isekai genre conventions", element_extracted: "Reincarnation as cosmic do-over with genre-savvy protagonist" }],
    }),
  },
  {
    label: "Jock/Elf Prince",
    seed: "A muscular 20 year old jock sold as a slave to the elf prince.",
    priorTurns: `Turn 1 (clarifier): Surfaced assumptions about genre (fantasy isekai), relationship (power inversion slow burn), protagonist (physical identity), slavery (institutional). User KEPT all, added: "Not non-con apologia."
Turn 2 (user chose option): "his strength is irrelevant, not weaponized" — Tyler's physicality means nothing in a magic world. User typed: "He's never been somewhere he can't fight his way out."
Turn 3 (clarifier): Proposed hook directions. User chose: "The prince's kindness is the trap — it's real but alien. Tyler can't tell if he's a pet or a guest because the distinction doesn't exist in elf culture."`,
    constraintLedger: `genre: "Fantasy isekai with gay romance" [CONFIRMED by user, turn 1]
protagonist_role: "Modern jock, 20, identity built on physical dominance" [CONFIRMED by user, turn 1]
antagonist_form: "Elf prince — not a villain, an alien perspective" [CONFIRMED by user, turn 3]
relationship: "Slow-burn from ownership, power inversion" [CONFIRMED by user, turn 1]
slavery: "Institutional, not personal cruelty" [CONFIRMED by user, turn 1]
hook_engine: "Alien kindness as trap — can't tell pet from guest" [CONFIRMED by user, turn 3]
negative_profile: "Not non-con apologia, not purely comedic, not rescue arc" [CONFIRMED by user, turn 1]`,
    currentState: JSON.stringify({ hook_engine: "alien_kindness_trap", protagonist_role: "fallen_alpha_jock", antagonist_form: "curious_ancient_elf", setting_anchor: "elven_palace", tone_chips: ["fantasy", "slow_burn", "power_inversion", "gay_romance"] }),
    psychologySignals: "Director for character psychology. Drawn to power dynamics and vulnerability. Slow-burn preference. Values detailed worldbuilding. High engagement with identity themes.",
    banList: "complex layers, simmering chemistry, forbidden desire",
    toneChips: "fantasy, slow burn, power inversion, vulnerability",
    candidateHook: JSON.stringify({
      hook_sentence: "What if the biggest guy in every room got sold to someone who didn't need muscle — an elf prince who keeps him in luxury, treats him with genuine curiosity, and can't understand why comfort feels like a cage?",
      emotional_promise: "The vertigo of being reduced from someone who mattered to someone who is collected — and the terrifying moment when the cage starts feeling like home.",
      premise: "Tyler Reeves was the biggest guy in every room he'd ever been in. Varsity wrestler, trailer park kid, scholarship that was his only way out. Then something pulled him from the college gym and dropped him in a world where magic makes muscle a curiosity, not a weapon. Now he belongs to Prince Caelindor — an 847-year-old elf who collected him the way you'd collect an interesting beetle. The prince's household is luxury Tyler's never imagined: living-wood walls, bioluminescent light, clothing that fits perfectly despite no measurements. The food is better than anything he's eaten. The bed is softer than anything he's slept on. He can't leave. The exits are warded by magic he can't see, guarded by servants who are polite but immovable. Tyler's entire identity — the strength, the dominance, the being-the-biggest — is worthless here. His body is a novelty. His defiance amuses the prince. And Caelindor's kindness is real but utterly alien — he genuinely cannot comprehend why Tyler won't eat the food, won't sleep in the bed, won't stop testing doors he can't open.",
      opening_image: "A muscular young man in ill-fitting elven clothing stands at a window made of living crystal, fists clenched, watching an alien sunset paint a world he can't escape.",
      page_1_splash_prompt: "A muscular 20-year-old man in flowing elven clothing that doesn't fit his frame, standing at a crystalline window in an organic palace room, fists clenched at his sides, looking out at an alien landscape of floating spires and bioluminescent forests. Fantasy illustration style.",
      page_turn_trigger: "Tyler tries the door for the eleventh time and it opens — Caelindor is standing on the other side, head tilted, genuinely confused about why Tyler keeps trying to leave.",
      why_addictive: ["His entire identity is worthless in this world", "The prince's kindness is real — which makes it worse", "He can't fight, can't run, can't earn respect the only way he knows how", "The cage is nicer than anywhere he's ever lived"],
      collision_sources: [{ source: "Potsdam Giants of Frederick William I", element_extracted: "Collecting humans as living curiosities for a royal household" }, { source: "Stockholm syndrome research", element_extracted: "Comfort as a tool of captivity — when the cage is nicer than freedom" }, { source: "Roman gladiator ownership", element_extracted: "Valuable property treated well precisely because of their commodity status" }],
    }),
  },
];

// ── Provider callers ──
interface LLMCallResult { text: string; model: string; provider: LLMProvider; durationMs: number; error?: string; }

function stripAdditionalProperties(obj: any): any {
  if (Array.isArray(obj)) return obj.map(stripAdditionalProperties);
  if (obj && typeof obj === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(obj)) { if (k !== "additionalProperties") out[k] = stripAdditionalProperties(v); }
    return out;
  }
  return obj;
}
function enforceAllRequired(obj: any): any {
  if (Array.isArray(obj)) return obj.map(enforceAllRequired);
  if (obj && typeof obj === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(obj)) { out[k] = enforceAllRequired(v); }
    if (out.properties && typeof out.properties === "object") out.required = Object.keys(out.properties);
    return out;
  }
  return obj;
}

async function callAnthropic(model: string, system: string, user: string, schema: Record<string, unknown>, maxTokens: number, temperature: number): Promise<LLMCallResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { text: "", model, provider: "anthropic", durationMs: 0, error: "NO KEY" };
  const start = Date.now();
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: maxTokens, temperature, system, messages: [{ role: "user", content: user }],
        tools: [{ name: "structured_output", description: "Return structured output", input_schema: schema }],
        tool_choice: { type: "tool", name: "structured_output" } }),
    });
    const data = await res.json() as any;
    if (data.error) throw new Error(JSON.stringify(data.error));
    const tb = data.content?.find((b: any) => b.type === "tool_use");
    return { text: tb ? JSON.stringify(tb.input) : "", model, provider: "anthropic", durationMs: Date.now() - start };
  } catch (err: any) { return { text: "", model, provider: "anthropic", durationMs: Date.now() - start, error: err.message }; }
}

async function callGemini(model: string, system: string, user: string, schema: Record<string, unknown>, maxTokens: number, temperature: number): Promise<LLMCallResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { text: "", model, provider: "gemini", durationMs: 0, error: "NO KEY" };
  const start = Date.now();
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    const res = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ system_instruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { temperature, maxOutputTokens: maxTokens, responseMimeType: "application/json", responseSchema: stripAdditionalProperties(schema) } }),
    });
    const data = await res.json() as any;
    if (data.error) throw new Error(JSON.stringify(data.error));
    return { text: data.candidates?.[0]?.content?.parts?.[0]?.text ?? "", model, provider: "gemini", durationMs: Date.now() - start };
  } catch (err: any) { return { text: "", model, provider: "gemini", durationMs: Date.now() - start, error: err.message }; }
}

async function callOpenAI(model: string, system: string, user: string, schema: Record<string, unknown>, maxTokens: number, temperature: number): Promise<LLMCallResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { text: "", model, provider: "openai", durationMs: 0, error: "NO KEY" };
  const start = Date.now();
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, max_completion_tokens: maxTokens, temperature,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        response_format: { type: "json_schema", json_schema: { name: "hook_output", strict: true, schema: enforceAllRequired(schema) } } }),
    });
    const data = await res.json() as any;
    if (data.error) throw new Error(JSON.stringify(data.error));
    return { text: data.choices?.[0]?.message?.content ?? "", model, provider: "openai", durationMs: Date.now() - start };
  } catch (err: any) { return { text: "", model, provider: "openai", durationMs: Date.now() - start, error: err.message }; }
}

async function callModel(model: string, system: string, user: string, schema: Record<string, unknown>, maxTokens: number, temperature: number): Promise<LLMCallResult> {
  const p = detectProvider(model);
  if (p === "anthropic") return callAnthropic(model, system, user, schema, maxTokens, temperature);
  if (p === "gemini") return callGemini(model, system, user, schema, maxTokens, temperature);
  return callOpenAI(model, system, user, schema, maxTokens, temperature);
}

// ── Role configs ──
type Role = "clarifier" | "builder" | "judge";
const ALL_ROLES: Role[] = ["clarifier", "builder", "judge"];

interface RoleConfig {
  system: string;
  buildPrompt: (s: typeof STORIES[0]) => string;
  schema: Record<string, unknown>;
  maxTokens: number;
  temperature: number;
  judgeContext: string;
}

const ROLE_CONFIGS: Record<Role, RoleConfig> = {
  clarifier: {
    system: HOOK_CLARIFIER_SYSTEM,
    buildPrompt: (s) => {
      const prefix = HOOK_CLARIFIER_USER_PREFIX
        .replace("{{USER_SEED}}", s.seed)
        .replace("{{CURRENT_STATE_JSON}}", s.currentState)
        .replace("{{BAN_LIST}}", s.banList);
      const dynamic = HOOK_CLARIFIER_USER_DYNAMIC
        .replace("{{PRIOR_TURNS}}", s.priorTurns)
        .replace("{{CONSTRAINT_LEDGER}}", s.constraintLedger)
        .replace("{{PSYCHOLOGY_LEDGER}}", s.psychologySignals)
        .replace("{{ENGINE_DIALS}}", "")
        .replace("{{TURN_NUMBER}}", "4");
      return prefix + "\n\n" + dynamic;
    },
    schema: HOOK_CLARIFIER_SCHEMA as Record<string, unknown>,
    maxTokens: 2048, temperature: 0.7,
    judgeContext: "hook clarifier output (creative partner response with hypothesis, question, options, assumptions)",
  },
  builder: {
    system: HOOK_BUILDER_SYSTEM,
    buildPrompt: (s) => {
      const prefix = HOOK_BUILDER_USER_PREFIX
        .replace("{{USER_SEED}}", s.seed)
        .replace("{{CURRENT_STATE_JSON}}", s.currentState)
        .replace("{{BAN_LIST}}", s.banList)
        .replace("{{TONE_CHIPS}}", s.toneChips);
      const dynamic = HOOK_BUILDER_USER_DYNAMIC
        .replace("{{PRIOR_TURNS}}", s.priorTurns)
        .replace("{{CONSTRAINT_LEDGER}}", s.constraintLedger)
        .replace("{{PSYCHOLOGY_SIGNALS}}", s.psychologySignals);
      return prefix + "\n\n" + dynamic;
    },
    schema: HOOK_BUILDER_SCHEMA as Record<string, unknown>,
    maxTokens: 2048, temperature: 0.7,
    judgeContext: "hook builder output (hook_sentence, premise, opening_image, collision_sources)",
  },
  judge: {
    system: HOOK_JUDGE_SYSTEM,
    buildPrompt: (s) => HOOK_JUDGE_USER_TEMPLATE
      .replace("{{CANDIDATE_JSON}}", s.candidateHook)
      .replace("{{CURRENT_STATE_JSON}}", s.currentState)
      .replace("{{PSYCHOLOGY_SIGNALS}}", s.psychologySignals),
    schema: HOOK_JUDGE_SCHEMA as Record<string, unknown>,
    maxTokens: 1024, temperature: 0.2,
    judgeContext: "hook judge output (analysis, pass/fail, scores, fix instructions)",
  },
};

// ── Meta-judge (Sonnet evaluates all outputs) ──
const META_JUDGE_SYSTEM = `You are evaluating outputs from a story creation engine's critical-path modules. Score rigorously. 3 is competent, 5 is exceptional, 1 is harmful to the user experience.

RUBRIC:
- creativity (1-5): Genuine creative spark? Or formulaic, predictable output?
- specificity (1-5): Concrete mechanisms, vivid details, scene-ready material? Or vague abstractions?
- instruction_following (1-5): Does it follow the prompt's format, constraints, and rules?
- user_value (1-5): Would a user creating a story genuinely benefit from this output?

Return ONLY valid JSON: {"creativity": N, "specificity": N, "instruction_following": N, "user_value": N, "reasoning": "2-3 sentences"}`;

interface MetaJudgeScores { creativity: number; specificity: number; instruction_following: number; user_value: number; composite: number; reasoning: string; }

async function metaJudge(context: string, storyLabel: string, outputText: string): Promise<MetaJudgeScores | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: META_JUDGE_MODEL, max_tokens: 400, temperature: 0, system: META_JUDGE_SYSTEM,
        messages: [{ role: "user", content: `Score this ${context} for "${storyLabel}".\n\nOUTPUT:\n${outputText.slice(0, 6000)}` }] }),
    });
    const data = await res.json() as any;
    if (data.error) { console.warn("[META-JUDGE] Error:", JSON.stringify(data.error).slice(0, 200)); return null; }
    const match = (data.content?.[0]?.text ?? "").match(/\{[\s\S]*\}/);
    if (!match) return null;
    const p = JSON.parse(match[0]);
    return { ...p, composite: Math.round((p.creativity + p.specificity + p.instruction_following + p.user_value) / 4 * 100) / 100 };
  } catch { return null; }
}

// ── Helpers ──
function createLimiter(max: number) {
  let active = 0; const queue: (() => void)[] = [];
  return async function<T>(fn: () => Promise<T>): Promise<T> {
    while (active >= max) { await new Promise<void>(r => queue.push(r)); }
    active++; try { return await fn(); } finally { active--; queue.shift()?.(); }
  };
}
function log(msg: string) { console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`); }

// ── Main ──
interface RunResult {
  role: Role; model: string; storyLabel: string; rep: number;
  durationMs: number; valid: boolean; judge: MetaJudgeScores | null; error?: string;
}

async function main() {
  const limit = createLimiter(CONCURRENCY);
  const results: RunResult[] = [];
  const total = MODELS.length * ALL_ROLES.length * STORIES.length * REPS;

  console.log("\n" + "=".repeat(60));
  console.log("  TIER C — CRITICAL PATH MODEL COMPARISON");
  console.log("=".repeat(60));
  console.log(`Models:  ${MODELS.join(", ")}`);
  console.log(`Roles:   ${ALL_ROLES.join(", ")}`);
  console.log(`Stories: ${STORIES.length}`);
  console.log(`Reps:    ${REPS}`);
  console.log(`Calls:   ${total} model + up to ${total} meta-judge`);
  console.log("=".repeat(60) + "\n");

  log(`Phase 1: ${total} model calls...`);
  const p1 = Date.now();

  const tasks: Promise<void>[] = [];
  for (const role of ALL_ROLES) {
    const config = ROLE_CONFIGS[role];
    for (const story of STORIES) {
      const prompt = config.buildPrompt(story);
      for (const model of MODELS) {
        for (let rep = 0; rep < REPS; rep++) {
          tasks.push(limit(async () => {
            const call = await callModel(model, config.system, prompt, config.schema, config.maxTokens, config.temperature);
            let valid = false;
            if (!call.error && call.text.length > 50) {
              try { JSON.parse(call.text); valid = true; } catch { valid = false; }
            }
            const short = model.replace(/-20\d{6}/, "").slice(0, 22);
            log(`  ${short.padEnd(22)} ${role.padEnd(11)} ${story.label.slice(0, 20).padEnd(20)} rep${rep + 1} ${call.error ? "ERR" : valid ? "OK" : "FAIL"} ${call.durationMs}ms`);
            results.push({ role, model, storyLabel: story.label, rep, durationMs: call.durationMs, valid, judge: null, error: call.error });
            (results[results.length - 1] as any)._text = call.text;
          }));
        }
      }
    }
  }
  await Promise.all(tasks);
  log(`Phase 1 done in ${((Date.now() - p1) / 1000).toFixed(1)}s`);

  // Phase 2: Meta-judge
  const validResults = results.filter(r => r.valid);
  log(`Phase 2: Meta-judging ${validResults.length} valid outputs...`);
  const p2 = Date.now();
  await Promise.all(validResults.map(r => limit(async () => {
    const config = ROLE_CONFIGS[r.role];
    r.judge = await metaJudge(config.judgeContext, r.storyLabel, (r as any)._text);
  })));
  log(`Phase 2 done in ${((Date.now() - p2) / 1000).toFixed(1)}s`);

  // ── Results ──
  const pad = (s: string, n: number) => s.padEnd(n);
  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const lines: string[] = ["=".repeat(85), "  TIER C — CRITICAL PATH RESULTS", "=".repeat(85), ""];

  for (const role of ALL_ROLES) {
    lines.push("═".repeat(85));
    lines.push(`  ${role.toUpperCase()}`);
    lines.push("═".repeat(85));
    lines.push(pad("Model", 25) + pad("Composite", 11) + pad("Create", 8) + pad("Spec", 6) + pad("Follow", 8) + pad("Value", 7) + pad("Valid%", 8) + pad("Latency", 10));
    lines.push("-".repeat(83));

    const sorted = MODELS.slice().sort((a, b) => {
      const aS = results.filter(r => r.role === role && r.model === a && r.judge);
      const bS = results.filter(r => r.role === role && r.model === b && r.judge);
      return avg(bS.map(r => r.judge!.composite)) - avg(aS.map(r => r.judge!.composite));
    });

    for (const model of sorted) {
      const runs = results.filter(r => r.role === role && r.model === model);
      const scored = runs.filter(r => r.judge);
      const validCount = runs.filter(r => r.valid).length;
      lines.push(
        pad(model.replace(/-20\d{6}/, ""), 25) +
        pad(scored.length > 0 ? avg(scored.map(r => r.judge!.composite)).toFixed(2) : "N/A", 11) +
        pad(scored.length > 0 ? avg(scored.map(r => r.judge!.creativity)).toFixed(1) : "-", 8) +
        pad(scored.length > 0 ? avg(scored.map(r => r.judge!.specificity)).toFixed(1) : "-", 6) +
        pad(scored.length > 0 ? avg(scored.map(r => r.judge!.instruction_following)).toFixed(1) : "-", 8) +
        pad(scored.length > 0 ? avg(scored.map(r => r.judge!.user_value)).toFixed(1) : "-", 7) +
        pad(runs.length > 0 ? ((validCount / runs.length) * 100).toFixed(0) + "%" : "N/A", 8) +
        pad(runs.filter(r => !r.error).length > 0 ? (avg(runs.filter(r => !r.error).map(r => r.durationMs)) / 1000).toFixed(1) + "s" : "N/A", 10)
      );
    }
    lines.push("");
  }

  // Overall aggregate
  lines.push("═".repeat(85));
  lines.push("  OVERALL AGGREGATE");
  lines.push("═".repeat(85));
  lines.push(pad("Model", 25) + pad("Composite", 11) + pad("Valid%", 8) + pad("Avg Latency", 12));
  lines.push("-".repeat(56));
  const overallSorted = MODELS.slice().sort((a, b) => {
    const aS = results.filter(r => r.model === a && r.judge);
    const bS = results.filter(r => r.model === b && r.judge);
    return avg(bS.map(r => r.judge!.composite)) - avg(aS.map(r => r.judge!.composite));
  });
  for (const model of overallSorted) {
    const runs = results.filter(r => r.model === model);
    const scored = runs.filter(r => r.judge);
    const validCount = runs.filter(r => r.valid).length;
    lines.push(
      pad(model.replace(/-20\d{6}/, ""), 25) +
      pad(scored.length > 0 ? avg(scored.map(r => r.judge!.composite)).toFixed(2) : "N/A", 11) +
      pad(runs.length > 0 ? ((validCount / runs.length) * 100).toFixed(0) + "%" : "N/A", 8) +
      pad(runs.filter(r => !r.error).length > 0 ? (avg(runs.filter(r => !r.error).map(r => r.durationMs)) / 1000).toFixed(1) + "s" : "N/A", 12)
    );
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  await mkdir("./data/blind-tests", { recursive: true });
  const reportPath = `./data/blind-tests/tier_c_report_${ts}.txt`;
  await Promise.all([
    writeFile(reportPath, lines.join("\n"), "utf-8"),
    writeFile(`./data/blind-tests/tier_c_raw_${ts}.json`, JSON.stringify(results, null, 2), "utf-8"),
  ]);

  console.log("\n" + lines.join("\n"));
  console.log(`\nReport: ${reportPath}`);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
