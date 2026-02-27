import { HookRole, ModelConfig } from "../../shared/modelConfig";

const STRUCTURED_OUTPUTS_BETA = "structured-outputs-2025-11-13";
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

export interface CallOptions {
  temperature?: number;
  maxTokens?: number;
  modelOverride?: string;
  /** If provided, enables structured outputs — response is guaranteed valid JSON */
  jsonSchema?: Record<string, unknown>;
}

interface AnthropicTextBlock {
  type: "text";
  text: string;
}

interface AnthropicResponse {
  content?: AnthropicTextBlock[];
}

export class LLMClient {
  private config: ModelConfig;

  constructor(config: ModelConfig) {
    this.config = config;
  }

  updateConfig(partial: Partial<ModelConfig>): void {
    Object.assign(this.config, partial);
  }

  getConfig(): ModelConfig {
    return { ...this.config };
  }

  /**
   * Call the LLM with:
   * - Retry + exponential backoff for 429/500/529
   * - Optional structured outputs (guaranteed JSON schema compliance)
   * - Multi-block response handling (joins all text blocks)
   */
  async call(
    role: HookRole,
    systemPrompt: string,
    userPrompt: string,
    options?: CallOptions
  ): Promise<string> {
    const model = options?.modelOverride ?? this.config[role];
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await this.createMessage(model, systemPrompt, userPrompt, options);

        // Join ALL text blocks (Claude can return multiple content blocks)
        const text = (response.content ?? [])
          .filter((block): block is AnthropicTextBlock => block.type === "text")
          .map((block) => block.text)
          .join("");

        // Structured outputs = already valid JSON; otherwise strip fences
        return options?.jsonSchema ? text : stripJsonFences(text);
      } catch (err: unknown) {
        const status = getErrorStatus(err);
        const retryable = typeof status === "number" && [429, 500, 529].includes(status);

        if (!retryable || attempt === maxAttempts) {
          throw err;
        }

        const retryAfter = getRetryAfter(err);
        const waitMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : Math.min(1000 * Math.pow(2, attempt - 1), 8000);

        console.warn(
          `LLM [${role}] attempt ${attempt} failed (${status}), retrying in ${waitMs}ms...`
        );
        await sleep(waitMs);
      }
    }

    throw new Error(`LLM [${role}] failed after max retries`);
  }

  private async createMessage(
    model: string,
    systemPrompt: string,
    userPrompt: string,
    options?: CallOptions
  ): Promise<AnthropicResponse> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("Missing ANTHROPIC_API_KEY environment variable");
    }

    const payload: Record<string, unknown> = {
      model,
      max_tokens: options?.maxTokens ?? 1024,
      temperature: options?.temperature ?? 0.7,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    };

    if (options?.jsonSchema) {
      payload.output_format = {
        type: "json_schema",
        schema: options.jsonSchema,
      };
    }

    const headers: HeadersInit = {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    };

    if (options?.jsonSchema) {
      headers["anthropic-beta"] = STRUCTURED_OUTPUTS_BETA;
    }

    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const retryAfter = res.headers.get("retry-after") ?? undefined;
      throw { status: res.status, headers: { "retry-after": retryAfter } };
    }

    return (await res.json()) as AnthropicResponse;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorStatus(err: unknown): number | undefined {
  if (typeof err !== "object" || !err) {
    return undefined;
  }
  const withStatus = err as { status?: unknown; error?: { status?: unknown } };
  const top = withStatus.status;
  if (typeof top === "number") {
    return top;
  }
  const nested = withStatus.error?.status;
  if (typeof nested === "number") {
    return nested;
  }
  return undefined;
}

function getRetryAfter(err: unknown): string | undefined {
  if (typeof err !== "object" || !err) {
    return undefined;
  }
  const withHeaders = err as { headers?: { [key: string]: unknown } };
  const retryAfter = withHeaders.headers?.["retry-after"];
  return typeof retryAfter === "string" ? retryAfter : undefined;
}

/** Strip ```json fences — only needed when NOT using structured outputs */
export function stripJsonFences(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }
  return s.trim();
}
