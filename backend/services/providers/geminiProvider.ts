import type { LLMProvider, ProviderCallOptions, ProviderResponse } from "./types";
import { ProviderHttpError } from "./types";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

interface GeminiCandidate {
  content?: { parts?: Array<{ text?: string }> };
  finishReason?: string;
}

interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  cachedContentTokenCount?: number;
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
  usageMetadata?: GeminiUsageMetadata;
}

/** Recursively strip `additionalProperties` — Gemini API rejects this field */
function stripAdditionalProperties(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(stripAdditionalProperties);
  if (obj && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === "additionalProperties") continue;
      out[k] = stripAdditionalProperties(v);
    }
    return out;
  }
  return obj;
}

export class GeminiProvider implements LLMProvider {
  readonly name = "gemini";

  async call(
    model: string,
    systemPrompt: string,
    userPrompt: string,
    options?: ProviderCallOptions,
  ): Promise<ProviderResponse> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("Missing GEMINI_API_KEY environment variable");
    }

    const payload: Record<string, unknown> = {
      system_instruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: (options?.cacheableUserPrefix ?? "") + userPrompt }],
        },
      ],
      generationConfig: {
        temperature: options?.temperature ?? 0.7,
        maxOutputTokens: options?.maxTokens ?? 1024,
        ...(options?.jsonSchema
          ? {
              responseMimeType: "application/json",
              responseSchema: stripAdditionalProperties(options.jsonSchema),
            }
          : {}),
      },
    };

    const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
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

    const data = (await res.json()) as GeminiResponse;

    const text =
      data.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? "")
        .join("") ?? "";

    const u = data.usageMetadata;

    const geminiStopReason = data.candidates?.[0]?.finishReason ?? "unknown";

    return {
      text,
      stopReason: geminiStopReason === "STOP" ? "end_turn" : geminiStopReason.toLowerCase(),
      usage: {
        inputTokens: u?.promptTokenCount ?? 0,
        outputTokens: u?.candidatesTokenCount ?? 0,
        cacheReadTokens: u?.cachedContentTokenCount ?? 0,
      },
    };
  }
}
