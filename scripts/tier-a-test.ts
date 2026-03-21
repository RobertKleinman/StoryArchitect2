#!/usr/bin/env tsx
/**
 * TIER A BACKGROUND ROLES — MODEL COMPARISON
 * ════════════════════════════════════════════
 * Tests cultural_summarizer, psych_consolidator, and scene_divergence
 * across fast-tier models to find optimal assignments.
 *
 * 6 models × 3 roles × 3 contracts × 3 reps = 162 calls + judge
 */

import "dotenv/config";
import { mkdir, writeFile } from "fs/promises";

import { CULTURAL_SUMMARIZER_SYSTEM, CULTURAL_SUMMARIZER_USER_TEMPLATE } from "../backend/services/culturalPrompts";
import { RESEARCH_CONTRACT_SCHEMA } from "../backend/services/culturalSchemas";
import { CONSOLIDATION_SYSTEM, CONSOLIDATION_USER_TEMPLATE, CONSOLIDATION_SCHEMA } from "../backend/services/consolidationPrompts";
import { SCENE_DIVERGENCE_SYSTEM, SCENE_DIVERGENCE_USER_TEMPLATE } from "../backend/services/scenePrompts";
import { SCENE_DIVERGENCE_SCHEMA } from "../backend/services/sceneSchemas";
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

const ALL_ROLES = ["summarizer", "consolidator", "scene_divergence"] as const;
type Role = (typeof ALL_ROLES)[number];

const JUDGE_MODEL = "claude-sonnet-4-6";
const REPS = 3;
const CONCURRENCY = 6;

// ── Synthetic test data ──

// cultural_summarizer inputs
const SUMMARIZER_CONTRACTS = [
  {
    label: "Hospital AI (hook→character)",
    lockedPacks: `HOOK PACK: A burned-out nurse discovers her hospital's AI triage system is quietly deprioritizing patients who can't pay. The only person who can help expose it is the engineer who built it — her estranged sister. Tone: grounded thriller with moral complexity. The protagonist operates from exhausted complicity, not righteous anger.`,
    module: "character",
    currentState: JSON.stringify({ protagonist_role: "nurse_whistleblower", antagonist_form: "institutional_system", sister_dynamic: "reluctant_alliance" }),
    constraintLedger: "setting: Contemporary US hospital\ntone: Grounded thriller\nprotagonist: Nurse, mid-30s, burned out\nantagonist: AI triage system (not a person)\nrelationship: Estranged sisters",
    psychologySummary: "Gravitates toward institutional critique. Prefers moral complexity over clear heroes. High engagement with power dynamics. Control orientation: director (wants to steer character details).",
    directedReferences: "(none)",
    previousBriefSummaries: "Hook module: algorithmic bias discovery, institutional loyalty vs family loyalty tension",
    negativeProfile: "Not a simple whistleblower story\nNot anti-technology\nNot a courtroom drama",
  },
  {
    label: "Catgirl Isekai (character→world)",
    lockedPacks: `HOOK PACK: Comedy-first isekai about a judgmental religious woman reincarnated as a catgirl. Cognitive dissonance engine.\nCHARACTER PACK: Margaret Chen, 52, died of heart attack mid-sermon about sinners. Now "Mira" — a petite catgirl with involuntary purring. Retains all memories. Internal monologue is her old judgmental voice clashing with her new body's instincts. Core contradiction: her cruelty came from loneliness, and this world keeps offering affection.`,
    module: "world",
    currentState: JSON.stringify({ world_tone: "wholesome_fantasy", comedy_style: "fish_out_of_water", protagonist_arc: "gradual_softening" }),
    constraintLedger: "tone: Comedy with heart\ngenre: Isekai reincarnation\nprotagonist: Retains old memories\nworld: Fantasy, genuinely kind",
    psychologySummary: "Enjoys subversion and irony. Wants comedy with emotional depth underneath. Manga pacing preferences. Explorer orientation — likes being surprised.",
    directedReferences: "(none)",
    previousBriefSummaries: "Character module: cognitive dissonance comedy, religious rigidity vs catgirl affection",
    negativeProfile: "Not mean-spirited toward religious people\nNot fanservice-focused\nNot edgy dark comedy",
  },
  {
    label: "Jock/Elf Prince (character→world)",
    lockedPacks: `HOOK PACK: Modern jock sold as slave to elf prince. Power inversion engine. Gay slow-burn romance.\nCHARACTER PACK: Tyler Reeves, 20, varsity wrestler, recruited from a college gym by interdimensional slavers. Built identity entirely around physical dominance — now worthless in a world of magic. Prince Caelindor, 847, collected Tyler as a curiosity. Genuinely doesn't understand human psychology. Their dynamic: Tyler's defiance amuses Caelindor; Caelindor's alien kindness confuses Tyler.`,
    module: "world",
    currentState: JSON.stringify({ character_dynamic: "power_inversion", relationship_arc: "slow_burn_from_ownership", prince_alignment: "morally_complex" }),
    constraintLedger: "protagonist: Modern jock, 20, muscular\nmaster: Elf prince, ancient\nrelationship: Slow-burn gay romance\nslavery: Institutional, not personal cruelty",
    psychologySummary: "Drawn to power dynamics and vulnerability in strong characters. Emotional complexity in erotic scenarios. Fantasy worldbuilding enthusiast. Director orientation for character details.",
    directedReferences: "(none)",
    previousBriefSummaries: "Character module: identity built on status hierarchy that no longer exists, agency within constraint",
    negativeProfile: "Not non-con apologia\nNot purely comedic\nNot a simple rescue arc",
  },
];

// psych_consolidator inputs
const CONSOLIDATOR_CONTRACTS = [
  {
    label: "Hospital AI — turn 4 signals",
    signalStore: JSON.stringify([
      { id: "s1", hypothesis: "Gravitates toward morally complex scenarios", confidence: 0.6, status: "active", category: "content_preferences", scope: "this_story", evidence: [{ turn: 1, event: "chose 'complicity' framing over 'heroic whistleblower'" }, { turn: 3, event: "rejected option that made nurse clearly righteous" }], adaptationConsequence: "Avoid clear hero/villain framing", contradictionCriteria: "User chooses a clearly heroic path" },
      { id: "s2", hypothesis: "Prefers grounded realism over dramatic spectacle", confidence: 0.4, status: "active", category: "tonal_risk", scope: "this_story", evidence: [{ turn: 2, event: "chose 'quiet documentation' over 'confrontation'" }], adaptationConsequence: "Keep scenes low-key and procedural", contradictionCriteria: "User asks for dramatic confrontation" },
      { id: "s3", hypothesis: "Interested in institutional critique", confidence: 0.5, status: "active", category: "content_preferences", scope: "this_genre", evidence: [{ turn: 1, event: "engaged deeply with how triage system works" }, { turn: 3, event: "asked about hospital hierarchy" }], adaptationConsequence: "Provide institutional detail in options", contradictionCriteria: "User shifts focus to personal drama exclusively" },
      { id: "s4", hypothesis: "Avoids clear heroes and villains", confidence: 0.35, status: "candidate", category: "content_preferences", scope: "this_story", evidence: [{ turn: 3, event: "rejected option framing nurse as hero" }], adaptationConsequence: "Present morally ambiguous options", contradictionCriteria: "User explicitly wants a hero protagonist" },
      { id: "s5", hypothesis: "Wants to direct character psychology details", confidence: 0.45, status: "active", category: "control_orientation", scope: "global", evidence: [{ turn: 2, event: "added specific detail about nurse's past" }, { turn: 3, event: "modified character motivation when offered" }], adaptationConsequence: "Offer character psychology steering options", contradictionCriteria: "User defers all character decisions to engine" },
    ], null, 2),
    recentReads: JSON.stringify([
      { turn: 3, read: "User chose the option emphasizing nurse's exhausted complicity. Rejected heroic framing. Added detail about nurse covering for system in past — suggests interest in moral compromise." },
      { turn: 4, read: "User asked about hospital power structure. Engaged with institutional detail. Chose estranged sister as reluctant ally over eager whistleblower friend." },
    ], null, 2),
    heuristics: JSON.stringify({ avgResponseTime: 45, optionPickRate: 0.7, freeTextRate: 0.3, turnsInModule: 4 }),
    probeOutcome: "",
    module: "character",
    turnNumber: "4",
  },
  {
    label: "Catgirl Isekai — turn 3 signals",
    signalStore: JSON.stringify([
      { id: "s1", hypothesis: "Enjoys ironic humor and subversion", confidence: 0.55, status: "active", category: "content_preferences", scope: "this_story", evidence: [{ turn: 1, event: "laughed at premise inversion" }, { turn: 2, event: "chose most ironic character trait" }], adaptationConsequence: "Lead with ironic contradictions", contradictionCriteria: "User prefers straightforward comedy" },
      { id: "s2", hypothesis: "Wants emotional depth beneath comedy", confidence: 0.4, status: "candidate", category: "tonal_risk", scope: "this_story", evidence: [{ turn: 2, event: "engaged with 'why was she so mean' backstory option" }], adaptationConsequence: "Include emotional undertones in comedic options", contradictionCriteria: "User skips all emotional content" },
      { id: "s3", hypothesis: "Prefers manga-style pacing and visual gags", confidence: 0.3, status: "candidate", category: "content_preferences", scope: "this_story", evidence: [{ turn: 1, event: "mentioned manga in seed input" }], adaptationConsequence: "Use manga pacing beats", contradictionCriteria: "User requests novelistic pacing" },
      { id: "s4", hypothesis: "Explorer orientation — likes being surprised", confidence: 0.5, status: "active", category: "control_orientation", scope: "global", evidence: [{ turn: 1, event: "chose unexpected option" }, { turn: 3, event: "said 'surprise me' when given choice" }], adaptationConsequence: "Include wildcard options, fewer safe choices", contradictionCriteria: "User consistently picks most predictable option" },
    ], null, 2),
    recentReads: JSON.stringify([
      { turn: 2, read: "User engaged with backstory depth option. Chose 'she was lonely' over 'she was just mean.' Suggests interest in redemption arc with emotional grounding." },
      { turn: 3, read: "User said 'surprise me' when offered 3 world options. Explorer behavior confirmed. Also laughed at involuntary purring detail — physical comedy resonates." },
    ], null, 2),
    heuristics: JSON.stringify({ avgResponseTime: 22, optionPickRate: 0.5, freeTextRate: 0.5, turnsInModule: 3 }),
    probeOutcome: "",
    module: "character",
    turnNumber: "3",
  },
  {
    label: "Jock/Elf Prince — turn 5 signals",
    signalStore: JSON.stringify([
      { id: "s1", hypothesis: "Drawn to power dynamics and vulnerability", confidence: 0.7, status: "stable", category: "content_preferences", scope: "this_story", evidence: [{ turn: 1, event: "seed focuses on power inversion" }, { turn: 2, event: "chose most vulnerable option for jock" }, { turn: 4, event: "added detail about jock's fear" }], adaptationConsequence: "Foreground power asymmetry in every option", contradictionCriteria: "User equalizes power early" },
      { id: "s2", hypothesis: "Wants slow-burn emotional complexity in erotic tension", confidence: 0.55, status: "active", category: "tonal_risk", scope: "this_story", evidence: [{ turn: 3, event: "rejected fast-burn sexual tension option" }, { turn: 4, event: "chose 'confused by kindness' over 'attracted immediately'" }], adaptationConsequence: "Delay explicit content, build emotional charge", contradictionCriteria: "User asks for immediate sexual content" },
      { id: "s3", hypothesis: "Values detailed fantasy worldbuilding", confidence: 0.45, status: "active", category: "content_preferences", scope: "this_genre", evidence: [{ turn: 2, event: "asked about elf society structure" }, { turn: 5, event: "engaged with caste system details" }], adaptationConsequence: "Include worldbuilding texture in options", contradictionCriteria: "User skips all worldbuilding" },
      { id: "s4", hypothesis: "Director orientation for character psychology", confidence: 0.6, status: "active", category: "control_orientation", scope: "global", evidence: [{ turn: 2, event: "modified Tyler's reaction" }, { turn: 3, event: "specified prince's motivation" }, { turn: 4, event: "added backstory detail" }], adaptationConsequence: "Offer character steering options prominently", contradictionCriteria: "User defers character decisions" },
      { id: "s5", hypothesis: "Interested in institutional slavery mechanics", confidence: 0.35, status: "candidate", category: "content_preferences", scope: "this_story", evidence: [{ turn: 5, event: "asked how slavery is legally structured" }], adaptationConsequence: "Provide institutional detail about elf slavery", contradictionCriteria: "User treats slavery as backdrop only" },
      { id: "s6", hypothesis: "Likes vulnerability in strong characters", confidence: 0.5, status: "active", category: "content_preferences", scope: "this_story", evidence: [{ turn: 2, event: "emphasized Tyler's physical strength" }, { turn: 4, event: "added fear detail despite muscle" }], adaptationConsequence: "Contrast physical strength with emotional vulnerability", contradictionCriteria: "User makes Tyler emotionally tough too" },
    ], null, 2),
    recentReads: JSON.stringify([
      { turn: 4, read: "User specified that Tyler tries to hide fear with bravado. Director behavior — specific character psychology. Also chose option where prince notices the bravado, suggesting interest in prince's perceptiveness." },
      { turn: 5, read: "User asked detailed questions about elf caste system and how slavery fits. Worldbuilding engagement high. Chose option where Tyler's athleticism is irrelevant to elf magic — reinforcing power inversion." },
    ], null, 2),
    heuristics: JSON.stringify({ avgResponseTime: 55, optionPickRate: 0.6, freeTextRate: 0.4, turnsInModule: 5 }),
    probeOutcome: "",
    module: "world",
    turnNumber: "5",
  },
];

// scene_divergence inputs
const SCENE_DIVERGENCE_CONTRACTS = [
  {
    label: "Hospital — nurse discovers evidence",
    scenePlan: JSON.stringify({ scene_id: "s3", title: "The Override Log", objective: "Nurse discovers evidence of algorithmic bias in the triage override logs", pov: "nurse", pacing: "slow_build", emotional_arc: "growing dread" }),
    beat: JSON.stringify({ type: "revelation", tension: "Nurse finds statistical pattern showing low-income patients consistently triaged lower", stakes: "If she's right, the hospital she's dedicated her career to is quietly killing people" }),
    previousScene: "Nurse finished a 12-hour shift. Lost a patient who should have been prioritized. Something felt wrong about the triage score.",
    characterProfiles: JSON.stringify([{ name: "Sarah Chen", role: "protagonist", traits: ["burned out", "detail-oriented", "conflict-avoidant"] }]),
    worldSummary: "Modern US hospital. Night shift. Electronic health records system. Override logs accessible from nurse stations but rarely checked.",
    psychologySignals: "User prefers grounded realism. Wants moral complexity. Director for character details.",
  },
  {
    label: "Catgirl — first kindness received",
    scenePlan: JSON.stringify({ scene_id: "s5", title: "The Headpat Incident", objective: "Margaret/Mira receives genuine kindness from a stranger and her catgirl body reacts before her mind can resist", pov: "mira", pacing: "comedic_beat", emotional_arc: "resistance crumbling" }),
    beat: JSON.stringify({ type: "character_moment", tension: "A child pets her ears and she purrs involuntarily — the first time someone has touched her with affection in decades", stakes: "Her entire self-image as someone above physical affection" }),
    previousScene: "Mira woke up in the fantasy world. Spent the morning refusing to acknowledge her tail. Tried to pray and accidentally meowed.",
    characterProfiles: JSON.stringify([{ name: "Mira (Margaret Chen)", role: "protagonist", traits: ["judgmental", "secretly lonely", "involuntary cat reflexes"] }]),
    worldSummary: "Wholesome fantasy village. Market square. Catfolk are common and respected. Physical affection between strangers is normal.",
    psychologySignals: "Explorer orientation. Enjoys ironic comedy with emotional depth. Manga pacing.",
  },
  {
    label: "Jock/Elf — first night in captivity",
    scenePlan: JSON.stringify({ scene_id: "s2", title: "The Gilded Cage", objective: "Tyler's first night in the prince's household — luxury that feels like a trap", pov: "tyler", pacing: "atmospheric", emotional_arc: "disorientation to quiet defiance" }),
    beat: JSON.stringify({ type: "atmosphere", tension: "Everything is beautiful and comfortable but Tyler can't leave. The bed is softer than anything he's ever slept on. He can't sleep.", stakes: "Tyler's identity — he's never been somewhere he can't fight his way out of" }),
    previousScene: "Tyler was presented to Prince Caelindor in the throne room. The prince examined him like a curiosity, spoke to him in perfect English, and assigned him quarters.",
    characterProfiles: JSON.stringify([{ name: "Tyler Reeves", role: "protagonist", traits: ["physically powerful", "identity built on dominance", "hiding fear with bravado"] }, { name: "Prince Caelindor", role: "deuteragonist", traits: ["ancient", "curious about humans", "alien kindness"] }]),
    worldSummary: "Elven palace. Tyler's quarters are luxurious — living wood walls, bioluminescent lighting, clothing that fits perfectly despite no measurements. Servants are polite but clearly guard the exits.",
    psychologySignals: "Director for character psychology. Values power dynamics and vulnerability. Slow-burn preference.",
  },
];

// ── Provider callers (same as other tests) ──

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

// Strip union types like ["object", "null"] → "object" for OpenAI strict mode
function fixUnionTypes(obj: any): any {
  if (Array.isArray(obj)) return obj.map(fixUnionTypes);
  if (obj && typeof obj === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === "type" && Array.isArray(v)) {
        // Convert ["object", "null"] to "object" for strict mode
        out[k] = v.find((t: string) => t !== "null") ?? v[0];
      } else {
        out[k] = fixUnionTypes(v);
      }
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
    const preparedSchema = provider === "openai" ? fixUnionTypes(enforceAllRequired(schema)) : schema;
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        ...(provider === "openai" ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }),
        temperature,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        response_format: { type: "json_schema", json_schema: { name: "research_output", strict: true, schema: preparedSchema } },
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

// ── Build prompts per role ──

interface RoleConfig {
  system: string;
  buildPrompt: (contract: any) => string;
  schema: Record<string, unknown>;
  maxTokens: number;
  temperature: number;
  contracts: any[];
  validateFn: (raw: string) => { valid: boolean; errors: string[] };
  judgeContext: string; // what the judge should evaluate
}

const ROLE_CONFIGS: Record<Role, RoleConfig> = {
  summarizer: {
    system: CULTURAL_SUMMARIZER_SYSTEM,
    buildPrompt: (c) => CULTURAL_SUMMARIZER_USER_TEMPLATE
      .replace("{{LOCKED_PACKS}}", c.lockedPacks)
      .replace("{{MODULE}}", c.module)
      .replace("{{CURRENT_STATE}}", c.currentState)
      .replace("{{CONSTRAINT_LEDGER}}", c.constraintLedger)
      .replace("{{PSYCHOLOGY_SUMMARY}}", c.psychologySummary)
      .replace("{{DIRECTED_REFERENCES}}", c.directedReferences)
      .replace("{{PREVIOUS_BRIEF_SUMMARIES}}", c.previousBriefSummaries)
      .replace("{{NEGATIVE_PROFILE}}", c.negativeProfile),
    schema: RESEARCH_CONTRACT_SCHEMA,
    maxTokens: 1500,
    temperature: 0.3,
    contracts: SUMMARIZER_CONTRACTS,
    validateFn: (raw) => {
      try {
        const p = JSON.parse(raw);
        const errors: string[] = [];
        if (!p.storyEssence) errors.push("Missing storyEssence");
        if (!p.emotionalCore) errors.push("Missing emotionalCore");
        if (!Array.isArray(p.confirmedElements) || p.confirmedElements.length === 0) errors.push("No confirmedElements");
        if (!Array.isArray(p.openQuestions) || p.openQuestions.length === 0) errors.push("No openQuestions");
        return { valid: errors.length === 0, errors };
      } catch { return { valid: false, errors: ["Invalid JSON"] }; }
    },
    judgeContext: "creative-state summarization (compressing project state into a research contract)",
  },
  consolidator: {
    system: CONSOLIDATION_SYSTEM,
    buildPrompt: (c) => CONSOLIDATION_USER_TEMPLATE
      .replace("{{SIGNAL_STORE_JSON}}", c.signalStore)
      .replace("{{RECENT_READS_JSON}}", c.recentReads)
      .replace("{{HEURISTICS_JSON}}", c.heuristics)
      .replace("{{PROBE_OUTCOME_SECTION}}", c.probeOutcome)
      .replace("{{MODULE}}", c.module)
      .replace("{{TURN_NUMBER}}", c.turnNumber),
    schema: CONSOLIDATION_SCHEMA,
    maxTokens: 2048,
    temperature: 0.3,
    contracts: CONSOLIDATOR_CONTRACTS,
    validateFn: (raw) => {
      try {
        const p = JSON.parse(raw);
        const errors: string[] = [];
        if (!Array.isArray(p.updatedSignals)) errors.push("Missing updatedSignals");
        else if (p.updatedSignals.length === 0) errors.push("Empty updatedSignals");
        else {
          for (let i = 0; i < p.updatedSignals.length; i++) {
            const s = p.updatedSignals[i];
            if (!s.id || !s.hypothesis || !s.status) errors.push(`Signal ${i}: missing id/hypothesis/status`);
          }
        }
        return { valid: errors.length === 0, errors };
      } catch { return { valid: false, errors: ["Invalid JSON"] }; }
    },
    judgeContext: "psychology signal consolidation (merging, pruning, and sharpening user behavior signals)",
  },
  scene_divergence: {
    system: SCENE_DIVERGENCE_SYSTEM,
    buildPrompt: (c) => SCENE_DIVERGENCE_USER_TEMPLATE
      .replace("{{SCENE_PLAN_JSON}}", c.scenePlan)
      .replace("{{BEAT_JSON}}", c.beat)
      .replace("{{PREVIOUS_SCENE_SUMMARY}}", c.previousScene)
      .replace("{{CHARACTER_PROFILES_JSON}}", c.characterProfiles)
      .replace("{{WORLD_SUMMARY}}", c.worldSummary)
      .replace("{{PSYCHOLOGY_SIGNALS}}", c.psychologySignals),
    schema: SCENE_DIVERGENCE_SCHEMA,
    maxTokens: 2048,
    temperature: 0.8,
    contracts: SCENE_DIVERGENCE_CONTRACTS,
    validateFn: (raw) => {
      try {
        const p = JSON.parse(raw);
        const errors: string[] = [];
        if (!Array.isArray(p.alternatives) || p.alternatives.length === 0) errors.push("No alternatives");
        if (typeof p.worth_asking !== "boolean") errors.push("Missing worth_asking");
        for (let i = 0; i < (p.alternatives ?? []).length; i++) {
          const a = p.alternatives[i];
          if (!a.label || !a.sketch) errors.push(`Alt ${i}: missing label/sketch`);
        }
        return { valid: errors.length === 0, errors };
      } catch { return { valid: false, errors: ["Invalid JSON"] }; }
    },
    judgeContext: "scene staging alternatives (different ways to stage the same plot beat)",
  },
};

// ── Judge ──

const JUDGE_SYSTEM = `You are a quality evaluator for a story engine's internal outputs. Score on a structured rubric. 3 is average, 5 is exceptional, 1 is useless.

RUBRIC:
- specificity (1-5): Concrete, actionable details? Or vague abstractions?
- usefulness (1-5): Would the downstream system (researcher, clarifier, or builder) benefit from this output?
- accuracy (1-5): Does the output correctly interpret and process the input data?
- completeness (1-5): Does it cover all important aspects without padding?

Return ONLY valid JSON: {"specificity": N, "usefulness": N, "accuracy": N, "completeness": N, "reasoning": "1-2 sentences"}`;

interface JudgeScores { specificity: number; usefulness: number; accuracy: number; completeness: number; composite: number; reasoning: string; }

async function judgeOutput(role: string, context: string, contractLabel: string, outputText: string): Promise<JudgeScores | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: JUDGE_MODEL, max_tokens: 300, temperature: 0, system: JUDGE_SYSTEM,
        messages: [{ role: "user", content: `Score this ${context} output for "${contractLabel}".\n\nOUTPUT:\n${outputText.slice(0, 6000)}` }],
      }),
    });
    const data = await res.json() as any;
    if (data.error) return null;
    const match = (data.content?.[0]?.text ?? "").match(/\{[\s\S]*\}/);
    if (!match) return null;
    const p = JSON.parse(match[0]);
    return { ...p, composite: Math.round((p.specificity + p.usefulness + p.accuracy + p.completeness) / 4 * 100) / 100 };
  } catch { return null; }
}

// ── Concurrency + logging ──

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
  contractLabel: string; model: string; role: Role;
  rep: number; durationMs: number; valid: boolean; judge: JudgeScores | null; error?: string;
}

async function main() {
  const limit = createLimiter(CONCURRENCY);
  const results: RunResult[] = [];
  const totalCalls = MODELS.length * ALL_ROLES.length * 3 * REPS; // 3 contracts each

  console.log("\n" + "=".repeat(60));
  console.log("  TIER A — BACKGROUND ROLE MODEL COMPARISON");
  console.log("=".repeat(60));
  console.log(`Models:    ${MODELS.join(", ")}`);
  console.log(`Roles:     ${ALL_ROLES.join(", ")}`);
  console.log(`Contracts: 3 per role`);
  console.log(`Reps:      ${REPS}`);
  console.log(`Calls:     ${totalCalls} model + up to ${totalCalls} judge`);
  console.log("=".repeat(60) + "\n");

  log(`Phase 1: Running ${totalCalls} model calls...`);
  const p1Start = Date.now();

  const tasks: Promise<void>[] = [];
  for (const role of ALL_ROLES) {
    const config = ROLE_CONFIGS[role];
    for (const contract of config.contracts) {
      const prompt = config.buildPrompt(contract);
      for (const model of MODELS) {
        for (let rep = 0; rep < REPS; rep++) {
          tasks.push(limit(async () => {
            const call = await callModel(model, config.system, prompt, config.schema, config.maxTokens, config.temperature);
            const validation = call.error ? { valid: false, errors: [call.error] } : config.validateFn(call.text);
            const shortModel = model.replace(/-20\d{6}/, "").slice(0, 18);
            const status = call.error ? "ERR" : validation.valid ? "OK" : "SCHEMA_FAIL";
            log(`  ${shortModel.padEnd(18)} ${role.padEnd(17)} ${contract.label.slice(0, 20).padEnd(20)} rep${rep + 1} ${status} ${call.durationMs}ms`);
            results.push({
              contractLabel: contract.label, model, role, rep,
              durationMs: call.durationMs, valid: validation.valid, judge: null, error: call.error,
            });
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
  await Promise.all(validResults.map(r =>
    limit(async () => {
      const config = ROLE_CONFIGS[r.role];
      r.judge = await judgeOutput(r.role, config.judgeContext, r.contractLabel, (r as any)._text);
    })
  ));
  log(`Phase 2 complete in ${((Date.now() - p2Start) / 1000).toFixed(1)}s`);

  // ── Results ──
  const lines: string[] = ["=".repeat(70), "  TIER A — RESULTS", "=".repeat(70), ""];
  const pad = (s: string, n: number) => s.padEnd(n);
  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  for (const role of ALL_ROLES) {
    lines.push("═".repeat(70));
    lines.push(`  ${role.toUpperCase()}`);
    lines.push("═".repeat(70));
    lines.push(pad("Model", 28) + pad("Composite", 11) + pad("Spec", 6) + pad("Use", 6) + pad("Acc", 6) + pad("Comp", 6) + pad("Schema%", 9) + pad("Latency", 10) + "Errors");
    lines.push("-".repeat(88));

    const modelStats: Record<string, any> = {};
    for (const model of MODELS) {
      const runs = results.filter(r => r.model === model && r.role === role);
      const scored = runs.filter(r => r.judge);
      const validCount = runs.filter(r => r.valid).length;
      modelStats[model] = {
        composite: avg(scored.map(r => r.judge!.composite)),
        spec: avg(scored.map(r => r.judge!.specificity)),
        use: avg(scored.map(r => r.judge!.usefulness)),
        acc: avg(scored.map(r => r.judge!.accuracy)),
        comp: avg(scored.map(r => r.judge!.completeness)),
        schema: runs.length > 0 ? ((validCount / runs.length) * 100).toFixed(0) + "%" : "N/A",
        latency: runs.filter(r => !r.error).length > 0 ? (avg(runs.filter(r => !r.error).map(r => r.durationMs)) / 1000).toFixed(1) + "s" : "N/A",
        errors: runs.filter(r => r.call?.error || r.error).length,
      };
    }

    const sorted = MODELS.slice().sort((a, b) => modelStats[b].composite - modelStats[a].composite);
    for (const model of sorted) {
      const s = modelStats[model];
      const shortModel = model.replace(/-20\d{6}/, "");
      lines.push(pad(shortModel, 28) + pad(s.composite.toFixed(2), 11) + pad(s.spec.toFixed(1), 6) + pad(s.use.toFixed(1), 6) + pad(s.acc.toFixed(1), 6) + pad(s.comp.toFixed(1), 6) + pad(s.schema, 9) + pad(s.latency, 10) + s.errors);
    }
    lines.push("");
  }

  // Save
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dir = "./data/blind-tests";
  await mkdir(dir, { recursive: true });
  const reportPath = `${dir}/tier_a_report_${ts}.txt`;
  const jsonPath = `${dir}/tier_a_raw_${ts}.json`;
  await Promise.all([
    writeFile(reportPath, lines.join("\n"), "utf-8"),
    writeFile(jsonPath, JSON.stringify(results, null, 2), "utf-8"),
  ]);

  console.log("\n" + lines.join("\n"));
  console.log(`\nReport: ${reportPath}`);
  console.log(`Raw JSON: ${jsonPath}`);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
