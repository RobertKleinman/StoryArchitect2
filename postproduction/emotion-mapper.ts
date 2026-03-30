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

const VN_EXPRESSIONS = ["neutral", "angry", "sad", "tense", "warm", "amused", "calm", "formal"] as const;
type VNExpression = typeof VN_EXPRESSIONS[number];

const CACHE_PATH = "./data/postproduction/emotion-cache.json";

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
): Promise<Record<string, VNExpression>> {
  const cache = await loadCache();
  const unique = [...new Set(emotions.map(e => e.toLowerCase().trim()))];
  const uncached = unique.filter(e => e && !cache[e]);

  if (uncached.length === 0) {
    return cache;
  }

  // Batch call to Haiku
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("[emotion-mapper] No ANTHROPIC_API_KEY — skipping LLM mapping");
    return cache;
  }

  console.log(`[emotion-mapper] Mapping ${uncached.length} new emotions via Haiku...`);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4000,
      system: `You map fictional character emotions to display expressions. The target expressions are exactly: ${VN_EXPRESSIONS.join(", ")}.

Rules:
- Every emotion MUST map to exactly one of the 8 expressions
- When in doubt between two, pick the more expressive one (not neutral)
- "controlled_X" / "compressed_X" → map based on the X part
- "cold_X" usually → tense or angry
- "precise_X" / "clinical_X" / "procedural_X" → formal
- "grief" / "hollow" / "desperate" → sad
- "fury" / "rage" / "hostility" → angry
- Respond ONLY with a JSON object mapping each emotion to its expression. No other text.`,
      messages: [{
        role: "user",
        content: `Map each emotion to one of: ${VN_EXPRESSIONS.join(", ")}\n\n${JSON.stringify(uncached)}`,
      }],
    }),
  });

  const data = await res.json() as any;
  if (data.error) {
    console.warn(`[emotion-mapper] LLM error: ${JSON.stringify(data.error)}`);
    return cache;
  }

  const text = data.content?.[0]?.text ?? "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.warn("[emotion-mapper] LLM did not return JSON");
    return cache;
  }

  const mappings = JSON.parse(jsonMatch[0]) as Record<string, string>;

  // Validate and merge into cache
  let added = 0;
  for (const [emotion, expression] of Object.entries(mappings)) {
    const lower = emotion.toLowerCase().trim();
    if ((VN_EXPRESSIONS as readonly string[]).includes(expression)) {
      cache[lower] = expression as VNExpression;
      added++;
    } else {
      console.warn(`[emotion-mapper] Invalid expression "${expression}" for "${emotion}" — skipping`);
    }
  }

  await saveCache(cache);
  console.log(`[emotion-mapper] Cached ${added} new mappings (${Object.keys(cache).length} total)`);

  return cache;
}
