import { Router } from "express";
import { featureFlagGuard } from "../middleware/featureFlagGuard";
import { hookService } from "../services/runtime";
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
  if (err instanceof HookServiceError) {
    const status = err.code === "NOT_FOUND" ? 404 : err.code === "INVALID_INPUT" ? 400 : 502;
    return res.status(status).json({ error: true, code: err.code, message: err.message });
  }
  return res.status(500).json({ error: true, code: "LLM_CALL_FAILED", message: "Unexpected server error" });
}

hookRoutes.post("/clarify", async (req, res) => {
  const modelOverride = getModelOverride(req.header("X-Model-Override"));
  const { projectId, seedInput, userSelection } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }

  try {
    const result = await hookService.runClarifierTurn(projectId, seedInput, userSelection, modelOverride);
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

hookRoutes.post("/generate", async (req, res) => {
  const modelOverride = getModelOverride(req.header("X-Model-Override"));
  const { projectId } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }

  try {
    const result = await hookService.runTournament(projectId, modelOverride);
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

hookRoutes.post("/reroll", async (req, res) => {
  const modelOverride = getModelOverride(req.header("X-Model-Override"));
  const { projectId } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }

  try {
    const result = await hookService.reroll(projectId, modelOverride);
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

hookRoutes.get("/:projectId", async (req, res) => {
  getModelOverride(req.header("X-Model-Override"));
  try {
    const session = await hookService.getSession(req.params.projectId);
    if (!session) {
      return res.status(404).json({ error: true, code: "NOT_FOUND", message: "Session not found" });
    }
    return res.json(session);
  } catch (err) {
    return handleError(res, err);
  }
});

hookRoutes.delete("/:projectId", async (req, res) => {
  getModelOverride(req.header("X-Model-Override"));
  try {
    await hookService.resetSession(req.params.projectId);
    return res.json({ deleted: true });
  } catch (err) {
    return handleError(res, err);
  }
});
