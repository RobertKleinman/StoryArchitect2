export type HookRole = "clarifier" | "builder" | "judge" | "summary" | "polish"
  | "char_clarifier" | "char_builder" | "char_judge" | "char_polish" | "char_summary"
  | "img_clarifier" | "img_builder" | "img_judge" | "img_summary";

export interface ModelConfig {
  clarifier: string;
  builder: string;
  judge: string;
  summary: string;
  polish: string;
  char_clarifier: string;
  char_builder: string;
  char_judge: string;
  char_polish: string;
  char_summary: string;
  img_clarifier: string;
  img_builder: string;
  img_judge: string;
  img_summary: string;
}

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  clarifier: "claude-sonnet-4-6",
  builder: "claude-sonnet-4-6",
  judge: "claude-sonnet-4-6",
  summary: "claude-sonnet-4-6",
  polish: "claude-sonnet-4-6",
  char_clarifier: "claude-sonnet-4-6",
  char_builder: "claude-sonnet-4-6",
  char_judge: "claude-sonnet-4-6",
  char_polish: "claude-sonnet-4-6",
  char_summary: "claude-sonnet-4-6",
  img_clarifier: "claude-sonnet-4-6",
  img_builder: "claude-sonnet-4-6",
  img_judge: "claude-sonnet-4-6",
  img_summary: "claude-sonnet-4-6",
};

export const SUPPORTED_MODELS = [
  "claude-sonnet-4-6",              // Sonnet 4.6 (latest Sonnet, default)
  "claude-sonnet-4-5-20250929",     // Sonnet 4.5
  "claude-sonnet-4-20250514",       // Sonnet 4.0
  "claude-opus-4-6",                // Opus 4.6 (most capable)
  "claude-haiku-4-5-20251001",      // Haiku 4.5 (fastest/cheapest)
] as const;
