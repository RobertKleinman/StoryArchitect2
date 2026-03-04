# Known Issues & Improvements

## Fixed (this session)

### ~~Satisfaction formula is hardcoded and wrong~~
**Status:** FIXED — replaced with LLM-assessed satisfaction in user_read schema output.
The LLM now judges satisfaction with full conversational context each turn.

### ~~Builder maxTokens is hardcoded~~
**Status:** FIXED — now adaptive: `4000 + castSize * 1500` (capped at 16000).
Scales with number of characters discovered during clarification.

### ~~Prior-turn compression window is hardcoded at 1~~
**Status:** FIXED — now adaptive: shows 2 full turns for short sessions (≤3 turns), compresses to 1 for longer ones.

### ~~Persistence tracker matches on assumption ID~~
**Status:** FIXED — now matches by checking whether hypotheses updated at prior turn's timestamp are seeing consistent user behavior (keep rate vs change rate).

### ~~Formatter shows only 4 hypotheses across 6 categories~~
**Status:** FIXED — bumped to 5 with category-aware selection: picks top 1 per active category first, then fills remaining slots by confidence. No category goes dark.

## Remaining (low priority)

### OBVIOUS_PATTERN_DETECTION is in output format section
**Files:** `characterPrompts.ts`, `hookPrompts.ts`, `characterImagePrompts.ts`
**Problem:** Currently embedded in the user_read output format instructions, but it's really analysis guidance, not output formatting. Would be more effective in the STEP 1 (READ THE USER) section where the LLM forms its initial impressions.
**Impact:** Low — the LLM still sees it, just in a slightly awkward location. Worth moving eventually.

## Watch List (monitor during testing)

- **minItems: 3 on alternatives** — if the LLM produces filler 3rd options, consider relaxing to minItems: 2 with a prompt instruction "prefer 3+ alternatives"
- **Persistence tracker accuracy** — the keep-rate-vs-change-rate heuristic is better than ID matching but still approximate. Monitor whether the persistence summary in prompts is actually useful to the LLM.
- **Prompt caching effectiveness** — check logs for `cache: read=` entries to confirm caching is working. If system prompts are changing too much between turns (due to dynamic psychology ledger content), caching won't help.
