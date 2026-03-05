import { Router } from "express";
import { ModelConfig, SUPPORTED_MODELS, PROVIDER_MODELS, modelsByProvider } from "../../shared/modelConfig";
import { llmClient } from "../services/runtime";

export const modelRoutes = Router();

/** GET /api/models — current per-role model config */
modelRoutes.get("/models", (_req, res) => {
  return res.json(llmClient.getConfig());
});

/** GET /api/models/available — all available models grouped by provider (for UI dropdowns) */
modelRoutes.get("/models/available", (_req, res) => {
  return res.json({
    models: PROVIDER_MODELS,
    byProvider: modelsByProvider(),
  });
});

/** PUT /api/models — update per-role model assignments */
modelRoutes.put("/models", (req, res) => {
  const partial = req.body as Partial<ModelConfig>;
  const keys = Object.keys(partial) as Array<keyof ModelConfig>;

  for (const key of keys) {
    const value = partial[key];
    if (typeof value !== "string" || !SUPPORTED_MODELS.includes(value)) {
      return res.status(400).json({
        error: true,
        code: "INVALID_INPUT",
        message: `Invalid model for ${key}: "${value}". Supported: ${SUPPORTED_MODELS.join(", ")}`,
      });
    }
  }

  llmClient.updateConfig(partial);
  return res.json(llmClient.getConfig());
});
