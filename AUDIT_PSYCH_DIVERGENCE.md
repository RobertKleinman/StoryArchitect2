# Psychology Module & Divergence Explorer — Wiring Audit Document

> **Purpose**: Verify that the psychology module and divergence explorer are correctly connected across all 4 services and doing what they claim. Feed this to ChatGPT for independent audit.

---

## Architecture Overview

This is a visual novel creation pipeline with 4 active modules, each with its own service:
- **Hook** (`hookService.ts`) — story premise/hook
- **Character** (`characterService.ts`) — character profiles
- **CharacterImage** (`characterImageService.ts`) — visual descriptions
- **World** (`worldService.ts`) — world-building

Each module has a **Clarifier → Builder → Judge → Polish** pipeline. The Clarifier runs multi-turn conversations with the user. After each clarifier turn, two background LLM calls fire in parallel:

1. **Psychology Consolidation** — merges/deduplicates behavior signals
2. **Divergence Explorer** — generates 15-20 story futures, clusters into direction families

Both are **fire-and-forget**: if they finish before the user's next submission, the next clarifier gets their output. If not, no harm.

---

## SYSTEM 1: Psychology Module

### Data Flow

```
User action → Clarifier LLM (produces user_read with signals)
  → recordSignals() writes to psychologyLedger.signalStore
  → updateHeuristics() computes typeRatio, avgResponseLength, etc.
  → Session saved
  → fireBackgroundConsolidation() kicks off async
     → reads fresh session
     → runConsolidation() calls LLM with current signalStore
     → re-reads FRESH session (race safety)
     → grafts consolidated ledger onto fresh session
     → saves
  → Next clarifier turn reads:
     - formatPsychologyLedgerForPrompt() → top signals + heuristics
     - formatEngineDialsForPrompt() → adaptive dials
     - formatSuggestedProbeForPrompt() → optional probe from consolidation
     - formatSignalsForBuilderJudge() → signals for builder/judge
```

### Type Definitions (`shared/types/userPsychology.ts`)

```typescript
interface UserPsychologyLedger {
  reads: UserPsychologyRead[];           // Per-turn LLM reads
  heuristics: UserInteractionHeuristics; // Computed from behavior
  signalStore: BehaviorSignal[];         // Accumulated signals
  assumptionDeltas: AssumptionDelta[];   // Offered vs responded tracking
  lastConsolidation?: ConsolidationSnapshot; // Background consolidation result
  lastDirectionMap?: DirectionMapSnapshot;   // Background divergence result
  hypothesisStore?: BehaviorSignal[];    // @deprecated alias
}
```

### Wiring per Service — Consolidation

| Service | Store used | Fire condition | Module tag |
|---------|-----------|----------------|------------|
| hookService | `this.store` (ProjectStore) | `signalStore.length > 0` | `"hook"` |
| characterService | `this.charStore` | `signalStore.length > 0` | `"character"` |
| characterImageService | `this.imageStore` | `signalStore.length > 0` | `"character_image"` |
| worldService | `this.worldStore` | `signalStore.length > 0` | `"world"` |

All 4 use the **re-read-and-graft** pattern:
1. Read session for consolidation input
2. Run `runConsolidation()` (LLM call)
3. Re-read FRESH session (avoids overwriting main-path changes)
4. Graft consolidated `psychologyLedger` onto fresh session
5. Save

### Consolidation Injection into Clarifier

All 4 services call these in `buildClarifierPrompt()`:
- `formatPsychologyLedgerForPrompt(session.psychologyLedger)` → `{{PSYCHOLOGY_LEDGER}}`
- `formatEngineDialsForPrompt(session.psychologyLedger)` → `{{ENGINE_DIALS}}`
- `formatSuggestedProbeForPrompt(session.psychologyLedger)` → appended to user prompt
- `markProbeConsumed(session.psychologyLedger)` → called after saving turn

### Consolidation Injection into Builder/Judge

All 4 services call:
- `formatSignalsForBuilderJudge(session.psychologyLedger)` → `{{PSYCHOLOGY_SIGNALS}}`

---

## SYSTEM 2: Divergence Explorer

### Data Flow

```
After clarifier turn (turn >= 2) →
  fireBackgroundDivergence() kicks off async
    → extractDivergenceContext() builds context from session
    → runDivergenceExploration() calls LLM with:
       - seed input (varies by module)
       - confirmed constraints
       - current state
       - inferred assumptions
       - psychology summary
       - turn number + module tag
    → LLM returns DirectionMap (4-6 families, 15-20 futures, blind spot)
    → re-reads FRESH session (race safety)
    → grafts snapshot onto psychologyLedger.lastDirectionMap
    → saves
  → Next clarifier turn reads:
     - formatDirectionMapForPrompt(session.psychologyLedger)
     - Appended to end of user prompt
```

### Type Definitions (`shared/types/userPsychology.ts`)

```typescript
interface StoryFuture {
  label: string;
  sketch: string;
  emotionalPayoff: string;
  conflictPattern: "internal" | "external" | "relational" | "institutional" | "cosmic";
  powerDynamic: "dominance" | "equality" | "vulnerability" | "reversal" | "escalation";
  hook: string;
}

interface DirectionFamily {
  name: string;        // 3-5 word label
  signature: string;   // shared emotional/structural DNA
  futures: StoryFuture[];
  novelty: number;     // 0-1, higher = more divergent from current exploration
}

interface DirectionMap {
  families: DirectionFamily[];
  blindSpot: string;
  convergenceNote: string;
}

interface DirectionMapSnapshot {
  timestamp: string;
  afterTurn: number;
  module: "hook" | "character" | "character_image" | "world";
  directionMap: DirectionMap;
}
```

### Files

- **`backend/services/divergenceExplorer.ts`** — Core service:
  - `runDivergenceExploration(context, llm)` → `DirectionMapSnapshot | null`
  - `formatDirectionMapForPrompt(ledger)` → string (for clarifier injection)
  - `extractDivergenceContext(...)` → `DivergenceContext`

- **`backend/services/divergencePrompts.ts`** — LLM prompts:
  - `DIVERGENCE_EXPLORER_SYSTEM` — system prompt
  - `DIVERGENCE_EXPLORER_USER_TEMPLATE` — user prompt with placeholders
  - `DIVERGENCE_EXPLORER_SCHEMA` — JSON schema for structured output

### Wiring per Service — Divergence

| Service | Fire condition | Seed input used | Store for re-read |
|---------|---------------|-----------------|-------------------|
| hookService | `turnNumber >= 2` | `session.seedInput` | `this.store` |
| characterService | `turnNumber >= 2` | `session.hookPack?.state_summary ?? ""` | `this.charStore` |
| characterImageService | `turnNumber >= 2` | character descriptions joined | `this.imageStore` |
| worldService | `turnNumber >= 2` | `session.sourceHook?.state_summary ?? ""` | `this.worldStore` |

All 4 use the **re-read-and-graft** pattern (same as consolidation).

### Direction Map Injection into Clarifier

| Service | How it's injected |
|---------|------------------|
| hookService | `const directionMapText = formatDirectionMapForPrompt(session.psychologyLedger);` then appended: `+ (directionMapText ? "\n\n" + directionMapText : "")` |
| characterService | Same call, then: `const finalUser = directionMapText ? user + "\n\n" + directionMapText : user;` |
| characterImageService | Same pattern as characterService |
| worldService | Same call, appended inline: `+ (directionMapText ? "\n\n" + directionMapText : "")` |

### Direction Map Format (what the clarifier sees)

```
═══ DIRECTION MAP (unexplored possibility space — use as inspiration) ═══
Generated after turn 3. These are directions the story COULD go that you haven't explored yet.

▸ Slow Burn Betrayal ★ UNEXPLORED
  Trust is weaponized over time — intimacy enables the deepest wounds
  → "The Confidant's Ledger": A trusted advisor secretly records every vulnerability...
  → "Inherited Debt": A character inherits a relationship that was built on lies...

▸ Cosmic Indifference ~ partially explored
  The universe doesn't care, and that's the horror
  → "Signal Decay": ...

BLIND SPOT: No futures explore what happens if the protagonist simply walks away.
CONVERGENCE: Current conversation is funneling toward romantic tension + institutional conflict.

You are NOT required to use any of these directions. They exist to remind you
that the possibility space is VAST...
```

---

## Model Config (`shared/modelConfig.ts`)

Both roles are registered:

```typescript
export type HookRole = "clarifier" | "builder" | ...
  | "psych_consolidator"
  | "divergence_explorer";

export interface ModelConfig {
  // ... all other roles ...
  psych_consolidator: string;
  divergence_explorer: string;
}

export const CREATIVE_ROLES = [
  // ... all creative roles ...
  "psych_consolidator",
  "divergence_explorer",
];

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  // ... all roles default to "claude-sonnet-4-6" ...
  psych_consolidator: "claude-sonnet-4-6",
  divergence_explorer: "claude-sonnet-4-6",
};
```

The `divergence_explorer` role is also in `MODEL_CONFIG_KEYS` in `backend/routes/models.ts` so the PUT `/api/models` endpoint accepts it.

---

## Psychology Prompt Fragments (`backend/services/psychologyPromptFragments.ts`)

These are shared prompt fragments injected into all 4 modules' clarifier/builder/judge system prompts:

- `SHARED_USER_READ_INSTRUCTIONS` — tells clarifier how to produce user_read
- `SHARED_PSYCHOLOGY_ASSUMPTIONS` — assumption surface rules
- `OBVIOUS_PATTERN_DETECTION` — detect obvious patterns
- `DIAGNOSTIC_OPTIONS_GUIDANCE` — option diagnostic quality
- `ASSUMPTION_PERSISTENCE_CHECK` — track if prior changes persisted
- `ADAPTATION_PLAN_INSTRUCTIONS` — structured adaptation plan
- `BUILDER_SIGNAL_INSTRUCTIONS` — signals for builder
- `JUDGE_SIGNAL_INSTRUCTIONS` — signals for judge
- `QUESTION_VALUE_CHECK` — Value of Information check
- `PREMORTEM_CHECK` — imagine failure before committing
- `JUDGE_PREMORTEM` — judge version of premortem
- `DIVERGENCE_SELF_CHECK` — lightweight self-check (independent of full divergence explorer)

The `DIVERGENCE_SELF_CHECK` is a **prompt-level** check that asks the clarifier to self-audit whether its options lead to genuinely different stories. This works **independently of and complementary to** the full divergence explorer module.

---

## Specific Audit Questions

Please verify:

1. **Race condition safety**: Both `fireBackgroundConsolidation` and `fireBackgroundDivergence` re-read the session before saving. But they both write to `session.psychologyLedger`. If both finish around the same time, could one overwrite the other's result?
   - Consolidation writes: `freshSession.psychologyLedger = sessionForConsolidation.psychologyLedger`
   - Divergence writes: `freshSession.psychologyLedger.lastDirectionMap = snapshot`
   - **Potential issue**: Consolidation replaces the ENTIRE ledger, which could overwrite a just-saved `lastDirectionMap` from divergence (or vice versa).

2. **Store consistency**: Each service uses the correct store for re-reads:
   - hookService → `this.store` (ProjectStore)
   - characterService → `this.charStore` (CharacterStore)
   - characterImageService → `this.imageStore` (CharacterImageStore)
   - worldService → `this.worldStore` (WorldStore)

3. **Seed input correctness**: Each module extracts the right "seed" for divergence:
   - Hook: raw `session.seedInput` ✓
   - Character: `session.hookPack?.state_summary` (hook's summary)
   - CharacterImage: character descriptions joined with `; `
   - World: `session.sourceHook?.state_summary`

4. **Direction map injection**: All 4 services correctly call `formatDirectionMapForPrompt()` and append to user prompt.

5. **Psychology signals flow through correctly**:
   - Clarifier produces `user_read` with `signals` + `behaviorSummary` + `adaptationPlan`
   - `recordSignals()` processes into `signalStore`
   - `updateHeuristics()` computes derived metrics
   - Consolidation merges/deduplicates via LLM
   - Next clarifier gets formatted output via prompt helpers

6. **Probe lifecycle**:
   - Consolidation may produce `suggestedProbe`
   - Stored in `lastConsolidation.result.suggestedProbe`
   - `formatSuggestedProbeForPrompt()` formats it for next clarifier
   - `markProbeConsumed()` called after turn save (sets `probeConsumed: true`)

7. **Schema correctness**: The `DIVERGENCE_EXPLORER_SCHEMA` matches the `DirectionMap` TypeScript type.

8. **LLM call configuration**: Divergence explorer uses `temperature: 1.0` (max creativity) and `maxTokens: 4000`.
