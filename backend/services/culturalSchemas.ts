/**
 * JSON schemas for Cultural Intelligence Engine structured output.
 */

export const RESEARCH_CONTRACT_SCHEMA = {
  type: "object" as const,
  properties: {
    storyEssence: { type: "string" as const },
    emotionalCore: { type: "string" as const },
    confirmedElements: { type: "array" as const, items: { type: "string" as const } },
    openQuestions: { type: "array" as const, items: { type: "string" as const } },
    userStyleSignals: { type: "array" as const, items: { type: "string" as const } },
    directedReferences: { type: "array" as const, items: { type: "string" as const } },
    negativeProfile: { type: "array" as const, items: { type: "string" as const } },
  },
  required: ["storyEssence", "emotionalCore", "confirmedElements", "openQuestions", "userStyleSignals", "directedReferences", "negativeProfile"],
  additionalProperties: false,
};

export const CULTURAL_BRIEF_SCHEMA = {
  type: "object" as const,
  properties: {
    evidenceItems: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          claim: { type: "string" as const },
          sourceFamily: {
            type: "string" as const,
            enum: ["encyclopedia", "news", "entertainment", "criticism", "social_discourse", "historical", "subcultural"],
          },
          confidence: { type: "string" as const, enum: ["high", "medium", "speculative"] },
          specificDetail: { type: "string" as const },
          storyDimension: { type: "string" as const },
        },
        required: ["claim", "sourceFamily", "confidence", "specificDetail", "storyDimension"],
        additionalProperties: false,
      },
    },
    searchDimensions: { type: "array" as const, items: { type: "string" as const } },
    creativeApplications: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          connection: { type: "string" as const },
          mode: { type: "string" as const, enum: ["abstract", "anchor", "transform"] },
          suggestedUse: { type: "string" as const },
          antiDerivative: { type: "string" as const },
        },
        required: ["connection", "mode", "suggestedUse"],
        additionalProperties: false,
      },
    },
    proposals: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          connection: { type: "string" as const },
          evidence: { type: "string" as const },
          suggestedOption: { type: "string" as const },
          confidence: { type: "string" as const, enum: ["strong", "moderate"] },
        },
        required: ["connection", "evidence", "suggestedOption", "confidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["evidenceItems", "searchDimensions", "creativeApplications", "proposals"],
  additionalProperties: false,
};
