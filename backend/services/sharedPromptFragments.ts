/**
 * SHARED PROMPT FRAGMENTS
 * ========================
 * These are the ONLY pieces of prompt text that are shared across modules.
 * When you need to change cross-module behavior (psychology adaptation, user_read, etc.),
 * change it HERE — it will automatically apply to all modules.
 *
 * MODULE-SPECIFIC prompts live in their own files (hookPrompts.ts, characterPrompts.ts, etc.)
 * and must NEVER be edited for cross-module reasons. If you're tempted to copy-paste
 * something into multiple prompt files, it belongs here instead.
 *
 * Each fragment is exported as a function or constant that modules compose into their prompts.
 * Modules insert these at clearly marked {{SHARED:*}} injection points.
 */

// ─────────────────────────────────────────────────────────────────
// FRAGMENT: ADAPT TO INTERACTION STYLE
// Used in: hook clarifier (ENGAGEMENT rules), character clarifier (STEP 2)
// Purpose: Tells the LLM how to adjust its behavior based on psychology ledger heuristics
// ─────────────────────────────────────────────────────────────────
export const SHARED_INTERACTION_STYLE_ADAPTATION = `ADAPT TO INTERACTION STYLE (from psychology ledger):
  - Mostly clicks → richer chips (4-5 per turn), make options do the creative lifting
  - Mostly types → provocative open questions, fewer chips, more space for their voice
  - Responses getting shorter → be bolder, more provocative, make next turn irresistible
  - High deferral rate → assumptions are too abstract, be more concrete and story-specific
  - High change rate → they're opinionated, give them MORE to react to`;

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

CONFIDENCE LEVELS:
  - "low": First impression, single data point. E.g. first turn, one choice.
  - "medium": Pattern observed across 2+ turns or reinforced by multiple signals.
  - "high": Repeatedly confirmed, consistent across different choice types.

SCOPE:
  - "this_story": Preference specific to this story's content (e.g. "wants the antagonist to be sympathetic")
  - "this_genre": Preference that likely applies to similar stories (e.g. "drawn to power dynamics in dark romance")
  - "global": Interaction style or deep preference (e.g. "control-seeker who prefers to shape rather than discover")

RULES:
  - Check YOUR PRIOR HYPOTHESES in the psychology section above. Do NOT repeat them. Instead: confirm (raise evidence), refine (make more specific), or disconfirm (note what contradicted it).
  - Each hypothesis must be DIFFERENT from prior ones. If you noted "fast-moving director," dig deeper: what KIND of director? What drives their speed?
  - Track CHANGES: did they start typing more? Did energy shift? Did they defer something unusual?
  - Go beyond surface actions. "Clicks a lot" is obvious. WHY those clicks? What do their choice patterns reveal about preferences, fears, emotional pulls?
  - If the user IGNORED certain assumptions last turn (shown in "ASSUMPTIONS IGNORED"), factor that in — it's a weak signal they don't care about those areas yet.
  - The overall_read is your brief intuitive synthesis — the creative fingerprint.`;

// ─────────────────────────────────────────────────────────────────
// FRAGMENT: READ THE USER CLASSIFICATION
// Used in: hook clarifier (STEP 1), character clarifier (STEP 2)
// Purpose: The taxonomy for classifying user behavior each turn
// ─────────────────────────────────────────────────────────────────
export const SHARED_USER_BEHAVIOR_CLASSIFICATION = `  (a) VAGUE — seed or answer is broad. Lead hard. Propose vivid directions.
  (b) DECISIVE — they picked something specific or typed details. Honor it. Build on it.
  (c) EXPLICIT — they asked for something specific. Give it, then build.
  (d) REJECTION — they said no or pivoted. Fresh angles, don't repeat rejected ones.
  (e) CONTRADICTION — answer conflicts with earlier choice. Surface it warmly, offer a swap menu.
  (f) EXCITED — typing a lot, adding details. Match energy. Riff with them.
  (g) PASSIVE — short answers, picking chips. Be bolder, more specific, more provocative.`;

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
// FRAGMENT: FREE-FORM CHECK-INS
// Used in: hook clarifier (CHOOSE YOUR MOVE), character clarifier (CHOOSE YOUR MOVE)
// Purpose: Tells the LLM when to break from structured questions and ask open-ended check-ins
// ─────────────────────────────────────────────────────────────────
export const SHARED_FREE_FORM_CHECKIN = `FREE-FORM CHECK-IN (use sparingly — 1-2 times per session max):
Sometimes the best move isn't a structured question with chips. It's a brief, warm, open-ended check-in that lets the user say what's on their mind. You decide when.

WHEN to use a check-in:
  - After a burst of rapid-fire chip clicks (3+ assumptions confirmed quickly) — they may be on autopilot
  - When you sense momentum shifting — energy dropped, answers got shorter, or they deferred something unusual
  - After you've made a bold proposal and want to see how it landed emotionally, not just which chip they pick
  - Mid-session (around turn 2-3) when you've built enough shared context to have a real conversation

HOW to do it:
  - Set your question to a short, open-ended prompt. Examples:
    "Anything feeling off, or are we vibing?"
    "Before I keep going — what's exciting you most so far?"
    "Any direction you're itching to explore that I haven't touched?"
    "Real talk — is this heading where you want it to?"
  - Reduce options to 2-3 light nudges (NOT detailed story choices). Examples:
    "Keep going, I'm into it" / "Something feels off" / "I want to talk about..."
  - The goal is to give them SPACE, not more decisions. Let them redirect, vent, or confirm.

WHAT NOT TO DO:
  - Don't check in every turn — it breaks creative flow
  - Don't make the check-in feel like a survey ("Rate your satisfaction 1-5")
  - Don't use it as a stall tactic when you're not sure what to ask next — if you're stuck, make a bold proposal instead`;

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
