# Character Module (Module 2) — Implementation Plan

## Overview

Self-contained module that reads the Hook Module export and guides the user through defining their cast — protagonist, antagonist, supporting characters, and their relationships — through one continuous adaptive conversation.

Same adaptive framework as the hook module: clarifier with assumptions + constraint ledger, builder, judge, polish, lock. No fixed turn order, no checklist, no survey.

---

## Design Decisions

### Core Philosophy
- **Fully adaptive**: engine reads the user and does whatever creates the most engaging creative moment NOW
- **One continuous conversation about the cast**: not rigid per-character passes. Engine flows between characters when that's where the creative energy is
- **Character relationships are part of this module**: not a separate stage
- **Visuals are a separate future module**: this module locks psychology, personality, relationships, backstory, behavioral signatures — NOT appearance or names
- **ChatGPT's character tables are internal knowledge**: the engine knows about all the dials but surfaces them organically, never as a checklist

### What the engine knows internally (never shown as a list)

**Core dials** (drive the conversation):
- Want + Why Now
- Misbelief / Inner Lie
- Stakes + Break Point
- Key relationship dynamics

**Secondary dials** (surface as assumptions when the user would enjoy shaping them):
- Leverage, Secret + Trigger, Sacrifice Threshold + Temptation, Stress Decision Style
- Optimization Function, Backstory, Competence + Vulnerability, Tell, Voice Pattern

**Antagonist-specific**: Moral Logic, Strategy Under Constraint, Targeted Attack
**Supporting-specific**: Role Function (Mirror/Temptation/Blocker/Knife), Misread

### Multi-Character Flow
- Engine tracks `activeFocus` (which character/relationship is being shaped this turn)
- Shifts focus dynamically: when user mentions another character, when a relationship assumption needs input, when cast count is incomplete, when creative energy suggests a shift
- Constraint ledger entries are scoped per character: `protagonist.want`, `antagonist.moral_logic`, `supporting_1.role_function`
- Relationship entries are separate: `relationship.protagonist_antagonist`, etc.

### First Turn
- Engine loads HookPack, infers characters from the premise
- Opens with what it already sees: "Based on your hook, here's who I think your protagonist is — and the kind of antagonist this story needs"
- Immediately surfaces assumptions derived from the premise
- User's first interaction is shaping what's inferred, not starting from scratch

### Builder (Single Pass, No Tournament)
- By the time the clarifier is done, characters are shaped enough that 3 variants would be too similar
- One builder call generates the full cast
- Judge evaluates the ensemble (not individual characters)
- If judge fails, regenerate with fix instruction baked in

### Output
- User-facing: 1-2 paragraphs per character (vivid, specific, mystery-protecting)
- Backend: all dials as structured metadata, relationship tensions, ensemble dynamic
- Polish step rewrites descriptions, strips slop, ensures each character reads as unique

### Lock
- Lock the entire cast at once (characters are defined by relationships, locking one without the others doesn't make sense)
- User can edit individual character descriptions before locking
- On lock: auto-export comprehensive JSON for next module

---

## New Files

### 1. `shared/types/character.ts` — Type definitions

```
CharacterStateUpdate — per-character accumulated state (want, misbelief, stakes, etc.)
CharacterAssumption — extends assumption pattern with characterRole field
CharacterClarifierResponse — hypothesis_line, question, options, character_focus, characters_surfaced, relationship_updates, readiness, assumptions
CharacterBuilderOutput — characters map, ensemble_dynamic, relationship_tensions, structural_diversity, collision_sources
CharacterJudgeOutput — pass, hard_fail_reasons, scores (depth, relationships, diversity, mechanism, specificity), weakest character, fix instruction
CharacterPack — locked characters with profiles + descriptions, ensemble, relationships, constraint ledger, user style, hookpack reference
CharacterSessionState — projectId, hookProjectId, sourceHook, characters map, turns, constraintLedger, status, activeFocus, consecutiveHighReadiness
CharacterTurn — turnNumber, clarifierResponse, userSelection, assumptionResponses
```

### 2. `backend/services/characterPrompts.ts` — All LLM prompts

**CHARACTER_CLARIFIER_SYSTEM** (~2000 words):
- Mission: adaptive creative partner for cast creation, fun and addictive
- Internal character craft knowledge (all dials, when to surface each)
- Adaptive engine: read the user, shift focus between characters, infer vs ask
- Relationship mechanics as first-class (not separate from characters)
- Assumption surfacing: per-character AND per-relationship
- Quality gate: all key roles defined? relationships clear? structural diversity? depth?
- Output format: hypothesis_line (cast dynamic), character_focus, characters_surfaced, relationship_updates, readiness
- Same "protect the mystery" awareness: don't resolve character arcs, backstory revelations, or relationship endings
- NEVER use character names — roles only

**CHARACTER_CLARIFIER_USER_TEMPLATE**:
- {{HOOK_CONTEXT}} — premise, hook sentence, emotional promise, core engine
- {{PRIOR_TURNS}} — conversation history
- {{CONSTRAINT_LEDGER}} — confirmed vs inferred per-character and relationship entries
- {{CAST_STATE_JSON}} — accumulated state per character
- {{BAN_LIST}}, {{TURN_NUMBER}}

**CHARACTER_BUILDER_SYSTEM** (~1200 words):
- Build full ensemble, not individuals
- Collision method adapted for characters (extract psychological mechanisms from sources)
- Structural diversity enforcement (at least 2 characters differ on 2+ axes)
- User authorship rule (characters come from clarifier conversation)
- Per-character: all dials filled + 1-2 paragraph description
- Ensemble: overall dynamic + relationship tensions

**CHARACTER_BUILDER_USER_TEMPLATE**
**CHARACTER_JUDGE_SYSTEM** (~600 words)
**CHARACTER_JUDGE_USER_TEMPLATE**
**CHARACTER_POLISH_SYSTEM** (~600 words)
**CHARACTER_POLISH_USER_TEMPLATE**
**CHARACTER_SUMMARY_SYSTEM** + **CHARACTER_SUMMARY_USER_TEMPLATE**

### 3. `backend/services/characterSchemas.ts` — JSON schemas for structured output

- CHARACTER_CLARIFIER_SCHEMA
- CHARACTER_BUILDER_SCHEMA
- CHARACTER_JUDGE_SCHEMA

### 4. `backend/services/characterService.ts` — Core service (~1000 lines)

Class: `CharacterService(store, llm)`

Public methods:
- `runClarifierTurn(projectId, hookProjectId?, userSelection?, assumptionResponses?, modelOverride?, promptOverrides?)` → ClarifyResponse
- `runBuilder(projectId, modelOverride?, promptOverrides?)` → GenerateResponse
- `lockCharacters(projectId, edits?, modelOverride?)` → CharacterPack
- `getSession(projectId)` → CharacterSessionState | null
- `resetSession(projectId)` → void
- `previewPrompt(projectId, stage, ...)` → PromptPreview

Internal:
- `loadSourceHook(hookProjectId)` — reads hook export, caches on session
- `buildClarifierPrompt(session)`, `buildBuilderPrompt(session)`, etc.
- `polishCharacters(builderOutput, session)` — polish step per character
- `processAssumptionResponses(session, responses, turnNumber)` — same deterministic pattern
- `processStateUpdateIntoLedger(session, updates, turnNumber)` — per-character scoping
- `formatCastForPrompt(session)` — multi-character state summary for LLM
- `formatRelationshipsForPrompt(session)` — relationship state for LLM
- Readiness convergence safety net (same pattern: 2+ turns at ≥75%)

### 5. `backend/routes/character.ts` — Express routes

- POST `/api/character/clarify`
- POST `/api/character/preview-prompt`
- POST `/api/character/generate` (builder + judge, no tournament)
- POST `/api/character/lock`
- GET `/api/character/:projectId`
- GET `/api/character/export-session/:projectId`
- DELETE `/api/character/:projectId`

### 6. `frontend/components/CharacterWorkshop.tsx` — UI component

Phases: `"hook_load" | "clarifying" | "generating" | "revealed" | "locked"`

- **hook_load**: user provides hookProjectId (or auto-detected from localStorage), engine loads and starts
- **clarifying**: same pattern as HookWorkshop — hypothesis banner, question, chips, free text, assumption cards. But with: character focus indicator, per-character assumption grouping, relationship assumptions distinct from character assumptions
- **generating**: loading state (single pass, faster than tournament)
- **revealed**: character cards (1-2 paragraphs each), ensemble summary, judge verdict, edit option
- **locked**: export button, "continue to visuals" (future)

### 7. `frontend/lib/characterApi.ts` — API client

Same pattern as hookApi.

---

## Files to Extend (minimal changes)

### `shared/modelConfig.ts`
- Add character roles to HookRole union: `"char_clarifier" | "char_builder" | "char_judge" | "char_polish" | "char_summary"`
- Add corresponding fields to ModelConfig and DEFAULT_MODEL_CONFIG

### `backend/services/runtime.ts`
- Import CharacterService
- Add: `export const characterService = new CharacterService(projectStore, llmClient);`

### `backend/index.ts`
- Import characterRoutes
- Add: `app.use("/api/character", characterRoutes);`

### `backend/storage/projectStore.ts`
- Make ModuleExport generic enough for both modules (module: "hook" | "character")
- Add character session save/get (may need a separate type or union)

### `frontend/main.tsx` + `frontend/index.html`
- Add simple module navigation (Hook Workshop / Character Workshop tabs or similar)
- Title update

### `shared/types/api.ts`
- Add character API response types

---

## Implementation Sequence

1. Types & schemas (`shared/types/character.ts`, `characterSchemas.ts`)
2. Model config extension (`shared/modelConfig.ts`)
3. Prompts (`characterPrompts.ts`) — the most important creative work
4. Service (`characterService.ts`) — core logic
5. Routes (`character.ts`)
6. Runtime + index wiring
7. Frontend API client (`characterApi.ts`)
8. Frontend component (`CharacterWorkshop.tsx`)
9. Navigation / app shell updates
10. Storage extensions if needed
11. Testing + iteration on prompts
12. Update DESIGN_LOG.md

---

## What We're NOT Doing
- Not modifying any hook module files (prompts, service, routes, frontend)
- Not adding character names or visual appearance (that's the visuals module)
- Not building a tournament (single builder pass + judge)
- Not creating separate stages for relationships (part of this module)
- Not creating a rigid per-character pipeline (one adaptive conversation)
