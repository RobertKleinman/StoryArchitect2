/**
 * JSON Schema definitions for Character Image Module structured outputs.
 * Mirrors the TypeScript interfaces in shared/types/characterImage.ts.
 */

export const CHARACTER_IMAGE_CLARIFIER_SCHEMA = {
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
    // character_focus is optional string (no anyOf to avoid grammar bloat)
    character_focus: { type: "string" },
    ready_for_images: { type: "boolean" },
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
          characterRole: { type: "string" },
          category: { type: "string" },
          assumption: { type: "string" },
          alternatives: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["id", "characterRole", "category", "assumption", "alternatives"],
        additionalProperties: false,
      },
    },
    // user_read collapsed to JSON string to keep compiled grammar within Anthropic limits.
    // Parsed server-side after LLM response.
    user_read: { type: "string" },
  },
  required: [
    "psychology_strategy", "hypothesis_line", "question", "options", "allow_free_text",
    "character_focus", "ready_for_images", "readiness_pct",
    "readiness_note", "missing_signal", "conflict_flag",
    "assumptions", "user_read",
  ],
  additionalProperties: false,
} as const;

const visualAnchorSchema = {
  type: "object",
  properties: {
    hair_description: { type: "string" },
    eyes_description: { type: "string" },
    signature_garment: { type: "string" },
    distinguishing_marks: { type: "string" },
    body_type: { type: "string" },
    pose_baseline: { type: "string" },
    expression_baseline: { type: "string" },
    color_palette: {
      type: "array",
      items: { type: "string" },
    },
    visual_vibe: { type: "string" },
  },
  required: [
    "hair_description", "eyes_description", "signature_garment",
    "distinguishing_marks", "body_type", "pose_baseline",
    "expression_baseline", "color_palette", "visual_vibe",
  ],
  additionalProperties: false,
} as const;

const visualDescriptionSchema = {
  type: "object",
  properties: {
    role: { type: "string" },
    full_body_description: { type: "string" },
    visual_anchors: visualAnchorSchema,
    image_generation_prompt: { type: "string" },
  },
  required: ["role", "full_body_description", "visual_anchors", "image_generation_prompt"],
  additionalProperties: false,
} as const;

export const CHARACTER_IMAGE_BUILDER_SCHEMA = {
  type: "object",
  properties: {
    characters: {
      type: "array",
      items: visualDescriptionSchema,
    },
    ensemble_cohesion_note: { type: "string" },
    style_recommendation: { type: "string" },
    style_reasoning: { type: "string" },
  },
  required: ["characters", "ensemble_cohesion_note", "style_recommendation", "style_reasoning"],
  additionalProperties: false,
} as const;

export const CHARACTER_IMAGE_JUDGE_SCHEMA = {
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
        visual_distinctiveness: { type: "number" },
        psychology_match: { type: "number" },
        ensemble_cohesion: { type: "number" },
        tone_fit: { type: "number" },
        user_fit: { type: "number" },
      },
      required: ["visual_distinctiveness", "psychology_match", "ensemble_cohesion", "tone_fit", "user_fit"],
      additionalProperties: false,
    },
    distinctiveness_notes: { type: "string" },
    one_fix_instruction: { type: "string" },
  },
  required: ["pass", "hard_fail_reasons", "scores", "distinctiveness_notes", "one_fix_instruction"],
  additionalProperties: false,
} as const;
