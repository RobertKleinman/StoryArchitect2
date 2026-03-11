import { Router } from "express";
import fs from "fs/promises";
import nodePath from "path";
import { sceneFeatureFlagGuard } from "../middleware/sceneFeatureFlagGuard";
import { sceneService, sceneStore } from "../services/runtime";
import { SceneServiceError } from "../services/sceneService";

export const sceneRoutes = Router();

sceneRoutes.use(sceneFeatureFlagGuard);

function getModelOverride(header: string | string[] | undefined): string | undefined {
  if (Array.isArray(header)) return header[0];
  return header;
}

function handleError(res: any, err: unknown) {
  console.error("SCENE ROUTE ERROR:", err);
  if (err instanceof SceneServiceError) {
    const status = err.code === "NOT_FOUND" ? 404
      : err.code === "INVALID_INPUT" ? 400
      : err.code === "LLM_PARSE_ERROR" ? 422
      : 502;
    return res.status(status).json({ error: true, code: err.code, message: err.message });
  }
  const msg = err instanceof Error ? err.message : "Unexpected server error";
  return res.status(500).json({ error: true, code: "LLM_CALL_FAILED", message: msg });
}

// ─── Phase 0: Planning ───

/** POST /api/scene/plan — initial planning: cluster beats into scenes + first plan clarifier turn */
sceneRoutes.post("/plan", async (req, res) => {
  const modelOverride = getModelOverride(req.header("X-Model-Override"));
  const { projectId, plotProjectId, promptOverrides } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }
  if (!plotProjectId || typeof plotProjectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "plotProjectId is required" });
  }

  try {
    const result = await sceneService.initPlan(projectId, plotProjectId, modelOverride, promptOverrides);
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

/** POST /api/scene/plan-clarify — refine the plan with user feedback */
sceneRoutes.post("/plan-clarify", async (req, res) => {
  const modelOverride = getModelOverride(req.header("X-Model-Override"));
  const { projectId, userSelection, assumptionResponses, promptOverrides } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }

  try {
    const result = await sceneService.clarifyPlan(
      projectId, userSelection, assumptionResponses, modelOverride, promptOverrides
    );
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

/** POST /api/scene/confirm-plan — user confirms the scene plan, transition to writing */
sceneRoutes.post("/confirm-plan", async (req, res) => {
  const { projectId } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }

  try {
    const result = await sceneService.confirmPlan(projectId);
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

// ─── Phase 1: Per-Scene Clarification ───

/** POST /api/scene/clarify — per-scene steering (or auto-pass) */
sceneRoutes.post("/clarify", async (req, res) => {
  const modelOverride = getModelOverride(req.header("X-Model-Override"));
  const { projectId, userSelection, assumptionResponses, promptOverrides } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }

  try {
    const result = await sceneService.clarifyScene(
      projectId, userSelection, assumptionResponses, modelOverride, promptOverrides
    );
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

// ─── Phase 2: Scene Building ───

/** POST /api/scene/build — build the current scene (builder + minor judge) */
sceneRoutes.post("/build", async (req, res) => {
  const modelOverride = getModelOverride(req.header("X-Model-Override"));
  const { projectId, promptOverrides } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }

  try {
    // Get session state before build to capture index info
    const sessionBefore = await sceneService.getSession(projectId);
    const sceneIndex = sessionBefore?.currentSceneIndex ?? 0;
    const totalScenes = sessionBefore?.scenePlan?.length ?? 0;

    const builtScene = await sceneService.buildScene(projectId, modelOverride, promptOverrides);
    return res.json({
      scene: builtScene,
      sceneIndex,
      totalScenes,
    });
  } catch (err) {
    return handleError(res, err);
  }
});

// ─── Phase 4: Final Judge ───

/** POST /api/scene/final-judge — intensive full-work assessment */
sceneRoutes.post("/final-judge", async (req, res) => {
  const modelOverride = getModelOverride(req.header("X-Model-Override"));
  const { projectId, promptOverrides } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }

  try {
    const judge = await sceneService.runFinalJudge(projectId, modelOverride, promptOverrides);
    return res.json({ judge });
  } catch (err) {
    return handleError(res, err);
  }
});

// ─── Complete ───

/** POST /api/scene/complete — lock and package ScenePack */
sceneRoutes.post("/complete", async (req, res) => {
  const { projectId } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }

  try {
    const result = await sceneService.complete(projectId);
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

// ─── Debug endpoints (MUST be before /:projectId) ───

/** GET /api/scene/debug/scenes/:projectId — testing sidebar: raw scene output */
sceneRoutes.get("/debug/scenes/:projectId", async (req, res) => {
  try {
    const session = await sceneService.getSession(req.params.projectId);
    if (!session) {
      return res.status(404).json({ error: true, code: "NOT_FOUND", message: "Scene session not found" });
    }

    const readableScenes = session.builtScenes.map(s => s.readable);

    return res.json({
      builtScenes: session.builtScenes,
      readableScenes,
      scenePlan: session.scenePlan ?? null,
      narrativePreview: session.narrativePreview ?? null,
      rhythmSnapshot: session.rhythmSnapshot ?? null,
    });
  } catch (err) {
    return handleError(res, err);
  }
});

/** GET /api/scene/debug/psychology/:projectId — psychology ledger debug */
sceneRoutes.get("/debug/psychology/:projectId", async (req, res) => {
  try {
    const session = await sceneService.getSession(req.params.projectId);
    if (!session?.psychologyLedger) {
      return res.json({ psychologyLedger: null });
    }
    return res.json({ psychologyLedger: session.psychologyLedger });
  } catch (err) {
    return handleError(res, err);
  }
});

/** GET /api/scene/export-session/:projectId */
sceneRoutes.get("/export-session/:projectId", async (req, res) => {
  try {
    const exportData = await sceneStore.getExport(req.params.projectId);
    if (!exportData) {
      const session = await sceneService.getSession(req.params.projectId);
      if (!session) {
        return res.status(404).json({ error: true, code: "NOT_FOUND", message: "Scene session not found" });
      }
      return res.status(400).json({
        error: true,
        code: "INVALID_INPUT",
        message: `Scene session exists but is not complete (status: ${session.status}). Complete the scene module first.`,
      });
    }
    return res.json(exportData);
  } catch (err) {
    return handleError(res, err);
  }
});

/** List all available scene sessions */
sceneRoutes.get("/list-sessions", async (_req, res) => {
  try {
    const dataDir = "./data/scenes";
    const exportDir = nodePath.join(dataDir, "exports");

    let sessionFiles: string[] = [];
    try {
      const allFiles: string[] = await fs.readdir(dataDir);
      sessionFiles = allFiles.filter((f: string) => f.endsWith(".json"));
    } catch { /* empty dir */ }

    const sessions: Array<{
      projectId: string;
      plotProjectId: string;
      status: string;
      planningTurnCount: number;
      writingTurnCount: number;
      builtSceneCount: number;
      totalScenes: number;
      hasExport: boolean;
    }> = [];

    for (const file of sessionFiles) {
      try {
        const raw = await fs.readFile(nodePath.join(dataDir, file), "utf-8");
        const session = JSON.parse(raw);

        let hasExport = false;
        try {
          await fs.readFile(nodePath.join(exportDir, file), "utf-8");
          hasExport = true;
        } catch {}

        sessions.push({
          projectId: session.projectId,
          plotProjectId: session.plotProjectId ?? "",
          status: session.status,
          planningTurnCount: session.planningTurns?.length ?? 0,
          writingTurnCount: session.writingTurns?.length ?? 0,
          builtSceneCount: session.builtScenes?.length ?? 0,
          totalScenes: session.scenePlan?.length ?? 0,
          hasExport,
        });
      } catch { /* skip corrupt files */ }
    }

    return res.json({ sessions });
  } catch (err) {
    return handleError(res, err);
  }
});

// ─── Session endpoints (/:projectId MUST be last) ───

sceneRoutes.get("/:projectId", async (req, res) => {
  try {
    const session = await sceneService.getSession(req.params.projectId);
    if (!session) {
      return res.status(404).json({ error: true, code: "NOT_FOUND", message: "Scene session not found" });
    }
    return res.json(session);
  } catch (err) {
    return handleError(res, err);
  }
});

sceneRoutes.delete("/:projectId", async (req, res) => {
  try {
    await sceneService.resetSession(req.params.projectId);
    return res.json({ deleted: true });
  } catch (err) {
    return handleError(res, err);
  }
});
