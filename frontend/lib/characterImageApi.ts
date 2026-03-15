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
  EngineInsightsResponse,
} from "../../shared/types/api";
import type { UserPsychologyLedger } from "../../shared/types/userPsychology";
import { request } from "./apiClient";

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
    request<EngineInsightsResponse>(`/character-image/debug/insights/${projectId}`),

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
