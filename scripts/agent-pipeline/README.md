# Agent Pipeline

An alternate visnovgen v2 pipeline that routes every LLM call to Claude
subagents spawned in-session via the Agent tool, instead of calling the
configured provider APIs (Anthropic / OpenAI / Gemini / Grok).

This pipeline is **not** used by the visnovgen backend, the GUI, or any
of the existing `v2-*.ts` scripts. It is a standalone CLI that reads the
same prompt builders, schemas, and post-processing functions as the real
v2 pipeline, but orchestrates them through a chat-driven flow where the
LLM work happens inside subagent calls made from the parent Claude Code
session.

---

## How it differs from the other pipelines

| Aspect | v2 pipeline (backend) | `v2-pipeline-runner.ts` | **agent-pipeline** |
|---|---|---|---|
| Who runs it | Express server + routes | CLI that drives the backend | CLI + Claude Code orchestrator |
| LLM backend | Anthropic/OpenAI/Gemini/Grok via `llmClient.ts` | Same (talks to running backend) | **Subagents spawned from the chat session** |
| Requires backend running | Yes | Yes | **No** |
| Uses provider API keys | Yes (visnovgen `.env`) | Yes | **No — never loads `.env`** |
| Data directory | `data/v2/` | `data/v2/` | `data/v2-agent/` (separate namespace) |
| Orchestration | State machine in `backend/services/v2/orchestrator.ts` | REST calls + polling | Two-party: CLI owns state + prompt building, chat orchestrator spawns subagents |
| Review gates | Human in GUI | Auto-approved via CLI | **Auto-approved (default) with cascade into next phase** |

### The two-party split

The orchestration is deliberately split:

- **The CLI (`run.ts`)** owns state I/O, prompt building, schema
  validation, and all deterministic post-processing (name resolution,
  phantom scrubbing, voice assignment, tension state advance). It
  **never makes LLM calls**.
- **The chat session (Claude Code)** owns LLM compute. For each step,
  the CLI emits a prompt spec; the chat orchestrator spawns a subagent
  with that prompt, captures the output, and feeds it back into the CLI
  via `ingest`.

This split exists because TypeScript can't spawn the Agent tool and the
Agent tool can't import visnovgen's prompt builders cleanly. Letting
each side do what it's good at preserves full fidelity with the real
prompt builders while keeping the LLM work inside Claude Code.

### What fidelity is preserved

The CLI imports the real backend functions directly:

- All prompt templates from `backend/services/v2/prompts/*`
- All JSON schemas from `backend/services/v2/schemas/*`
- `buildMustHonorBlock`, `formatPsychologyLedgerForPrompt`
- `getForcingFunctions` + `formatForcingBlock` (mode-aware + stage-aware)
- `loadFingerprints` + `buildFreshnessBlock` (reads real story history)
- `resolveAllNames` + `replacePlaceholders` (name pool)
- `assignVoicePatterns` + `applyVoicePatterns` (voice pool)
- `SENSORY_PALETTE_SYSTEM` + schema
- `compressForScene`, `previousSceneDigest`, `buildCanonicalNames`
- `formatScenePlanForWriter` (full SITUATION vs BACKGROUND PRESSURE split)

Mode is hard-coded to `default`, so the forcing-function + model
selection logic matches the real default-mode configuration.

### Improvements over the backend

1. **User-provided name preservation.** When the seed names characters
   explicitly, the character post-processing maps `__CHAR_X__`
   placeholders back to the intended names from `characters_sketch`
   and passes them as `userProvidedNames` to `resolveAllNames`. The
   real backend does not do this — it lets the name pool override
   user-provided names. Validated across 3 stories: all user-named
   characters (LaLa, Muscles, Adamas, Aletheia, etc.) were preserved.

2. **Dynamic phantom-name scrubber.** The scrubber that removes
   hallucinated character names from plot beats now extracts every
   word from the story's own location names (from
   `worldData.arena.locations`) and adds them to the exclusion set.
   The real backend uses a static word list that misses story-specific
   locations, corrupting 2-word location names like "French Consulate"
   or "Inscription Nexus" into "an outsider". The agent-pipeline fix
   is dynamic — works for any story regardless of setting.

3. **WorldData placeholder resolution.** The deep placeholder sweep
   (`__CHAR_X__` → resolved names) runs on both `charData` AND
   `worldData`. The real backend only sweeps charData, leaving raw
   placeholders in world descriptions that propagate into downstream
   prompts.

### Known divergences from the backend

1. **No prompt caching.** The real scene writer uses Anthropic's
   cacheable prefix across scenes. Subagents re-process the full
   context every call. Output is identical; per-call latency is higher.
2. **No structured-output enforcement at the model level.** Provider
   APIs support JSON-schema constrained decoding; subagents don't.
   Outputs are parsed via `parse.ts` (fence stripping, balanced-brace
   extraction) with required-key validation.
3. **Sequential scenes only.** The real pipeline can batch scenes.
   Parallel ingestion with shared tension state is messy, so Phase 3
   generates scenes one at a time.
4. **Judge repair loops are orchestrator-driven.** The CLI reports
   `repair` as the next action when a judge fails; the chat
   orchestrator runs the repair call and ingests. Same observable
   behaviour as the real pipeline, just with the retry loop outside the
   CLI.
5. **Cultural researcher role is skipped.** Default mode makes this
   optional and it adds complexity without creative-fidelity win.

---

## Data layout

```
data/v2-agent/
  <projectId>.json           # AgentProject { state, extension }
  <projectId>/
    raw/                     # Subagent output archives per role+timestamp
    _pending/                # Ad-hoc scratch files (not required)
```

Each project file is a single JSON document:

```jsonc
{
  "state": { ... ProjectState ... },     // same discriminated union as real v2
  "extension": { ... AgentExtension ... } // orchestrator-only transient drafts
}
```

`ProjectState` is the exact type from `shared/types/project.ts`, so it
can be inspected with any tool that already reads visnovgen projects.
`AgentExtension` holds things that don't fit cleanly into the canonical
state machine (draft premise awaiting judge, candidate A/B for scene
reroll, tension state, etc.) and is cleared at the phase boundaries.

---

## CLI commands

```bash
npx tsx scripts/agent-pipeline/run.ts <command> [flags]
```

| Command | Purpose |
|---|---|
| `init --seed "..." [--project-id ID] [--skip-intake]` | Create a new project. `--skip-intake` injects a synthetic turn-1 ready-for-premise. |
| `status --project-id ID` | Print current step + next action + extension summary. |
| `prompt --project-id ID [--user-input "..."]` | Emit the next prompt spec as JSON (stdout). `--user-input` is required for intake turns ≥ 2 (the user's answer to the previous question). |
| `ingest --project-id ID --input FILE [--user-input "..."] [--duration MS]` | Validate subagent output, apply to state, advance the state machine. `FILE` contains the raw subagent response. |
| `approve-premise --project-id ID` | Auto-approve the premise gate and cascade into `bible_generating`. |
| `approve-scenes --project-id ID` | Auto-approve the scene-plan gate and cascade into `scene_generating`. |
| `export --project-id ID` | Dump the full project as JSON. If the project is `completed`, also saves the fingerprint for freshness on future runs. |

---

## How the chat orchestrator runs it

For each role the CLI reports as the next action:

1. `npx tsx run.ts prompt --project-id ID > _pending/role_prompt.json`
2. Extract the `systemPrompt` + `userPrompt` + `schema` into a scratch
   `.txt` file the subagent can read (keeps long prompts out of the
   chat context).
3. Spawn `Agent({ subagent_type: "general-purpose", model: <tier>, ... })`
   with a wrapper prompt that instructs the subagent to read the scratch
   file and respond with a single JSON object matching the schema.
4. Save the subagent's raw output to `_pending/role_result.json`.
5. `npx tsx run.ts ingest --project-id ID --input _pending/role_result.json`
6. Repeat until `nextAction.kind === "gate"` (run the matching
   `approve-*` command) or `"done"`.

The `subagentTier` field in each prompt spec tells the chat orchestrator
which model tier to use (`sonnet` for writers and most judges, `haiku`
for `scene_judge` and `v2_summarizer` — matching `DEFAULT_V2_MODEL_CONFIG`).

---

## Pipeline phases and LLM calls

```
Phase 1 — Premise
  intake (Sonnet, up to 2 turns)
  premise_writer (Sonnet)
  premise_judge (Sonnet)
  [optional] premise_writer repair (Sonnet)
  [gate] approve-premise → cascades into bible_generating

Phase 2 — Bible
  bible_writer:world (Sonnet)
  bible_writer:characters (Sonnet) + deterministic name resolution +
    voice assignment + placeholder sweeps + premise name sync
  bible_writer:plot (Sonnet) + deterministic phantom-name scrub
  bible_judge (Sonnet)
    [up to 2 retries of plot writer if judge flags critical/major]
  v2_summarizer:sensory_palette (Haiku, non-fatal)
  scene_planner:step_back (Sonnet, free text, non-fatal)
  scene_planner (Sonnet)
  Assembly: StoryBibleArtifact + ScenePlanArtifact → scene_review
  [gate] approve-scenes → cascades into scene_generating

Phase 3 — Scenes (per scene, sequential)
  scene_writer (Sonnet) → candidate A
  scene_judge (Haiku)
    [if pass && vitality < 3/5]
      scene_writer_b (Sonnet) → candidate B
      scene_judge_b (Haiku)
      pick higher vitality
  Commit winning scene, extract distinctive phrases
  v2_summarizer:tension_update (Haiku)
  Advance scene index; loop
  Final: assemble StepCompleted

Export
  Deterministic: extractFingerprint + saveFingerprint (feeds freshness
  block for the next generation run)
```

Typical story cost: ~25 subagent calls across all three phases for a
6–10-scene default-mode run.

---

## Resuming and debugging

- Project state is persisted after every `ingest`. Kill the process, come
  back later, run `status`, and pick up from the next action.
- `data/v2-agent/<id>/raw/` archives every subagent output for replay
  and diffing.
- `export` always prints the full project even for non-completed
  projects, so you can inspect intermediate drafts stored in the
  extension.
- Type-check the pipeline after any changes:

  ```bash
  npx tsc --noEmit --target ES2022 --module ESNext \
    --moduleResolution Bundler --strict --esModuleInterop \
    --skipLibCheck --resolveJsonModule --isolatedModules \
    scripts/agent-pipeline/run.ts
  ```

---

## When to use this vs the real pipeline

- Use the **real v2 pipeline** for production runs, the GUI, any mode
  other than default, and anything that needs parallel scenes or
  prompt caching performance.
- Use the **agent pipeline** when you want to run a default-mode story
  entirely inside a Claude Code session without touching visnovgen's
  provider API keys, or when you want to inspect exact prompts and
  state transitions without a backend server in the loop.
