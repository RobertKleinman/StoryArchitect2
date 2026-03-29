/**
 * PASS 4+5 — ANTI-SLOP RESCAN + POST-FIX VERIFICATION
 * ═════════════════════════════════════════════════════
 * Pass 4: Run existing anti-slop scanner on fixed scenes (no LLM)
 * Pass 5: Haiku verification on changed scenes + neighbors against continuity ledger
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
  scenes: IdentifiedScene[],
  editResults: SceneEditResult[],
  ledger: ContinuityLedger,
): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];
  const fixedSceneIds = new Set(
    editResults.filter(r => r.status === "fixed").map(r => r.scene_id)
  );

  for (const scene of scenes) {
    if (!fixedSceneIds.has(scene.scene_id)) continue;

    // Pass 4: Anti-slop rescan
    const sceneText = scene.lines.map(l => l.text).join("\n");
    const slopReport = scanForSlop(sceneText);

    // Pass 5: Continuity verification (Haiku call)
    const neighbors = getNeighborScenes(scenes, scene.scene_id);
    const contradictions = await verifyContinuity(scene, neighbors, ledger);

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

// ── Pass 5: Continuity Verification ──

async function verifyContinuity(
  scene: IdentifiedScene,
  neighbors: IdentifiedScene[],
  ledger: ContinuityLedger,
): Promise<string[]> {
  if (!ANTHROPIC_API_KEY) return [];

  const sceneText = formatSceneCompact(scene);
  const neighborText = neighbors.map(n => formatSceneCompact(n)).join("\n\n");
  const ledgerText = formatLedger(ledger);

  const systemPrompt = `You verify that a recently edited visual novel scene is still consistent with its neighboring scenes and established story facts. Return ONLY new contradictions introduced by the edit. If everything is consistent, return an empty array.`;

  const userPrompt = `## ESTABLISHED FACTS (continuity ledger)
${ledgerText}

## EDITED SCENE: ${scene.scene_id}
${sceneText}

## NEIGHBORING SCENES
${neighborText}

---

Return JSON only:
{ "contradictions": ["string description of each new contradiction"] }`;

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
