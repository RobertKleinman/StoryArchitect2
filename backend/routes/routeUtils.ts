/**
 * Shared route utilities — handleError, getModelOverride, etc.
 * Eliminates duplication across hook, character, world, plot, scene route files.
 */
import type { Response } from "express";

/** Error code → HTTP status mapping shared by all modules */
const CODE_TO_STATUS: Record<string, number> = {
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  LLM_PARSE_ERROR: 422,
  IMAGE_GEN_FAILED: 503,
};

/**
 * Unified route error handler. Works with any ServiceError that has a `code` property.
 * Falls back to 502 for known service errors, 500 for unknown errors.
 */
export function handleRouteError(res: Response, err: unknown, label: string): void {
  console.error(`${label} ROUTE ERROR:`, err);

  // All service errors have a `code` property (HookServiceError, CharacterServiceError, etc.)
  if (err instanceof Error && "code" in err) {
    const code = (err as Error & { code: string }).code;
    const status = CODE_TO_STATUS[code] ?? 502;
    res.status(status).json({ error: true, code, message: err.message });
    return;
  }

  const msg = err instanceof Error ? err.message : "Unexpected server error";
  res.status(500).json({ error: true, code: "LLM_CALL_FAILED", message: msg });
}

/** Extract model override from X-Model-Override header */
export function getModelOverride(header: string | string[] | undefined): string | undefined {
  if (Array.isArray(header)) return header[0];
  return header;
}
