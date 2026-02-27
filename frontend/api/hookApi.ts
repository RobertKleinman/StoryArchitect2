import type { ModelConfig } from "../../shared/modelConfig";
import type {
  HookSessionState,
  HookPack,
} from "../../shared/types/hook";
import type {
  ClarifyResponse,
  GenerateResponse,
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

export const hookApi = {
  clarify: (body: {
    projectId: string;
    seedInput?: string;
    userSelection?: { type: string; optionId?: string; label: string };
  }) =>
    request<ClarifyResponse>("/hook/clarify", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  generate: (projectId: string) =>
    request<GenerateResponse>("/hook/generate", {
      method: "POST",
      body: JSON.stringify({ projectId }),
    }),

  reroll: (projectId: string) =>
    request<GenerateResponse>("/hook/reroll", {
      method: "POST",
      body: JSON.stringify({ projectId }),
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

  reset: (projectId: string) =>
    request<{ deleted: true }>(`/hook/${projectId}`, { method: "DELETE" }),

  getModels: () => request<ModelConfig>("/models"),

  setModels: (config: Partial<ModelConfig>) =>
    request<ModelConfig>("/models", {
      method: "PUT",
      body: JSON.stringify(config),
    }),
};
