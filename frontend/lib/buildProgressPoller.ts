import type { BuildProgress } from "../../shared/types/api";

/**
 * Format a BuildProgress object into a user-friendly loading message.
 */
export function formatBuildProgress(progress: BuildProgress, moduleName: string): string {
  const { attempt, maxAttempts, status } = progress;

  switch (status) {
    case "building":
      if (maxAttempts === 1) {
        return `Crafting your ${moduleName}\u2026`;
      }
      return `Crafting ${moduleName}\u2026 (candidate ${attempt}/${maxAttempts})`;

    case "judging":
      if (maxAttempts === 1) {
        return `Quality-checking your ${moduleName}\u2026`;
      }
      return `Quality-checking ${moduleName}\u2026 (candidate ${attempt}/${maxAttempts})`;

    case "passed":
      return `Found a great ${moduleName}!`;

    case "failed_retrying":
      return `Refining your ${moduleName}\u2026 (quality check ${attempt}/${maxAttempts})`;

    case "best_effort":
      return `Selecting the best ${moduleName}\u2026`;

    default:
      return `Working on your ${moduleName}\u2026`;
  }
}

/**
 * Start polling a session endpoint for buildProgress updates.
 * Calls `onMessage` whenever the progress changes, providing a user-friendly string.
 * Returns a cleanup function to stop polling.
 */
export function startBuildProgressPolling(
  getSession: () => Promise<{ buildProgress?: BuildProgress } | null>,
  moduleName: string,
  onMessage: (message: string) => void,
  intervalMs = 2000,
): () => void {
  let lastKey = "";
  let stopped = false;

  const poll = async () => {
    if (stopped) return;
    try {
      const session = await getSession();
      if (stopped) return;
      if (session?.buildProgress) {
        const bp = session.buildProgress;
        const key = `${bp.attempt}-${bp.status}`;
        if (key !== lastKey) {
          lastKey = key;
          onMessage(formatBuildProgress(bp, moduleName));
        }
      }
    } catch {
      // Ignore polling errors — the main request will surface real errors
    }
  };

  const timer = setInterval(poll, intervalMs);
  // Kick off an initial poll immediately
  void poll();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
