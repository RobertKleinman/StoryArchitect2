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
  PostproductionConfig,
} from "./types";
import { callLLM } from "./llm";

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
  config?: PostproductionConfig,
): Promise<{ scenes: IdentifiedScene[]; results: SceneEditResult[] }> {
  const llm = config?.llm ?? {
    provider: "anthropic" as const,
    baseUrl: "https://api.anthropic.com/v1",
    apiKey: ANTHROPIC_API_KEY ?? "",
    editorialModel: MODEL,
    verifyModel: "", emotionModel: "", dualModel: false, secondary: null,
    systemPromptSuffix: "",
  };
  if (!llm.apiKey) throw new Error("API key required for editor");

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
    let result = await attemptFix(scene, sceneFindings, sceneStructural, ledger, seed, false, llm);

    if (result.status === "unfixed" && result.diffs_rejected > 0) {
      // Retry with stricter prompt
      result = await attemptFix(scene, sceneFindings, sceneStructural, ledger, seed, true, llm);
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
  llm: PostproductionConfig["llm"],
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
    const response = await callLLM(
      llm.provider, llm.baseUrl, llm.apiKey,
      systemPrompt + llm.systemPromptSuffix, userPrompt, llm.editorialModel, 0.5, 8000,
    );
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
  // Counter for unique insertion IDs so multiple inserts on the same line don't collide
  let insCounter = 0;

  for (const line of scene.lines) {
    // Collect ALL diffs targeting this line (multiple edits to the same line are allowed)
    const lineDiffs = diffs.filter(d => d.line_id === line._lid);

    // Handle delete (first delete wins; replace/insert on deleted line is a no-op)
    const deleteDiff = lineDiffs.find(d => d.action === "delete");
    if (deleteDiff) {
      if (!flaggedLineIds.has(line._lid)) {
        rejected++;
        newLines.push(line); // Keep unflagged line
      } else {
        applied++;
      }
      continue;
    }

    // Handle replace (at most one replace per line — extra replaces rejected)
    const replaces = lineDiffs.filter(d => d.action === "replace");
    if (replaces.length > 0) {
      const replaceDiff = replaces[0];
      // Count any duplicate replaces as rejected
      rejected += replaces.length - 1;

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
      } else {
        newLines.push(line);
      }
    } else {
      newLines.push(line);
    }

    // Handle insert_after (multiple allowed, applied in order they appear in diffs)
    const inserts = lineDiffs.filter(d => d.action === "insert_after");
    for (const insertDiff of inserts) {
      if (!insertDiff.new_line) continue;
      // Same flagged-line guard as replace/delete — don't let inserts add material after unflagged context
      if (!flaggedLineIds.has(line._lid)) {
        rejected++;
        continue;
      }
      // Stale-reference check if expected_old_text was provided for the anchor
      if (insertDiff.expected_old_text && insertDiff.expected_old_text !== line.text) {
        rejected++;
        continue;
      }
      newLines.push({
        ...insertDiff.new_line,
        _lid: `${line._lid}_ins_${insCounter++}`,
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

