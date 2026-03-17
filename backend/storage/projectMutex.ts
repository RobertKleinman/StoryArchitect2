/**
 * Per-project in-memory write mutex.
 *
 * Prevents lost updates when concurrent background tasks (consolidation,
 * divergence, cultural research) save to the same session file.
 *
 * BOUNDARY: Single-process, single-machine, in-memory only.
 * Does NOT protect against multi-process or distributed concurrency.
 * For the current single-user tool, this is sufficient.
 */

const locks = new Map<string, Promise<void>>();

/**
 * Acquire an exclusive lock for a project, execute the callback, then release.
 * Concurrent calls for the same projectId are serialized.
 */
export async function withProjectLock<T>(
  projectId: string,
  fn: () => Promise<T>,
): Promise<T> {
  // Wait for any existing lock on this project
  while (locks.has(projectId)) {
    await locks.get(projectId);
  }

  let resolve: () => void;
  const lockPromise = new Promise<void>((r) => { resolve = r; });
  locks.set(projectId, lockPromise);

  try {
    return await fn();
  } finally {
    locks.delete(projectId);
    resolve!();
  }
}
