/**
 * Context observability — logs token count estimates per prompt block.
 *
 * Uses a rough 4-chars-per-token heuristic (accurate enough for observability).
 * The goal is to identify which context blocks are fattest, not exact counts.
 */

/** Rough token estimate: ~4 chars per token for English text */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

interface PromptBlock {
  name: string;
  content: string;
  /** Whether this block was actually injected (vs skipped/empty) */
  injected: boolean;
}

/**
 * Log token estimates for each block in a prompt assembly.
 * Call after building the prompt, passing all blocks that were considered.
 */
export function logPromptBlocks(
  role: string,
  module: string,
  blocks: PromptBlock[],
): void {
  const injected = blocks.filter(b => b.injected);
  const omitted = blocks.filter(b => !b.injected);
  const totalTokens = injected.reduce((sum, b) => sum + estimateTokens(b.content), 0);

  const blockDetails = injected
    .map(b => `${b.name}=${estimateTokens(b.content)}`)
    .join(" ");

  const omittedNames = omitted.length > 0
    ? ` | omitted: ${omitted.map(b => b.name).join(", ")}`
    : "";

  console.log(
    `[context] ${module}/${role} | ~${totalTokens} tokens across ${injected.length} blocks | ${blockDetails}${omittedNames}`,
  );
}

/**
 * Convenience: estimate tokens for a single block.
 * Returns 0 for empty/null/undefined.
 */
export function tokenEstimate(text: string | null | undefined): number {
  if (!text) return 0;
  return estimateTokens(text);
}

// ─── Selective Context Compression ──────────────────────────────────

/**
 * Given a set of prompt blocks, identify the N fattest and compress them
 * using distillation strategies specific to each block type.
 *
 * Returns compressed blocks. Non-compressible blocks pass through unchanged.
 */
export function compressPromptBlocks(
  blocks: PromptBlock[],
  options?: { maxBlocksToCompress?: number; tokenBudget?: number },
): PromptBlock[] {
  const maxCompress = options?.maxBlocksToCompress ?? 3;

  // Sort by token count (largest first) and pick top N for compression
  const ranked = blocks
    .filter(b => b.injected)
    .map(b => ({ block: b, tokens: estimateTokens(b.content) }))
    .sort((a, b) => b.tokens - a.tokens);

  const toCompress = new Set(ranked.slice(0, maxCompress).map(r => r.block.name));

  return blocks.map(b => {
    if (!b.injected || !toCompress.has(b.name)) return b;

    const compressed = compressBlock(b);
    if (compressed !== b.content) {
      const before = estimateTokens(b.content);
      const after = estimateTokens(compressed);
      console.log(`[context-compress] ${b.name}: ${before} → ${after} tokens (${Math.round((1 - after / before) * 100)}% reduction)`);
    }
    return { ...b, content: compressed };
  });
}

/**
 * Compress a single block based on its name/type.
 * Returns compressed content or original if no compression strategy applies.
 */
function compressBlock(block: PromptBlock): string {
  const { name, content } = block;

  // Character profiles: strip visual anchors and long descriptions, keep name/role/personality
  if (name.includes("character") && !name.includes("visual")) {
    return compressJsonArray(content, (char: any) => ({
      role: char.role,
      name: char.name,
      personality_core: char.personality_core ?? char.personality,
      presentation: char.presentation,
      key_trait: char.key_trait ?? char.archetype,
      motivation: char.motivation,
      // Drop: full description, backstory paragraphs, all_traits arrays
    }));
  }

  // World context: condense to key world facts
  if (name.includes("world")) {
    return compressJsonObject(content, (world: any) => ({
      setting_summary: world.setting_summary ?? world.setting,
      tone: world.tone,
      rules: world.rules,
      cultural_elements: world.cultural_elements,
      // Drop: detailed location lists, historical timelines
    }));
  }

  // Previous scenes / built scenes: keep only digests, drop full text
  if (name.includes("scene") && name.includes("prev")) {
    return compressJsonArray(content, (scene: any) => ({
      scene_id: scene.scene_id,
      title: scene.title,
      digest: scene.digest,
      // Drop: full screenplay_text, all VN lines
    }));
  }

  return content; // no compression strategy for this block type
}

/**
 * Compress character profiles for builder prompt: keep essential fields, drop verbose descriptions.
 */
export function compressCharacterProfilesJson(json: string): string {
  return compressJsonObject(json, (chars: any) => {
    if (typeof chars !== "object") return chars;
    const result: any = {};
    for (const [role, char] of Object.entries(chars) as [string, any][]) {
      result[role] = {
        role: char.role,
        name: char.name,
        personality_core: char.personality_core ?? char.personality,
        presentation: char.presentation,
        archetype: char.archetype,
        motivation: char.motivation,
        age_range: char.age_range,
        // Drop: full description paragraphs, all_traits, backstory
      };
    }
    return result;
  });
}

function compressJsonArray(content: string, mapper: (item: any) => any): string {
  try {
    const arr = JSON.parse(content);
    if (!Array.isArray(arr)) return content;
    return JSON.stringify(arr.map(mapper), null, 1);
  } catch {
    return content;
  }
}

function compressJsonObject(content: string, mapper: (obj: any) => any): string {
  try {
    const obj = JSON.parse(content);
    if (typeof obj !== "object" || Array.isArray(obj)) return content;
    return JSON.stringify(mapper(obj), null, 1);
  } catch {
    return content;
  }
}
