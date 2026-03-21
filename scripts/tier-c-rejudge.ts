#!/usr/bin/env tsx
/**
 * TIER C — COMPARATIVE RE-JUDGE
 * ═════════════════════════════
 * Re-judges existing Tier C outputs using:
 * 1. Comparative judging (blinded A vs B for same story/role)
 * 2. Role-specific discriminating rubrics
 * 3. Harder scoring criteria that target actual failure modes
 *
 * Reads raw data from the previous Tier C run. No new model calls.
 */

import "dotenv/config";
import { readFileSync } from "fs";
import { mkdir, writeFile } from "fs/promises";

const JUDGE_MODEL = "claude-sonnet-4-6";
const CONCURRENCY = 4;

// ── Load previous results ──

interface PrevResult {
  role: string; model: string; storyLabel: string; rep: number;
  durationMs: number; valid: boolean; error?: string;
  _text: string;
}

const RAW_FILE = "./data/blind-tests/tier_c_raw_2026-03-21T15-40-58.json";
const allResults: PrevResult[] = JSON.parse(readFileSync(RAW_FILE, "utf-8"));
const validResults = allResults.filter(r => r.valid && r._text);

console.log(`Loaded ${allResults.length} total, ${validResults.length} valid outputs from Tier C run\n`);

// ── Role-specific discriminating rubrics ──

const CLARIFIER_JUDGE = `You are comparing TWO hook clarifier outputs for the same story. Both received identical inputs. Your job is to determine which is BETTER and WHY, using criteria that actually matter for a user-facing creative partner.

CRITERIA (score each 1-10 for EACH output):
1. ASSUMPTION QUALITY: Are the surfaced assumptions creative, specific, and genuinely different from each other? Or are they obvious/formulaic variations? A great clarifier surprises the user with possibilities they hadn't considered.
2. HYPOTHESIS EVOLUTION: Does the hypothesis_line feel like a specific story only THIS user would create? Or could it describe dozens of stories? Check: could you swap the setting and characters and the hypothesis still works? If yes, it's generic.
3. QUESTION CRAFT: Is the question fun and imagination-sparking? Or does it feel like a survey/checklist? Would a user be EXCITED to answer it?
4. OPTION DIVERGENCE: Are the options genuinely different directions? Or variations on the same theme? Each option should spark a completely different story in the user's mind.
5. PSYCHOLOGY READ: Does the user_read show genuine insight about this specific user's patterns? Or is it generic "user seems engaged" filler?
6. CONSTRAINT RESPECT: Does it correctly honor CONFIRMED constraints from the ledger without re-asking them?

OUTPUT FORMAT:
{
  "output_a_scores": { "assumptions": N, "hypothesis": N, "question": N, "options": N, "psychology": N, "constraints": N },
  "output_b_scores": { "assumptions": N, "hypothesis": N, "question": N, "options": N, "psychology": N, "constraints": N },
  "winner": "A" | "B" | "tie",
  "key_difference": "1-2 sentences on what separates them",
  "weakness_a": "biggest weakness of A",
  "weakness_b": "biggest weakness of B"
}`;

const BUILDER_JUDGE = `You are comparing TWO hook builder outputs for the same story. Both received identical inputs. Your job is to determine which is BETTER and WHY.

CRITERIA (score each 1-10 for EACH output):
1. HOOK IRRESISTIBILITY: Would you describe this hook to a friend at 2am? Does it make you NEED to know what happens? Or is it competent but forgettable?
2. PREMISE SPECIFICITY: Does the premise contain a specific mechanism/ritual/rule that makes it THIS story and not another? Or could you swap the details and it still works?
3. COLLISION DEPTH: Are the collision sources genuinely surprising combinations? Did the model extract concrete MECHANISMS (not vibes) and combine them into something new? Or is it a "vibe collage"?
4. EMOTIONAL PROMISE: Is it a specific FEELING ("the guilty thrill of wanting someone you're supposed to destroy") or a genre label ("a dark romance")?
5. VISUAL CONCRETENESS: Are opening_image and page_1_splash_prompt DRAWABLE specific scenes? Or mood descriptions?
6. USER AUTHORSHIP: Does the premise honor what the user chose during clarification? Or did the model invent new load-bearing elements?

OUTPUT FORMAT:
{
  "output_a_scores": { "irresistibility": N, "specificity": N, "collision": N, "emotion": N, "visual": N, "authorship": N },
  "output_b_scores": { "irresistibility": N, "specificity": N, "collision": N, "emotion": N, "visual": N, "authorship": N },
  "winner": "A" | "B" | "tie",
  "key_difference": "1-2 sentences on what separates them",
  "weakness_a": "biggest weakness of A",
  "weakness_b": "biggest weakness of B"
}`;

const JUDGE_JUDGE = `You are comparing TWO hook judge outputs for the same story. Both evaluated identical hook candidates. Your job is to determine which JUDGE is BETTER and WHY.

CRITERIA (score each 1-10 for EACH output):
1. ANALYSIS DEPTH: Does the analysis show genuine reasoning about the hook's strengths and weaknesses? Or is it surface-level ("this is good because it's specific")?
2. HARD-FAIL ACCURACY: Does it correctly apply the hard-fail criteria? Does it catch genuinely generic hooks AND pass genuinely strong ones? False positives and false negatives both matter.
3. SCORE CALIBRATION: Are the scores honest and discriminating? A 10 should be rare. A 5-7 is competent. Below 5 means real problems. Does the judge use the full range?
4. MOST_GENERIC_PART: Does it identify the ACTUAL weakest element? Or just pick something at random?
5. FIX QUALITY: Is the one_fix_instruction actionable and specific? Would following it actually improve the hook? Or is it generic advice?
6. CRITICAL THINKING: Does the judge push back against "competent but forgettable" work? Or does it rubber-stamp anything that follows the format?

OUTPUT FORMAT:
{
  "output_a_scores": { "analysis": N, "hardfail": N, "calibration": N, "generic_id": N, "fix": N, "critical": N },
  "output_b_scores": { "analysis": N, "hardfail": N, "calibration": N, "generic_id": N, "fix": N, "critical": N },
  "winner": "A" | "B" | "tie",
  "key_difference": "1-2 sentences on what separates them",
  "weakness_a": "biggest weakness of A",
  "weakness_b": "biggest weakness of B"
}`;

const ROLE_JUDGES: Record<string, string> = {
  clarifier: CLARIFIER_JUDGE,
  builder: BUILDER_JUDGE,
  judge: JUDGE_JUDGE,
};

// ── Comparative judging ──

interface CompResult {
  role: string;
  storyLabel: string;
  modelA: string;
  modelB: string;
  winner: string; // modelA name, modelB name, or "tie"
  aTotal: number;
  bTotal: number;
  keyDifference: string;
  weaknessA: string;
  weaknessB: string;
}

async function comparativeJudge(
  role: string, storyLabel: string,
  modelA: string, textA: string,
  modelB: string, textB: string,
): Promise<CompResult | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;

  // Randomize A/B assignment to prevent position bias
  const flip = Math.random() > 0.5;
  const [assignedA, assignedB] = flip ? [textB, textA] : [textA, textB];
  const [nameA, nameB] = flip ? [modelB, modelA] : [modelA, modelB];

  const judgeSystem = ROLE_JUDGES[role];
  const prompt = `Compare these two ${role} outputs for the story "${storyLabel}".

=== OUTPUT A ===
${assignedA.slice(0, 5000)}

=== OUTPUT B ===
${assignedB.slice(0, 5000)}

Score each output on all criteria (1-10). Determine the winner. Be discriminating — if one is clearly better, say so.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: JUDGE_MODEL, max_tokens: 600, temperature: 0, system: judgeSystem,
        messages: [{ role: "user", content: prompt }] }),
    });
    const data = await res.json() as any;
    if (data.error) { console.warn("[JUDGE] Error:", JSON.stringify(data.error).slice(0, 200)); return null; }
    const raw = data.content?.[0]?.text ?? "";
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) { console.warn("[JUDGE] No JSON"); return null; }
    const p = JSON.parse(match[0]);

    const aScores = Object.values(p.output_a_scores) as number[];
    const bScores = Object.values(p.output_b_scores) as number[];
    const aTotal = aScores.reduce((a, b) => a + b, 0) / aScores.length;
    const bTotal = bScores.reduce((a, b) => a + b, 0) / bScores.length;

    // Map winner back to real model names
    let winner: string;
    if (p.winner === "A") winner = nameA;
    else if (p.winner === "B") winner = nameB;
    else winner = "tie";

    return {
      role, storyLabel, modelA, modelB, winner,
      aTotal: flip ? bTotal : aTotal,  // map back to original model order
      bTotal: flip ? aTotal : bTotal,
      keyDifference: p.key_difference,
      weaknessA: flip ? p.weakness_b : p.weakness_a,
      weaknessB: flip ? p.weakness_a : p.weakness_b,
    };
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

async function main() {
  const limit = createLimiter(CONCURRENCY);
  const models = [...new Set(validResults.map(r => r.model))];
  const roles = [...new Set(validResults.map(r => r.role))];
  const stories = [...new Set(validResults.map(r => r.storyLabel))];

  console.log("Models with valid outputs:", models);
  console.log("Roles:", roles);
  console.log("Stories:", stories);

  // Generate all pairwise comparisons
  const comparisons: CompResult[] = [];
  const tasks: Promise<void>[] = [];

  for (const role of roles) {
    for (const story of stories) {
      // Get best rep for each model (first valid one)
      const modelOutputs: Record<string, string> = {};
      for (const model of models) {
        const output = validResults.find(r => r.role === role && r.storyLabel === story && r.model === model);
        if (output) modelOutputs[model] = output._text;
      }

      const availableModels = Object.keys(modelOutputs);
      // All pairwise comparisons
      for (let i = 0; i < availableModels.length; i++) {
        for (let j = i + 1; j < availableModels.length; j++) {
          const mA = availableModels[i];
          const mB = availableModels[j];
          tasks.push(limit(async () => {
            const result = await comparativeJudge(role, story, mA, modelOutputs[mA], mB, modelOutputs[mB]);
            if (result) {
              comparisons.push(result);
              const shortA = mA.replace(/-20\d{6}/, "").slice(0, 20);
              const shortB = mB.replace(/-20\d{6}/, "").slice(0, 20);
              const w = result.winner === mA ? shortA : result.winner === mB ? shortB : "TIE";
              log(`  ${role.padEnd(11)} ${story.slice(0, 15).padEnd(15)} ${shortA} vs ${shortB} → ${w} (${result.aTotal.toFixed(1)} vs ${result.bTotal.toFixed(1)})`);
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
  const lines: string[] = ["=".repeat(85), "  TIER C — COMPARATIVE RE-JUDGE RESULTS", "=".repeat(85), ""];

  for (const role of roles) {
    lines.push("═".repeat(85));
    lines.push(`  ${role.toUpperCase()} — HEAD-TO-HEAD`);
    lines.push("═".repeat(85));

    // Win/loss/tie record for each model
    const records: Record<string, { wins: number; losses: number; ties: number; totalScore: number; count: number }> = {};
    for (const model of models) {
      records[model] = { wins: 0, losses: 0, ties: 0, totalScore: 0, count: 0 };
    }

    const roleComps = comparisons.filter(c => c.role === role);
    for (const comp of roleComps) {
      if (comp.winner === comp.modelA) {
        records[comp.modelA].wins++;
        records[comp.modelB].losses++;
      } else if (comp.winner === comp.modelB) {
        records[comp.modelB].wins++;
        records[comp.modelA].losses++;
      } else {
        records[comp.modelA].ties++;
        records[comp.modelB].ties++;
      }
      records[comp.modelA].totalScore += comp.aTotal;
      records[comp.modelA].count++;
      records[comp.modelB].totalScore += comp.bTotal;
      records[comp.modelB].count++;
    }

    lines.push(pad("Model", 25) + pad("W-L-T", 12) + pad("Avg Score", 12) + pad("Win Rate", 10));
    lines.push("-".repeat(59));

    const sorted = models.filter(m => records[m].count > 0).sort((a, b) => {
      const aRate = records[a].wins / (records[a].wins + records[a].losses + records[a].ties);
      const bRate = records[b].wins / (records[b].wins + records[b].losses + records[b].ties);
      return bRate - aRate;
    });

    for (const model of sorted) {
      const r = records[model];
      const total = r.wins + r.losses + r.ties;
      const winRate = total > 0 ? ((r.wins / total) * 100).toFixed(0) + "%" : "N/A";
      const avgScore = r.count > 0 ? (r.totalScore / r.count).toFixed(1) : "N/A";
      lines.push(pad(model.replace(/-20\d{6}/, ""), 25) + pad(`${r.wins}-${r.losses}-${r.ties}`, 12) + pad(String(avgScore), 12) + pad(winRate, 10));
    }

    // Show matchup details
    lines.push("");
    for (const comp of roleComps) {
      const shortA = comp.modelA.replace(/-20\d{6}/, "").slice(0, 18);
      const shortB = comp.modelB.replace(/-20\d{6}/, "").slice(0, 18);
      const w = comp.winner === comp.modelA ? shortA : comp.winner === comp.modelB ? shortB : "TIE";
      lines.push(`  ${comp.storyLabel.slice(0, 18).padEnd(18)} ${shortA} (${comp.aTotal.toFixed(1)}) vs ${shortB} (${comp.bTotal.toFixed(1)}) → ${w}`);
      lines.push(`    Why: ${comp.keyDifference}`);
    }
    lines.push("");
  }

  // Overall summary
  lines.push("═".repeat(85));
  lines.push("  OVERALL RECORD");
  lines.push("═".repeat(85));
  lines.push(pad("Model", 25) + pad("W-L-T", 12) + pad("Avg Score", 12) + pad("Win Rate", 10));
  lines.push("-".repeat(59));

  const overall: Record<string, { wins: number; losses: number; ties: number; totalScore: number; count: number }> = {};
  for (const model of models) overall[model] = { wins: 0, losses: 0, ties: 0, totalScore: 0, count: 0 };
  for (const comp of comparisons) {
    if (comp.winner === comp.modelA) { overall[comp.modelA].wins++; overall[comp.modelB].losses++; }
    else if (comp.winner === comp.modelB) { overall[comp.modelB].wins++; overall[comp.modelA].losses++; }
    else { overall[comp.modelA].ties++; overall[comp.modelB].ties++; }
    overall[comp.modelA].totalScore += comp.aTotal; overall[comp.modelA].count++;
    overall[comp.modelB].totalScore += comp.bTotal; overall[comp.modelB].count++;
  }

  const overallSorted = models.filter(m => overall[m].count > 0).sort((a, b) => {
    const aRate = overall[a].wins / (overall[a].wins + overall[a].losses + overall[a].ties || 1);
    const bRate = overall[b].wins / (overall[b].wins + overall[b].losses + overall[b].ties || 1);
    return bRate - aRate;
  });
  for (const model of overallSorted) {
    const r = overall[model];
    const total = r.wins + r.losses + r.ties;
    lines.push(pad(model.replace(/-20\d{6}/, ""), 25) + pad(`${r.wins}-${r.losses}-${r.ties}`, 12) + pad(r.count > 0 ? (r.totalScore / r.count).toFixed(1) : "N/A", 12) + pad(total > 0 ? ((r.wins / total) * 100).toFixed(0) + "%" : "N/A", 10));
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  await mkdir("./data/blind-tests", { recursive: true });
  const reportPath = `./data/blind-tests/tier_c_comparative_${ts}.txt`;
  await writeFile(reportPath, lines.join("\n"), "utf-8");

  console.log("\n" + lines.join("\n"));
  console.log(`\nReport: ${reportPath}`);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
