# Implementation Plan — March 2026

> This file exists so that if a session crashes, a new session can read this and pick up where we left off.

---

## Context

After a full playthrough of Hook → Character → Character Image modules, the following issues were identified. The previous session crashed while we were beginning to address them. The analysis below is from that session's review of the exported data.

### Key Files for Reference
- `data/exports/char-4d82c629-5e8e-4ad9-b2a3-88713c13ecc7.json` — Character module export (curated handoff)
- Session file uploaded by user — Full session data with psychology ledger, all turns, constraint ledger
- `DESIGN_LOG.md` — Prior design decisions
- `CHARACTER_MODULE_PLAN.md` — Character module architecture
- `KNOWN_ISSUES.md` — Previously fixed issues

### Core Philosophy Reminder
The experience should be addictive, fun, entertaining, lose-sleep-over, want-to-come-back. It helps uncover the user's creativity and imagination — the story vision they otherwise wouldn't be able to articulate. The psychology module is a unique value add: it builds a cumulative model of who you are as a creative person and carries that across modules. It should make the experience feel increasingly like working with someone who actually knows you. The LLM is adaptive — we give it rich, accurate data and let it make creative decisions, not hardcode behavioral rules.

---

## Phase 1 — Foundations (psychology + data pipeline)

### 1.1 Fix heuristics bug
**Files:** `backend/services/psychologyEngine.ts`, `backend/services/characterService.ts`, `backend/services/hookService.ts`
**Problem:** `updatePsychologyHeuristics` produces zeros: `totalInteractions: 0, changeRate: 0, deferralRate: 0` despite real interaction (6+ freeform entries, multiple alternatives chosen, zero ignored assumptions in the actual session data).
**Action:** Trace the data flow from turn data → stats computation → `updateHeuristics()`. The method is being called but receiving wrong stats. Likely the stats are computed from the wrong array or before turn data is attached.

### 1.2 Fix confidence promotion
**Files:** `backend/services/psychologyEngine.ts`, `backend/services/psychologyPromptFragments.ts`
**Problem:** After 13+ turns of consistent evidence across both modules, most hypotheses are still at "medium." The turn-based caps (turn 1 = low only, turns 2-3 = medium max) are appropriate for early turns but the LLM is being too conservative even after turn 4+ where "high" is allowed.
**Action:** Adjust prompt instructions to encourage promotion to "high" when evidence is consistent from 3+ turns and multiple choice types. The engine-side cap is just a safety net — the prompt is the real lever.

### 1.3 Fix persistence tracking
**Files:** `backend/services/psychologyEngine.ts`
**Problem:** `checkPersistence()` marks almost everything as `still_relevant: false`. The keep-vs-change ratio is too blunt — it compares raw counts per turn. A user who changes *different* assumptions each turn is engaged and opinionated, not contradicting prior changes.
**Action:** Track whether the *same category/dimension* is being re-changed, not just raw change counts. A user who changed "tone" last turn and "character_role" this turn hasn't invalidated the tone change.

### 1.4 Fix character export to include psychology ledger
**Files:** `backend/storage/characterStore.ts`, `shared/types/character.ts`
**Problem:** `CharacterModuleExport` doesn't include `psychologyLedger`. The HookPack carries it (hook → character works), but character → character_image breaks the chain.
**Action:** Add `psychologyLedger` to the export type and include it in `saveExport()`. The image module should import it and continue accumulating.

### 1.5 Audit data truncation in character image prompts
**Files:** `backend/services/characterImageService.ts`, `backend/services/characterImagePrompts.ts`
**Problem:** Character genders were wrong in the image module. We worked on shortening what was passed in each phase (storage/prompt boundary). The prompt may be truncating character data and losing gender/role details.
**Action:** Audit `buildClarifierPrompt` in characterImageService. Ensure full character identity (gender, role, key traits, relationship dynamics) always survives compression. The storage/prompt boundary should compress *conversation history*, not character identity.

---

## Phase 2 — Character Image Module Fixes

### 2.1 Add freeform input to image assumption cards
**Files:** `frontend/components/CharacterImageWorkshop.tsx`, `backend/routes/characterImage.ts`
**Problem:** Assumption cards offer choices but NOT freeform text input. This breaks the core pattern where users can always type their own idea.
**Action:** Add freeform text input to assumption response cards, same as hook and character modules.

### 2.2 Fix unagreed assumption generation
**Files:** `backend/services/characterImagePrompts.ts`
**Problem:** The clarifier invents visual specifics (e.g., "a jacket as his key clothing piece") and treats them as established without surfacing them as assumptions first. This violates a core rule.
**Action:** Strengthen the prompt instruction: "NEVER introduce specific visual elements (garments, accessories, distinguishing marks, color palettes) in the hypothesis_line without FIRST surfacing them as assumptions with alternatives." Mirror the existing rule from hookPrompts.ts about mechanisms/props.

### 2.3 Fix gender/data issues
**Files:** `backend/services/characterImageService.ts`, `backend/services/characterImagePrompts.ts`
**Problem:** Character genders wrong. Likely caused by the data truncation issue (1.5), but also check that the prompt template explicitly includes gender and key identity markers from CharacterPack.
**Action:** Ensure the user template passes character gender, role, and core identity in a non-truncatable section. Add explicit "CHARACTER IDENTITIES (do not contradict)" block.

### 2.4 Tune convergence
**Files:** `backend/services/characterImagePrompts.ts`, `backend/services/characterImageService.ts`
**Problem:** Too many rounds. The image module should converge faster — most creative decisions are already made by this stage.
**Action:** Lower the readiness threshold. Import more from character data as pre-confirmed (don't re-ask things already decided). Reduce the minimum turns before convergence. The image clarifier should focus on *visual choices only*, not re-exploring character psychology.

### 2.5 Fix tone/appropriateness
**Files:** `backend/services/characterImagePrompts.ts`
**Problem:** Generated weird/inappropriate questions (e.g., asking about survivor character undressing).
**Action:** Add explicit guardrails: "Visual description means clothed appearance, pose, expression, and visual signature — NOT undressing, nudity implications, or intimate physical scenarios unless the user has explicitly directed the story there."

---

## Phase 3 — Cross-Module Improvements

### 3.1 Actionable conflict flags
**Files:** `frontend/components/HookWorkshop.tsx`, `frontend/components/CharacterWorkshop.tsx`, `frontend/components/CharacterImageWorkshop.tsx`
**Problem:** Yellow conflict flag boxes display warnings but don't let the user act on them. No inline inputs or choices.
**Action:** When a conflict_flag is present, render it with 2-3 resolution options (derived from the flag text) plus a freeform input. User's choice gets sent back as part of the next turn's context.

### 3.2 Weakness carry-forward
**Files:** `backend/services/characterService.ts`, `backend/services/characterImageService.ts`, shared types
**Problem:** Judge identifies weak characters/elements but they're just noted. Weak elements pass through silently at lock.
**Action:** Add a `weaknesses` field to the judge output and the module export. Downstream modules read these and treat them as development opportunities. E.g., the image module sees "survivor is least developed" and proactively asks richer visual questions about that character. Later modules can also surface weaknesses at their lock stage for the user to address.

### 3.3 Multi-select assumptions
**Files:** All Workshop components, all service clarify methods, shared types
**Problem:** User can only respond to assumptions one at a time. Merging ideas from multiple assumptions could create interesting combinations.
**Action:** Allow selecting from multiple assumption alternatives simultaneously. Backend processes them as a batch. Consider a "merge" mode where the user picks 2+ alternatives and the next turn's hypothesis incorporates the combination.

### 3.4 Psychology visibility overlay
**Files:** All Workshop components
**Problem:** Can't see how the psychology module is working during testing.
**Action:** Add a dev/testing toggle that highlights: (a) which assumptions are psychology-diagnostic, (b) what the engine learned from each choice, (c) current hypothesis store with confidence levels, (d) heuristics values. Collapsible panel, not always visible.

---

## Phase 4 — Image Module Features

### 4.1 Art style suggestion
**Files:** `backend/services/characterImageService.ts`, `backend/services/characterImagePrompts.ts`, `frontend/components/CharacterImageWorkshop.tsx`
**Action:** Before image generation, engine proposes 2-3 art styles based on tone chips, source DNA, aesthetic preferences from psychology ledger. User picks or adjusts. This becomes a dedicated step between clarifier and builder.

### 4.2 Pre-generation visual editing
**Files:** `frontend/components/CharacterImageWorkshop.tsx`, `backend/services/characterImageService.ts`
**Action:** After clarifier converges, before builder runs, show per-character visual summary: hair, eyes, build, signature garment, color palette, etc. User can tweak each element. Nothing visual gets committed without user approval. This prevents the "jacket problem."

### 4.3 Batch image regeneration
**Files:** `frontend/components/CharacterImageWorkshop.tsx`, `backend/routes/characterImage.ts`
**Action:** Allow selecting multiple characters and rerolling them together. Currently one-by-one. UI: checkboxes on character image cards + "Regenerate Selected" button.

### 4.4 Model switching for image generation
**Files:** `frontend/components/CharacterImageWorkshop.tsx`, `backend/services/animeGenClient.ts`, `backend/routes/characterImage.ts`
**Action:** Add model/checkpoint dropdown for the anime-gen API, same pattern as the LLM model switcher. Allow switching between available checkpoints/LoRAs.

---

## Implementation Order
1. Phase 1 (all items) — foundations must be solid first
2. Phase 2 (all items) — fix the broken patterns
3. Phase 3 (all items) — cross-module improvements
4. Phase 4 (all items) — new features

## What NOT to do
- Do NOT modify hook module prompts or service code while fixing other modules
- Do NOT hardcode behavioral rules based on psychology data — the LLM should adapt naturally from richer data
- Do NOT truncate character identity data in any prompt boundary — compress conversation history instead
