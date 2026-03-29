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
            category: { type: "string", description: "voice, pacing, objective, continuity, constraint, surprise, over_explanation, subtext, volatility, friction, discovery, privileged_legibility" },
            problem: { type: "string" },
            fix_instruction: { type: "string" },
          },
          required: ["category", "problem", "fix_instruction"],
          additionalProperties: false,
        },
      },
      vitality: {
        type: "object",
        description: "Vitality assessment — does the scene feel alive? Each flag requires evidence (quote the specific moment) and quality grading.",
        properties: {
          failed_intention: {
            type: "object",
            description: "A character tried a strategy that didn't land as intended",
            properties: {
              present: { type: "boolean" },
              evidence: { type: "string", description: "Quote or describe the specific moment where the intention failed" },
              quality: { type: "string", enum: ["genuine", "mechanical", "absent"], description: "genuine = emerges from character logic; mechanical = present but feels forced/token" },
            },
            required: ["present", "evidence", "quality"],
            additionalProperties: false,
          },
          non_optimal_response: {
            type: "object",
            description: "A character responded in a way that was NOT the most rational or expected",
            properties: {
              present: { type: "boolean" },
              evidence: { type: "string", description: "Quote or describe the non-optimal response" },
              quality: { type: "string", enum: ["genuine", "mechanical", "absent"] },
            },
            required: ["present", "evidence", "quality"],
            additionalProperties: false,
          },
          behavioral_turn: {
            type: "object",
            description: "A power shift happened through action/gesture/silence, not speech",
            properties: {
              present: { type: "boolean" },
              evidence: { type: "string", description: "Quote or describe the behavioral turn" },
              quality: { type: "string", enum: ["genuine", "mechanical", "absent"] },
            },
            required: ["present", "evidence", "quality"],
            additionalProperties: false,
          },
          asymmetry: {
            type: "object",
            description: "Conversations had power imbalance, misreading, or cornering — not just slightly unequal speaking time",
            properties: {
              present: { type: "boolean" },
              evidence: { type: "string", description: "Quote or describe the asymmetric moment" },
              quality: { type: "string", enum: ["genuine", "mechanical", "absent"] },
            },
            required: ["present", "evidence", "quality"],
            additionalProperties: false,
          },
          discovery: {
            type: "object",
            description: "Scene contains a moment that feels emergent, not pre-scripted — something the plan didn't explicitly call for",
            properties: {
              present: { type: "boolean" },
              evidence: { type: "string", description: "Quote or describe the discovery moment" },
              quality: { type: "string", enum: ["genuine", "mechanical", "absent"] },
            },
            required: ["present", "evidence", "quality"],
            additionalProperties: false,
          },
          over_explanation_lines: { type: "number", description: "Count of lines that sound like scene analysis rather than drama" },
        },
        required: ["failed_intention", "non_optimal_response", "behavioral_turn", "asymmetry", "discovery", "over_explanation_lines"],
        additionalProperties: false,
      },
    },
    required: ["pass", "issues", "vitality"],
    additionalProperties: false,
};
