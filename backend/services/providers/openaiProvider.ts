import type { LLMProvider, ProviderCallOptions, ProviderResponse } from "./types";
import { ProviderHttpError } from "./types";

interface OpenAIChoice {
  message?: { content?: string };
}

interface OpenAIUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

interface OpenAIResponse {
  choices?: OpenAIChoice[];
  usage?: OpenAIUsage;
}

/**
 * OpenAI-compatible provider.
 * Works with both OpenAI and Grok (xAI) — they share the same chat completions API format.
 * Pass different baseUrl and apiKeyEnvVar for each.
 */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly name: string;
  private readonly baseUrl: string;
  private readonly apiKeyEnvVar: string;

  constructor(opts: { name: string; baseUrl: string; apiKeyEnvVar: string }) {
    this.name = opts.name;
    this.baseUrl = opts.baseUrl;
    this.apiKeyEnvVar = opts.apiKeyEnvVar;
  }

  async call(
    model: string,
    systemPrompt: string,
    userPrompt: string,
    options?: ProviderCallOptions,
  ): Promise<ProviderResponse> {
    const apiKey = process.env[this.apiKeyEnvVar];
    if (!apiKey) {
      throw new Error(`Missing ${this.apiKeyEnvVar} environment variable`);
    }

    const payload: Record<string, unknown> = {
      model,
      max_tokens: options?.maxTokens ?? 1024,
      temperature: options?.temperature ?? 0.7,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    };

    // Structured output support (OpenAI format)
    if (options?.jsonSchema) {
      payload.response_format = {
        type: "json_schema",
        json_schema: {
          name: "response",
          strict: true,
          schema: options.jsonSchema,
        },
      };
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(300_000),
    });

    if (!res.ok) {
      const retryAfter = res.headers.get("retry-after") ?? undefined;
      let errorBody = "";
      try {
        errorBody = await res.text();
      } catch {
        // ignore
      }
      throw new ProviderHttpError(res.status, retryAfter, errorBody);
    }

    const data = (await res.json()) as OpenAIResponse;

    const text = data.choices?.[0]?.message?.content ?? "";
    const u = data.usage;

    return {
      text,
      usage: {
        inputTokens: u?.prompt_tokens ?? 0,
        outputTokens: u?.completion_tokens ?? 0,
      },
    };
  }
}
