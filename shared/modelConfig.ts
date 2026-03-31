// ── Provider & Model Types ──────────────────────────────────────────

export type LLMProvider = "anthropic" | "openai" | "gemini" | "grok";

// ── v2 Pipeline Roles (9 roles, down from 38) ──────────────────────

export type V2Role =
  | "intake"
  | "premise_writer"
  | "premise_judge"
  | "bible_writer"
  | "bible_judge"
  | "scene_planner"
  | "scene_writer"
  | "scene_judge"
  | "v2_cultural_researcher"
  | "v2_summarizer";

export interface V2ModelConfig {
  intake: string;
  premise_writer: string;
  premise_judge: string;
  bible_writer: string;
  bible_judge: string;
  scene_planner: string;
  scene_writer: string;
  scene_judge: string;
  v2_cultural_researcher: string;
  v2_summarizer: string;
}

// DEFAULT_V2_MODEL_CONFIG is defined after the STRONG/FAST tier constants below.

// ── v1 Pipeline Roles (legacy, 38 roles) ────────────────────────────

export type HookRole = "clarifier" | "builder" | "judge" | "summary" | "polish"
  | "char_clarifier" | "char_builder" | "char_judge" | "char_polish" | "char_summary"
  | "img_clarifier" | "img_builder" | "img_judge" | "img_summary"
  | "world_clarifier" | "world_builder" | "world_judge" | "world_polish" | "world_summary"
  | "plot_clarifier" | "plot_builder" | "plot_judge" | "plot_polish" | "plot_summary"
  | "scene_planner" | "scene_clarifier" | "scene_builder" | "scene_minor_judge" | "scene_final_judge" | "scene_divergence"
  | "psych_consolidator"
  | "divergence_explorer"
  | "cultural_summarizer"
  | "cultural_researcher"
  | "hook_escalation"
  | "grounding_researcher";

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
  plot_clarifier: string;
  plot_builder: string;
  plot_judge: string;
  plot_polish: string;
  plot_summary: string;
  scene_planner: string;
  scene_clarifier: string;
  scene_builder: string;
  scene_minor_judge: string;
  scene_final_judge: string;
  /** Scene-specific divergence — focused staging alternatives, not full 15-20 futures */
  scene_divergence: string;
  /** Background psychology consolidation — runs during user think-time */
  psych_consolidator: string;
  /** Background divergence explorer — generates direction map during user think-time */
  divergence_explorer: string;
  /** Cultural Intelligence Engine — compresses creative state */
  cultural_summarizer: string;
  /** Cultural Intelligence Engine — produces evidence briefs */
  cultural_researcher: string;
  /** Escalation mechanic — heightens user creative input (feature-flagged) */
  hook_escalation: string;
  /** Real-world grounding researcher — finds parallels from stable knowledge */
  grounding_researcher: string;
}

// ── Provider detection from model string ────────────────────────────

export function detectProvider(model: string): LLMProvider {
  if (model.startsWith("claude-")) return "anthropic";
  if (model.startsWith("gpt-") || model.startsWith("o4-") || model.startsWith("o3-") || model.startsWith("o1-")) return "openai";
  if (model.startsWith("gemini-")) return "gemini";
  if (model.startsWith("grok-")) return "grok";
  throw new Error(`Unknown model provider for model: "${model}". Supported prefixes: claude-, gpt-, o4-, o3-, o1-, gemini-, grok-`);
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
  { id: "gpt-5.4-mini",                   label: "GPT-5.4 Mini",        provider: "openai", tier: "fast" },
  { id: "gpt-5.4-nano",                   label: "GPT-5.4 Nano",        provider: "openai", tier: "fast" },

  // Google Gemini — 3.x series (2.5 generation deprecated)
  { id: "gemini-3.1-pro-preview",         label: "Gemini 3.1 Pro",      provider: "gemini", tier: "powerful" },
  { id: "gemini-3-flash-preview",         label: "Gemini 3 Flash",      provider: "gemini", tier: "fast" },

  // Grok (xAI) — Grok 4 series (uses OpenAI-compatible API)
  { id: "grok-4",                         label: "Grok 4",              provider: "grok", tier: "powerful" },
  { id: "grok-4-fast",                    label: "Grok 4 Fast",         provider: "grok", tier: "fast" },
  { id: "grok-4-1-fast-reasoning",        label: "Grok 4.1 Fast",       provider: "grok", tier: "balanced" },
  { id: "grok-4-1-fast-non-reasoning",   label: "Grok 4.1 Fast NR",    provider: "grok", tier: "fast" },
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
  "judge", "char_judge", "img_judge", "world_judge", "plot_judge", "scene_minor_judge", "scene_final_judge",
];

/** All non-judge (creative) roles across every module */
export const CREATIVE_ROLES: ReadonlyArray<keyof ModelConfig> = [
  "clarifier", "builder", "summary", "polish",
  "char_clarifier", "char_builder", "char_polish", "char_summary",
  "img_clarifier", "img_builder", "img_summary",
  "world_clarifier", "world_builder", "world_polish", "world_summary",
  "plot_clarifier", "plot_builder", "plot_polish", "plot_summary",
  "scene_planner", "scene_clarifier", "scene_builder", "scene_divergence",
  "psych_consolidator",
  "divergence_explorer",
  "cultural_summarizer",
  "cultural_researcher",
  "hook_escalation",
  "grounding_researcher",
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

// ── Tier constants (change these to retier the whole system) ─────────
const STRONG = "claude-sonnet-4-6";   // builders, judges, clarifiers — quality-critical
const FAST   = "claude-haiku-4-5-20251001";  // summaries, consolidator, most polish — comparative re-judge validated

// ── Background research models (based on v2 blind test results) ─────
// Primary models: best quality within 30s think-time window
// Diversity model: runs in parallel for extra angles, costs almost nothing
export const RESEARCH_PRIMARY_CULTURAL   = "gemini-3-flash-preview";
export const RESEARCH_PRIMARY_GROUNDING  = "gemini-3-flash-preview";
export const RESEARCH_PRIMARY_DIVERGENCE = "gpt-5.4-mini";
export const RESEARCH_DIVERSITY_MODEL    = "gpt-5.4-nano"; // 3-8s, cheapest tier

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  // Hook
  clarifier: STRONG,
  builder: STRONG,
  judge: STRONG,
  summary: FAST,
  polish: "gpt-5.4-mini",          // premise_polish: Mini wins 100% head-to-head vs Haiku
  // Character
  char_clarifier: STRONG,
  char_builder: STRONG,
  char_judge: STRONG,
  char_polish: "grok-4-1-fast-non-reasoning", // char_polish: Grok 4.1 wins 83% head-to-head
  char_summary: FAST,
  // Character Image
  img_clarifier: STRONG,
  img_builder: STRONG,
  img_judge: STRONG,
  img_summary: FAST,
  // World
  world_clarifier: STRONG,
  world_builder: STRONG,
  world_judge: STRONG,
  world_polish: FAST,               // world_polish: Haiku wins 83% head-to-head
  world_summary: FAST,
  // Plot
  plot_clarifier: STRONG,
  plot_builder: STRONG,
  plot_judge: STRONG,
  plot_polish: FAST,                // plot_polish: no comparative data — default to Haiku (safe)
  plot_summary: FAST,
  // Scene
  scene_planner: STRONG,
  scene_clarifier: STRONG,
  scene_builder: STRONG,
  scene_minor_judge: FAST,          // deterministic checks gate this; when it runs, fast is fine
  scene_final_judge: STRONG,        // one-time whole-work assessment — keep strong
  scene_divergence: FAST,           // Haiku wins 93% head-to-head vs Mini on scene_divergence
  // Background
  psych_consolidator: FAST,         // Haiku wins on accuracy — comparative confirmed 75% three-way tie
  divergence_explorer: RESEARCH_PRIMARY_DIVERGENCE,  // background — GPT-5.4 Mini (80% win rate, 3x faster than Haiku)
  // Cultural Intelligence Engine
  cultural_summarizer: FAST,        // Haiku wins 87% head-to-head — reverted from Nano
  cultural_researcher: RESEARCH_PRIMARY_CULTURAL,    // background — Gemini Flash (validated in original research tests)
  // Escalation
  hook_escalation: "gpt-5.4-nano",  // micro-call — plain text, any fast model works
  grounding_researcher: RESEARCH_PRIMARY_GROUNDING,  // background — Gemini Flash (validated in original research tests)
};

// ── v2 Default Model Config ─────────────────────────────────────────

export const DEFAULT_V2_MODEL_CONFIG: V2ModelConfig = {
  intake: STRONG,
  premise_writer: STRONG,
  premise_judge: STRONG,
  bible_writer: STRONG,
  bible_judge: STRONG,
  scene_planner: STRONG,
  scene_writer: STRONG,
  scene_judge: FAST,               // Haiku — structured evaluation against rubric, doesn't need Sonnet (was: STRONG)
  v2_cultural_researcher: RESEARCH_PRIMARY_CULTURAL,
  v2_summarizer: FAST,
};

/** All roles use Grok — for erotica/adult content where other models refuse */
export const EROTICA_V2_MODEL_CONFIG: V2ModelConfig = {
  intake: "grok-4",
  premise_writer: "grok-4",
  premise_judge: "grok-4",
  bible_writer: "grok-4",
  bible_judge: "grok-4",
  scene_planner: "grok-4",
  scene_writer: "grok-4",
  scene_judge: "grok-4-fast",
  v2_cultural_researcher: "grok-4-fast",
  v2_summarizer: "grok-4-fast",
};

/** All roles use Grok 4.1 Fast NR — cheap uncensored erotica, no reasoning overhead */
export const EROTICA_FAST_V2_MODEL_CONFIG: V2ModelConfig = {
  intake: "grok-4-1-fast-non-reasoning",
  premise_writer: "grok-4-1-fast-non-reasoning",
  premise_judge: "grok-4-1-fast-non-reasoning",
  bible_writer: "grok-4-1-fast-non-reasoning",
  bible_judge: "grok-4-1-fast-non-reasoning",
  scene_planner: "grok-4-1-fast-non-reasoning",
  scene_writer: "grok-4-1-fast-non-reasoning",
  scene_judge: "grok-4-1-fast-non-reasoning",
  v2_cultural_researcher: "grok-4-1-fast-non-reasoning",
  v2_summarizer: "grok-4-1-fast-non-reasoning",
};

/** All roles use Gemini Flash — cheapest/fastest for testing */
export const FAST_V2_MODEL_CONFIG: V2ModelConfig = {
  intake: "gemini-2.5-flash",
  premise_writer: "gemini-2.5-flash",
  premise_judge: "gemini-2.5-flash",
  bible_writer: "gemini-2.5-flash",
  bible_judge: "gemini-2.5-flash",
  scene_planner: "gemini-2.5-flash",
  scene_writer: "gemini-2.5-flash",
  scene_judge: "gemini-2.5-flash",
  v2_cultural_researcher: "gemini-2.5-flash",
  v2_summarizer: "gemini-2.5-flash",
};
