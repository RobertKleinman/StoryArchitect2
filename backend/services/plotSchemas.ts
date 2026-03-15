/**
 * JSON Schema definitions for Plot & Theme Module structured outputs.
 * Mirrors the TypeScript interfaces in shared/types/plot.ts.
 */

// user_read collapsed to JSON string to keep compiled grammar within Anthropic limits.
// Parsed server-side after LLM response. Prompt instructions constrain the structure.
const USER_READ_SCHEMA = { type: "string" } as const;

// ─── Plot Clarifier Schema ───

export const PLOT_CLARIFIER_SCHEMA = {
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
    plot_focus: { type: "string" },
    ready_for_plot: { type: "boolean" },
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
    "allow_free_text", "ready_for_plot", "readiness_pct", "readiness_note",
    "missing_signal", "conflict_flag", "assumptions", "user_read",
  ],
  additionalProperties: false,
} as const;

// ─── Plot Builder Schema ───

// Builder schema — all object types MUST have additionalProperties: false per Anthropic API.
// The tension_chain is the core output: 12-20 causally-linked beats.
export const PLOT_BUILDER_SCHEMA = {
  type: "object",
  properties: {
    core_conflict: { type: "string" },
    tension_chain: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          beat: { type: "string" },
          causal_logic: { type: "string" },
          question_opened: { type: "string" },
          question_answered: { type: "string" },
          emotional_register: { type: "string" },
          stakes_level: { type: "number" },
          characters_involved: { type: "array", items: { type: "string" } },
        },
        required: ["id", "beat", "causal_logic", "question_opened", "emotional_register", "stakes_level", "characters_involved"],
        additionalProperties: false,
      },
    },
    turning_points: {
      type: "array",
      items: {
        type: "object",
        properties: {
          beat_id: { type: "string" },
          label: { type: "string" },
          believed_before: { type: "string" },
          learned_after: { type: "string" },
          whiplash_direction: { type: "string" },
        },
        required: ["beat_id", "label", "believed_before", "learned_after", "whiplash_direction"],
        additionalProperties: false,
      },
    },
    climax: {
      type: "object",
      properties: {
        beat: { type: "string" },
        why_now: { type: "string" },
        core_conflict_collision: { type: "string" },
      },
      required: ["beat", "why_now", "core_conflict_collision"],
      additionalProperties: false,
    },
    resolution: {
      type: "object",
      properties: {
        new_normal: { type: "string" },
        emotional_landing: { type: "string" },
        ending_energy: { type: "string" },
      },
      required: ["new_normal", "emotional_landing", "ending_energy"],
      additionalProperties: false,
    },
    dramatic_irony_points: {
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
    theme_cluster: {
      type: "object",
      properties: {
        topic: { type: "string" },
        question: { type: "string" },
        statement: { type: "string" },
        countertheme: { type: "string" },
        inferred_from: { type: "string" },
      },
      required: ["topic", "question", "statement", "countertheme", "inferred_from"],
      additionalProperties: false,
    },
    theme_beats: {
      type: "array",
      items: {
        type: "object",
        properties: {
          beat_id: { type: "string" },
          resonance: { type: "string" },
        },
        required: ["beat_id", "resonance"],
        additionalProperties: false,
      },
    },
    motifs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          first_appearance: { type: "string" },
          recurrences: { type: "string" },
          thematic_function: { type: "string" },
        },
        required: ["name", "first_appearance", "recurrences", "thematic_function"],
        additionalProperties: false,
      },
    },
    mystery_hooks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          planted_at_beat: { type: "string" },
          payoff_beat: { type: "string" },
          sustains_through: { type: "string" },
        },
        required: ["question", "planted_at_beat", "sustains_through"],
        additionalProperties: false,
      },
    },
    addiction_engine: { type: "string" },
    collision_sources: {
      type: "array",
      items: {
        type: "object",
        properties: {
          source: { type: "string" },
          element_extracted: { type: "string" },
          applied_to: { type: "string" },
        },
        required: ["source", "element_extracted", "applied_to"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "core_conflict", "tension_chain", "turning_points", "climax",
    "resolution", "dramatic_irony_points", "theme_cluster", "theme_beats",
    "motifs", "mystery_hooks", "addiction_engine", "collision_sources",
  ],
  additionalProperties: false,
} as const;

// ─── Plot Judge Schema ───

export const PLOT_JUDGE_SCHEMA = {
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
        tension_escalation: { type: "number" },
        causal_integrity: { type: "number" },
        twist_quality: { type: "number" },
        mystery_hook_density: { type: "number" },
        dramatic_irony_payoff: { type: "number" },
        climax_earned: { type: "number" },
        ending_satisfaction: { type: "number" },
        user_fit: { type: "number" },
      },
      required: [
        "tension_escalation", "causal_integrity", "twist_quality",
        "mystery_hook_density", "dramatic_irony_payoff", "climax_earned",
        "ending_satisfaction", "user_fit",
      ],
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
          status: { type: "string" },
          quality: { type: "string" },
          current_gap: { type: "string" },
          suggestion: { type: "string" },
          best_module_to_address: { type: "string" },
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
