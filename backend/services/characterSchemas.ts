/**
 * JSON Schema definitions for Character Module structured outputs.
 * Mirrors the TypeScript interfaces in shared/types/character.ts.
 */

// Simplified: state updates use key/value pairs instead of 23+ typed properties.
// The clarifier typically only updates 2-5 dials per character per turn.
const stateUpdateEntrySchema = {
  type: "object",
  properties: {
    dial: { type: "string" },   // e.g. "want", "misbelief", "stress_style"
    value: { type: "string" },  // the inferred/updated value
  },
  required: ["dial", "value"],
  additionalProperties: false,
} as const;

export const CHARACTER_CLARIFIER_SCHEMA = {
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
    ready_for_characters: { type: "boolean" },
    readiness_pct: { type: "number" },
    readiness_note: { type: "string" },
    missing_signal: { type: "string" },
    conflict_flag: { type: "string" },
    characters_surfaced: {
      type: "array",
      items: {
        type: "object",
        properties: {
          role: { type: "string" },
          newToConversation: { type: "boolean" },
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
        },
        required: ["role", "newToConversation", "assumptions"],
        additionalProperties: false,
      },
    },
    relationship_updates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          characterA: { type: "string" },
          characterB: { type: "string" },
          statedDynamic: { type: "string" },
          trueDynamic: { type: "string" },
        },
        required: ["characterA", "characterB", "statedDynamic", "trueDynamic"],
        additionalProperties: false,
      },
    },
    state_updates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          role: { type: "string" },
          updates: {
            type: "array",
            items: stateUpdateEntrySchema,
          },
        },
        required: ["role", "updates"],
        additionalProperties: false,
      },
    },
    // user_read collapsed to JSON string to keep compiled grammar within Anthropic limits.
    // Parsed server-side after LLM response.
    user_read: { type: "string" },
  },
  required: [
    "psychology_strategy", "hypothesis_line", "question", "options", "allow_free_text",
    "character_focus", "ready_for_characters", "readiness_pct",
    "readiness_note", "missing_signal", "conflict_flag",
    "characters_surfaced", "relationship_updates", "state_updates", "user_read",
  ],
  additionalProperties: false,
} as const;

const characterProfileSchema = {
  type: "object",
  properties: {
    role: { type: "string" },
    description: { type: "string" },
    // Enums removed to keep compiled grammar within Anthropic limits; prompt constrains values.
    presentation: { type: "string" },
    age_range: { type: "string" },
    ethnicity: { type: "string" },
    core_dials: {
      type: "object",
      properties: {
        want: { type: "string" },
        want_urgency: { type: "string" },
        misbelief: { type: "string" },
        stakes: { type: "string" },
        break_point: { type: "string" },
      },
      required: ["want", "want_urgency", "misbelief", "stakes", "break_point"],
      additionalProperties: false,
    },
    secondary_dials: {
      type: "object",
      properties: {
        leverage: { type: "string" },
        secret: { type: "string" },
        secret_trigger: { type: "string" },
        sacrifice_threshold: { type: "string" },
        temptation: { type: "string" },
        stress_style: { type: "string" },
        optimization_function: { type: "string" },
        backstory: { type: "string" },
        competence: { type: "string" },
        vulnerability: { type: "string" },
        tell: { type: "string" },
        voice_pattern: { type: "string" },
        guilty_pleasure: { type: "string" },
      },
      required: [
        "leverage", "secret", "secret_trigger", "sacrifice_threshold", "temptation",
        "stress_style", "optimization_function", "backstory", "competence",
        "vulnerability", "tell", "voice_pattern", "guilty_pleasure",
      ],
      additionalProperties: false,
    },
    antagonist_dials: {
      type: "object",
      properties: {
        moral_logic: { type: "string" },
        strategy_under_constraint: { type: "string" },
        targeted_attack: { type: "string" },
      },
      required: ["moral_logic", "strategy_under_constraint", "targeted_attack"],
      additionalProperties: false,
    },
    supporting_dials: {
      type: "object",
      properties: {
        role_function: { type: "string" },
        misread: { type: "string" },
        spark: { type: "string" },
      },
      required: ["role_function", "misread", "spark"],
      additionalProperties: false,
    },
    threshold_statement: { type: "string" },
    competence_axis: { type: "string" },
    cost_type: { type: "string" },
    volatility: { type: "string" },
  },
  required: ["role", "description", "presentation", "core_dials", "secondary_dials", "antagonist_dials", "supporting_dials", "threshold_statement", "competence_axis", "cost_type", "volatility"],
  additionalProperties: false,
} as const;

export const CHARACTER_BUILDER_SCHEMA = {
  type: "object",
  properties: {
    characters: {
      type: "array",
      items: characterProfileSchema,
    },
    ensemble_dynamic: { type: "string" },
    relationship_tensions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          pair: { type: "array", items: { type: "string" } },
          stated_dynamic: { type: "string" },
          true_dynamic: { type: "string" },
          tension_mechanism: { type: "string" },
        },
        required: ["pair", "stated_dynamic", "true_dynamic", "tension_mechanism"],
        additionalProperties: false,
      },
    },
    structural_diversity: {
      type: "object",
      properties: {
        diverse: { type: "boolean" },
        explanation: { type: "string" },
      },
      required: ["diverse", "explanation"],
      additionalProperties: false,
    },
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
    differentiation_matrix: {
      type: "array",
      items: {
        type: "object",
        properties: {
          role: { type: "string" },
          stress_response: { type: "string" },
          communication_style: { type: "string" },
          core_value: { type: "string" },
          power_strategy: { type: "string" },
        },
        required: ["role", "stress_response", "communication_style", "core_value", "power_strategy"],
        additionalProperties: false,
      },
    },
  },
  required: ["characters", "ensemble_dynamic", "relationship_tensions", "structural_diversity", "collision_sources", "differentiation_matrix"],
  additionalProperties: false,
} as const;

export const CHARACTER_JUDGE_SCHEMA = {
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
        psychological_depth: { type: "number" },
        relationship_dynamics: { type: "number" },
        diversity: { type: "number" },
        mechanism_clarity: { type: "number" },
        specificity: { type: "number" },
        user_fit: { type: "number" },
      },
      required: ["psychological_depth", "relationship_dynamics", "diversity", "mechanism_clarity", "specificity", "user_fit"],
      additionalProperties: false,
    },
    weakest_character: { type: "string" },
    one_fix_instruction: { type: "string" },
    weaknesses: {
      type: "array",
      items: {
        type: "object",
        properties: {
          role: { type: "string" },
          weakness: { type: "string" },
          development_opportunity: { type: "string" },
        },
        required: ["role", "weakness", "development_opportunity"],
        additionalProperties: false,
      },
    },
  },
  required: ["analysis", "pass", "hard_fail_reasons", "scores", "weakest_character", "one_fix_instruction", "weaknesses"],
  additionalProperties: false,
} as const;
