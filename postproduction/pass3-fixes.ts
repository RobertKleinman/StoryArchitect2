/**
 * PASS 3 — TARGETED FIXES
 * ════════════════════════
 * Per-scene diff-based fixes. For each scene with fixable issues:
 * - LLM returns edits as [{line_id, action, new_line}]
 * - TypeScript applies diffs deterministically
 * - Rejects if unflagged lines were altered
 * - Retries once on rejection, then tags UNFIXED
 */

import "dotenv/config";
import type {
  IdentifiedScene,
  IdentifiedLine,
  EditorialFinding,
  ContinuityLedger,
  StructuralIssue,
  LineDiff,
  SceneEditResult,
  VNLine,
} from "./types";

// ── Config ──

const MODEL = process.env.EDITOR_MODEL ?? "claude-sonnet-4-6";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// ── Main ──

export async function runTargetedFixes(
  scenes: IdentifiedScene[],
  findings: EditorialFinding[],
  structuralIssues: StructuralIssue[],
  ledger: ContinuityLedger,
  seed: string,
): Promise<{ scenes: IdentifiedScene[]; results: SceneEditResult[] }> {
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY required for editor");

  const results: SceneEditResult[] = [];
  const updatedScenes = [...scenes];

  // Group findings by scene
  const findingsByScene = new Map<string, EditorialFinding[]>();
  for (const f of findings) {
    const existing = findingsByScene.get(f.scene_id) ?? [];
    existing.push(f);
    findingsByScene.set(f.scene_id, existing);
  }

  // Group auto-fixable structural issues by scene
  const structuralByScene = new Map<string, StructuralIssue[]>();
  for (const s of structuralIssues) {
    if (!s.auto_fixable || !s.scene_id) continue;
    const existing = structuralByScene.get(s.scene_id) ?? [];
    existing.push(s);
    structuralByScene.set(s.scene_id, existing);
  }

  // Collect all scenes that need fixing
  const scenesToFix = new Set([...findingsByScene.keys(), ...structuralByScene.keys()]);

  for (const sceneId of scenesToFix) {
    const sceneIdx = updatedScenes.findIndex(s => s.scene_id === sceneId);
    if (sceneIdx === -1) continue;

    const scene = updatedScenes[sceneIdx];
    const sceneFindings = findingsByScene.get(sceneId) ?? [];
    const sceneStructural = structuralByScene.get(sceneId) ?? [];

    if (sceneFindings.length === 0 && sceneStructural.length === 0) continue;

    // Try to fix (with one retry)
    let result = await attemptFix(scene, sceneFindings, sceneStructural, ledger, seed, false);

    if (result.status === "unfixed" && result.diffs_rejected > 0) {
      // Retry with stricter prompt
      result = await attemptFix(scene, sceneFindings, sceneStructural, ledger, seed, true);
    }

    if (result.status === "fixed" && result.fixedScene) {
      updatedScenes[sceneIdx] = result.fixedScene;
    }

    results.push({
      scene_id: sceneId,
      status: result.status,
      diffs_applied: result.diffs_applied,
      diffs_rejected: result.diffs_rejected,
      issues_addressed: [
        ...sceneFindings.map(f => f.description),
        ...sceneStructural.map(s => s.message),
      ],
    });
  }

  // Mark scenes with no issues as unchanged
  for (const scene of updatedScenes) {
    if (!scenesToFix.has(scene.scene_id)) {
      results.push({
        scene_id: scene.scene_id,
        status: "unchanged",
        diffs_applied: 0,
        diffs_rejected: 0,
        issues_addressed: [],
      });
    }
  }

  return { scenes: updatedScenes, results };
}

// ── Fix Attempt ──

interface FixAttemptResult {
  status: "fixed" | "unfixed";
  fixedScene?: IdentifiedScene;
  diffs_applied: number;
  diffs_rejected: number;
}

async function attemptFix(
  scene: IdentifiedScene,
  findings: EditorialFinding[],
  structural: StructuralIssue[],
  ledger: ContinuityLedger,
  seed: string,
  strict: boolean,
): Promise<FixAttemptResult> {
  const issueList = [
    ...findings.map(f => `[${f.category}] Line ${f.line_id}: ${f.description}. Suggestion: ${f.fix_suggestion}`),
    ...structural.map(s => `[${s.category}] ${s.line_id ? `Line ${s.line_id}: ` : ""}${s.message}`),
  ].join("\n");

  // Flagged line IDs — only these may be changed
  const flaggedLineIds = new Set([
    ...findings.map(f => f.line_id),
    ...structural.filter(s => s.line_id).map(s => s.line_id!),
  ]);

  const sceneText = scene.lines.map(l =>
    `[${l._lid}] ${l.speaker}${l.emotion ? ` [${l.emotion}]` : ""}: "${l.text}"${l.delivery ? ` (${l.delivery})` : ""}`
  ).join("\n");

  const strictNote = strict
    ? "\nSTRICT MODE: Your previous edit was rejected because you altered unflagged lines. This time, ONLY modify lines listed in FLAGGED LINE IDS below. Do not touch any other lines."
    : "";

  const systemPrompt = `You are a surgical editor for a visual novel script. You receive a scene with specific flagged issues and must return ONLY the minimal edits needed to fix them.${strictNote}

RULES:
- Return edits as a JSON array of diffs
- Each diff targets a specific line by its _lid
- You may ONLY modify lines that are flagged — all other lines must remain untouched
- For "replace": provide the complete new line object
- For "insert_after": provide a new line to insert after the target line
- For "delete": just specify the line_id
- Preserve the character's voice and the scene's tone
- Fix ONLY what's flagged — do not improve, polish, or rewrite anything else

FLAGGED LINE IDS (only these may be changed):
${[...flaggedLineIds].join(", ")}`;

  const userPrompt = `## SEED (what the user asked for)
${seed}

## CONTINUITY FACTS
${formatLedger(ledger)}

## SCENE: ${scene.scene_id} — "${scene.title}"
${sceneText}

## ISSUES TO FIX
${issueList}

---

Return JSON only:
{
  "diffs": [
    {
      "line_id": "exact _lid",
      "expected_old_text": "exact current text of this line",
      "action": "replace" | "insert_after" | "delete",
      "new_line": { "speaker": "...", "text": "...", "emotion": "...", "stage_direction": null, "delivery": null }
    }
  ]
}`;

  try {
    const response = await callAnthropic(systemPrompt, userPrompt, MODEL, 0.5, 8000);
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { status: "unfixed", diffs_applied: 0, diffs_rejected: 0 };

    const parsed = JSON.parse(jsonMatch[0]);
    const diffs: LineDiff[] = parsed.diffs ?? [];

    if (diffs.length === 0) return { status: "unfixed", diffs_applied: 0, diffs_rejected: 0 };

    // Apply diffs with validation
    return applyDiffs(scene, diffs, flaggedLineIds);
  } catch (err) {
    console.error(`[PASS3] Fix attempt failed for ${scene.scene_id}:`, err);
    return { status: "unfixed", diffs_applied: 0, diffs_rejected: 0 };
  }
}

// ── Diff Application ──

function applyDiffs(
  scene: IdentifiedScene,
  diffs: LineDiff[],
  flaggedLineIds: Set<string>,
): FixAttemptResult {
  let applied = 0;
  let rejected = 0;
  const newLines: IdentifiedLine[] = [];
  const deletedIds = new Set(diffs.filter(d => d.action === "delete").map(d => d.line_id));

  for (const line of scene.lines) {
    // Check if this line should be deleted
    if (deletedIds.has(line._lid)) {
      if (!flaggedLineIds.has(line._lid)) {
        rejected++;
        newLines.push(line); // Keep unflagged line
      } else {
        applied++;
      }
      continue;
    }

    // Check if this line should be replaced
    const replaceDiff = diffs.find(d => d.line_id === line._lid && d.action === "replace");
    if (replaceDiff) {
      if (!flaggedLineIds.has(line._lid)) {
        rejected++;
        newLines.push(line);
      } else if (replaceDiff.expected_old_text && replaceDiff.expected_old_text !== line.text) {
        // Old text doesn't match — stale reference
        rejected++;
        newLines.push(line);
      } else if (replaceDiff.new_line) {
        newLines.push({
          ...replaceDiff.new_line,
          _lid: line._lid,
        } as IdentifiedLine);
        applied++;
      }
    } else {
      newLines.push(line);
    }

    // Check for insert_after
    const insertDiff = diffs.find(d => d.line_id === line._lid && d.action === "insert_after");
    if (insertDiff && insertDiff.new_line) {
      // Generate a new line ID for inserted lines
      const newLid = `${line._lid}_ins`;
      newLines.push({
        ...insertDiff.new_line,
        _lid: newLid,
      } as IdentifiedLine);
      applied++;
    }
  }

  if (rejected > 0 && applied === 0) {
    return { status: "unfixed", diffs_applied: 0, diffs_rejected: rejected };
  }

  return {
    status: applied > 0 ? "fixed" : "unfixed",
    fixedScene: { ...scene, lines: newLines },
    diffs_applied: applied,
    diffs_rejected: rejected,
  };
}

// ── Formatting ──

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
