# Generation Modes

The pipeline supports different generation modes for testing, cost control,
and content specialization. Three entry points:

- **Web UI** (`frontend/components/PipelineWorkshop.tsx`): a mode dropdown on
  project creation lets you pick `default` / `fast` / `erotica` / `erotica-fast`
  / `erotica-hybrid` / `haiku`. Requires the Express backend running with the
  relevant provider API keys.
- **CLI scripts** (`scripts/mode-test.ts`, `scripts/ab-test-scenes.ts`, etc.):
  same modes via flags like `--fast`, `--erotica`, `--haiku`.
- **Agent pipeline** (`scripts/agent-pipeline/run.ts init --mode <mode>`):
  runs the same pipeline via Claude subagents in a chat session. Supports
  every mode after the 2026-04-16 `--mode` flag was added. Falls back to
  `default` when the flag is omitted — see
  `scripts/agent-pipeline/README.md` for the full workflow.

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
- **Writer:** Gemini 2.5 Flash
- **Judge:** Skipped entirely
- **Tension:** Skipped
- **Parallelism:** Sequential (batchSize=1). Fast mode previously ran four
  scenes in parallel but `previousSceneDigest` was computed once per batch,
  so parallel scenes couldn't see each other — forced back to sequential on
  2026-04-16.
- **Postproduction:** Skipped
- **Cost:** ~$0.10-0.20 for 8 scenes (slightly higher than the old parallel cost
  but with intra-batch continuity preserved)
- **Time:** ~3-5 minutes
- **Use when:** Testing prompt changes, iterating on scene quality, A/B comparisons
- **Tradeoff:** No cross-scene tension tracking, no vitality checking, cheaper model may miss nuance

### Erotica (`--erotica`)
```bash
npx tsx scripts/mode-test.ts --erotica
```
- **ALL roles:** Grok-4 (writer, judge, bible, intake — everything)
- **Judge:** Grok-4-fast
- **Tension:** Full cross-scene tracking
- **Postproduction:** Not run by this script (run separately)
- **Cost:** Depends on Grok pricing
- **Time:** ~12-15 minutes (sequential)
- **Use when:** Stories with explicit sexual content where Sonnet refuses or sanitizes
- **Tradeoff:** Grok's creative quality may differ from Sonnet's
- **Why all Grok:** Sonnet refuses explicit content at the premise/intake stage, which cascades — a broken premise means broken everything downstream. Using Grok for ALL roles avoids content refusals at every pipeline stage.

For full pipeline runs (not just scene regeneration), start the backend with:
```bash
V2_MODE=erotica npm run dev
```
Then use the normal web UI or pipeline runner. All roles will use Grok.

### Haiku (`--haiku`)
```bash
npx tsx scripts/mode-test.ts --haiku
```
- **Writer:** Claude Haiku 4.5
- **Judge:** Skipped
- **Tension:** Skipped
- **Parallelism:** Sequential (batchSize=1) since the same 2026-04-16 fix
- **Postproduction:** Skipped
- **Cost:** ~$0.05-0.10 for 8 scenes
- **Time:** ~2-3 minutes
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

## Full Pipeline Runs (via web UI or pipeline runner)

The `mode-test.ts` script regenerates scenes from an existing project. For
a full pipeline run from seed (intake → premise → bible → scenes), you need
the backend server to use the right models. Set the `V2_MODE` env var:

```bash
V2_MODE=erotica npm run dev    # All roles use Grok-4
V2_MODE=fast npm run dev       # All roles use Gemini Flash
npm run dev                    # Default (Sonnet + Haiku)
```

Then use the web UI or pipeline runner as normal — the backend will route
all LLM calls through the mode's model config.

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
