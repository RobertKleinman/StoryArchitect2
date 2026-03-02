import { DEFAULT_MODEL_CONFIG, ModelConfig } from "../../shared/modelConfig";
import { ProjectStore } from "../storage/projectStore";
import { CharacterStore } from "../storage/characterStore";
import { LLMClient } from "./llmClient";
import { HookService } from "./hookService";
import { CharacterService } from "./characterService";

function envModel(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export const activeModelConfig: ModelConfig = {
  clarifier: envModel("HOOK_MODEL_CLARIFIER", DEFAULT_MODEL_CONFIG.clarifier),
  builder: envModel("HOOK_MODEL_BUILDER", DEFAULT_MODEL_CONFIG.builder),
  judge: envModel("HOOK_MODEL_JUDGE", DEFAULT_MODEL_CONFIG.judge),
  summary: envModel("HOOK_MODEL_SUMMARY", DEFAULT_MODEL_CONFIG.summary),
  polish: envModel("HOOK_MODEL_POLISH", DEFAULT_MODEL_CONFIG.polish),
  char_clarifier: envModel("CHAR_MODEL_CLARIFIER", DEFAULT_MODEL_CONFIG.char_clarifier),
  char_builder: envModel("CHAR_MODEL_BUILDER", DEFAULT_MODEL_CONFIG.char_builder),
  char_judge: envModel("CHAR_MODEL_JUDGE", DEFAULT_MODEL_CONFIG.char_judge),
  char_polish: envModel("CHAR_MODEL_POLISH", DEFAULT_MODEL_CONFIG.char_polish),
  char_summary: envModel("CHAR_MODEL_SUMMARY", DEFAULT_MODEL_CONFIG.char_summary),
};

export const projectStore = new ProjectStore();
export const characterStore = new CharacterStore();
export const llmClient = new LLMClient(activeModelConfig);
export const hookService = new HookService(projectStore, llmClient);
export const characterService = new CharacterService(characterStore, projectStore, llmClient);
