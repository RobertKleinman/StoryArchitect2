/**
 * v2 JSON Schemas — Scene Generation (Step 6)
 */

export const SCENE_WRITER_SCHEMA = {
    type: "object",
    properties: {
      scene_id: { type: "string" },
      title: { type: "string" },
      setting: { type: "string" },
      characters_present: { type: "array", items: { type: "string" } },
      pov_character: { type: "string" },
      lines: {
        type: "array",
        items: {
          type: "object",
          properties: {
            speaker: { type: "string", description: "Character name, NARRATION, or INTERNAL" },
            text: { type: "string" },
            emotion: { type: ["string", "null"] },
            stage_direction: { type: ["string", "null"] },
            delivery: { type: ["string", "null"], description: "Parenthetical like (whispering), (sarcastically)" },
          },
          required: ["speaker", "text"],
          additionalProperties: false,
        },
      },
      transition_out: { type: ["string", "null"], description: "How the scene ends visually (fade, cut, etc.)" },
    },
    required: ["scene_id", "title", "setting", "characters_present", "pov_character", "lines"],
    additionalProperties: false,
};

export const SCENE_JUDGE_SCHEMA = {
    type: "object",
    properties: {
      pass: { type: "boolean" },
      issues: {
        type: "array",
        items: {
          type: "object",
          properties: {
            category: { type: "string", description: "voice, pacing, objective, continuity, constraint, surprise, over_explanation, subtext, volatility, friction, discovery" },
            problem: { type: "string" },
            fix_instruction: { type: "string" },
          },
          required: ["category", "problem", "fix_instruction"],
          additionalProperties: false,
        },
      },
      vitality: {
        type: "object",
        description: "Vitality assessment — does the scene feel alive?",
        properties: {
          has_failed_intention: { type: "boolean", description: "At least one character tried something that didn't land as intended" },
          has_non_optimal_response: { type: "boolean", description: "At least one response was not the most rational/expected" },
          has_behavioral_turn: { type: "boolean", description: "At least one shift happened through action/gesture/silence, not speech" },
          has_asymmetry: { type: "boolean", description: "Conversations had power imbalance, misreading, or cornering" },
          has_discovery: { type: "boolean", description: "Scene contains a moment that feels emergent, not pre-scripted" },
          over_explanation_lines: { type: "number", description: "Count of lines that sound like scene analysis rather than drama" },
        },
        required: ["has_failed_intention", "has_non_optimal_response", "has_behavioral_turn", "has_asymmetry", "has_discovery", "over_explanation_lines"],
        additionalProperties: false,
      },
    },
    required: ["pass", "issues", "vitality"],
    additionalProperties: false,
};
