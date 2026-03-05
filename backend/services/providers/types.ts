/**
 * Shared interface for all LLM provider implementations.
 * Each provider translates our unified call interface into provider-specific API calls.
 */

export interface ProviderCallOptions {
  temperature?: number;
  maxTokens?: number;
  /** If provided, response is guaranteed valid JSON matching this schema */
  jsonSchema?: Record<string, unknown>;
}

export interface ProviderResponse {
  text: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
}

export interface LLMProvider {
  readonly name: string;

  /**
   * Send a single completion request.
   * Providers handle their own response parsing but NOT retries —
   * the LLMClient handles retries uniformly across all providers.
   */
  call(
    model: string,
    systemPrompt: string,
    userPrompt: string,
    options?: ProviderCallOptions,
  ): Promise<ProviderResponse>;
}

/**
 * Error thrown by providers for retriable HTTP errors (429, 500, 529).
 * The LLMClient uses this to decide whether to retry.
 */
export class ProviderHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly retryAfter: string | undefined,
    public readonly body: string,
  ) {
    super(`Provider HTTP error ${status}`);
    this.name = "ProviderHttpError";
  }

  get isRetriable(): boolean {
    return [429, 500, 529].includes(this.status);
  }
}
