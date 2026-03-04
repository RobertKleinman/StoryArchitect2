# Story Architect — Full Codebase Audit

## Instructions

You are auditing "Story Architect," a visual novel creation pipeline. **DO NOT modify any files.** Your job is to produce a detailed audit report only.

Run `npx tsc --noEmit` first. Then systematically read and analyze every file listed below. Produce a single markdown report with your findings.

## Project Overview

A 3-module creative pipeline where users collaboratively build visual novels:
1. **Hook Module** — Clarifier → Builder → Judge → Polish → Lock → Export
2. **Character Module** — Same adaptive engine pattern
3. **Character Image Module** — Same pattern + anime image generation via external API

Each module has an adaptive clarifier (LLM-powered conversation), a builder (LLM generates output), a judge (LLM scores/passes/fails), optional polish, and lock/export phases.

Key systems:
- **Psychology Engine** — Cross-module user modeling with hypothesis store, confidence tracking, heuristics
- **Constraint Ledger** — Tracks confirmed vs inferred creative decisions
- **LLM Client** — Wraps Anthropic Claude API with JSON schema enforcement
- **Session Storage** — File-based JSON persistence in /data/

Tech: Express 5 backend, React 19 frontend, TypeScript strict mode, Vite, Anthropic SDK.

## Files to Audit (in order)

### Shared Types (read these first — they define all interfaces)
- `shared/types/hook.ts`
- `shared/types/character.ts`
- `shared/types/characterImage.ts`
- `shared/types/userPsychology.ts`
- `shared/types/api.ts`
- `shared/modelConfig.ts`
- `shared/featureFlags.ts`
- `types/stubs.d.ts` — Custom type stubs for fs, path, React, Express (instead of @types packages)

### Backend Core
- `backend/index.ts` — Express server entry point
- `backend/featureFlags.ts`
- `backend/middleware/featureFlagGuard.ts`
- `backend/middleware/characterFeatureFlagGuard.ts`

### Backend Services (most complex — audit carefully)
- `backend/services/llmClient.ts` — LLM abstraction wrapping Anthropic API
- `backend/services/runtime.ts`
- `backend/services/psychologyEngine.ts` — Cross-module user psychology tracking
- `backend/services/psychologyPromptFragments.ts` — Shared prompt fragments for psychology
- `backend/services/generalPromptFragments.ts` — Shared interaction style fragments
- `backend/services/sharedPromptFragments.ts`

### Hook Module
- `backend/services/hookSchemas.ts` — JSON schemas for structured LLM output
- `backend/services/hookPrompts.ts` — System/user prompt templates
- `backend/services/hookService.ts` — Core business logic (~1100+ lines)
- `backend/routes/hook.ts` — Express route handlers
- `backend/storage/projectStore.ts` — Session persistence

### Character Module
- `backend/services/characterSchemas.ts`
- `backend/services/characterPrompts.ts`
- `backend/services/characterService.ts` — Core business logic (~1100+ lines)
- `backend/routes/character.ts`
- `backend/storage/characterStore.ts`

### Character Image Module
- `backend/services/characterImageSchemas.ts`
- `backend/services/characterImageService.ts` — Core business logic (~1100+ lines)
- `backend/services/characterImagePrompts.ts`
- `backend/services/animeGenClient.ts` — External API for anime image generation
- `backend/routes/characterImage.ts`
- `backend/storage/characterImageStore.ts`

### Frontend
- `frontend/main.tsx`
- `frontend/index.html`
- `frontend/styles.css`
- `frontend/components/App.tsx`
- `frontend/components/HookWorkshop.tsx`
- `frontend/components/CharacterWorkshop.tsx`
- `frontend/components/CharacterImageWorkshop.tsx`
- `frontend/components/PsychologyOverlay.tsx`
- `frontend/components/PromptEditor.tsx`
- `frontend/lib/hookApi.ts`
- `frontend/lib/characterApi.ts`
- `frontend/lib/characterImageApi.ts`

### Config
- `package.json`
- `tsconfig.json`
- `vite.config.ts`

## What to Look For

### 1. BUGS (Critical)
- Runtime errors that would crash the server or break the UI
- Null/undefined access without guards
- Type mismatches between schemas, interfaces, and actual usage
- API endpoints that reference non-existent methods or wrong parameter shapes
- JSON schema definitions that don't match their TypeScript interfaces
- LLM response parsing that would fail on edge cases (truncated JSON, missing fields)
- Session state corruption (race conditions, missing saves, partial updates)
- Frontend state that gets out of sync with backend
- Error handling gaps (uncaught promise rejections, missing try/catch)

### 2. LOGIC ERRORS (High)
- Clarifier convergence issues (stuck loops, premature readiness, never-ready)
- Psychology engine: hypotheses not updating correctly, confidence scores drifting wrong
- Constraint ledger: confirmed items being re-asked, inferred items treated as confirmed
- Module handoff: data lost or malformed when passing HookPack → Character, CharacterPack → CharacterImage
- Judge pass/fail logic that's too lenient or too strict
- Token limits that are too low for complex responses (we already fixed one at 2000→3500)
- Readiness percentage calculation inconsistencies
- Feature flag logic errors

### 3. DEAD CODE & UNUSED EXPORTS
- Functions/methods defined but never called
- Interfaces defined but never used
- Imports that aren't used
- Routes that aren't mounted
- Schema fields that nothing reads

### 4. ARCHITECTURAL CONCERNS
- N+1 patterns in data access
- Unbounded arrays or objects that could grow without limit
- Missing input validation on API endpoints
- File I/O operations that could fail silently
- Synchronous operations that should be async
- Memory leaks (growing session state, un-cleaned resources)
- Prompt templates that could exceed context window limits

### 5. PROMPT ENGINEERING ISSUES
- Contradictory instructions in system prompts
- Schema fields referenced in prompts but missing from schemas (or vice versa)
- Prompt fragments that are imported but never interpolated
- `psychology_strategy` field: verify it's in all 3 schemas (properties + required), all 3 prompt templates (system + output format), and all 3 TypeScript interfaces
- Token budget concerns: are any prompts dangerously large?
- Placeholder variables ({{VAR}}) that might not get replaced

### 6. FRONTEND ISSUES
- State management bugs (stale closures, missing dependency arrays)
- API calls that don't handle errors
- UI states that can become unreachable
- Missing loading/error states
- Note: project uses custom React stubs (only useState, useMemo) — no useEffect, useCallback

### 7. SECURITY & ROBUSTNESS
- API key exposure risks
- Path traversal in file operations
- Missing CORS or auth considerations
- Unsanitized user input flowing into prompts

## Output Format

Produce a single markdown file with these sections:

```
# Audit Report — Story Architect

## Summary
(1 paragraph: overall health, critical issue count, severity breakdown)

## Critical Bugs (must fix before testing)
(numbered list, each with: file, line range, description, suggested fix)

## High Priority Issues
(numbered list, same format)

## Medium Priority Issues
(numbered list)

## Low Priority / Improvements
(numbered list)

## Dead Code
(list of unused functions, exports, imports)

## Architecture Notes
(any structural concerns or refactoring suggestions)

## Prompt Engineering Notes
(any issues with prompt templates, schemas, or LLM interaction)

## Files Reviewed
(checkbox list of every file you read)
```

For each issue, include:
- **File**: exact path
- **Lines**: approximate line range
- **Issue**: clear description of the problem
- **Impact**: what breaks or goes wrong
- **Suggested Fix**: brief description (remember, don't actually change anything)
