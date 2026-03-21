#!/usr/bin/env tsx
/**
 * CONSOLIDATOR PROMPT A/B TEST
 * ════════════════════════════
 * Tests original (954-word) vs simplified prompt for psych_consolidator
 * on GPT-5.4 Mini and Claude Haiku (baseline).
 *
 * 2 models × 3 contracts × 2 styles × 3 reps = 36 calls + judge
 */

import "dotenv/config";
import { mkdir, writeFile } from "fs/promises";

import { CONSOLIDATION_SYSTEM, CONSOLIDATION_USER_TEMPLATE, CONSOLIDATION_SCHEMA } from "../backend/services/consolidationPrompts";
import { detectProvider, type LLMProvider } from "../shared/modelConfig";

// ── Simplified prompt ──

const SIMPLIFIED_CONSOLIDATION_SYSTEM = `You are a psychology consolidation engine. You process accumulated user behavior signals and make them more useful.

You receive: a signal store (behavior hypotheses with evidence), recent observations, and interaction stats. You return an updated signal list.

WHAT TO DO (pick what matters):
- MERGE signals saying the same thing in different words. "Picks dark options" + "avoids lighthearted alternatives" = one signal. This is your most important job.
- PROMOTE candidates with enough evidence to active/stable status.
- PRUNE signals sitting at candidate with no reinforcement, or superseded by more specific ones.
- SHARPEN vague hypotheses using the actual evidence. "Likes dark content" → "interested in moral corruption arcs, not violence."
- SUGGEST A PROBE if there's an unresolved ambiguity that would change clarifier behavior. Frame as a story question, not a psych test.
- DO NOTHING if the store is already clean.

RULES:
1. Return at most 8 signals. Quality over quantity.
2. When merging, pick the most precise phrasing. Inherit all evidence.
3. Override mechanical confidence if semantic analysis tells you otherwise — 3 weak signals saying the same thing = one strong signal.
4. Don't invent evidence. Don't merge signals from genuinely different categories.
5. adaptationConsequence must be a concrete pipeline behavior, not vague.
6. Omitting a signal from updatedSignals = pruning it.

Return ONLY valid JSON matching the schema. No markdown.`;

const SIMPLIFIED_CONSOLIDATION_USER = `Consolidate these psychology signals.

SIGNALS:
{{SIGNAL_STORE_JSON}}

RECENT OBSERVATIONS:
{{RECENT_READS_JSON}}

STATS: {{HEURISTICS_JSON}}
{{PROBE_OUTCOME_SECTION}}

Module: {{MODULE}}, Turn: {{TURN_NUMBER}}

Return updated signals, plus unresolvedAmbiguity and suggestedProbe if relevant.`;

// ── Models ──

const MODELS = ["gpt-5.4-mini", "claude-haiku-4-5-20251001"];
const JUDGE_MODEL = "claude-sonnet-4-6";
const REPS = 3;
const CONCURRENCY = 6;

// ── Test data (same as tier-a-test) ──

const CONTRACTS = [
  {
    label: "Hospital AI — turn 4",
    signalStore: JSON.stringify([
      { id: "s1", hypothesis: "Gravitates toward morally complex scenarios", confidence: 0.6, status: "active", category: "content_preferences", scope: "this_story", evidence: [{ turn: 1, event: "chose 'complicity' framing over 'heroic whistleblower'" }, { turn: 3, event: "rejected option that made nurse clearly righteous" }], adaptationConsequence: "Avoid clear hero/villain framing", contradictionCriteria: "User chooses a clearly heroic path" },
      { id: "s2", hypothesis: "Prefers grounded realism over dramatic spectacle", confidence: 0.4, status: "active", category: "tonal_risk", scope: "this_story", evidence: [{ turn: 2, event: "chose 'quiet documentation' over 'confrontation'" }], adaptationConsequence: "Keep scenes low-key and procedural", contradictionCriteria: "User asks for dramatic confrontation" },
      { id: "s3", hypothesis: "Interested in institutional critique", confidence: 0.5, status: "active", category: "content_preferences", scope: "this_genre", evidence: [{ turn: 1, event: "engaged deeply with how triage system works" }, { turn: 3, event: "asked about hospital hierarchy" }], adaptationConsequence: "Provide institutional detail in options", contradictionCriteria: "User shifts focus to personal drama exclusively" },
      { id: "s4", hypothesis: "Avoids clear heroes and villains", confidence: 0.35, status: "candidate", category: "content_preferences", scope: "this_story", evidence: [{ turn: 3, event: "rejected option framing nurse as hero" }], adaptationConsequence: "Present morally ambiguous options", contradictionCriteria: "User explicitly wants a hero protagonist" },
      { id: "s5", hypothesis: "Wants to direct character psychology details", confidence: 0.45, status: "active", category: "control_orientation", scope: "global", evidence: [{ turn: 2, event: "added specific detail about nurse's past" }, { turn: 3, event: "modified character motivation when offered" }], adaptationConsequence: "Offer character psychology steering options", contradictionCriteria: "User defers all character decisions to engine" },
    ], null, 2),
    recentReads: JSON.stringify([
      { turn: 3, read: "User chose the option emphasizing nurse's exhausted complicity. Rejected heroic framing. Added detail about nurse covering for system in past." },
      { turn: 4, read: "User asked about hospital power structure. Engaged with institutional detail. Chose estranged sister as reluctant ally over eager whistleblower friend." },
    ], null, 2),
    heuristics: JSON.stringify({ avgResponseTime: 45, optionPickRate: 0.7, freeTextRate: 0.3, turnsInModule: 4 }),
    probeOutcome: "", module: "character", turnNumber: "4",
  },
  {
    label: "Catgirl Isekai — turn 3",
    signalStore: JSON.stringify([
      { id: "s1", hypothesis: "Enjoys ironic humor and subversion", confidence: 0.55, status: "active", category: "content_preferences", scope: "this_story", evidence: [{ turn: 1, event: "laughed at premise inversion" }, { turn: 2, event: "chose most ironic character trait" }], adaptationConsequence: "Lead with ironic contradictions", contradictionCriteria: "User prefers straightforward comedy" },
      { id: "s2", hypothesis: "Wants emotional depth beneath comedy", confidence: 0.4, status: "candidate", category: "tonal_risk", scope: "this_story", evidence: [{ turn: 2, event: "engaged with 'why was she so mean' backstory option" }], adaptationConsequence: "Include emotional undertones in comedic options", contradictionCriteria: "User skips all emotional content" },
      { id: "s3", hypothesis: "Prefers manga-style pacing and visual gags", confidence: 0.3, status: "candidate", category: "content_preferences", scope: "this_story", evidence: [{ turn: 1, event: "mentioned manga in seed input" }], adaptationConsequence: "Use manga pacing beats", contradictionCriteria: "User requests novelistic pacing" },
      { id: "s4", hypothesis: "Explorer orientation — likes being surprised", confidence: 0.5, status: "active", category: "control_orientation", scope: "global", evidence: [{ turn: 1, event: "chose unexpected option" }, { turn: 3, event: "said 'surprise me' when given choice" }], adaptationConsequence: "Include wildcard options, fewer safe choices", contradictionCriteria: "User consistently picks most predictable option" },
    ], null, 2),
    recentReads: JSON.stringify([
      { turn: 2, read: "User engaged with backstory depth option. Chose 'she was lonely' over 'she was just mean.' Suggests interest in redemption arc with emotional grounding." },
      { turn: 3, read: "User said 'surprise me' when offered 3 world options. Explorer behavior confirmed. Also laughed at involuntary purring detail." },
    ], null, 2),
    heuristics: JSON.stringify({ avgResponseTime: 22, optionPickRate: 0.5, freeTextRate: 0.5, turnsInModule: 3 }),
    probeOutcome: "", module: "character", turnNumber: "3",
  },
  {
    label: "Jock/Elf Prince — turn 5",
    signalStore: JSON.stringify([
      { id: "s1", hypothesis: "Drawn to power dynamics and vulnerability", confidence: 0.7, status: "stable", category: "content_preferences", scope: "this_story", evidence: [{ turn: 1, event: "seed focuses on power inversion" }, { turn: 2, event: "chose most vulnerable option for jock" }, { turn: 4, event: "added detail about jock's fear" }], adaptationConsequence: "Foreground power asymmetry in every option", contradictionCriteria: "User equalizes power early" },
      { id: "s2", hypothesis: "Wants slow-burn emotional complexity in erotic tension", confidence: 0.55, status: "active", category: "tonal_risk", scope: "this_story", evidence: [{ turn: 3, event: "rejected fast-burn sexual tension option" }, { turn: 4, event: "chose 'confused by kindness' over 'attracted immediately'" }], adaptationConsequence: "Delay explicit content, build emotional charge", contradictionCriteria: "User asks for immediate sexual content" },
      { id: "s3", hypothesis: "Values detailed fantasy worldbuilding", confidence: 0.45, status: "active", category: "content_preferences", scope: "this_genre", evidence: [{ turn: 2, event: "asked about elf society structure" }, { turn: 5, event: "engaged with caste system details" }], adaptationConsequence: "Include worldbuilding texture in options", contradictionCriteria: "User skips all worldbuilding" },
      { id: "s4", hypothesis: "Director orientation for character psychology", confidence: 0.6, status: "active", category: "control_orientation", scope: "global", evidence: [{ turn: 2, event: "modified Tyler's reaction" }, { turn: 3, event: "specified prince's motivation" }, { turn: 4, event: "added backstory detail" }], adaptationConsequence: "Offer character steering options prominently", contradictionCriteria: "User defers character decisions" },
      { id: "s5", hypothesis: "Interested in institutional slavery mechanics", confidence: 0.35, status: "candidate", category: "content_preferences", scope: "this_story", evidence: [{ turn: 5, event: "asked how slavery is legally structured" }], adaptationConsequence: "Provide institutional detail about elf slavery", contradictionCriteria: "User treats slavery as backdrop only" },
      { id: "s6", hypothesis: "Likes vulnerability in strong characters", confidence: 0.5, status: "active", category: "content_preferences", scope: "this_story", evidence: [{ turn: 2, event: "emphasized Tyler's physical strength" }, { turn: 4, event: "added fear detail despite muscle" }], adaptationConsequence: "Contrast physical strength with emotional vulnerability", contradictionCriteria: "User makes Tyler emotionally tough too" },
    ], null, 2),
    recentReads: JSON.stringify([
      { turn: 4, read: "User specified that Tyler tries to hide fear with bravado. Director behavior — specific character psychology." },
      { turn: 5, read: "User asked detailed questions about elf caste system and how slavery fits. Worldbuilding engagement high." },
    ], null, 2),
    heuristics: JSON.stringify({ avgResponseTime: 55, optionPickRate: 0.6, freeTextRate: 0.4, turnsInModule: 5 }),
    probeOutcome: "", module: "world", turnNumber: "5",
  },
];

// ── Provider callers ──

interface LLMCallResult { text: string; model: string; provider: LLMProvider; durationMs: number; error?: string; }

function enforceAllRequired(obj: any): any {
  if (Array.isArray(obj)) return obj.map(enforceAllRequired);
  if (obj && typeof obj === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(obj)) { out[k] = enforceAllRequired(v); }
    if (out.properties && typeof out.properties === "object") { out.required = Object.keys(out.properties); }
    return out;
  }
  return obj;
}

function fixUnionTypes(obj: any): any {
  if (Array.isArray(obj)) return obj.map(fixUnionTypes);
  if (obj && typeof obj === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === "type" && Array.isArray(v)) { out[k] = v.find((t: string) => t !== "null") ?? v[0]; }
      else { out[k] = fixUnionTypes(v); }
    }
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
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: maxTokens, temperature, system, messages: [{ role: "user", content: user }], tools: [{ name: "structured_output", description: "Return structured output", input_schema: schema }], tool_choice: { type: "tool", name: "structured_output" } }),
    });
    const data = await res.json() as any;
    if (data.error) throw new Error(JSON.stringify(data.error));
    const tb = data.content?.find((b: any) => b.type === "tool_use");
    return { text: tb ? JSON.stringify(tb.input) : data.content?.[0]?.text ?? "", model, provider: "anthropic", durationMs: Date.now() - start };
  } catch (err: any) { return { text: "", model, provider: "anthropic", durationMs: Date.now() - start, error: err.message }; }
}

async function callOpenAI(model: string, system: string, user: string, schema: Record<string, unknown>, maxTokens: number, temperature: number): Promise<LLMCallResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { text: "", model, provider: "openai", durationMs: 0, error: "NO KEY" };
  const start = Date.now();
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, max_completion_tokens: maxTokens, temperature, messages: [{ role: "system", content: system }, { role: "user", content: user }], response_format: { type: "json_schema", json_schema: { name: "consolidation_output", strict: true, schema: fixUnionTypes(enforceAllRequired(schema)) } } }),
    });
    const data = await res.json() as any;
    if (data.error) throw new Error(JSON.stringify(data.error));
    return { text: data.choices?.[0]?.message?.content ?? "", model, provider: "openai", durationMs: Date.now() - start };
  } catch (err: any) { return { text: "", model, provider: "openai", durationMs: Date.now() - start, error: err.message }; }
}

async function callModel(model: string, system: string, user: string, schema: Record<string, unknown>, maxTokens: number, temperature: number): Promise<LLMCallResult> {
  const provider = detectProvider(model);
  if (provider === "anthropic") return callAnthropic(model, system, user, schema, maxTokens, temperature);
  return callOpenAI(model, system, user, schema, maxTokens, temperature);
}

// ── Judge ──

const JUDGE_SYSTEM = `You are a quality evaluator for psychology signal consolidation. Score on a structured rubric. 3 is average, 5 is exceptional, 1 is useless.

RUBRIC:
- specificity (1-5): Are signal hypotheses precise and actionable? Or vague?
- usefulness (1-5): Would the downstream clarifier benefit from this consolidation?
- accuracy (1-5): Does it correctly identify merges, promotions, and prunes? Does it preserve signal semantics?
- completeness (1-5): Does it handle all the signals appropriately without dropping important ones or keeping dead weight?

Return ONLY valid JSON: {"specificity": N, "usefulness": N, "accuracy": N, "completeness": N, "reasoning": "1-2 sentences"}`;

interface JudgeScores { specificity: number; usefulness: number; accuracy: number; completeness: number; composite: number; reasoning: string; }

async function judgeOutput(label: string, outputText: string): Promise<JudgeScores | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: JUDGE_MODEL, max_tokens: 300, temperature: 0, system: JUDGE_SYSTEM, messages: [{ role: "user", content: `Score this psychology consolidation for "${label}".\n\nOUTPUT:\n${outputText.slice(0, 6000)}` }] }),
    });
    const data = await res.json() as any;
    if (data.error) return null;
    const match = (data.content?.[0]?.text ?? "").match(/\{[\s\S]*\}/);
    if (!match) return null;
    const p = JSON.parse(match[0]);
    return { ...p, composite: Math.round((p.specificity + p.usefulness + p.accuracy + p.completeness) / 4 * 100) / 100 };
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
  label: string; model: string; style: "original" | "simplified";
  rep: number; durationMs: number; valid: boolean; judge: JudgeScores | null; error?: string;
}

async function main() {
  const limit = createLimiter(CONCURRENCY);
  const results: RunResult[] = [];
  const total = MODELS.length * CONTRACTS.length * 2 * REPS;

  console.log("\n" + "=".repeat(60));
  console.log("  CONSOLIDATOR PROMPT A/B TEST");
  console.log("=".repeat(60));
  console.log(`Models: ${MODELS.join(", ")}`);
  console.log(`Styles: original (954 words) vs simplified (~250 words)`);
  console.log(`Calls:  ${total} model + up to ${total} judge`);
  console.log("=".repeat(60) + "\n");

  log(`Phase 1: ${total} model calls...`);
  const p1 = Date.now();

  const tasks: Promise<void>[] = [];
  for (const contract of CONTRACTS) {
    for (const model of MODELS) {
      for (const style of ["original", "simplified"] as const) {
        const system = style === "original" ? CONSOLIDATION_SYSTEM : SIMPLIFIED_CONSOLIDATION_SYSTEM;
        const userTpl = style === "original" ? CONSOLIDATION_USER_TEMPLATE : SIMPLIFIED_CONSOLIDATION_USER;
        const user = userTpl
          .replace("{{SIGNAL_STORE_JSON}}", contract.signalStore)
          .replace("{{RECENT_READS_JSON}}", contract.recentReads)
          .replace("{{HEURISTICS_JSON}}", contract.heuristics)
          .replace("{{PROBE_OUTCOME_SECTION}}", contract.probeOutcome)
          .replace("{{MODULE}}", contract.module)
          .replace("{{TURN_NUMBER}}", contract.turnNumber);

        for (let rep = 0; rep < REPS; rep++) {
          tasks.push(limit(async () => {
            const call = await callModel(model, system, user, CONSOLIDATION_SCHEMA, 2048, 0.3);
            let valid = false;
            if (!call.error) {
              try {
                const p = JSON.parse(call.text);
                valid = Array.isArray(p.updatedSignals) && p.updatedSignals.length > 0;
              } catch { valid = false; }
            }
            const short = model.replace(/-20\d{6}/, "").slice(0, 18);
            log(`  ${short.padEnd(18)} ${style.padEnd(12)} ${contract.label.slice(0, 25).padEnd(25)} rep${rep + 1} ${call.error ? "ERR" : valid ? "OK" : "FAIL"} ${call.durationMs}ms`);
            results.push({ label: contract.label, model, style, rep, durationMs: call.durationMs, valid, judge: null, error: call.error });
            (results[results.length - 1] as any)._text = call.text;
          }));
        }
      }
    }
  }
  await Promise.all(tasks);
  log(`Phase 1 done in ${((Date.now() - p1) / 1000).toFixed(1)}s`);

  // Judge
  const valid = results.filter(r => r.valid);
  log(`Phase 2: Judging ${valid.length} outputs...`);
  const p2 = Date.now();
  await Promise.all(valid.map(r => limit(async () => { r.judge = await judgeOutput(r.label, (r as any)._text); })));
  log(`Phase 2 done in ${((Date.now() - p2) / 1000).toFixed(1)}s`);

  // Results
  const pad = (s: string, n: number) => s.padEnd(n);
  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const lines: string[] = ["=".repeat(70), "  CONSOLIDATOR A/B RESULTS", "=".repeat(70), ""];

  for (const model of MODELS) {
    const short = model.replace(/-20\d{6}/, "");
    lines.push(`  ${short}`);
    lines.push(pad("  Style", 16) + pad("Composite", 11) + pad("Spec", 6) + pad("Use", 6) + pad("Acc", 6) + pad("Comp", 6) + pad("Schema%", 9) + pad("Latency", 10));
    lines.push("  " + "-".repeat(62));
    for (const style of ["original", "simplified"] as const) {
      const runs = results.filter(r => r.model === model && r.style === style);
      const scored = runs.filter(r => r.judge);
      const validCount = runs.filter(r => r.valid).length;
      lines.push(
        pad("  " + style, 16) +
        pad(avg(scored.map(r => r.judge!.composite)).toFixed(2), 11) +
        pad(avg(scored.map(r => r.judge!.specificity)).toFixed(1), 6) +
        pad(avg(scored.map(r => r.judge!.usefulness)).toFixed(1), 6) +
        pad(avg(scored.map(r => r.judge!.accuracy)).toFixed(1), 6) +
        pad(avg(scored.map(r => r.judge!.completeness)).toFixed(1), 6) +
        pad(runs.length > 0 ? ((validCount / runs.length) * 100).toFixed(0) + "%" : "N/A", 9) +
        pad(runs.filter(r => !r.error).length > 0 ? (avg(runs.filter(r => !r.error).map(r => r.durationMs)) / 1000).toFixed(1) + "s" : "N/A", 10)
      );
    }
    lines.push("");
  }

  // Delta
  for (const model of MODELS) {
    const short = model.replace(/-20\d{6}/, "");
    const orig = results.filter(r => r.model === model && r.style === "original" && r.judge);
    const simp = results.filter(r => r.model === model && r.style === "simplified" && r.judge);
    const delta = avg(simp.map(r => r.judge!.composite)) - avg(orig.map(r => r.judge!.composite));
    const accDelta = avg(simp.map(r => r.judge!.accuracy)) - avg(orig.map(r => r.judge!.accuracy));
    lines.push(`${short}: delta=${delta >= 0 ? "+" : ""}${delta.toFixed(2)} (accuracy: ${accDelta >= 0 ? "+" : ""}${accDelta.toFixed(1)})`);
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  await mkdir("./data/blind-tests", { recursive: true });
  await writeFile(`./data/blind-tests/consolidator_ab_${ts}.txt`, lines.join("\n"), "utf-8");

  console.log("\n" + lines.join("\n"));
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
