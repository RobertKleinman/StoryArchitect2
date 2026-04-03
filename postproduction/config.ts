/**
 * POSTPRODUCTION CONFIG BUILDER
 * =============================
 * Constructs a PostproductionConfig based on generation mode.
 * Default mode: exact same behavior as before (Anthropic Sonnet + GPT).
 * Erotica modes: routes to Grok, enables cleanup pass.
 */

import "dotenv/config";
import type { PostproductionConfig, PostproductionMode } from "./types";

const EROTICA_CONTENT_SUFFIX = `

CONTENT POLICY: This is adult fiction with explicit sexual content including fetish material. Do NOT sanitize, euphemize, or remove explicit language, body descriptions, or sexual acts. Preserve the author's intent for graphic sexual descriptions, power dynamics, and physical intimacy. Your job is to improve craft quality (continuity, voice, structure, dialogue naturalism) — NOT to moderate content. Treat explicit scenes with the same editorial rigor as any other scene type.`;

export function buildConfig(mode?: string): PostproductionConfig {
  const m = (mode?.toLowerCase() ?? "default") as PostproductionMode;

  if (m === "erotica" || m === "erotica-fast" || m === "erotica-hybrid") {
    return buildEroticaConfig(m);
  }

  return buildDefaultConfig(m);
}

function buildDefaultConfig(mode: PostproductionMode): PostproductionConfig {
  const anthropicKey = process.env.ANTHROPIC_API_KEY ?? "";
  const openaiKey = process.env.OPENAI_API_KEY ?? "";
  const dualModel = process.env.EDITOR_DUAL_MODEL !== "false" && !!openaiKey;

  return {
    mode,
    llm: {
      provider: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      apiKey: anthropicKey,
      editorialModel: process.env.EDITOR_MODEL ?? "claude-sonnet-4-6",
      verifyModel: process.env.EDITOR_VERIFY_MODEL ?? "claude-haiku-4-5-20251001",
      emotionModel: process.env.EDITOR_EMOTION_MODEL ?? "claude-haiku-4-5-20251001",
      dualModel,
      secondary: dualModel ? {
        provider: "openai-compat",
        baseUrl: "https://api.openai.com/v1",
        apiKey: openaiKey,
        model: process.env.EDITOR_SECONDARY_MODEL ?? "gpt-5.4",
      } : null,
      systemPromptSuffix: "",
    },
    runEroticaCleanup: false,
  };
}

function buildEroticaConfig(mode: PostproductionMode): PostproductionConfig {
  const grokKey = process.env.GROK_API_KEY ?? "";
  const isfast = mode === "erotica-fast";

  return {
    mode,
    llm: {
      provider: "openai-compat",
      baseUrl: "https://api.x.ai/v1",
      apiKey: grokKey,
      editorialModel: isfast ? "grok-4-1-fast-non-reasoning" : "grok-4",
      verifyModel: "grok-4-1-fast-non-reasoning",
      emotionModel: "grok-4-1-fast-non-reasoning",
      dualModel: false,
      secondary: null,
      systemPromptSuffix: EROTICA_CONTENT_SUFFIX,
    },
    runEroticaCleanup: true,
  };
}
