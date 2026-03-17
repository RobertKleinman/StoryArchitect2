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
