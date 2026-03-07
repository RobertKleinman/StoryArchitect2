/**
 * JSON Schema definitions for World Module structured outputs.
 * Mirrors the TypeScript interfaces in shared/types/world.ts.
 */

// ─── Shared user_read schema (v4 signal format — reused across all modules) ───

const USER_READ_SCHEMA = {
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
} as const;

// ─── World Clarifier Schema ───

export const WORLD_CLARIFIER_SCHEMA = {
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
    world_focus: { type: "string" },
    ready_for_world: { type: "boolean" },
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
    user_read: USER_READ_SCHEMA,
  },
  required: [
    "psychology_strategy", "hypothesis_line", "question", "options",
    "allow_free_text", "ready_for_world", "readiness_pct", "readiness_note",
    "missing_signal", "conflict_flag", "assumptions", "user_read"
  ],
  additionalProperties: false,
} as const;

// ─── World Builder Schema ───

// Builder schema — all object types MUST have additionalProperties: false per Anthropic API.
// Enums removed from nested items to keep compiled grammar within limits.
// Fields trimmed to constraint-system essentials (no plot/narrative fields).
export const WORLD_BUILDER_SCHEMA = {
  type: "object",
  properties: {
    scope: {
      type: "object",
      properties: {
        reality_level: { type: "string" },
        tone_rule: { type: "string" },
        violence_level: { type: "string" },
        time_pressure: { type: "string" },
        camera_rule: { type: "string" },
      },
      required: ["reality_level", "tone_rule", "violence_level", "time_pressure", "camera_rule"],
      additionalProperties: false,
    },
    arena: {
      type: "object",
      properties: {
        locations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              description: { type: "string" },
              affordances: { type: "array", items: { type: "string" } },
              access: { type: "string" },
              emotional_register: { type: "string" },
            },
            required: ["id", "name", "description", "affordances", "access", "emotional_register"],
            additionalProperties: false,
          },
        },
        edges: {
          type: "array",
          items: {
            type: "object",
            properties: {
              from: { type: "string" },
              to: { type: "string" },
              traversal: { type: "string" },
            },
            required: ["from", "to", "traversal"],
            additionalProperties: false,
          },
        },
        primary_stage: { type: "string" },
        hidden_stage: { type: "string" },
      },
      required: ["locations", "edges", "primary_stage", "hidden_stage"],
      additionalProperties: false,
    },
    rules: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          domain: { type: "string" },
          rule: { type: "string" },
          consequence_if_broken: { type: "string" },
          who_enforces: { type: "string" },
        },
        required: ["id", "domain", "rule", "consequence_if_broken", "who_enforces"],
        additionalProperties: false,
      },
    },
    factions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          goal: { type: "string" },
          methods: { type: "array", items: { type: "string" } },
          constraints: { type: "array", items: { type: "string" } },
          pressure_on_protagonist: { type: "string" },
        },
        required: ["id", "name", "goal", "methods", "constraints", "pressure_on_protagonist"],
        additionalProperties: false,
      },
    },
    consequence_patterns: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          trigger: { type: "string" },
          world_response: { type: "string" },
          escalation_speed: { type: "string" },
          reversible: { type: "boolean" },
        },
        required: ["id", "trigger", "world_response", "escalation_speed", "reversible"],
        additionalProperties: false,
      },
    },
    canon_register: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          fact: { type: "string" },
          source_module: { type: "string" },
        },
        required: ["id", "fact", "source_module"],
        additionalProperties: false,
      },
    },
    information_access: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          truth: { type: "string" },
          who_knows: { type: "array", items: { type: "string" } },
          dramatic_irony: { type: "string" },
        },
        required: ["id", "truth", "who_knows", "dramatic_irony"],
        additionalProperties: false,
      },
    },
    volatility: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          element: { type: "string" },
          trigger: { type: "string" },
          consequence: { type: "string" },
        },
        required: ["id", "element", "trigger", "consequence"],
        additionalProperties: false,
      },
    },
    world_thesis: { type: "string" },
    pressure_summary: { type: "string" },
  },
  required: [
    "scope", "arena", "rules", "factions", "consequence_patterns",
    "canon_register", "world_thesis", "pressure_summary"
  ],
  additionalProperties: false,
} as const;

// ─── World Judge Schema ───

export const WORLD_JUDGE_SCHEMA = {
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
        constraint_density: { type: "number" },
        arena_distinction: { type: "number" },
        faction_pressure: { type: "number" },
        internal_consistency: { type: "number" },
        consequence_realism: { type: "number" },
        user_fit: { type: "number" },
        scene_variety: { type: "number" },
        information_asymmetry: { type: "number" },
      },
      required: ["constraint_density", "arena_distinction", "faction_pressure", "internal_consistency", "consequence_realism", "user_fit", "scene_variety", "information_asymmetry"],
      additionalProperties: false,
    },
    weakest_element: { type: "string" },
    one_fix_instruction: { type: "string" },
    weaknesses: {
      type: "array",
      items: {
        type: "object",
        properties: {
          area: { type: "string" },
          weakness: { type: "string" },
          development_opportunity: { type: "string" },
        },
        required: ["area", "weakness", "development_opportunity"],
        additionalProperties: false,
      },
    },
    upstream_target_assessment: {
      type: "array",
      items: {
        type: "object",
        properties: {
          target_id: { type: "string" },
          status: { type: "string", enum: ["addressed", "partially_addressed", "unaddressed"] },
          notes: { type: "string" },
        },
        required: ["target_id", "status"],
        additionalProperties: false,
      },
    },
  },
  required: ["pass", "hard_fail_reasons", "scores", "weakest_element", "one_fix_instruction"],
  additionalProperties: false,
} as const;
