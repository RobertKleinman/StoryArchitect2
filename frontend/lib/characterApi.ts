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
} from "../../shared/types/api";

const BASE = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data?.message ?? "Something went wrong");
  }

  return data as T;
}

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
    }),

  reroll: (projectId: string, promptOverrides?: { builder?: CharacterPromptOverrides; judge?: CharacterPromptOverrides }) =>
    request<CharacterGenerateResponse>("/character/reroll", {
      method: "POST",
      body: JSON.stringify({ projectId, promptOverrides }),
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

  /** Check if a hook export exists for the given project ID. Returns the export data or throws. */
  checkHookExport: (hookProjectId: string) =>
    request<{ hookPack: any; seedInput: string; sessionStatus: string }>(`/hook/export-session/${hookProjectId}`),
};
