// ── Provider & Model Types ──────────────────────────────────────────

export type LLMProvider = "anthropic" | "openai" | "gemini" | "grok";

export type HookRole = "clarifier" | "builder" | "judge" | "summary" | "polish"
  | "char_clarifier" | "char_builder" | "char_judge" | "char_polish" | "char_summary"
  | "img_clarifier" | "img_builder" | "img_judge" | "img_summary"
  | "world_clarifier" | "world_builder" | "world_judge" | "world_polish" | "world_summary";

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
  world_clarifier: string;
  world_builder: string;
  world_judge: string;
  world_polish: string;
  world_summary: string;
}

// ── Provider detection from model string ────────────────────────────

export function detectProvider(model: string): LLMProvider {
  if (model.startsWith("claude-")) return "anthropic";
  if (model.startsWith("gpt-") || model.startsWith("o4-") || model.startsWith("o3-") || model.startsWith("o1-")) return "openai";
  if (model.startsWith("gemini-")) return "gemini";
  if (model.startsWith("grok-")) return "grok";
  // Default to anthropic for unknown models (backwards compat)
  return "anthropic";
}

// ── Supported models per provider ───────────────────────────────────

export interface ProviderModelEntry {
  id: string;
  label: string;
  provider: LLMProvider;
  tier: "fast" | "balanced" | "powerful";
}

export const PROVIDER_MODELS: ProviderModelEntry[] = [
  // Anthropic (Claude) — current as of March 2026
  { id: "claude-sonnet-4-6",              label: "Claude Sonnet 4.6",   provider: "anthropic", tier: "balanced" },
  { id: "claude-opus-4-6",                label: "Claude Opus 4.6",     provider: "anthropic", tier: "powerful" },
  { id: "claude-haiku-4-5-20251001",      label: "Claude Haiku 4.5",    provider: "anthropic", tier: "fast" },

  // OpenAI — GPT-5 series (GPT-4.1 deprecated Feb 2026)
  { id: "gpt-5.4",                        label: "GPT-5.4",             provider: "openai", tier: "powerful" },
  { id: "gpt-5.4-pro",                    label: "GPT-5.4 Pro",         provider: "openai", tier: "powerful" },

  // Google Gemini — 3.x series (2.5 generation deprecated)
  { id: "gemini-3.1-pro-preview",         label: "Gemini 3.1 Pro",      provider: "gemini", tier: "powerful" },
  { id: "gemini-3-flash-preview",         label: "Gemini 3 Flash",      provider: "gemini", tier: "fast" },

  // Grok (xAI) — Grok 4 series (uses OpenAI-compatible API)
  { id: "grok-4",                         label: "Grok 4",              provider: "grok", tier: "powerful" },
  { id: "grok-4-fast",                    label: "Grok 4 Fast",         provider: "grok", tier: "fast" },
  { id: "grok-4-1-fast-reasoning",        label: "Grok 4.1 Fast",       provider: "grok", tier: "balanced" },
];

/** Flat list of model IDs for validation */
export const SUPPORTED_MODELS = PROVIDER_MODELS.map(m => m.id);

/** Group models by provider for UI dropdowns */
export function modelsByProvider(): Record<LLMProvider, ProviderModelEntry[]> {
  const grouped: Record<LLMProvider, ProviderModelEntry[]> = {
    anthropic: [],
    openai: [],
    gemini: [],
    grok: [],
  };
  for (const m of PROVIDER_MODELS) {
    grouped[m.provider].push(m);
  }
  return grouped;
}

// ── Role classification helpers ─────────────────────────────────────

/** All judge roles across every module */
export const JUDGE_ROLES: ReadonlyArray<keyof ModelConfig> = [
  "judge", "char_judge", "img_judge", "world_judge",
];

/** All non-judge (creative) roles across every module */
export const CREATIVE_ROLES: ReadonlyArray<keyof ModelConfig> = [
  "clarifier", "builder", "summary", "polish",
  "char_clarifier", "char_builder", "char_polish", "char_summary",
  "img_clarifier", "img_builder", "img_summary",
  "world_clarifier", "world_builder", "world_polish", "world_summary",
];

/** Build a partial ModelConfig setting all judge roles to one model */
export function judgeConfig(modelId: string): Partial<ModelConfig> {
  const cfg: Partial<ModelConfig> = {};
  for (const role of JUDGE_ROLES) cfg[role] = modelId;
  return cfg;
}

/** Build a partial ModelConfig setting all creative roles to one model */
export function creativeConfig(modelId: string): Partial<ModelConfig> {
  const cfg: Partial<ModelConfig> = {};
  for (const role of CREATIVE_ROLES) cfg[role] = modelId;
  return cfg;
}

// ── Default config ──────────────────────────────────────────────────

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
  world_clarifier: "claude-sonnet-4-6",
  world_builder: "claude-sonnet-4-6",
  world_judge: "claude-sonnet-4-6",
  world_polish: "claude-sonnet-4-6",
  world_summary: "claude-sonnet-4-6",
};
