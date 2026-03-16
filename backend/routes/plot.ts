import { Router } from "express";
import { plotFeatureFlagGuard } from "../middleware/plotFeatureFlagGuard";
import { plotService, culturalStore } from "../services/runtime";
import { handleRouteError, getModelOverride, debugGuard } from "./routeUtils";

export const plotRoutes = Router();

plotRoutes.use(plotFeatureFlagGuard);

const handleError = (res: any, err: unknown) => handleRouteError(res, err, "PLOT");

// ─── Preview Prompt ───

plotRoutes.post("/preview-prompt", async (req, res) => {
  const { projectId, stage } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }
  if (!stage || !["clarifier", "builder", "judge", "polish", "summary"].includes(stage)) {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "stage must be clarifier|builder|judge|polish|summary" });
  }

  try {
    const result = await plotService.previewPrompt(projectId, stage);
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

// ─── Clarify ───

plotRoutes.post("/clarify", async (req, res) => {
  const modelOverride = getModelOverride(req.header("X-Model-Override"));
  const {
    projectId,
    worldProjectId,
    characterImageProjectId,
    characterProjectId,
    hookProjectId,
    userSelection,
    promptOverrides,
    assumptionResponses,
    plotSeed,
  } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }
  if (!worldProjectId || typeof worldProjectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "worldProjectId is required" });
  }
  if (characterImageProjectId !== undefined && typeof characterImageProjectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "characterImageProjectId must be a string if provided" });
  }
  if (!characterProjectId || typeof characterProjectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "characterProjectId is required" });
  }
  if (!hookProjectId || typeof hookProjectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "hookProjectId is required" });
  }

  try {
    const result = await plotService.runClarifierTurn(
      projectId,
      worldProjectId,
      characterImageProjectId,
      characterProjectId,
      hookProjectId,
      userSelection,
      modelOverride,
      promptOverrides,
      assumptionResponses,
      plotSeed,
    );
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

// ─── Generate (builder + judge) ───

plotRoutes.post("/generate", async (req, res) => {
  const modelOverride = getModelOverride(req.header("X-Model-Override"));
  const { projectId, promptOverrides } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }

  try {
    const result = await plotService.runGenerate(projectId, modelOverride, promptOverrides);
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

// ─── Reroll ───

plotRoutes.post("/reroll", async (req, res) => {
  const modelOverride = getModelOverride(req.header("X-Model-Override"));
  const { projectId, promptOverrides, constraintOverrides } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }

  try {
    const result = await plotService.reroll(projectId, modelOverride, promptOverrides, constraintOverrides);
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

// ─── Lock ───

plotRoutes.post("/lock", async (req, res) => {
  const modelOverride = getModelOverride(req.header("X-Model-Override"));
  const { projectId } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }

  try {
    const result = await plotService.lockPlot(projectId, modelOverride);
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

// ─── Export Session ───

plotRoutes.get("/export-session/:projectId", async (req, res) => {
  try {
    const session = await plotService.getSession(req.params.projectId);
    if (!session) {
      return res.status(404).json({ error: true, code: "NOT_FOUND", message: "Plot session not found" });
    }
    return res.json(session);
  } catch (err) {
    return handleError(res, err);
  }
});

// ─── Debug Psychology ───

plotRoutes.get("/debug/insights/:projectId", debugGuard, async (req, res) => {
  try {
    const session = await plotService.getSession(req.params.projectId);
    const psychologyLedger = session?.psychologyLedger ?? null;
    let culturalBrief = null;
    try {
      const turnNumber = session?.turns?.length ?? 99;
      culturalBrief = await culturalStore.getCachedBrief(req.params.projectId, "plot", turnNumber + 10);
    } catch { /* no brief cached yet */ }
    const divergenceMap = psychologyLedger?.lastDirectionMap ?? null;
    const developmentTargets = session?.developmentTargets ?? [];
    return res.json({ psychologyLedger, culturalBrief, divergenceMap, developmentTargets });
  } catch (err) {
    return handleError(res, err);
  }
});

plotRoutes.get("/debug/psychology/:projectId", debugGuard, async (req, res) => {
  try {
    const session = await plotService.getSession(req.params.projectId);
    if (!session?.psychologyLedger) {
      return res.json({ psychologyLedger: null });
    }
    return res.json({ psychologyLedger: session.psychologyLedger });
  } catch (err) {
    return handleError(res, err);
  }
});

// ─── Session endpoints (/:projectId MUST be last) ───

plotRoutes.get("/:projectId", async (req, res) => {
  try {
    const session = await plotService.getSession(req.params.projectId);
    if (!session) {
      return res.status(404).json({ error: true, code: "NOT_FOUND", message: "Plot session not found" });
    }
    return res.json(session);
  } catch (err) {
    return handleError(res, err);
  }
});

plotRoutes.delete("/:projectId", async (req, res) => {
  try {
    await plotService.resetSession(req.params.projectId);
    return res.json({ deleted: true });
  } catch (err) {
    return handleError(res, err);
  }
});
