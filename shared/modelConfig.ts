export type HookRole = "clarifier" | "builder" | "judge" | "summary";

export interface ModelConfig {
  clarifier: string;
  builder: string;
  judge: string;
  summary: string;
}

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  clarifier: "claude-sonnet-4-6",
  builder: "claude-sonnet-4-6",
  judge: "claude-sonnet-4-6",
  summary: "claude-sonnet-4-6",
};

export const SUPPORTED_MODELS = [
  "claude-sonnet-4-6",              // Sonnet 4.6 (latest Sonnet, default)
  "claude-sonnet-4-5-20250929",     // Sonnet 4.5
  "claude-sonnet-4-20250514",       // Sonnet 4.0
  "claude-opus-4-6",                // Opus 4.6 (most capable)
  "claude-haiku-4-5-20251001",      // Haiku 4.5 (fastest/cheapest)
] as const;
