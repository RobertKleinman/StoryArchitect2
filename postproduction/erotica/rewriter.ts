/**
 * EROTICA DIALOGUE REWRITER (Pass 3C)
 * ======================================
 * Targeted LLM rewrites for three fixable dialogue issues:
 * 1. Dom command monotony
 * 2. Nickname/address overuse
 * 3. Internal template uniformity
 *
 * Content preservation is the top constraint — previous postprod
 * halved word counts and stripped fetish content.
 */

import type {
  IdentifiedScene,
  IdentifiedLine,
  LineDiff,
  SceneEditResult,
  PostproductionConfig,
  PipelineOutput,
} from "../types";
import { callLLM } from "../llm";
import { runEroticaDiagnostic } from "./diagnostic";
import { validateContentPreservation } from "./content-validator";
import {
  buildDomCommandPrompt,
  buildNicknamePrompt,
  buildInternalTemplatePrompt,
} from "./prompts";
import type { EroticaDiagnosticReport, FlaggedLine, FlaggedIssueType } from "./types";

function log(phase: string, msg: string) {
  const time = new Date().toISOString().slice(11, 19);
  console.log(`[${time}] [${phase.padEnd(10)}] ${msg}`);
}

/**
 * Run erotica dialogue rewrite on all scenes.
 * If a diagnostic report is provided, uses it; otherwise runs the diagnostic first.
 */
export async function runEroticaDialogueRewrite(
  scenes: IdentifiedScene[],
  input: PipelineOutput,
  config: PostproductionConfig,
  diagnosticReport?: EroticaDiagnosticReport,
): Promise<{ scenes: IdentifiedScene[]; results: SceneEditResult[] }> {
  // Run diagnostic if not provided
  const report = diagnosticReport ?? runEroticaDiagnostic(scenes, input.storyBible, "pipeline");
  const flagged = report.flagged_lines;

  if (flagged.length === 0) {
    log("PASS 3C", "No fixable issues found — skipping rewrite");
    return {
      scenes,
      results: scenes.map(s => ({
        scene_id: s.scene_id,
        status: "unchanged" as const,
        diffs_applied: 0,
        diffs_rejected: 0,
        issues_addressed: [],
      })),
    };
  }

  log("PASS 3C", `${flagged.length} lines flagged across ${report.per_scene.filter(s => s.flagged_count > 0).length} scenes`);

  // Group flagged lines by scene
  const flaggedByScene = new Map<string, FlaggedLine[]>();
  for (const f of flagged) {
    const list = flaggedByScene.get(f.scene_id) ?? [];
    list.push(f);
    flaggedByScene.set(f.scene_id, list);
  }

  // Process each scene
  const outputScenes = [...scenes];
  const results: SceneEditResult[] = [];

  for (let i = 0; i < outputScenes.length; i++) {
    const scene = outputScenes[i];
    const sceneFlags = flaggedByScene.get(scene.scene_id);

    if (!sceneFlags || sceneFlags.length === 0) {
      results.push({
        scene_id: scene.scene_id,
        status: "unchanged",
        diffs_applied: 0,
        diffs_rejected: 0,
        issues_addressed: [],
      });
      continue;
    }

    log("PASS 3C", `Processing "${scene.title}" — ${sceneFlags.length} flagged lines`);

    // Process by issue type in order: internal → nickname → dom (per plan)
    let currentScene = scene;
    let totalApplied = 0;
    let totalRejected = 0;
    const addressed: string[] = [];

    for (const issueType of ["internal_template", "nickname_overuse", "dom_command"] as FlaggedIssueType[]) {
      const typeFlags = sceneFlags.filter(f => f.issue_type === issueType);
      if (typeFlags.length === 0) continue;

      const result = await rewriteIssueType(currentScene, typeFlags, issueType, config);
      if (result.fixedScene) {
        currentScene = result.fixedScene;
      }
      totalApplied += result.diffs_applied;
      totalRejected += result.diffs_rejected;
      if (result.diffs_applied > 0) {
        addressed.push(`${issueType}: ${result.diffs_applied} lines rewritten`);
      }
    }

    if (totalApplied > 0) {
      outputScenes[i] = currentScene;
    }

    results.push({
      scene_id: scene.scene_id,
      status: totalApplied > 0 ? "fixed" : totalRejected > 0 ? "unfixed" : "unchanged",
      diffs_applied: totalApplied,
      diffs_rejected: totalRejected,
      issues_addressed: addressed,
    });

    if (totalApplied > 0 || totalRejected > 0) {
      log("PASS 3C", `  → ${totalApplied} applied, ${totalRejected} rejected`);
    }
  }

  const totalFixed = results.filter(r => r.status === "fixed").length;
  log("PASS 3C", `Done: ${totalFixed} scenes modified`);

  return { scenes: outputScenes, results };
}

/**
 * Rewrite a specific issue type in a scene.
 */
async function rewriteIssueType(
  scene: IdentifiedScene,
  flagged: FlaggedLine[],
  issueType: FlaggedIssueType,
  config: PostproductionConfig,
): Promise<{ fixedScene?: IdentifiedScene; diffs_applied: number; diffs_rejected: number }> {
  // Build the appropriate prompt
  let prompt: { system: string; user: string };
  switch (issueType) {
    case "dom_command":
      prompt = buildDomCommandPrompt(scene, flagged);
      break;
    case "nickname_overuse":
      prompt = buildNicknamePrompt(scene, flagged);
      break;
    case "internal_template":
      prompt = buildInternalTemplatePrompt(scene, flagged);
      break;
  }

  // Append content preservation suffix
  const system = prompt.system + "\n\n" + config.llm.systemPromptSuffix;

  // Call LLM
  let response: string;
  try {
    response = await callLLM(
      config.llm.provider,
      config.llm.baseUrl,
      config.llm.apiKey,
      system,
      prompt.user,
      config.llm.editorialModel,
      0.5,
      8000,
    );
  } catch (err: any) {
    log("PASS 3C", `  LLM error for ${issueType}: ${err.message}`);
    return { diffs_applied: 0, diffs_rejected: 0 };
  }

  // Parse JSON response
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    log("PASS 3C", `  No JSON in ${issueType} response`);
    return { diffs_applied: 0, diffs_rejected: 0 };
  }

  let diffs: LineDiff[];
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    diffs = parsed.diffs ?? [];
  } catch {
    log("PASS 3C", `  JSON parse error for ${issueType}`);
    return { diffs_applied: 0, diffs_rejected: 0 };
  }

  if (diffs.length === 0) return { diffs_applied: 0, diffs_rejected: 0 };

  // Content preservation validation
  const validation = validateContentPreservation(scene.lines, diffs);
  if (validation.reasons.length > 0) {
    for (const reason of validation.reasons) {
      log("PASS 3C", `  Validation: ${reason}`);
    }
  }

  // Filter out rejected diffs
  const rejectedSet = new Set(validation.rejected_diffs);
  const validDiffs = diffs.filter(d => !rejectedSet.has(d.line_id));
  const rejectedCount = diffs.length - validDiffs.length;

  if (validDiffs.length === 0) {
    return { diffs_applied: 0, diffs_rejected: rejectedCount };
  }

  // Apply valid diffs
  const fixedScene = { ...scene, lines: [...scene.lines] };
  let applied = 0;

  for (const diff of validDiffs) {
    const lineIdx = fixedScene.lines.findIndex(l => l._lid === diff.line_id);
    if (lineIdx === -1) {
      continue;
    }

    if (diff.action === "replace" && diff.new_line) {
      fixedScene.lines[lineIdx] = {
        ...fixedScene.lines[lineIdx],
        ...diff.new_line,
        _lid: fixedScene.lines[lineIdx]._lid,
      } as IdentifiedLine;
      applied++;
    } else if (diff.action === "delete") {
      fixedScene.lines.splice(lineIdx, 1);
      applied++;
    } else if (diff.action === "insert_after" && diff.new_line) {
      const newLine = {
        ...diff.new_line,
        _lid: `${fixedScene.lines[lineIdx]._lid}_ins`,
      } as IdentifiedLine;
      fixedScene.lines.splice(lineIdx + 1, 0, newLine);
      applied++;
    }
  }

  return {
    fixedScene: applied > 0 ? fixedScene : undefined,
    diffs_applied: applied,
    diffs_rejected: rejectedCount,
  };
}
