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

  reroll: (projectId: string, promptOverrides?: { builder?: CharacterPromptOverrides; judge?: CharacterPromptOverrides }) =>
    request<CharacterGenerateResponse>("/character/reroll", {
      method: "POST",
      body: JSON.stringify({ projectId, promptOverrides }),
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

  /** Check if a hook export exists for the given project ID. Returns the export data or throws. */
  checkHookExport: (hookProjectId: string) =>
    request<{ hookPack: any; seedInput: string; sessionStatus: string }>(`/hook/export-session/${hookProjectId}`),

  /** List all available hook sessions (for session discovery in the connect phase) */
  debugPsychology: (projectId: string) =>
    request<{ psychologyLedger: UserPsychologyLedger | null }>(`/character/debug/psychology/${projectId}`),

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
};
