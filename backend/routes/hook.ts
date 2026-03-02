import { Router } from "express";
import { featureFlagGuard } from "../middleware/featureFlagGuard";
import { hookService, projectStore } from "../services/runtime";
import { HookServiceError } from "../services/hookService";

export const hookRoutes = Router();

hookRoutes.use(featureFlagGuard);

function getModelOverride(header: string | string[] | undefined): string | undefined {
  if (Array.isArray(header)) {
    return header[0];
  }
  return header;
}

function handleError(res: any, err: unknown) {
  console.error("HOOK ROUTE ERROR:", err);
  if (err instanceof HookServiceError) {
    const status = err.code === "NOT_FOUND" ? 404 : err.code === "INVALID_INPUT" ? 400 : 502;
    return res.status(status).json({ error: true, code: err.code, message: err.message });
  }
  return res.status(500).json({ error: true, code: "LLM_CALL_FAILED", message: "Unexpected server error" });
}

hookRoutes.post("/preview-prompt", async (req, res) => {
  const { projectId, stage, seedInput, userSelection } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }
  if (!stage || !["clarifier", "builder", "judge", "summary"].includes(stage)) {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "stage must be clarifier|builder|judge|summary" });
  }

  try {
    const result = await hookService.previewPrompt(projectId, stage, seedInput, userSelection);
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

hookRoutes.post("/clarify", async (req, res) => {
  const modelOverride = getModelOverride(req.header("X-Model-Override"));
  const { projectId, seedInput, userSelection, assumptionResponses, promptOverrides } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }

  try {
    const result = await hookService.runClarifierTurn(projectId, seedInput, userSelection, modelOverride, promptOverrides, assumptionResponses);
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

hookRoutes.post("/generate", async (req, res) => {
  const modelOverride = getModelOverride(req.header("X-Model-Override"));
  const { projectId, promptOverrides } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }

  try {
    const result = await hookService.runTournament(projectId, modelOverride, promptOverrides);
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

hookRoutes.post("/reroll", async (req, res) => {
  const modelOverride = getModelOverride(req.header("X-Model-Override"));
  const { projectId, promptOverrides } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }

  try {
    const result = await hookService.reroll(projectId, modelOverride, promptOverrides);
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

hookRoutes.post("/lock", async (req, res) => {
  const modelOverride = getModelOverride(req.header("X-Model-Override"));
  const { projectId, edits } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }

  try {
    const result = await hookService.lockHook(projectId, edits, modelOverride);
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

hookRoutes.get("/export-prompts/:projectId", async (req, res) => {
  try {
    const session = await hookService.getSession(req.params.projectId);
    if (!session) {
      return res.status(404).json({ error: true, code: "NOT_FOUND", message: "Session not found" });
    }
    const history = hookService.getPromptHistory(session);

    // Build a rich export with session context
    const exportData = {
      exportedAt: new Date().toISOString(),
      projectId: session.projectId,
      seedInput: session.seedInput,
      sessionStatus: session.status,
      totalTurns: session.turns.length,
      promptHistory: history,
      // Include the current default prompts for reference
      currentState: session.currentState,
      // Summary stats
      stats: {
        totalCalls: history.length,
        editedCalls: history.filter(h => h.wasEdited).length,
        stageBreakdown: {
          clarifier: history.filter(h => h.stage === "clarifier").length,
          builder: history.filter(h => h.stage === "builder").length,
          judge: history.filter(h => h.stage === "judge").length,
          summary: history.filter(h => h.stage === "summary").length,
        },
      },
    };

    return res.json(exportData);
  } catch (err) {
    return handleError(res, err);
  }
});

hookRoutes.get("/export-session/:projectId", async (req, res) => {
  try {
    // Try to get a previously saved export first
    let exportData = await projectStore.getExport(req.params.projectId);

    // If no saved export, generate one on the fly from the session
    if (!exportData) {
      const session = await hookService.getSession(req.params.projectId);
      if (!session) {
        return res.status(404).json({ error: true, code: "NOT_FOUND", message: "Session not found" });
      }
      exportData = await projectStore.saveExport(session);
    }

    return res.json(exportData);
  } catch (err) {
    return handleError(res, err);
  }
});

hookRoutes.get("/:projectId", async (req, res) => {
  const modelOverride = getModelOverride(req.header("X-Model-Override"));
  try {
    const session = await hookService.getSession(req.params.projectId, modelOverride);
    if (!session) {
      return res.status(404).json({ error: true, code: "NOT_FOUND", message: "Session not found" });
    }
    return res.json(session);
  } catch (err) {
    return handleError(res, err);
  }
});

hookRoutes.delete("/:projectId", async (req, res) => {
  const modelOverride = getModelOverride(req.header("X-Model-Override"));
  try {
    await hookService.resetSession(req.params.projectId, modelOverride);
    return res.json({ deleted: true });
  } catch (err) {
    return handleError(res, err);
  }
});
