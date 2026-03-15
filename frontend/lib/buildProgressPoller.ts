import type { BuildProgress } from "../../shared/types/api";

/**
 * Format a BuildProgress object into a user-friendly loading message.
 * Returns a string like "Refining your story... (quality check 2/3)"
 */
export function formatBuildProgress(progress: BuildProgress, moduleName: string): string {
  const { attempt, maxAttempts, status, lastFailReason } = progress;

  switch (status) {
    case "building":
      if (maxAttempts > 1) {
        return `Crafting ${moduleName}... (candidate ${attempt}/${maxAttempts})`;
      }
      return `Building your ${moduleName}...`;
    case "judging":
      if (maxAttempts > 1) {
        return `Quality checking ${moduleName}... (check ${attempt}/${maxAttempts})`;
      }
      return `Quality checking your ${moduleName}...`;
    case "passed":
      return `Found a great ${moduleName}! Finalizing...`;
    case "failed_retrying":
      return `Refining your ${moduleName}... (quality check ${attempt}/${maxAttempts})`;
    case "best_effort":
      return `Selecting best ${moduleName}...`;
    default:
      return `Working on your ${moduleName}...`;
  }
}

/**
 * Start polling for build progress updates.
 * Calls the session getter on an interval and invokes onProgress when buildProgress changes.
 * Returns a cleanup function to stop polling.
 */
export function startBuildProgressPolling(
  getSession: () => Promise<{ buildProgress?: BuildProgress } | null>,
  moduleName: string,
  onMessage: (message: string) => void,
  intervalMs = 2000,
): () => void {
  let lastStatus = "";
  let lastAttempt = 0;

  const interval = setInterval(async () => {
    try {
      const session = await getSession();
      const progress = session?.buildProgress;
      if (!progress) return;

      // Only update if something changed
      const key = `${progress.status}-${progress.attempt}`;
      if (key === `${lastStatus}-${lastAttempt}`) return;
      lastStatus = progress.status;
      lastAttempt = progress.attempt;

      onMessage(formatBuildProgress(progress, moduleName));
    } catch {
      // Silently ignore polling errors — the main request will surface real errors
    }
  }, intervalMs);

  return () => clearInterval(interval);
}
