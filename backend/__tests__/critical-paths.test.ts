import { describe, it, expect } from "vitest";
import { normalizeStringifiedFields, buildMustHonorBlock } from "../services/mustHonorBlock";

// ─── 1. normalizeStringifiedFields ───

describe("normalizeStringifiedFields", () => {
  it("parses user_read from JSON string to object", () => {
    const data: Record<string, unknown> = {
      user_read: '{"archetype":"explorer","confidence_score":0.8}',
    };
    normalizeStringifiedFields(data);
    expect(data.user_read).toEqual({ archetype: "explorer", confidence_score: 0.8 });
  });

  it("parses scope_recommendation from JSON string to object", () => {
    const data: Record<string, unknown> = {
      scope_recommendation: '{"recommended_cast":"duo","recommended_length":"medium","reasoning":"test"}',
    };
    normalizeStringifiedFields(data);
    expect(data.scope_recommendation).toEqual({
      recommended_cast: "duo",
      recommended_length: "medium",
      reasoning: "test",
    });
  });

  it("leaves already-object values unchanged", () => {
    const obj = { archetype: "explorer" };
    const data: Record<string, unknown> = { user_read: obj };
    normalizeStringifiedFields(data);
    expect(data.user_read).toBe(obj);
  });

  it("nulls out invalid JSON strings gracefully", () => {
    const data: Record<string, unknown> = {
      user_read: "not valid json {{{",
      scope_recommendation: "{broken",
    };
    normalizeStringifiedFields(data);
    expect(data.user_read).toBeNull();
    expect(data.scope_recommendation).toBeNull();
  });

  it("ignores empty strings", () => {
    const data: Record<string, unknown> = { user_read: "" };
    normalizeStringifiedFields(data);
    expect(data.user_read).toBe("");
  });

  it("ignores missing keys", () => {
    const data: Record<string, unknown> = { other_field: "hello" };
    normalizeStringifiedFields(data);
    expect(data.other_field).toBe("hello");
    expect(data.user_read).toBeUndefined();
  });
});

// ─── 2. buildMustHonorBlock ───

describe("buildMustHonorBlock", () => {
  it("includes only confirmed entries", () => {
    const ledger = [
      { key: "genre", value: "romance", confidence: "confirmed" },
      { key: "tone", value: "dark", confidence: "inferred" },
      { key: "setting", value: "modern", confidence: "confirmed" },
    ];
    const result = buildMustHonorBlock(ledger);
    expect(result).toContain("GENRE: romance");
    expect(result).toContain("SETTING: modern");
    expect(result).not.toContain("tone");
    expect(result).not.toContain("dark");
  });

  it("returns empty string for empty ledger", () => {
    expect(buildMustHonorBlock([])).toBe("");
  });

  it("returns empty string when all entries are inferred", () => {
    const ledger = [
      { key: "genre", value: "romance", confidence: "inferred" },
      { key: "tone", value: "dark", confidence: "speculative" },
    ];
    expect(buildMustHonorBlock(ledger)).toBe("");
  });

  it("uppercases keys in output", () => {
    const ledger = [{ key: "emotional_promise", value: "heartbreak", confidence: "confirmed" }];
    const result = buildMustHonorBlock(ledger);
    expect(result).toContain("EMOTIONAL_PROMISE: heartbreak");
  });

  it("includes MUST HONOR header", () => {
    const ledger = [{ key: "genre", value: "romance", confidence: "confirmed" }];
    const result = buildMustHonorBlock(ledger);
    expect(result).toContain("MUST HONOR");
  });
});

// ─── 3. Array-to-Record conversion (character builder output) ───

describe("character array-to-record conversion", () => {
  it("converts characters array to Record<role, profile>", () => {
    // Reproduces the conversion logic from characterService.ts line ~659
    const charactersArray = [
      { role: "protagonist", description: "A brave hero", want: "freedom" },
      { role: "antagonist", description: "A dark villain", want: "power" },
      { role: "love_interest", description: "A mysterious stranger", want: "connection" },
    ];

    const charsRecord: Record<string, any> = {};
    for (const profile of charactersArray) {
      if (profile.role) {
        charsRecord[profile.role] = profile;
      }
    }

    expect(Object.keys(charsRecord)).toEqual(["protagonist", "antagonist", "love_interest"]);
    expect(charsRecord.protagonist.description).toBe("A brave hero");
    expect(charsRecord.antagonist.want).toBe("power");
  });

  it("skips entries without role field", () => {
    const charactersArray = [
      { role: "protagonist", description: "Hero" },
      { description: "No role" } as any,
    ];

    const charsRecord: Record<string, any> = {};
    for (const profile of charactersArray) {
      if (profile.role) {
        charsRecord[profile.role] = profile;
      }
    }

    expect(Object.keys(charsRecord)).toEqual(["protagonist"]);
  });
});

// ─── 4. Character pack export completeness ───

describe("character pack export completeness", () => {
  it("includes age_range and ethnicity in locked characters", () => {
    // Simulates the lock logic from characterService.ts line ~944
    const cast = {
      characters: {
        protagonist: {
          role: "protagonist",
          description: "A brave warrior",
          presentation: "masculine" as const,
          age_range: "young_adult",
          ethnicity: "East Asian",
          core_dials: { want: "freedom", fear: "captivity", ghost: "imprisonment" },
          secondary_dials: {},
          threshold_statement: "When pushed to the edge",
          competence_axis: "combat",
          cost_type: "physical",
          volatility: "moderate",
        },
      },
      ensemble_dynamic: "rivals forced to cooperate",
      relationship_tensions: ["power struggle"],
      differentiation_matrix: {
        protagonist: {
          stress_response: "fight",
          communication_style: "direct",
          core_value: "honor",
          power_strategy: "force",
        },
      },
    };

    const lockedCharacters: Record<string, any> = {};
    for (const [role, profile] of Object.entries(cast.characters)) {
      lockedCharacters[role] = {
        role: profile.role,
        description: profile.description,
        presentation: profile.presentation ?? "unspecified",
        age_range: profile.age_range,
        ethnicity: profile.ethnicity,
        psychological_profile: {
          ...profile.core_dials,
          ...profile.secondary_dials,
        },
        threshold_statement: profile.threshold_statement ?? "",
        competence_axis: profile.competence_axis ?? "",
        cost_type: profile.cost_type ?? "",
        volatility: profile.volatility ?? "",
      };
    }

    const pack = {
      module: "character",
      locked: {
        characters: lockedCharacters,
        ensemble_dynamic: cast.ensemble_dynamic,
        relationship_tensions: cast.relationship_tensions,
        cast_count: Object.keys(cast.characters).length,
        differentiation_matrix: cast.differentiation_matrix,
      },
    };

    // Verify age_range and ethnicity are in locked character
    expect(pack.locked.characters.protagonist.age_range).toBe("young_adult");
    expect(pack.locked.characters.protagonist.ethnicity).toBe("East Asian");

    // Verify differentiation_matrix is in pack
    expect(pack.locked.differentiation_matrix).toBeDefined();
    expect(pack.locked.differentiation_matrix!.protagonist.stress_response).toBe("fight");

    // Verify cast_count
    expect(pack.locked.cast_count).toBe(1);
  });

  it("handles missing optional fields gracefully", () => {
    const profile = {
      role: "protagonist",
      description: "A warrior",
      presentation: undefined,
      age_range: undefined,
      ethnicity: undefined,
      core_dials: { want: "freedom", fear: "chains", ghost: "past" },
      secondary_dials: {},
    };

    const locked = {
      role: profile.role,
      description: profile.description,
      presentation: profile.presentation ?? "unspecified",
      age_range: profile.age_range,
      ethnicity: profile.ethnicity,
      psychological_profile: {
        ...profile.core_dials,
        ...profile.secondary_dials,
      },
    };

    expect(locked.presentation).toBe("unspecified");
    expect(locked.age_range).toBeUndefined();
    expect(locked.ethnicity).toBeUndefined();
  });
});
