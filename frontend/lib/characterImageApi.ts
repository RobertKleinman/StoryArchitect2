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

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
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
    }),

  reroll: (projectId: string, promptOverrides?: { builder?: CharacterImagePromptOverrides; judge?: CharacterImagePromptOverrides }) =>
    request<CharacterImageGenerateResponse>("/character-image/reroll", {
      method: "POST",
      body: JSON.stringify({ projectId, promptOverrides }),
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
