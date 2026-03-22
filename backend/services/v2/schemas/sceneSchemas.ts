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
            category: { type: "string", description: "voice, pacing, objective, continuity, constraint" },
            problem: { type: "string" },
            fix_instruction: { type: "string" },
          },
          required: ["category", "problem", "fix_instruction"],
          additionalProperties: false,
        },
      },
    },
    required: ["pass", "issues"],
    additionalProperties: false,
};
