import type { ModelConfig } from "../../shared/modelConfig";
import type {
  AssumptionResponse,
  HookSessionState,
  HookPack,
  PromptPreview,
  PromptOverrides,
} from "../../shared/types/hook";
import type {
  ClarifyResponse,
  GenerateResponse,
  PreviewPromptResponse,
} from "../../shared/types/api";
import type { UserPsychologyLedger } from "../../shared/types/userPsychology";

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

export const hookApi = {
  previewPrompt: (body: {
    projectId: string;
    stage: "clarifier" | "builder" | "judge" | "summary";
    seedInput?: string;
    userSelection?: { type: string; optionId?: string; label: string };
  }) =>
    request<PreviewPromptResponse>("/hook/preview-prompt", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  clarify: (body: {
    projectId: string;
    seedInput?: string;
    userSelection?: { type: string; optionId?: string; label: string };
    assumptionResponses?: AssumptionResponse[];
    promptOverrides?: PromptOverrides;
  }) =>
    request<ClarifyResponse>("/hook/clarify", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  generate: (projectId: string, promptOverrides?: { builder?: PromptOverrides; judge?: PromptOverrides }) =>
    request<GenerateResponse>("/hook/generate", {
      method: "POST",
      body: JSON.stringify({ projectId, promptOverrides }),
    }),

  reroll: (projectId: string, promptOverrides?: { builder?: PromptOverrides; judge?: PromptOverrides }) =>
    request<GenerateResponse>("/hook/reroll", {
      method: "POST",
      body: JSON.stringify({ projectId, promptOverrides }),
    }),

  lock: (
    projectId: string,
    edits?: { premise?: string; page_turn_trigger?: string }
  ) =>
    request<HookPack>("/hook/lock", {
      method: "POST",
      body: JSON.stringify({ projectId, edits }),
    }),

  getSession: (projectId: string) => request<HookSessionState>(`/hook/${projectId}`),

  exportPrompts: (projectId: string) => request<any>(`/hook/export-prompts/${projectId}`),

  exportSession: (projectId: string) => request<any>(`/hook/export-session/${projectId}`),

  reset: (projectId: string) =>
    request<{ deleted: true }>(`/hook/${projectId}`, { method: "DELETE" }),

  debugPsychology: (projectId: string) =>
    request<{ psychologyLedger: UserPsychologyLedger | null }>(`/hook/debug/psychology/${projectId}`),

  getModels: () => request<ModelConfig>("/models"),

  setModels: (config: Partial<ModelConfig>) =>
    request<ModelConfig>("/models", {
      method: "PUT",
      body: JSON.stringify(config),
    }),
};
