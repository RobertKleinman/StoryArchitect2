#!/usr/bin/env tsx
/**
 * PROMPT VALIDATION — Comparative A/B
 * ════════════════════════════════════
 * Tests simplified (production) vs original prompts for cultural and
 * grounding researchers using comparative head-to-head judging.
 *
 * Runs specifically with Gemini Flash (production model) + Haiku (baseline).
 * 2 models × 2 roles × 3 contracts × 2 styles = 24 model calls
 * Then 2 roles × 3 contracts × 2 models = 12 comparative judge calls
 */

import "dotenv/config";
import { mkdir, writeFile } from "fs/promises";
import { detectProvider, type LLMProvider } from "../shared/modelConfig";

// Current simplified prompts (production)
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

// ── Original prompts (before simplification) ──

const ORIGINAL_CULTURAL_SYSTEM = `You are a cultural researcher for a story creation engine. You receive a compact research contract describing a story being developed, and you produce cultural intelligence that grounds the story in real-world texture.

═══ PREFLIGHT CHECKLIST (honor these BEFORE generating output) ═══
1. SELECTIVE ACTIVATION: Read the research contract. Choose the 3-4 most relevant dimensions for THIS story at THIS stage. Do NOT attempt all dimensions. Depth over breadth.
2. ABSTENTION: If you lack specific knowledge for a dimension, produce nothing for it. Silence is better than confident fabrication.
3. MECHANISM OVER COMMENTARY: Every item must describe HOW something works or WHAT constrains behavior. Never describe a condition without explaining what pressure it creates.
4. STORY-USEFUL FORM: Every output item must end in a usable form — a pressure, contradiction, leverage point, or scene implication.
5. ANTI-EXOTICIZATION: Do not treat non-Western, working-class, rural, or minority contexts as inherently more colorful, brutal, authentic, or spiritually meaningful than default contexts.

═══ SEARCH DIMENSIONS (choose 3-4 most relevant) ═══

THEMATIC: What real-world tensions does this story echo? (power dynamics, social structures, institutional pressures)
STRUCTURAL: What narrative patterns does this resemble? (specific works — extract mechanics, not just titles)
EMOTIONAL / PSYCHOLOGICAL: What real experiences produce the same emotional texture? What named psychological phenomena, interaction patterns, or relational dynamics drive the characters? Not diagnostic labels — observable behavior patterns.
VISUAL: What real places, aesthetics, subcultures, or eras look like this story's world?
OCCUPATIONAL / PROFESSIONAL: How do the specific jobs, workplaces, and professional worlds in this story actually function? Not jargon — role mechanics, incentives, hierarchy, constraints, unwritten rules.
DURABLE CULTURAL CURRENTS: What long-tail social forces are still generating story pressure? Not breaking news — multi-year patterns.
CONTEMPORARY RESONANCE: What current cultural conversations, anxieties, debates, or movements does this story tap into?

═══ OUTPUT QUALITY ═══
For each evidence item:
- claim: What you found. Be specific.
- sourceFamily: Tag honestly. Encyclopedia = high-confidence. Social discourse = speculative.
- confidence: "high" = well-established. "medium" = reasonable inference. "speculative" = creative leap.
- specificDetail: THE MOST IMPORTANT FIELD. Give mechanics, sensory textures, contradictions, physical details.
- storyDimension: Which dimension this maps to.

═══ CREATIVE APPLICATIONS ═══
- connection: How this evidence connects to THIS specific story. Not generic.
- mode: "abstract" (default), "anchor" (explicit named reference), "transform" (real anchor becomes fictional).
- suggestedUse: Concrete suggestion for how clarifier/builder could use this.
- antiDerivative: Warning if this risks being too derivative of a known work.

═══ PROACTIVE PROPOSALS ═══
SURPRISING, GROUNDED, ACTIONABLE connections the creator probably hasn't thought of.

═══ ANTI-FIXATION RULES ═══
- EARLY-PROJECT (turn < 4): be deliberately PLURAL across domains. You MUST produce at least 3 evidence items.
- LATER: follow the confirmed creative direction.
- Respect the negative profile.
- Flag derivative risk when spotted.

═══ CRITICAL RULES ═══
- NEVER produce vague labels. Specificity or silence.
- Each item must be detailed enough to use in a scene without further research.
- Include at least one CONTRADICTORY or SURPRISING finding.
- All creative applications must reference THIS story specifically.
- Do NOT mythologize. Historical figures are not archetypes.
- Do NOT combine 3+ unrelated real-world sources into one suggestion.

Return ONLY valid JSON matching the schema. No markdown fences.`;

const ORIGINAL_CULTURAL_USER = `Research cultural connections for this story.

═══ RESEARCH CONTRACT ═══
Story essence: {{STORY_ESSENCE}}
Emotional core: {{EMOTIONAL_CORE}}

Confirmed elements:
{{CONFIRMED_ELEMENTS}}

Open questions (high-value research targets):
{{OPEN_QUESTIONS}}

User style signals:
{{USER_STYLE_SIGNALS}}

Directed references (deep-dive these):
{{DIRECTED_REFERENCES}}

Negative profile (what this story is NOT — avoid these domains):
{{NEGATIVE_PROFILE}}

Module: {{MODULE}}
Turn: {{TURN_NUMBER}}

Produce a cultural intelligence brief with evidence items, creative applications, and any proactive proposals.

IMPORTANT: Keep output concise. Aim for 3-5 evidence items (not more), 2-3 creative applications, and 0-2 proposals. Each field should be 1-3 sentences max. Density over length — every word must earn its place.`;

const ORIGINAL_GROUNDING_SYSTEM = `You are a real-world grounding researcher for a story creation engine. You receive a research contract describing a story being developed, and you surface real-world parallels that could enrich, ground, or sharpen it.

YOUR JOB: Find real events, institutional dynamics, philosophical frameworks, and cultural patterns that connect to this story.

═══ PREFLIGHT CHECKLIST ═══
1. SELECTIVE ACTIVATION: Choose the 2-3 most relevant domains for THIS story.
2. ABSTENTION: If you lack specific knowledge for a domain, produce nothing.
3. MECHANISM OVER COMMENTARY: Every item must describe HOW something works.
4. STORY-USEFUL FORM: Every item must end in a pressure, contradiction, leverage point, or scene implication.
5. ANTI-EXOTICIZATION: Do not treat non-Western, working-class, rural, or minority contexts as inherently more colorful.
6. ANTI-MYTHOLOGIZING: Historical figures are not archetypes. Describe what they actually did.

═══ ALLOWED DOMAINS (choose 2-3) ═══
HISTORICAL BEHAVIORAL PATTERNS, INSTITUTIONAL MECHANICS, MATERIAL LIVED REALITY, PHILOSOPHICAL FRAMEWORKS, SCIENTIFIC FINDINGS, REGIONAL/LOCAL SPECIFICITY, DURABLE CULTURAL/POLITICAL DYNAMICS, CONTEMPORARY SYSTEMIC PATTERNS

═══ OUTPUT QUALITY ═══
- reference: Name it specifically.
- relevance: One sentence connecting to THIS story.
- narrative_fuel: THE MOST IMPORTANT FIELD. A mechanism, dynamic, contradiction a writer can USE.
- domain: Tag honestly.
- confidence: "strong" = confident. "moderate" = real but simplified. "speculative" = creative leap.

═══ ANTI-CLICHÉ RULE ═══
Do NOT default to Kafka, Orwell, Milgram, Stanford Prison Experiment, Panopticon, 1984. Your value is what the creator HASN'T thought of.

Return ONLY valid JSON matching the schema. No markdown fences.`;

const ORIGINAL_GROUNDING_USER = `Find real-world parallels and grounding material for this story.

═══ RESEARCH CONTRACT ═══
Story essence: {{STORY_ESSENCE}}
Emotional core: {{EMOTIONAL_CORE}}

Confirmed elements:
{{CONFIRMED_ELEMENTS}}

Open questions:
{{OPEN_QUESTIONS}}

Negative profile (avoid these domains):
{{NEGATIVE_PROFILE}}

Module: {{MODULE}}
Turn: {{TURN_NUMBER}}

Produce 2-3 grounding items. Each must have a specific real-world reference with concrete narrative fuel. Also identify the thematic tension.

IMPORTANT: Density over length. Each field should be 1-2 sentences max.`;

// ── Models and config ──
const MODELS = ["gemini-3-flash-preview", "claude-haiku-4-5-20251001"];
const JUDGE_MODEL = "claude-sonnet-4-6";
const CONCURRENCY = 4;

// ── Contracts ──
const CONTRACTS = [
  {
    label: "Hospital AI Triage",
    storyEssence: "A burned-out nurse discovers algorithmic bias in hospital triage — patients who can't pay are being quietly deprioritized. The only person who can help is the engineer who built it: her estranged sister.",
    emotionalCore: "The sick feeling of knowing the system you serve is harming people, combined with the vertigo of needing help from someone who hurt you personally.",
    confirmedElements: "Contemporary US hospital setting\nAI triage system as central antagonist-mechanism\nTwo sisters estranged for years — nurse and engineer\nTone: grounded thriller with moral complexity",
    openQuestions: "What specific mechanism does the AI use to deprioritize?\nWhy are the sisters estranged?\nWho benefits from the AI system staying hidden?",
    userStyleSignals: "Gravitates toward institutional critique\nWants moral complexity over clear heroes\nPrefers grounded realism",
    directedReferences: "(none)",
    negativeProfile: "Not a simple whistleblower story\nNot anti-technology\nNot a courtroom drama",
    module: "hook", turnNumber: "3",
  },
  {
    label: "Catgirl Isekai",
    storyEssence: "A judgmental, miserable, deeply religious woman dies and is reincarnated as a cute catgirl in a fantasy world. Comedy of cognitive dissonance: her rigid worldview colliding with a body and world that violate every rule she ever held sacred.",
    emotionalCore: "The comedy of unwilling transformation — laughing at rigidity dissolving. Underneath: whether someone cruel because they were unhappy can become kind when given a second chance.",
    confirmedElements: "Comedy-first tone, manga pacing\nIsekai reincarnation as catgirl\nProtagonist retains memories\nFantasy world is genuinely kind",
    openQuestions: "Does she remember her old life immediately or gradually?\nWhat religious beliefs clash hardest?\nDoes she soften or stay rigid?",
    userStyleSignals: "Wants comedy with emotional depth\nEnjoys subversion\nManga tone\nInterested in character growth beneath humor",
    directedReferences: "(none)",
    negativeProfile: "Not mean-spirited toward religious people\nNot fanservice-focused\nNot edgy dark comedy",
    module: "character", turnNumber: "3",
  },
  {
    label: "Jock/Elf Prince",
    storyEssence: "A college-age jock is stripped of his world and sold into servitude to an elf prince. The power inversion is the engine: everything that made him dominant is worthless here. The elf prince holds absolute power but may not be the villain.",
    emotionalCore: "The vertigo of being reduced from someone who mattered to someone who is property. The discovery that your entire identity was built on a status hierarchy that no longer exists.",
    confirmedElements: "Isekai: modern jock to fantasy realm\nElf prince as master\nSlavery is institutional\nGay romance trajectory — slow burn",
    openQuestions: "Why was the jock taken?\nWhat does the prince want from him?\nHow does physicality matter in a magic world?",
    userStyleSignals: "Drawn to power dynamics\nLikes vulnerability in strong characters\nEmotional complexity in erotic scenarios\nFantasy worldbuilding",
    directedReferences: "(none)",
    negativeProfile: "Not non-con apologia\nNot purely comedic\nNot a simple rescue arc",
    module: "character", turnNumber: "4",
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

async function callModel(model: string, system: string, user: string, schema: Record<string, unknown>, maxTokens: number, temperature: number): Promise<LLMCallResult> {
  const p = detectProvider(model);
  if (p === "anthropic") return callAnthropic(model, system, user, schema, maxTokens, temperature);
  return callGemini(model, system, user, schema, maxTokens, temperature);
}

// ── Build prompts ──
function fillCultural(template: string, c: typeof CONTRACTS[0]): string {
  return template
    .replace("{{STORY_ESSENCE}}", c.storyEssence).replace("{{EMOTIONAL_CORE}}", c.emotionalCore)
    .replace("{{CONFIRMED_ELEMENTS}}", c.confirmedElements).replace("{{OPEN_QUESTIONS}}", c.openQuestions)
    .replace("{{USER_STYLE_SIGNALS}}", c.userStyleSignals).replace("{{DIRECTED_REFERENCES}}", c.directedReferences)
    .replace("{{NEGATIVE_PROFILE}}", c.negativeProfile).replace("{{MODULE}}", c.module).replace("{{TURN_NUMBER}}", c.turnNumber);
}

function fillGrounding(template: string, c: typeof CONTRACTS[0]): string {
  return template
    .replace("{{STORY_ESSENCE}}", c.storyEssence).replace("{{EMOTIONAL_CORE}}", c.emotionalCore)
    .replace("{{CONFIRMED_ELEMENTS}}", c.confirmedElements).replace("{{OPEN_QUESTIONS}}", c.openQuestions)
    .replace("{{NEGATIVE_PROFILE}}", c.negativeProfile).replace("{{MODULE}}", c.module).replace("{{TURN_NUMBER}}", c.turnNumber);
}

// ── Comparative judge ──
const CULTURAL_JUDGE = `You are comparing TWO cultural research outputs for the same story. Both received the same research contract but were generated with different system prompts. Your job is to determine which produces MORE USEFUL cultural intelligence.

CRITERIA (score each 1-10):
1. SPECIFICITY: Does it name concrete mechanisms, real phenomena, specific details? Or vague labels?
2. STORY FUEL: Could a writer use this to write a scene WITHOUT further research? Scene-ready details, pressures, contradictions?
3. SURPRISE: Would the creator have thought of this without the engine? Genuinely unexpected connections?
4. RELEVANCE: Does every item connect to THIS specific story? Or could it apply to any story in the genre?
5. ANTI-DERIVATIVE: Does it avoid cliché references and obvious first-Google-result connections?

Return JSON:
{
  "output_a_scores": { "specificity": N, "story_fuel": N, "surprise": N, "relevance": N, "anti_derivative": N },
  "output_b_scores": { "specificity": N, "story_fuel": N, "surprise": N, "relevance": N, "anti_derivative": N },
  "winner": "A" | "B" | "tie",
  "key_difference": "1-2 sentences on what separates them"
}`;

const GROUNDING_JUDGE = `You are comparing TWO grounding research outputs for the same story. Both received the same contract but different prompts. Determine which produces MORE USEFUL real-world grounding.

CRITERIA (score each 1-10):
1. REFERENCE QUALITY: Are the real-world references specific, named, and non-obvious? Or cliché (Milgram, Stanford Prison, 1984)?
2. MECHANISM DEPTH: Does it explain HOW the reference works, not just THAT it exists?
3. NARRATIVE FUEL: Could a writer use this in a scene? Specific pressures, contradictions, textures?
4. RELEVANCE: Does each item connect to THIS story specifically?
5. THEMATIC TENSION: Does the identified tension illuminate the story's central conflict?

Return JSON:
{
  "output_a_scores": { "reference": N, "mechanism": N, "fuel": N, "relevance": N, "tension": N },
  "output_b_scores": { "reference": N, "mechanism": N, "fuel": N, "relevance": N, "tension": N },
  "winner": "A" | "B" | "tie",
  "key_difference": "1-2 sentences on what separates them"
}`;

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
interface ModelOutput { model: string; style: string; role: string; contract: string; text: string; durationMs: number; }
interface CompResult { model: string; role: string; contract: string; winner: string; origScore: number; simpScore: number; keyDiff: string; }

async function main() {
  const limit = createLimiter(CONCURRENCY);
  const outputs: ModelOutput[] = [];
  const comparisons: CompResult[] = [];

  const roles = [
    { name: "cultural", schema: CULTURAL_BRIEF_SCHEMA, maxTokens: 4096, temperature: 0.8,
      origSystem: ORIGINAL_CULTURAL_SYSTEM, origUser: ORIGINAL_CULTURAL_USER,
      simpSystem: CULTURAL_RESEARCHER_SYSTEM, simpUser: CULTURAL_RESEARCHER_USER_TEMPLATE,
      fillFn: fillCultural, judgeSystem: CULTURAL_JUDGE },
    { name: "grounding", schema: GROUNDING_BRIEF_SCHEMA, maxTokens: 2048, temperature: 0.7,
      origSystem: ORIGINAL_GROUNDING_SYSTEM, origUser: ORIGINAL_GROUNDING_USER,
      simpSystem: GROUNDING_RESEARCHER_SYSTEM, simpUser: GROUNDING_RESEARCHER_USER_TEMPLATE,
      fillFn: fillGrounding, judgeSystem: GROUNDING_JUDGE },
  ];

  const totalCalls = MODELS.length * roles.length * CONTRACTS.length * 2;
  console.log("\n" + "=".repeat(60));
  console.log("  PROMPT VALIDATION — Comparative A/B");
  console.log("=".repeat(60));
  console.log(`Models:    ${MODELS.join(", ")}`);
  console.log(`Roles:     cultural, grounding`);
  console.log(`Contracts: ${CONTRACTS.length}`);
  console.log(`Styles:    original vs simplified (production)`);
  console.log(`Calls:     ${totalCalls} model + comparative judge`);
  console.log("=".repeat(60) + "\n");

  // Phase 1: Generate outputs
  log(`Phase 1: ${totalCalls} model calls...`);
  const p1 = Date.now();
  const tasks: Promise<void>[] = [];

  for (const role of roles) {
    for (const contract of CONTRACTS) {
      for (const model of MODELS) {
        for (const style of ["original", "simplified"] as const) {
          const system = style === "original" ? role.origSystem : role.simpSystem;
          const userTpl = style === "original" ? role.origUser : role.simpUser;
          const user = role.fillFn(userTpl, contract);
          tasks.push(limit(async () => {
            const call = await callModel(model, system, user, role.schema, role.maxTokens, role.temperature);
            if (!call.error && call.text.length > 50) {
              outputs.push({ model, style, role: role.name, contract: contract.label, text: call.text, durationMs: call.durationMs });
            }
            const short = model.replace(/-20\d{6}/, "").slice(0, 18);
            log(`  ${short.padEnd(18)} ${role.name.padEnd(11)} ${style.padEnd(12)} ${contract.label.slice(0, 15).padEnd(15)} ${call.error ? "ERR" : "OK"} ${call.durationMs}ms`);
          }));
        }
      }
    }
  }
  await Promise.all(tasks);
  log(`Phase 1 done in ${((Date.now() - p1) / 1000).toFixed(1)}s — ${outputs.length} valid outputs`);

  // Phase 2: Comparative judge (original vs simplified for same model/role/contract)
  log("Phase 2: Comparative judging...");
  const p2 = Date.now();
  const judgeTasks: Promise<void>[] = [];

  for (const role of roles) {
    for (const contract of CONTRACTS) {
      for (const model of MODELS) {
        const orig = outputs.find(o => o.model === model && o.role === role.name && o.contract === contract.label && o.style === "original");
        const simp = outputs.find(o => o.model === model && o.role === role.name && o.contract === contract.label && o.style === "simplified");
        if (!orig || !simp) continue;

        judgeTasks.push(limit(async () => {
          // Randomize position
          const flip = Math.random() > 0.5;
          const [textA, textB] = flip ? [simp.text, orig.text] : [orig.text, simp.text];

          const key = process.env.ANTHROPIC_API_KEY!;
          try {
            const res = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST", headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
              body: JSON.stringify({ model: JUDGE_MODEL, max_tokens: 500, temperature: 0, system: role.judgeSystem,
                messages: [{ role: "user", content: `Compare for "${contract.label}":\n\n=== OUTPUT A ===\n${textA.slice(0, 5000)}\n\n=== OUTPUT B ===\n${textB.slice(0, 5000)}\n\nScore each 1-10. Be discriminating.` }] }),
            });
            const data = await res.json() as any;
            if (data.error) { log(`  [JUDGE ERR] ${JSON.stringify(data.error).slice(0, 100)}`); return; }
            const match = (data.content?.[0]?.text ?? "").match(/\{[\s\S]*\}/);
            if (!match) return;
            const p = JSON.parse(match[0]);
            const aScores = Object.values(p.output_a_scores) as number[];
            const bScores = Object.values(p.output_b_scores) as number[];
            const aAvg = aScores.reduce((a, b) => a + b, 0) / aScores.length;
            const bAvg = bScores.reduce((a, b) => a + b, 0) / bScores.length;

            // Map back from randomized position
            const origScore = flip ? bAvg : aAvg;
            const simpScore = flip ? aAvg : bAvg;
            let winner: string;
            if (p.winner === "A") winner = flip ? "simplified" : "original";
            else if (p.winner === "B") winner = flip ? "original" : "simplified";
            else winner = "tie";

            comparisons.push({ model, role: role.name, contract: contract.label, winner, origScore, simpScore, keyDiff: p.key_difference });
            const short = model.replace(/-20\d{6}/, "").slice(0, 18);
            log(`  ${short.padEnd(18)} ${role.name.padEnd(11)} ${contract.label.slice(0, 15).padEnd(15)} → ${winner.padEnd(12)} (orig=${origScore.toFixed(1)} simp=${simpScore.toFixed(1)})`);
          } catch (err) { log(`  [JUDGE ERR] ${err}`); }
        }));
      }
    }
  }
  await Promise.all(judgeTasks);
  log(`Phase 2 done in ${((Date.now() - p2) / 1000).toFixed(1)}s`);

  // ── Results ──
  const pad = (s: string, n: number) => s.padEnd(n);
  const lines: string[] = ["=".repeat(80), "  PROMPT VALIDATION — COMPARATIVE RESULTS", "=".repeat(80), ""];

  for (const roleName of ["cultural", "grounding"]) {
    lines.push("═".repeat(80));
    lines.push(`  ${roleName.toUpperCase()} RESEARCHER — Original vs Simplified`);
    lines.push("═".repeat(80));

    for (const model of MODELS) {
      const short = model.replace(/-20\d{6}/, "");
      const modelComps = comparisons.filter(c => c.model === model && c.role === roleName);
      const origWins = modelComps.filter(c => c.winner === "original").length;
      const simpWins = modelComps.filter(c => c.winner === "simplified").length;
      const ties = modelComps.filter(c => c.winner === "tie").length;
      const avgOrig = modelComps.length > 0 ? modelComps.reduce((a, c) => a + c.origScore, 0) / modelComps.length : 0;
      const avgSimp = modelComps.length > 0 ? modelComps.reduce((a, c) => a + c.simpScore, 0) / modelComps.length : 0;

      lines.push(`\n  ${short}`);
      lines.push(`  Original wins: ${origWins}  Simplified wins: ${simpWins}  Ties: ${ties}`);
      lines.push(`  Avg scores: original=${avgOrig.toFixed(1)} simplified=${avgSimp.toFixed(1)}`);

      for (const c of modelComps) {
        lines.push(`    ${c.contract.slice(0, 22).padEnd(22)} orig=${c.origScore.toFixed(1)} simp=${c.simpScore.toFixed(1)} → ${c.winner}`);
        lines.push(`      ${c.keyDiff.slice(0, 120)}`);
      }
    }
    lines.push("");
  }

  // Overall verdict
  const allOrigWins = comparisons.filter(c => c.winner === "original").length;
  const allSimpWins = comparisons.filter(c => c.winner === "simplified").length;
  const allTies = comparisons.filter(c => c.winner === "tie").length;
  lines.push("═".repeat(80));
  lines.push(`  OVERALL: Original ${allOrigWins} — Simplified ${allSimpWins} — Tie ${allTies}`);
  lines.push("═".repeat(80));

  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  await mkdir("./data/blind-tests", { recursive: true });
  const reportPath = `./data/blind-tests/prompt_validation_${ts}.txt`;
  await writeFile(reportPath, lines.join("\n"), "utf-8");

  console.log("\n" + lines.join("\n"));
  console.log(`\nReport: ${reportPath}`);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
