#!/usr/bin/env tsx
/**
 * TIER A+B — COMPARATIVE RE-JUDGE
 * ════════════════════════════════
 * Re-judges Tier A (summarizer, consolidator, scene_divergence) and
 * Tier B (summaries, polish) outputs using pairwise comparative judging
 * with role-specific discriminating rubrics.
 *
 * Reads raw data from previous runs. No new model calls.
 */

import "dotenv/config";
import { readFileSync } from "fs";
import { mkdir, writeFile } from "fs/promises";

const JUDGE_MODEL = "claude-sonnet-4-6";
const CONCURRENCY = 6;

// ── Load previous results ──

interface PrevResult {
  role: string; model: string; rep: number;
  durationMs: number; valid: boolean; error?: string;
  _text: string;
  // Tier A fields
  contractLabel?: string;
  // Tier B fields
  storyLabel?: string;
}

const tierAData: PrevResult[] = JSON.parse(readFileSync("./data/blind-tests/tier_a_raw_2026-03-21T13-38-47.json", "utf-8"));
const tierBData: PrevResult[] = JSON.parse(readFileSync("./data/blind-tests/tier_b_v2_raw_2026-03-21T15-19-52.json", "utf-8"));

const tierAValid = tierAData.filter(r => r.valid && r._text);
const tierBValid = tierBData.filter(r => r.valid && r._text);

console.log(`Tier A: ${tierAValid.length} valid outputs`);
console.log(`Tier B: ${tierBValid.length} valid outputs\n`);

// ── Role-specific discriminating rubrics ──

const RUBRICS: Record<string, string> = {
  summarizer: `You are comparing TWO creative-state summarizer outputs. Both compressed the same project state into a research contract. Your job is to determine which contract would give a downstream cultural researcher BETTER material to work with.

CRITERIA (score each 1-10):
1. STORY ESSENCE: Does it capture what makes THIS story specific and not another? Or is it a generic genre summary? A great essence makes a researcher immediately think of 10 different cultural touchpoints.
2. EMOTIONAL CORE: Is it a specific FEELING or a genre label? "The queasy intimacy of depending on someone who could destroy you" vs "dark romance."
3. OPEN QUESTIONS: Are they research-actionable? Do they point to specific cultural dimensions worth investigating? Or are they vague "what genre?" questions?
4. CONTRADICTIONS: Does it surface the tensions and paradoxes in the story? These are the most fertile ground for research.
5. NEGATIVE PROFILE: Does it clearly communicate what the story is NOT, to prevent irrelevant research?`,

  consolidator: `You are comparing TWO psychology consolidation outputs. Both processed the same signal store. Your job is to determine which produces a MORE USEFUL signal store for the downstream clarifier.

CRITERIA (score each 1-10):
1. MERGE QUALITY: Does it correctly identify semantically overlapping signals and merge them? Or does it miss obvious overlaps or wrongly merge different signals?
2. HYPOTHESIS PRECISION: Are the surviving signal hypotheses specific and actionable? Or vague ("likes dark content")?
3. CONFIDENCE CALIBRATION: Are confidence values justified by the evidence? Multiple converging signals should boost confidence.
4. PRUNING JUDGMENT: Does it correctly identify dead-weight signals and remove them? Or keep everything?
5. ADAPTATION CONSEQUENCES: Are they concrete pipeline behaviors? Or vague advice?`,

  scene_divergence: `You are comparing TWO scene divergence outputs. Both generated staging alternatives for the same scene. Your job is to determine which gives the user MORE GENUINELY DIFFERENT choices.

CRITERIA (score each 1-10):
1. ALTERNATIVE SPREAD: Are the alternatives genuinely different experiences? Or variations on the same staging?
2. SPECIFICITY: Are they concrete enough to visualize? Or abstract descriptions?
3. WORTH_ASKING HONESTY: Does the model honestly assess whether alternatives are worth showing the user?
4. WILDCARD QUALITY: Is the wildcard genuinely surprising? Or just slightly different?
5. FIDELITY: Do all alternatives correctly stage the SAME beat? Or do some change what happens?`,

  hook_summary: `You are comparing TWO hook steering summaries. Both summarized the same hook development session. Your job is to determine which would better guide downstream modules.

CRITERIA (score each 1-10):
1. SIGNAL DENSITY: Does every line carry information? Or is there filler and restating the obvious?
2. MECHANISM CAPTURE: Does it preserve the specific mechanism/rule/ritual that makes this story unique?
3. TONE GUIDANCE: Would a builder reading this know exactly what tone to hit?
4. UNRESOLVED QUESTIONS: Does it flag the right things for future modules to explore?
5. DIRECTNESS: Is it crisp and scannable? Or verbose and literary?`,

  char_summary: `You are comparing TWO character steering summaries. Both summarized the same character session.

CRITERIA (score each 1-10):
1. ENSEMBLE DYNAMICS: Does it capture WHY these characters pressure each other?
2. PSYCHOLOGICAL SPECIFICITY: Are character traits behaviors you can picture, or literary analysis labels?
3. RELATIONSHIP TENSION: Does it capture subtext, not just surface dynamics?
4. BEHAVIORAL SIGNATURES: Are there specific tells, patterns, and habits that a builder could use?
5. DIRECTNESS: Crisp and scannable vs verbose?`,

  img_summary: `You are comparing TWO visual summaries. Both summarized the same character image session.

CRITERIA (score each 1-10):
1. VISUAL SPECIFICITY: Are descriptions drawable? Or abstract mood descriptions?
2. ENSEMBLE COHESION: Does it capture how characters look together, not just individually?
3. STYLE GUIDANCE: Would an artist know exactly what style to use?
4. EMOTIONAL CONNECTION: Do the visuals connect to the story's emotional engine?
5. BREVITY: Is it tight enough to scan in 10 seconds?`,

  world_summary: `You are comparing TWO world steering summaries.

CRITERIA (score each 1-10):
1. PRESSURE CAPTURE: Does it show how the world SQUEEZES characters? Or just describe geography?
2. RULE SPECIFICITY: Are the world's rules concrete and story-relevant?
3. FACTION CLARITY: Are power structures clear and tension-generating?
4. DISTINCTIVENESS: Would you confuse this world with a generic version of its genre?
5. BREVITY: Tight and scannable?`,

  plot_summary: `You are comparing TWO plot steering summaries.

CRITERIA (score each 1-10):
1. PITCH ENERGY: Does it read like a movie pitch that makes you desperate to see it? Or a book report?
2. TURNING POINTS: Are the key moments specific and emotionally loaded?
3. ENDING CLARITY: Is the ending energy clear without spoiling?
4. ADDICTIVENESS: Would someone hearing this pitch say "I need to read that"?
5. BREVITY: Tight?`,

  premise_polish: `You are comparing TWO polished premises for the same story.

CRITERIA (score each 1-10):
1. MYSTERY PROTECTION: Does it signal depth WITHOUT resolving it? Or does it over-explain the twist/theme/ending?
2. SLOP-FREE: Is the prose free of AI-typical phrasing, em-dash abuse, and abstract dramatic closers?
3. SPECIFICITY: Are the details concrete and unique to THIS story? Or could they describe any story in the genre?
4. HOOK POWER: After reading, do you NEED to know what happens next?
5. WORD ECONOMY: Every sentence earns its place? Or is there padding?`,

  char_polish: `You are comparing TWO polished character descriptions.

CRITERIA (score each 1-10):
1. VIVID BEHAVIOR: Do you see the character doing something? Or are they described with literary analysis labels?
2. MYSTERY SIGNAL: Does it hint at the lie/wound/paradox without labeling it?
3. BOLD OPENER: Does the first sentence hook you?
4. SLOP-FREE: Free of "complex," "multifaceted," "nuanced," "compelling"?
5. WORD ECONOMY: Under 80 words? Every word earns its place?`,

  world_polish: `You are comparing TWO polished world descriptions.

CRITERIA (score each 1-10):
1. VISCERAL PRESSURE: Do you FEEL the world's pressure? Or just understand it intellectually?
2. SPECIFICITY: Are the details concrete and unique? Or genre-standard?
3. SLOP-FREE: Free of abstract design language and worldbuilding jargon?
4. BREVITY: Max 2 sentences per section?
5. STORY CONNECTION: Does the world description make you feel the protagonist's trap?`,
};

// ── Comparative judging ──

interface CompResult {
  tier: string; role: string; story: string;
  modelA: string; modelB: string;
  winner: string; aTotal: number; bTotal: number;
  keyDifference: string;
}

async function comparativeJudge(
  tier: string, role: string, story: string,
  modelA: string, textA: string,
  modelB: string, textB: string,
): Promise<CompResult | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;

  const rubric = RUBRICS[role];
  if (!rubric) { console.warn(`No rubric for role: ${role}`); return null; }

  // Randomize to prevent position bias
  const flip = Math.random() > 0.5;
  const [assignedA, assignedB] = flip ? [textB, textA] : [textA, textB];
  const [nameA, nameB] = flip ? [modelB, modelA] : [modelA, modelB];

  const prompt = `Compare these two ${role} outputs for "${story}".

=== OUTPUT A ===
${assignedA.slice(0, 5000)}

=== OUTPUT B ===
${assignedB.slice(0, 5000)}

Score each output on all criteria (1-10). Be discriminating — use the full range. A 7 is competent. An 8 is good. A 9 is excellent. A 10 is exceptional and rare.

Return JSON:
{
  "output_a_scores": { <criteria scores> },
  "output_b_scores": { <criteria scores> },
  "winner": "A" | "B" | "tie",
  "key_difference": "1-2 sentences on what separates them"
}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: JUDGE_MODEL, max_tokens: 500, temperature: 0, system: rubric,
        messages: [{ role: "user", content: prompt }] }),
    });
    const data = await res.json() as any;
    if (data.error) { console.warn("[JUDGE] Error:", JSON.stringify(data.error).slice(0, 200)); return null; }
    const raw = data.content?.[0]?.text ?? "";
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const p = JSON.parse(match[0]);

    const aScores = Object.values(p.output_a_scores) as number[];
    const bScores = Object.values(p.output_b_scores) as number[];
    const aTotal = aScores.reduce((a, b) => a + b, 0) / aScores.length;
    const bTotal = bScores.reduce((a, b) => a + b, 0) / bScores.length;

    let winner: string;
    if (p.winner === "A") winner = nameA;
    else if (p.winner === "B") winner = nameB;
    else winner = "tie";

    return {
      tier, role, story, modelA, modelB, winner,
      aTotal: flip ? bTotal : aTotal,
      bTotal: flip ? aTotal : bTotal,
      keyDifference: p.key_difference,
    };
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

async function main() {
  const limit = createLimiter(CONCURRENCY);
  const comparisons: CompResult[] = [];
  const tasks: Promise<void>[] = [];

  // Build comparison tasks for Tier A
  const tierARoles = [...new Set(tierAValid.map(r => r.role))];
  for (const role of tierARoles) {
    const stories = [...new Set(tierAValid.filter(r => r.role === role).map(r => r.contractLabel!))];
    for (const story of stories) {
      const modelOutputs: Record<string, string> = {};
      for (const r of tierAValid.filter(r2 => r2.role === role && r2.contractLabel === story)) {
        if (!modelOutputs[r.model]) modelOutputs[r.model] = r._text; // first valid rep
      }
      const models = Object.keys(modelOutputs);
      for (let i = 0; i < models.length; i++) {
        for (let j = i + 1; j < models.length; j++) {
          tasks.push(limit(async () => {
            const result = await comparativeJudge("A", role, story, models[i], modelOutputs[models[i]], models[j], modelOutputs[models[j]]);
            if (result) {
              comparisons.push(result);
              const sA = models[i].replace(/-20\d{6}/, "").slice(0, 18);
              const sB = models[j].replace(/-20\d{6}/, "").slice(0, 18);
              const w = result.winner === models[i] ? sA : result.winner === models[j] ? sB : "TIE";
              log(`  A/${role.slice(0,12).padEnd(12)} ${story.slice(0,18).padEnd(18)} ${sA} vs ${sB} → ${w}`);
            }
          }));
        }
      }
    }
  }

  // Build comparison tasks for Tier B — spot check summaries and polish
  // Focus on the roles we changed: all summaries + all polish
  const tierBRoles = [...new Set(tierBValid.map(r => r.role))];
  for (const role of tierBRoles) {
    const stories = [...new Set(tierBValid.filter(r => r.role === role).map(r => r.storyLabel!))];
    for (const story of stories) {
      const modelOutputs: Record<string, string> = {};
      for (const r of tierBValid.filter(r2 => r2.role === role && r2.storyLabel === story)) {
        if (!modelOutputs[r.model]) modelOutputs[r.model] = r._text;
      }
      const models = Object.keys(modelOutputs);
      // Only compare the models we care about: Haiku (current) vs Mini (proposed) vs best alternative
      const focusModels = models.filter(m => m.includes("haiku") || m.includes("5.4-mini") || m.includes("grok-4-1"));
      for (let i = 0; i < focusModels.length; i++) {
        for (let j = i + 1; j < focusModels.length; j++) {
          tasks.push(limit(async () => {
            const result = await comparativeJudge("B", role, story, focusModels[i], modelOutputs[focusModels[i]], focusModels[j], modelOutputs[focusModels[j]]);
            if (result) {
              comparisons.push(result);
              const sA = focusModels[i].replace(/-20\d{6}/, "").slice(0, 18);
              const sB = focusModels[j].replace(/-20\d{6}/, "").slice(0, 18);
              const w = result.winner === focusModels[i] ? sA : result.winner === focusModels[j] ? sB : "TIE";
              log(`  B/${role.slice(0,12).padEnd(12)} ${story.slice(0,18).padEnd(18)} ${sA} vs ${sB} → ${w}`);
            }
          }));
        }
      }
    }
  }

  log(`Running ${tasks.length} pairwise comparisons...`);
  await Promise.all(tasks);
  log(`Done: ${comparisons.length} comparisons completed`);

  // ── Results ──
  const pad = (s: string, n: number) => s.padEnd(n);
  const lines: string[] = ["=".repeat(85), "  TIER A + B — COMPARATIVE RE-JUDGE", "=".repeat(85), ""];

  for (const tier of ["A", "B"]) {
    const tierComps = comparisons.filter(c => c.tier === tier);
    if (tierComps.length === 0) continue;

    lines.push("═".repeat(85));
    lines.push(`  TIER ${tier}`);
    lines.push("═".repeat(85));

    const roles = [...new Set(tierComps.map(c => c.role))];
    for (const role of roles) {
      const roleComps = tierComps.filter(c => c.role === role);
      const models = [...new Set([...roleComps.map(c => c.modelA), ...roleComps.map(c => c.modelB)])];

      const records: Record<string, { wins: number; losses: number; ties: number; totalScore: number; count: number }> = {};
      for (const m of models) records[m] = { wins: 0, losses: 0, ties: 0, totalScore: 0, count: 0 };

      for (const comp of roleComps) {
        if (comp.winner === comp.modelA) { records[comp.modelA].wins++; records[comp.modelB].losses++; }
        else if (comp.winner === comp.modelB) { records[comp.modelB].wins++; records[comp.modelA].losses++; }
        else { records[comp.modelA].ties++; records[comp.modelB].ties++; }
        records[comp.modelA].totalScore += comp.aTotal; records[comp.modelA].count++;
        records[comp.modelB].totalScore += comp.bTotal; records[comp.modelB].count++;
      }

      lines.push(`\n  ${role}`);
      lines.push(pad("  Model", 30) + pad("W-L-T", 12) + pad("Avg Score", 12) + pad("Win Rate", 10));
      lines.push("  " + "-".repeat(60));

      const sorted = models.sort((a, b) => {
        const aR = records[a], bR = records[b];
        const aRate = aR.wins / (aR.wins + aR.losses + aR.ties || 1);
        const bRate = bR.wins / (bR.wins + bR.losses + bR.ties || 1);
        return bRate - aRate;
      });

      for (const model of sorted) {
        const r = records[model];
        const total = r.wins + r.losses + r.ties;
        lines.push(
          pad("  " + model.replace(/-20\d{6}/, ""), 30) +
          pad(`${r.wins}-${r.losses}-${r.ties}`, 12) +
          pad(r.count > 0 ? (r.totalScore / r.count).toFixed(1) : "N/A", 12) +
          pad(total > 0 ? ((r.wins / total) * 100).toFixed(0) + "%" : "N/A", 10)
        );
      }

      // Show key matchup details
      for (const comp of roleComps.slice(0, 6)) { // cap at 6 per role to keep output manageable
        const sA = comp.modelA.replace(/-20\d{6}/, "").slice(0, 16);
        const sB = comp.modelB.replace(/-20\d{6}/, "").slice(0, 16);
        const w = comp.winner === comp.modelA ? sA : comp.winner === comp.modelB ? sB : "TIE";
        lines.push(`    ${comp.story.slice(0, 22).padEnd(22)} ${sA} (${comp.aTotal.toFixed(1)}) vs ${sB} (${comp.bTotal.toFixed(1)}) → ${w}`);
      }
    }
    lines.push("");
  }

  // Decision validation summary
  lines.push("═".repeat(85));
  lines.push("  DECISION VALIDATION SUMMARY");
  lines.push("═".repeat(85));

  // Tier A: summarizer → Nano decision
  const summarizerComps = comparisons.filter(c => c.role === "summarizer");
  if (summarizerComps.length > 0) {
    const nanoVsHaiku = summarizerComps.filter(c =>
      (c.modelA.includes("nano") && c.modelB.includes("haiku")) ||
      (c.modelB.includes("nano") && c.modelA.includes("haiku"))
    );
    lines.push(`\n  Summarizer (Nano vs Haiku): ${nanoVsHaiku.length} matchups`);
    for (const c of nanoVsHaiku) {
      const w = c.winner.includes("nano") ? "NANO" : c.winner.includes("haiku") ? "HAIKU" : "TIE";
      lines.push(`    ${c.story.slice(0, 22).padEnd(22)} → ${w} (${c.keyDifference.slice(0, 100)})`);
    }
  }

  // Tier B: summaries → Mini decision
  const summaryComps = comparisons.filter(c => c.tier === "B" && ["hook_summary", "char_summary", "img_summary", "world_summary", "plot_summary"].includes(c.role));
  const miniVsHaikuSummary = summaryComps.filter(c =>
    (c.modelA.includes("5.4-mini") && c.modelB.includes("haiku")) ||
    (c.modelB.includes("5.4-mini") && c.modelA.includes("haiku"))
  );
  if (miniVsHaikuSummary.length > 0) {
    const miniWins = miniVsHaikuSummary.filter(c => c.winner.includes("5.4-mini")).length;
    const haikuWins = miniVsHaikuSummary.filter(c => c.winner.includes("haiku")).length;
    const ties = miniVsHaikuSummary.filter(c => c.winner === "tie").length;
    lines.push(`\n  Summaries Mini vs Haiku: Mini ${miniWins} - Haiku ${haikuWins} - Tie ${ties}`);
  }

  // Tier B: polish → Mini decision
  const polishComps = comparisons.filter(c => c.tier === "B" && ["premise_polish", "char_polish", "world_polish"].includes(c.role));
  const miniVsHaikuPolish = polishComps.filter(c =>
    (c.modelA.includes("5.4-mini") && c.modelB.includes("haiku")) ||
    (c.modelB.includes("5.4-mini") && c.modelA.includes("haiku"))
  );
  if (miniVsHaikuPolish.length > 0) {
    const miniWins = miniVsHaikuPolish.filter(c => c.winner.includes("5.4-mini")).length;
    const haikuWins = miniVsHaikuPolish.filter(c => c.winner.includes("haiku")).length;
    const ties = miniVsHaikuPolish.filter(c => c.winner === "tie").length;
    lines.push(`  Polish Mini vs Haiku: Mini ${miniWins} - Haiku ${haikuWins} - Tie ${ties}`);
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  await mkdir("./data/blind-tests", { recursive: true });
  const reportPath = `./data/blind-tests/tier_ab_comparative_${ts}.txt`;
  await writeFile(reportPath, lines.join("\n"), "utf-8");

  console.log("\n" + lines.join("\n"));
  console.log(`\nReport: ${reportPath}`);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
