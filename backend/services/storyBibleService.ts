import { LLMClient } from "./llmClient";

/**
 * Story Bible Service
 *
 * Maintains a living canonical reference document that accumulates confirmed
 * facts across all modules (hook, character, world, plot). Updated at each
 * module lock. Injected into clarifier/builder prompts so downstream modules
 * never contradict upstream canon.
 */
export class StoryBibleService {
  constructor(private llm: LLMClient) {}

  /**
   * Generate or update the story bible with new module output.
   *
   * @param projectId  - The hook project ID (common key across all modules)
   * @param newPackSummary - The state_summary from the just-locked module pack
   * @param existingBible  - The current bible text, if any
   * @returns Updated bible text (plain text, <500 words)
   */
  async generateBible(
    projectId: string,
    newPackSummary: string,
    existingBible?: string,
  ): Promise<string> {
    const userPrompt =
      `Update this story bible with the new module output. Keep it under 500 words. ` +
      `Only include CONFIRMED facts — no speculation, no stylistic guidance. ` +
      `Include: character names and roles, setting details, confirmed relationships, ` +
      `confirmed constraints, plot beats if available.\n\n` +
      `Current bible:\n${existingBible || "(empty — this is the first module)"}\n\n` +
      `New module output:\n${newPackSummary}`;

    const systemPrompt =
      "You are a concise story bible writer. Produce a clear, factual summary of all " +
      "confirmed story elements. Write in present tense. Group by category: Characters, " +
      "Setting, Relationships, Constraints, Plot.";

    const response = await this.llm.call("cultural_summarizer", systemPrompt, userPrompt, {
      temperature: 0.3,
      maxTokens: 800,
    });

    return response;
  }
}
