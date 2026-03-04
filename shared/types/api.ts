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
