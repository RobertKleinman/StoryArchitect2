import type { LLMProvider, ProviderCallOptions, ProviderResponse } from "./types";
import { ProviderHttpError } from "./types";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

interface GeminiCandidate {
  content?: { parts?: Array<{ text?: string }> };
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
          parts: [{ text: userPrompt }],
        },
      ],
      generationConfig: {
        temperature: options?.temperature ?? 0.7,
        maxOutputTokens: options?.maxTokens ?? 1024,
        ...(options?.jsonSchema
          ? {
              responseMimeType: "application/json",
              responseSchema: options.jsonSchema,
            }
          : {}),
      },
    };

    const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
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

    const data = (await res.json()) as GeminiResponse;

    const text =
      data.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? "")
        .join("") ?? "";

    const u = data.usageMetadata;

    return {
      text,
      usage: {
        inputTokens: u?.promptTokenCount ?? 0,
        outputTokens: u?.candidatesTokenCount ?? 0,
        cacheReadTokens: u?.cachedContentTokenCount ?? 0,
      },
    };
  }
}
