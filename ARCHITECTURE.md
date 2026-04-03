# **VISNOVGEN v2 PIPELINE ARCHITECTURE DOCUMENT**

## **Executive Summary**

The visnovgen v2 pipeline is a **modular, state-machine-driven story generation system** that transforms a single seed concept into a complete visual novel (VN) through **six sequential steps**, with optional human review and revision at two critical gates. The system uses **9 distinct LLM roles** (down from 38 in v1) across multiple providers (Anthropic, OpenAI, Gemini, Grok), manages **persistent state** with checkpointing for resumability, and incorporates **psychology-aware adaptation**, **constraint satisfaction**, **freshness injection**, and **multi-pass postproduction** to ensure quality output.

**Key characteristics:**
- **Input:** story seed (1-2 sentences) + optional cultural context
- **Output:** complete VN with premise, story bible (world, characters, plot), scene plan, and 6-12 fully written scenes in screenplay format
- **Duration:** 10-30 minutes per story (depending on mode and LLM provider)
- **Cost:** $0.30–$2.00 per story (varies by model selection)
- **LLM calls:** 15–25 calls per story (serialized + parallel where possible)

---

## **PART 1: ARCHITECTURE OVERVIEW**

### **1.1 Six-Step Pipeline Flow**

```
Step 1: Intake              (user ↔ system dialog)
   ↓
Step 2: Premise Gen         (batch, writer + judge)
   ↓
Step 3: Premise Review      (user review gate)
   ↓
Step 4: Bible Gen           (batch: world → chars → plot → judge)
   ↓
Step 5: Scene Plan Review   (user review gate)
   ↓
Step 6: Scene Generation    (batch: parallel scenes with tension tracking)
   ↓
Terminal: Completed         (or Failed/Aborted)
```

### **1.2 State Machine**

**Type:** Discriminated union on `step` field.  
**Persistence:** Project state persists to JSON after each step transition.  
**Granularity:** Fine-grained checkpoints enable resumption mid-batch (e.g., after scene 3 of 8).

**States:**
- `idea_gathering` — user inputs seed, answers clarifying questions (max 2 turns)
- `premise_generating` — LLM writes premise (background operation)
- `premise_review` — user reviews and can revise (0–3 revision rounds)
- `bible_generating` — LLM builds world/characters/plot (background)
- `scene_review` — user reviews and can edit scene plan
- `scene_generating` — LLM writes all scenes (parallel-capable, checkpointed)
- `completed` — all artifacts finalized
- `failed` — operation failed; recovery snapshot saved for retry
- `aborted` — user cancelled mid-operation

---

## **PART 2: ENTRY POINTS & API SURFACE**

### **2.1 Backend Entry Point** (`backend/index.ts`)

**Express app on port 3001 (configurable via `PORT` env var)**

**Key startup sequence:**
1. Load environment (dotenv)
2. Register CORS + body-size limits (2 MB max)
3. Mount all route handlers
4. **Startup recovery:** scan for projects in `generating` states and mark as `failed` (handles server crashes)
5. Configure graceful shutdown (drain connections, 10 s timeout)

**Mounted routes:**
- `/api/v2/project/*` — project CRUD + step actions
- `/api/v2/project/*` — SSE endpoint for progress streaming
- Legacy `/api/hook/*`, `/api/character/*`, `/api/world/*`, etc. (v1 only—not documented here)

### **2.2 v2 Project Routes** (`backend/routes/v2/project.ts`)

**REST API surface:**

| Method | Endpoint | Purpose | Returns |
|--------|----------|---------|---------|
| POST   | `/api/v2/project` | Create new project | `{ projectId }` |
| GET    | `/api/v2/project/:id` | Fetch project state | `{ project }` |
| DELETE | `/api/v2/project/:id` | Delete project | `{ deleted: true }` |
| POST   | `/api/v2/project/:id/retry` | Retry from failure | `{ restored, step, failedAt }` |
| POST   | `/api/v2/project/:id/abort` | Abort current operation | `{ aborted }` |
| **Step 1: Intake** | | |
| POST   | `/api/v2/project/:id/intake` | Submit user input | `IntakeResponse` (q, assumptions, ready flag) |
| **Step 2: Premise** | | |
| POST   | `/api/v2/project/:id/generate-premise` | Start batch | `{ operationId }` (202 Accepted) |
| GET    | `/api/v2/project/:id/premise` | Poll status | `{ status, premise?, error? }` |
| POST   | `/api/v2/project/:id/review-premise` | Approve/revise | `{ approved, premise, reviewRound }` |
| **Step 4: Bible** | | |
| POST   | `/api/v2/project/:id/generate-bible` | Start batch | `{ operationId }` (202 Accepted) |
| GET    | `/api/v2/project/:id/bible` | Poll status | `{ status, storyBible?, scenePlan?, error? }` |
| **Step 5–6: Scenes** | | |
| POST   | `/api/v2/project/:id/review-scenes` | Approve/revise plan | `{ approved, scenePlan }` |
| POST   | `/api/v2/project/:id/generate-scenes` | Start batch | `{ operationId }` (202 Accepted) |
| GET    | `/api/v2/project/:id/scenes` | Poll status | `{ status, scenes[], progress?, error? }` |
| **Export** | | |
| GET    | `/api/v2/project/:id/export` | Download full project JSON | Full `ProjectState` |
| GET    | `/api/v2/project/:id/traces` | Download LLM call logs | `{ traces[] }` |

**Key patterns:**
- **Async operations** (gen-premise, gen-bible, gen-scenes) return **202 Accepted** with `operationId`, then operate in background.
- **Polling endpoints** check status and return progress (for real-time UI updates).
- **SSE endpoint** (`/api/v2/project`) streams `step_complete`, `progress`, `scene_complete`, `error`, `aborted` events.
- **Conflict prevention:** `acquireInflight(key)` prevents simultaneous generation for the same project.

### **2.3 Frontend Entry Point** (`frontend/components/PipelineWorkshop.tsx`)

**Single-page React component** implementing the full 6-step UX.

**Key features:**
- Project creation with mode selector (default, fast, erotica, erotica-fast, erotica-hybrid, haiku)
- SSE subscription for real-time progress updates
- Step indicator sidebar showing completion status
- Automation mode (auto-approve premise → auto-generate bible → auto-approve scenes → auto-gen scenes)
- Manual review steps with edit UI for premise and scene plan
- Export button (downloads full JSON for postproduction)
- Error handling + retry button

**Client API layer** (`frontend/lib/v2Api.ts`):
```typescript
v2Api.createProject(req)
v2Api.getProject(id)
v2Api.runIntake(id, userInput, assumptionResponses)
v2Api.generatePremise(id)          // returns 202, triggers background
v2Api.reviewPremise(id, {action, changes, inlineEdits})
v2Api.generateBible(id)            // returns 202
v2Api.reviewScenes(id, {action, changes})
v2Api.generateScenes(id)           // returns 202
v2Api.exportProject(id)
v2Api.abort(id)
v2Api.retry(id)
```

---

## **PART 3: STEP 1 — INTAKE SERVICE**

**File:** `backend/services/v2/intakeService.ts`

**Purpose:** Gather enough story context to proceed to premise generation (max 2 conversation turns).

### **Inputs**
- `project: Step1_IdeaGathering` (initial or carry-over)
- `userInput: string` (seed or response to clarifying question)
- `assumptionResponses?: Array<{assumptionId, action, newValue}>` (optional)

### **Process**

1. **Update constraint ledger** from assumption responses (track user confirmations/changes)
2. **Build context** from psychology ledger + must-honor constraints + cultural context
3. **LLM call:** `intake` role
   - **System prompt:** focuses on understanding story concept, extracting assumptions
   - **User prompt:** includes seed, conversation history, any psychology context
   - **Temperature:** 0.7
   - **Max tokens:** 2000
   - **Output schema:** `IntakeSchema` (JSON)

4. **Parse response:**
   - `question?: string` — clarifying question if not ready
   - `assumptions: [{id, category, assumption, alternatives}]` — what the LLM inferred
   - `readyForPremise: boolean` — confidence threshold
   - `constraint_updates: [{key, value, source}]` — inferred story constraints
   - `raw_signals: [{hypothesis, category, evidence}]` — psychology observations

5. **Forced readiness:** If turn ≥ 2, force `readyForPremise = true` (hard cap on interaction)

6. **Update psychology ledger** from signals (record behavior observations for downstream adaptation)

7. **Return** `IntakeResponse` to frontend; save updated project

### **Key Outputs**
- `conversationTurns[]` — accumulated dialogue
- `constraintLedger[]` — user-confirmed story facts
- `psychologyLedger` — signals about user preferences
- `readyForPremise: boolean` — proceed flag

### **Model & Config**
- **Model:** `intake` (default: Claude Sonnet 4.6)
- **Provider detection:** automatic from model string prefix
- **Mode override:** `V2_MODE` env var can force all roles to a specific model config

---

## **PART 4: STEP 2 — PREMISE SERVICE**

**File:** `backend/services/v2/premiseService.ts`

**Purpose:** Generate a concise, compelling premise from the seed + intake conversation.

### **4.1 Generation (`generate` method)**

**Inputs:**
- `project: Step2_PremiseGenerating`
- `culturalBrief?: string` (optional)
- `options?: { skipJudge?: boolean }` (fast mode)

**Process:**

1. **Build forcing block:** extract mode-specific narrative constraints (e.g., "no chosen ones" for default mode, "personal agency" for erotica)

2. **LLM Writer call:** `premise_writer` role
   - **System:** `PREMISE_WRITER_SYSTEM` prompt (guides structure)
   - **User:** `buildPremiseWriterPrompt()` includes seed, conversation history, constraints, psychology block, forcing block
   - **Temperature:** 0.8
   - **Max tokens:** 3000
   - **Output schema:** `PREMISE_WRITER_SCHEMA` (structured JSON)

3. **Parse writer output:**
   ```typescript
   {
     hook_sentence: string,           // 1-sentence hook
     emotional_promise: string,       // what reader will feel
     premise_paragraph: string,       // 2-3 sentence summary
     synopsis: string,                // 3-5 sentence full arc
     tone_chips: string[],            // mood keywords (e.g., "noir", "intimate")
     bans: string[],                  // what NOT to include
     setting_anchor: string,          // time/place
     time_period: string,
     characters_sketch: [{name, role, one_liner}],
     core_conflict: string,
     suggested_length: "short"|"medium"|"long",
     suggested_cast: "duo"|"triangle"|"small_ensemble"|"large_ensemble",
   }
   ```

4. **Judge call** (if not skipped):
   - **Role:** `premise_judge`
   - **Prompt:** evaluates against must-honor constraints, checks for coherence, clichés
   - **Temperature:** 0.3 (analytical)
   - **Output schema:** `PREMISE_JUDGE_SCHEMA`
   - **Output:**
     ```typescript
     {
       pass: boolean,
       issues: [{field, fix_instruction}],
       constraint_violations: string[],
     }
     ```

5. **Repair (if judge fails):**
   - Regenerate premise with judge feedback
   - Feed current broken premise + specific fixes to writer
   - Parse repaired output (parse failure → keep original)

6. **Construct PremiseArtifact** with `state: "draft"`

### **4.2 Revision (`revise` method)**

**Inputs:**
- `project: Step3_PremiseReview`
- `feedback: string` (user's revision request)
- `inlineEdits?: Record<string, string>` (direct field edits)

**Process:**

1. If inline edits only (no feedback), apply directly (no LLM)
2. Otherwise, call writer with current premise + feedback
3. Parse and return revised premise

### **Key Outputs**
- `PremiseArtifact` (state: "draft")
- `traces: StepTrace[]` (one per LLM call)

### **Models & Config**
- **premise_writer:** default Claude Sonnet 4.6
- **premise_judge:** default Claude Sonnet 4.6
- Both respect mode-specific overrides (fast→Gemini, erotica→Grok)

---

## **PART 5: STEP 4 — BIBLE SERVICE**

**File:** `backend/services/v2/bibleService.ts`

**Purpose:** Generate a complete story bible: world, characters, plot, and scene plan.

### **5.1 Architecture**

**Sequential sub-steps** (checkpointed for resumability):
1. **World** — setting, locations, rules, factions, world thesis
2. **Characters** — profiles with psychology, names resolved from pool
3. **Plot** — tension beats, turning points, themes, climax, resolution
4. **Judge** — validates consistency and dramatic quality; retries plot if failures detected
5. **Sensory Palette** (implicit) — extracted from world/characters for use in scene writing
6. **Scene Planner** — derives scene plan from plot beats

### **5.2 Sub-step 1: World**

**Role:** `bible_writer`
**System prompt:** `WORLD_WRITER_SYSTEM`
**User prompt:** `buildWorldPrompt()` includes premise, must-honor block, freshness block (old names to avoid), forcing block
**Temp:** 0.8 | **Max tokens:** 4000

**Output schema:** `WORLD_WRITER_SCHEMA`
```typescript
{
  scope: {
    tone_rule: string,        // dominant mood/voice
    violence_level: "none" | "low" | "moderate" | "high" | "extreme",
  },
  arena: {
    locations: [{id, name, description, affordances: string[]}],
  },
  rules: [{rule: string, consequence_if_broken: string}],
  factions: [{name, goal, ideology}],
  consequence_patterns: [{pattern, trigger, consequence}],
  canon_facts: string[],
  world_thesis: string,       // thesis of the world
}
```

**Checkpoint:** Save `worldData` to `checkpoint.worldData`

### **5.3 Sub-step 2: Characters**

**Role:** `bible_writer`
**System prompt:** `CHARACTER_WRITER_SYSTEM`
**User prompt:** `buildCharacterPrompt()` includes premise, world (compressed), must-honor, forcing
**Temp:** 0.8 | **Max tokens:** 5000

**Output schema:** `CHARACTER_WRITER_SCHEMA`
```typescript
{
  characters: [{
    name_spec: {placeholder, culture},  // placeholders like "__CHAR_A__"
    role: string,
    description: string,
    presentation: "masculine"|"feminine"|"androgynous"|"unspecified",
    age_range: string,
    psychological_profile: {
      want: string,
      misbelief: string,
      stress_style: string,
      break_point: string,
      voice_pattern: string,
      speech_card?: {
        typical_length: "short"|"medium"|"long",
        under_pressure: string,
        never_articulates: string,
        deflection_style: string,
      },
    },
    threshold_statement: string,      // "X will do anything to Y, but never Z"
    competence_axis: string,
  }],
  relationships: [{
    between: [char1, char2],
    nature: string,
    stated_dynamic: string,           // public face
    true_dynamic: string,             // hidden reality
  }],
  ensemble_dynamic: string,           // how all characters relate
}
```

**Name Resolution:**
- LLM outputs `name_spec` (placeholder + culture like "Arabic, feminine")
- System calls `resolveAllNames()` with name pool + fingerprints (old stories to avoid)
- **Gender lock:** detects from seed (e.g., "gay male only" → masculine preference)
- Maps placeholders to real names in pool
- Normalizes presentation values (belt-and-suspenders against LLM drift)
- Detects name collisions (e.g., "Dris" / "Idris")
- **Syncs back to premise:** updates any placeholder names in premise text

**Checkpoint:** Save `charData` (with resolved names) to `checkpoint.charData`

### **5.4 Sub-step 3: Plot**

**Role:** `bible_writer`
**System prompt:** `PLOT_WRITER_SYSTEM`
**User prompt:** `buildPlotPrompt()` includes premise, world (compressed), characters (compressed), must-honor
**Temp:** 0.8 | **Max tokens:** 8000

**Output schema:** `PLOT_WRITER_SCHEMA`
```typescript
{
  core_conflict: string,
  tension_chain: [{
    id: string,
    beat: string,                // one narrative beat
  }],
  turning_points: [{
    beat_id: string,
    nature: "revelation"|"choice"|"inciting"|"climax",
  }],
  theme_cluster: string[],       // thematic threads
  dramatic_irony_points: [{
    beat_id: string,
    what_reader_knows: string,
    what_character_knows: string,
  }],
  motifs: [{name, appearances: string[]}],
  mystery_hooks: [{hook, reveal_timing}],
  climax: {
    beat: string,
    why_now: string,
    core_conflict_collision: string,
  },
  resolution: {
    new_normal: string,
    emotional_landing: string,
    ending_energy: "quiet"|"explosive"|"ambiguous"|"hopeful",
  },
  dirty_hands?: {                // if applicable
    beat_id: string,
    what_they_do: string,
    why_necessary: string,
    cost: string,
  },
  addiction_engine: string,      // what drives repeated behavior
}
```

**Checkpoint:** Save `plotData` to `checkpoint.plotData`

### **5.5 Sub-step 4: Judge**

**Role:** `bible_judge`
**Temp:** 0.3 (analytical)
**Max tokens:** 2000

**Evaluates:**
- Internal consistency (world rules, character arcs, plot causality)
- Dramatic quality (tension, stakes, pacing)
- Constraint violations

**Output schema:** `BIBLE_JUDGE_SCHEMA`
```typescript
{
  pass: boolean,
  consistency_issues: [{
    severity: "critical"|"major"|"minor",
    issue: string,
    fix_instruction: string,
  }],
  quality_issues: [{severity, issue, fix_instruction}],
}
```

**If judge fails:**
- Extract critical/major issues
- If retries exhausted or no issues, accept anyway
- Otherwise, regenerate plot with judge feedback (loop up to 2x)

**Checkpoint:** Mark "judge" complete in `completedSubSteps`

### **5.6 Scene Planner (Implicit)**

After judge passes, extract scene plan from plot beats:
```typescript
{
  scenes: [{
    scene_id: string,
    title: string,
    purpose: string,                 // narrative function
    setting: string|{location, time},
    pov_character: string,
    characters_present: string[],
    objective: {want, opposition, stakes},
    exit_hook: string,               // how scene ends
    pacing_type: "dialogue"|"action"|"reflection",
    content_directives?: string[],   // "fade to black", "timeskip", etc.
  }],
  total_scenes: number,
  estimated_word_count: number,
}
```

### **5.7 Outputs**
- `StoryBibleArtifact` (world + characters + plot + sensory palette)
- `ScenePlanArtifact` (derived scenes)
- `traces: StepTrace[]` (one per LLM call, including retries)

### **5.8 Key Dependencies**
- **Freshness injection:** `loadFingerprints()` → `buildFreshnessBlock()` (prevents name/archetype repeats)
- **Name resolution:** `resolveAllNames()` from name pool (culture-aware, gender-locked for erotica)
- **Narrative forcing:** `getForcingFunctions()` (mode-specific constraints)
- **Context compression:** `compressWorldForPlot()`, `compressCharsForPlot()` (fit into token budget)

---

## **PART 6: STEP 6 — SCENE GENERATION SERVICE**

**File:** `backend/services/v2/sceneGenerationService.ts`

**Purpose:** Write 6–12 complete visual novel scenes with cumulative tension tracking.

### **6.1 Architecture**

**Batch processing:**
- Default: sequential generation (batchSize=1) with tension tracking
- Optional: parallel (batchSize=4+) for speed (skips tension updates)
- Checkpointed per scene (resume from scene 3 of 8)

**Cumulative state:**
- **Tension state** accumulates across scenes (relationships, unresolved threads, emotional temperature)
- **Descriptor tracking** flags sensory vocabulary overuse deterministically

### **6.2 Scene Generation Process**

**For each scene plan:**

1. **Extract context:**
   - `compressForScene()` → character profiles + world context for this specific scene
   - `previousSceneDigest()` → summary of all prior scenes (continuity)

2. **Build tension block:** human-readable summary of accumulated story state (for scene 2+)

3. **LLM Writer call:** `scene_writer` role
   - **System prompt:** `SCENE_WRITER_SYSTEM`
   - **User prompt:** `buildSceneWriterPrompt()` includes:
     - Formatted scene plan (objective, setting, POV, exit hook)
     - Character profiles (POV=full psychology, non-POV=external behavior only)
     - World context (location details, tone rule, active rules)
     - Previous scene digest
     - Must-honor constraints
     - Tension state (if not first scene)
   - **Cacheable prefix:** scene-independent context cached by Anthropic API (faster TTFT for scenes 2–9)
   - **Temperature:** 0.75–0.8
   - **Max tokens:** 4000

4. **Parse output:**
   ```typescript
   {
     scene_id: string,
     vn_scene: {
       title: string,
       setting: string,
       lines: [{
         speaker: string,           // character or "NARRATION" or "INTERNAL"
         emotion?: string,          // "warm", "sharp", etc.
         delivery?: string,         // "[sarcastic]", "[whispered]"
         text: string,              // dialogue or narration
         stage_direction?: string,  // action, blocking
       }],
       transition_out?: string,
     },
     readable: {
       screenplay_text: string,    // reformatted for human reading
     },
   }
   ```

5. **Judge call** (if not skipped):
   - **Role:** `scene_judge`
   - **Temp:** 0.3
   - **Evaluates:**
     - Dramatic vitality (failed intention, non-optimal response, behavioral turn, asymmetry, discovery)
     - Constraint violations
     - Speaker validation
   - **Output:**
     ```typescript
     {
       pass: boolean,
       issues: string[],
       vitality: {
         has_failed_intention: boolean,
         has_non_optimal_response: boolean,
         has_behavioral_turn: boolean,
         has_asymmetry: boolean,
         has_discovery: boolean,
         over_explanation_lines: number,
       },
     }
     ```

6. **Candidate selection:**
   - If vitality score < 3/5 flags and pass=true, generate second candidate
   - Compare both, keep higher vitality
   - If judge fails, keep scene anyway (logged as unfixed)

7. **Update cumulative state:**
   - Extract distinctive phrases (deterministic, no LLM) → prevent repetition
   - Update sensory descriptor frequency tracker
   - Call `updateTensionState()` with Haiku (cheap) to evolve emotional temperature, relationships, unresolved threads

8. **Checkpoint:** append to `generatedScenes[]`, save project

### **6.3 Tension State Evolution**

**LLM call:** `v2_summarizer` role (cheap Haiku)
**Input:** previous tension state + latest scene
**Output:** updated tension state
```typescript
{
  relationships: {[char1-char2]: {current, trajectory, last_shift}},
  unresolved_threads: string[],
  emotional_temperature: number,  // 1–10
  register_history: string[],     // vocabulary used
  what_the_reader_knows: string[],
  what_hasnt_broken_yet: string[],
  scene_count: number,
  used_phrases: string[],
}
```

**This enables:**
- Relationship arcs (tracking character dynamics across scenes)
- Narrative momentum (escalating stakes)
- Vocabulary variety (avoid repetition)

### **6.4 Outputs**
- `GeneratedScene[]` (each has plan, vn_scene, readable, judge_result)
- `traces: StepTrace[]` (writer + judge + tension updates)

### **6.5 Key Options**
- `batchSize: number` — 1 (sequential) or 4+ (parallel, no tension tracking)
- `skipJudge: boolean` — accept writer output as-is (fast mode)
- `skipTension: boolean` — don't evolve tension (enables parallel)
- `writerModel: string` — override writer LLM (e.g., "grok-4" for erotica even in default mode)

### **6.6 Caching Strategy**

**Anthropic cache** for static prefix:
- Scene-independent context (world, characters, must-honor) is cached as a separate prefix
- Scenes 2–9 read from cache (first scene pays full cost, saves 20–30% for remaining)

---

## **PART 7: SUPPORTING SERVICES**

### **7.1 LLM Client** (`backend/services/llmClient.ts`)

**Purpose:** Unified interface to multiple LLM providers with automatic provider detection, retry logic, token tracking, and structured outputs.

**Key methods:**
```typescript
async call(
  role: HookRole | V2Role,
  systemPrompt: string,
  userPrompt: string,
  options?: CallOptions,
): Promise<string>
```

**Providers:**
- **Anthropic:** Claude (via official SDK)
- **OpenAI:** GPT-5 series (OpenAI-compatible API)
- **Gemini:** Google Gemini 3.x (native API)
- **Grok:** xAI Grok 4.x (OpenAI-compatible endpoint)

**Automatic provider detection:**
```typescript
detectProvider(model: string): LLMProvider
// "claude-*" → anthropic
// "gpt-*" | "o1-*" | "o3-*" | "o4-*" → openai
// "gemini-*" → gemini
// "grok-*" → grok
```

**Retry logic:**
- Retries up to 3 times on 429 (rate limit), 500 (server error), 529 (overloaded)
- Exponential backoff
- Respect abort signals (client disconnect)

**Structured outputs:**
- If `jsonSchema` provided, LLM constrained to return valid JSON
- Automatic JSON repair on truncation

**Token tracking:**
- Accumulates input, output, cache-read, cache-write tokens per session
- Logged at INFO level per call

**Truncation handling:**
- `truncationMode: "critical"` (builder, judge) → fail hard
- `truncationMode: "best-effort"` (other) → retry with 1.5x tokens, then JSON repair

### **7.2 Progress Emitter** (`backend/services/v2/progressEmitter.ts`)

**Purpose:** EventEmitter-based SSE for real-time progress updates.

**Event types:**
- `progress`: `{totalSteps, completedSteps, currentStep, startedAt}`
- `scene_complete`: `{scene_id, index, total}`
- `step_complete`: `{step: "premise_review" | "scene_review" | "completed"}`
- `error`: `{message, step}`
- `aborted`: `{step}`

**Usage:**
```typescript
emitProgress(projectId, {totalSteps: 5, completedSteps: 2, ...})
emitSceneComplete(projectId, "scene_3", 3, 8)
emitStepComplete(projectId, "premise_review")
emitError(projectId, "Premise writer failed", "premise_generating")
cleanupEmitter(projectId)  // on completion/delete
```

### **7.3 Context Compressor** (`backend/services/v2/contextCompressor.ts`)

**Purpose:** Extract relevant context slices for each scene, prevent context window exhaustion.

**Key functions:**
```typescript
buildCanonicalNames(bible): string        // all named entities (prevent hallucination)
buildPlayableBrief(bible, scenePlan): string  // situation-based brief for writer
compressForScene(bible, plan): {characterProfiles, worldContext}
previousSceneDigest(scenes): string       // summary of prior scenes for continuity
```

**Philosophy:** writer gets **situation + constraints**, not raw interpretive fields.
- Scene objective (concrete want/opposition/stakes)
- Character psychology (POV gets full interior, non-POV gets external only)
- Relationship subtext (shown through behavior, not stated)
- World context (location description, tone, active rules)
- Exit hook (narrative requirement)

### **7.4 Must-Honor Block** (`backend/services/mustHonorBlock.ts`)

**Purpose:** Build a compact constraint reinforcement block for end-of-prompt injection (highest attention zone).

**Source:** constraint ledger (user-confirmed + imported facts)
**Filter:** only "confirmed" or "imported" entries (high confidence)
**Format:**
```
══════ MUST HONOR — CONFIRMED FACTS (do NOT contradict) ══════
CHARACTER_NAME: A skilled hacker with a fear of commitment
SETTING: 1920s speakeasy, New York
TONE: Noir, intimate, tense
GENRE_BAN: No sci-fi elements, keep it grounded
```

### **7.5 Psychology Engine** (`backend/services/psychologyEngine.ts`)

**Purpose:** Track user behavior signals across turns; compute confidence and status for each signal.

**Signal lifecycle:** candidate → active → stable → suppressed

**Key functions:**
```typescript
recordSignals(ledger, turn, source, signals[], behavior, adaptation)
formatPsychologyLedgerForPrompt(ledger): string  // readable block for prompts
computeConfidence(events, currentTurn): 0–1     // numeric confidence
computeStatus(confidence, events, turn): SignalStatus
```

**Confidence factors:**
- Base: 0.15 per supporting event (diminishing)
- Recency bonus: +0.05 (within 2 turns)
- Contradiction penalty: –0.20
- Cross-turn bonus: +0.1 (3+ distinct turns)
- Turn cap: max 0.3 on turn 1, max 0.5 on turns 2–3

**Status:**
- **Candidate:** new, low confidence
- **Active:** accumulating evidence
- **Stable:** 4+ supporting events, 3+ turns, confidence ≥ 0.6
- **Suppressed:** contradicted or confidence ≈ 0

### **7.6 Anti-Slop Scanner** (`backend/services/antiSlopScanner.ts`)

**Purpose:** Deterministic (no LLM) scan for LLM-ism patterns in generated text.

**5-tier hierarchy:**
1. **Tier 1** (highest weight): forbidden words (e.g., "yearning", "unfolds")
2. **Tier 2:** sus words (triggers if ≥threshold cluster together)
3. **Tier 3:** overuse groups (e.g., too many "-ed" participles)
4. **Tier 4** (high frequency): sus phrases (e.g., "a beat of silence")
5. **Tier 5:** pattern matching (e.g., repeated exclamation → emotional inflation)

**Output:**
```typescript
{
  score: 0–100,
  pass: boolean,              // score ≤ failThreshold
  totalHits: number,
  totalOccurrences: number,
  wordCount: number,
  tier1, tier2, tier3, tier4, tier5: [{term, count, positions, context}],
  summary: string,
}
```

**Not used in v2 pipeline** (quality baked into prompts) but available for postproduction.

---

## **PART 8: SHARED MODULES**

### **8.1 Model Config** (`shared/modelConfig.ts`)

**Role definitions (9 v2 roles):**
```typescript
type V2Role =
  | "intake"
  | "premise_writer"
  | "premise_judge"
  | "bible_writer"
  | "bible_judge"
  | "scene_planner"
  | "scene_writer"
  | "scene_judge"
  | "v2_cultural_researcher"
  | "v2_summarizer"
```

**Model config tiers:**
- **DEFAULT:** Sonnet 4.6 (writer/judge), Haiku (summarizer)
- **FAST:** Gemini Flash (budget)
- **EROTICA:** Grok 4 (uncensored)
- **EROTICA_FAST:** Grok 4.1 Fast NR (budget + uncensored)
- **EROTICA_HYBRID:** Grok 4 plan + Grok Fast scenes
- **HAIKU:** Cheapest (Haiku for all)

**Env var override:** `V2_MODE=erotica` forces entire pipeline to erotica config

### **8.2 Narrative Forcing Functions** (`shared/narrativeForcingFunctions.ts`)

**Empirically-grown mode-specific constraints** (capped at 7 per stage to prevent prompt bloat).

**Examples:**
- **Erotica:** "Sexual content MUST be driven by personal desire, not systemic justification"
- **Erotica:** "Every character MUST have ≥1 non-sexual goal that drives plot"
- **Default:** "Protagonist's importance from choices, not chosen-one status"
- **All modes:** "Antagonist reveals worldview through action, not monologue"

**Injected at:** premise stage + bible stage (separately)

### **8.3 Sensory Palette** (`shared/sensoryPalette.ts`)

**Purpose:** Track sensory vocabulary diversity; flag overuse for postproduction rewrite.

**Tracker:**
```typescript
interface DescriptorFrequency {
  counts: Map<string, {count, scenes[]}>,  // per sensory word
  sceneCount: number,
}
```

**Curated sensory word set:**
```
textures: callused, rough, silky, coarse, velvety, ...
temperatures: warm, cold, feverish, icy, ...
sounds: whispered, growled, hissed, purred, ...
movement: arched, trembled, writhed, ...
light: glistened, flickered, luminous, ...
etc.
```

**Detection:** only count if >50% of scenes use the word (meaningful after 4+ scenes)

**Output:** list of overused words for targeted rewrite (deferred to postproduction in v2)

### **8.4 Fingerprint** (`shared/fingerprint.ts`)

**Purpose:** Extract lightweight story signature for freshness injection and trend analysis.

**Extraction (no LLM):**
```typescript
interface StoryFingerprint {
  id: string,
  date: string,
  seed_summary: string,              // first 120 chars
  setting_type: string,
  character_names: string[],
  character_archetypes: string[],
  character_wants: string[],
  location_names: string[],
  plot_shape: string,
  themes: string[],
  motifs: string[],
  scene_count: number,
  pacing_types: string[],
  total_lines: number,
}
```

**Freshness injection:**
```typescript
buildFreshnessBlock(fingerprints): string
// "Avoid these first names (overused): Ravi (3x), Maya (2x)"
// "Avoid locations: Tokyo (2x), mansion (3x)"
// "Avoid archetypes: Mysterious Stranger (4x)"
```

**Persistence:** `data/story-fingerprints.json` (append-only, deduplicated by project ID)

### **8.5 Name Pool** (`shared/namePool.ts`)

**Purpose:** Resolve character name specs (placeholder + culture) to real names, culture-aware and gender-locked.

**Input:**
```typescript
{
  name_spec: {
    placeholder: "__CHAR_A__",
    culture: "Arabic, feminine",
  },
  ...
}
```

**Process:**
1. Load name pool (curated by culture, gender)
2. Detect gender lock from seed (e.g., "gay male only")
3. Exclude names from fingerprints (freshness)
4. Pick name matching culture + gender + tone
5. Replace placeholders in text fields
6. Check for collisions (substring containment)

**Output:** resolved names + provenance (pool source, culture, confidence)

### **8.6 API Types** (`shared/types/apiV2.ts`)

**Request/response types for all 6 steps:**
```typescript
CreateProjectRequest  → CreateProjectResponse
IntakeRequest         → IntakeResponse
ReviewPremiseRequest  → ReviewPremiseResponse
ReviewScenesRequest   → ReviewScenesResponse
// ... etc.

SSEEvent union type for streaming
```

### **8.7 Project State Types** (`shared/types/project.ts`)

**Discriminated union on `step` field:**
```typescript
type ProjectState =
  | Step1_IdeaGathering
  | Step2_PremiseGenerating
  | Step3_PremiseReview
  | Step4_BibleGenerating
  | Step5_SceneReview
  | Step6_SceneGenerating
  | StepCompleted
  | StepFailed
  | StepAborted
```

**Branded types:**
```typescript
type ProjectId = Brand<string, "ProjectId">
type OperationId = Brand<string, "OperationId">
```

**Base fields (all steps):**
```typescript
interface ProjectBase {
  projectId: ProjectId,
  createdAt: string,
  updatedAt: string,
  traces: StepTrace[],         // LLM call log
  psychologyLedger: UserPsychologyLedger,
  constraintLedger: ConstraintLedgerEntry[],
  culturalInsights: CreativeInsight[],
  mode?: GenerationMode,       // "default" | "fast" | "erotica" | ...
}
```

### **8.8 Artifact Types** (`shared/types/artifacts.ts`)

```typescript
interface PremiseArtifact {
  state: ArtifactState,
  operationId: OperationId,
  hook_sentence: string,
  emotional_promise: string,
  premise_paragraph: string,
  synopsis: string,
  tone_chips: string[],
  bans: string[],
  setting_anchor: string,
  time_period: string,
  characters_sketch: CharacterSketch[],
  core_conflict: string,
  suggested_length: "short" | "medium" | "long",
  suggested_cast: "duo" | "triangle" | "small_ensemble" | "large_ensemble",
}

interface StoryBibleArtifact {
  state: ArtifactState,
  operationId: OperationId,
  world: {scope, arena, rules, factions, consequence_patterns, canon_facts, world_thesis},
  characters: Record<string, CharacterProfile>,
  relationships: CharacterRelationship[],
  ensemble_dynamic: string,
  plot: {core_conflict, tension_chain, turning_points, theme_cluster, ...},
  sensory_palette?: SensoryPalette,
}

interface GeneratedScene {
  scene_id: string,
  state: ArtifactState,
  operationId: OperationId,
  plan: ScenePlan,
  vn_scene: VNScene,
  readable: ReadableScene,
  judge_result?: {pass, issues, vitality},
}
```

---

## **PART 9: POSTPRODUCTION PIPELINE**

**Files:** `postproduction/*.ts`

**Purpose:** 4-pass automated editorial pipeline to fix structural issues, continuity errors, and voice drift; package for VNBuilder.

### **9.1 Pass 1: Structural Scan** (`pass1-structural.ts`)

**Zero LLM calls.** Deterministic checks:
- Truncation detection (mid-word cutoffs, unclosed quotes)
- Speaker/location validation
- Line length for VN text boxes (max 200 chars)
- Consecutive narration/internal monologue blocks
- Duplicate lines
- Empty/near-empty scenes
- Normalization collision detection

**Output:**
```typescript
{
  report: {
    stats: {error_count, warning_count},
    issues: [{
      category: "missing_data" | "reference_mismatch" | "vn_compatibility",
      severity: "error" | "warning",
      scene_id: string,
      line_id?: string,
      message: string,
      auto_fixable: boolean,
    }],
  },
  scenes: IdentifiedScene[]  // with stable line IDs assigned
}
```

### **9.2 Pass 2: Continuity Read** (`pass2-continuity.ts`)

**Dual-model parallel** (Sonnet + GPT for higher recall).

**LLM call:** editorial system prompt → screenplay + character brief + seed
**Temp:** 0.3 (analytical)
**Max tokens:** 16000

**Evaluates 3 dimensions:**
1. **Seed compliance:** does story match premise + constraints?
2. **Continuity errors:** character memory, location consistency, timeline
3. **Voice drift:** character speech patterns consistent?

**Output:**
```typescript
{
  fixable_findings: [{
    scene_id: string,
    line_id: string,
    category: "seed_compliance" | "continuity_error" | "voice_drift",
    severity: "high" | "medium" | "low",
    description: string,
    fix_suggestion: string,
  }],
  report_only: [{...}],        // non-fixable observations
  continuity_ledger: {          // state machine for tracking
    characters: {name: {last_seen_scene, current_goal, emotional_state}},
    locations: {location: {established_in, last_mentioned}},
    timeline: {beat_id: {when, duration}},
  },
}
```

**Merge logic (if dual-model):**
- Both models flagged = high confidence → auto-fix
- Single model major → auto-fix if confident
- Single model minor → report-only
- Ledger comes from primary (Sonnet)

### **9.3 Pass 3: Targeted Fixes** (`pass3-fixes.ts`)

**Per-scene LLM call** (diff-based).

**For each flagged scene:**
1. LLM returns edits as `[{line_id, action, new_text}]`
2. TypeScript applies diffs deterministically
3. Rejects if unflagged lines were altered
4. Retries once (strict mode), then tags unfixed

**Output:**
```typescript
{
  scenes: IdentifiedScene[],    // updated with fixes applied
  results: [{
    scene_id: string,
    status: "fixed" | "unfixed" | "unchanged",
    diffs_applied: number,
    diffs_rejected: number,
    issues_addressed: string[],
  }],
}
```

### **9.4 Pass 3b: Erotica Cleanup** (`pass3b-erotica-cleanup.ts`)

**Only for erotica modes.** Detects and fixes erotica-specific quality issues:
1. Thesis-statement dialogue ("Bond musk eternal")
2. Sound-effect-only dialogue ("Mmph—")
3. Repeated dom commands ("Kneel" 5+ times)
4. Interrupt scene endings (external interruption vs character decision)
5. Vocabulary overuse (sensory words in 3+ scenes)
6. Name leaks (premise names in scene text)

Uses same diff-based editing protocol as Pass 3. Grok-powered for erotica modes.

### **9.5 Pass 4: Verification** (`pass4-verify.ts`)

Two phases:
- **Pass 4 (anti-slop):** Zero LLM. Re-runs anti-slop scanner on fixed scenes.
- **Pass 5 (continuity verify):** Haiku/Grok call per fixed scene. Checks that edits didn't introduce NEW contradictions (ignores pre-existing issues).

### **9.6 Emotion Mapping** (`emotion-mapper.ts`)

**LLM call:** maps freeform emotions ("warm", "complicated", "controlled fraying") to 8 VNBuilder expressions.

```typescript
type VNExpression = "neutral" | "angry" | "sad" | "tense" | "warm" | "amused" | "calm" | "formal"
```

**Strategy:**
1. Direct mapping (lookup table)
2. First-word fuzzy match
3. Substring pattern match
4. LLM mapping (expensive, cached)
5. Default to "neutral"

### **9.7 Packager** (`packager.ts`)

**Final transformation** to VNBuilder format.

**Inputs:** edited scenes + character brief + story bible + LLM emotion cache
**Outputs:** `VNPackage` (importable into VNBuilder) + `PackagerManifest` (metadata + warnings)

**Key transforms:**
- Extract only VN-relevant fields
- Normalize speaker names (resolve aliases)
- Map emotions to 8 expressions
- Validate all speakers/locations exist
- Tag unresolved references
- Generate stable scene IDs

**Manifest:**
```typescript
{
  package_version: string,
  package_status: "success" | "partial" | "failed",
  errors: [{type, severity, detail}],
  warnings: [{type, detail}],
  scene_count: number,
  line_count: number,
  character_count: number,
  unresolved_speakers: string[],
  unresolved_locations: string[],
}
```

---

## **PART 10: DATA STORAGE & PERSISTENCE**

### **10.1 Project Store** (`backend/storage/v2/projectStoreV2.ts`)

**JSON-based persistence** (production: upgrade to PostgreSQL or S3)

**Operations:**
```typescript
save(project: ProjectState): Promise<void>
get(projectId: ProjectId): Promise<ProjectState | null>
list(): Promise<ProjectId[]>
delete(projectId: ProjectId): Promise<void>
transition(projectId, nextState): Promise<void>  // atomic state change
```

**File location:** `./data/v2/{projectId}.json`

### **10.2 Directory Structure**

```
data/
├── projects/              # v2 project state files
│   ├── v2_uuid1.json
│   ├── v2_uuid2.json
│   └── ...
├── story-fingerprints.json
├── exports/               # legacy v1 scene exports
├── pipeline-output/       # full project dumps
├── postproduction/        # editor snapshots, packaged VNs
└── scenes/
    └── exports/           # individual scene JSONs
```

### **10.3 Startup Recovery**

On boot, `backend/index.ts` scans all projects:
- If `step === "premise_generating" | "bible_generating" | "scene_generating"`, mark as `failed`
- Preserve `recoverySnapshot` for manual intervention
- Set `error: "Server restarted during generation. Retry to continue."`

---

## **PART 11: CONFIGURATION & ENVIRONMENT**

### **11.1 Environment Variables**

```bash
# Required
ANTHROPIC_API_KEY=sk-ant-...

# Optional: multi-provider support
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=AIza...
GROK_API_KEY=xai-...

# Optional: freshness data retrieval
TAVILY_API_KEY=tvly-...

# Optional: model overrides
V2_MODE=default|fast|erotica|erotica-fast|erotica-hybrid|haiku
V2_MODEL_OVERRIDE=claude-opus-4-6     # forces all v2 roles to this model

# Postproduction (optional)
EDITOR_MODEL=claude-sonnet-4-6
EDITOR_SECONDARY_MODEL=gpt-5.4
EDITOR_DUAL_MODEL=true|false

# Server
PORT=3001 (default)
NODE_ENV=production|development
CORS_ORIGINS=http://localhost:3000,http://localhost:3001
```

### **11.2 Postproduction Config** (`postproduction/config.ts`)

```typescript
interface PostproductionConfig {
  mode: "default" | "fast" | "erotica" | ...,
  llm: {
    provider: "anthropic" | "openai",
    baseUrl: string,
    apiKey: string,
    editorialModel: string,
    dualModel: boolean,
    secondary?: {
      provider: string,
      baseUrl: string,
      apiKey: string,
      model: string,
    },
  },
}
```

---

## **PART 12: LLM CALL MATRIX**

### **12.1 Call Counts (per story)**

| Step | Role | Calls | Temp | Tokens | Notes |
|------|------|-------|------|--------|-------|
| 1 | intake | 1–2 | 0.7 | 2000 | max 2 turns |
| 2 | premise_writer | 1–2 | 0.8 | 3000 | +1 repair if judge fails |
| 2 | premise_judge | 1 | 0.3 | 800 | skipped in fast mode |
| 3 | premise_writer | 0–3 | 0.7 | 3000 | per revision round |
| 4 | bible_writer | 3–5 | 0.8 | 4k–8k | world, chars, plot, +retries |
| 4 | bible_judge | 1–3 | 0.3 | 2000 | up to 2 retries |
| 4 | scene_planner | 1 | 0.8 | 2000 | implicit (usually baked into plot) |
| 6 | scene_writer | N | 0.75 | 4000 | per scene (6–12 calls) |
| 6 | scene_judge | 0–N | 0.3 | 2000 | skipped in fast mode |
| 6 | v2_summarizer | 0–N | 0.7 | 1500 | per scene (tension update), skipped in parallel mode |

**Total: ~18–25 calls per story** (varies by mode, user revisions, judge retries)

### **12.2 Cost Example (Default Mode: Sonnet + Haiku)**

**Sonnet 4.6 (per 1K tokens):**
- Input: $3.00
- Output: $15.00
- Cache read: $0.375
- Cache write: $0.50

**Haiku (per 1K tokens):**
- Input: $0.08
- Output: $0.40

**Typical story:**
- Intake, premise, bible, scenes (writers/judges): ~45K input, ~80K output (Sonnet)
- Tension updates (Haiku): ~5K input, ~2K output
- **Estimated cost: $1.30–$2.00**

**Fast mode (Gemini Flash): $0.15–$0.30**

---

## **PART 13: FRONTEND API CLIENT**

**File:** `frontend/lib/v2Api.ts`

```typescript
export const v2Api = {
  createProject: (req: CreateProjectRequest) => Promise<{projectId}>
  getProject: (id: string) => Promise<{project: ProjectState}>
  deleteProject: (id: string) => Promise<{deleted}>
  retry: (id: string) => Promise<{restored}>
  abort: (id: string) => Promise<{aborted}>
  
  runIntake: (id, userInput, assumptionResponses) => Promise<IntakeResponse>
  
  generatePremise: (id) => Promise<{operationId}>          // 202 Accepted
  getPremise: (id) => Promise<GetPremiseResponse>
  reviewPremise: (id, {action, changes, inlineEdits}) => Promise<ReviewPremiseResponse>
  
  generateBible: (id) => Promise<{operationId}>            // 202 Accepted
  getBible: (id) => Promise<GetBibleResponse>
  
  reviewScenes: (id, {action, changes, feedback}) => Promise<ReviewScenesResponse>
  
  generateScenes: (id) => Promise<{operationId}>           // 202 Accepted
  getScenes: (id) => Promise<GetScenesResponse>
  
  exportProject: (id) => Promise<ProjectState>
  getTraces: (id) => Promise<{traces}>
}
```

**SSE Hook:** `useSSE(projectId)`
```typescript
const {lastEvent, connected} = useSSE(projectId)
// lastEvent: {type, data}
// type: "progress" | "scene_complete" | "step_complete" | "error" | "aborted"
```

---

## **PART 14: KEY DESIGN PRINCIPLES**

### **14.1 Modularity**

- **Role-based:** each LLM role (writer, judge, etc.) is independent
- **Service-based:** IntakeService, PremiseService, BibleService, SceneGenerationService are isolated
- **Checkpointing:** mid-batch resumption enables incremental work

### **14.2 Constraint Satisfaction**

- **Must-honor block:** injected at prompt end (highest attention zone)
- **Forcing functions:** mode-specific positive constraints
- **Freshness injection:** names/archetypes avoided if used in prior stories
- **Name pool:** culture-aware, gender-locked resolution

### **14.3 Quality Assurance**

- **Judge gates:** premise, bible, scenes validated separately
- **Tension tracking:** cumulative emotional state prevents tone drift
- **Anti-slop scanning:** deterministic detection of LLM patterns (postproduction)
- **Dual-model continuity:** Sonnet + GPT for higher recall

### **14.4 Performance**

- **Parallel scene generation:** configurable batchSize for speed (trade tension tracking for throughput)
- **Caching:** Anthropic API cache for static context
- **Compression:** context compressor fits story bible into token budget
- **Mode selection:** fast modes (Gemini Flash, Grok 4.1 Fast) for budget-conscious users

### **14.5 User Agency**

- **2 review gates:** premise and scene plan (user can revise)
- **Automation:** auto-approve button for hands-off generation
- **Export:** download full JSON at any point for external tools
- **Retry:** recover from failures without restarting

---

## **PART 15: ERROR HANDLING & RECOVERY**

### **15.1 Failure Modes**

| Failure | Recovery |
|---------|----------|
| LLM call timeout | Retry up to 3x with exponential backoff |
| LLM output parse error | Accept as-is or repair JSON |
| Judge rejects output | Regenerate with feedback (up to 2x) |
| Mid-batch generator crash | Resume from last checkpoint on retry |
| Client disconnect | Abort signal stops LLM polling |

### **15.2 Recovery Flow**

1. **Transient failure** → automatic retry (up to 3x)
2. **Persistent failure** → mark project as `failed`, save recovery snapshot
3. **User retries** → call `/retry` endpoint → restore from snapshot → resume at failed step
4. **Manual abort** → mark `aborted`, clean up emitter

---

## **PART 16: INTEGRATION POINTS**

### **16.1 Backend ↔ Frontend**

- **REST:** CRUD + action endpoints
- **SSE:** progress streaming (real-time UI updates)
- **Storage:** localStorage for project ID persistence

### **16.2 Pipeline ↔ Postproduction**

- **Export format:** project JSON includes all artifacts (premise, bible, scenes)
- **Input:** postproduction/run.ts accepts same JSON
- **Output:** packaged VN (VNBuilder-compatible format)

### **16.3 v2 ↔ v1 (Legacy)**

- **Separate:** v2 has own routes, services, storage (no coupling)
- **Compatibility:** v1 remains fully functional for existing projects
- **Model config:** both use same provider + model detection logic

---

## **PART 17: OBSERVED PERFORMANCE METRICS**

*(Based on test runs and empirical data)*

| Metric | Value | Notes |
|--------|-------|-------|
| **Throughput** | 1 story / 10–30 min | Depends on scene count + judge retries |
| **Cost (default mode)** | $1.30–$2.00 | Sonnet + Haiku, no retry |
| **Cost (fast mode)** | $0.15–$0.30 | Gemini Flash |
| **Cost (erotica mode)** | $1.50–$3.00 | Grok-4 (premium pricing) |
| **LLM call count** | 18–25 | Excludes postproduction |
| **Premise revisions** | 0–3 | User-driven; hard cap at 3 |
| **Scene count** | 6–12 | Derived from plot, user-editable |
| **Output size** | 4KB–15KB JSON | Larger with more scenes |
| **Postproduction time** | 2–5 min | 4 passes + packaging |
| **Manual edit acceptance** | 75–90% | Scenes mostly correct out-of-box |

---

## **PART 18: NOTABLE IMPLEMENTATION DETAILS**

### **18.1 Character Name Resolution**

- LLM outputs placeholders (`__CHAR_A__`, `__CHAR_B__`) to avoid premature name commitment
- System resolves names post-generation using:
  - Curated name pool (cultures, genders)
  - Story fingerprints (names to avoid)
  - Gender lock detection (erotica modes)
- Syncs resolved names back to premise text (prevents placeholder leakage)
- Detects collisions (name containment check)

### **18.2 Scene Planning Strategy**

- Scene plan **NOT generated as separate step**; derived from plot beats
- Scene plan structure → writer prompt → vn_scene output
- User can edit scene plan post-generation (remove, modify, reorder)
- Scene count & estimated word count computed from plan

### **18.3 Tension State Machine**

- Accumulates across scenes (not reset per scene)
- Tracks:
  - Relationship dynamics (how pairs evolve)
  - Unresolved threads (plot hooks)
  - Emotional temperature (escalation curve)
  - Register history (vocabulary used)
  - Reader knowledge (information asymmetry)
- Updated via cheap Haiku call after each scene (not expensive writer)

### **18.4 Judge Retry Logic**

- Premise judge: 0 retries (accept or repair)
- Bible judge: up to 2 retries (plot regeneration)
- Scene judge: 0 retries (accept, but vitality reroll if <3/5)

### **18.5 Vitality Scoring**

- Scenes with <3/5 vitality flags get a second candidate roll
- Vitality flags:
  1. Has character failure/intention mismatch
  2. Non-optimal response (tension)
  3. Behavioral turn (character growth)
  4. Asymmetry (unequal stakes)
  5. Discovery (new info)
- If score improves, keep new; otherwise keep original

### **18.6 Postproduction Diff-Based Fixes**

- LLM returns `[{line_id, action, new_text}]` (NOT full scene rewrite)
- TypeScript applies diffs, validates only flagged lines changed
- Rejects entire scene if collateral edits detected
- Retries once (strict mode), then tags unfixed for manual review

---

## **CONCLUSION**

The visnovgen v2 pipeline is a **production-ready story generation system** that balances:
- **Quality** (multi-gate judging, tension tracking, postproduction 4-pass)
- **Flexibility** (6 generation modes, multi-provider LLM support, granular user review)
- **Cost-efficiency** (role-specific models, API caching, configurable parallelism)
- **Resilience** (checkpointing, recovery snapshots, graceful degradation)

The architecture reflects lessons from v1 (reduced complexity: 38 → 9 roles) while introducing sophisticated constraint satisfaction, user psychology tracking, and deterministic quality assurance. The system is well-positioned for scaling, extending with new postproduction passes, and integrating with external VN tools (VNBuilder, etc.).