/**
 * EROTICA SCENE REWRITER (Pass 3C)
 * ====================================
 * Developmental editing — rewrites entire scenes based on editorial notes.
 * Like a real second draft: the diagnostic marks up the manuscript,
 * the rewriter produces a new version fixing the noted issues.
 *
 * Content preservation is the top constraint.
 */

import type {
  IdentifiedScene,
  IdentifiedLine,
  SceneEditResult,
  PostproductionConfig,
  PipelineOutput,
  VNLine,
} from "../types";
import { callLLM } from "../llm";
import { runEroticaDiagnostic } from "./diagnostic";
import { validateSceneRewrite } from "./content-validator";
import { buildRewriteSystemPrompt, buildRewriteUserPrompt } from "./prompts";
import type { EroticaDiagnosticReport } from "./types";

function log(phase: string, msg: string) {
  const time = new Date().toISOString().slice(11, 19);
  console.log(`[${time}] [${phase.padEnd(10)}] ${msg}`);
}

/**
 * Run erotica scene rewrites on all scenes that have diagnostic issues.
 */
export async function runEroticaDialogueRewrite(
  scenes: IdentifiedScene[],
  input: PipelineOutput,
  config: PostproductionConfig,
  diagnosticReport?: EroticaDiagnosticReport,
): Promise<{ scenes: IdentifiedScene[]; results: SceneEditResult[] }> {
  const report = diagnosticReport ?? runEroticaDiagnostic(scenes, input.storyBible, "pipeline");

  // Only rewrite scenes that have flagged issues
  const scenesWithIssues = report.per_scene.filter(s => s.flagged_count > 0);

  if (scenesWithIssues.length === 0) {
    log("PASS 3C", "No scenes need rewriting — skipping");
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

  log("PASS 3C", `${scenesWithIssues.length}/${scenes.length} scenes flagged for rewrite`);

  const systemPrompt = buildRewriteSystemPrompt() + "\n\n" + config.llm.systemPromptSuffix;
  const outputScenes = [...scenes];
  const results: SceneEditResult[] = [];

  for (let i = 0; i < outputScenes.length; i++) {
    const scene = outputScenes[i];
    const sceneDiag = report.per_scene.find(s => s.scene_id === scene.scene_id);

    if (!sceneDiag || sceneDiag.flagged_count === 0) {
      results.push({
        scene_id: scene.scene_id,
        status: "unchanged",
        diffs_applied: 0,
        diffs_rejected: 0,
        issues_addressed: [],
      });
      continue;
    }

    log("PASS 3C", `Rewriting "${scene.title}" (${sceneDiag.flagged_count} issues)`);

    const userPrompt = buildRewriteUserPrompt(scene, input.storyBible, sceneDiag, report);

    // Call LLM for full scene rewrite
    let response: string;
    try {
      response = await callLLM(
        config.llm.provider,
        config.llm.baseUrl,
        config.llm.apiKey,
        systemPrompt,
        userPrompt,
        config.llm.editorialModel,
        0.6,
        16000,
      );
    } catch (err: any) {
      log("PASS 3C", `  LLM error: ${err.message}`);
      results.push({
        scene_id: scene.scene_id,
        status: "unfixed",
        diffs_applied: 0,
        diffs_rejected: 0,
        issues_addressed: [],
      });
      continue;
    }

    // Parse rewritten scene
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      log("PASS 3C", "  No JSON in response");
      results.push({
        scene_id: scene.scene_id,
        status: "unfixed",
        diffs_applied: 0,
        diffs_rejected: 0,
        issues_addressed: [],
      });
      continue;
    }

    let rewrittenLines: VNLine[];
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      rewrittenLines = parsed.lines ?? [];
    } catch {
      log("PASS 3C", "  JSON parse error");
      results.push({
        scene_id: scene.scene_id,
        status: "unfixed",
        diffs_applied: 0,
        diffs_rejected: 0,
        issues_addressed: [],
      });
      continue;
    }

    if (rewrittenLines.length === 0) {
      log("PASS 3C", "  Empty rewrite — skipping");
      results.push({
        scene_id: scene.scene_id,
        status: "unfixed",
        diffs_applied: 0,
        diffs_rejected: 0,
        issues_addressed: [],
      });
      continue;
    }

    // Validate content preservation
    const validation = validateSceneRewrite(scene.lines, rewrittenLines);
    if (validation.reasons.length > 0) {
      for (const reason of validation.reasons) {
        log("PASS 3C", `  Validation: ${reason}`);
      }
    }

    if (!validation.valid) {
      log("PASS 3C", "  Rewrite rejected — content preservation failed");
      results.push({
        scene_id: scene.scene_id,
        status: "unfixed",
        diffs_applied: 0,
        diffs_rejected: 1,
        issues_addressed: [],
      });
      continue;
    }

    // Assign line IDs to rewritten lines
    const identifiedLines: IdentifiedLine[] = rewrittenLines.map((line, j) => ({
      speaker: line.speaker,
      text: line.text,
      emotion: line.emotion ?? null,
      stage_direction: line.stage_direction ?? null,
      delivery: line.delivery ?? null,
      _lid: `${scene.scene_id}_L${String(j).padStart(3, "0")}`,
    }));

    // Build the rewritten scene
    const rewrittenScene: IdentifiedScene = {
      ...scene,
      lines: identifiedLines,
    };

    outputScenes[i] = rewrittenScene;

    // Summarize what was addressed
    const addressed: string[] = [];
    if (sceneDiag.dom_command_count > 0) addressed.push(`dom variety (${sceneDiag.dom_command_count} issues)`);
    if (sceneDiag.nickname_count > 0) addressed.push(`nickname overuse (${sceneDiag.nickname_count} issues)`);
    if (sceneDiag.internal_template_count > 0) addressed.push(`internal template (${sceneDiag.internal_template_count} issues)`);

    const origWords = scene.lines.reduce((s, l) => s + l.text.split(/\s+/).length, 0);
    const newWords = identifiedLines.reduce((s, l) => s + l.text.split(/\s+/).length, 0);
    log("PASS 3C", `  ✓ Rewritten (${origWords}→${newWords} words, ${scene.lines.length}→${identifiedLines.length} lines)`);

    results.push({
      scene_id: scene.scene_id,
      status: "fixed",
      diffs_applied: 1, // 1 = one scene rewrite
      diffs_rejected: 0,
      issues_addressed: addressed,
    });
  }

  const totalFixed = results.filter(r => r.status === "fixed").length;
  log("PASS 3C", `Done: ${totalFixed}/${scenes.length} scenes rewritten`);

  return { scenes: outputScenes, results };
}
