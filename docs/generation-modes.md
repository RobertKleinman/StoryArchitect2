# Generation Modes

The pipeline supports different generation modes for testing, cost control,
and content specialization. Modes are available via CLI scripts only (not
the web GUI yet).

## Available Modes

### Default (production quality)
```bash
npx tsx scripts/mode-test.ts
```
- **Writer:** Claude Sonnet 4.6 (sequential, with tension tracking)
- **Judge:** Claude Haiku 4.5 (changed from Sonnet 2026-03-30 — structured evaluation doesn't need Sonnet)
- **Tension:** Full cross-scene tracking
- **Postproduction:** Full 5-pass editor + packager
- **Cost:** ~$1.20-1.50 for 8 scenes
- **Time:** ~12-15 minutes
- **Use when:** Final production runs, quality matters most

### Fast (`--fast`)
```bash
npx tsx scripts/mode-test.ts --fast
```
- **Writer:** Gemini 2.5 Flash (all scenes in parallel)
- **Judge:** Skipped entirely
- **Tension:** Skipped (enables parallel generation)
- **Postproduction:** Skipped
- **Cost:** ~$0.10-0.15 for 8 scenes
- **Time:** ~2-3 minutes
- **Use when:** Testing prompt changes, iterating on scene quality, A/B comparisons
- **Tradeoff:** No cross-scene tension tracking, no vitality checking, cheaper model may miss nuance

### Erotica (`--erotica`)
```bash
npx tsx scripts/mode-test.ts --erotica
```
- **Writer:** Grok-4 (more permissive with adult/erotic content)
- **Judge:** Haiku (default)
- **Tension:** Full cross-scene tracking
- **Postproduction:** Not run by this script (run separately)
- **Cost:** Depends on Grok pricing
- **Time:** ~12-15 minutes (sequential)
- **Use when:** Stories with explicit sexual content where other models refuse or sanitize
- **Tradeoff:** Grok's creative quality may differ from Sonnet's

### Haiku (`--haiku`)
```bash
npx tsx scripts/mode-test.ts --haiku
```
- **Writer:** Claude Haiku 4.5 (all scenes in parallel)
- **Judge:** Skipped
- **Tension:** Skipped
- **Postproduction:** Skipped
- **Cost:** ~$0.05-0.08 for 8 scenes
- **Time:** ~1-2 minutes
- **Use when:** Quick smoke tests, checking if prompts parse correctly, cheapest possible
- **Tradeoff:** Noticeably lower creative quality than Sonnet

## A/B Test Script

For comparing specific scenes between old and new prompt versions:
```bash
npx tsx scripts/ab-test-scenes.ts [project-json] [scene-indices]
npx tsx scripts/ab-test-scenes.ts                           # default project, scenes 0,1,8
npx tsx scripts/ab-test-scenes.ts data/pipeline-output/foo.json 0,3,5
```
Regenerates specified scenes with current prompts, outputs side-by-side
comparison markdown in `data/ab-tests/`.

## Using a Different Project

All scripts default to the sci-fi compliance story. Override with a path:
```bash
npx tsx scripts/mode-test.ts --fast data/pipeline-output/other-project.json
```

## What Changed (2026-03-30)

### Scene judge: Sonnet → Haiku
**File:** `shared/modelConfig.ts` line 263
**Why:** Scene judging is structured evaluation against a rubric (pass/fail + vitality flags). Haiku handles this well — it's classification, not creativity.
**Revert:** Change `FAST` back to `STRONG` on the `scene_judge` line.

### Scene generation mode options
**File:** `backend/services/v2/sceneGenerationService.ts`
**New options on `generate()`:**
- `writerModel?: string` — override writer model
- `skipJudge?: boolean` — skip scene judge entirely
- `skipTension?: boolean` — skip tension state tracking

These options are NOT exposed in the web API yet. They only work when calling
the service directly (via CLI scripts). The production pipeline is unchanged.

### Mode test script
**File:** `scripts/mode-test.ts`
Standalone script that loads an existing project and regenerates all scenes
with mode overrides. Output goes to `data/mode-tests/`.

### A/B test script
**File:** `scripts/ab-test-scenes.ts`
Regenerates 3 specific scenes for side-by-side comparison. Output goes to
`data/ab-tests/`.
