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
} from "../../shared/types/api";
import type { UserPsychologyLedger } from "../../shared/types/userPsychology";

const BASE = "/api";

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
        characterNames: string[];
        hookPremise: string;
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
    request<import("../../shared/types/api").EngineInsightsResponse>(`/world/debug/insights/${projectId}`),
};
