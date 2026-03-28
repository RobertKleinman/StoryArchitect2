# Visual Novel Generation Pipeline — Architecture & Design

## What This Is

A multi-stage AI pipeline that generates complete, playable visual novel stories from a one-sentence idea. The system produces structured VN output: speaker lines with emotions, stage directions, internal thoughts, and scene transitions — not prose fiction, not a screenplay, but the actual data format a VN engine consumes.

The pipeline exists because single-shot story generation (one prompt → one story) produces generic, structurally weak output. By decomposing the problem into specialized stages — each with its own prompt, schema, and quality gate — the system achieves coherence, specificity, and dramatic quality that a single conversation cannot.

## What We're Trying to Achieve

**The 9.5/10 goal**: Stories that feel authored, not generated. Premises with irreducible moral dilemmas. Characters who contradict themselves. Scenes where intentions misfire, power shifts through silence, and the reader discovers things the plan didn't specify. The benchmark is: would someone argue about this story afterward?

**Current state** (as of 2026-03-27): Premise/world/character design scores 9-9.5. Scene execution recently jumped from ~6 to ~8.5-9 after adding instability rules and the situation/pressure plan split. The remaining gap is in scene-to-scene cumulative tension and occasional name hallucination at high temperature.

## Pipeline Overview

```
User's idea (one sentence)
    │
    ▼
┌─────────────┐
│  1. INTAKE   │  1-2 turns of conversation to understand the idea
└──────┬──────┘
       ▼
┌─────────────┐
│  2. PREMISE  │  Hook, synopsis, characters, conflict, tone
└──────┬──────┘
       ▼
┌─────────────────┐
│  3. STORY BIBLE  │  World → Characters → Plot → Judge (with checkpointing)
└──────┬──────────┘
       ▼
┌──────────────────┐
│  4. SCENE PLANNING│  Cluster beats into 6-12 scenes with dramatic spines
└──────┬───────────┘
       ▼
┌──────────────────┐
│  5. SCENE WRITING │  Parallel batch generation with instability rules
└──────┬───────────┘
       ▼
    Playable VN scenes (JSON + readable text)
```

User approval gates exist between steps 2→3 (approve premise) and 4→5 (approve scene plan). The pipeline can also run fully automated for testing.

---

## Step 1: Intake

**Purpose**: Understand what story the user wants in 1-2 focused exchanges.

**Model**: Claude Sonnet 4.6

**What happens**:
- User provides a seed idea ("A retired detective joins a grief support group and realizes one member is lying about how their spouse died")
- System asks ONE focused question per turn (not a list)
- Surfaces 3-5 assumptions for the user to confirm or change (genre, tone, setting, cast size)
- Extracts behavioral signals about the user (are they detailed? decisive? what do they care about?)
- Maximum 2 turns — if turn 2, must proceed

**Key design choice**: The intake explicitly avoids the "20 questions" anti-pattern. Most story tools interrogate the user into boredom. This system gets enough to work with fast and lets the downstream stages be creative.

**Outputs**: Confirmed constraints (constraint ledger), user psychology signals, seed input for premise generation.

---

## Step 2: Premise Generation

**Purpose**: Create the story's elevator pitch — hook, conflict, characters, tone.

**Model**: Claude Sonnet 4.6 (writer) + Claude Sonnet 4.6 (judge)

**What it produces**:
- `hook_sentence` — one irresistible line
- `emotional_promise` — what the reader will feel
- `premise_paragraph` — 2-3 sentence core
- `synopsis` — 3-5 sentence arc (beginning, middle, end)
- `tone_chips` — specific mood labels ("sardonic intimacy", "bureaucratic dread")
- `setting_anchor` — where and when
- `characters_sketch` — 3-5 character sketches with names and roles
- `core_conflict` — the irreducible tension

**Quality gate**: A judge LLM evaluates the premise for specificity, compelling hook, complete arc, genuine tension, and constraint compliance. Fails get regenerated with feedback.

**Key design choices**:
- Names must draw from diverse real-world cultural/linguistic traditions. The prompt explicitly bans the "LLM name register" (Kael, Thane, Voss, Elara, Maren — recognizably AI-generated).
- Tone chips must be specific, not generic. "Dramatic" is banned; "the silence between confessions" is encouraged.
- The synopsis must cover the full arc including the ending. Premises that are all setup with no resolution fail.

**User gate**: User reviews and approves (or requests revision) before proceeding.

---

## Step 3: Story Bible Generation

**Purpose**: Build the complete story foundation — world, characters, plot — in a single coordinated pass with internal quality gating.

**Model**: Claude Sonnet 4.6 (all sub-steps)

**Sub-steps** (with checkpointing after each):

### 3a. World Building
Produces:
- `world_thesis` — one sentence capturing what this world is about
- `arena` — locations with descriptions and affordances (what can happen there)
- `rules` — world rules with consequences if broken
- `factions` — power structures
- `canon_facts` — established truths

### 3b. Character Profiles
For each character:
- `description` — who they are (includes references to offscreen characters like dead spouses)
- `psychological_profile`:
  - `want` — what they actively pursue
  - `misbelief` — the lie they believe about themselves/the world
  - `stress_style` — how they behave under pressure
  - `break_point` — what pushes them past their limit
  - `voice_pattern` — distinctive speech/thought patterns (sentence structure, vocabulary, verbal tics)
- `threshold_statement` — "X will do anything to Y, but never Z"
- `competence_axis` — what they're good at
- `relationships` — stated dynamic vs. true dynamic for each pair

### 3c. Plot Construction (Tension Chain)
Produces a sequence of 12-20 tension beats, each with:
- `beat` — what happens (max 2 sentences, cause before effect)
- `causal_logic` — why this follows from the previous beat
- `stakes_level` — 1-10, must generally escalate
- `turning_points` — structural pivots
- `dramatic_irony` — what the audience knows that characters don't
- `mystery_hooks` — questions planted and paid off
- `dirty_hands` — moments of moral compromise (mandatory — the protagonist must actively choose something they can't justify)

**Critical plot rules**:
- Every beat must be causally linked to the previous one
- The protagonist must face at least one moment where the right choice requires a wrong act
- If the dominant register is controlled/measured, 1-2 beats must break it (rage, humor, outburst)
- The tension chain must use the specific world rules, locations, and factions — not generic versions
- Each major thread of abstract stakes must be grounded in a specific named person who experiences it

### 3d. Bible Judge
Evaluates the bible on 12 criteria:
1. Character-world fit
2. Plot-character fit
3. Plot-world fit
4. Internal consistency
5. MUST HONOR compliance
6. Moral compromise (is it real or a technicality?)
7. Emotional grounding (are abstract stakes felt by specific people?)
8. Violence consequences (shown on people, not reported as statistics?)
9. Register variation (is the emotional range monotone?)
10. Antagonist dimensionality
11. Mirror exploitation (do foils actually confront each other?)
12. Name quality (culturally diverse, not all from the same phonetic bucket?)

Fails get regenerated with judge feedback. The judge is strict on both consistency AND dramatic quality.

---

## Step 4: Scene Planning

**Purpose**: Cluster tension chain beats into 6-12 playable scenes with full dramatic spines.

**Model**: Claude Sonnet 4.6

For each scene, the planner produces a `ScenePlan` with:

**Situational fields** (direct instructions for the writer):
- `setting` — location and time
- `characters_present` — who's in the scene
- `pov_character` — whose interiority we follow
- `objective` — want, opposition, stakes (what the POV wants RIGHT NOW, what's blocking them, what hurts if they fail)
- `exit_hook` — where the scene must arrive
- `information_delta` — what must be revealed, hidden, or implied
- `content_directives` — hard constraints (e.g., explicit content routing)
- `pacing_type` — one of: pressure_cooker, slow_burn, whiplash, aftermath, set_piece
- `continuity_anchor` — concrete detail from previous scene
- `active_irony` — what the audience knows that characters don't
- `mystery_hook_activity` — hooks planted, sustained, or paid off

**Interpretive fields** (background pressure — fuel for the writer, not to be restated):
- `purpose` — what the scene accomplishes in the story
- `emotion_arc` — start state → trigger → end state
- `value_shift` — what dramatic value changes (trust → suspicion, safety → danger)
- `scene_question` — what the reader is leaning forward to answer
- `compulsion_vector` — dominant emotional hook (curiosity, dread, desire, tenderness, etc.)

**Escalation variety rule**: Middle scenes must not all run the same dramatic mechanism. At least one must produce an irreversible change — a relationship breaks, a line is crossed, information leaks. Ambiguity across all scenes makes the story feel curated, not lived.

**User gate**: User reviews scene plan before generation begins.

---

## Step 5: Scene Writing

**Purpose**: Generate the actual VN scenes — the playable output.

**Model**: Claude Sonnet 4.6, temperature 0.85

**Architecture**: Scenes are generated in configurable batches (default 3, parallel within each batch). A cacheable prefix (world context, canonical names, must-honor constraints) is shared across all scenes and cached by the Anthropic API, so scenes 2+ skip re-processing shared context.

### The Situation/Pressure Split

The scene plan is NOT passed as raw JSON. Instead, `formatScenePlanForWriter()` serializes it into two clearly labeled sections:

```
=== SITUATION (use directly) ===
Setting, characters, objective, exit hook, information rules,
content directives, continuity, dramatic irony, mystery hooks

=== BACKGROUND PRESSURE (submerged guidance — do NOT paraphrase) ===
Purpose, emotion arc, value shift, scene question, compulsion vector
```

**Why**: We tested stripping interpretive fields entirely (2026-03-26). The writing got worse — safer, more procedural, lost texture. The interpretive fields are fuel, not poison. But when the writer receives them as direct instructions, it obediently illustrates them, producing scenes that are "philosophically correct but dramatically dead." The solution: keep the fuel, but forbid the writer from cashing it out directly. Background pressure fields guide selection of details, rhythm, and subtext — that's all.

### The Scene Writer System Prompt

The prompt has these major sections:

**TRANSMUTATION** (most important rule): Background pressure fields are raw material. The writer must embody interpretation through concrete objects, gestures, spatial relations, sensory cues, and silences. Test: if a sentence could appear in a critical essay about the scene, it's interpretation — replace it with something that could be drawn.

**INSTABILITY** (scenes must have friction):
- **Failed intention** (structural, not decorative): A character tries a strategy — a line of questioning, an attempt to control the conversation, a bid for reassurance — and it doesn't land. A dropped object is NOT a failed intention. The failure must be interpersonal.
- **Non-optimal response**: Someone says or does something that is not the most helpful, rational, or expected reaction. Must be a verbal or behavioral choice, not a pause.
- **Power shift**: The person in control must lose control at some point. Through behavior, silence, or an unexpected statement — not through explicit speech about power.
- **Wrong-turn rule**: The character's path must include at least one misinterpretation, overreaction, dead end, or corrected assumption. Scenes where every step leads logically to the next are too clean.

**FRICTION RULES**:
- Asymmetry in conversations (one person dominates, misreads, or gets cornered)
- No dialogue that sounds like scene analysis
- No neat thematic closure
- At least one moment must break the scene's dominant emotional register
- Characters should rarely be fully articulate about their own motivations

**REGISTER** (VN, not novel): Players click through one line at a time. Dialogue does the heavy lifting. Narration is functional — what the player sees and hears. Internal thoughts are messy, in the character's real vocabulary. One strong image per scene is plenty. Let some moments be flat.

**CONTENT POLICY**: Adult creative writing tool. If the plan includes erotic/fetish content, write it faithfully. No fading to black. Character-driven, showing desire and vulnerability through the physical.

**ANTI-SLOP**: Banned words (delve, tapestry, kaleidoscope, myriad, etc.) and banned phrases ("took a deep breath", "couldn't help but", "voice barely a whisper"). Positive instruction: name the actual object, one physical detail beats three adjectives, commit to statements.

### Canonical Names Block

All named entities from the bible — including offscreen/deceased characters — are extracted and included in the cacheable prefix as an explicit anchor:

```
CANONICAL NAMES (use these exact names — do not invent alternatives):
- Rosario 'Ros' Veltri: Protagonist. A retired homicide detective...
- Nadège Fontaine: Catalyst. A Haitian-French woman...
- Elena: Ros's wife (offscreen/deceased — use this exact name)
- Édouard: Nadège's husband (offscreen/deceased — use this exact name)
```

**Why**: At temperature 0.85, the writer hallucinates alternative names for characters not physically present in the scene. A fresh pipeline run had Elena→Petra→Celia and Édouard→Marc across different scenes. The canonical names block anchors the writer.

### Post-Generation Checks

1. **Name consistency check**: Speaker names in the output are compared against the bible. Unknown speakers are flagged (logged as warnings, not blocking).
2. **Anti-slop scan**: Available but not yet wired into the pipeline (deferred). Scores 0-100; the Star Trek test run scored 4-17 per scene (well within acceptable range).

### Scene Judge

Evaluates both **compliance** and **vitality**:

**Compliance** (6 checks): Objective addressed, voice consistency, pacing match, exit hook arrival, must-honor compliance, information delta.

**Vitality** (6 checks): Surprise, over-explanation, subtext density, emotional volatility, friction (failed intention + non-optimal response + behavioral turn), discovery (did the scene find something not in the plan?).

**Critical rule**: A scene can pass compliance and fail vitality. That is still a failure. The most common failure mode is: compliant, well-written, thematically coherent, but dramatically dead.

### Output Format

Each scene produces:
- **VN JSON**: Array of lines, each with `speaker`, `text`, `emotion`, `stage_direction`, `delivery`
- **Readable text**: Formatted screenplay for human review
- **Metadata**: scene_id, title, word count, judge result

---

## Cross-Cutting Systems

### Must-Honor Constraints
A constraint ledger tracks confirmed facts from the user (genre, content level, character names, etc.). Every LLM call receives a `MUST HONOR` block at the end of the prompt (highest attention zone). Constraints with confidence "confirmed" or "imported" are enforced.

### Context Compression
The bible is too large to pass in full to every scene writer call. `compressForScene()` extracts only the characters present, their relationships, and the relevant location. `buildCanonicalNames()` separately extracts all named entities for the names anchor block.

### Caching
The Anthropic API caches the shared context prefix across scene calls. Scenes 2+ skip re-processing world context, canonical names, and must-honor constraints — only the per-scene plan and character profiles are new.

### User Psychology Ledger
Tracks how the user communicates (detail level, decisiveness, engagement) to adapt the interaction style. Used primarily in intake.

### Cultural Research
Optional Gemini Flash call for cultural specificity when the story involves specific cultural contexts. Feeds into world building and character design.

---

## Model Assignments

All quality-critical roles use **Claude Sonnet 4.6**:
- Intake, premise writer, premise judge
- Bible writer, bible judge
- Scene planner, scene writer, scene judge

Supporting roles:
- Cultural research: **Gemini 3 Flash Preview**
- Summarization: **Claude Haiku 4.5**

---

## Key Design Principles

1. **Decomposition over single-shot**: Each stage has a focused job, specialized prompt, and quality gate. The premise writer doesn't need to think about scene structure. The scene writer doesn't need to think about world-building.

2. **Interpretive fuel, not interpretive instruction**: The scene planner creates rich interpretive analysis (purpose, emotion arc, value shift). The scene writer receives it as "background pressure" — fuel for imagination, not lines to restate. This was learned from a failed experiment: stripping interpretive fields made writing worse (8.4/10 → 9.3/10 with them restored).

3. **Instability over obedience**: The scene writer is explicitly told that obedient scenes are dead scenes. Failed intentions, non-optimal responses, power shifts, and wrong turns are mandatory — and they must be structural (interpersonal), not decorative (dropped objects).

4. **Transmutation over paraphrase**: The writer's job is to embody meaning through objects, gestures, and silences — never to explain what something means. Test: if a sentence could appear in a critical essay about the scene, it's interpretation. Replace it with something that could be drawn.

5. **Judge for vitality, not just compliance**: A scene that perfectly executes the plan but has no surprise, no friction, and no discovery is a failure. The judge is trained to catch "compliant but dead."

6. **Anchoring against hallucination**: At creative temperatures (0.85), the writer can drift on names, facts, and continuity. Canonical names blocks, must-honor constraints, and post-generation validation catch this.

7. **User as director, not project manager**: The intake is fast (1-2 turns). The user approves premise and scene plan — they don't micromanage every decision. The system is opinionated by default and steerable when the user has opinions.

---

## Test Results (2026-03-27)

**Star Trek story** (ship AI softening crew trauma memories):
- 3 scenes tested iteratively: S01 (Adaeze/SABLE, 3 iterations to pass), S04 (Adaeze/Tomás, 1 iteration), S02 (Adaeze/Priya, 1 iteration)
- Instability rules working: failed intentions, power shifts, wrong turns all structural

**Fresh pipeline run** (retired detective in grief support group):
- 7 scenes, 16 LLM calls, 12.5 minutes
- ChatGPT rated: 7.5/10 draft, 9/10 potential
- Strengths: premise, voice, atmosphere, moral ambiguity, character triangle
- Weaknesses: name hallucination (fixed post-review), over-balanced ambiguity in middle (escalation variety rule added)

**Before instability rules**: Scene execution ~6/10 ("impressive but not gripping")
**After instability rules**: Scene execution ~8.5-9/10 ("controlled and alive, not generic")
