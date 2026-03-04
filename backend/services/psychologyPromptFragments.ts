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
        scope: "this_story" | "this_genre" | "global",
        category: "content_preferences" | "control_orientation" | "power_dynamics" | "tonal_risk" | "narrative_ownership" | "engagement_satisfaction"
      }
    ],
    overall_read: "1-2 sentence synthesis of this user's creative fingerprint",
    satisfaction: {
      score: 0.0-1.0,  // your honest assessment of how satisfied/engaged they are
      trend: "rising" | "stable" | "declining",
      note: "brief reason — what tells you this? max ~15 words"
    }
  }

SATISFACTION ASSESSMENT:
  You have the full conversational context — use it. Assess how the user is FEELING about this experience.
  - score: 0.0 = frustrated/disengaged, 0.5 = neutral/going through the motions, 1.0 = delighted/deeply invested
  - trend: is their satisfaction going up, holding steady, or declining compared to prior turns?
  - note: what specific signals inform your read? (e.g. "longer responses, more specific requests" or "shorter answers, ignoring assumptions")

  IMPORTANT: A user who changes many assumptions may be HIGHLY satisfied — they're engaged and opinionated.
  A user who keeps everything may be passive or bored. Read the CONTEXT, not just the numbers.
  Turn 1: default to 0.5/stable unless their seed shows obvious enthusiasm.

HYPOTHESIS CATEGORIES (assign exactly one per hypothesis):
  - "content_preferences": What they explicitly want — themes, genres, kinks, aesthetics, tones
  - "control_orientation": How much they want to drive vs be surprised
  - "power_dynamics": Their fascination with hierarchy, authority, dominance, submission
  - "tonal_risk": How far they push boundaries, appetite for transgression
  - "narrative_ownership": How protective they are of their vision, audience awareness
  - "engagement_satisfaction": How they're feeling about the experience itself

CONFIDENCE ENFORCEMENT (hard rules — the engine will cap these anyway):
  - Turn 1: ALL hypotheses MUST be "low". You have one data point. No exceptions.
  - Turns 2-3: "medium" is the maximum. You're seeing early patterns, not confirmed traits.
  - Turn 4+: "high" is EXPECTED for hypotheses with consistent evidence from 3+ turns. If a hypothesis has been confirmed or deepened across multiple turns without contradiction, PROMOTE it to "high". Don't stay at "medium" forever — that's wasted signal.
  - PROMOTION TRIGGERS (turn 4+): A hypothesis SHOULD be "high" when:
    - The same pattern appears in 3+ turns (even if the hypothesis text evolved/deepened)
    - Evidence comes from different choice types (option picks + typing + assumption responses)
    - The user hasn't contradicted or moved away from the pattern
    - You've deepened the hypothesis beyond surface level (you understand the WHY, not just the WHAT)
  - Still "medium" when: you're seeing the pattern but haven't understood the underlying motivation yet, or evidence comes from only one choice type.
  - Still "low" when: it's a new hypothesis even if we're on a late turn.
  - When in doubt between "medium" and "high" on turn 4+, lean toward "high" if the evidence is multi-turn. The system benefits more from confident signals than from perpetual hedging.

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

// ─────────────────────────────────────────────────────────────────
// FRAGMENT: OBVIOUS PATTERN DETECTION
// Used in: all clarifiers (before subtle analysis)
// Purpose: Ensure the system catches explicit content preferences FIRST
// ─────────────────────────────────────────────────────────────────
export const OBVIOUS_PATTERN_DETECTION = `OBVIOUS PATTERN DETECTION (do this FIRST, before subtle analysis):

Before looking for hidden patterns, identify what the user is EXPLICITLY telling you. This is critical —
the system should never be so focused on subtle psychological insights that it misses the obvious.

CAPTURE FIRST:
  - Direct content requests (genres, themes, kinks, aesthetics, specific things they asked for)
  - Stated preferences ("I want...", "I like...", repeated emphasis on specific elements)
  - Obvious fixations (topics returned to multiple times, things they highlight or emphasize)
  - Explicit fetishes, interests, or thematic obsessions stated in the seed or free text

Record these as hypotheses in category "content_preferences" with appropriate confidence:
  - Turn 1 explicit statement → "low" confidence (it's their first words, but still explicit)
  - Repeated emphasis or return to same topic → bump confidence

ONLY AFTER capturing the obvious should you look for subtler dimensions:
  - Control orientation (do they want to drive or be surprised?)
  - Power dynamics fascination (hierarchy, authority, submission patterns)
  - Tonal risk appetite (how far they push boundaries, absurdity tolerance)
  - Narrative ownership (how protective of their vision, audience awareness)
  - Audience framing sensitivity (who do they imagine consuming this?)

The OBVIOUS and the SUBTLE are BOTH important. But never skip the obvious to look clever.`;

// ─────────────────────────────────────────────────────────────────
// FRAGMENT: DIAGNOSTIC OPTIONS GUIDANCE
// Used in: all clarifiers (assumption design)
// Purpose: Some options should be designed to reveal creative psychology
// ─────────────────────────────────────────────────────────────────
export const DIAGNOSTIC_OPTIONS_GUIDANCE = `DIAGNOSTIC OPTIONS (1-2 per turn):
1-2 of your assumption options per turn should be intentionally diagnostic — designed to reveal
something about the user's creative psychology if chosen. These should feel NATURAL, not like a survey.

Example: offering "character keeps their power hidden" vs "character flaunts their power openly" vs
"character is unaware of their power" reveals control orientation and power dynamics preferences.

These diagnostic options serve the story AND reveal the user. They must:
  - Be genuinely good story options (not just psych tests)
  - Feel natural alongside non-diagnostic options
  - Cover different psychological dimensions across turns (don't keep testing the same thing)
  - Feed insights into your user_read hypotheses when the user chooses`;

// ─────────────────────────────────────────────────────────────────
// FRAGMENT: ASSUMPTION PERSISTENCE CHECK
// Used in: all clarifiers (before generating new assumptions)
// Purpose: Ensure prior changes are tracked and deepened
// ─────────────────────────────────────────────────────────────────
export const ASSUMPTION_PERSISTENCE_CHECK = `ASSUMPTION PERSISTENCE CHECK (before generating new assumptions):
Review the PERSISTENCE SUMMARY in the psychology ledger (if present). This tells you which of the
user's prior assumption changes are still active vs faded.

RULES:
  - If a prior change is marked as "still active" → do NOT re-offer the same assumption. Instead,
    go DEEPER on that dimension. The user already chose — now build on their choice.
  - If a prior change is marked as "faded" → the user may have moved past it, or it didn't go
    deep enough. Try a new angle on that dimension, or let it go.
  - If SATISFACTION is declining → you may be offering assumptions that don't match their vision.
    Listen harder to their free text and explicit requests.

Every assumption MUST have at least 3 alternatives. Never offer only 2 — the user needs meaningful
choice, and 2 options feel like a binary trap. 3-4 alternatives is ideal.`;

// ─────────────────────────────────────────────────────────────────
// FRAGMENT: PSYCHOLOGY STRATEGY REASONING
// Used in: all clarifiers (output field)
// Purpose: Forces the LLM to explicitly reason about how psychology
//          should shape THIS turn's question, options, and assumptions
// ─────────────────────────────────────────────────────────────────
export const PSYCHOLOGY_STRATEGY_INSTRUCTIONS = `PSYCHOLOGY STRATEGY (output this FIRST, before crafting your question):

Before you write your question, options, or assumptions, you MUST reason about the user's psychology and how it should shape this turn. Output this as the "psychology_strategy" field in your JSON.

This is YOUR private reasoning — the user never sees it. Be specific and actionable. DON'T restate the hypotheses. Instead answer these questions:

1. WHAT DOES THIS USER WANT FROM THIS EXPERIENCE RIGHT NOW?
   Based on their interaction pattern, satisfaction, and hypotheses — are they exploring freely, driving toward a specific vision, getting bored, getting excited? What emotional state are they in?

2. WHAT SHOULD I DO DIFFERENTLY BECAUSE OF WHAT I KNOW?
   Be CONCRETE. Examples of good strategy:
   - "They type long responses about relationships but click through combat stuff → lean into relationship dynamics, make my question about the emotional tension between characters, not plot mechanics"
   - "High change rate + satisfaction rising → they WANT to be challenged. Offer a provocative assumption they might disagree with"
   - "They defer a lot → stop asking them to decide fine details. Make bolder proposals they can react to"
   - "Control-seeker with specific vision → my options should be interpretations of THEIR idea, not new directions"
   - "Engagement dropping → I'm being too safe/predictable. Do something surprising — challenge an assumption they've kept, surface a contradiction they haven't noticed"

3. WHAT SPECIFIC MOVES SHOULD I MAKE THIS TURN?
   - Should my question be open-ended or focused?
   - Should my options expand possibilities or refine what they've started?
   - Should my assumptions be bold (to provoke reaction) or supportive (to build momentum)?
   - Is there a specific character/relationship/theme I should focus on because the psychology suggests they're most invested there?
   - Should I challenge anything they've settled on, or reinforce their momentum?

BAD STRATEGY (too vague, doesn't change behavior):
  "The user seems engaged so I'll keep doing what I'm doing"
  "I'll adapt to their preferences"
  "I notice they like dark themes so I'll include dark themes"

GOOD STRATEGY (specific, changes what you actually output):
  "They've typed detailed responses about Kira's internal conflict but only clicked chips for Renji — they're invested in Kira's psychology. This turn: make my question about the thing Kira won't admit to herself, offer options that each reveal a different fear. For assumptions, propose something provocative about Renji that might make them finally care about him."
  "Satisfaction declining + they've been deferring assumptions for 2 turns. They feel stuck. Break the pattern: instead of asking about character details, ask a big-picture question about what FEELING they want the reader to have. Give them permission to zoom out."

Your psychology_strategy directly shapes your question, options, and assumptions. If your strategy says 'lean into relationships' but your question is about plot mechanics, you failed.`;

