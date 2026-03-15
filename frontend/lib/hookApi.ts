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
} from "../../shared/types/api";
import type { UserPsychologyLedger } from "../../shared/types/userPsychology";

const BASE = "/api";

// Default timeout: 3 min for normal calls; generation/tournament calls pass longer timeouts
const DEFAULT_TIMEOUT_MS = 180_000;

async function request<T>(path: string, options?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const { timeoutMs, ...fetchOptions } = options ?? {};
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...fetchOptions,
      signal: controller.signal,
    });

    let data: any;
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      data = await res.json();
    } else {
      const text = await res.text();
      data = { message: text || `Server error (${res.status})` };
    }

    if (!res.ok || data.error) {
      throw new Error(data?.message ?? "Something went wrong");
    }

    return data as T;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`Request to ${path} timed out after ${((timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000).toFixed(0)}s`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
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
    request<import("../../shared/types/api").EngineInsightsResponse>(`/hook/debug/insights/${projectId}`),

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
