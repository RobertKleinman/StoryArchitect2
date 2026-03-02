import { Router } from "express";
import { characterFeatureFlagGuard } from "../middleware/characterFeatureFlagGuard";
import { characterService } from "../services/runtime";
import { CharacterServiceError } from "../services/characterService";

export const characterRoutes = Router();

characterRoutes.use(characterFeatureFlagGuard);

function getModelOverride(header: string | string[] | undefined): string | undefined {
  if (Array.isArray(header)) return header[0];
  return header;
}

function handleError(res: any, err: unknown) {
  console.error("CHARACTER ROUTE ERROR:", err);
  if (err instanceof CharacterServiceError) {
    const status = err.code === "NOT_FOUND" ? 404 : err.code === "INVALID_INPUT" ? 400 : 502;
    return res.status(status).json({ error: true, code: err.code, message: err.message });
  }
  const msg = err instanceof Error ? err.message : "Unexpected server error";
  return res.status(500).json({ error: true, code: "LLM_CALL_FAILED", message: msg });
}

characterRoutes.post("/preview-prompt", async (req, res) => {
  const { projectId, stage } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }
  if (!stage || !["clarifier", "builder", "judge", "summary"].includes(stage)) {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "stage must be clarifier|builder|judge|summary" });
  }

  try {
    const result = await characterService.previewPrompt(projectId, stage);
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

characterRoutes.post("/clarify", async (req, res) => {
  const modelOverride = getModelOverride(req.header("X-Model-Override"));
  const { projectId, hookProjectId, userSelection, assumptionResponses, promptOverrides, characterSeed } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }
  if (!hookProjectId || typeof hookProjectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "hookProjectId is required" });
  }

  try {
    const result = await characterService.runClarifierTurn(
      projectId, hookProjectId, userSelection, modelOverride, promptOverrides, assumptionResponses, characterSeed
    );
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

characterRoutes.post("/generate", async (req, res) => {
  const modelOverride = getModelOverride(req.header("X-Model-Override"));
  const { projectId, promptOverrides } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }

  try {
    const result = await characterService.runGenerate(projectId, modelOverride, promptOverrides);
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

characterRoutes.post("/reroll", async (req, res) => {
  const modelOverride = getModelOverride(req.header("X-Model-Override"));
  const { projectId, promptOverrides } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }

  try {
    const result = await characterService.reroll(projectId, modelOverride, promptOverrides);
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

characterRoutes.post("/lock", async (req, res) => {
  const modelOverride = getModelOverride(req.header("X-Model-Override"));
  const { projectId } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }

  try {
    const result = await characterService.lockCharacters(projectId, modelOverride);
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

characterRoutes.get("/:projectId", async (req, res) => {
  try {
    const session = await characterService.getSession(req.params.projectId);
    if (!session) {
      return res.status(404).json({ error: true, code: "NOT_FOUND", message: "Character session not found" });
    }
    return res.json(session);
  } catch (err) {
    return handleError(res, err);
  }
});

characterRoutes.delete("/:projectId", async (req, res) => {
  try {
    await characterService.resetSession(req.params.projectId);
    return res.json({ deleted: true });
  } catch (err) {
    return handleError(res, err);
  }
});
