import Anthropic from "@anthropic-ai/sdk";
import type { LLMProvider, ProviderCallOptions, ProviderResponse } from "./types";
import { ProviderHttpError } from "./types";

const STRUCTURED_OUTPUTS_BETA = "structured-outputs-2025-11-13";

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  private client: Anthropic | null = null;

  private getClient(): Anthropic {
    if (!this.client) {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error("Missing ANTHROPIC_API_KEY environment variable");
      }
      this.client = new Anthropic({
        apiKey,
        // 10 minute timeout — scene planner with structured outputs can take a while
        timeout: 600_000,
      });
    }
    return this.client;
  }

  async call(
    model: string,
    systemPrompt: string,
    userPrompt: string,
    options?: ProviderCallOptions,
  ): Promise<ProviderResponse> {
    const client = this.getClient();

    // Build system blocks with cache_control for prompt caching.
    // System prompts are large (~6,500+ tokens) and constant across turns —
    // caching saves ~80% input token cost and reduces TTFT after first turn.
    const systemBlocks: Anthropic.Messages.TextBlockParam[] = [
      {
        type: "text",
        text: systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ];

    // If a cacheable user prefix is provided, split the user message into two
    // content blocks: the static prefix (cached) and the dynamic suffix.
    // This lets Anthropic cache the large upstream context (~15,000+ tokens)
    // that doesn't change between clarifier turns.
    const userContent: Anthropic.Messages.ContentBlockParam[] | string =
      options?.cacheableUserPrefix
        ? [
            {
              type: "text" as const,
              text: options.cacheableUserPrefix,
              cache_control: { type: "ephemeral" as const },
            },
            { type: "text" as const, text: userPrompt },
          ]
        : userPrompt;

    // Build request params
    const params: Record<string, unknown> = {
      model,
      max_tokens: options?.maxTokens ?? 1024,
      temperature: options?.temperature ?? 0.7,
      system: systemBlocks,
      messages: [{ role: "user", content: userContent }],
    };

    if (options?.jsonSchema) {
      params.output_format = {
        type: "json_schema",
        schema: options.jsonSchema,
      };
    }

    // Use streaming to avoid headers timeout.
    // With streaming, the connection is established quickly and content
    // arrives incrementally — no more UND_ERR_HEADERS_TIMEOUT.
    try {
      const betas: string[] = [];
      if (options?.jsonSchema) {
        betas.push(STRUCTURED_OUTPUTS_BETA);
      }

      // Use stream() to get incremental content — avoids the headers timeout
      // that kills raw fetch() on long-running structured output calls.
      const stream = client.messages.stream(
        {
          model: params.model as string,
          max_tokens: params.max_tokens as number,
          temperature: params.temperature as number,
          system: params.system as Anthropic.Messages.TextBlockParam[],
          messages: params.messages as Anthropic.Messages.MessageParam[],
          ...(options?.jsonSchema
            ? {
                // @ts-ignore — output_format is available under the structured-outputs beta
                output_format: params.output_format,
              }
            : {}),
        },
        {
          headers: betas.length > 0 ? { "anthropic-beta": betas.join(",") } : undefined,
        },
      );

      const finalMessage = await stream.finalMessage();

      const text = (finalMessage.content ?? [])
        .filter((block): block is Anthropic.Messages.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("");

      const u = finalMessage.usage;
      return {
        text,
        usage: {
          inputTokens: u?.input_tokens ?? 0,
          outputTokens: u?.output_tokens ?? 0,
          cacheReadTokens: (u as any)?.cache_read_input_tokens ?? 0,
          cacheWriteTokens: (u as any)?.cache_creation_input_tokens ?? 0,
        },
      };
    } catch (err: unknown) {
      // Map SDK errors to our ProviderHttpError for the retry layer
      if (err instanceof Anthropic.APIError) {
        const retryAfter = (err.headers as any)?.["retry-after"] ?? undefined;
        throw new ProviderHttpError(err.status, retryAfter, err.message);
      }
      throw err;
    }
  }
}
