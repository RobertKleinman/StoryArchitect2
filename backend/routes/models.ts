import { Router } from "express";
import { ModelConfig, SUPPORTED_MODELS, PROVIDER_MODELS, modelsByProvider } from "../../shared/modelConfig";
import { llmClient } from "../services/runtime";
import { debugGuard } from "./routeUtils";

export const modelRoutes = Router();

/** Valid keys for ModelConfig — used to reject unknown keys at runtime */
const MODEL_CONFIG_KEYS: ReadonlySet<string> = new Set<keyof ModelConfig>([
  "clarifier", "builder", "judge", "summary", "polish",
  "char_clarifier", "char_builder", "char_judge", "char_polish", "char_summary",
  "img_clarifier", "img_builder", "img_judge", "img_summary",
  "world_clarifier", "world_builder", "world_judge", "world_polish", "world_summary",
  "plot_clarifier", "plot_builder", "plot_judge", "plot_polish", "plot_summary",
  "scene_planner", "scene_clarifier", "scene_builder", "scene_minor_judge", "scene_final_judge", "scene_divergence",
  "psych_consolidator",
  "divergence_explorer",
  "cultural_summarizer",
  "cultural_researcher",
  "hook_escalation",
  "grounding_researcher",
]);

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
  // Guard against null/non-object body
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    return res.status(400).json({
      error: true,
      code: "INVALID_INPUT",
      message: "Request body must be a JSON object with role-model pairs",
    });
  }

  const partial = req.body as Partial<ModelConfig>;
  const keys = Object.keys(partial);

  // Reject unknown keys
  for (const key of keys) {
    if (!MODEL_CONFIG_KEYS.has(key)) {
      return res.status(400).json({
        error: true,
        code: "INVALID_INPUT",
        message: `Unknown model role: "${key}". Valid roles: ${[...MODEL_CONFIG_KEYS].join(", ")}`,
      });
    }
  }

  // Validate model values
  for (const key of keys as Array<keyof ModelConfig>) {
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

/** GET /api/debug/tokens — accumulated token usage for this server session */
modelRoutes.get("/debug/tokens", debugGuard, (_req, res) => {
  return res.json(llmClient.getTokenUsage());
});
