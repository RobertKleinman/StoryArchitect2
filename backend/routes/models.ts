import { Router } from "express";
import { ModelConfig, SUPPORTED_MODELS } from "../../shared/modelConfig";
import { llmClient } from "../services/runtime";

export const modelRoutes = Router();

modelRoutes.get("/models", (_req, res) => {
  return res.json(llmClient.getConfig());
});

modelRoutes.put("/models", (req, res) => {
  const partial = req.body as Partial<ModelConfig>;
  const keys = Object.keys(partial) as Array<keyof ModelConfig>;

  for (const key of keys) {
    const value = partial[key];
    if (typeof value !== "string" || !SUPPORTED_MODELS.includes(value as any)) {
      return res.status(400).json({
        error: true,
        code: "INVALID_INPUT",
        message: `Invalid model for ${key}`,
      });
    }
  }

  llmClient.updateConfig(partial);
  return res.json(llmClient.getConfig());
});
