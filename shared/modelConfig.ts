// ── Provider & Model Types ──────────────────────────────────────────

export type LLMProvider = "anthropic" | "openai" | "gemini" | "grok";

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

// ── Provider detection from model string ────────────────────────────

export function detectProvider(model: string): LLMProvider {
  if (model.startsWith("claude-")) return "anthropic";
  if (model.startsWith("gpt-") || model.startsWith("o4-") || model.startsWith("o3-")) return "openai";
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
  // Anthropic (Claude)
  { id: "claude-sonnet-4-6",              label: "Claude Sonnet 4.6",   provider: "anthropic", tier: "balanced" },
  { id: "claude-sonnet-4-5-20250929",     label: "Claude Sonnet 4.5",   provider: "anthropic", tier: "balanced" },
  { id: "claude-sonnet-4-20250514",       label: "Claude Sonnet 4.0",   provider: "anthropic", tier: "balanced" },
  { id: "claude-opus-4-6",                label: "Claude Opus 4.6",     provider: "anthropic", tier: "powerful" },
  { id: "claude-haiku-4-5-20251001",      label: "Claude Haiku 4.5",    provider: "anthropic", tier: "fast" },

  // OpenAI
  { id: "gpt-4.1",                        label: "GPT-4.1",             provider: "openai", tier: "balanced" },
  { id: "gpt-4.1-mini",                   label: "GPT-4.1 Mini",        provider: "openai", tier: "fast" },
  { id: "gpt-4.1-nano",                   label: "GPT-4.1 Nano",        provider: "openai", tier: "fast" },
  { id: "o4-mini",                        label: "o4-mini (reasoning)",  provider: "openai", tier: "balanced" },

  // Google Gemini
  { id: "gemini-2.5-flash",               label: "Gemini 2.5 Flash",    provider: "gemini", tier: "fast" },
  { id: "gemini-2.5-pro",                 label: "Gemini 2.5 Pro",      provider: "gemini", tier: "powerful" },

  // Grok (xAI) — uses OpenAI-compatible API
  { id: "grok-3-beta",                    label: "Grok 3 Beta",         provider: "grok", tier: "powerful" },
  { id: "grok-3-mini-beta",              label: "Grok 3 Mini Beta",    provider: "grok", tier: "fast" },
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
};
