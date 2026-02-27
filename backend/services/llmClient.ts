import Anthropic from "@anthropic-ai/sdk";
import { HookRole, ModelConfig } from "../../shared/modelConfig";

const STRUCTURED_OUTPUTS_BETA = "structured-outputs-2025-11-13";

export interface CallOptions {
  temperature?: number;
  maxTokens?: number;
  modelOverride?: string;
  /** If provided, enables structured outputs — response is guaranteed valid JSON */
  jsonSchema?: Record<string, unknown>;
}

export class LLMClient {
  private client: Anthropic;
  private config: ModelConfig;

  constructor(config: ModelConfig) {
    this.client = new Anthropic();
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
        const params: Record<string, unknown> = {
          model,
          max_tokens: options?.maxTokens ?? 1024,
          temperature: options?.temperature ?? 0.7,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        };

        // Structured outputs: constrained JSON decoding via beta header
        const extraHeaders: Record<string, string> = {};
        if (options?.jsonSchema) {
          extraHeaders["anthropic-beta"] = STRUCTURED_OUTPUTS_BETA;
          (params as any).output_format = {
            type: "json_schema",
            schema: options.jsonSchema,
          };
        }

        const response = await this.client.messages.create(
          params as any,
          extraHeaders["anthropic-beta"]
            ? { headers: extraHeaders }
            : undefined
        );

        // Join ALL text blocks (Claude can return multiple content blocks)
        const text = response.content
          .filter((block): block is Anthropic.TextBlock => block.type === "text")
          .map((block) => block.text)
          .join("");

        // Structured outputs = already valid JSON; otherwise strip fences
        return options?.jsonSchema ? text : stripJsonFences(text);

      } catch (err: any) {
        const status = err?.status ?? err?.error?.status;
        const retryable = [429, 500, 529].includes(status);

        if (!retryable || attempt === maxAttempts) {
          throw err;
        }

        const retryAfter = err?.headers?.["retry-after"];
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
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Strip ```json fences — only needed when NOT using structured outputs */
export function stripJsonFences(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }
  return s.trim();
}
