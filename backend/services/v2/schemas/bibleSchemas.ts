/**
 * v2 JSON Schemas — Bible Generation (Step 4)
 *
 * These are simplified schemas that reuse the domain structures
 * from the existing types. The LLM outputs match these schemas
 * and are then mapped to the artifact types.
 */

export const WORLD_WRITER_SCHEMA = {
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
              },
              required: ["id", "name", "description", "affordances"],
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
                traversal_cost: { type: "string" },
              },
              required: ["from", "to", "traversal_cost"],
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
            domain: { type: "string" },
            rule: { type: "string" },
            consequence: { type: "string" },
          },
          required: ["domain", "rule", "consequence"],
          additionalProperties: false,
        },
      },
      factions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            goal: { type: "string" },
            methods: { type: "string" },
            pressure_on_protagonist: { type: "string" },
          },
          required: ["name", "goal", "methods", "pressure_on_protagonist"],
          additionalProperties: false,
        },
      },
      consequence_patterns: {
        type: "array",
        items: {
          type: "object",
          properties: {
            trigger: { type: "string" },
            consequence: { type: "string" },
            severity: { type: "string" },
          },
          required: ["trigger", "consequence", "severity"],
          additionalProperties: false,
        },
      },
      canon_facts: {
        type: "array",
        items: { type: "string" },
      },
      world_thesis: { type: "string" },
    },
    required: ["scope", "arena", "rules", "factions", "consequence_patterns", "canon_facts", "world_thesis"],
    additionalProperties: false,
};

export const CHARACTER_WRITER_SCHEMA = {
    type: "object",
    properties: {
      characters: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            role: { type: "string" },
            description: { type: "string" },
            presentation: { type: "string" },
            age_range: { type: "string" },
            psychological_profile: {
              type: "object",
              properties: {
                want: { type: "string" },
                misbelief: { type: "string" },
                stress_style: { type: "string" },
                break_point: { type: "string" },
                voice_pattern: { type: "string" },
              },
              required: ["want", "misbelief", "stress_style", "break_point", "voice_pattern"],
              additionalProperties: false,
            },
            threshold_statement: { type: "string" },
            competence_axis: { type: "string" },
          },
          required: ["name", "role", "description", "presentation", "age_range",
                     "psychological_profile", "threshold_statement", "competence_axis"],
          additionalProperties: false,
        },
      },
      relationships: {
        type: "array",
        items: {
          type: "object",
          properties: {
            between: { type: "array", items: { type: "string" }, description: "Exactly two character names" },
            nature: { type: "string" },
            stated_dynamic: { type: "string" },
            true_dynamic: { type: "string" },
          },
          required: ["between", "nature", "stated_dynamic", "true_dynamic"],
          additionalProperties: false,
        },
      },
      ensemble_dynamic: { type: "string" },
    },
    required: ["characters", "relationships", "ensemble_dynamic"],
    additionalProperties: false,
};

export const PLOT_WRITER_SCHEMA = {
    type: "object",
    properties: {
      core_conflict: { type: "string" },
      tension_chain: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            beat: { type: "string", description: "What happens — 1-2 sentences max. State cause before effect. Be concrete." },
            causal_logic: { type: "string", description: "WHY does this beat follow from the previous? 1-2 sentences naming the specific cause." },
            stakes_level: { type: "number", description: "1-10 tension level. Generally escalates; dips before jumps OK. First beat 2-4, pre-climax 8-10." },
            characters_involved: { type: "array", items: { type: "string" } },
            question_opened: { type: ["string", "null"], description: "What question this beat plants in the reader's mind" },
          },
          required: ["id", "beat", "causal_logic", "stakes_level", "characters_involved"],
          additionalProperties: false,
        },
      },
      turning_points: {
        type: "array",
        items: {
          type: "object",
          properties: {
            beat_id: { type: "string" },
            type: { type: "string" },
            reversal: { type: "string" },
          },
          required: ["beat_id", "type", "reversal"],
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
        },
        required: ["topic", "question", "statement", "countertheme"],
        additionalProperties: false,
      },
      dramatic_irony_points: {
        type: "array",
        items: {
          type: "object",
          properties: {
            what_audience_knows: { type: "string" },
            what_character_believes: { type: "string" },
            tension_created: { type: "string" },
          },
          required: ["what_audience_knows", "what_character_believes", "tension_created"],
          additionalProperties: false,
        },
      },
      motifs: {
        type: "array",
        items: {
          type: "object",
          properties: {
            symbol: { type: "string" },
            meaning: { type: "string" },
            appearances: { type: "array", items: { type: "string" } },
          },
          required: ["symbol", "meaning", "appearances"],
          additionalProperties: false,
        },
      },
      mystery_hooks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            question: { type: "string" },
            planted_at: { type: "string" },
            answered_at: { type: ["string", "null"] },
          },
          required: ["question", "planted_at"],
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
      dirty_hands: {
        type: "object",
        description: "The moment the protagonist must do something morally wrong to achieve something right. Required.",
        properties: {
          beat_id: { type: "string", description: "Which beat contains the moral compromise" },
          what_they_do: { type: "string", description: "The specific wrong act — a lie, manipulation, sacrifice of someone's safety" },
          why_necessary: { type: "string", description: "Why the right outcome required this wrong act" },
          cost: { type: "string", description: "What this act costs the protagonist internally — not just consequences, but self-knowledge" },
        },
        required: ["beat_id", "what_they_do", "why_necessary", "cost"],
        additionalProperties: false,
      },
      addiction_engine: { type: "string" },
    },
    required: ["core_conflict", "tension_chain", "turning_points", "theme_cluster",
               "dramatic_irony_points", "motifs", "mystery_hooks", "climax",
               "resolution", "dirty_hands", "addiction_engine"],
    additionalProperties: false,
};

export const BIBLE_JUDGE_SCHEMA = {
    type: "object",
    properties: {
      pass: { type: "boolean" },
      consistency_issues: {
        type: "array",
        items: {
          type: "object",
          properties: {
            section: { type: "string", description: "world, characters, or plot" },
            issue: { type: "string" },
            severity: { type: "string", enum: ["critical", "major", "minor"] },
            fix_instruction: { type: "string", description: "Specific instruction for regeneration — what to change and how" },
          },
          required: ["section", "issue", "severity", "fix_instruction"],
          additionalProperties: false,
        },
      },
      quality_issues: {
        type: "array",
        description: "Dramatic quality issues (moral compromise, grounding, register, names, etc.)",
        items: {
          type: "object",
          properties: {
            dimension: { type: "string", description: "moral_compromise | emotional_grounding | violence_consequences | register_variation | antagonist | mirror_exploitation | name_quality" },
            issue: { type: "string" },
            severity: { type: "string", enum: ["critical", "major", "minor"] },
            fix_instruction: { type: "string", description: "Specific instruction for regeneration" },
          },
          required: ["dimension", "issue", "severity", "fix_instruction"],
          additionalProperties: false,
        },
      },
      constraint_violations: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: ["pass", "consistency_issues", "quality_issues", "constraint_violations"],
    additionalProperties: false,
};

export const SCENE_PLANNER_SCHEMA = {
    type: "object",
    properties: {
      scenes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            scene_id: { type: "string" },
            beat_ids: { type: "array", items: { type: "string" } },
            title: { type: "string" },
            purpose: { type: "string" },
            setting: { type: "string" },
            characters_present: { type: "array", items: { type: "string" } },
            pov_character: { type: "string" },
            objective: {
              type: "object",
              properties: {
                want: { type: "string" },
                opposition: { type: "string" },
                stakes: { type: "string" },
              },
              required: ["want", "opposition", "stakes"],
              additionalProperties: false,
            },
            emotion_arc: {
              type: "object",
              properties: {
                start: { type: "string" },
                trigger: { type: "string" },
                end: { type: "string" },
              },
              required: ["start", "trigger", "end"],
              additionalProperties: false,
            },
            exit_hook: { type: "string" },
            pacing_type: {
              type: "string",
              enum: ["pressure_cooker", "slow_burn", "whiplash", "aftermath", "set_piece"],
            },
            content_directives: {
              type: "array",
              items: { type: "string" },
              description: "Factual routing instructions for the scene writer: explicit content requirements, specific required elements, hard constraints. NO thematic or emotional framing — only concrete directives.",
            },
          },
          required: ["scene_id", "beat_ids", "title", "purpose", "setting",
                     "characters_present", "pov_character", "objective",
                     "emotion_arc", "exit_hook", "pacing_type"],
          additionalProperties: false,
        },
      },
      estimated_word_count: { type: "number" },
    },
    required: ["scenes", "estimated_word_count"],
    additionalProperties: false,
};
