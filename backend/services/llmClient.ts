import { HookRole, ModelConfig, LLMProvider, detectProvider } from "../../shared/modelConfig";
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
}

// ── Token Usage ─────────────────────────────────────────────────────

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  calls: number;
}

// ── LLMClient ───────────────────────────────────────────────────────

export class LLMClient {
  private config: ModelConfig;
  private sessionTokens: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0 };

  constructor(config: ModelConfig) {
    this.config = config;
  }

  updateConfig(partial: Partial<ModelConfig>): void {
    Object.assign(this.config, partial);
  }

  getConfig(): ModelConfig {
    return { ...this.config };
  }

  /** Returns accumulated token usage across all LLM calls in this process lifetime. */
  getTokenUsage(): TokenUsage {
    return { ...this.sessionTokens };
  }

  /**
   * Call the LLM with:
   * - Automatic provider detection from model string
   * - Retry + exponential backoff for 429/500/529 (provider-agnostic)
   * - Optional structured outputs (guaranteed JSON schema compliance)
   */
  async call(
    role: HookRole,
    systemPrompt: string,
    userPrompt: string,
    options?: CallOptions,
  ): Promise<string> {
    const model = options?.modelOverride ?? this.config[role];
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

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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

        // Accumulate token usage
        this.sessionTokens.input += u.inputTokens ?? 0;
        this.sessionTokens.output += u.outputTokens ?? 0;
        this.sessionTokens.cacheRead += u.cacheReadTokens ?? 0;
        this.sessionTokens.cacheWrite += u.cacheWriteTokens ?? 0;
        this.sessionTokens.calls++;

        // Structured outputs = already valid JSON; otherwise strip fences
        return options?.jsonSchema ? response.text : stripJsonFences(response.text);
      } catch (err: unknown) {
        const isRetriable =
          err instanceof ProviderHttpError && err.isRetriable;

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

        console.warn(
          `LLM [${role}] attempt ${attempt} failed (${(err as ProviderHttpError).status}), retrying in ${waitMs}ms...`,
        );
        await sleep(waitMs);
      }
    }

    // Unreachable — loop always returns or throws — but satisfies TypeScript return type
    throw new Error(`LLM [${role}] failed after max retries`);
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

/** Strip ```json fences — only needed when NOT using structured outputs */
export function stripJsonFences(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }
  return s.trim();
}
