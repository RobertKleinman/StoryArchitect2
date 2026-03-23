import type { LLMProvider, ProviderCallOptions, ProviderResponse } from "./types";
import { ProviderHttpError } from "./types";

interface OpenAIChoice {
  message?: { content?: string };
  finish_reason?: string;
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
 * Normalize a JSON schema for OpenAI strict mode.
 * OpenAI requires: all properties in `required`, `additionalProperties: false` recursively.
 * For properties that were originally optional (not in `required`), convert to nullable
 * union to preserve "may be absent" semantics.
 */
function normalizeSchemaForStrict(schema: Record<string, unknown>): Record<string, unknown> {
  function walk(obj: any): any {
    if (Array.isArray(obj)) return obj.map(walk);
    if (obj && typeof obj === "object") {
      const out: any = {};
      for (const [k, v] of Object.entries(obj)) {
        if (k === "additionalProperties") continue; // strip — OpenAI adds implicitly
        out[k] = walk(v);
      }
      // If this is an object schema with properties, enforce all required + nullable for optionals
      if (out.type === "object" && out.properties && typeof out.properties === "object") {
        const originalRequired = new Set<string>(Array.isArray(out.required) ? out.required : []);
        const allKeys = Object.keys(out.properties);
        // Make formerly-optional properties nullable
        for (const key of allKeys) {
          if (!originalRequired.has(key)) {
            const prop = out.properties[key];
            if (prop && typeof prop === "object" && prop.type && !Array.isArray(prop.type)) {
              // Simple type → nullable union: type: "string" → type: ["string", "null"]
              out.properties[key] = { ...prop, type: [prop.type, "null"] };
            } else if (prop && typeof prop === "object" && prop.enum) {
              // Enum → add null to enum values
              out.properties[key] = { ...prop, enum: [...prop.enum, null] };
            }
            // Complex schemas (anyOf, oneOf, etc.) are left as-is — rare in this codebase
          }
        }
        out.required = allKeys;
        out.additionalProperties = false;
      }
      return out;
    }
    return obj;
  }
  return walk(schema);
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

    // GPT-5+ models require max_completion_tokens instead of max_tokens.
    // Detect by model name prefix. Grok models still use max_tokens.
    const useNewTokenParam = model.startsWith("gpt-5") || model.startsWith("o3") || model.startsWith("o4");
    const maxTokens = options?.maxTokens ?? 1024;

    const payload: Record<string, unknown> = {
      model,
      ...(useNewTokenParam
        ? { max_completion_tokens: maxTokens }
        : { max_tokens: maxTokens }),
      temperature: options?.temperature ?? 0.7,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: (options?.cacheableUserPrefix ?? "") + userPrompt },
      ],
    };

    // Structured output support (OpenAI format)
    // Normalize schema for strict mode: all properties required, optionals become nullable
    if (options?.jsonSchema) {
      payload.response_format = {
        type: "json_schema",
        json_schema: {
          name: "response",
          strict: true,
          schema: normalizeSchemaForStrict(options.jsonSchema as Record<string, unknown>),
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
      signal: options?.abortSignal
        ? AbortSignal.any([options.abortSignal, AbortSignal.timeout(300_000)])
        : AbortSignal.timeout(300_000),
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

    const finishReason = data.choices?.[0]?.finish_reason ?? "unknown";

    return {
      text,
      stopReason: finishReason === "stop" ? "end_turn" : finishReason,
      usage: {
        inputTokens: u?.prompt_tokens ?? 0,
        outputTokens: u?.completion_tokens ?? 0,
      },
    };
  }
}
