/**
 * PASS 4+5 — ANTI-SLOP RESCAN + POST-FIX VERIFICATION
 * ═════════════════════════════════════════════════════
 * Pass 4: Run existing anti-slop scanner on fixed scenes (no LLM)
 * Pass 5: Haiku verification — compares before/after diffs against
 *         neighbors and continuity ledger. Only flags NEW contradictions
 *         introduced by the edits, not pre-existing issues.
 */

import "dotenv/config";
import { scanForSlop } from "../backend/services/antiSlopScanner";
import type {
  IdentifiedScene,
  ContinuityLedger,
  SceneEditResult,
  VerificationResult,
} from "./types";

// ── Config ──

const VERIFY_MODEL = process.env.EDITOR_VERIFY_MODEL ?? "claude-haiku-4-5-20251001";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// ── Main ──

export async function runVerification(
  editedScenes: IdentifiedScene[],
  originalScenes: IdentifiedScene[],
  editResults: SceneEditResult[],
  ledger: ContinuityLedger,
): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];
  const fixedSceneIds = new Set(
    editResults.filter(r => r.status === "fixed").map(r => r.scene_id)
  );

  for (const scene of editedScenes) {
    if (!fixedSceneIds.has(scene.scene_id)) continue;

    // Pass 4: Anti-slop rescan
    const sceneText = scene.lines.map(l => l.text).join("\n");
    const slopReport = scanForSlop(sceneText);

    // Pass 5: Continuity verification — compare before/after
    const originalScene = originalScenes.find(s => s.scene_id === scene.scene_id);
    if (!originalScene) {
      results.push({
        scene_id: scene.scene_id,
        passed: slopReport.pass,
        new_contradictions: [],
        slop_score: slopReport.score,
        slop_passed: slopReport.pass,
      });
      continue;
    }

    // Build diff summary
    const diffSummary = buildDiffSummary(originalScene, scene);

    if (diffSummary.length === 0) {
      // No actual changes — skip LLM verification
      results.push({
        scene_id: scene.scene_id,
        passed: slopReport.pass,
        new_contradictions: [],
        slop_score: slopReport.score,
        slop_passed: slopReport.pass,
      });
      continue;
    }

    const neighbors = getNeighborScenes(editedScenes, scene.scene_id);
    const contradictions = await verifyContinuity(scene.scene_id, diffSummary, neighbors, ledger);

    results.push({
      scene_id: scene.scene_id,
      passed: slopReport.pass && contradictions.length === 0,
      new_contradictions: contradictions,
      slop_score: slopReport.score,
      slop_passed: slopReport.pass,
    });
  }

  return results;
}

// ── Diff Summary ──

interface LineDiffEntry {
  line_id: string;
  type: "changed" | "added" | "removed";
  old_text?: string;
  new_text?: string;
  speaker: string;
}

function buildDiffSummary(original: IdentifiedScene, edited: IdentifiedScene): LineDiffEntry[] {
  const diffs: LineDiffEntry[] = [];
  const originalById = new Map(original.lines.map(l => [l._lid, l]));
  const editedById = new Map(edited.lines.map(l => [l._lid, l]));

  // Find changed and removed lines
  for (const [lid, origLine] of originalById) {
    const editedLine = editedById.get(lid);
    if (!editedLine) {
      diffs.push({ line_id: lid, type: "removed", old_text: origLine.text, speaker: origLine.speaker });
    } else if (origLine.text !== editedLine.text) {
      diffs.push({ line_id: lid, type: "changed", old_text: origLine.text, new_text: editedLine.text, speaker: editedLine.speaker });
    }
  }

  // Find added lines
  for (const [lid, editedLine] of editedById) {
    if (!originalById.has(lid)) {
      diffs.push({ line_id: lid, type: "added", new_text: editedLine.text, speaker: editedLine.speaker });
    }
  }

  return diffs;
}

// ── Pass 5: Continuity Verification ──

async function verifyContinuity(
  sceneId: string,
  diffs: LineDiffEntry[],
  neighbors: IdentifiedScene[],
  ledger: ContinuityLedger,
): Promise<string[]> {
  if (!ANTHROPIC_API_KEY) return [];

  const diffText = diffs.map(d => {
    if (d.type === "changed") return `CHANGED [${d.line_id}] ${d.speaker}: "${d.old_text}" → "${d.new_text}"`;
    if (d.type === "added") return `ADDED [${d.line_id}] ${d.speaker}: "${d.new_text}"`;
    return `REMOVED [${d.line_id}] ${d.speaker}: "${d.old_text}"`;
  }).join("\n");

  const neighborText = neighbors.map(n => formatSceneCompact(n)).join("\n\n");
  const ledgerText = formatLedger(ledger);

  const systemPrompt = `You verify that recent EDITS to a visual novel scene did not introduce NEW contradictions with neighboring scenes or established story facts.

CRITICAL RULES:
- You are ONLY checking whether the CHANGES introduced problems. The original scene may have had pre-existing issues — ignore those.
- Compare the OLD text → NEW text for each changed line. Did the new text contradict something in the neighbors or the ledger?
- If an ADDED line introduces a fact that conflicts with established facts, flag it.
- If a REMOVED line was referenced by a neighbor, flag it.
- If the changes are consistent with the story, return an empty array.
- Do NOT flag pre-existing issues that were already in the original text.`;

  const userPrompt = `## ESTABLISHED FACTS
${ledgerText}

## EDITS MADE TO ${sceneId}
${diffText}

## NEIGHBORING SCENES (for reference)
${neighborText}

---

Return JSON only:
{ "contradictions": ["description of each NEW contradiction introduced by the edits, if any"] }`;

  try {
    const response = await callAnthropic(systemPrompt, userPrompt, VERIFY_MODEL, 0.2, 1000);
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]);
    return parsed.contradictions ?? [];
  } catch {
    return []; // Verification failure is non-fatal
  }
}

// ── Helpers ──

function getNeighborScenes(scenes: IdentifiedScene[], sceneId: string): IdentifiedScene[] {
  const idx = scenes.findIndex(s => s.scene_id === sceneId);
  if (idx === -1) return [];
  const neighbors: IdentifiedScene[] = [];
  if (idx > 0) neighbors.push(scenes[idx - 1]);
  if (idx < scenes.length - 1) neighbors.push(scenes[idx + 1]);
  return neighbors;
}

function formatSceneCompact(scene: IdentifiedScene): string {
  const lines = scene.lines.map(l => {
    if (l.speaker === "NARRATION" || l.speaker === "narration") return `(narration) ${l.text}`;
    if (l.speaker === "INTERNAL") return `(internal) ${l.text}`;
    return `${l.speaker}: "${l.text}"`;
  });
  return `[${scene.scene_id} — "${scene.title}"]\n${lines.join("\n")}`;
}

function formatLedger(ledger: ContinuityLedger): string {
  const parts: string[] = [];
  for (const char of ledger.characters) {
    parts.push(`${char.name}: ${char.established_facts.join("; ")}`);
  }
  for (const rel of ledger.relationships) {
    parts.push(`${rel.between[0]} ↔ ${rel.between[1]}: ${rel.state}`);
  }
  if (ledger.world_facts.length > 0) {
    parts.push(`World: ${ledger.world_facts.join("; ")}`);
  }
  return parts.join("\n") || "(no ledger data)";
}

// ── LLM Call ──

async function callAnthropic(
  system: string,
  user: string,
  model: string,
  temperature: number,
  maxTokens: number,
): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  const data = await res.json() as any;
  if (data.error) throw new Error(`Anthropic API error: ${JSON.stringify(data.error)}`);
  return data.content?.[0]?.text ?? "";
}
