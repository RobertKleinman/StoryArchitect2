import type {
  PlotAssumptionResponse,
  PlotPromptOverrides,
  PlotSessionState,
  PlotPack,
  PlotPromptPreview,
} from "../../shared/types/plot";
import type {
  PlotClarifyResponse,
  PlotGenerateResponse,
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

export const plotApi = {
  clarify: (body: {
    projectId: string;
    worldProjectId: string;
    characterImageProjectId?: string;
    characterProjectId: string;
    hookProjectId: string;
    userSelection?: { type: string; optionId?: string; label: string };
    assumptionResponses?: PlotAssumptionResponse[];
    promptOverrides?: PlotPromptOverrides;
    plotSeed?: string;
  }) =>
    request<PlotClarifyResponse>("/plot/clarify", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  generate: (projectId: string, promptOverrides?: { builder?: PlotPromptOverrides; judge?: PlotPromptOverrides }) =>
    request<PlotGenerateResponse>("/plot/generate", {
      method: "POST",
      body: JSON.stringify({ projectId, promptOverrides }),
      timeoutMs: 360_000, // 6 min — builder + judge
    }),

  reroll: (projectId: string, promptOverrides?: { builder?: PlotPromptOverrides; judge?: PlotPromptOverrides }) =>
    request<PlotGenerateResponse>("/plot/reroll", {
      method: "POST",
      body: JSON.stringify({ projectId, promptOverrides }),
      timeoutMs: 360_000,
    }),

  lock: (projectId: string) =>
    request<PlotPack>("/plot/lock", {
      method: "POST",
      body: JSON.stringify({ projectId }),
    }),

  getSession: (projectId: string) =>
    request<PlotSessionState>(`/plot/${projectId}`),

  previewPrompt: (body: {
    projectId: string;
    stage: "clarifier" | "builder" | "judge" | "summary";
  }) =>
    request<PlotPromptPreview>("/plot/preview-prompt", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  reset: (projectId: string) =>
    request<{ deleted: true }>(`/plot/${projectId}`, { method: "DELETE" }),

  /** List all available world sessions (for upstream selection) */
  listWorldSessions: () =>
    request<{
      sessions: Array<{
        projectId: string;
        characterImageProjectId?: string;
        characterProjectId: string;
        hookProjectId: string;
        status: string;
        turnCount: number;
        hasExport: boolean;
      }>;
    }>("/world/list-sessions"),

  /** Get a world session to resolve upstream chain */
  getWorldSession: (worldProjectId: string) =>
    request<any>(`/world/${worldProjectId}`),

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
    request<{ psychologyLedger: UserPsychologyLedger | null }>(`/plot/debug/psychology/${projectId}`),
};
