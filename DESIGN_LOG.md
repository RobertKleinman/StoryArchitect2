# Story Architect — Design Log

> This file exists so that if a session crashes or context is lost, a new session can read this and get caught up on design decisions, what was changed, and why.

---

## Project Overview

**Story Architect** is a visual novel creation pipeline built as a series of self-contained modules. Each module is an adaptive, LLM-driven creative experience designed to be fun, addictive, and imagination-sparking.

### Module 1: Hook Module (current)
- **Flow**: Seed → HookClarifier (adaptive conversation) → HookBuilder (tournament: 3 candidates) → HookJudge (scores each) → winner revealed → user can edit/reroll → Lock → HookPack export
- **Stack**: Express backend + Vite/React frontend + TypeScript. Anthropic Claude API via @anthropic-ai/sdk.
- **Key design principle**: The clarifier is ADAPTIVE, not sequential. No fixed turn plan. It reads the user's energy, infers what it can, surfaces assumptions for things the user would want control over, and converges when the hook is strong. The experience should feel like a creative jam session, not a form.
- **Data**: Sessions stored as JSON files in `data/` keyed by UUID. Constraint ledger tracks confirmed vs inferred creative decisions. Prompt history tracks all LLM calls for analysis.

### Module 2: Character Generator (planned, not started)
- Self-contained module that reads the HookPack export from Module 1
- Will have its own clarifier, builder, judge cycle
- Some underlying mechanics shared but independent prompts/schemas
- DO NOT change Module 1 prompts/mechanics when building this

---

## Design Decisions Log

### 2026-03-01: Session 2 — Finishing Hook Module

**Context**: Previous session crashed. User renamed/moved the project folder (no code impact — all paths are relative). User had been working with ChatGPT in parallel and identified several issues.

**Issues identified and decisions made:**

#### 1. Clarifier hypothesis reveals too much
- **Problem**: As the hypothesis_line evolves toward high readiness, it starts resolving the twist, explaining betrayals, unpacking theme, and over-explaining worldbuilding. This means the user sees too much before the premise is even generated.
- **Root cause**: The hypothesis_line guidance tells it to become "a confident, exciting premise" at late stage, with no guidance on what to protect.
- **Decision**: Add light, adaptive awareness to the clarifier prompt — NOT hard rules. Frame it as creative instinct: "a great hypothesis makes the reader desperate to know more." Protect: the full twist, midpoint reversal, ending emotional resolution, thematic thesis, worldbuilding beyond what pressures the emotional engine. Signal depth, don't resolve it.
- **Important**: The user was happy with how the clarifier works overall — the fun, the creativity sparking, the richness of the hypothesis. DO NOT make it less vivid or less engaging. Just make it aware of what to hold back.

#### 2. Premise over-explains + AI slop
- **Problem**: Generated premises give too much away and sometimes contain AI-typical phrasing.
- **Decision**: Add a NEW post-processing LLM step ("premise polish") after the tournament winner is selected, before the premise is shown to the user. One call that:
  - Rewrites premise to signal mystery without resolving it
  - Strips AI slop (clichéd phrasing, generic descriptors)
  - Targets ~200 words
  - Preserves the emotional engine, hook, and user's creative choices
- **Why not adversarial**: Single polish call is cheaper and sufficient. Can add adversarial critic later if needed.
- **Why not change builder prompt**: User explicitly wants to leave existing prompts alone to avoid regression.

#### 3. Readiness meter stalls at ~80%
- **Problem**: readiness_pct gets to ~80% and stops advancing. The LLM keeps finding things to refine instead of converging.
- **Decision**: Code-level convergence fix. If readiness_pct >= 75 for 2+ consecutive turns, backend auto-forces ready_for_hook = true. The prompt already tells the LLM not to stall — this is a safety net.
- **Implementation**: Track consecutive high-readiness turns on the session state. Check after each clarifier turn.

#### 4. Auto-save/export on lock (module handoff)
- **Problem**: When session locks, the HookPack is saved to the session JSON but there's no standalone export file for the next module to consume. User also wants manual export option.
- **Decision**: On lock, auto-save a comprehensive JSON file to `data/exports/{projectId}.json` containing:
  - Full HookPack
  - Full constraint ledger
  - Conversation turns (for context)
  - Prompt history
  - Session metadata
- **Also**: Add "Export session" button in UI that downloads this same format at any point (not just locked state).

#### 5. Character Generator Module (future)
- Self-contained module, separate service/routes/prompts/frontend component
- Reads the export file from Hook Module
- Shared: types, LLM client, project store pattern
- Independent: own clarifier system, schemas, adaptive engine
- DO NOT modify Hook Module when building this

---

## File Structure Notes

- `backend/services/hookPrompts.ts` — All LLM prompts (clarifier, builder, judge, summary)
- `backend/services/hookService.ts` — Core service: clarifier turns, tournament, lock
- `backend/services/hookSchemas.ts` — JSON schemas for structured LLM output
- `backend/services/llmClient.ts` — Anthropic SDK wrapper
- `backend/storage/projectStore.ts` — File-based JSON session storage
- `frontend/components/HookWorkshop.tsx` — Main UI component (single-page, all phases)
- `shared/types/hook.ts` — All TypeScript types
- `data/` — Session JSON files (UUID-keyed)
- `data/exports/` — Module handoff export files (created on lock)
