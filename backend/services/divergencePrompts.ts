/**
 * DIVERGENCE EXPLORER PROMPTS & SCHEMA
 * ════════════════════════════════════════
 * LAYER: Divergence (the possibility-space exploration system)
 *
 * Runs as a background LLM call during user think-time (like consolidation).
 * Generates 15-20 radically different story futures from the current creative
 * state, clusters them into direction families, and returns a compact
 * direction map the clarifier can use as inspiration.
 *
 * The clarifier is NOT required to use the direction map. It's a nudge,
 * not a command. The goal: prevent the clarifier from tunneling into the
 * first plausible direction and ignoring the vast possibility space.
 */

export const DIVERGENCE_EXPLORER_SYSTEM = `You are DivergenceExplorer: a creative imagination engine that generates radically different story futures.

You receive the current creative state of a story being developed — the seed idea, confirmed constraints, current direction, and user psychology signals. Your job is to EXPLODE the possibility space.

YOUR MISSION:
Generate 8-12 story futures that are as DIFFERENT from each other as possible. Each future should be a plausible, exciting direction this story could go — not a random idea, but a genuine possibility rooted in the seed and constraints.

RULES FOR GENERATING FUTURES:
1. RESPECT HARD CONSTRAINTS — confirmed user choices (setting, tone, etc.) are fixed. Don't violate them.
2. PUSH SOFT CONSTRAINTS — inferred assumptions are fair game. What if the LLM assumed wrong?
3. MAXIMIZE SPREAD — cover different emotional payoffs, conflict patterns, power dynamics, and scene types.
4. BE SPECIFIC — each future should feel like a specific story, not a genre label.
5. BE VIVID — use concrete nouns, situations, and dynamics. Not abstractions.
6. INCLUDE WILD CARDS — at least 3-4 futures should be surprising directions the user probably hasn't considered.
7. INCLUDE USER-ALIGNED DIRECTIONS — at least 3-4 futures should lean into what the psychology signals say the user wants.

AXES TO COVER (ensure variety across all of these):
- Emotional payoff: shame, thrill, tenderness, dread, wonder, rage, grief, glee, longing, disgust
- Conflict pattern: internal, external, relational, institutional, cosmic
- Power dynamic: dominance, equality, vulnerability, reversal, escalation
- Scene types: intimate confrontation, public exposure, quiet erosion, explosive reveal, ritual, chase, negotiation, seduction, sacrifice

MODULE-SPECIFIC SCOPING:
Stay in your module's lane. The futures you generate should explore the creative territory that belongs to the CURRENT module, not downstream ones.
- In the CHARACTER module: explore different psychological architectures, relationship geometries, vulnerability profiles, behavioral paradoxes, cast compositions. Do NOT generate plot outcomes, ending scenes, or narrative arcs — those belong to the plot module. A character-module future should answer "who could these people BE?" not "what will happen to them?"
- In the HOOK module: explore different premise shapes, emotional promises, tonal directions, genre blends.
- In the WORLD module: explore different settings, rules, faction structures, environmental pressures.
- In the PLOT module: NOW you can explore narrative arcs, turning points, ending shapes, scene sequences.

THEN CLUSTER:
Group your 8-12 futures into 3-5 "direction families" — clusters that share emotional/structural DNA.
Name each family with a vivid 3-5 word label.
Rate each family's novelty (0-1) relative to what the clarifier is currently exploring.

FINALLY:
Identify the single biggest BLIND SPOT — the most interesting unexplored direction that the current conversation is missing entirely.

OUTPUT: Return valid JSON matching the schema. No markdown fences. No commentary.`;

export const DIVERGENCE_EXPLORER_USER_TEMPLATE = `Explore the possibility space for this story being developed.

═══ SEED IDEA ═══
{{SEED_INPUT}}

═══ CONFIRMED CONSTRAINTS (do NOT violate these) ═══
{{CONFIRMED_CONSTRAINTS}}

═══ CURRENT DIRECTION (what the clarifier is converging toward) ═══
{{CURRENT_STATE}}

═══ INFERRED ASSUMPTIONS (these CAN be challenged) ═══
{{INFERRED_ASSUMPTIONS}}

═══ USER PSYCHOLOGY (what we know about this user's preferences) ═══
{{PSYCHOLOGY_SUMMARY}}

═══ PREVIOUS DIRECTION FAMILIES (from your last exploration) ═══
{{PREVIOUS_FAMILIES}}
If you generated families before, push into NEW territory this time. The clarifier has already seen those directions — repeating them wastes the opportunity to expand the possibility space. You CAN revisit a previous family's territory if you go DEEPER (more specific, more surprising) but don't regenerate the same broad strokes.

═══ CONVERSATION TURN ═══
Turn: {{TURN_NUMBER}}
Module: {{MODULE}}

Generate 8-10 radically different story futures, cluster them into 3-5 direction families, and identify the biggest blind spot. Remember: the goal is to EXPAND the possibility space, not to pick the best direction. Every family should feel like a genuinely different story the user might love.

IMPORTANT: Keep each future's sketch and hook to 1-2 sentences max. Be vivid but concise — density over length.`;

/**
 * Plain JSON Schema for divergence explorer structured output.
 * Convention: all schemas are plain objects (type: "object" at top level).
 * Providers wrap them in their own format.
 */
export const DIVERGENCE_EXPLORER_SCHEMA = {
  type: "object",
  properties: {
    families: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          signature: { type: "string" },
          futures: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                sketch: { type: "string" },
                emotionalPayoff: { type: "string" },
                // Enums removed to keep compiled grammar within Anthropic limits.
                // The prompt instructions still constrain valid values.
                conflictPattern: { type: "string" },
                powerDynamic: { type: "string" },
                hook: { type: "string" },
              },
              required: ["label", "sketch", "emotionalPayoff", "conflictPattern", "powerDynamic", "hook"],
              additionalProperties: false,
            },
          },
          novelty: { type: "number" },
        },
        required: ["name", "signature", "futures", "novelty"],
        additionalProperties: false,
      },
    },
    blindSpot: { type: "string" },
    convergenceNote: { type: "string" },
  },
  required: ["families", "blindSpot", "convergenceNote"],
  additionalProperties: false,
};
