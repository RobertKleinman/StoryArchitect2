/**
 * ProjectBrief — a cumulative, structured summary of all confirmed creative decisions.
 *
 * Evolves the plain-text Story Bible into a typed, provenance-tracked object.
 * Updated at each module lock. Injected into clarifier/builder prompts so
 * downstream modules never contradict upstream canon.
 *
 * EVERY field carries confidence + source_module so the system can distinguish
 * "user explicitly chose this" from "inferred and never surfaced."
 */

export type ModuleName = "hook" | "character" | "character_image" | "world" | "plot" | "scene";

export interface ProvenanceEntry<T = string> {
  value: T;
  confidence: "confirmed" | "inferred" | "imported";
  source_module: ModuleName;
}

export interface BriefCharacter {
  name: string;
  role: string;
  confidence: "confirmed" | "inferred" | "imported";
  source_module: ModuleName;
  key_traits: string[];
  presentation?: string;
  age_range?: string;
}

export interface BriefRelationship {
  between: [string, string];
  nature: string;
  confidence: "confirmed" | "inferred" | "imported";
  source_module: ModuleName;
}

export interface ProjectBrief {
  schemaVersion: 1;
  projectId: string;
  lastUpdatedBy: ModuleName;
  updatedAt: string;

  // Structured sections — all with provenance
  hook: {
    sentence: ProvenanceEntry;
    engine: ProvenanceEntry;
    stakes: ProvenanceEntry;
    emotional_promise?: ProvenanceEntry;
  };
  characters: BriefCharacter[];
  relationships: BriefRelationship[];
  setting: {
    anchor?: ProvenanceEntry;
    time_period?: ProvenanceEntry;
    atmosphere?: ProvenanceEntry;
  };
  plot?: {
    arc_summary: ProvenanceEntry;
    key_beats: ProvenanceEntry<string[]>;
  };
  tone: ProvenanceEntry[];
  bans: ProvenanceEntry[];
  open_questions: string[];

  // Human-readable summary (replaces old plain-text bible)
  narrative_summary: string;
}

/**
 * Format a ProjectBrief for injection into LLM prompts.
 * Compact, readable, with provenance annotations.
 */
export function formatProjectBriefForPrompt(brief: ProjectBrief | null): string {
  if (!brief) return "(not yet available)";

  const sections: string[] = [];

  // Hook
  sections.push(
    "HOOK:",
    `  Sentence: ${brief.hook.sentence.value}`,
    `  Engine: ${brief.hook.engine.value}`,
    `  Stakes: ${brief.hook.stakes.value}`,
  );
  if (brief.hook.emotional_promise) {
    sections.push(`  Emotional Promise: ${brief.hook.emotional_promise.value}`);
  }

  // Characters
  if (brief.characters.length > 0) {
    sections.push("", "CHARACTERS:");
    for (const c of brief.characters) {
      const provTag = c.confidence === "confirmed" ? "" : ` [${c.confidence}]`;
      sections.push(`  ${c.name} (${c.role})${provTag}: ${c.key_traits.join(", ")}`);
    }
  }

  // Relationships
  if (brief.relationships.length > 0) {
    sections.push("", "RELATIONSHIPS:");
    for (const r of brief.relationships) {
      sections.push(`  ${r.between[0]} ↔ ${r.between[1]}: ${r.nature}`);
    }
  }

  // Setting
  const settingParts: string[] = [];
  if (brief.setting.anchor) settingParts.push(`Anchor: ${brief.setting.anchor.value}`);
  if (brief.setting.time_period) settingParts.push(`Time: ${brief.setting.time_period.value}`);
  if (brief.setting.atmosphere) settingParts.push(`Atmosphere: ${brief.setting.atmosphere.value}`);
  if (settingParts.length > 0) {
    sections.push("", "SETTING:", ...settingParts.map(s => `  ${s}`));
  }

  // Plot
  if (brief.plot) {
    sections.push("", "PLOT:");
    sections.push(`  Arc: ${brief.plot.arc_summary.value}`);
    if (brief.plot.key_beats.value.length > 0) {
      sections.push(`  Key beats: ${brief.plot.key_beats.value.join(" → ")}`);
    }
  }

  // Tone & Bans
  if (brief.tone.length > 0) {
    sections.push("", `TONE: ${brief.tone.map(t => t.value).join(", ")}`);
  }
  if (brief.bans.length > 0) {
    sections.push(`BANS: ${brief.bans.map(b => b.value).join(", ")}`);
  }

  // Open questions
  if (brief.open_questions.length > 0) {
    sections.push("", "OPEN QUESTIONS:", ...brief.open_questions.map(q => `  - ${q}`));
  }

  return sections.join("\n");
}
