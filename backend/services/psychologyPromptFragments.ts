/**
 * PSYCHOLOGY PROMPT FRAGMENTS
 * ════════════════════════════
 * LAYER: Psychology (the user-insight system, shared across all modules)
 *
 * These fragments define how the LLM builds and refines its understanding of the
 * user's creative psychology. Hypothesis generation, deepening rules, non-action
 * interpretation, psychology-revealing assumptions — anything about understanding
 * WHO the user is, not what they're building.
 *
 * WHEN TO EDIT THIS FILE:
 *   - You want to change how hypotheses are generated or deepened
 *   - You want to change confidence rules or scope definitions
 *   - You want to change how non-actions (ignoring assumptions) are interpreted
 *   - You want to change how psychology-revealing assumptions work
 *
 * WHEN NOT TO EDIT THIS FILE:
 *   - You want to change general interaction behavior → generalPromptFragments.ts
 *   - You want to change module-specific prompts → hookPrompts.ts / characterPrompts.ts
 */

// ─────────────────────────────────────────────────────────────────
// FRAGMENT: USER READ OUTPUT INSTRUCTIONS
// Used in: hook clarifier (output format #12), character clarifier (output format #14)
// Purpose: Tells the LLM what to output in the structured user_read field
// NOTE: Each module may wrap this with module-specific framing.
//       The CORE instruction is shared; the context sentence before it is module-specific.
// ─────────────────────────────────────────────────────────────────
export const SHARED_USER_READ_INSTRUCTIONS = `Output as STRUCTURED JSON (not a freeform string):

  user_read: {
    hypotheses: [  // 1-3 hypotheses about this USER (not the story)
      {
        hypothesis: "short observation, max ~15 words",
        evidence: "what specific user action supports this, max ~25 words",
        confidence: "low" | "medium" | "high",
        scope: "this_story" | "this_genre" | "global"
      }
    ],
    overall_read: "1-2 sentence synthesis of this user's creative fingerprint"
  }

CONFIDENCE ENFORCEMENT (hard rules — the engine will cap these anyway):
  - Turn 1: ALL hypotheses MUST be "low". You have one data point. No exceptions.
  - Turns 2-3: "medium" is the maximum. You're seeing early patterns, not confirmed traits.
  - Turn 4+: "high" is possible, but ONLY if you have consistent evidence from 3+ turns AND from different choice types (e.g. option picks + typing + assumption responses + non-choices).
  - When in doubt, go LOWER. A thoughtful "low" hypothesis with rich evidence is worth more than an inflated "high".

SCOPE:
  - "this_story": Preference specific to this story's content (e.g. "wants the antagonist to be sympathetic")
  - "this_genre": Preference that likely applies to similar stories (e.g. "drawn to power dynamics in dark romance")
  - "global": Interaction style or deep preference (e.g. "control-seeker who prefers to shape rather than discover")

DEEPENING RULE (critical after turn 2):
  After turn 2, every new hypothesis MUST build on, challenge, or refine a prior one — not restate it. Reference the prior hypothesis ID you're building on (e.g. "Refining h4: ...").
  If you can't go deeper than what's already there, output FEWER hypotheses. 1 deep hypothesis > 3 shallow restatements.

  WHAT "DEEPER" MEANS:
  - Surface level: "Director type" / "Likes control" / "Fast decision-maker" → these are LABELS, not insights
  - One level deeper: "Their control instinct is about moral outcomes, not character emotion" → now we know WHAT they control
  - Real depth: "They'll let characters surprise them but not the story's moral message — control is about meaning, not events" → now we understand WHY

  EVOLUTION EXAMPLES:
  Turn 1: "Director type — gives specific instructions rather than exploring options" (low, global)
  Turn 2 WRONG: "Control-oriented — likes to direct the story" ← SAME THING, different words. REJECTED.
  Turn 2 RIGHT: "Their directorial instinct targets moral dimensions specifically — they typed details about the villain's justification but clicked chips for everything else" (low, refining h3)
  Turn 3 RIGHT: "Control is about meaning, not plot — they let me surprise them with a plot twist but immediately reshaped its thematic implication" (medium, refining h3)

RULES:
  - Check YOUR PRIOR HYPOTHESES in the psychology section above. Do NOT repeat them. Instead: confirm (raise evidence), refine (make more specific), or disconfirm (note what contradicted it).
  - Each hypothesis must be DIFFERENT from prior ones. Restating with synonyms is NOT different. You must add NEW information: what specifically, why, in what contexts, with what exceptions.
  - Track CHANGES: did they start typing more? Did energy shift? Did they defer something unusual? Changes are MORE interesting than consistency.
  - Go beyond surface actions. "Clicks a lot" is obvious. WHY those clicks? What do their choice patterns reveal about preferences, fears, emotional pulls?
  - If the user IGNORED certain assumptions last turn (shown in "ASSUMPTIONS IGNORED"), factor that in — it's a weak signal they don't care about those areas yet.
  - The overall_read should EVOLVE each turn — not converge on a catchphrase. If your last overall_read was "fast-moving director who builds from theme outward," this turn's should add nuance, not repeat it.`;

// ─────────────────────────────────────────────────────────────────
// FRAGMENT: NON-ACTION READING
// Used in: hook clarifier (STEP 1 addendum), character clarifier (can be added)
// Purpose: How to interpret what the user DIDN'T do
// ─────────────────────────────────────────────────────────────────
export const SHARED_NON_ACTION_READING = `READ NON-ACTIONS TOO:
  - User didn't type anything, only clicked chips/assumptions → they prefer guided choices, lean into proposals
  - User ignored certain assumptions (didn't click keep/change/not-ready) → they may not care about those, or aren't ready. Don't force them.
  - User skipped the main question and only responded to assumptions → they're more interested in shaping the building blocks than answering your question. Adjust: offer more assumptions next turn, fewer open questions.
  - User typed free text but ignored all chips → they have their own vision, stop offering pre-made options and start riffing WITH them
  - User keeps choosing "not ready" on multiple assumptions → they're exploring, not committing. Stay loose, keep proposing directions.`;

// ─────────────────────────────────────────────────────────────────
// FRAGMENT: PSYCHOLOGY-MOTIVATED ASSUMPTIONS
// Used in: hook clarifier (ASSUMPTIONS section), character clarifier (ASSUMPTIONS section)
// Purpose: Some assumptions should be designed to learn about the USER's creative psychology
// ─────────────────────────────────────────────────────────────────
export const SHARED_PSYCHOLOGY_ASSUMPTIONS = `PSYCHOLOGY-REVEALING ASSUMPTIONS (include 1 per turn when possible):
Not every assumption should be about the story. Some should be designed so that the user's RESPONSE tells you something about THEM — their creative instincts, emotional preferences, risk tolerance, storytelling values.

HOW: Frame a story choice where the alternatives reveal different creative personalities:
  - "The protagonist's secret comes out by accident" → alternatives: "They choose to reveal it" / "Someone betrays them" / "It never fully comes out"
    (Accident = chaos-lover. Chosen reveal = control-seeker. Betrayal = drama-seeker. Hidden = slow-burn thinker.)
  - "The antagonist genuinely cares about the protagonist" → alternatives: "Uses caring as a weapon" / "Cares but would still destroy them" / "Doesn't care at all"
    (Each reveals how the user thinks about moral complexity.)

WHAT YOU LEARN feeds into user_read:
  - Do they gravitate toward control or chaos?
  - Do they prefer moral complexity or clear heroes/villains?
  - Are they drawn to emotional intimacy or power dynamics?
  - Do they like slow reveals or explosive moments?
  - When forced to choose, do they pick the safe option or the risky one?

RULES:
  - These MUST still be valid, useful story assumptions — they serve double duty, not just psychological profiling
  - Don't label them differently from other assumptions — they should look and feel the same to the user
  - The psychological insight is for YOUR user_read, not something you tell the user
  - Don't overthink it: a good assumption naturally reveals something about the chooser`;
