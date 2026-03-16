/**
 * Shared API request utility — single implementation used by all module API files.
 * Handles timeout, JSON parsing, error extraction, and abort signals.
 */

const BASE = "/api";

/** Default timeout: 3 min for normal calls; generation/tournament calls pass longer timeouts */
export const DEFAULT_TIMEOUT_MS = 180_000;

export async function request<T>(
  path: string,
  options?: RequestInit & { timeoutMs?: number },
): Promise<T> {
  const { timeoutMs, ...fetchOptions } = options ?? {};
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...fetchOptions,
      signal: controller.signal,
    });

    let data: any;
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      data = await res.json();
    } else {
      const text = await res.text();
      data = { message: text || `Server error (${res.status})` };
    }

    if (!res.ok || data.error) {
      throw new Error(data?.message ?? "Something went wrong");
    }

    return data as T;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`Request to ${path} timed out after ${((timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000).toFixed(0)}s`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
