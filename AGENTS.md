# Codex Agent Instructions

## Project: Story Architect

A visual novel creation pipeline with 3 modules (Hook, Character, Character Image), each using an adaptive LLM-powered clarifier → builder → judge → polish → lock flow.

## Your Task: READ-ONLY AUDIT

**DO NOT modify any files. DO NOT create branches. DO NOT write code. Only produce a report.**

### Setup

```bash
npm install
npx tsc --noEmit
```

### What to Audit

Read every `.ts` and `.tsx` file in `backend/`, `frontend/`, `shared/`, and `types/`. Produce a single audit report covering:

#### 1. BUGS (Critical)
- Runtime errors, null/undefined without guards, type mismatches
- JSON schema definitions vs TypeScript interface mismatches
- API endpoints referencing wrong methods or parameter shapes
- LLM response parsing edge cases (truncated JSON, missing fields)
- Session state corruption, race conditions, missing saves
- Frontend state out of sync with backend
- Uncaught promise rejections, missing try/catch

#### 2. LOGIC ERRORS (High)
- Clarifier stuck loops, premature or never-arriving readiness
- Psychology engine: hypotheses not updating, confidence drift
- Constraint ledger: confirmed items re-asked, inferred treated as confirmed
- Module handoff data lost (HookPack → Character → CharacterImage)
- Judge pass/fail too lenient or strict
- Token limits too low for complex responses
- Feature flag logic errors

#### 3. SCHEMA / PROMPT / TYPE ALIGNMENT
- `psychology_strategy` field must be in all 3 clarifier schemas (properties + required), all 3 system prompts (as a step + output format field #0), and all 3 TypeScript interfaces
- Schema fields referenced in prompts but missing from schemas (or vice versa)
- Placeholder variables `{{VAR}}` that might not get replaced
- Prompt fragments imported but never interpolated

#### 4. DEAD CODE
- Functions/methods defined but never called
- Interfaces defined but never used
- Unused imports
- Unmounted routes

#### 5. ARCHITECTURAL CONCERNS
- Unbounded arrays/objects that grow without limit
- Missing input validation on API endpoints
- File I/O that fails silently
- Memory leaks in session state
- Prompt size approaching context window limits

#### 6. FRONTEND
- State bugs (stale closures, missing deps)
- API calls without error handling
- Unreachable UI states
- Note: custom React stubs (only useState, useMemo) — no useEffect, useCallback

#### 7. SECURITY
- API key exposure, path traversal, unsanitized input in prompts

### Key Files

**Shared types** (read first): `shared/types/hook.ts`, `shared/types/character.ts`, `shared/types/characterImage.ts`, `shared/types/userPsychology.ts`, `shared/types/api.ts`

**Type stubs**: `types/stubs.d.ts` — custom stubs for fs, path, React, Express (instead of @types)

**Backend entry**: `backend/index.ts`

**Services** (most complex):
- `backend/services/hookService.ts` (~1100 lines)
- `backend/services/characterService.ts` (~1100 lines)
- `backend/services/characterImageService.ts` (~1100 lines)
- `backend/services/llmClient.ts`
- `backend/services/psychologyEngine.ts`

**Prompt templates**: `backend/services/hookPrompts.ts`, `backend/services/characterPrompts.ts`, `backend/services/characterImagePrompts.ts`

**Schemas**: `backend/services/hookSchemas.ts`, `backend/services/characterSchemas.ts`, `backend/services/characterImageSchemas.ts`

**Frontend components**: `frontend/components/HookWorkshop.tsx`, `frontend/components/CharacterWorkshop.tsx`, `frontend/components/CharacterImageWorkshop.tsx`, `frontend/components/PsychologyOverlay.tsx`

**Frontend API**: `frontend/lib/hookApi.ts`, `frontend/lib/characterApi.ts`, `frontend/lib/characterImageApi.ts`

### Output Format

Create your report as a comment or response with these sections:

```
# Audit Report — Story Architect

## Summary
(1 paragraph: overall health, critical count, severity breakdown)

## Critical Bugs
(numbered, with file, lines, description, impact, suggested fix)

## High Priority
(same format)

## Medium Priority
(same format)

## Low Priority / Improvements
(same format)

## Dead Code
(list)

## Architecture Notes
(structural concerns)

## Prompt Engineering Notes
(prompt/schema/LLM interaction issues)
```
