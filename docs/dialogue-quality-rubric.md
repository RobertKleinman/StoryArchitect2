# Dialogue Quality Test Rubric

Use this rubric to evaluate dialogue improvements across pipeline versions.
Score each dimension per-scene, then aggregate across the test set.

## Test Set Selection

Pick 3 representative scenes from the same story:
1. **Confrontation** — high emotional stakes, characters in conflict
2. **Procedural/institutional** — audit, testimony, or authority interaction
3. **Erotic/power-exchange** — D/s dynamics, consent negotiation, intimacy

Regenerate each scene under both old and new pipeline configurations using
the same seed, bible, scene plan, and tension state.

## Scoring Dimensions

### 1. Thematic Leakage (count)

Count dialogue lines where a character articulates something they shouldn't
have access to. A line "leaks" if it matches ANY of these:

- **Names the scene's theme or argument** — e.g., "Is there a difference
  between the number and the feeling?"
- **Articulates the character's own psychological mechanism** — e.g.,
  "I need to know if I was there or if something that reads like me was there"
- **Describes a conversational dynamic from inside it** — e.g., "I want you
  to answer a question without telling me what you did instead"
- **Summarizes what the reader should understand** — e.g., "You knew what
  my body was doing every time I was near you. Before I knew."

Report as: total leaking lines / total dialogue lines = leakage rate.
Target: <10% leakage rate.

### 2. Character Distinctiveness (1-5 scale)

Blind-read the dialogue lines (stripped of speaker labels). Can you tell
who is speaking from voice alone?

| Score | Description |
|-------|-------------|
| 1 | All characters sound identical |
| 2 | One character is distinguishable; others blend |
| 3 | Characters have different content but similar syntax/register |
| 4 | Most characters have recognizable speech patterns |
| 5 | Each character has a distinctive voice; removing labels doesn't obscure identity |

### 3. Scene Coherence (1-5 scale)

Does the scene hold together as a unified dramatic unit? Does dialogue
connect to physical action? Do transitions feel natural?

| Score | Description |
|-------|-------------|
| 1 | Scene feels disjointed; dialogue and action disconnected |
| 2 | Mostly coherent but some non-sequiturs or forced transitions |
| 3 | Coherent throughout; no major breaks |
| 4 | Strong coherence; dialogue and blocking reinforce each other |
| 5 | Seamless — impossible to separate dialogue from physical scene |

### 4. Retained Plot Clarity (pass/fail per scene)

After revision/changes, does the reader still understand:
- What happened in the scene?
- What information was revealed?
- What changed between characters?

If any of these is ambiguous or lost: FAIL.

### 5. Protected-Line Alterations (count)

For scenes with erotic/consent/power-exchange content, count lines where:
- Consent negotiation was removed or obscured
- Power-exchange dynamics were softened inappropriately
- Explicit boundary-setting was cut
- Plot-critical revelations were lost

Target: 0 protected-line alterations.

### 6. Erotic Register Preservation (pass/fail)

For adult-content scenes only. Does the scene still:
- Write erotica faithfully (not fading to black)?
- Preserve the physical-emotional interplay?
- Maintain the power dynamic's clarity?

If any of these regressed: FAIL.

## Mechanical Metrics (automated)

These can be measured by script, not human judgment:

- **Consecutive INTERNAL blocks**: count of instances where >3 INTERNAL
  lines appear without an intervening NARRATION/DIALOGUE/action line
- **Average dialogue sentence length**: mean word count per dialogue line
  (target: <15 words for non-procedural speech)
- **Phrase repetition**: count of phrases appearing in 3+ scenes
- **Emotion tag distribution**: percentage of lines tagged "neutral"
  (target: <20% for non-NARRATION lines)
- **Speaker attribution accuracy**: percentage of speaker names matching
  characters_present list

## Evaluation Protocol

1. Generate scenes under old config (baseline)
2. Generate scenes under new config (treatment)
3. Blind-label outputs as A and B (randomized)
4. Score dimensions 1-6 on both without knowing which is which
5. Reveal labels, compare scores
6. Run mechanical metrics on both
7. Decision: treatment is better if it improves dimensions 1-2 without
   regressing 3-6 or mechanical metrics
