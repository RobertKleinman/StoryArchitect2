import type {
  CharacterAssumptionResponse,
  CharacterPromptOverrides,
  CharacterSessionState,
  CharacterPack,
  CharacterPromptPreview,
} from "../../shared/types/character";
import type {
  CharacterClarifyResponse,
  CharacterGenerateResponse,
  EngineInsightsResponse,
} from "../../shared/types/api";
import type { UserPsychologyLedger } from "../../shared/types/userPsychology";
import { request } from "./apiClient";

export const characterApi = {
  clarify: (body: {
    projectId: string;
    hookProjectId: string;
    userSelection?: { type: string; optionId?: string; label: string };
    assumptionResponses?: CharacterAssumptionResponse[];
    promptOverrides?: CharacterPromptOverrides;
    characterSeed?: string;
  }) =>
    request<CharacterClarifyResponse>("/character/clarify", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  generate: (projectId: string, promptOverrides?: { builder?: CharacterPromptOverrides; judge?: CharacterPromptOverrides }) =>
    request<CharacterGenerateResponse>("/character/generate", {
      method: "POST",
      body: JSON.stringify({ projectId, promptOverrides }),
      timeoutMs: 360_000, // 6 min — builder + judge + polish
    }),

  reroll: (projectId: string, promptOverrides?: { builder?: CharacterPromptOverrides; judge?: CharacterPromptOverrides }, constraintOverrides?: Record<string, string>) =>
    request<CharacterGenerateResponse>("/character/reroll", {
      method: "POST",
      body: JSON.stringify({ projectId, promptOverrides, constraintOverrides }),
      timeoutMs: 360_000,
    }),

  lock: (projectId: string) =>
    request<CharacterPack>("/character/lock", {
      method: "POST",
      body: JSON.stringify({ projectId }),
    }),

  getSession: (projectId: string) =>
    request<CharacterSessionState>(`/character/${projectId}`),

  previewPrompt: (body: {
    projectId: string;
    stage: "clarifier" | "builder" | "judge" | "summary";
  }) =>
    request<CharacterPromptPreview>("/character/preview-prompt", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  reset: (projectId: string) =>
    request<{ deleted: true }>(`/character/${projectId}`, { method: "DELETE" }),

  exportSession: (projectId: string) =>
    request<CharacterPack>(`/character/export-session/${projectId}`),

  /** Check if a hook export exists for the given project ID. Returns the export data or throws. */
  checkHookExport: (hookProjectId: string) =>
    request<{ hookPack: any; seedInput: string; sessionStatus: string }>(`/hook/export-session/${hookProjectId}`),

  /** List all available hook sessions (for session discovery in the connect phase) */
  debugPsychology: (projectId: string) =>
    request<{ psychologyLedger: UserPsychologyLedger | null }>(`/character/debug/psychology/${projectId}`),

  debugInsights: (projectId: string) =>
    request<EngineInsightsResponse>(`/character/debug/insights/${projectId}`),

  listHookSessions: () =>
    request<{
      sessions: Array<{
        projectId: string;
        status: string;
        turnCount: number;
        seedInput: string;
        hookSentence: string;
        premise: string;
        emotionalPromise: string;
        hasExport: boolean;
      }>;
    }>("/hook/list-sessions"),

  getReview: (projectId: string) =>
    request<{
      characters: Array<{
        roleKey: string;
        role: string;
        presentation: string;
        age_range: string;
        ethnicity: string;
        description_summary: string;
        confirmed_traits: Record<string, string>;
        inferred_traits: Record<string, string>;
      }>;
      ready: boolean;
    }>(`/character/review/${projectId}`),

  applyReviewEdits: (projectId: string, edits: Array<{ roleKey: string; field: string; value: string }>) =>
    request<{ applied: number }>("/character/review", {
      method: "POST",
      body: JSON.stringify({ projectId, edits }),
    }),
};
