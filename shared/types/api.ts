import {
  HookClarifierResponse,
  HookBuilderOutput,
  HookJudgeScores,
  HookPack,
  HookSessionState,
  PromptPreview,
  PromptOverrides,
} from "./hook";

import {
  CharacterClarifierResponse,
  CharacterBuilderOutput,
  CharacterJudgeScores,
  CharacterPack,
  CharacterSessionState,
} from "./character";

import {
  CharacterImageClarifierResponse,
  CharacterImageBuilderOutput,
  CharacterImageJudgeScores,
  CharacterImagePack,
  CharacterImageSessionState,
  GeneratedCharacterImage,
} from "./characterImage";

import {
  WorldClarifierResponse,
  WorldBuilderOutput,
  WorldJudgeScores,
  WorldPack,
  WorldSessionState,
  DevelopmentTarget,
} from "./world";

import {
  PlotClarifierResponse,
  PlotBuilderOutput,
  PlotJudgeScores,
  PlotPack,
  PlotSessionState,
  PlotDevelopmentTarget,
} from "./plot";

import {
  SceneClarifierResponse,
  SceneBuilderOutput,
  SceneMinorJudgeOutput,
  FinalJudgeOutput,
  ScenePack,
  SceneSessionState,
  ScenePlannerOutput,
  NarrativePreview,
  SceneDevelopmentTarget,
  BuiltScene,
  ReadableScene,
} from "./scene";

/** Standard error shape for all endpoints */
export interface ApiError {
  error: true;
  code:
    | "FEATURE_DISABLED"
    | "NOT_FOUND"
    | "INVALID_INPUT"
    | "LLM_PARSE_ERROR"
    | "LLM_CALL_FAILED";
  message: string;
}

// ─── Hook Module API ───

/** POST /api/hook/clarify */
export interface ClarifyResponse {
  clarifier: HookClarifierResponse;
  turnNumber: number;
  totalTurns: number;
}

/** POST /api/hook/generate and /reroll */
export interface GenerateResponse {
  hook: HookBuilderOutput;
  judge: {
    passed: boolean;
    hard_fail_reasons: string[];
    scores: HookJudgeScores;
    most_generic_part: string;
    one_fix_instruction: string;
  };
  rerollCount: number;
}

/** POST /api/hook/lock */
export type LockResponse = HookPack;

/** POST /api/hook/preview-prompt */
export interface PreviewPromptRequest {
  projectId: string;
  stage: "clarifier" | "builder" | "judge" | "summary";
  /** For clarifier first turn */
  seedInput?: string;
  /** For clarifier subsequent turns */
  userSelection?: { type: string; optionId?: string; label: string };
}

export type PreviewPromptResponse = PromptPreview;

/** GET /api/hook/:projectId */
export type SessionResponse = HookSessionState;

// ─── Character Module API ───

/** POST /api/character/clarify */
export interface CharacterClarifyResponse {
  clarifier: CharacterClarifierResponse;
  turnNumber: number;
  totalTurns: number;
}

/** POST /api/character/generate and /reroll */
export interface CharacterGenerateResponse {
  characters: CharacterBuilderOutput;
  judge: {
    passed: boolean;
    hard_fail_reasons: string[];
    scores: CharacterJudgeScores;
    weakest_character: string;
    one_fix_instruction: string;
  } | null;
  rerollCount: number;
}

/** POST /api/character/lock */
export type CharacterLockResponse = CharacterPack;

/** GET /api/character/:projectId */
export type CharacterSessionResponse = CharacterSessionState;

// ─── Character Image Module API ───

/** POST /api/character-image/clarify */
export interface CharacterImageClarifyResponse {
  clarifier: CharacterImageClarifierResponse;
  turnNumber: number;
  totalTurns: number;
}

/** POST /api/character-image/generate */
export interface CharacterImageGenerateResponse {
  specs: CharacterImageBuilderOutput;
  judge: {
    passed: boolean;
    hard_fail_reasons: string[];
    scores: CharacterImageJudgeScores;
    distinctiveness_notes: string;
    one_fix_instruction: string;
  } | null;
}

/** POST /api/character-image/generate-images */
export interface CharacterImageGenerateImagesResponse {
  images: Record<string, GeneratedCharacterImage>;
  generationTimeMs: number;
}

/** POST /api/character-image/lock */
export type CharacterImageLockResponse = CharacterImagePack;

/** GET /api/character-image/:projectId */
export type CharacterImageSessionResponse = CharacterImageSessionState;

// ─── World Module API ───

/** POST /api/world/clarify */
export interface WorldClarifyResponse {
  clarifier: WorldClarifierResponse;
  turnNumber: number;
  totalTurns: number;
}

/** POST /api/world/generate and /reroll */
export interface WorldGenerateResponse {
  world: WorldBuilderOutput;
  judge: {
    passed: boolean;
    hard_fail_reasons: string[];
    scores: WorldJudgeScores;
    weakest_element: string;
    one_fix_instruction: string;
  } | null;
  /** Development targets tracked across modules — shows what weaknesses have been addressed */
  developmentTargets?: DevelopmentTarget[];
  /** Judge weaknesses specific to this world build */
  weaknesses?: Array<{
    area: string;
    weakness: string;
    development_opportunity: string;
  }>;
}

/** POST /api/world/lock */
export type WorldLockResponse = WorldPack;

/** GET /api/world/:projectId */
export type WorldSessionResponse = WorldSessionState;

// ─── Plot Module API ───

/** POST /api/plot/clarify */
export interface PlotClarifyResponse {
  clarifier: PlotClarifierResponse;
  turnNumber: number;
  totalTurns: number;
}

/** POST /api/plot/generate and /reroll */
export interface PlotGenerateResponse {
  plot: PlotBuilderOutput;
  judge: {
    passed: boolean;
    hard_fail_reasons: string[];
    scores: PlotJudgeScores;
    weakest_element: string;
    one_fix_instruction: string;
  } | null;
  rerollCount: number;
  /** Development targets tracked across modules — shows what weaknesses have been addressed */
  developmentTargets?: PlotDevelopmentTarget[];
  /** Judge weaknesses specific to this plot build */
  weaknesses?: Array<{
    area: string;
    weakness: string;
    development_opportunity: string;
  }>;
}

/** POST /api/plot/lock */
export type PlotLockResponse = PlotPack;

/** GET /api/plot/:projectId */
export type PlotSessionResponse = PlotSessionState;

// ─── Scene Module API ───

/** POST /api/scene/plan — initial planning phase */
export interface ScenePlanResponse {
  planner: ScenePlannerOutput;
  clarifier: SceneClarifierResponse;
  turnNumber: number;
}

/** POST /api/scene/plan-clarify — refine the plan */
export interface ScenePlanClarifyResponse {
  clarifier: SceneClarifierResponse;
  turnNumber: number;
  planConfirmed: boolean;
}

/** POST /api/scene/clarify — per-scene steering */
export interface SceneClarifyResponse {
  clarifier: SceneClarifierResponse;
  sceneId: string;
  sceneIndex: number;
  totalScenes: number;
  autoPassApplied: boolean;
  autoBuiltScene: BuiltScene | null;
}

/** POST /api/scene/build — background build result (polled) */
export interface SceneBuildResponse {
  scene: BuiltScene;
  sceneIndex: number;
  totalScenes: number;
}

/** POST /api/scene/final-judge */
export interface SceneFinalJudgeResponse {
  judge: FinalJudgeOutput;
}

/** POST /api/scene/complete */
export type SceneCompleteResponse = ScenePack;

/** GET /api/scene/:projectId */
export type SceneSessionResponse = SceneSessionState;

/** GET /api/scene/debug/scenes/:projectId — testing sidebar */
export interface SceneDebugResponse {
  builtScenes: BuiltScene[];
  readableScenes: ReadableScene[];
  scenePlan: ScenePlannerOutput["scenes"] | null;
  narrativePreview: NarrativePreview | null;
  rhythmSnapshot: SceneSessionState["rhythmSnapshot"] | null;
}
