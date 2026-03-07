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
    user_read: {
      type: "object",
      properties: {
        signals: {
          type: "array",
          items: {
            type: "object",
            properties: {
              hypothesis: { type: "string" },
              action: { type: "string" },
              valence: { type: "string", enum: ["supports", "contradicts"] },
              scope: { type: "string", enum: ["this_story", "this_genre", "global"] },
              category: { type: "string", enum: ["content_preferences", "control_orientation", "power_dynamics", "tonal_risk", "narrative_ownership", "engagement_satisfaction"] },
              adaptationConsequence: { type: "string" },
              contradictionCriteria: { type: "string" },
              contradictsSignalId: { type: "string" },
            },
            required: ["hypothesis", "action", "valence", "scope", "category", "adaptationConsequence", "contradictionCriteria"],
            additionalProperties: false,
          },
        },
        behaviorSummary: {
          type: "object",
          properties: {
            orientation: { type: "string" },
            currentFocus: { type: "string" },
            engagementMode: { type: "string", enum: ["exploring", "converging", "stuck", "disengaged"] },
            satisfaction: {
              type: "object",
              properties: {
                score: { type: "number" },
                trend: { type: "string", enum: ["rising", "stable", "declining"] },
                reason: { type: "string" },
              },
              required: ["score", "trend", "reason"],
              additionalProperties: false,
            },
          },
          required: ["orientation", "currentFocus", "engagementMode", "satisfaction"],
          additionalProperties: false,
        },
        adaptationPlan: {
          type: "object",
          properties: {
            dominantNeed: { type: "string" },
            moves: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  action: { type: "string" },
                  drivenBy: { type: "array", items: { type: "string" } },
                  target: { type: "string", enum: ["question", "options", "assumptions", "builder_tone", "builder_content", "judge_criteria"] },
                },
                required: ["action", "drivenBy", "target"],
                additionalProperties: false,
              },
            },
          },
          required: ["dominantNeed", "moves"],
          additionalProperties: false,
        },
      },
      required: ["signals", "behaviorSummary", "adaptationPlan"],
      additionalProperties: false,
    },
  },
  required: [
    "psychology_strategy", "hypothesis_line", "question", "options",
    "allow_free_text", "ready_for_hook", "readiness_pct", "readiness_note", "missing_signal", "conflict_flag", "assumptions", "state_update", "user_read"
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
  required: ["pass", "hard_fail_reasons", "scores", "most_generic_part", "one_fix_instruction"],
  additionalProperties: false,
} as const;
