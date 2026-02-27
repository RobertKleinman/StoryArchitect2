import {
  HookClarifierResponse,
  HookBuilderOutput,
  HookJudgeScores,
  HookPack,
  HookSessionState,
} from "./hook";

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

/** GET /api/hook/:projectId */
export type SessionResponse = HookSessionState;
