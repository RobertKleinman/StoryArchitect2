/**
 * JSON Schema definitions for Anthropic structured outputs.
 * These mirror the TypeScript interfaces in shared/types/hook.ts.
 * Passed to LLMClient.call() via the jsonSchema option.
 */

export const HOOK_CLARIFIER_SCHEMA = {
  type: "object",
  properties: {
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
      minItems: 2,
      maxItems: 5,
    },
    allow_free_text: { type: "boolean" },
    ready_for_hook: { type: "boolean" },
    missing_signal: { type: "string" },
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
  },
  required: [
    "hypothesis_line", "question", "options",
    "allow_free_text", "ready_for_hook", "missing_signal", "state_update"
  ],
  additionalProperties: false,
} as const;

export const HOOK_BUILDER_SCHEMA = {
  type: "object",
  properties: {
    premise: { type: "string" },
    opening_image: { type: "string" },
    page_1_splash_prompt: { type: "string" },
    page_turn_trigger: { type: "string" },
    why_addictive: {
      type: "array",
      items: { type: "string" },
      minItems: 3,
      maxItems: 3,
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
      minItems: 3,
      maxItems: 5,
    },
  },
  required: [
    "premise", "opening_image", "page_1_splash_prompt",
    "page_turn_trigger", "why_addictive", "collision_sources"
  ],
  additionalProperties: false,
} as const;

export const HOOK_JUDGE_SCHEMA = {
  type: "object",
  properties: {
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
      },
      required: ["specificity", "drawability", "page_turn", "mechanism", "freshness"],
      additionalProperties: false,
    },
    most_generic_part: { type: "string" },
    one_fix_instruction: { type: "string" },
  },
  required: ["pass", "hard_fail_reasons", "scores", "most_generic_part", "one_fix_instruction"],
  additionalProperties: false,
} as const;
