/**
 * UNIFIED LLM CALL FUNCTION
 * ==========================
 * Supports both Anthropic and OpenAI-compatible (Grok, OpenAI) APIs.
 * Replaces the duplicate callAnthropic/callOpenAI functions in pass files.
 */

export type LLMProvider = "anthropic" | "openai-compat";

/**
 * Call an LLM API with the given system/user prompts.
 * Routes to Anthropic or OpenAI-compatible format based on provider.
 */
export async function callLLM(
  provider: LLMProvider,
  baseUrl: string,
  apiKey: string,
  system: string,
  user: string,
  model: string,
  temperature: number,
  maxTokens: number,
): Promise<string> {
  if (!apiKey) throw new Error(`API key required for ${provider} provider`);

  if (provider === "anthropic") {
    return callAnthropic(baseUrl, apiKey, system, user, model, temperature, maxTokens);
  } else {
    return callOpenAICompat(baseUrl, apiKey, system, user, model, temperature, maxTokens);
  }
}

async function callAnthropic(
  baseUrl: string,
  apiKey: string,
  system: string,
  user: string,
  model: string,
  temperature: number,
  maxTokens: number,
): Promise<string> {
  const res = await fetch(`${baseUrl}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  const data = await res.json() as any;
  if (data.error) throw new Error(`Anthropic API error: ${JSON.stringify(data.error)}`);
  return data.content?.[0]?.text ?? "";
}

async function callOpenAICompat(
  baseUrl: string,
  apiKey: string,
  system: string,
  user: string,
  model: string,
  temperature: number,
  maxTokens: number,
): Promise<string> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature,
      max_completion_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  const data = await res.json() as any;
  if (data.error) throw new Error(`OpenAI-compat API error: ${JSON.stringify(data.error)}`);
  return data.choices?.[0]?.message?.content ?? "";
}
