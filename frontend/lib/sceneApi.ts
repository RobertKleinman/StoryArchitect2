import type {
  SceneSessionState,
  ScenePack,
  ScenePromptOverrides,
  ScenePromptPreview,
} from "../../shared/types/scene";
import type {
  ScenePlanResponse,
  ScenePlanClarifyResponse,
  SceneClarifyResponse,
  SceneBuildResponse,
  SceneFinalJudgeResponse,
  SceneCompleteResponse,
  SceneDebugResponse,
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

export const sceneApi = {
  // ─── Phase 0: Planning ───

  /** Start scene planning — cluster beats into scenes, get narrative preview + first plan clarifier */
  plan: (body: {
    projectId: string;
    plotProjectId: string;
    promptOverrides?: ScenePromptOverrides;
  }) =>
    request<ScenePlanResponse>("/scene/plan", {
      method: "POST",
      body: JSON.stringify(body),
      timeoutMs: 300_000, // 5 min — planner + clarifier
    }),

  /** Refine the plan with user feedback */
  planClarify: (body: {
    projectId: string;
    userSelection?: { type: string; optionId?: string; label: string };
    assumptionResponses?: Array<{ assumptionId: string; action: string; originalValue: string; newValue: string }>;
    promptOverrides?: ScenePromptOverrides;
  }) =>
    request<ScenePlanClarifyResponse>("/scene/plan-clarify", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** Confirm the plan and transition to scene-by-scene writing */
  confirmPlan: (projectId: string) =>
    request<{ confirmed: true; totalScenes: number }>("/scene/confirm-plan", {
      method: "POST",
      body: JSON.stringify({ projectId }),
    }),

  // ─── Phase 1: Per-Scene Clarification ───

  /** Per-scene steering (or auto-pass) */
  clarify: (body: {
    projectId: string;
    userSelection?: { type: string; optionId?: string; label: string };
    assumptionResponses?: Array<{ assumptionId: string; action: string; originalValue: string; newValue: string }>;
    promptOverrides?: ScenePromptOverrides;
  }) =>
    request<SceneClarifyResponse>("/scene/clarify", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // ─── Phase 2: Building ───

  /** Build the current scene (builder + minor judge) */
  build: (projectId: string, promptOverrides?: { builder?: ScenePromptOverrides; judge?: ScenePromptOverrides }) =>
    request<SceneBuildResponse>("/scene/build", {
      method: "POST",
      body: JSON.stringify({ projectId, promptOverrides }),
      timeoutMs: 360_000, // 6 min — builder + minor judge
    }),

  // ─── Phase 4: Final Judge ───

  /** Run intensive full-work assessment */
  finalJudge: (projectId: string, promptOverrides?: ScenePromptOverrides) =>
    request<SceneFinalJudgeResponse>("/scene/final-judge", {
      method: "POST",
      body: JSON.stringify({ projectId, promptOverrides }),
      timeoutMs: 360_000, // 6 min
    }),

  // ─── Complete ───

  /** Lock and package ScenePack */
  complete: (projectId: string) =>
    request<SceneCompleteResponse>("/scene/complete", {
      method: "POST",
      body: JSON.stringify({ projectId }),
    }),

  // ─── Session Management ───

  getSession: (projectId: string) =>
    request<SceneSessionState>(`/scene/${projectId}`),

  reset: (projectId: string) =>
    request<{ deleted: true }>(`/scene/${projectId}`, { method: "DELETE" }),

  // ─── Debug ───

  debugScenes: (projectId: string) =>
    request<SceneDebugResponse>(`/scene/debug/scenes/${projectId}`),

  debugPsychology: (projectId: string) =>
    request<{ psychologyLedger: UserPsychologyLedger | null }>(`/scene/debug/psychology/${projectId}`),

  // ─── Upstream Discovery ───

  /** List all available plot sessions (for upstream selection) */
  listPlotSessions: () =>
    request<{
      sessions: Array<{
        projectId: string;
        worldProjectId: string;
        characterProjectId: string;
        characterImageProjectId?: string;
        hookProjectId: string;
        status: string;
        turnCount: number;
        hasExport: boolean;
      }>;
    }>("/plot/export-session/list").catch(() =>
      // Fallback: plot module doesn't have list-sessions yet, use manual approach
      ({ sessions: [] })
    ),

  /** List available scene sessions */
  listSceneSessions: () =>
    request<{
      sessions: Array<{
        projectId: string;
        plotProjectId: string;
        status: string;
        planningTurnCount: number;
        writingTurnCount: number;
        builtSceneCount: number;
        totalScenes: number;
        hasExport: boolean;
      }>;
    }>("/scene/list-sessions"),

  /** Get a plot session to resolve upstream chain */
  getPlotSession: (plotProjectId: string) =>
    request<any>(`/plot/${plotProjectId}`),
};
