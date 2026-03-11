import { Router } from "express";
import { plotFeatureFlagGuard } from "../middleware/plotFeatureFlagGuard";
import { plotService } from "../services/runtime";
import { PlotServiceError } from "../services/plotService";

export const plotRoutes = Router();

plotRoutes.use(plotFeatureFlagGuard);

function getModelOverride(header: string | string[] | undefined): string | undefined {
  if (Array.isArray(header)) return header[0];
  return header;
}

function handleError(res: any, err: unknown) {
  console.error("PLOT ROUTE ERROR:", err);
  if (err instanceof PlotServiceError) {
    const status = err.code === "NOT_FOUND" ? 404
      : err.code === "INVALID_INPUT" ? 400
      : err.code === "LLM_PARSE_ERROR" ? 422
      : 502;
    return res.status(status).json({ error: true, code: err.code, message: err.message });
  }
  const msg = err instanceof Error ? err.message : "Unexpected server error";
  return res.status(500).json({ error: true, code: "LLM_CALL_FAILED", message: msg });
}

// ─── Preview Prompt ───

plotRoutes.post("/preview-prompt", async (req, res) => {
  const { projectId, stage } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }
  if (!stage || !["clarifier", "builder", "judge", "summary"].includes(stage)) {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "stage must be clarifier|builder|judge|summary" });
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
  const { projectId, promptOverrides } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }

  try {
    const result = await plotService.reroll(projectId, modelOverride, promptOverrides);
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

plotRoutes.get("/debug/psychology/:projectId", async (req, res) => {
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
