/**
 * SCENE MODULE JSON SCHEMAS
 * Structured output schemas for all scene LLM roles.
 * Convention: all schemas are plain objects (type: "object" at top level).
 * Providers wrap them in their own format.
 */

// ─── Shared sub-schemas ───

const sceneObjectiveSchema = {
  type: "object",
  properties: {
    want: { type: "string" },
    opposition: { type: "string" },
    stakes: { type: "string" },
  },
  required: ["want", "opposition", "stakes"],
  additionalProperties: false,
};

const sceneQuestionSchema = {
  type: "object",
  properties: {
    reader_question: { type: "string" },
    answers_from: { type: "string" },
  },
  required: ["reader_question"],
  additionalProperties: false,
};

const emotionArcSchema = {
  type: "object",
  properties: {
    start: { type: "string" },
    trigger: { type: "string" },
    end: { type: "string" },
  },
  required: ["start", "trigger", "end"],
  additionalProperties: false,
};

const valueShiftSchema = {
  type: "object",
  properties: {
    from: { type: "string" },
    to: { type: "string" },
    cause: { type: "string" },
  },
  required: ["from", "to", "cause"],
  additionalProperties: false,
};

const informationDeltaSchema = {
  type: "object",
  properties: {
    revealed: { type: "array", items: { type: "string" } },
    misinformation_reinforced: { type: "array", items: { type: "string" } },
    hidden_truth_implied: { type: "array", items: { type: "string" } },
    who_knows_what: {
      type: "array",
      items: {
        type: "object",
        properties: {
          character: { type: "string" },
          knows: { type: "string" },
        },
        required: ["character", "knows"],
        additionalProperties: false,
      },
    },
  },
  required: ["revealed", "misinformation_reinforced", "hidden_truth_implied", "who_knows_what"],
  additionalProperties: false,
};

// Enums removed to keep compiled grammar within Anthropic limits.
// The prompt instructions still constrain valid values.
const compulsionVectorEnum = { type: "string" };
const pacingTypeEnum = { type: "string" };

const scenePlanSchema = {
  type: "object",
  properties: {
    scene_id: { type: "string" },
    beat_ids: { type: "array", items: { type: "string" } },
    title: { type: "string" },
    purpose: { type: "string" },
    setting: {
      type: "object",
      properties: {
        location: { type: "string" },
        time: { type: "string" },
      },
      required: ["location", "time"],
      additionalProperties: false,
    },
    characters_present: { type: "array", items: { type: "string" } },
    pov_character: { type: "string" },
    objective: sceneObjectiveSchema,
    scene_question: sceneQuestionSchema,
    compulsion_vector: compulsionVectorEnum,
    emotion_arc: emotionArcSchema,
    value_shift: valueShiftSchema,
    information_delta: informationDeltaSchema,
    exit_hook: { type: "string" },
    pacing_type: pacingTypeEnum,
    continuity_anchor: { type: "string" },
    motif_notes: { type: "string" },
    turning_point_ref: { type: "string" },
    active_irony: {
      type: "array",
      items: {
        type: "object",
        properties: {
          beat_id: { type: "string" },
          reader_knows: { type: "string" },
          character_believes: { type: "string" },
          tension_created: { type: "string" },
        },
        required: ["beat_id", "reader_knows", "character_believes", "tension_created"],
        additionalProperties: false,
      },
    },
    mystery_hook_activity: {
      type: "array",
      items: {
        type: "object",
        properties: {
          hook_question: { type: "string" },
          action: { type: "string" },
        },
        required: ["hook_question", "action"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "scene_id", "beat_ids", "title", "purpose", "setting",
    "characters_present", "pov_character", "objective", "scene_question",
    "compulsion_vector", "emotion_arc", "value_shift", "information_delta",
    "exit_hook", "pacing_type",
  ],
  additionalProperties: false,
};

// ═══ PLANNER SCHEMA ═══

export const SCENE_PLANNER_SCHEMA = {
  type: "object",
  properties: {
    narrative_preview: {
      type: "object",
      properties: {
        trailer_text: { type: "string" },
        estimated_scene_count: { type: "number" },
        estimated_reading_time: { type: "number" },
      },
      required: ["trailer_text", "estimated_scene_count", "estimated_reading_time"],
      additionalProperties: false,
    },
    scenes: {
      type: "array",
      items: scenePlanSchema,
    },
    clustering_rationale: { type: "string" },
    scene_count_estimate: { type: "number" },
  },
  required: ["narrative_preview", "scenes", "clustering_rationale", "scene_count_estimate"],
  additionalProperties: false,
};

// ═══ CLARIFIER SCHEMA ═══

// Enums removed to keep compiled grammar within Anthropic limits.
// The prompt instructions still constrain valid values.
const signalSchema = {
  type: "object",
  properties: {
    hypothesis: { type: "string" },
    action: { type: "string" },
    valence: { type: "string" },
    scope: { type: "string" },
    category: { type: "string" },
    adaptationConsequence: { type: "string" },
    contradictionCriteria: { type: "string" },
    contradictsSignalId: { type: "string" },
    reinforcesSignalId: { type: "string" },
  },
  required: ["hypothesis", "action", "valence", "scope", "category", "adaptationConsequence", "contradictionCriteria"],
  additionalProperties: false,
};

export const SCENE_CLARIFIER_SCHEMA = {
  type: "object",
  properties: {
    psychology_strategy: { type: "string" },
    scene_summary: { type: "string" },
    needs_input: { type: "boolean" },
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
    assumptions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          assumption: { type: "string" },
          alternatives: { type: "array", items: { type: "string" } },
        },
        required: ["id", "assumption", "alternatives"],
        additionalProperties: false,
      },
    },
    auto_pass_confidence: { type: "number" },
    // user_read collapsed to JSON string to keep compiled grammar within Anthropic limits.
    // Parsed server-side after LLM response.
    user_read: { type: "string" },
  },
  required: ["psychology_strategy", "scene_summary", "needs_input", "allow_free_text", "auto_pass_confidence", "user_read"],
  additionalProperties: false,
};

// ═══ BUILDER SCHEMA ═══

const vnLineSchema = {
  type: "object",
  properties: {
    speaker: { type: "string" },
    text: { type: "string" },
    emotion: { type: "string" },
    stage_direction: { type: "string" },
    delivery: { type: "string" },
  },
  required: ["speaker", "text"],
  additionalProperties: false,
};

export const SCENE_BUILDER_SCHEMA = {
  type: "object",
  properties: {
    scene_id: { type: "string" },
    vn_scene: {
      type: "object",
      properties: {
        scene_id: { type: "string" },
        title: { type: "string" },
        setting: {
          type: "object",
          properties: {
            location: { type: "string" },
            time: { type: "string" },
          },
          required: ["location", "time"],
          additionalProperties: false,
        },
        characters_present: { type: "array", items: { type: "string" } },
        pov_character: { type: "string" },
        lines: { type: "array", items: vnLineSchema },
        transition_out: { type: "string" },
      },
      required: ["scene_id", "title", "setting", "characters_present", "pov_character", "lines"],
      additionalProperties: false,
    },
    readable: {
      type: "object",
      properties: {
        scene_id: { type: "string" },
        title: { type: "string" },
        screenplay_text: { type: "string" },
        word_count: { type: "number" },
      },
      required: ["scene_id", "title", "screenplay_text", "word_count"],
      additionalProperties: false,
    },
    delivery_notes: {
      type: "object",
      properties: {
        objective_delivered: { type: "string" },
        scene_question_status: { type: "string" },
        value_shift_executed: { type: "string" },
        exit_hook_planted: { type: "string" },
      },
      required: ["objective_delivered", "scene_question_status", "value_shift_executed", "exit_hook_planted"],
      additionalProperties: false,
    },
    continuity_anchor: {
      type: "string",
      description: "2-3 sentence bridge for the next scene: where characters stand emotionally, what tension carries forward, what the reader expects next"
    },
  },
  required: ["scene_id", "vn_scene", "readable", "delivery_notes", "continuity_anchor"],
  additionalProperties: false,
};

// ═══ MINOR JUDGE SCHEMA ═══

export const SCENE_MINOR_JUDGE_SCHEMA = {
  type: "object",
  properties: {
    pass: { type: "boolean" },
    beat_delivery: { type: "boolean" },
    dramatic_spine_ok: { type: "boolean" },
    emotion_arc_ok: { type: "boolean" },
    scene_question_served: { type: "boolean" },
    exit_hook_present: { type: "boolean" },
    consistency: {
      type: "object",
      properties: {
        scene_id: { type: "string" },
        continuity_ok: { type: "boolean" },
        voice_ok: { type: "boolean" },
        information_ok: { type: "boolean" },
        issues: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string" },
              description: { type: "string" },
              severity: { type: "string" },
              affects_scene: { type: "string" },
            },
            required: ["type", "description", "severity"],
            additionalProperties: false,
          },
        },
      },
      required: ["scene_id", "continuity_ok", "voice_ok", "information_ok", "issues"],
      additionalProperties: false,
    },
    fix_instruction: { type: "string" },
  },
  required: ["pass", "beat_delivery", "dramatic_spine_ok", "emotion_arc_ok", "scene_question_served", "exit_hook_present", "consistency"],
  additionalProperties: false,
};

// ═══ FINAL JUDGE SCHEMA ═══

export const SCENE_FINAL_JUDGE_SCHEMA = {
  type: "object",
  properties: {
    pass: { type: "boolean" },
    scores: {
      type: "object",
      properties: {
        arc_momentum: { type: "number" },
        scene_rhythm_variety: { type: "number" },
        loop_payoff_discipline: { type: "number" },
        climax_timing: { type: "number" },
        voice_consistency: { type: "number" },
        theme_landing: { type: "number" },
        information_integrity: { type: "number" },
        ending_satisfaction: { type: "number" },
      },
      required: [
        "arc_momentum", "scene_rhythm_variety", "loop_payoff_discipline",
        "climax_timing", "voice_consistency", "theme_landing",
        "information_integrity", "ending_satisfaction",
      ],
      additionalProperties: false,
    },
    flagged_scenes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          scene_id: { type: "string" },
          issue: { type: "string" },
          severity: { type: "string" },
        },
        required: ["scene_id", "issue", "severity"],
        additionalProperties: false,
      },
    },
    arc_issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          issue: { type: "string" },
          affected_scenes: { type: "array", items: { type: "string" } },
          severity: { type: "string" },
        },
        required: ["issue", "affected_scenes", "severity"],
        additionalProperties: false,
      },
    },
    missing_elements: { type: "array", items: { type: "string" } },
    overall_note: { type: "string" },
  },
  required: ["pass", "scores", "flagged_scenes", "arc_issues", "missing_elements", "overall_note"],
  additionalProperties: false,
};

// ═══ SCENE DIVERGENCE SCHEMA ═══

export const SCENE_DIVERGENCE_SCHEMA = {
  type: "object",
  properties: {
    scene_id: { type: "string" },
    alternatives: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          sketch: { type: "string" },
          changes: { type: "array", items: { type: "string" } },
          hook: { type: "string" },
        },
        required: ["label", "sketch", "changes", "hook"],
        additionalProperties: false,
      },
    },
    worth_asking: { type: "boolean" },
    wildcard_index: { type: "number" },
  },
  required: ["scene_id", "alternatives", "worth_asking", "wildcard_index"],
  additionalProperties: false,
};
