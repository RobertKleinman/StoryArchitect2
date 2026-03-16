/**
 * JSON Schema definitions for Anthropic structured outputs.
 * These mirror the TypeScript interfaces in shared/types/hook.ts.
 * Passed to LLMClient.call() via the jsonSchema option.
 */

export const HOOK_CLARIFIER_SCHEMA = {
  type: "object",
  properties: {
    psychology_strategy: { type: "string" },
    hypothesis_line: { type: "string" },
    question: { type: "string" },
    options: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          label: { type: "string" },
        },
        required: ["id", "label"],
        additionalProperties: false,
      },
    },
    allow_free_text: { type: "boolean" },
    ready_for_hook: { type: "boolean" },
    readiness_pct: { type: "number" },
    readiness_note: { type: "string" },
    missing_signal: { type: "string" },
    conflict_flag: { type: "string" },
    assumptions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          category: { type: "string" },
          assumption: { type: "string" },
          alternatives: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["id", "category", "assumption", "alternatives"],
        additionalProperties: false,
      },
    },
    state_update: {
      type: "object",
      properties: {
        hook_engine: { type: "string" },
        stakes: { type: "string" },
        taboo_or_tension: { type: "string" },
        opening_image_seed: { type: "string" },
        setting_anchor: { type: "string" },
        protagonist_role: { type: "string" },
        antagonist_form: { type: "string" },
        tone_chips: { type: "array", items: { type: "string" } },
        bans: { type: "array", items: { type: "string" } },
      },
      additionalProperties: false,
    },
    // scope_recommendation & user_read collapsed to JSON strings to keep
    // compiled grammar within Anthropic's size limit. Parsed server-side.
    scope_recommendation: { type: "string" },
    user_read: { type: "string" },
  },
  required: [
    "psychology_strategy", "hypothesis_line", "question", "options",
    "allow_free_text", "ready_for_hook", "readiness_pct", "readiness_note", "missing_signal", "conflict_flag", "assumptions", "state_update", "user_read",
  ],
  additionalProperties: false,
} as const;

export const HOOK_BUILDER_SCHEMA = {
  type: "object",
  properties: {
    hook_sentence: { type: "string" },
    emotional_promise: { type: "string" },
    premise: { type: "string" },
    opening_image: { type: "string" },
    page_1_splash_prompt: { type: "string" },
    page_turn_trigger: { type: "string" },
    why_addictive: {
      type: "array",
      items: { type: "string" },
    },
    collision_sources: {
      type: "array",
      items: {
        type: "object",
        properties: {
          source: { type: "string" },
          element_extracted: { type: "string" },
        },
        required: ["source", "element_extracted"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "hook_sentence", "emotional_promise", "premise", "opening_image",
    "page_1_splash_prompt", "page_turn_trigger", "why_addictive", "collision_sources"
  ],
  additionalProperties: false,
} as const;

export const HOOK_JUDGE_SCHEMA = {
  type: "object",
  properties: {
    // Chain-of-thought: forces the model to reason BEFORE scoring
    analysis: { type: "string" },
    pass: { type: "boolean" },
    hard_fail_reasons: {
      type: "array",
      items: { type: "string" },
    },
    scores: {
      type: "object",
      properties: {
        specificity: { type: "number" },
        drawability: { type: "number" },
        page_turn: { type: "number" },
        mechanism: { type: "number" },
        freshness: { type: "number" },
        user_fit: { type: "number" },
      },
      required: ["specificity", "drawability", "page_turn", "mechanism", "freshness", "user_fit"],
      additionalProperties: false,
    },
    most_generic_part: { type: "string" },
    one_fix_instruction: { type: "string" },
  },
  required: ["analysis", "pass", "hard_fail_reasons", "scores", "most_generic_part", "one_fix_instruction"],
  additionalProperties: false,
} as const;
