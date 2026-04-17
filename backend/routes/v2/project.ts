/**
 * v2 Project Routes — All /api/v2/project/* endpoints
 */

import { Router, Request, Response } from "express";
import { Orchestrator, registerAbort, abortProject, clearAbort } from "../../services/v2/orchestrator";
import { IntakeService } from "../../services/v2/intakeService";
import { PremiseService } from "../../services/v2/premiseService";
import { BibleService } from "../../services/v2/bibleService";
import { SceneGenerationService } from "../../services/v2/sceneGenerationService";
// PolishService available but not used in default pipeline — quality baked into scene writer prompt
import { ProjectStoreV2 } from "../../storage/v2/projectStoreV2";
import { LLMClient } from "../../services/llmClient";
import { DEFAULT_V2_MODEL_CONFIG, EROTICA_V2_MODEL_CONFIG, EROTICA_FAST_V2_MODEL_CONFIG, EROTICA_HYBRID_V2_MODEL_CONFIG, FAST_V2_MODEL_CONFIG } from "../../../shared/modelConfig";
import { emitStepComplete, emitError, cleanupEmitter } from "../../services/v2/progressEmitter";
import { acquireInflight, releaseInflight, buildInflightKey } from "../../services/inflightGuard";
import { extractFingerprint, saveFingerprint } from "../../../shared/fingerprint";

async function extractAndSaveFingerprint(project: any): Promise<void> {
  if (!project.storyBible?.characters || !project.scenePlan?.scenes) return; // incomplete project
  const fp = extractFingerprint(project);
  await saveFingerprint(fp);
  console.log(`[fingerprint] Saved fingerprint for ${fp.id}: ${fp.character_names.length} chars, ${fp.scene_count} scenes`);
}
import type { ProjectId } from "../../../shared/types/project";
import { createProjectId } from "../../../shared/types/project";
import type {
  CreateProjectRequest, IntakeRequest, ReviewPremiseRequest, ReviewScenesRequest,
} from "../../../shared/types/apiV2";

const router = Router();

// ── Shared instances ────────────────────────────────────────────────

const store = new ProjectStoreV2();
const orchestrator = new Orchestrator(store);

// LLM clients cached by mode — one instance per mode, created on first use
const llmCache = new Map<string, LLMClient>();
function getLLMForMode(mode?: string): LLMClient {
  if (mode === undefined) {
    console.warn(`[v2] WARNING: getLLMForMode called with undefined mode — defaulting to "default". If this project had a non-default mode, it was lost during a state transition.`);
  }
  const key = mode ?? "default";
  if (llmCache.has(key)) return llmCache.get(key)!;

  let client: LLMClient;
  if (key === "erotica") {
    client = new LLMClient(undefined, EROTICA_V2_MODEL_CONFIG);
    console.log(`[v2] LLM client created: erotica mode (Grok-4)`);
  } else if (key === "erotica-fast") {
    client = new LLMClient(undefined, EROTICA_FAST_V2_MODEL_CONFIG);
    console.log(`[v2] LLM client created: erotica-fast mode (Grok 4.1 Fast NR)`);
  } else if (key === "erotica-hybrid") {
    client = new LLMClient(undefined, EROTICA_HYBRID_V2_MODEL_CONFIG);
    console.log(`[v2] LLM client created: erotica-hybrid mode (Grok-4 plan + Grok Fast scenes)`);
  } else if (key === "fast" || key === "haiku") {
    client = new LLMClient(undefined, FAST_V2_MODEL_CONFIG);
    console.log(`[v2] LLM client created: fast mode (Gemini Flash)`);
  } else {
    // Check legacy env var override
    const override = process.env.V2_MODEL_OVERRIDE;
    if (override) {
      console.log(`[v2] Model override active: creative roles → ${override}`);
      const v2Config: any = {
        intake: override,
        premise_writer: override,
        premise_judge: override,
        bible_writer: override,
        bible_judge: override,
        scene_planner: override,
        scene_writer: override,
        scene_judge: override,
        v2_cultural_researcher: "gemini-3-flash-preview",
        v2_summarizer: "claude-haiku-4-5-20251001",
      };
      client = new LLMClient(undefined, v2Config);
    } else {
      client = new LLMClient();
    }
  }

  llmCache.set(key, client);
  return client;
}

// Backward-compatible wrapper — used by routes that don't have a project yet
function getLLM(): LLMClient {
  return getLLMForMode(process.env.V2_MODE ?? "default");
}

// ── Project CRUD ────────────────────────────────────────────────────

router.post("/", async (req: Request, res: Response) => {
  try {
    const body = req.body as CreateProjectRequest;
    const project = await orchestrator.createProject(body.seedInput, body.culturalContext, body.mode);
    res.json({ projectId: project.projectId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:projectId", async (req: Request, res: Response) => {
  try {
    const projectId = createProjectId(req.params.projectId);
    const project = await orchestrator.getProject(projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });
    res.json({ project });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:projectId", async (req: Request, res: Response) => {
  try {
    const projectId = createProjectId(req.params.projectId);
    await orchestrator.deleteProject(projectId);
    cleanupEmitter(req.params.projectId);
    res.json({ deleted: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:projectId/retry", async (req: Request, res: Response) => {
  try {
    const projectId = createProjectId(req.params.projectId);
    const project = await orchestrator.getProject(projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (project.step !== "failed") {
      return res.status(400).json({ error: `Cannot retry: project is in step '${project.step}', not 'failed'` });
    }

    const restored = await orchestrator.retryFromFailure(projectId, project as any);
    res.json({ restored: true, step: restored.step, failedAt: (project as any).failedAt });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:projectId/abort", async (req: Request, res: Response) => {
  try {
    const projectId = createProjectId(req.params.projectId);
    const project = await orchestrator.getProject(projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });

    const aborted = abortProject(req.params.projectId);
    if (aborted) {
      cleanupEmitter(req.params.projectId);
      await orchestrator.transitionToAborted(projectId, project);
    }
    res.json({ aborted });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Step 1: Intake ──────────────────────────────────────────────────

router.post("/:projectId/intake", async (req: Request, res: Response) => {
  try {
    const projectId = createProjectId(req.params.projectId);
    const project = await orchestrator.getProject(projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (project.step !== "idea_gathering") {
      return res.status(400).json({ error: `Cannot run intake in step: ${project.step}` });
    }

    const body = req.body as IntakeRequest;
    const userInput = body.seedInput ?? body.userResponse ?? "";
    if (!userInput && !project.seedInput) {
      return res.status(400).json({ error: "Seed input or user response required" });
    }

    if (body.culturalContext) project.culturalContext = body.culturalContext;
    if (body.seedInput && !project.seedInput) project.seedInput = body.seedInput;

    const intake = new IntakeService(getLLMForMode(project.mode));
    const { response, updatedProject } = await intake.runTurn(
      project, userInput, body.assumptionResponses,
    );

    await store.save(updatedProject);
    res.json(response);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Step 2: Generate Premise ────────────────────────────────────────

router.post("/:projectId/generate-premise", async (req: Request, res: Response) => {
  const projectId = createProjectId(req.params.projectId);
  const key = buildInflightKey(req.params.projectId, "v2", "generate-premise");

  if (!acquireInflight(key)) {
    return res.status(409).json({ error: "Premise generation already in progress" });
  }

  try {
    const project = await orchestrator.getProject(projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (project.step !== "idea_gathering") {
      return res.status(400).json({ error: `Cannot generate premise in step: ${project.step}` });
    }

    // Transition to generating
    const generating = await orchestrator.transitionToPremiseGenerating(projectId, project);

    // Return 202 immediately
    res.status(202).json({ operationId: generating.operationId });

    // Generate in background
    const controller = registerAbort(req.params.projectId);
    try {
      const premise = new PremiseService(getLLMForMode(generating.mode));
      const isFastPremise = generating.mode === "fast" || generating.mode === "erotica-fast" || generating.mode === "haiku";
      const result = await premise.generate(generating, undefined, isFastPremise ? { skipJudge: true } : undefined);

      generating.traces.push(...result.traces);
      await orchestrator.transitionToPremiseReview(projectId, generating, result.premise);
      emitStepComplete(req.params.projectId, "premise_review");
    } catch (err: any) {
      if (err.name === "AbortError") {
        await orchestrator.transitionToAborted(projectId, generating);
      } else {
        await orchestrator.transitionToFailed(projectId, generating, err.message);
        emitError(req.params.projectId, err.message, "premise_generating");
      }
    } finally {
      clearAbort(req.params.projectId);
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  } finally {
    releaseInflight(key);
  }
});

router.get("/:projectId/premise", async (req: Request, res: Response) => {
  try {
    const projectId = createProjectId(req.params.projectId);
    const project = await orchestrator.getProject(projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });

    if (project.step === "premise_generating") {
      return res.json({ status: "generating" });
    }
    if (project.step === "premise_review" || project.step === "bible_generating" ||
        project.step === "scene_review" || project.step === "scene_generating" ||
        project.step === "completed") {
      return res.json({ status: "complete", premise: (project as any).premise });
    }
    if (project.step === "failed") {
      return res.json({ status: "failed", error: (project as any).error });
    }

    res.status(400).json({ error: `Premise not available in step: ${project.step}` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Step 3: Premise Review ──────────────────────────────────────────

router.post("/:projectId/review-premise", async (req: Request, res: Response) => {
  try {
    const projectId = createProjectId(req.params.projectId);
    const project = await orchestrator.getProject(projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (project.step !== "premise_review") {
      return res.status(400).json({ error: `Cannot review premise in step: ${project.step}` });
    }

    const body = req.body as ReviewPremiseRequest;

    if (body.action === "approve") {
      project.premise.state = "approved";
      project.reviewTurns.push({
        turnNumber: project.reviewRound + 1,
        action: "approve",
      });
      await store.save(project);
      return res.json({ approved: true, premise: project.premise, reviewRound: project.reviewRound });
    }

    if (body.action === "revise") {
      if (project.reviewRound >= 3) {
        // Auto-approve after max rounds
        project.premise.state = "approved";
        await store.save(project);
        return res.json({ approved: true, premise: project.premise, reviewRound: project.reviewRound });
      }

      const premise = new PremiseService(getLLMForMode(project.mode));
      const result = await premise.revise(project, body.changes ?? "", body.inlineEdits);

      project.premise = result.premise;
      project.reviewRound += 1;
      project.traces.push(...result.traces);
      project.reviewTurns.push({
        turnNumber: project.reviewRound,
        action: "revise",
        userFeedback: body.changes,
        inlineEdits: body.inlineEdits,
      });
      await store.save(project);
      return res.json({ approved: false, premise: project.premise, reviewRound: project.reviewRound });
    }

    res.status(400).json({ error: "Invalid action. Use 'approve' or 'revise'." });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Step 4: Generate Bible ──────────────────────────────────────────

router.post("/:projectId/generate-bible", async (req: Request, res: Response) => {
  const projectId = createProjectId(req.params.projectId);
  const key = buildInflightKey(req.params.projectId, "v2", "generate-bible");

  if (!acquireInflight(key)) {
    return res.status(409).json({ error: "Bible generation already in progress" });
  }

  try {
    const project = await orchestrator.getProject(projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (project.step !== "premise_review") {
      return res.status(400).json({ error: `Cannot generate bible in step: ${project.step}` });
    }
    if (project.premise.state !== "approved") {
      return res.status(400).json({ error: "Approve the premise first" });
    }

    const generating = await orchestrator.transitionToBibleGenerating(projectId, project);
    res.status(202).json({ operationId: generating.operationId });

    const controller = registerAbort(req.params.projectId);
    try {
      const bible = new BibleService(getLLMForMode(generating.mode));
      const isFastBible = generating.mode === "fast" || generating.mode === "erotica-fast" || generating.mode === "haiku";
      const result = await bible.generate(
        generating,
        undefined,
        async (updated) => { await store.save(updated); },
        isFastBible ? { skipJudge: true, skipStepBack: true } : undefined,
      );

      generating.traces.push(...result.traces);
      await orchestrator.transitionToSceneReview(
        projectId, generating, result.storyBible, result.scenePlan,
      );
      emitStepComplete(req.params.projectId, "scene_review");
    } catch (err: any) {
      const errDetail = err.body ?? err.message ?? String(err);
      console.error("[v2] Bible generation failed:", errDetail);
      if (err.name === "AbortError") {
        await orchestrator.transitionToAborted(projectId, generating);
      } else {
        await orchestrator.transitionToFailed(projectId, generating, errDetail);
        emitError(req.params.projectId, errDetail, "bible_generating");
      }
    } finally {
      clearAbort(req.params.projectId);
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  } finally {
    releaseInflight(key);
  }
});

router.get("/:projectId/bible", async (req: Request, res: Response) => {
  try {
    const projectId = createProjectId(req.params.projectId);
    const project = await orchestrator.getProject(projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });

    if (project.step === "bible_generating") {
      return res.json({ status: "generating", progress: (project as any).checkpoint });
    }
    if (project.step === "scene_review" || project.step === "scene_generating" || project.step === "completed") {
      return res.json({
        status: "complete",
        storyBible: (project as any).storyBible,
        scenePlan: (project as any).scenePlan,
      });
    }
    if (project.step === "failed") {
      return res.json({ status: "failed", error: (project as any).error });
    }

    res.status(400).json({ error: `Bible not available in step: ${project.step}` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Step 5: Scene Plan Review ───────────────────────────────────────

router.post("/:projectId/review-scenes", async (req: Request, res: Response) => {
  try {
    const projectId = createProjectId(req.params.projectId);
    const project = await orchestrator.getProject(projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (project.step !== "scene_review") {
      return res.status(400).json({ error: `Cannot review scenes in step: ${project.step}` });
    }

    const body = req.body as ReviewScenesRequest;

    if (body.action === "approve" || body.action === "skip") {
      project.scenePlan.state = "approved";
      project.reviewTurns.push({
        turnNumber: project.reviewTurns.length + 1,
        action: body.action,
      });
      await store.save(project);
      return res.json({ approved: true, scenePlan: project.scenePlan });
    }

    if (body.action === "revise" && body.changes) {
      const EDITABLE_FIELDS = new Set(["title", "purpose", "setting", "pov_character"]);
      for (const edit of body.changes) {
        if (edit.action === "remove") {
          project.scenePlan.scenes = project.scenePlan.scenes.filter(
            s => s.scene_id !== edit.scene_id,
          );
        } else if (edit.action === "modify" && edit.changes) {
          const scene = project.scenePlan.scenes.find(s => s.scene_id === edit.scene_id);
          if (scene) {
            // Only allow safe field overwrites
            for (const [key, value] of Object.entries(edit.changes)) {
              if (EDITABLE_FIELDS.has(key) && typeof value === "string") {
                (scene as any)[key] = value;
              }
            }
          }
        } else if (edit.action === "reorder") {
          return res.status(400).json({ error: "Reorder is not yet supported" });
        }
      }
      project.scenePlan.total_scenes = project.scenePlan.scenes.length;
      project.reviewTurns.push({
        turnNumber: project.reviewTurns.length + 1,
        action: "revise",
        userFeedback: body.feedback,
      });
      await store.save(project);
      return res.json({ approved: false, scenePlan: project.scenePlan });
    }

    res.status(400).json({ error: "Invalid action. Use 'approve', 'revise', or 'skip'." });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Step 6: Generate Scenes ─────────────────────────────────────────

router.post("/:projectId/generate-scenes", async (req: Request, res: Response) => {
  const projectId = createProjectId(req.params.projectId);
  const key = buildInflightKey(req.params.projectId, "v2", "generate-scenes");

  if (!acquireInflight(key)) {
    return res.status(409).json({ error: "Scene generation already in progress" });
  }

  try {
    const project = await orchestrator.getProject(projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (project.step !== "scene_review") {
      return res.status(400).json({ error: `Cannot generate scenes in step: ${project.step}` });
    }

    const generating = await orchestrator.transitionToSceneGenerating(projectId, project);
    res.status(202).json({ operationId: generating.operationId });

    const controller = registerAbort(req.params.projectId);
    try {
      const sceneGen = new SceneGenerationService(getLLMForMode(generating.mode));
      // Fast/erotica-fast/erotica-hybrid modes: skip judge & tension tracking for speed.
      // batchSize=1 is required: the scene writer uses a previousSceneDigest computed
      // once per batch, so batchSize>1 would let parallel scenes miss each other's content.
      const isFastMode = generating.mode === "fast" || generating.mode === "erotica-fast" || generating.mode === "erotica-hybrid" || generating.mode === "haiku";
      const result = await sceneGen.generate(
        generating,
        async (updated) => { await store.save(updated); },
        isFastMode ? { batchSize: 1, skipJudge: true, skipTension: true } : undefined,
      );
      generating.traces.push(...result.traces);

      await orchestrator.transitionToCompleted(projectId, generating, result.scenes);
      emitStepComplete(req.params.projectId, "completed");
      // Give any in-flight SSE clients a moment to receive the final event,
      // then free the emitter so the Map doesn't grow unbounded over the server's lifetime.
      setTimeout(() => cleanupEmitter(req.params.projectId), 30_000);
    } catch (err: any) {
      if (err.name === "AbortError") {
        await orchestrator.transitionToAborted(projectId, generating);
      } else {
        await orchestrator.transitionToFailed(projectId, generating, err.message);
        emitError(req.params.projectId, err.message, "scene_generating");
      }
    } finally {
      clearAbort(req.params.projectId);
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  } finally {
    releaseInflight(key);
  }
});

router.get("/:projectId/scenes", async (req: Request, res: Response) => {
  try {
    const projectId = createProjectId(req.params.projectId);
    const project = await orchestrator.getProject(projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });

    if (project.step === "scene_generating") {
      return res.json({
        status: "generating",
        scenes: (project as any).generatedScenes ?? [],
        progress: (project as any).checkpoint,
      });
    }
    if (project.step === "completed") {
      return res.json({ status: "complete", scenes: (project as any).scenes });
    }
    if (project.step === "failed") {
      return res.json({ status: "failed", error: (project as any).error });
    }

    res.status(400).json({ error: `Scenes not available in step: ${project.step}` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Export/Traces ───────────────────────────────────────────────────

router.get("/:projectId/export", async (req: Request, res: Response) => {
  try {
    const projectId = createProjectId(req.params.projectId);
    const project = await orchestrator.getProject(projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });

    // Auto-fingerprint on export (fire-and-forget, don't block response)
    extractAndSaveFingerprint(project).catch(err =>
      console.warn(`[fingerprint] Failed to save: ${err.message}`)
    );

    res.json(project);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:projectId/traces", async (req: Request, res: Response) => {
  try {
    const projectId = createProjectId(req.params.projectId);
    const project = await orchestrator.getProject(projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });
    res.json({ traces: project.traces });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
