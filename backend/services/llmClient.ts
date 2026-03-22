import { HookRole, ModelConfig, LLMProvider, detectProvider, V2Role, V2ModelConfig, DEFAULT_V2_MODEL_CONFIG } from "../../shared/modelConfig";
import type { LLMProvider as ILLMProvider, ProviderCallOptions } from "./providers/types";
import { ProviderHttpError } from "./providers/types";
import { AnthropicProvider } from "./providers/anthropicProvider";
import { OpenAICompatibleProvider } from "./providers/openaiProvider";
import { GeminiProvider } from "./providers/geminiProvider";

// ── Provider registry (exhaustively typed against LLMProvider union) ─

const providers: Record<LLMProvider, ILLMProvider> = {
  anthropic: new AnthropicProvider(),
  openai: new OpenAICompatibleProvider({
    name: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnvVar: "OPENAI_API_KEY",
  }),
  gemini: new GeminiProvider(),
  grok: new OpenAICompatibleProvider({
    name: "grok",
    baseUrl: "https://api.x.ai/v1",
    apiKeyEnvVar: "GROK_API_KEY",
  }),
};

// ── Token tracking ───────────────────────────────────────────────────

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  calls: number;
}

// ── Public types (unchanged from before) ────────────────────────────

export interface CallOptions {
  temperature?: number;
  maxTokens?: number;
  modelOverride?: string;
  /** If provided, enables structured outputs — response is guaranteed valid JSON */
  jsonSchema?: Record<string, unknown>;
  /** Static prefix of user prompt — cached separately by Anthropic for faster TTFT.
   *  Other providers prepend it to the user prompt string. */
  cacheableUserPrefix?: string;
  /** If provided, the call will abort when this signal is triggered (e.g. client disconnect).
   *  Checked before each retry attempt. */
  abortSignal?: AbortSignal;
  /** Controls truncation handling:
   *  - "critical": fail on truncation, no repair (builder, judge)
   *  - "best-effort": retry with 1.5x tokens, then repair (divergence, cultural, consolidation)
   *  Defaults to "best-effort" for backward compat. */
  truncationMode?: "critical" | "best-effort";
}

/** Provenance metadata from the most recent LLM call */
export interface CallProvenance {
  provider: string;
  model: string;
  generatedAt: string;  // ISO timestamp
}

// ── LLMClient ───────────────────────────────────────────────────────

export class LLMClient {
  private config: ModelConfig;
  private v2Config: V2ModelConfig;
  private sessionTokens: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0 };
  private _lastCallProvenance: CallProvenance | null = null;
  constructor(config?: ModelConfig, v2Config?: V2ModelConfig) {
    this.config = config ?? ({} as ModelConfig);
    this.v2Config = v2Config ?? DEFAULT_V2_MODEL_CONFIG;
  }

  /** Returns provenance metadata from the most recent successful call */
  get lastCallProvenance(): CallProvenance | null {
    return this._lastCallProvenance;
  }

  updateConfig(partial: Partial<ModelConfig>): void {
    Object.assign(this.config, partial);
  }

  getConfig(): ModelConfig {
    return { ...this.config };
  }

  /**
   * Call the LLM with:
   * - Automatic provider detection from model string
   * - Retry + exponential backoff for 429/500/529 (provider-agnostic)
   * - Optional structured outputs (guaranteed JSON schema compliance)
   */
  async call(
    role: HookRole | V2Role,
    systemPrompt: string,
    userPrompt: string,
    options?: CallOptions,
  ): Promise<string> {
    const model = options?.modelOverride
      ?? (this.config as any)[role]
      ?? (this.v2Config as any)[role];
    const providerName = detectProvider(model);
    const provider = providers[providerName];
    if (!provider) {
      throw new Error(`No provider registered for "${providerName}" (model: ${model})`);
    }

    const maxAttempts = 3;
    const callStart = Date.now();

    const providerOpts: ProviderCallOptions = {
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
      jsonSchema: options?.jsonSchema,
      cacheableUserPrefix: options?.cacheableUserPrefix,
    };

    let truncationRetried = false;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Check abort signal before each attempt (e.g. client disconnected)
      if (options?.abortSignal?.aborted) {
        console.warn(`[LLM] ${role} aborted before attempt ${attempt} — client disconnected`);
        throw new DOMException(`LLM [${role}] aborted: client disconnected`, "AbortError");
      }

      try {
        const attemptStart = Date.now();
        const response = await provider.call(model, systemPrompt, userPrompt, providerOpts);
        const attemptMs = Date.now() - attemptStart;

        // Latency + token instrumentation
        const u = response.usage;
        const totalMs = Date.now() - callStart;
        console.log(
          `[perf] LLM ${role} | ${attemptMs}ms (total ${totalMs}ms, attempt ${attempt}) | ` +
          `in=${u.inputTokens} out=${u.outputTokens} cache_read=${u.cacheReadTokens ?? 0} cache_write=${u.cacheWriteTokens ?? 0} | ` +
          `provider=${providerName} model=${model}`,
        );

        // Accumulate session-wide token usage
        this.sessionTokens.input += u.inputTokens ?? 0;
        this.sessionTokens.output += u.outputTokens ?? 0;
        this.sessionTokens.cacheRead += u.cacheReadTokens ?? 0;
        this.sessionTokens.cacheWrite += u.cacheWriteTokens ?? 0;
        this.sessionTokens.calls++;

        // Record provenance for callers that need it
        this._lastCallProvenance = {
          provider: providerName,
          model,
          generatedAt: new Date().toISOString(),
        };

        // Detect truncation — structured output JSON will be invalid if cut short
        if (response.stopReason === "max_tokens" && options?.jsonSchema) {
          const mode = options?.truncationMode ?? "best-effort";
          const currentMax = providerOpts.maxTokens ?? 4096;

          if (mode === "critical") {
            throw new Error(
              `LLM [${role}] output truncated at maxTokens=${currentMax} — critical-path call, refusing to repair`,
            );
          }

          // best-effort: retry once with 1.5x tokens before repairing
          if (!truncationRetried) {
            truncationRetried = true;
            const expandedMax = Math.ceil(currentMax * 1.5);
            console.warn(
              `[LLM] ${role} output truncated at maxTokens=${currentMax} — retrying with ${expandedMax}`,
            );
            providerOpts.maxTokens = expandedMax;
            continue; // re-enter the retry loop
          }

          console.warn(
            `[LLM] ${role} still truncated after token expansion — falling back to JSON repair`,
          );
          return repairTruncatedJson(response.text);
        }

        // Structured outputs = already valid JSON; otherwise strip fences
        return options?.jsonSchema ? response.text : stripJsonFences(response.text);
      } catch (err: unknown) {
        const isHttpRetriable =
          err instanceof ProviderHttpError && err.isRetriable;
        // Treat timeouts / network aborts as retriable (Anthropic SDK wraps
        // ECONNRESET as "terminated" in the top-level message, so check cause chain too)
        const errMsg = err instanceof Error
          ? [err.message, (err as any).cause?.message, (err as any).cause?.cause?.message].filter(Boolean).join(" ")
          : "";
        const isTimeout = /timed?\s*out|abort|terminated|ECONNRESET|ETIMEDOUT|socket hang up/i.test(errMsg);
        const isRetriable = isHttpRetriable || isTimeout;

        if (!isRetriable || attempt === maxAttempts) {
          const totalMs = Date.now() - callStart;
          const status = err instanceof ProviderHttpError ? err.status : "unknown";
          console.error(
            `[perf] LLM ${role} FAILED after ${totalMs}ms (${attempt} attempts) | ` +
            `status=${status} | provider=${providerName} model=${model}`,
          );
          throw err;
        }

        const retryAfter =
          err instanceof ProviderHttpError ? err.retryAfter : undefined;
        const waitMs =
          retryAfterToMs(retryAfter) ??
          Math.min(1000 * Math.pow(2, attempt - 1), 8000);

        const reason = isTimeout ? "timeout" : (err as ProviderHttpError).status;
        console.warn(
          `LLM [${role}] attempt ${attempt} failed (${reason}), retrying in ${waitMs}ms...`,
        );
        await sleep(waitMs);
      }
    }

    throw new Error(`LLM [${role}] failed after max retries`);
  }

  /** Returns a snapshot of accumulated token usage across all calls in this process lifetime */
  getTokenUsage(): TokenUsage {
    return { ...this.sessionTokens };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterToMs(retryAfter: string | undefined): number | undefined {
  if (!retryAfter) return undefined;

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.floor(seconds * 1000);
  }

  const ts = Date.parse(retryAfter);
  if (!Number.isNaN(ts)) {
    return Math.max(0, ts - Date.now());
  }

  return undefined;
}

/**
 * Attempt to repair truncated JSON by closing open strings, arrays, and objects.
 * This is a best-effort repair for when max_tokens cuts off a structured output.
 * The repaired JSON may have fewer items than intended but should be parseable.
 */
function repairTruncatedJson(raw: string): string {
  let s = raw.trimEnd();

  // If it already parses, return as-is
  try { JSON.parse(s); return s; } catch { /* continue */ }

  // Step 1: If we're inside a string (unterminated), close it
  // Count unescaped quotes to determine if we're inside a string
  let inString = false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && inString) { i++; continue; } // skip escaped char
    if (s[i] === '"') inString = !inString;
  }
  if (inString) {
    s += '"';
  }

  // Step 2: Remove trailing incomplete key-value pairs and commas
  // Handle cases like: ..."value", "incomplete_ke" or ..."value",
  // Remove a trailing orphan string (key without value) after the last comma
  s = s.replace(/,\s*"[^"]*"\s*$/, '');
  // Remove trailing comma/colon/whitespace
  s = s.replace(/[,:\s]+$/, '');

  // Step 3: If we ended mid-value after a key (e.g., "key":), add null
  if (/:\s*$/.test(s)) {
    s += 'null';
  }

  // Step 4: Close open brackets/braces by scanning what's still open
  const stack: string[] = [];
  inString = false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && inString) { i++; continue; }
    if (s[i] === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (s[i] === '{') stack.push('}');
    else if (s[i] === '[') stack.push(']');
    else if (s[i] === '}' || s[i] === ']') stack.pop();
  }

  // Close in reverse order
  const closedCount = stack.length;
  while (stack.length > 0) {
    s += stack.pop();
  }

  // Validate the repair worked
  try {
    JSON.parse(s);
    console.log(`[LLM] JSON repair succeeded (closed ${closedCount} brackets)`);
    return s;
  } catch (err) {
    // Repair failed — throw so the caller's catch block handles it
    throw new Error(`JSON repair failed after truncation: ${(err as Error).message}`);
  }
}

/** Strip ```json fences — only needed when NOT using structured outputs */
export function stripJsonFences(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }
  return s.trim();
}
