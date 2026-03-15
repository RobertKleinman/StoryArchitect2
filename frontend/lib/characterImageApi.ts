import type {
  CharacterImageAssumptionResponse,
  CharacterImagePromptOverrides,
  CharacterImageSessionState,
  CharacterImagePack,
  CharacterImagePromptPreview,
  GeneratedCharacterImage,
} from "../../shared/types/characterImage";
import type {
  CharacterImageClarifyResponse,
  CharacterImageGenerateResponse,
  CharacterImageGenerateImagesResponse,
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

export const characterImageApi = {
  clarify: (body: {
    projectId: string;
    characterProjectId: string;
    userSelection?: { type: string; optionId?: string; label: string };
    assumptionResponses?: CharacterImageAssumptionResponse[];
    promptOverrides?: CharacterImagePromptOverrides;
    visualSeed?: string;
  }) =>
    request<CharacterImageClarifyResponse>("/character-image/clarify", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  generate: (projectId: string, promptOverrides?: { builder?: CharacterImagePromptOverrides; judge?: CharacterImagePromptOverrides }) =>
    request<CharacterImageGenerateResponse>("/character-image/generate", {
      method: "POST",
      body: JSON.stringify({ projectId, promptOverrides }),
      timeoutMs: 360_000, // 6 min — builder + judge
    }),

  reroll: (projectId: string, promptOverrides?: { builder?: CharacterImagePromptOverrides; judge?: CharacterImagePromptOverrides }) =>
    request<CharacterImageGenerateResponse>("/character-image/reroll", {
      method: "POST",
      body: JSON.stringify({ projectId, promptOverrides }),
      timeoutMs: 360_000,
    }),

  generateImages: (body: {
    projectId: string;
    checkpoint: string;
    lora?: string | null;
    quality?: string;
    seed?: number;
  }) =>
    request<CharacterImageGenerateImagesResponse>("/character-image/generate-images", {
      method: "POST",
      body: JSON.stringify(body),
      timeoutMs: 600_000, // 10 min — image gen can be slow for large casts
    }),

  applyVisualEdits: (projectId: string, edits: Record<string, Record<string, string>>) =>
    request<{ ok: true }>("/character-image/apply-visual-edits", {
      method: "POST",
      body: JSON.stringify({ projectId, edits }),
    }),

  setArtStyle: (projectId: string, style: string, customNote?: string) =>
    request<{ ok: true }>("/character-image/set-art-style", {
      method: "POST",
      body: JSON.stringify({ projectId, style, customNote }),
    }),

  approveImage: (projectId: string, role: string) =>
    request<GeneratedCharacterImage>("/character-image/approve-image", {
      method: "POST",
      body: JSON.stringify({ projectId, role }),
    }),

  redoImage: (projectId: string, role: string, seed?: number, overrides?: { checkpoint?: string; lora?: string; quality?: string }) =>
    request<GeneratedCharacterImage>("/character-image/redo-image", {
      method: "POST",
      body: JSON.stringify({ projectId, role, seed, ...overrides }),
    }),

  lock: (projectId: string) =>
    request<CharacterImagePack>("/character-image/lock", {
      method: "POST",
      body: JSON.stringify({ projectId }),
    }),

  getSession: (projectId: string) =>
    request<CharacterImageSessionState>(`/character-image/${projectId}`),

  previewPrompt: (body: {
    projectId: string;
    stage: "clarifier" | "builder" | "judge" | "summary";
  }) =>
    request<CharacterImagePromptPreview>("/character-image/preview-prompt", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  reset: (projectId: string) =>
    request<{ deleted: true }>(`/character-image/${projectId}`, { method: "DELETE" }),

  /** Check anime-gen app connectivity */
  checkAnimeGen: () =>
    request<{ connected: boolean }>("/character-image/anime-gen-status"),

  /** Get available models from anime-gen */
  getAnimeGenModels: () =>
    request<{ checkpoints: string[]; loras: string[]; vaes: string[] }>("/character-image/anime-gen-models"),

  /** Check if a character export exists for the given project ID */
  checkCharacterExport: (characterProjectId: string) =>
    request<any>(`/character/export-session/${characterProjectId}`),

  /** List all available character sessions (locked and unlocked) */
  debugPsychology: (projectId: string) =>
    request<{ psychologyLedger: UserPsychologyLedger | null }>(`/character-image/debug/psychology/${projectId}`),

  debugInsights: (projectId: string) =>
    request<import("../../shared/types/api").EngineInsightsResponse>(`/character-image/debug/insights/${projectId}`),

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
};
