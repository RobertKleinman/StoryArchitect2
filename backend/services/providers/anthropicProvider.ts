import type { LLMProvider, ProviderCallOptions, ProviderResponse } from "./types";
import { ProviderHttpError } from "./types";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const STRUCTURED_OUTPUTS_BETA = "structured-outputs-2025-11-13";

interface AnthropicTextBlock {
  type: "text";
  text: string;
}

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface AnthropicResponse {
  content?: AnthropicTextBlock[];
  usage?: AnthropicUsage;
}

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";

  async call(
    model: string,
    systemPrompt: string,
    userPrompt: string,
    options?: ProviderCallOptions,
  ): Promise<ProviderResponse> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("Missing ANTHROPIC_API_KEY environment variable");
    }

    const payload: Record<string, unknown> = {
      model,
      max_tokens: options?.maxTokens ?? 1024,
      temperature: options?.temperature ?? 0.7,
      // Array-of-blocks format with cache_control for prompt caching.
      // System prompts are large (~6,500+ tokens) and constant across turns —
      // caching saves ~80% input token cost and reduces TTFT after first turn.
      system: [
        {
          type: "text",
          text: systemPrompt,
          cache_control: { type: "ephemeral" },
        },
      ],
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
      signal: AbortSignal.timeout(300_000),
    });

    if (!res.ok) {
      const retryAfter = res.headers.get("retry-after") ?? undefined;
      let errorBody = "";
      try {
        errorBody = await res.text();
      } catch {
        // ignore body read failure
      }
      throw new ProviderHttpError(res.status, retryAfter, errorBody);
    }

    const data = (await res.json()) as AnthropicResponse;

    const text = (data.content ?? [])
      .filter((block): block is AnthropicTextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    const u = data.usage;
    return {
      text,
      usage: {
        inputTokens: u?.input_tokens ?? 0,
        outputTokens: u?.output_tokens ?? 0,
        cacheReadTokens: u?.cache_read_input_tokens ?? 0,
        cacheWriteTokens: u?.cache_creation_input_tokens ?? 0,
      },
    };
  }
}
