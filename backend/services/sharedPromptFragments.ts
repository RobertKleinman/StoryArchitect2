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
// Purpose: Tells the LLM what to write in the user_read field
// NOTE: Each module may wrap this with module-specific framing.
//       The CORE instruction is shared; the context sentence before it is module-specific.
// ─────────────────────────────────────────────────────────────────
export const SHARED_USER_READ_INSTRUCTIONS = `Your read on THIS USER in 2-3 sentences max. Self-assess confidence: "Strong signal: ..." vs "Early read: ..." This is about the PERSON, not the story content. Their creative fingerprint.

REQUIREMENTS FOR EACH READ:
- Must contain at least ONE observation you have NOT made in a previous user_read. If you find yourself repeating "fast-moving director" or "they click to confirm," you've already said that — dig deeper.
- Track CHANGES in behavior: did they start typing more? Did their energy shift? Did they defer something they'd normally decide fast? Note what changed and what might have caused it.
- Go beyond surface: "clicks a lot" is obvious. WHY do they click what they click? What patterns in their CHOICES (not just their method) reveal preferences, fears, emotional gravitational pulls?
- Note what your previous adaptation attempts DID to their engagement — did richer chips make them more decisive? Did a provocative question land or fall flat?`;

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
