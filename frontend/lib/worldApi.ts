import type {
  WorldAssumptionResponse,
  WorldPromptOverrides,
  WorldSessionState,
  WorldPack,
  WorldPromptPreview,
} from "../../shared/types/world";
import type {
  WorldClarifyResponse,
  WorldGenerateResponse,
  EngineInsightsResponse,
} from "../../shared/types/api";
import type { UserPsychologyLedger } from "../../shared/types/userPsychology";
import { request } from "./apiClient";

export const worldApi = {
  clarify: (body: {
    projectId: string;
    characterImageProjectId?: string;
    characterProjectId: string;
    hookProjectId: string;
    userSelection?: { type: string; optionId?: string; label: string };
    assumptionResponses?: WorldAssumptionResponse[];
    promptOverrides?: WorldPromptOverrides;
    worldSeed?: string;
  }) =>
    request<WorldClarifyResponse>("/world/clarify", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  generate: (projectId: string, promptOverrides?: { builder?: WorldPromptOverrides; judge?: WorldPromptOverrides }) =>
    request<WorldGenerateResponse>("/world/generate", {
      method: "POST",
      body: JSON.stringify({ projectId, promptOverrides }),
      timeoutMs: 360_000, // 6 min — builder + judge
    }),

  reroll: (projectId: string, promptOverrides?: { builder?: WorldPromptOverrides; judge?: WorldPromptOverrides }, constraintOverrides?: Record<string, string>) =>
    request<WorldGenerateResponse>("/world/reroll", {
      method: "POST",
      body: JSON.stringify({ projectId, promptOverrides, constraintOverrides }),
      timeoutMs: 360_000,
    }),

  lock: (projectId: string) =>
    request<WorldPack>("/world/lock", {
      method: "POST",
      body: JSON.stringify({ projectId }),
    }),

  getSession: (projectId: string) =>
    request<WorldSessionState>(`/world/${projectId}`),

  previewPrompt: (body: {
    projectId: string;
    stage: "clarifier" | "builder" | "judge" | "summary";
  }) =>
    request<WorldPromptPreview>("/world/preview-prompt", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  reset: (projectId: string) =>
    request<{ deleted: true }>(`/world/${projectId}`, { method: "DELETE" }),

  exportSession: (projectId: string) =>
    request<WorldPack>(`/world/export-session/${projectId}`),

  /** Check if a character-image session exists (validates upstream is reachable) */
  checkCharacterImageSession: (characterImageProjectId: string) =>
    request<any>(`/character-image/${characterImageProjectId}`),

  /** List all available character-image sessions */
  listCharacterImageSessions: () =>
    request<{
      sessions: Array<{
        projectId: string;
        characterProjectId: string;
        status: string;
        turnCount: number;
        hasExport: boolean;
        artStyle: string;
        characterCount: number;
      }>;
    }>("/character-image/list-sessions"),

  /** List all available character sessions */
  listCharacterSessions: () =>
    request<{
      sessions: Array<{
        projectId: string;
        status: string;
        turnCount: number;
        castCount: number;
        characterRoles: string[];
        hasExport: boolean;
        ensembleDynamic: string;
      }>;
    }>("/character/list-sessions"),

  /** Get the character session to resolve the hook project ID */
  getCharacterSession: (characterProjectId: string) =>
    request<any>(`/character/${characterProjectId}`),

  debugPsychology: (projectId: string) =>
    request<{ psychologyLedger: UserPsychologyLedger | null }>(`/world/debug/psychology/${projectId}`),

  debugInsights: (projectId: string) =>
    request<EngineInsightsResponse>(`/world/debug/insights/${projectId}`),
};
