/**
 * v2 JSON Schemas — Intake and Premise
 *
 * These are raw schema objects (no name/strict wrapper) matching the
 * format expected by the Anthropic provider's output_config.
 */

export const INTAKE_SCHEMA = {
  type: "object",
  properties: {
    question: {
      type: ["string", "null"],
      description: "A single focused question to ask the user. Null if ready.",
    },
    assumptions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "Short ID like 'a1', 'a2'" },
          category: { type: "string", description: "genre, tone, setting, character, theme, etc." },
          assumption: { type: "string", description: "What you're assuming based on user input" },
          alternatives: {
            type: "array",
            items: { type: "string" },
            description: "2-4 wildly different alternatives the user might prefer",
          },
        },
        required: ["id", "category", "assumption", "alternatives"],
        additionalProperties: false,
      },
    },
    readyForPremise: {
      type: "boolean",
      description: "True if enough info gathered to generate a compelling premise",
    },
    readiness_note: {
      type: "string",
      description: "Brief explanation of readiness assessment",
    },
    raw_signals: {
      type: "array",
      items: {
        type: "object",
        properties: {
          hypothesis: { type: "string" },
          category: { type: "string" },
          evidence: { type: "string" },
        },
        required: ["hypothesis", "category", "evidence"],
        additionalProperties: false,
      },
      description: "Behavioral observations about how the user communicates",
    },
    constraint_updates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string", description: "Constraint key: genre, tone, setting_anchor, etc." },
          value: { type: "string", description: "Inferred value" },
          source: { type: "string" },
        },
        required: ["key", "value", "source"],
        additionalProperties: false,
      },
      description: "Constraints inferred from user input",
    },
  },
  required: ["assumptions", "readyForPremise", "readiness_note"],
  additionalProperties: false,
};

export const PREMISE_WRITER_SCHEMA = {
  type: "object",
  properties: {
    hook_sentence: { type: "string", description: "The hook in 1-2 sentences" },
    emotional_promise: { type: "string", description: "What emotional experience the reader is promised" },
    premise_paragraph: { type: "string", description: "2-3 sentence expansion of the premise" },
    synopsis: { type: "string", description: "3-5 sentence synopsis covering the full story arc" },
    tone_chips: { type: "array", items: { type: "string" }, description: "3-5 tone descriptors" },
    bans: { type: "array", items: { type: "string" }, description: "Things explicitly banned by the user" },
    setting_anchor: { type: "string", description: "Primary setting in one phrase" },
    time_period: { type: "string", description: "When the story takes place" },
    characters_sketch: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          role: { type: "string", enum: ["protagonist", "antagonist", "supporting", "catalyst"] },
          one_liner: { type: "string", description: "One sentence capturing their essence" },
        },
        required: ["name", "role", "one_liner"],
        additionalProperties: false,
      },
    },
    core_conflict: { type: "string", description: "The central tension in one sentence" },
    suggested_length: { type: "string", enum: ["short", "medium", "long"] },
    suggested_cast: { type: "string", enum: ["duo", "triangle", "small_ensemble", "large_ensemble"] },
  },
  required: [
    "hook_sentence", "emotional_promise", "premise_paragraph", "synopsis",
    "tone_chips", "bans", "setting_anchor", "time_period",
    "characters_sketch", "core_conflict", "suggested_length", "suggested_cast",
  ],
  additionalProperties: false,
};

export const PREMISE_JUDGE_SCHEMA = {
  type: "object",
  properties: {
    pass: { type: "boolean" },
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          field: { type: "string" },
          problem: { type: "string" },
          fix_instruction: { type: "string" },
        },
        required: ["field", "problem", "fix_instruction"],
        additionalProperties: false,
      },
    },
    constraint_violations: {
      type: "array",
      items: { type: "string" },
      description: "Any MUST HONOR constraints that were violated",
    },
  },
  required: ["pass", "issues", "constraint_violations"],
  additionalProperties: false,
};
