import { LLMClient } from "./llmClient";
import type {
  ProjectBrief,
  ModuleName,
  BriefCharacter,
  BriefRelationship,
  ProvenanceEntry,
} from "../../shared/types/projectBrief";

/**
 * ProjectBrief Service (evolved from StoryBibleService)
 *
 * Maintains a structured, provenance-tracked ProjectBrief that accumulates
 * confirmed facts across all modules. Updated at each module lock.
 * Injected into clarifier/builder prompts so downstream modules never
 * contradict upstream canon.
 *
 * Also generates a plain-text narrative_summary for contexts where
 * structured data is too verbose.
 */
export class StoryBibleService {
  constructor(private llm: LLMClient) {}

  /**
   * Legacy API — generate plain-text bible from pack summary.
   * Now delegates to updateBrief + returns narrative_summary.
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

  /**
   * Update the ProjectBrief with data from a just-locked module.
   *
   * Deterministic merge for structured fields, LLM pass for narrative summary.
   * The brief accumulates — each module adds its confirmed decisions.
   */
  async updateBrief(
    projectId: string,
    moduleName: ModuleName,
    moduleData: ModuleBriefData,
    existingBrief: ProjectBrief | null,
  ): Promise<ProjectBrief> {
    const brief: ProjectBrief = existingBrief ?? createEmptyBrief(projectId);

    // Merge module-specific data
    switch (moduleName) {
      case "hook":
        if (moduleData.hook) {
          brief.hook = moduleData.hook;
        }
        break;

      case "character":
        if (moduleData.characters) {
          brief.characters = moduleData.characters;
        }
        if (moduleData.relationships) {
          brief.relationships = moduleData.relationships;
        }
        break;

      case "world":
        if (moduleData.setting) {
          brief.setting = {
            ...brief.setting,
            ...moduleData.setting,
          };
        }
        break;

      case "plot":
        if (moduleData.plot) {
          brief.plot = moduleData.plot;
        }
        break;
    }

    // Merge tone and bans (additive, deduplicated by value)
    if (moduleData.tone) {
      for (const t of moduleData.tone) {
        if (!brief.tone.some(existing => existing.value === t.value)) {
          brief.tone.push(t);
        }
      }
    }
    if (moduleData.bans) {
      for (const b of moduleData.bans) {
        if (!brief.bans.some(existing => existing.value === b.value)) {
          brief.bans.push(b);
        }
      }
    }

    // Update open questions (replace, not merge — each module provides current state)
    if (moduleData.open_questions) {
      brief.open_questions = moduleData.open_questions;
    }

    // Update metadata
    brief.lastUpdatedBy = moduleName;
    brief.updatedAt = new Date().toISOString();

    // Generate narrative summary via LLM
    brief.narrative_summary = await this.generateNarrativeSummary(brief);

    return brief;
  }

  private async generateNarrativeSummary(brief: ProjectBrief): Promise<string> {
    const { formatProjectBriefForPrompt } = await import("../../shared/types/projectBrief");
    const structuredText = formatProjectBriefForPrompt(brief);

    const systemPrompt =
      "You are a concise story bible writer. Given structured story data, produce a clear, " +
      "factual narrative summary under 400 words. Write in present tense. Only include " +
      "confirmed facts. This will be injected into creative prompts as canonical reference.";

    const userPrompt =
      `Write a narrative summary of this story's confirmed elements:\n\n${structuredText}`;

    return await this.llm.call("cultural_summarizer", systemPrompt, userPrompt, {
      temperature: 0.3,
      maxTokens: 600,
    });
  }
}

/** Data a module provides when locking — only includes fields it owns */
export interface ModuleBriefData {
  hook?: ProjectBrief["hook"];
  characters?: BriefCharacter[];
  relationships?: BriefRelationship[];
  setting?: Partial<ProjectBrief["setting"]>;
  plot?: ProjectBrief["plot"];
  tone?: ProvenanceEntry[];
  bans?: ProvenanceEntry[];
  open_questions?: string[];
}

function createEmptyBrief(projectId: string): ProjectBrief {
  return {
    schemaVersion: 1,
    projectId,
    lastUpdatedBy: "hook",
    updatedAt: new Date().toISOString(),
    hook: {
      sentence: { value: "", confidence: "inferred", source_module: "hook" },
      engine: { value: "", confidence: "inferred", source_module: "hook" },
      stakes: { value: "", confidence: "inferred", source_module: "hook" },
    },
    characters: [],
    relationships: [],
    setting: {},
    tone: [],
    bans: [],
    open_questions: [],
    narrative_summary: "",
  };
}
