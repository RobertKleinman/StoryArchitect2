/**
 * ANIME-GEN HTTP CLIENT
 * ═════════════════════
 * Thin wrapper around the local anime image generator FastAPI backend.
 * The anime-gen app (Python + ComfyUI) runs independently at localhost:8001.
 * We call its REST API — we never modify its code.
 *
 * Endpoints mirrored:
 *   GET  /api/status         → is ComfyUI running?
 *   GET  /api/models         → available checkpoints, LoRAs, VAEs, upscalers
 *   GET  /api/presets        → quality presets (lightning/fast/balanced/quality)
 *   GET  /api/model-settings → per-checkpoint optimal settings
 *   POST /api/generate       → generate image (returns base64 PNG)
 *   POST /api/enhance        → preview prompt enhancement without generating
 */

export interface AnimeGenStatus {
  connected: boolean;
}

export interface AnimeGenModels {
  checkpoints: string[];
  loras: string[];
  vaes: string[];
  upscalers: string[];
  controlnets?: string[];
}

export interface AnimeGenPreset {
  steps: number;
  cfg: number;
  sampler_name: string;
  scheduler: string;
  hires: boolean;
  label: string;
}

export interface AnimeGenModelSettings {
  family: string;
  name: string;
  built_in_vae: boolean;
  optimal_cfg: [number, number];
  recommended_steps?: number;
  positive_tips: string;
  negative_tips: string;
  presets: Record<string, AnimeGenPreset>;
  lightning_lora: { filename: string; steps: number } | null;
}

export interface AnimeGenGenerateParams {
  prompt: string;
  checkpoint: string;
  lora?: string | null;
  lora_strength?: number;
  lora_trigger?: string | null;
  quality?: string;
  width?: number;
  height?: number;
  seed?: number;
  vae?: string | null;
  upscaler?: string | null;
}

export interface AnimeGenGenerateResult {
  image: string;           // base64 PNG
  format: string;
  enhanced_prompt: string;
  negative_prompt: string;
}

export interface AnimeGenEnhanceResult {
  original: string;
  positive: string;
  negative: string;
}

export class AnimeGenClient {
  private baseUrl: string;
  /** 5-minute timeout for image generation */
  private genTimeoutMs = 300_000;
  /** 10-second timeout for info endpoints */
  private infoTimeoutMs = 10_000;
  /** Max retries for transient errors */
  private maxRetries = 2;

  constructor(baseUrl = "http://localhost:8001") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  // ─── Info endpoints ───

  async checkStatus(): Promise<AnimeGenStatus> {
    try {
      const res = await this.fetchWithTimeout("GET", "/api/status", undefined, this.infoTimeoutMs);
      return res as AnimeGenStatus;
    } catch {
      return { connected: false };
    }
  }

  async getModels(): Promise<AnimeGenModels> {
    return this.fetchWithTimeout("GET", "/api/models", undefined, this.infoTimeoutMs) as Promise<AnimeGenModels>;
  }

  async getPresets(): Promise<Record<string, AnimeGenPreset>> {
    return this.fetchWithTimeout("GET", "/api/presets", undefined, this.infoTimeoutMs) as Promise<Record<string, AnimeGenPreset>>;
  }

  async getModelSettings(checkpoint: string): Promise<AnimeGenModelSettings> {
    const qs = encodeURIComponent(checkpoint);
    return this.fetchWithTimeout("GET", `/api/model-settings?checkpoint=${qs}`, undefined, this.infoTimeoutMs) as Promise<AnimeGenModelSettings>;
  }

  // ─── Generation endpoints ───

  async generateImage(params: AnimeGenGenerateParams): Promise<AnimeGenGenerateResult> {
    return this.fetchWithRetry("POST", "/api/generate", params, this.genTimeoutMs) as Promise<AnimeGenGenerateResult>;
  }

  async enhancePrompt(prompt: string): Promise<AnimeGenEnhanceResult> {
    return this.fetchWithTimeout("POST", "/api/enhance", { prompt }, this.infoTimeoutMs) as Promise<AnimeGenEnhanceResult>;
  }

  // ─── Internal ───

  private async fetchWithTimeout(
    method: string,
    path: string,
    body?: unknown,
    timeoutMs = this.infoTimeoutMs
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`anime-gen ${method} ${path} returned ${res.status}: ${text}`);
      }

      return await res.json();
    } catch (err: any) {
      if (err.name === "AbortError") {
        throw new Error(`anime-gen ${method} ${path} timed out after ${timeoutMs}ms. Is ComfyUI running?`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetchWithRetry(
    method: string,
    path: string,
    body?: unknown,
    timeoutMs = this.genTimeoutMs
  ): Promise<unknown> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.fetchWithTimeout(method, path, body, timeoutMs);
      } catch (err: any) {
        lastError = err;
        const msg = err.message ?? "";
        // Retry on transient errors (429, 500, 503)
        const isRetryable = msg.includes("429") || msg.includes("500") || msg.includes("503");
        if (!isRetryable || attempt === this.maxRetries) throw err;
        // Exponential backoff: 2s, 4s
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      }
    }

    throw lastError ?? new Error("fetchWithRetry failed");
  }
}
