#!/usr/bin/env tsx
/**
 * TIER B — SUMMARY & POLISH ROLE MODEL COMPARISON (v2)
 * ═════════════════════════════════════════════════════
 * Fixed: correct template variables, 3 contracts per role,
 * markdown fence stripping for JSON, explicit plain-text instruction for Gemini.
 *
 * 6 models × 8 roles × 3 contracts × 3 reps = 432 calls + judge
 */

import "dotenv/config";
import { mkdir, writeFile } from "fs/promises";

import { HOOK_SUMMARY_SYSTEM, HOOK_SUMMARY_USER_TEMPLATE, PREMISE_POLISH_SYSTEM, PREMISE_POLISH_USER_TEMPLATE } from "../backend/services/hookPrompts";
import { CHARACTER_SUMMARY_SYSTEM, CHARACTER_SUMMARY_USER_TEMPLATE, CHARACTER_POLISH_SYSTEM, CHARACTER_POLISH_USER_TEMPLATE } from "../backend/services/characterPrompts";
import { CHARACTER_IMAGE_SUMMARY_SYSTEM, CHARACTER_IMAGE_SUMMARY_USER_TEMPLATE } from "../backend/services/characterImagePrompts";
import { WORLD_SUMMARY_SYSTEM, WORLD_SUMMARY_USER_TEMPLATE, WORLD_POLISH_SYSTEM, WORLD_POLISH_USER_TEMPLATE } from "../backend/services/worldPrompts";
import { PLOT_SUMMARY_SYSTEM, PLOT_SUMMARY_USER_TEMPLATE } from "../backend/services/plotPrompts";
import { detectProvider, type LLMProvider } from "../shared/modelConfig";

// ── Models ──
const MODELS = [
  "gemini-3-flash-preview",
  "claude-haiku-4-5-20251001",
  "gpt-5.4-mini",
  "gpt-5.4-nano",
  "grok-4-fast",
  "grok-4-1-fast-non-reasoning",
];
const JUDGE_MODEL = "claude-sonnet-4-6";
const REPS = 3;
const CONCURRENCY = 6;

// ── Shared story data for 3 contracts ──

const STORIES = [
  {
    label: "Hospital AI Triage",
    hookSentence: "A nurse discovers her hospital's AI is quietly letting poor patients die — and the only person who can help her prove it is the sister who built it.",
    premise: "In a mid-size American hospital, the new AI triage system was supposed to save lives by prioritizing the sickest patients. Instead, it learned that 'sickest' and 'least profitable' overlap — and started solving for the hospital's bottom line. Sarah Chen, a twelve-year veteran nurse, notices the pattern in her override logs. The only person with the technical skills to prove algorithmic bias is Dr. Rachel Chen — Sarah's younger sister, the engineer who built the system, and someone Sarah hasn't spoken to since their mother died on a hospital floor three years ago.",
    emotionalPromise: "The sick feeling of knowing the system you serve is harming people, combined with the vertigo of needing help from someone who hurt you personally.",
    hookTurns: "Turn 1: User chose 'exhausted complicity' over 'righteous anger.'\nTurn 2: User specified AI uses insurance coverage as proxy. Rejected obviously evil AI.\nTurn 3: Chose estranged sister as reluctant ally. Sisters estranged since mother's death.\nTurn 4: Confirmed tone as grounded thriller.",
    hookState: JSON.stringify({ hook_engine: "algorithmic_bias_discovery", protagonist: { role: "nurse", state: "exhausted_complicity" }, antagonist: { form: "AI_triage_system" }, tone: "grounded_thriller" }),
    hookJson: JSON.stringify({ hook_sentence: "A nurse discovers her hospital's AI is quietly letting poor patients die.", premise: "Sarah Chen notices statistical anomalies in triage override logs...", emotional_promise: "The sick feeling of knowing the system you serve is harming people." }),
    charTurns: "Turn 1: Defined nurse as building identity around caregiving, not heroism.\nTurn 2: Sister left nursing for engineering, believes in algorithmic objectivity.\nTurn 3: Added detail about mother dying due to human error in triage — sister built AI to prevent it.",
    castState: JSON.stringify({ protagonist: { name: "Sarah Chen", role: "nurse" }, deuteragonist: { name: "Rachel Chen", role: "engineer" } }),
    castJson: JSON.stringify([{ role: "protagonist", name: "Sarah Chen", description: "Twelve-year veteran ER nurse who stayed when everyone else burned out. Quiet, meticulous, conflict-avoidant — until she can't be." }, { role: "deuteragonist", name: "Rachel Chen", description: "Left nursing to build the system that was supposed to fix everything. Brilliant, defensive, genuinely believed algorithms would remove human bias from life-and-death decisions." }]),
    imgTurns: "Turn 1: Chose realistic illustration style.\nTurn 2: Sarah: tired eyes, scrubs, messy bun. Rachel: sharp, polished, tech-corporate aesthetic.",
    visualSpecs: JSON.stringify([{ role: "protagonist", name: "Sarah", visual: "Tired eyes, scrubs with coffee stains, messy bun, badge lanyard." }, { role: "deuteragonist", name: "Rachel", visual: "Sharp blazer, clean lines, tech-corporate polish, glasses." }]),
    worldTurns: "Turn 1: Modern US teaching hospital. Night shifts are when patterns show.\nTurn 2: EHR system is real product. Hospital merged recently — cost pressure.\nTurn 3: IT department is understaffed, override logs rarely checked.",
    worldJson: JSON.stringify({ world_thesis: "A hospital where the machinery of care has been quietly repurposed for profit — not by villains, but by optimization functions nobody fully understands.", pressure_summary: "Night shift is skeleton crew. Override logs exist but nobody checks them. The merger created cost pressure that made the AI's bias useful to administrators who didn't ask questions." }),
    plotTurns: "Turn 1: Three-act structure.\nTurn 2: Act 1 climax: Sarah finds the pattern. Act 2: Sisters investigate, old wounds reopen.\nTurn 3: Ambiguous ending — system exposed but hospital survives. Sisters closer but trust permanently damaged.",
    plotJson: JSON.stringify({ acts: [{ act: 1, summary: "Sarah notices statistical anomalies. Each discovery makes her more certain and more implicated." }, { act: 2, summary: "Sarah contacts Rachel. Working together reopens the wound." }, { act: 3, summary: "They expose the bias. Hospital survives. Sisters changed." }] }),
    rawPremise: "In a mid-size American hospital, the new AI triage system was supposed to save lives by prioritizing the sickest patients. Instead, it learned that 'sickest' and 'least profitable' overlap — and started solving for the hospital's bottom line. Sarah Chen, a twelve-year veteran nurse, notices the pattern in her override logs: patients with thin insurance consistently scored lower, triaged slower, seen later. The evidence is statistical, not dramatic — no smoking gun, just a slow bleed of worse outcomes for people who can't pay. The only person with the technical skills to prove algorithmic bias is Dr. Rachel Chen — her estranged sister who built the system. What started as a data anomaly becomes a fight over institutional loyalty, family betrayal, and whether exposing a system that kills quietly is worth destroying the careers of everyone who built it.",
    banList: "delicate dance, simmering tension, lurking beneath, unraveling",
    characters: JSON.stringify([{ role: "protagonist", name: "Sarah Chen", description: "A twelve-year veteran ER nurse whose entire identity is built on staying when others leave. She's meticulous and conflict-avoidant — documenting problems instead of confronting them. Her fundamental paradox: she stayed loyal to a system that was quietly harming the patients she swore to protect." }, { role: "deuteragonist", name: "Rachel Chen", description: "Left nursing to build the algorithm that was supposed to remove human bias from triage decisions. Brilliant and defensive, she genuinely believed optimization could save lives. Her fundamental paradox: the system she built to fix human error became the error." }]),
    worldThesis: "A hospital where the machinery of care has been quietly repurposed for profit — not by villains, but by optimization functions nobody fully understands.",
    pressureSummary: "Night shift is skeleton crew. Override logs exist but nobody checks them. The merger created cost pressure that made the AI's bias useful to administrators who didn't ask questions.",
  },
  {
    label: "Catgirl Isekai",
    hookSentence: "A funny manga-like story about a mean religious woman reincarnated as a cute catgirl.",
    premise: "Margaret Chen died mid-sermon about sinners and woke up as Mira — a petite catgirl in a fantasy world where everyone is kind. Her internal monologue is fire-and-brimstone judgment. Her body purrs when petted.",
    emotionalPromise: "The comedy of unwilling transformation — whether someone cruel because they were unhappy can become kind when given a second chance.",
    hookTurns: "Turn 1: Comedy-first tone. Isekai reincarnation as catgirl.\nTurn 2: Retains all memories. World is genuinely kind.\nTurn 3: Not mean-spirited toward religious people — comedy of cognitive dissonance.",
    hookState: JSON.stringify({ comedy_engine: "cognitive_dissonance", reincarnation: "catgirl", world_tone: "wholesome" }),
    hookJson: JSON.stringify({ hook_sentence: "A mean religious woman dies and wakes up as a cute catgirl.", premise: "Margaret Chen died mid-sermon and reincarnated as Mira...", emotional_promise: "Comedy of unwilling transformation." }),
    charTurns: "Turn 1: Margaret was lonely, not evil. Her cruelty came from isolation.\nTurn 2: Catgirl body has involuntary reactions — purring, ear movement, tail.\nTurn 3: Internal monologue clashes with physical responses. Tries to pray, meows.",
    castState: JSON.stringify({ protagonist: { name: "Mira (Margaret)", role: "reincarnated_catgirl" } }),
    castJson: JSON.stringify([{ role: "protagonist", name: "Mira", description: "Was Margaret Chen, 52, judgmental church lady who died mid-sermon. Now a petite catgirl with fluffy ears and a traitorous tail. Retains all memories. Internal monologue is pure fire-and-brimstone while her body purrs at head pats." }]),
    imgTurns: "Turn 1: Manga art style.\nTurn 2: Fluffy ears, expressive tail, big skeptical eyes.\nTurn 3: Contrast between cute exterior and grumpy expression.",
    visualSpecs: JSON.stringify([{ role: "protagonist", name: "Mira", visual: "Petite catgirl, fluffy white ears, expressive tail, big amber eyes with permanent skeptical squint." }]),
    worldTurns: "Turn 1: Fantasy village, wholesome. Catfolk are common.\nTurn 2: Physical affection between strangers is normal — culture shock for Margaret.\nTurn 3: Magic exists but is gentle — no combat system.",
    worldJson: JSON.stringify({ world_thesis: "A fantasy village where kindness is the default and physical affection between strangers is normal — exactly the nightmare for a woman who spent 52 years building walls.", pressure_summary: "Everyone wants to pet the new catgirl. The village healer keeps offering hugs. Children follow her around. Margaret can't escape kindness." }),
    plotTurns: "Turn 1: Episodic comedy structure.\nTurn 2: Each episode: Margaret resists something kind, her body betrays her.\nTurn 3: Gradual softening arc across episodes. By episode 5 she initiates a hug.",
    plotJson: JSON.stringify({ structure: "episodic", arc: "gradual_softening", episodes: [{ ep: 1, summary: "Margaret wakes up as catgirl. Refuses to acknowledge tail." }, { ep: 3, summary: "Child pets her ears. She purrs. Existential crisis." }, { ep: 5, summary: "She hugs someone first. Cries about it later." }] }),
    rawPremise: "Margaret Chen spent 52 years building walls. Judging sinners from the pulpit. Making sure nobody got close enough to see she was lonely. Then she died mid-sermon — the irony was not lost on whatever cosmic entity decided her next life should be spent as a cute catgirl in a world where everyone is kind. Now she's Mira: small, fluffy-eared, involuntarily purring when touched. Her internal monologue is still fire-and-brimstone. Her tail still wags when the village children wave at her. The comedy writes itself — except underneath it, there's a question that isn't funny at all: was she cruel because she was mean, or mean because she was lonely?",
    banList: "heartwarming journey, unlikely friendship, discover what truly matters",
    characters: JSON.stringify([{ role: "protagonist", name: "Mira (Margaret)", description: "Fifty-two years of judgment in a body that purrs when petted. Margaret Chen's internal monologue hasn't changed — she still mentally categorizes everyone as sinners. But her catgirl body has other ideas: ears that flatten when she's lying, a tail that wags at kindness, and an involuntary purr that betrays every wall she's trying to maintain." }]),
    worldThesis: "A fantasy village where kindness is the default and physical affection between strangers is normal — exactly the nightmare for a woman who spent 52 years building walls.",
    pressureSummary: "Everyone wants to pet the new catgirl. The village healer keeps offering hugs. Children follow her around. Margaret can't escape the one thing she's never known how to handle: genuine warmth.",
  },
  {
    label: "Jock/Elf Prince",
    hookSentence: "A muscular 20-year-old jock sold as a slave to the elf prince.",
    premise: "Tyler Reeves was the biggest guy in every room. Then interdimensional slavers pulled him from a college gym and dropped him in a world where magic makes muscle irrelevant. Now he belongs to Prince Caelindor — an 847-year-old elf who collected him like an interesting beetle.",
    emotionalPromise: "The vertigo of being reduced from someone who mattered to someone who is property.",
    hookTurns: "Turn 1: Power inversion is the engine. Gay slow-burn.\nTurn 2: Tyler's identity built entirely on physical dominance.\nTurn 3: Not non-con apologia. Not a rescue arc.\nTurn 4: Slavery is institutional, not personal cruelty.",
    hookState: JSON.stringify({ dynamic: "power_inversion", romance: "slow_burn", slavery: "institutional" }),
    hookJson: JSON.stringify({ hook_sentence: "A jock is sold as a slave to an elf prince.", premise: "Tyler Reeves was pulled from a college gym by interdimensional slavers...", emotional_promise: "The vertigo of being reduced from someone who mattered to property." }),
    charTurns: "Turn 1: Tyler: wrestler, trailer park, scholarship is his only way out.\nTurn 2: Tyler hides fear with bravado. Would rather break than bend.\nTurn 3: Caelindor: genuinely curious, not cruel. Alien kindness.\nTurn 4: Tyler's first emotion toward Caelindor is confusion, not desire.",
    castState: JSON.stringify({ protagonist: { name: "Tyler Reeves", age: 20 }, deuteragonist: { name: "Prince Caelindor", age: 847 } }),
    castJson: JSON.stringify([{ role: "protagonist", name: "Tyler Reeves", description: "Twenty, built like a tank, raised in a trailer park where being the biggest meant being safe. Wrestling scholarship was his ticket out. Now he's property in a world where his strength is a novelty, not a weapon." }, { role: "deuteragonist", name: "Prince Caelindor", description: "Eight hundred and forty-seven years old. Collected Tyler out of genuine fascination. Has never met anything that fights captivity with such impractical fury. His kindness is real but utterly alien." }]),
    imgTurns: "Turn 1: Fantasy illustration style with manga influence.\nTurn 2: Tyler: muscular, defensive posture, defiant eyes. Caelindor: ethereal, elegant, curious expression.",
    visualSpecs: JSON.stringify([{ role: "protagonist", name: "Tyler", visual: "Muscular, defensive posture, defiant eyes, ill-fitting elven clothing." }, { role: "deuteragonist", name: "Caelindor", visual: "Ethereal, elegant, silver-white hair, curious expression, living-wood crown." }]),
    worldTurns: "Turn 1: Elven palace. Living architecture, bioluminescent lighting.\nTurn 2: Caste system. Slaves are property but not mistreated — they're investments.\nTurn 3: Magic makes physical strength irrelevant. Tyler can't fight his way out.",
    worldJson: JSON.stringify({ world_thesis: "An elven civilization so ancient and powerful that owning a human is neither cruel nor kind — it's simply unremarkable. The palace is alive, the walls grow, the light comes from organisms, and Tyler is the most primitive thing in every room.", pressure_summary: "Tyler can't fight (magic neutralizes strength). Can't run (exits are guarded by wards he can't see). Can't earn respect through physicality. His only leverage is being interesting enough to keep." }),
    plotTurns: "Turn 1: Slow-burn structure. Power gradually shifts.\nTurn 2: Tyler gains agency through understanding elf culture, not through force.\nTurn 3: Romance emerges from mutual curiosity. Neither fully understands the other.",
    plotJson: JSON.stringify({ structure: "slow_burn", arc: "power_gradual_shift", beats: [{ beat: 1, summary: "Tyler resists. Bravado masks terror. Caelindor is fascinated." }, { beat: 2, summary: "Tyler starts learning. His questions interest Caelindor." }, { beat: 3, summary: "First moment of genuine connection. Both are confused by it." }] }),
    rawPremise: "Tyler Reeves was the biggest guy in every room he'd ever been in. Varsity wrestler, trailer park kid with a scholarship that was his only way out. Then something pulled him from the college gym and dropped him in a world where magic makes muscle a curiosity, not a weapon. Now he belongs to Prince Caelindor — an 847-year-old elf who collected him the way you'd collect an interesting beetle. The prince's kindness is real but alien: comfortable quarters, good food, clothing that fits perfectly despite no measurements. Tyler can't figure out if this is a prison or a home. He'd rather break than bend, and the elf world is about to find out what happens when you cage something that's never learned to be still.",
    banList: "complex layers, simmering chemistry, forbidden desire, power dynamics unfold",
    characters: JSON.stringify([{ role: "protagonist", name: "Tyler Reeves", description: "Twenty years old, built like a tank, raised where being the biggest meant being safe. His wrestling scholarship was his only escape. Now he's property in a world where strength is a novelty. Hides terror behind bravado because it's the only tool he has left. Would rather break than bend, and he breaks loudly." }, { role: "deuteragonist", name: "Prince Caelindor", description: "Eight hundred and forty-seven years old and genuinely fascinated by the loud, fragile creature in his household. Has never met anything that fights captivity with such impractical fury. His kindness is real but alien — he cannot conceive that comfort might feel like a trap." }]),
    worldThesis: "An elven civilization so ancient and powerful that owning a human is neither cruel nor kind — it's simply unremarkable. The palace is alive, the walls grow, and Tyler is the most primitive thing in every room.",
    pressureSummary: "Tyler can't fight (magic neutralizes strength). Can't run (exits are warded). Can't earn respect through physicality. His only leverage is being interesting enough to keep.",
  },
];

// ── Helper: strip markdown fences from JSON output ──
function extractJson(text: string): string {
  // Strip ```json ... ``` or ``` ... ```
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  return text.trim();
}

// ── Role configs with correct template variables ──

type Role = "hook_summary" | "char_summary" | "img_summary" | "world_summary" | "plot_summary" | "premise_polish" | "char_polish" | "world_polish";
const ALL_ROLES: Role[] = ["hook_summary", "char_summary", "img_summary", "world_summary", "plot_summary", "premise_polish", "char_polish", "world_polish"];

interface RoleConfig {
  system: string;
  buildPrompt: (s: typeof STORIES[0]) => string;
  maxTokens: number;
  temperature: number;
  isJson: boolean;
  judgeContext: string;
}

const ROLE_CONFIGS: Record<Role, RoleConfig> = {
  hook_summary: {
    system: HOOK_SUMMARY_SYSTEM,
    buildPrompt: (s) => HOOK_SUMMARY_USER_TEMPLATE
      .replace("{{USER_SEED}}", s.hookSentence)
      .replace("{{PRIOR_TURNS}}", s.hookTurns)
      .replace("{{CURRENT_STATE_JSON}}", s.hookState)
      .replace("{{HOOK_JSON}}", s.hookJson),
    maxTokens: 500, temperature: 0.3, isJson: false,
    judgeContext: "hook steering summary (10-15 lines guiding future modules)",
  },
  char_summary: {
    system: CHARACTER_SUMMARY_SYSTEM,
    buildPrompt: (s) => CHARACTER_SUMMARY_USER_TEMPLATE
      .replace("{{HOOK_SENTENCE}}", s.hookSentence)
      .replace("{{PREMISE}}", s.premise)
      .replace("{{PRIOR_TURNS}}", s.charTurns)
      .replace("{{CAST_STATE_JSON}}", s.castState)
      .replace("{{CAST_JSON}}", s.castJson),
    maxTokens: 500, temperature: 0.3, isJson: false,
    judgeContext: "character steering summary (10-15 lines for downstream modules)",
  },
  img_summary: {
    system: CHARACTER_IMAGE_SUMMARY_SYSTEM,
    buildPrompt: (s) => CHARACTER_IMAGE_SUMMARY_USER_TEMPLATE
      .replace("{{PREMISE}}", s.premise)
      .replace("{{EMOTIONAL_PROMISE}}", s.emotionalPromise)
      .replace("{{PRIOR_TURNS}}", s.imgTurns)
      .replace("{{VISUAL_SPECS_JSON}}", s.visualSpecs),
    maxTokens: 300, temperature: 0.3, isJson: false,
    judgeContext: "character image visual summary (5-8 lines)",
  },
  world_summary: {
    system: WORLD_SUMMARY_SYSTEM,
    buildPrompt: (s) => WORLD_SUMMARY_USER_TEMPLATE
      .replace("{{PREMISE}}", s.premise)
      .replace("{{EMOTIONAL_PROMISE}}", s.emotionalPromise)
      .replace("{{PRIOR_TURNS}}", s.worldTurns)
      .replace("{{WORLD_JSON}}", s.worldJson),
    maxTokens: 300, temperature: 0.3, isJson: false,
    judgeContext: "world steering summary (5-8 lines)",
  },
  plot_summary: {
    system: PLOT_SUMMARY_SYSTEM,
    buildPrompt: (s) => PLOT_SUMMARY_USER_TEMPLATE
      .replace("{{PREMISE}}", s.premise)
      .replace("{{EMOTIONAL_PROMISE}}", s.emotionalPromise)
      .replace("{{PRIOR_TURNS}}", s.plotTurns)
      .replace("{{PLOT_JSON}}", s.plotJson),
    maxTokens: 300, temperature: 0.3, isJson: false,
    judgeContext: "plot steering summary (5-8 lines, movie pitch style)",
  },
  premise_polish: {
    system: PREMISE_POLISH_SYSTEM,
    buildPrompt: (s) => PREMISE_POLISH_USER_TEMPLATE
      .replace("{{RAW_PREMISE}}", s.rawPremise)
      .replace("{{HOOK_SENTENCE}}", s.hookSentence)
      .replace("{{EMOTIONAL_PROMISE}}", s.emotionalPromise)
      .replace("{{BAN_LIST}}", s.banList),
    maxTokens: 500, temperature: 0.4, isJson: false,
    judgeContext: "premise polish (tighter, more mysterious rewrite, ~200 words)",
  },
  char_polish: {
    system: CHARACTER_POLISH_SYSTEM,
    buildPrompt: (s) => CHARACTER_POLISH_USER_TEMPLATE
      .replace("{{CHARACTERS_JSON}}", s.characters)
      .replace("{{EMOTIONAL_PROMISE}}", s.emotionalPromise)
      .replace("{{BAN_LIST}}", s.banList),
    maxTokens: 500, temperature: 0.4, isJson: true,
    judgeContext: "character description polish (vivid, max 80 words each, JSON format)",
  },
  world_polish: {
    system: WORLD_POLISH_SYSTEM,
    buildPrompt: (s) => WORLD_POLISH_USER_TEMPLATE
      .replace("{{WORLD_THESIS}}", s.worldThesis)
      .replace("{{PRESSURE_SUMMARY}}", s.pressureSummary)
      .replace("{{PREMISE}}", s.premise)
      .replace("{{EMOTIONAL_PROMISE}}", s.emotionalPromise)
      .replace("{{BAN_LIST}}", s.banList),
    maxTokens: 300, temperature: 0.4, isJson: true,
    judgeContext: "world polish (visceral world_thesis + pressure_summary, JSON format)",
  },
};

// ── Provider callers ──

interface LLMCallResult { text: string; model: string; provider: LLMProvider; durationMs: number; error?: string; }

async function callAnthropic(model: string, system: string, user: string, maxTokens: number, temperature: number): Promise<LLMCallResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { text: "", model, provider: "anthropic", durationMs: 0, error: "NO KEY" };
  const start = Date.now();
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: maxTokens, temperature, system, messages: [{ role: "user", content: user }] }),
    });
    const data = await res.json() as any;
    if (data.error) throw new Error(JSON.stringify(data.error));
    return { text: data.content?.[0]?.text ?? "", model, provider: "anthropic", durationMs: Date.now() - start };
  } catch (err: any) { return { text: "", model, provider: "anthropic", durationMs: Date.now() - start, error: err.message }; }
}

async function callGemini(model: string, system: string, user: string, maxTokens: number, temperature: number): Promise<LLMCallResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { text: "", model, provider: "gemini", durationMs: 0, error: "NO KEY" };
  const start = Date.now();
  try {
    // Append plain-text instruction to prevent markdown formatting
    const augmentedSystem = system + "\n\nIMPORTANT: Respond in plain text only. Do not use markdown formatting, headers, or bullet points unless the prompt explicitly asks for JSON.";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    const res = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ system_instruction: { parts: [{ text: augmentedSystem }] }, contents: [{ role: "user", parts: [{ text: user }] }], generationConfig: { temperature, maxOutputTokens: maxTokens } }),
    });
    const data = await res.json() as any;
    if (data.error) throw new Error(JSON.stringify(data.error));
    return { text: data.candidates?.[0]?.content?.parts?.[0]?.text ?? "", model, provider: "gemini", durationMs: Date.now() - start };
  } catch (err: any) { return { text: "", model, provider: "gemini", durationMs: Date.now() - start, error: err.message }; }
}

async function callOpenAICompatible(model: string, provider: "openai" | "grok", system: string, user: string, maxTokens: number, temperature: number): Promise<LLMCallResult> {
  const envKey = provider === "grok" ? "GROK_API_KEY" : "OPENAI_API_KEY";
  const baseUrl = provider === "grok" ? "https://api.x.ai/v1" : "https://api.openai.com/v1";
  const key = process.env[envKey];
  if (!key) return { text: "", model, provider, durationMs: 0, error: "NO KEY" };
  const start = Date.now();
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, ...(provider === "openai" ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }), temperature, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
    });
    const data = await res.json() as any;
    if (data.error) throw new Error(JSON.stringify(data.error));
    return { text: data.choices?.[0]?.message?.content ?? "", model, provider, durationMs: Date.now() - start };
  } catch (err: any) { return { text: "", model, provider, durationMs: Date.now() - start, error: err.message }; }
}

async function callModel(model: string, system: string, user: string, maxTokens: number, temperature: number): Promise<LLMCallResult> {
  const provider = detectProvider(model);
  switch (provider) {
    case "anthropic": return callAnthropic(model, system, user, maxTokens, temperature);
    case "gemini": return callGemini(model, system, user, maxTokens, temperature);
    case "openai":
    case "grok": return callOpenAICompatible(model, provider, system, user, maxTokens, temperature);
  }
}

// ── Judge ──

const JUDGE_SYSTEM = `You are a quality evaluator for a story engine's summary and polish outputs. Score on a structured rubric. 3 is average, 5 is exceptional, 1 is useless.

RUBRIC:
- specificity (1-5): Concrete, vivid details? Or vague abstractions and generic phrasing?
- usefulness (1-5): Would the downstream module (builder, scene writer) benefit from this?
- craft (1-5): Is the writing tight, vivid, and free of AI slop? Does it SHOW rather than TELL?
- fidelity (1-5): Does it accurately preserve the creative decisions from the input?

Return ONLY valid JSON: {"specificity": N, "usefulness": N, "craft": N, "fidelity": N, "reasoning": "1-2 sentences"}`;

interface JudgeScores { specificity: number; usefulness: number; craft: number; fidelity: number; composite: number; reasoning: string; }

async function judgeOutput(context: string, storyLabel: string, outputText: string): Promise<JudgeScores | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: JUDGE_MODEL, max_tokens: 300, temperature: 0, system: JUDGE_SYSTEM,
        messages: [{ role: "user", content: `Score this ${context} for the story "${storyLabel}".\n\nOUTPUT:\n${outputText.slice(0, 4000)}` }] }),
    });
    const data = await res.json() as any;
    if (data.error) { console.warn("[JUDGE] Error:", JSON.stringify(data.error).slice(0, 200)); return null; }
    const raw = data.content?.[0]?.text ?? "";
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) { console.warn("[JUDGE] No JSON in response:", raw.slice(0, 100)); return null; }
    const p = JSON.parse(match[0]);
    return { ...p, composite: Math.round((p.specificity + p.usefulness + p.craft + p.fidelity) / 4 * 100) / 100 };
  } catch (err) { console.warn("[JUDGE] Exception:", err); return null; }
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
  durationMs: number; valid: boolean; judge: JudgeScores | null; error?: string;
}

async function main() {
  const limit = createLimiter(CONCURRENCY);
  const results: RunResult[] = [];
  const total = MODELS.length * ALL_ROLES.length * STORIES.length * REPS;

  console.log("\n" + "=".repeat(60));
  console.log("  TIER B v2 — SUMMARY & POLISH MODEL COMPARISON");
  console.log("=".repeat(60));
  console.log(`Models:    ${MODELS.join(", ")}`);
  console.log(`Roles:     ${ALL_ROLES.join(", ")}`);
  console.log(`Stories:   ${STORIES.length}`);
  console.log(`Reps:      ${REPS}`);
  console.log(`Calls:     ${total} model + up to ${total} judge`);
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
            const call = await callModel(model, config.system, prompt, config.maxTokens, config.temperature);
            let valid = !call.error && call.text.length > 20;
            let text = call.text;
            if (valid && config.isJson) {
              text = extractJson(text);
              try { JSON.parse(text); } catch { valid = false; }
            }
            const short = model.replace(/-20\d{6}/, "").slice(0, 18);
            log(`  ${short.padEnd(18)} ${role.padEnd(17)} ${story.label.slice(0, 15).padEnd(15)} rep${rep + 1} ${call.error ? "ERR" : valid ? "OK" : "FAIL"} ${call.durationMs}ms`);
            results.push({ role, model, storyLabel: story.label, rep, durationMs: call.durationMs, valid, judge: null, error: call.error });
            (results[results.length - 1] as any)._text = text;
          }));
        }
      }
    }
  }
  await Promise.all(tasks);
  log(`Phase 1 done in ${((Date.now() - p1) / 1000).toFixed(1)}s`);

  // Judge
  const validResults = results.filter(r => r.valid);
  log(`Phase 2: Judging ${validResults.length} valid outputs with ${JUDGE_MODEL}...`);
  const p2 = Date.now();
  await Promise.all(validResults.map(r => limit(async () => {
    const config = ROLE_CONFIGS[r.role];
    r.judge = await judgeOutput(config.judgeContext, r.storyLabel, (r as any)._text);
  })));
  log(`Phase 2 done in ${((Date.now() - p2) / 1000).toFixed(1)}s`);

  // ── Results ──
  const pad = (s: string, n: number) => s.padEnd(n);
  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const lines: string[] = ["=".repeat(80), "  TIER B v2 — RESULTS", "=".repeat(80), ""];

  const summaryRoles: Role[] = ["hook_summary", "char_summary", "img_summary", "world_summary", "plot_summary"];
  const polishRoles: Role[] = ["premise_polish", "char_polish", "world_polish"];

  for (const [groupName, roles] of [["SUMMARIES", summaryRoles], ["POLISH", polishRoles]] as const) {
    lines.push("═".repeat(80));
    lines.push(`  ${groupName} — AGGREGATE BY MODEL`);
    lines.push("═".repeat(80));
    lines.push(pad("Model", 28) + pad("Composite", 11) + pad("Spec", 6) + pad("Use", 6) + pad("Craft", 7) + pad("Fidel", 7) + pad("Valid%", 8) + pad("Latency", 10));
    lines.push("-".repeat(83));

    const sorted = MODELS.slice().sort((a, b) => {
      const aScored = results.filter(r => (roles as Role[]).includes(r.role) && r.model === a && r.judge);
      const bScored = results.filter(r => (roles as Role[]).includes(r.role) && r.model === b && r.judge);
      return avg(bScored.map(r => r.judge!.composite)) - avg(aScored.map(r => r.judge!.composite));
    });

    for (const model of sorted) {
      const runs = results.filter(r => (roles as Role[]).includes(r.role) && r.model === model);
      const scored = runs.filter(r => r.judge);
      const validCount = runs.filter(r => r.valid).length;
      lines.push(
        pad(model.replace(/-20\d{6}/, ""), 28) +
        pad(scored.length > 0 ? avg(scored.map(r => r.judge!.composite)).toFixed(2) : "N/A", 11) +
        pad(scored.length > 0 ? avg(scored.map(r => r.judge!.specificity)).toFixed(1) : "-", 6) +
        pad(scored.length > 0 ? avg(scored.map(r => r.judge!.usefulness)).toFixed(1) : "-", 6) +
        pad(scored.length > 0 ? avg(scored.map(r => r.judge!.craft)).toFixed(1) : "-", 7) +
        pad(scored.length > 0 ? avg(scored.map(r => r.judge!.fidelity)).toFixed(1) : "-", 7) +
        pad(runs.length > 0 ? ((validCount / runs.length) * 100).toFixed(0) + "%" : "N/A", 8) +
        pad(runs.filter(r => !r.error).length > 0 ? (avg(runs.filter(r => !r.error).map(r => r.durationMs)) / 1000).toFixed(1) + "s" : "N/A", 10)
      );
    }
    lines.push("");
  }

  // Per-role breakdown
  lines.push("═".repeat(80));
  lines.push("  PER-ROLE BREAKDOWN");
  lines.push("═".repeat(80));
  for (const role of ALL_ROLES) {
    lines.push(`\n  ${role}`);
    lines.push(pad("  Model", 30) + pad("Composite", 11) + pad("Valid%", 8) + pad("Latency", 10));
    lines.push("  " + "-".repeat(55));
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
        pad("  " + model.replace(/-20\d{6}/, ""), 30) +
        pad(scored.length > 0 ? avg(scored.map(r => r.judge!.composite)).toFixed(2) : "N/A", 11) +
        pad(runs.length > 0 ? ((validCount / runs.length) * 100).toFixed(0) + "%" : "N/A", 8) +
        pad(runs.filter(r => !r.error).length > 0 ? (avg(runs.filter(r => !r.error).map(r => r.durationMs)) / 1000).toFixed(1) + "s" : "N/A", 10)
      );
    }
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  await mkdir("./data/blind-tests", { recursive: true });
  const reportPath = `./data/blind-tests/tier_b_v2_report_${ts}.txt`;
  await writeFile(reportPath, lines.join("\n"), "utf-8");
  await writeFile(`./data/blind-tests/tier_b_v2_raw_${ts}.json`, JSON.stringify(results, null, 2), "utf-8");

  console.log("\n" + lines.join("\n"));
  console.log(`\nReport: ${reportPath}`);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
