/**
 * LLM EMOTION MAPPER
 * ══════════════════
 * Maps freeform emotions to VNBuilder's 8 expressions using a cheap LLM call.
 * Results are cached in data/postproduction/emotion-cache.json so the same
 * emotion never needs re-mapping.
 *
 * One batched call per run — typically Haiku, <1 cent.
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import type { PostproductionConfig } from "./types";
import { callLLM } from "./llm";

const VN_EXPRESSIONS = ["neutral", "angry", "sad", "tense", "warm", "amused", "calm", "formal"] as const;
type VNExpression = typeof VN_EXPRESSIONS[number];

const CACHE_PATH = "./data/postproduction/emotion-cache.json";

/**
 * Last-resort inference for emotions that the LLM mapped to "neutral" but probably shouldn't be.
 * Uses keyword matching on the emotion string itself to find a better fit.
 */
function inferNonNeutralExpression(emotion: string): VNExpression | null {
  const e = emotion.toLowerCase();

  // Warm family
  if (/warm|tender|intimate|gentle|affection|yearn|fond|soft|vulnerab|ache|longing/.test(e)) return "warm";

  // Tense family
  if (/tense|anxi|guard|wary|alert|edge|apprehen|uneasy|nervous|dread|fear|vigilant|brace/.test(e)) return "tense";

  // Sad family
  if (/sad|grief|hollow|resign|melanchol|sorrow|loss|mourn|despair|empty|numb|exhaust/.test(e)) return "sad";

  // Angry family
  if (/angry|bitter|frustr|resent|hostil|fury|rage|irritat|contempt|disgust/.test(e)) return "angry";

  // Calm family
  if (/calm|peace|serene|settled|accept|content|still|quiet|composed/.test(e)) return "calm";

  // Formal family
  if (/formal|precise|clinical|procedur|measure|deliber|offici|detach/.test(e)) return "formal";

  // Amused family
  if (/amus|wry|iron|sardonic|dry|humor/.test(e)) return "amused";

  return null;
}

/** Load cached mappings (or empty object if no cache) */
async function loadCache(): Promise<Record<string, VNExpression>> {
  try {
    return JSON.parse(await readFile(CACHE_PATH, "utf-8"));
  } catch {
    return {};
  }
}

/** Save cache to disk */
async function saveCache(cache: Record<string, VNExpression>): Promise<void> {
  await mkdir("./data/postproduction", { recursive: true });
  await writeFile(CACHE_PATH, JSON.stringify(cache, null, 2), "utf-8");
}

/**
 * Given a list of freeform emotions, return a mapping to VN expressions.
 * Cached emotions are returned instantly. Uncached ones are batched into
 * a single LLM call.
 */
export async function mapEmotionsWithLLM(
  emotions: string[],
  config?: PostproductionConfig,
): Promise<Record<string, VNExpression>> {
  const cache = await loadCache();
  const unique = [...new Set(emotions.map(e => e.toLowerCase().trim()))];
  const uncached = unique.filter(e => e && !cache[e]);

  if (uncached.length === 0) {
    return cache;
  }

  // Resolve LLM config
  const llm = config?.llm ?? {
    provider: "anthropic" as const,
    baseUrl: "https://api.anthropic.com/v1",
    apiKey: process.env.ANTHROPIC_API_KEY ?? "",
    editorialModel: "", verifyModel: "",
    emotionModel: "claude-haiku-4-5-20251001",
    dualModel: false, secondary: null, systemPromptSuffix: "",
  };

  if (!llm.apiKey) {
    console.warn("[emotion-mapper] No API key — skipping LLM mapping");
    return cache;
  }

  console.log(`[emotion-mapper] Mapping ${uncached.length} new emotions via ${llm.emotionModel}...`);

  const systemPrompt = `You map fictional character emotions to display expressions. The target expressions are exactly: ${VN_EXPRESSIONS.join(", ")}.

Rules:
- Every emotion MUST map to exactly one of the 8 expressions
- "neutral" should ONLY be used for genuinely neutral moments — scene-setting, flat exposition, zero emotional content. If ANY emotional content is present, use a more specific expression.
- When in doubt between "neutral" and anything else, ALWAYS pick the non-neutral option
- When in doubt between two non-neutral options, pick the more expressive one
- "controlled_X" / "compressed_X" / "masked_X" → map based on the X part (the underlying emotion, not the mask)
- "cold_X" usually → tense or angry
- "precise_X" / "clinical_X" / "procedural_X" → formal
- "grief" / "hollow" / "desperate" / "resigned" → sad
- "fury" / "rage" / "hostility" / "bitter" → angry
- "vulnerable" / "tender" / "intimate" / "affectionate" / "yearning" → warm
- "anxious" / "guarded" / "wary" / "on_edge" / "apprehensive" → tense
- "dry" / "sardonic" / "wry" / "ironic" → amused
- Compound emotions like "angry but controlled" → map to the dominant emotion (angry), not the control (formal)
- If the emotion describes a physical state without emotion (e.g., "still", "quiet"), consider the likely emotional context — stillness from fear is tense, stillness from calm is calm
- Respond ONLY with a JSON object mapping each emotion to its expression. No other text.`;

  const userPrompt = `Map each emotion to one of: ${VN_EXPRESSIONS.join(", ")}\n\n${JSON.stringify(uncached)}`;

  let text: string;
  try {
    text = await callLLM(
      llm.provider, llm.baseUrl, llm.apiKey,
      systemPrompt, userPrompt, llm.emotionModel, 0.3, 4000,
    );
  } catch (err: any) {
    console.warn(`[emotion-mapper] LLM error: ${err.message}`);
    return cache;
  }
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.warn("[emotion-mapper] LLM did not return JSON");
    return cache;
  }

  const mappings = JSON.parse(jsonMatch[0]) as Record<string, string>;

  // Validate and merge into cache
  let added = 0;
  let neutralOverrides = 0;
  for (const [emotion, expression] of Object.entries(mappings)) {
    const lower = emotion.toLowerCase().trim();
    if ((VN_EXPRESSIONS as readonly string[]).includes(expression)) {
      // Override neutral for emotions that clearly aren't neutral
      // The LLM sometimes defaults to neutral for ambiguous compound emotions
      let finalExpression = expression as VNExpression;
      if (finalExpression === "neutral" && lower !== "neutral" && lower !== "none" && lower !== "flat") {
        // Try to infer a better mapping from the emotion text itself
        const inferredFromText = inferNonNeutralExpression(lower);
        if (inferredFromText) {
          finalExpression = inferredFromText;
          neutralOverrides++;
        }
      }
      cache[lower] = finalExpression;
      added++;
    } else {
      console.warn(`[emotion-mapper] Invalid expression "${expression}" for "${emotion}" — skipping`);
    }
  }
  if (neutralOverrides > 0) {
    console.log(`[emotion-mapper] Overrode ${neutralOverrides} neutral mappings with more expressive alternatives`);
  }

  await saveCache(cache);
  console.log(`[emotion-mapper] Cached ${added} new mappings (${Object.keys(cache).length} total)`);

  return cache;
}
