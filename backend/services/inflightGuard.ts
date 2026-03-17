/**
 * In-flight request deduplication guard.
 *
 * Prevents duplicate LLM calls when a user resubmits while a previous
 * request is still running (e.g. after frontend timeout).
 *
 * Single-process, in-memory only. Does not protect against
 * multi-process or distributed concurrency.
 */

const inflight = new Map<string, { startedAt: number }>();

/** Max time a request can be "in flight" before the guard auto-expires it (5 min) */
const MAX_INFLIGHT_MS = 5 * 60 * 1000;

/**
 * Build a dedup key from request parameters.
 */
export function buildInflightKey(
  projectId: string,
  module: string,
  action: string,
  turnNumber?: number,
): string {
  return `${projectId}:${module}:${action}:${turnNumber ?? "?"}`;
}

/**
 * Try to acquire an in-flight slot. Returns true if acquired, false if
 * a duplicate request is already in flight.
 */
export function acquireInflight(key: string): boolean {
  const existing = inflight.get(key);
  if (existing) {
    // Auto-expire stale entries (safety net for crashes)
    if (Date.now() - existing.startedAt > MAX_INFLIGHT_MS) {
      inflight.delete(key);
    } else {
      return false; // Duplicate — reject
    }
  }
  inflight.set(key, { startedAt: Date.now() });
  return true;
}

/**
 * Release an in-flight slot. Call in a finally block.
 */
export function releaseInflight(key: string): void {
  inflight.delete(key);
}
