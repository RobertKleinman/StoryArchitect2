import { DEFAULT_MODEL_CONFIG, ModelConfig } from "../../shared/modelConfig";
import { ProjectStore } from "../storage/projectStore";
import { CharacterStore } from "../storage/characterStore";
import { CharacterImageStore } from "../storage/characterImageStore";
import { LLMClient } from "./llmClient";
import { HookService } from "./hookService";
import { CharacterService } from "./characterService";
import { CharacterImageService } from "./characterImageService";
import { WorldStore } from "../storage/worldStore";
import { WorldService } from "./worldService";
import { PlotStore } from "../storage/plotStore";
import { PlotService } from "./plotService";
import { SceneStore } from "../storage/sceneStore";
import { SceneService } from "./sceneService";
import { AnimeGenClient } from "./animeGenClient";
import { CulturalStore } from "../storage/culturalStore";
import { CulturalResearchService } from "./culturalResearchService";
import { StoryBibleService } from "./storyBibleService";

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
  img_clarifier: envModel("IMG_MODEL_CLARIFIER", DEFAULT_MODEL_CONFIG.img_clarifier),
  img_builder: envModel("IMG_MODEL_BUILDER", DEFAULT_MODEL_CONFIG.img_builder),
  img_judge: envModel("IMG_MODEL_JUDGE", DEFAULT_MODEL_CONFIG.img_judge),
  img_summary: envModel("IMG_MODEL_SUMMARY", DEFAULT_MODEL_CONFIG.img_summary),
  world_clarifier: envModel("WORLD_MODEL_CLARIFIER", DEFAULT_MODEL_CONFIG.world_clarifier),
  world_builder: envModel("WORLD_MODEL_BUILDER", DEFAULT_MODEL_CONFIG.world_builder),
  world_judge: envModel("WORLD_MODEL_JUDGE", DEFAULT_MODEL_CONFIG.world_judge),
  world_polish: envModel("WORLD_MODEL_POLISH", DEFAULT_MODEL_CONFIG.world_polish),
  world_summary: envModel("WORLD_MODEL_SUMMARY", DEFAULT_MODEL_CONFIG.world_summary),
  plot_clarifier: envModel("PLOT_MODEL_CLARIFIER", DEFAULT_MODEL_CONFIG.plot_clarifier),
  plot_builder: envModel("PLOT_MODEL_BUILDER", DEFAULT_MODEL_CONFIG.plot_builder),
  plot_judge: envModel("PLOT_MODEL_JUDGE", DEFAULT_MODEL_CONFIG.plot_judge),
  plot_polish: envModel("PLOT_MODEL_POLISH", DEFAULT_MODEL_CONFIG.plot_polish),
  plot_summary: envModel("PLOT_MODEL_SUMMARY", DEFAULT_MODEL_CONFIG.plot_summary),
  scene_planner: envModel("SCENE_MODEL_PLANNER", DEFAULT_MODEL_CONFIG.scene_planner),
  scene_clarifier: envModel("SCENE_MODEL_CLARIFIER", DEFAULT_MODEL_CONFIG.scene_clarifier),
  scene_builder: envModel("SCENE_MODEL_BUILDER", DEFAULT_MODEL_CONFIG.scene_builder),
  scene_minor_judge: envModel("SCENE_MODEL_MINOR_JUDGE", DEFAULT_MODEL_CONFIG.scene_minor_judge),
  scene_final_judge: envModel("SCENE_MODEL_FINAL_JUDGE", DEFAULT_MODEL_CONFIG.scene_final_judge),
  scene_divergence: envModel("SCENE_MODEL_DIVERGENCE", DEFAULT_MODEL_CONFIG.scene_divergence),
  psych_consolidator: envModel("PSYCH_MODEL_CONSOLIDATOR", DEFAULT_MODEL_CONFIG.psych_consolidator),
  divergence_explorer: envModel("DIVERGENCE_MODEL_EXPLORER", DEFAULT_MODEL_CONFIG.divergence_explorer),
  cultural_summarizer: envModel("CULTURAL_MODEL_SUMMARIZER", DEFAULT_MODEL_CONFIG.cultural_summarizer),
  cultural_researcher: envModel("CULTURAL_MODEL_RESEARCHER", DEFAULT_MODEL_CONFIG.cultural_researcher),
  hook_escalation: envModel("HOOK_MODEL_ESCALATION", DEFAULT_MODEL_CONFIG.hook_escalation),
};

export const projectStore = new ProjectStore();
export const characterStore = new CharacterStore();
export const characterImageStore = new CharacterImageStore();
export const llmClient = new LLMClient(activeModelConfig);
export const animeGenClient = new AnimeGenClient(process.env.ANIME_GEN_URL ?? "http://localhost:8001");
export const hookService = new HookService(projectStore, llmClient);
export const characterService = new CharacterService(characterStore, projectStore, llmClient);
export const characterImageService = new CharacterImageService(
  characterImageStore, characterStore, projectStore, llmClient, animeGenClient
);
export const worldStore = new WorldStore();
export const worldService = new WorldService(
  worldStore, characterImageStore, characterStore, projectStore, llmClient
);
export const plotStore = new PlotStore();
export const plotService = new PlotService(
  plotStore, worldStore, characterImageStore, characterStore, projectStore, llmClient
);
export const sceneStore = new SceneStore();
export const sceneService = new SceneService(
  sceneStore, plotStore, worldStore, characterImageStore, characterStore, projectStore, llmClient
);
export const culturalStore = new CulturalStore();
export const culturalResearchService = new CulturalResearchService(culturalStore, llmClient);
export const storyBibleService = new StoryBibleService(llmClient);
