/**
 * Shared utility: builds a compact "MUST HONOR" constraint reinforcement block
 * that goes at the END of prompts (highest attention zone for LLMs).
 *
 * Works with any ledger entry type that has `key`, `value`, and `confidence` fields.
 */

interface LedgerEntryLike {
  key: string;
  value: string;
  confidence: string;
}

/**
 * Build a compact MUST HONOR block from confirmed constraint ledger entries.
 * Returns empty string if there are no confirmed entries.
 */
export function buildMustHonorBlock(ledger: LedgerEntryLike[]): string {
  const confirmed = ledger.filter((e) => e.confidence === "confirmed");
  if (confirmed.length === 0) return "";

  const lines = confirmed.map((e) => `${e.key.toUpperCase()}: ${e.value}`);
  return `\u2550\u2550\u2550 MUST HONOR \u2014 CONFIRMED FACTS (do NOT contradict) \u2550\u2550\u2550\n${lines.join("\n")}`;
}

/**
 * Normalize stringified JSON fields in an LLM response.
 * Some fields (user_read, scope_recommendation) are defined as `{ type: "string" }`
 * in the JSON schema to keep the compiled grammar small, but the model outputs
 * them as JSON strings. This function parses them back into objects.
 */
export function normalizeStringifiedFields(parsed: Record<string, unknown>): void {
  for (const key of ["user_read", "scope_recommendation"]) {
    const val = parsed[key];
    if (typeof val === "string" && val.length > 0) {
      try {
        parsed[key] = JSON.parse(val);
      } catch {
        // If parsing fails, null it out so downstream code skips it gracefully
        parsed[key] = null;
      }
    }
  }
}
