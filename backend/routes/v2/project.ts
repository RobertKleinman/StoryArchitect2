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
import { emitStepComplete, emitError, cleanupEmitter } from "../../services/v2/progressEmitter";
import { acquireInflight, releaseInflight, buildInflightKey } from "../../services/inflightGuard";
import type { ProjectId } from "../../../shared/types/project";
import { createProjectId } from "../../../shared/types/project";
import type {
  CreateProjectRequest, IntakeRequest, ReviewPremiseRequest, ReviewScenesRequest,
} from "../../../shared/types/apiV2";

const router = Router();

// ── Shared instances ────────────────────────────────────────────────

const store = new ProjectStoreV2();
const orchestrator = new Orchestrator(store);

// LLMClient is a singleton — reuse the same instance
let llm: LLMClient;
function getLLM(): LLMClient {
  if (!llm) {
    const override = process.env.V2_MODEL_OVERRIDE;
    if (override) {
      console.log(`[v2] Model override active: all roles → ${override}`);
      const v2Config: any = {};
      const roles = ["intake", "premise_writer", "premise_judge", "bible_writer",
        "bible_judge", "scene_planner", "scene_writer", "scene_judge",
        "v2_cultural_researcher", "v2_summarizer"];
      for (const role of roles) v2Config[role] = override;
      llm = new LLMClient(undefined, v2Config);
    } else {
      llm = new LLMClient();
    }
  }
  return llm;
}

// ── Project CRUD ────────────────────────────────────────────────────

router.post("/", async (req: Request, res: Response) => {
  try {
    const body = req.body as CreateProjectRequest;
    const project = await orchestrator.createProject(body.seedInput, body.culturalContext);
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

    const intake = new IntakeService(getLLM());
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
      const premise = new PremiseService(getLLM());
      const result = await premise.generate(generating);

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

      const premise = new PremiseService(getLLM());
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
      const bible = new BibleService(getLLM());
      const result = await bible.generate(
        generating,
        undefined,
        async (updated) => { await store.save(updated); },
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
      const sceneGen = new SceneGenerationService(getLLM());
      const result = await sceneGen.generate(
        generating,
        async (updated) => { await store.save(updated); },
      );
      generating.traces.push(...result.traces);

      await orchestrator.transitionToCompleted(projectId, generating, result.scenes);
      emitStepComplete(req.params.projectId, "completed");
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
