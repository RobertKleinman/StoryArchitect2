# Story Architect 2 — Full Codebase Audit

## Project Overview

**Story Architect** is a modular visual novel creation pipeline. Each module uses a Clarifier → Builder → Judge → Polish pipeline powered by Anthropic's Claude API with structured JSON output.

**Module flow**: Hook → Character → CharacterImage → World → WorldImage → Theme → Plot

**Stack**: Express 5.1 backend, React 19 + Vite 7 frontend, vanilla CSS (monolithic `frontend/styles.css`), TypeScript throughout, `@anthropic-ai/sdk` for LLM calls.

**Core vision**: A super fun, addictive app that adapts to user psychology, draws out creativity from people with limited writing ability, and produces a constraint system (not a predetermined script) that a downstream scene generator can use to create varied, non-deterministic visual novel content.

**Key architectural principle — "Direction, not Destiny"**: Upstream module data represents creative direction the user wants to explore, NOT predetermined scenes. The World module builds a STAGE (constraint system), not a SCRIPT (story bible). The Plot module (not yet built) will decide what actually happens.

---

## What To Audit

### 1. Architecture & Consistency

- Do all module pipelines (Hook, Character, CharacterImage, World) follow the same service/route/schema/prompt/component pattern consistently?
- Are there architectural inconsistencies between modules?
- Is the shared type system (`shared/types/`) coherent — do all modules use it correctly?
- Are there dead imports, unused types, orphaned code, or vestiges from earlier iterations?
- Is the Express routing clean? Are all routes properly error-handled?
- Is the storage layer (`backend/storage/`) consistent across modules?

### 2. TypeScript Quality

- How much `any` casting is happening? Where can it be eliminated?
- Are there type mismatches between schemas (JSON), TypeScript interfaces, and actual runtime data?
- Would `tsc --noEmit` pass cleanly? If not, what breaks?
- Are there places where the frontend assumes data exists that the backend might not provide?

### 3. World Module — Constraint System vs Story Bible

**This is the most critical audit area.**

The World Builder should produce a CONSTRAINT SYSTEM (game board), not a STORY BIBLE (predetermined narrative). Check:

- Does `backend/services/worldPrompts.ts` (WORLD_BUILDER_SYSTEM) enforce the constraint-system boundary clearly enough?
- Does the judge prompt (`WORLD_JUDGE_SYSTEM`) actually catch story-bible outputs?
- Are the GOOD/BAD examples in the builder prompt clear and comprehensive enough?
- Does the clarifier prompt avoid asking plot questions?
- Is there prompt language that inadvertently encourages narrative output?

**Schema alignment** (`backend/services/worldSchemas.ts` ↔ `shared/types/world.ts` ↔ `frontend/components/WorldWorkshop.tsx`):
- Are all three files in sync after recent trimming of fields?
- Are there optional fields in the types that the frontend accesses without null checks?
- Does `additionalProperties: false` appear on EVERY object type in ALL schemas (Anthropic API requirement)?

**Service issues** (`backend/services/worldService.ts`):
- `parseAndValidate` on ~line 497 lists `information_access` and `volatility` as required fields, but these are NOT in the schema's `required` array. If the LLM omits them, parseAndValidate returns null and the service throws. These should be removed from the validation check or the schema should require them.
- Are the defensive defaults (lines ~502-512) comprehensive enough?
- Does `formatCharacterProfilesForBuilder()` strip the right fields? Should it strip more/less?
- Does `formatPriorTurnsCompact()` lose any information the builder actually needs?

### 4. Psychology System (v4 BehaviorSignals)

- Is the psychology ledger (`shared/types/userPsychology.ts`) used consistently across all modules?
- Do all clarifiers produce `user_read` in the correct v4 format?
- Do builders and judges receive psychology signals via `formatSignalsForBuilderJudge()`?
- Is the signal accumulation system (`backend/services/psychologyService.ts`) working correctly — are signals persisted across turns and modules?
- Are there modules where psychology is wired in the prompt but not actually populated in the service?

### 5. Frontend Robustness

- Scan ALL workshop components (`HookWorkshop.tsx`, `CharacterWorkshop.tsx`, `CharacterImageWorkshop.tsx`, `WorldWorkshop.tsx`) for potential white-screen crashes from undefined data
- Are there `.length` or `.map()` calls on potentially undefined arrays?
- Is error handling consistent — do all API calls have try/catch with user-visible error messages?
- Is localStorage usage consistent across modules for session persistence?
- Are there race conditions in the async state updates?

### 6. LLM Integration

- `backend/services/llmClient.ts` — Is the Anthropic SDK used correctly?
- Are structured output schemas passed correctly via `jsonSchema` parameter?
- Is error handling for LLM failures comprehensive? What happens on timeout, rate limit, malformed response?
- Are there any prompt injection risks in the user-provided content (world seed, free text answers)?
- Are token limits (`maxTokens`) appropriate for each call?

### 7. Security & Data

- Is `.env` in `.gitignore`? Are there any hardcoded API keys?
- Is user data (session JSON) stored securely?
- Are there any CORS issues in the Express configuration?
- Can malicious user input cause issues (XSS in rendered content, SQL injection in storage, etc.)?

### 8. CSS & Styling

- `frontend/styles.css` is a monolithic file. How large is it? Are there unused rules?
- Are there CSS class naming collisions between modules?
- Is the responsive design consistent?

### 9. Performance

- Are there unnecessary re-renders in React components?
- Is the state management approach (useState with large objects) causing performance issues?
- Are LLM calls parallelized where possible (e.g., builder + judge)?
- Are there memory leaks from un-cleaned event listeners or intervals?

---

## File Structure Reference

```
backend/
  index.ts                    — Express server setup
  routes/
    hook.ts                   — Hook module routes
    character.ts              — Character module routes
    characterImage.ts         — Character Image module routes
    world.ts                  — World module routes
  services/
    llmClient.ts              — Anthropic SDK wrapper
    hookService.ts            — Hook pipeline logic
    hookPrompts.ts            — Hook prompts
    hookSchemas.ts            — Hook JSON schemas
    characterService.ts       — Character pipeline logic
    characterPrompts.ts       — Character prompts
    characterSchemas.ts       — Character JSON schemas
    characterImageService.ts  — CharacterImage pipeline logic
    characterImagePrompts.ts  — CharacterImage prompts
    characterImageSchemas.ts  — CharacterImage JSON schemas
    worldService.ts           — World pipeline logic
    worldPrompts.ts           — World prompts (recently rewritten)
    worldSchemas.ts           — World JSON schemas (recently trimmed)
    psychologyService.ts      — Psychology ledger management
    psychologyPromptFragments.ts — Shared psychology prompt fragments
    generalPromptFragments.ts — Shared interaction style fragments
    runtime.ts                — Service initialization
  storage/
    *.ts                      — File-based JSON storage per module
  middleware/
    *.ts                      — Feature flag guards

shared/
  types/
    api.ts                    — API response types
    hook.ts                   — Hook types
    character.ts              — Character types
    characterImage.ts         — CharacterImage types
    world.ts                  — World types (recently modified — optional fields)
    userPsychology.ts         — Psychology system types

frontend/
  components/
    HookWorkshop.tsx          — Hook UI
    CharacterWorkshop.tsx     — Character UI
    CharacterImageWorkshop.tsx — CharacterImage UI
    WorldWorkshop.tsx         — World UI (recently fixed null safety)
    PsychologyOverlay.tsx     — Debug overlay for psychology
    ModelSelector.tsx         — LLM model selector
  lib/
    *Api.ts                   — API client functions per module
  styles.css                  — Monolithic CSS
  App.tsx                     — Router/app shell
  main.tsx                    — React entry point
```

---

## Known Issues To Verify

1. **parseAndValidate mismatch**: `worldService.ts` line ~497 lists `information_access` and `volatility` as required for validation, but they're optional in the schema. This could cause false parse failures.

2. **Schema compliance**: Every `type: "object"` in every schema file MUST have `additionalProperties: false`. Verify across ALL modules (hook, character, characterImage, world).

3. **Frontend null safety**: We recently fixed several white-screen crashes in WorldWorkshop from accessing `.length` or `.map()` on undefined arrays. Check ALL workshop components for similar issues.

4. **Psychology wiring**: Verify that psychology signals flow correctly: clarifier outputs → ledger accumulation → builder/judge receive formatted signals. Check all modules, not just world.

5. **Prompt-schema alignment**: After trimming the world builder schema, verify the prompt doesn't reference fields that no longer exist in the schema (e.g., `scene_types`, `character_associations`, `who_suspects`, `second_order`, `exploit_potential`).

6. **Story bible tendency**: The builder prompt was recently rewritten to enforce constraint-system output. Evaluate whether the prompt is strong enough or if the LLM will still drift toward narrative output given rich character psychology in the input.

---

## Deliverable

Produce a prioritized list of issues found, categorized by severity:
- **Critical**: Will cause crashes, data loss, or security issues
- **High**: Causes incorrect behavior or poor user experience
- **Medium**: Code quality, consistency, or maintainability issues
- **Low**: Style, naming, or minor optimization opportunities

For each issue, provide the file path, line number(s), description, and suggested fix.
