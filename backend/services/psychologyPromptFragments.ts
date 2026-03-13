/**
 * PSYCHOLOGY PROMPT FRAGMENTS
 * ════════════════════════════
 * LAYER: Psychology (the user-insight system, shared across all modules)
 *
 * v4: Structured BehaviorSignal output format.
 *     - LLM outputs raw signal observations, NOT confidence or status (backend computes those)
 *     - Evidence must cite specific user actions with turn reference
 *     - Adaptation consequences are concrete pipeline behaviors, not prose
 *     - Ban literary/academic language — use plain observational language
 *     - behavior_summary replaces overall_read
 *     - adaptation_plan replaces psychology_strategy
 */

// ─────────────────────────────────────────────────────────────────
// FRAGMENT: USER READ OUTPUT INSTRUCTIONS (v4 — structured signals)
// ─────────────────────────────────────────────────────────────────
export const SHARED_USER_READ_INSTRUCTIONS = `Output as STRUCTURED JSON (not freeform):

  user_read: {
    signals: [  // 1-3 observations about this USER's behavior (not the story)
      {
        hypothesis: "concrete observation, max ~20 words — what they DO, not what they ARE",
        action: "the specific user action this turn that supports this — quote their choice or behavior",
        valence: "supports" | "contradicts",
        scope: "this_story" | "this_genre" | "global",
        category: "content_preferences" | "control_orientation" | "power_dynamics" | "tonal_risk" | "narrative_ownership" | "engagement_satisfaction",
        adaptationConsequence: "what the pipeline should DO differently — concrete action, not vibe",
        contradictionCriteria: "what user action would prove this wrong — specific and testable",
        reinforcesSignalId: "s2",  // optional: if this SUPPORTS a prior signal, name it — avoids duplicates
        contradictsSignalId: "s3"  // optional: if this contradicts a prior signal, name it
      }
    ],
    behaviorSummary: {
      orientation: "1-sentence summary of user's current creative approach — plain language",
      currentFocus: "what they're most invested in right now (1-3 words)",
      engagementMode: "exploring" | "converging" | "stuck" | "disengaged",
      satisfaction: {
        score: 0.0-1.0,
        trend: "rising" | "stable" | "declining",
        reason: "what tells you this — cite a specific action, max ~15 words"
      }
    },
    adaptationPlan: {
      dominantNeed: "what does this user need from THIS turn — plain, specific",
      moves: [  // 2-4 concrete actions you'll take
        {
          action: "what specifically to do — not a vibe, a pipeline behavior",
          drivenBy: ["s1", "s3"],  // which signal IDs drive this move
          target: "question" | "options" | "assumptions" | "builder_tone" | "builder_content" | "judge_criteria"
        }
      ]
    }
  }

SIGNAL RULES — READ THESE CAREFULLY:

1. YOU DO NOT SET CONFIDENCE OR STATUS. The backend computes those from evidence count,
   recency, and contradictions. You provide the observation + evidence + consequences.

2. EVIDENCE MUST CITE A SPECIFIC ACTION. Not "they seem to prefer dark themes."
   YES: "chose 'morally ambiguous antagonist' over 'clear villain' on turn 3"
   YES: "typed 'I want the reader to feel uncomfortable' in free text"
   YES: "kept all assumptions about power dynamics, changed the romantic ones"
   NO: "appears drawn to complexity"
   NO: "gravitates toward darker material"
   NO: "shows a preference for nuanced characters"

3. ADAPTATION CONSEQUENCES MUST BE PIPELINE ACTIONS. Not "lean into their interests."
   YES: "offer antagonist options with moral complexity, avoid clear heroes/villains"
   YES: "make next question about emotional stakes, not plot mechanics"
   YES: "include a provocative assumption that challenges their settled direction"
   NO: "continue exploring these themes"
   NO: "match their creative energy"
   NO: "deepen the emotional resonance"

4. CONTRADICTION CRITERIA MUST BE TESTABLE. Not "they change their mind."
   YES: "user chooses simple/clear morality options 2+ times in a row"
   YES: "user ignores power dynamic assumptions for 3 consecutive turns"
   YES: "user types that they want something lighter or more straightforward"
   NO: "they show less interest in this area"
   NO: "the pattern doesn't hold up"

5. BANNED LANGUAGE — do NOT use these words/phrases in signals:
   "yearns", "craves", "resonates", "transcendence", "cathartic", "psyche",
   "soul", "essence", "journey", "tapestry", "weave", "thread", "dance between",
   "delicate balance", "rich tapestry", "deeply invested", "speaks to their",
   "drawn to", "gravitates toward", "reveals a deep", "underlying need for",
   "creative fingerprint", "emotional landscape", "psychological profile"

   USE INSTEAD: plain observational language like "picks X over Y consistently",
   "typed specific details about Z", "ignored all options related to W",
   "changed their mind about X after seeing Y", "spent the most words on Z"

6. CHECK PRIOR SIGNALS in the psychology section above. Reference them by ID.
   - If you see supporting evidence for an EXISTING signal → set reinforcesSignalId to that signal's ID.
     This is PREFERRED over creating a new signal. Example: prior signal [s2] says "picks complex
     antagonists" and user just chose "morally ambiguous villain" → output reinforcesSignalId: "s2".
   - If you see contradicting evidence → output valence: "contradicts" with contradictsSignalId
   - ONLY create a genuinely new signal (no reinforcesSignalId) when the observation doesn't
     fit any existing signal. New signals are expensive — the store caps at 12.
   - DO NOT restate prior signals with different words. Either reinforce with new evidence or don't.

7. DEEPENING RULE (after turn 2):
   After turn 2, new signals MUST add information, not restate.
   "Prefers dark themes" → already captured. DON'T output again.
   "Specifically interested in moral corruption, not violence — chose 'slow moral slide' over 'brutal revenge'" → NEW information.

ENGAGEMENT MODE DEFINITIONS:
  - "exploring": trying different directions, high variety in choices
  - "converging": narrowing in on a specific vision, choices getting more consistent
  - "stuck": repeating similar patterns, deferring, or short responses
  - "disengaged": minimal effort, ignoring options, satisfaction dropping

SATISFACTION ASSESSMENT:
  You have the full conversational context — use it.
  - A user who changes many assumptions may be HIGHLY satisfied — they're engaged and opinionated.
  - A user who keeps everything may be passive or bored.
  - Read the CONTEXT, not just the numbers.
  - Turn 1: default to 0.5/stable unless their seed shows obvious enthusiasm.

SIGNAL CATEGORIES (assign exactly one per signal):
  - "content_preferences": What they explicitly want — themes, aesthetics, tones
  - "control_orientation": How much they want to drive vs be surprised
  - "power_dynamics": Interest in hierarchy, authority, dominance patterns
  - "tonal_risk": How far they push boundaries, appetite for transgression
  - "narrative_ownership": How protective of their vision
  - "engagement_satisfaction": How they're feeling about the experience

SCOPE:
  - "this_story": Specific to this story's content
  - "this_genre": Likely applies to similar stories
  - "global": Interaction style or deep preference`;

// ─────────────────────────────────────────────────────────────────
// FRAGMENT: NON-ACTION READING
// ─────────────────────────────────────────────────────────────────
export const SHARED_NON_ACTION_READING = `READ NON-ACTIONS TOO:
  - User didn't type anything, only clicked chips/assumptions → they prefer guided choices, lean into proposals
  - User ignored certain assumptions (didn't click keep/change/not-ready) → they may not care about those, or aren't ready. Don't force them.
  - User skipped the main question and only responded to assumptions → they're more interested in shaping the building blocks than answering your question. Adjust: offer more assumptions next turn, fewer open questions.
  - User typed free text but ignored all chips → they have their own vision, stop offering pre-made options and start riffing WITH them
  - User keeps choosing "not ready" on multiple assumptions → they're exploring, not committing. Stay loose, keep proposing directions.`;

// ─────────────────────────────────────────────────────────────────
// FRAGMENT: PSYCHOLOGY-MOTIVATED ASSUMPTIONS
// ─────────────────────────────────────────────────────────────────
export const SHARED_PSYCHOLOGY_ASSUMPTIONS = `PSYCHOLOGY-REVEALING ASSUMPTIONS (include 1 per turn when possible):
Not every assumption should be about the story. Some should be designed so that the user's RESPONSE tells you something about THEM — their creative instincts, emotional preferences, risk tolerance, storytelling values.

HOW: Frame a story choice where the alternatives reveal different creative personalities:
  - "The protagonist's secret comes out by accident" → alternatives: "They choose to reveal it" / "Someone betrays them" / "It never fully comes out"
    (Accident = chaos-lover. Chosen reveal = control-seeker. Betrayal = drama-seeker. Hidden = slow-burn thinker.)
  - "The antagonist genuinely cares about the protagonist" → alternatives: "Uses caring as a weapon" / "Cares but would still destroy them" / "Doesn't care at all"
    (Each reveals how the user thinks about moral complexity.)

RULES:
  - These MUST still be valid, useful story assumptions — they serve double duty, not just profiling
  - Don't label them differently from other assumptions — they should feel the same
  - Feed what you learn into your signals
  - Don't overthink it: a good assumption naturally reveals something about the chooser`;

// ─────────────────────────────────────────────────────────────────
// FRAGMENT: OBVIOUS PATTERN DETECTION
// ─────────────────────────────────────────────────────────────────
export const OBVIOUS_PATTERN_DETECTION = `OBVIOUS PATTERN DETECTION (do this FIRST, before subtle analysis):

Before looking for hidden patterns, identify what the user is EXPLICITLY telling you.

CAPTURE FIRST:
  - Direct content requests (genres, themes, aesthetics, specific things they asked for)
  - Stated preferences ("I want...", "I like...", repeated emphasis on specific elements)
  - Obvious fixations (topics returned to multiple times, things they highlight or emphasize)
  - Explicit interests stated in the seed or free text

Record these as signals in category "content_preferences".

ONLY AFTER capturing the obvious should you look for subtler dimensions:
  - Control orientation (do they want to drive or be surprised?)
  - Power dynamics interest (hierarchy, authority patterns)
  - Tonal risk appetite (how far they push boundaries)
  - Narrative ownership (how protective of their vision)

The OBVIOUS and the SUBTLE are BOTH important. But never skip the obvious to look clever.`;

// ─────────────────────────────────────────────────────────────────
// FRAGMENT: DIAGNOSTIC OPTIONS GUIDANCE
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
  - Feed insights into your signals when the user chooses`;

// ─────────────────────────────────────────────────────────────────
// FRAGMENT: ASSUMPTION PERSISTENCE CHECK
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
// FRAGMENT: ADAPTATION PLAN INSTRUCTIONS (replaces PSYCHOLOGY_STRATEGY)
// ─────────────────────────────────────────────────────────────────
export const ADAPTATION_PLAN_INSTRUCTIONS = `ADAPTATION PLAN (output in user_read.adaptationPlan — replaces psychology_strategy):

Before you write your question, options, or assumptions, you MUST plan how the user's behavior
signals should shape this turn. This goes in the adaptationPlan field.

This is YOUR private reasoning — the user never sees it. Be SPECIFIC and ACTIONABLE.

dominantNeed: What does this user need from THIS turn?
  BAD: "continue engaging with them" / "adapt to their preferences"
  GOOD: "they're stuck on character dynamics — need a provocative question that breaks the loop"
  GOOD: "satisfaction dropping + they've deferred 3 turns — give them a big-picture question to zoom out"

moves: 2-4 concrete actions, each targeting a specific pipeline stage.
  Each move MUST reference which signal(s) drive it (by ID).

  BAD MOVES (too vague):
  - "lean into their interests"
  - "match their energy"
  - "offer options aligned with their preferences"

  GOOD MOVES:
  - action: "make question about the emotional stakes between characters, not plot mechanics"
    drivenBy: ["s2"] (control_orientation: types long responses about relationships, clicks through plot)
    target: "question"
  - action: "include a provocative assumption challenging their settled antagonist direction"
    drivenBy: ["s1", "s4"] (high change rate + rising satisfaction = they want to be challenged)
    target: "assumptions"
  - action: "offer fewer pre-made options, more open space — they're typing their own vision"
    drivenBy: ["s3"] (narrative_ownership: ignores chips, types free text)
    target: "options"

Your adaptationPlan directly shapes what you output. If your plan says 'focus on relationships'
but your question is about plot mechanics, you failed.`;

// ─────────────────────────────────────────────────────────────────
// FRAGMENT: BUILDER/JUDGE SIGNAL INSTRUCTIONS
// Used in: all builder and judge system prompts
// Purpose: Tell builders/judges how to USE behavior signals
// ─────────────────────────────────────────────────────────────────
export const BUILDER_SIGNAL_INSTRUCTIONS = `USER BEHAVIOR SIGNALS (use these to shape your output):

The psychology ledger above contains behavior signals about this user. Each signal has:
  - A hypothesis (what we observed about the user)
  - A confidence score (0-1, higher = more evidence)
  - An adaptation consequence (what to DO differently)

HOW TO USE SIGNALS IN YOUR OUTPUT:
  - FOCUS ON THE TOP 2-3 SIGNALS BY CONFIDENCE. These are the ones that should actually shape your output. The rest are context, not directives.
  - Read the "adapt:" line for your top 2-3 signals — those are your marching orders
  - Signals with confidence >= 0.5 are reliable patterns — follow their adaptation consequences
  - Signals with confidence < 0.3 are early impressions — note but don't let them drive decisions
  - If a signal says "offer more X" or "avoid Y", actually do it in your output
  - If two signals conflict, prefer the one with higher confidence
  - DO NOT try to satisfy every signal at once. Pick 2-3 that matter most THIS output.

EXAMPLES:
  Signal: "picks morally complex options over simple ones" → adapt: "make antagonist sympathetic, avoid clear villain"
  → In your output: write an antagonist with genuine motivations, not a cardboard villain

  Signal: "typed detailed relationship descriptions, clicked through world-building" → adapt: "prioritize character dynamics over setting detail"
  → In your output: spend more words on character interactions, less on world description

  Signal: "changes assumptions about tone frequently" → adapt: "keep tonal range in options, don't lock to one register"
  → In your output: include moments of tonal variety, don't be monotone`;

export const JUDGE_SIGNAL_INSTRUCTIONS = `USER FIT SCORING (additional judge dimension):

In addition to your standard scoring criteria, evaluate how well the candidate
matches the user's behavior signals.

USER FIT (score 0-10):
  - 10: Every adaptation consequence from active signals is reflected in the output
  - 7-9: Most signals are reflected, minor mismatches
  - 4-6: Some signals reflected but key adaptations are missing
  - 1-3: Output ignores or contradicts user behavior signals
  - 0: Output actively contradicts what we know about the user

Check each active signal's "adapt:" line and verify the output follows it.
If the output contradicts a signal with confidence >= 0.5, that's a hard penalty.

Include user_fit in your scores object and explain any mismatches in your judgment.`;

// ─────────────────────────────────────────────────────────────────
// FRAGMENT: UPSTREAM DEVELOPMENT TARGETS
// Used in: clarifier and builder system prompts for all modules EXCEPT hook
// Purpose: Previous modules' judges identified weaknesses. This module
//          should subtly address them without being heavy-handed.
// ─────────────────────────────────────────────────────────────────
export const UPSTREAM_DEVELOPMENT_TARGETS_INSTRUCTIONS = `UPSTREAM DEVELOPMENT TARGETS (weave these in — do NOT announce them):

You have received development targets from earlier modules. These are weaknesses or gaps
identified by previous judges that YOUR module can help address.

HOW TO USE THEM:
  - DO NOT tell the user "the previous module found a weakness in X"
  - DO NOT ask directly about the weakness — that breaks immersion
  - Instead, shape your questions, assumptions, and options so the user's choices
    NATURALLY develop the weak area
  - Think of it like a conversation where you steer toward a topic without saying
    "we need to talk about this"

EXAMPLES:
  Target: "antagonist's moral logic is underdeveloped"
  BAD: "The previous module flagged that your antagonist needs more moral depth. What drives them?"
  GOOD: (in a world module) Surface an assumption about the institution the antagonist works for
        and what it rewards — the user's choice will reveal and deepen the antagonist's moral framework

  Target: "protagonist lacks clear competence"
  BAD: "What is your protagonist actually good at?"
  GOOD: (in a visual module) "The protagonist carries herself like someone who's won a lot of fights
        she picked on purpose" — alternatives that shape competence through visual language

  Target: "relationship between supporting_1 and antagonist is flat"
  BAD: "How do these two interact?"
  GOOD: Surface a faction or arena question that forces these two characters into proximity,
        making the user think about how they'd behave around each other

RULES:
  - Address AT MOST 2 targets per turn — don't overwhelm
  - If a target has already been addressed by the user's choices, skip it
  - Prioritize targets where THIS module has natural leverage
    (e.g., world module can develop institutional/faction pressure;
     visual module can develop character presence and energy;
     theme module can develop moral frameworks)
  - Some targets may not be addressable by this module — that's fine, pass them forward`;

export const BUILDER_UPSTREAM_TARGETS_INSTRUCTIONS = `UPSTREAM DEVELOPMENT TARGETS (strengthen these in your output):

You have received development targets from earlier modules — weaknesses or gaps that your output
should help address. These are things previous judges flagged as underdeveloped.

HOW TO USE THEM:
  - Where your output can organically strengthen a weak area, do it
  - Don't force it — if a target doesn't fit your module's scope, leave it
  - The user's clarifier choices may have already addressed some targets — check before acting

EXAMPLES:
  Target: "supporting_1's role_function is vague"
  → In world builder: give supporting_1 a clear position in the power map / faction structure
     that naturally defines their role

  Target: "stakes feel abstract, not grounded"
  → In world builder: make resource flows and consequence chains concrete — tie stakes to
     physical locations and institutional pressures the user confirmed

RULES:
  - Address what you naturally can — don't stretch
  - Targets already resolved by clarifier choices should be marked as addressed
  - Remaining unresolved targets get passed to the next module's pack`;

export const JUDGE_UPSTREAM_TARGETS_INSTRUCTIONS = `UPSTREAM TARGET ASSESSMENT (additional judge check):

Check whether the builder output addressed any of the upstream development targets.
For each target, assess:
  - status: "addressed" (meaningfully developed), "partially_addressed" (some improvement but still weak), "unaddressed" (not touched, may be out of scope), or "deferred" (user has repeatedly ignored this)
  - quality: if status is addressed or partially_addressed, rate as "weak" | "partial" | "strong"
  - current_gap: if partially_addressed, describe what's still missing
  - suggestion: concrete next step for a downstream module to address this
  - best_module_to_address: which downstream module is best positioned ("character" | "character_image" | "world" | "plot" | "scene" | "dialogue")

This assessment helps downstream modules know what still needs work and where to focus.
Include this in your judgment output.`;

// ─────────────────────────────────────────────────────────────────
// FRAGMENT: VALUE OF INFORMATION — question prioritization
// Used in: all clarifier system prompts (STEP 4 area)
// Purpose: Ask fewer, better questions. Skip low-impact ones.
// ─────────────────────────────────────────────────────────────────
export const QUESTION_VALUE_CHECK = `QUESTION VALUE CHECK (run before asking ANYTHING):
Before you ask a question or surface an assumption, run this quick test:
  "If the user picks option A vs option B vs option C, would the resulting STORY actually be meaningfully different?"

HIGH VALUE — ask it:
  - The answer changes the emotional engine, character dynamics, or premise shape
  - The user would CARE about this choice (it's not just flavor)
  - You genuinely can't infer the answer from what they've already told you
  Examples: "Is the antagonist someone the protagonist loves?" / "Does the protagonist know about the betrayal?"

LOW VALUE — skip it, infer a default:
  - Any reasonable answer works fine and the story's core stays the same
  - You can infer the answer from tone, genre, or prior choices
  - The builder can make a good call without user input
  Examples: "Is the school in a city or a small town?" (unless setting IS the story)

This is NOT about asking fewer questions — it's about asking BETTER ones. Every question should earn its spot by changing what gets built.`;

// ─────────────────────────────────────────────────────────────────
// FRAGMENT: PREMORTEM CHECK — clarifier version
// Used in: all clarifier quality gates (near readiness checks)
// Purpose: Imagine failure before committing, catch weak spots
// ─────────────────────────────────────────────────────────────────
export const PREMORTEM_CHECK = `PREMORTEM (before setting readiness above 75%):
Imagine: "This story launched and readers were disappointed. What's the single most likely reason?"

Common killers:
  - FORGETTABLE — competent but nothing makes someone grab a friend and say "you HAVE to read this"
  - VAGUE DESIRE — the protagonist "wants freedom" or "wants love" without the wound that gives it weight
  - CARDBOARD ANTAGONIST — they oppose the protagonist but have no felt reason
  - ABSTRACT STAKES — "everything is at risk" but we don't viscerally care
  - CLEVER BUT COLD — the mechanism is intellectually interesting but doesn't make us feel trapped WITH the characters

If you spot a killer that hasn't been addressed:
  - Do NOT set readiness above 75%
  - Make your next question target that weakness — framed as an exciting opportunity, not a problem
  - You only need to catch the BIGGEST one, not audit everything

If you can't identify a plausible failure mode, proceed — that's a good sign.`;

// ─────────────────────────────────────────────────────────────────
// FRAGMENT: PREMORTEM — judge version
// Used in: all judge system prompts (alongside OBSESSION TEST)
// Purpose: Name the single biggest risk before scoring
// ─────────────────────────────────────────────────────────────────
export const JUDGE_PREMORTEM = `PREMORTEM (before scoring — do this alongside the obsession test):
Imagine this story as a finished visual novel. A reader plays it, finishes it, and feels... nothing special. Why?

Name the single most likely failure mode — the weakness that would make this forgettable despite being well-crafted:
  - "I've read this before" — genre template, not a specific story
  - "I didn't care" — protagonist's desire didn't have enough weight
  - "Cool concept, but..." — mechanism is clever but doesn't create emotional pressure
  - "Where was this going?" — no genuine urgency pulling the reader forward

Factor this into your scoring. If the candidate already addresses its most likely failure mode, that's a significant strength worth noting.`;

// ─────────────────────────────────────────────────────────────────
// FRAGMENT: DIVERGENCE SELF-CHECK — option diversity
// Used in: all clarifier system prompts (near option generation)
// Purpose: Ensure visible options open genuinely different story spaces
// ─────────────────────────────────────────────────────────────────
export const DIVERGENCE_SELF_CHECK = `DIVERGENCE CHECK (when generating options):
After drafting your options, run this self-check before finalizing:

For each option, privately ask: "If the user picks THIS one, what kind of story does it lead to?"
Then compare: do your options lead to genuinely different stories, or do they all funnel to roughly the same place?

CHECK THESE AXES:
  - Different emotional payoff? (shame vs thrill vs tenderness vs dread)
  - Different conflict pattern? (internal vs external vs relational vs institutional)
  - Different power dynamic? (dominance vs equality vs vulnerability vs reversal)
  - Different scene types? (intimate confrontation vs public exposure vs quiet erosion vs explosive reveal)

If two options share 3+ of those axes, they're secretly the same option in different words. Replace the weaker one with something that opens a genuinely different story space.

ALSO APPLY TO ASSUMPTIONS:
  - At least one assumption per turn should push toward an unexpected direction — not the obvious continuation
  - The alternatives for each assumption should lead to different KINDS of stories, not just different details within the same kind

This is not about being weird for the sake of weird. Every option should be plausible and emotionally charged. But if a user could pick any of your options and end up in basically the same story, you've failed at the one thing that makes this experience addictive: the feeling that every choice MATTERS.`;
