import { DEFAULT_MODEL_CONFIG, ModelConfig } from "../../shared/modelConfig";
import { ProjectStore } from "../storage/projectStore";
import { LLMClient } from "./llmClient";
import { HookService } from "./hookService";

function envModel(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export const activeModelConfig: ModelConfig = {
  clarifier: envModel("HOOK_MODEL_CLARIFIER", DEFAULT_MODEL_CONFIG.clarifier),
  builder: envModel("HOOK_MODEL_BUILDER", DEFAULT_MODEL_CONFIG.builder),
  judge: envModel("HOOK_MODEL_JUDGE", DEFAULT_MODEL_CONFIG.judge),
  summary: envModel("HOOK_MODEL_SUMMARY", DEFAULT_MODEL_CONFIG.summary),
};

export const projectStore = new ProjectStore();
export const llmClient = new LLMClient(activeModelConfig);
export const hookService = new HookService(projectStore, llmClient);
