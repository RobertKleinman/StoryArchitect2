/**
 * Agent Pipeline — robust JSON extraction.
 *
 * Subagents produce text. We need to recover a JSON object from
 * that text even when they wrap it in markdown fences or add a
 * preamble. Strategy:
 *   1. Strip ```json … ``` or ``` … ``` fences
 *   2. Try JSON.parse on the whole thing
 *   3. Fall back to finding the first balanced {...} block
 *   4. Last resort: throw with a useful error
 */

export class AgentOutputParseError extends Error {
  constructor(message: string, public readonly raw: string) {
    super(message);
  }
}

export function extractJson(raw: string): unknown {
  if (!raw || typeof raw !== "string") {
    throw new AgentOutputParseError("Empty or non-string output", String(raw));
  }
  const stripped = stripFences(raw).trim();

  // Direct parse
  try {
    return JSON.parse(stripped);
  } catch {
    /* fall through */
  }

  // Balanced-brace fallback
  const block = findFirstBalancedObject(stripped);
  if (block) {
    try {
      return JSON.parse(block);
    } catch (e) {
      throw new AgentOutputParseError(
        `Balanced-brace block failed to parse: ${(e as Error).message}`,
        raw,
      );
    }
  }

  throw new AgentOutputParseError(
    "Could not locate a JSON object in the output",
    raw,
  );
}

function stripFences(text: string): string {
  // ```json\n...\n```  or  ```\n...\n```
  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/m;
  const m = text.match(fence);
  if (m) return m[1];

  // Loose: any leading/trailing ```
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
}

function findFirstBalancedObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) {
        esc = false;
      } else if (c === "\\") {
        esc = true;
      } else if (c === '"') {
        inStr = false;
      }
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

// ── Minimal schema validation (required-keys check only) ────────────
//
// The real backend uses Anthropic's JSON-schema enforcement. Subagents
// don't have that, so we do a surface-level check that every top-level
// required property is present. Deep validation would be nice but is
// expensive and rarely catches real problems — parse failures dominate.

export function validateRequired(
  value: unknown,
  schema: { required?: string[] },
): string[] {
  const missing: string[] = [];
  if (!schema.required || schema.required.length === 0) return missing;
  if (!value || typeof value !== "object") return schema.required.slice();
  const obj = value as Record<string, unknown>;
  for (const key of schema.required) {
    if (!(key in obj) || obj[key] === undefined) missing.push(key);
  }
  return missing;
}
