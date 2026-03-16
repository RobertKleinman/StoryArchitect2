import type { ModelConfig, ProviderModelEntry, LLMProvider } from "../../shared/modelConfig";
import type {
  AssumptionResponse,
  HookSessionState,
  HookPack,
  PromptOverrides,
} from "../../shared/types/hook";
import type {
  ClarifyResponse,
  GenerateResponse,
  PreviewPromptResponse,
  EngineInsightsResponse,
} from "../../shared/types/api";
import type { UserPsychologyLedger } from "../../shared/types/userPsychology";
import { request } from "./apiClient";

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
      timeoutMs: 360_000, // 6 min — tournament runs parallel builders + judges + polish
    }),

  reroll: (projectId: string, promptOverrides?: { builder?: PromptOverrides; judge?: PromptOverrides }, constraintOverrides?: Record<string, string>) =>
    request<GenerateResponse>("/hook/reroll", {
      method: "POST",
      body: JSON.stringify({ projectId, promptOverrides, constraintOverrides }),
      timeoutMs: 360_000,
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

  debugInsights: (projectId: string) =>
    request<EngineInsightsResponse>(`/hook/debug/insights/${projectId}`),

  getModels: () => request<ModelConfig>("/models"),

  getAvailableModels: () =>
    request<{
      models: ProviderModelEntry[];
      byProvider: Record<LLMProvider, ProviderModelEntry[]>;
    }>("/models/available"),

  setModels: (config: Partial<ModelConfig>) =>
    request<ModelConfig>("/models", {
      method: "PUT",
      body: JSON.stringify(config),
    }),
};
