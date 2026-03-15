# Story Architect — Complete Implementation Specification

## INSTRUCTIONS FOR CLAUDE CODE

This document contains 23 issues to fix across 5 batches. Work through them in order. Each batch has dependencies on prior batches.

**CRITICAL: VERIFICATION REQUIREMENT**
Before implementing each issue, first READ the referenced files and VERIFY that the problem description is accurate. The analysis was done by a separate AI session — line numbers and code patterns may have shifted. If you find that an issue is already fixed or the code differs from what's described, NOTE IT and skip to the next issue. Do not blindly implement — confirm the problem exists first.

**GENERAL RULES:**
- Do NOT modify any files outside of `backend/` and `shared/` and `frontend/` directories
- Follow existing code patterns — look at how hookService, characterService, etc. already do things
- Maintain TypeScript type safety — no `any` types
- Run `npx tsc --noEmit` after each batch to verify compilation
- All prompt text changes go in the `*Prompts.ts` files, not inline in services
- All schema changes go in the `*Schemas.ts` files
- Test by running the dev server after each batch

---

## BATCH 1: Data Model & Type Safety
**Issues: 23 (gender field), 8 (character review), 15 (MUST HONOR constraints)**
**Goal:** Make physical identity fields first-class, add pre-builder review, and reinforce constraint carry-forward.

### Issue 23: Add Gender/Presentation as First-Class Field

**Problem:** Gender exists only in freeform `description` strings. The image module (`characterImageService.ts` `buildCharacterIdentities()` ~line 1167) tries to recover gender via ledger key search and pronoun detection — both fragile. The `image_generation_prompt` requires "1girl/1boy" as first tag and guesses wrong when gender is ambiguous.

**VERIFY:** Read `shared/types/character.ts` `CharacterProfile` interface (~line 104) — confirm there is NO `gender` field. Read `characterImageService.ts` `buildCharacterIdentities()` — confirm the pronoun fallback logic.

**Changes:**

**File: `shared/types/character.ts`**
Add to `CharacterProfile` interface (after `role` and `description` fields, ~line 106):
```typescript
  /** Character's visual presentation for image generation */
  presentation: "masculine" | "feminine" | "androgynous" | "unspecified";
  /** Approximate age range */
  age_range?: "child" | "teen" | "young_adult" | "adult" | "middle_aged" | "elderly";
  /** Ethnicity/race if relevant to the story */
  ethnicity?: string;
```

Add the same fields to `CharacterPack.locked.characters` (~line 199):
```typescript
      presentation: "masculine" | "feminine" | "androgynous" | "unspecified";
      age_range?: string;
      ethnicity?: string;
```

**File: `backend/services/characterPrompts.ts`**
In `CHARACTER_CLARIFIER_SYSTEM` prompt, in the QUALITY GATE section (~line 205), add to the checklist:
```
  ☐ Every character has a confirmed presentation (masculine/feminine/androgynous) — surface as assumption if not yet confirmed
```

In `CHARACTER_BUILDER_SYSTEM` prompt (~line 365), add to the "FOR EACH CHARACTER, PRODUCE" section:
```
- presentation: "masculine" | "feminine" | "androgynous" | "unspecified". MUST match what was confirmed in clarification. This drives image generation — getting it wrong produces wrong-sex character images.
- age_range: approximate age bracket. Infer from story context if not explicitly discussed.
- ethnicity: if relevant to the story or discussed during clarification. Empty string if unspecified.
```

**File: `backend/services/characterSchemas.ts`**
Add `presentation`, `age_range`, `ethnicity` to the character builder JSON schema as required/optional properties on each character object.

**File: `backend/services/characterImageService.ts`**
In `buildCharacterIdentities()` (~line 1167), BEFORE the ledger gender search, add:
```typescript
// Read discrete presentation field (most reliable source)
const presentation = char.presentation ?? (char as any).presentation;
if (presentation && presentation !== "unspecified") {
  identity.push(`Presentation: ${presentation}`);
}
```
Keep the existing ledger search + pronoun fallback as backup for older sessions without the field.

In `buildBuilderPrompt()`, the `image_generation_prompt` format instruction (~line 324 in characterImagePrompts.ts) currently says `"1girl/1boy, full body..."`. Update to:
```
"image_generation_prompt format: Start with the correct tag based on the CHARACTER IDENTITIES presentation field: masculine → '1boy', feminine → '1girl', androgynous → '1person, androgynous'. Then: full body, black background, [hair], [eyes], [outfit], [expression], [features]."
```

---

### Issue 8: Character Review Screen Before Builder

**Problem:** No opportunity to review/edit character details before the builder generates. Users can't directly set name, age, race, gender.

**VERIFY:** Check if there's already a review step between clarifier readiness and builder in `characterService.ts`. Look for any endpoint that returns resolved character state for editing.

**Changes:**

**File: `backend/services/characterService.ts`**
Add a new method `getCharacterReview(projectId: string)` that returns the resolved character state from the constraint ledger + inferred fields:
```typescript
async getCharacterReview(projectId: string): Promise<{
  characters: Array<{
    roleKey: string;
    role: string;
    presentation: string;
    age_range: string;
    ethnicity: string;
    description_summary: string;
    confirmed_traits: Record<string, string>; // from constraint ledger
    inferred_traits: Record<string, string>;  // from LLM inference
  }>;
  ready: boolean;
}> {
  // Read session, extract from constraint ledger and accumulated state
  // Group by character role, separate confirmed vs inferred
}
```

Add a new method `applyCharacterReviewEdits(projectId: string, edits: Array<{ roleKey: string; field: string; value: string }>)` that:
1. Updates the constraint ledger with the user's edits (source: "user_typed", confidence: "confirmed")
2. Stores the edits so the builder receives them

**File: Add route** in the appropriate router file (follow existing patterns for other endpoints):
- `GET /api/projects/:id/character/review` → calls `getCharacterReview`
- `POST /api/projects/:id/character/review` → calls `applyCharacterReviewEdits`

**File: `backend/services/characterPrompts.ts`**
In `CHARACTER_BUILDER_USER_PREFIX` (~line 447), add a new section:
```
═══ USER REVIEW EDITS (MANDATORY — override any conflicting inference) ═══
{{CHARACTER_REVIEW_EDITS}}
```
These are direct user edits from the review screen and MUST take priority over everything else.

**Frontend:** Add a `CharacterReview` component that displays between clarifier completion and builder execution. Show each character as a card with editable fields. System provides smart defaults. "Looks great, build!" button proceeds to builder.

---

### Issue 15: MUST HONOR Constraint Block

**Problem:** Confirmed constraints sometimes get ignored in later turns/modules because the ledger is buried in a long prompt.

**VERIFY:** Read the end of `buildClarifierPrompt()` and `buildBuilderPrompt()` in `hookService.ts`, `characterService.ts`, `worldService.ts`, `plotService.ts`, `sceneService.ts` — confirm there is NO compact constraint summary at the prompt end.

**Changes:**

**File: `backend/services/hookService.ts`** (and ALL other service files with the same pattern)
In EACH `buildClarifierPrompt()` method, AFTER all existing dynamic content is assembled but BEFORE the return statement, add:
```typescript
// ─── MUST HONOR constraint reinforcement (end of prompt = highest attention) ───
const mustHonor = this.buildMustHonorBlock(session.constraintLedger ?? []);
if (mustHonor) {
  dynamic += "\n\n" + mustHonor;
}
```

In EACH `buildBuilderPrompt()` method, same pattern — append mustHonor block at the end.

Add a shared helper (in each service, or extract to a shared utility):
```typescript
private buildMustHonorBlock(ledger: Array<{ key: string; value: string; confidence: string }>): string {
  const confirmed = ledger.filter(e => e.confidence === "confirmed");
  if (confirmed.length === 0) return "";
  const lines = confirmed.map(e => `${e.key.toUpperCase()}: ${e.value}`);
  return `═══ MUST HONOR — CONFIRMED FACTS (do NOT contradict) ═══\n${lines.join("\n")}`;
}
```

Apply this to ALL 6 service files: hookService, characterService, characterImageService, worldService, plotService, sceneService.

---

## BATCH 2: Prompt & LLM Behavior Fixes
**Issues: 5 (story length), 7 (cast size), 9 (bad direction warnings), 10 (cast count in hook), 16 (character similarity), 20 (assumption categories), 24 (scope advisor)**
**Goal:** All prompt-only changes. No new architecture.

### Issue 5: Dynamic Beat Count Based on Scope

**VERIFY:** Read `plotPrompts.ts` — confirm the "12-20 causally-linked beats" text (~line 99).

**File: `backend/services/plotPrompts.ts`**
Replace the hardcoded "12-20" beat count in `PLOT_BUILDER_SYSTEM` with a template variable:
```
TENSION CHAIN (the core output):
  - {{BEAT_COUNT_RANGE}} causally-linked beats
```

**File: `backend/services/plotService.ts`**
In `buildBuilderPrompt()`, read the scope/length from the constraint ledger (imported from hook). Map to beat range:
```typescript
private getBeatCountRange(ledger: PlotLedgerEntry[]): string {
  const scope = ledger.find(e => e.key.includes("scope") || e.key.includes("length"));
  const val = scope?.value?.toLowerCase() ?? "";
  if (val.includes("gut-punch") || val.includes("short") || val.includes("2-hour")) return "6-10";
  if (val.includes("slow-burn") || val.includes("season") || val.includes("long")) return "20-35";
  if (val.includes("episodic") || val.includes("series")) return "30-50";
  return "12-18"; // default
}
```
Replace `{{BEAT_COUNT_RANGE}}` in the template with the result.

Also update the `PLOT_CLARIFIER_SYSTEM` to reference this variable so the clarifier knows the expected scale.

---

### Issue 7 + 10: Cast Size as Explicit Assumption

**VERIFY:** Read `characterPrompts.ts` CAST SIZE section (~line 202-203) — confirm it says "4-6" with no user-facing assumption.

**File: `backend/services/hookPrompts.ts`**
In `HOOK_CLARIFIER_SYSTEM`, add to the STEP 3 creative constraints section (~line 116-135), add a new constraint:
```
  CAST SCALE — How many people does this story need to be addictive?
    "A locked-room duo — two people, one can't-look-away relationship" / "A pressure triangle — three people pulling in different directions" / "An ensemble crew where alliances shift every chapter" / "A faction war with 7+ players and no safe side"
```

In STEP 4 assumptions section, add: "Surface cast scale as an assumption on turn 2-3 when the story shape is forming. Infer from the seed when obvious (a 'royal court' implies ensemble, a 'forbidden affair' implies duo/triangle)."

**File: `shared/types/hook.ts`**
Add to `HookStateUpdate` interface (~line 35):
```typescript
  cast_scale?: "duo" | "triangle" | "small_ensemble" | "large_ensemble";
```

**File: `backend/services/characterPrompts.ts`**
Update CAST SIZE section (~line 202-203) to read the imported cast_scale:
```
CAST SIZE:
Check the constraint ledger for a confirmed cast_scale from the hook module. If present, honor it:
  - "duo" → 2-3 characters
  - "triangle" → 3-4 characters
  - "small_ensemble" → 4-6 characters
  - "large_ensemble" → 6-8+ characters
If no cast_scale in ledger, infer from the story and surface as an assumption on turn 1.
The number of characters should be driven by the story, NOT defaulted to any number.
```

---

### Issue 16: Character Differentiation Matrix

**VERIFY:** Read `characterPrompts.ts` CHARACTER_BUILDER_SYSTEM — confirm there's a `structural_diversity` field but no explicit differentiation matrix.

**File: `backend/services/characterPrompts.ts`**
In `CHARACTER_BUILDER_SYSTEM`, add after the existing `structural_diversity` requirement (~line 391):
```
- differentiation_matrix: For EACH character, assign distinct values across these 4 dimensions. No two characters may share the same value on 3+ dimensions:
    stress_response: "freeze" | "fight" | "flee" | "fawn" | "perform" | "withdraw"
    communication_style: "direct" | "indirect" | "manipulative" | "avoidant" | "performative" | "silent"
    core_value: "freedom" | "control" | "connection" | "truth" | "safety" | "status" | "pleasure"
    power_strategy: "charm" | "force" | "intelligence" | "endurance" | "deception" | "vulnerability"
  Output as: Record<string, { stress_response: string; communication_style: string; core_value: string; power_strategy: string }>
```

**File: `shared/types/character.ts`**
Add to `CharacterBuilderOutput` interface (~line 158):
```typescript
  differentiation_matrix: Record<string, {
    stress_response: string;
    communication_style: string;
    core_value: string;
    power_strategy: string;
  }>;
```

**File: `backend/services/characterSchemas.ts`**
Add `differentiation_matrix` to the builder JSON schema.

In the CHARACTER JUDGE prompt, add: "HARD-FAIL if any two characters share the same value on 3 or more dimensions of the differentiation matrix."

---

### Issue 9: Stronger Warning System

**VERIFY:** Read `hookPrompts.ts` `conflict_flag` description (~line 260) — confirm it exists but is just a string field.

**File: `backend/services/hookPrompts.ts`** (and characterPrompts, worldPrompts, plotPrompts — same pattern)
Update the `conflict_flag` output description in ALL clarifier system prompts to:
```
8. conflict_flag — If the user's choices create a problem, provide:
   - A clear description of the conflict (1-2 sentences)
   - severity: "soft" (informational, uncommon but workable) | "moderate" (should be addressed) | "hard" (will produce incoherent story)
   - fix_options: Array of 2-3 concrete alternatives, each max 15 words. These should be story pivots, not abstract advice.
   Example: { description: "Lighthearted comedy clashes with survival-stakes kidnapping", severity: "moderate", fix_options: ["Darken the tone to match the stakes", "Lower the stakes to match the comedy", "Lean into tonal whiplash as a feature"] }
   If no conflict, use "".
```

**File: `shared/types/hook.ts`** (and character.ts, world.ts, plot.ts)
If `conflict_flag` is currently typed as `string`, change the clarifier response type to support the new structured format. Keep backward compat — allow `string | { description: string; severity: string; fix_options: string[] }`.

---

### Issue 20: Assumption Category Consistency

**VERIFY:** Read `hookPrompts.ts` STEP 4b (~line 150) — confirm assumptions are fully dynamic with no required categories.

**File: `backend/services/hookPrompts.ts`**
In STEP 4b, add after "On the FIRST turn, surface 2–5 assumptions":
```
REQUIRED CATEGORIES for first-turn assumptions (ensure these are always covered):
  - At minimum, surface assumptions for: tone/promise, setting, protagonist presentation (gender/visual identity), relationship type, and scope/length
  - The LLM chooses the SPECIFIC content for each category — but these categories must be present
  - Additional creative assumptions beyond these 5 are encouraged
```

**File: `backend/services/characterPrompts.ts`**
In STEP 5 (~line 154), add:
```
REQUIRED FIRST-TURN CATEGORIES: On turn 1, always surface assumptions for: protagonist presentation/appearance, antagonist presentation/appearance, and at least one relationship assumption. Additional assumptions are encouraged.
```

---

### Issue 24: Story Scope Advisor — Proactive Scope/Length/Cast Guidance

**Problem:** The app never tells the user what their scope and cast choices actually mean for their experience. A user might say "I want a big ensemble" without knowing that means 15+ scenes, 30+ minutes of generation, and shallower character development. The app should proactively recommend scope based on the story seed and explain the trade-offs BEFORE the user commits.

**VERIFY:** Read `hookPrompts.ts` STEP 3 CREATIVE CONSTRAINTS (~line 116-135) — confirm SCOPE/LENGTH and RELATIONSHIP GEOMETRY exist as constraint categories but with NO advisory text about what each choice means for the user's experience. Read `characterPrompts.ts` CAST SIZE section (~line 202) — confirm there's no recommendation language.

**Changes:**

**File: `backend/services/hookPrompts.ts`**

1. In `HOOK_CLARIFIER_SYSTEM`, add a new STEP 3b after STEP 3 (creative constraints), before STEP 4 (infer before asking):

```
STEP 3b — STORY SCOPE ADVISOR (activate on turns 2-3 when the story shape is forming)

When you have enough context to understand the story's natural shape (usually turn 2-3), include a scope_recommendation in your output. This is your professional assessment of what this story WANTS to be, with honest trade-offs.

Analyze the seed and confirmed constraints to determine:
  1. NATURAL CAST SIZE — How many characters does this story need to be addictive?
     - Does the conflict require a duo, triangle, ensemble, or faction?
     - What's the minimum cast that makes every relationship essential?
  2. NATURAL LENGTH — What pacing does this story demand?
     - Is this a pressure-cooker with one explosive event, or a slow reveal with layers?
     - How many scenes does the emotional arc need?
  3. EXPERIENCE IMPACT — What does this mean for the user?
     - Approximate scene count
     - Approximate generation time (short: ~5 min, medium: ~15 min, long: ~30 min)
     - Depth vs breadth trade-off (fewer characters = deeper psychology, more = richer dynamics but thinner individual arcs)

Frame as enthusiasm, not instruction:
  GOOD: "I think this story WANTS to be a tight three-person pressure cooker — the jealousy dynamic doesn't work with fewer, and more would dilute the claustrophobia. That means ~8 scenes, maybe 15 minutes of generation, but every scene will be intense."
  BAD: "I recommend 3 characters and 8 scenes."

Always present at least ONE genuine alternative with honest trade-offs:
  "But if you want the court intrigue angle, we could expand to 5 characters with shifting alliances — you'd get ~14 scenes and richer politics, but each character gets less individual depth. Worth it for this story?"

Keep advisory to 2-3 sentences per option. This is conversation, not a report.
```

2. In the OUTPUT FORMAT section (~line 217+), add a new output field after `conflict_flag` (field 8):

```
8b. scope_recommendation — Present ONLY on turns 2-3 when you have enough story context. Null/omitted on other turns. Contains:
   - recommended_cast: "duo" | "triangle" | "small_ensemble" | "large_ensemble"
   - recommended_length: "short" | "medium" | "long" | "epic"
   - reasoning: 1-2 sentences explaining WHY this story naturally wants this scope (reference specific story elements)
   - experience_note: 1 sentence about what this means for the user ("~8 scenes, about 15 min generation, deep character focus")
   - alternative: { cast: string, length: string, reasoning: string, experience_note: string } — ONE genuine alternative with honest trade-offs
   - Example:
     {
       "recommended_cast": "triangle",
       "recommended_length": "medium",
       "reasoning": "The forbidden-love-plus-arranged-marriage geometry needs exactly three people — the tension collapses with fewer, and a fourth dilutes the impossible choice.",
       "experience_note": "~10 scenes, about 15 min generation. Each character gets full psychological depth.",
       "alternative": {
         "cast": "small_ensemble",
         "length": "long",
         "reasoning": "If you want the political angle — rival families, court intrigue — we'd need 5-6 players with shifting loyalties.",
         "experience_note": "~18 scenes, about 30 min generation. Richer world, but individual arcs are thinner."
       }
     }
   If the user has already confirmed scope/cast in the constraint ledger, do NOT repeat this. Only present when scope is still unconfirmed.
```

**File: `shared/types/hook.ts`**
Add to the clarifier response type (find the response interface used by the hook clarifier):
```typescript
  scope_recommendation?: {
    recommended_cast: "duo" | "triangle" | "small_ensemble" | "large_ensemble";
    recommended_length: "short" | "medium" | "long" | "epic";
    reasoning: string;
    experience_note: string;
    alternative: {
      cast: string;
      length: string;
      reasoning: string;
      experience_note: string;
    };
  } | null;
```

**File: `backend/services/hookSchemas.ts`**
Add `scope_recommendation` to the clarifier JSON schema as an optional object with the fields above.

**File: Frontend — Hook clarifier UI**
When `scope_recommendation` is present in the clarifier response:
- Render it as a distinct card/section below the main question, styled differently from assumptions (this is a recommendation, not an assumption)
- Show the recommendation with its reasoning and experience note
- Show the alternative as a clearly labeled option: "Or, if you prefer..."
- User can: accept the recommendation (adds to constraint ledger as confirmed), pick the alternative (adds alternative to ledger), type their own preference, or ignore (system infers on next turn)
- Do NOT block progress — if the user ignores and moves on, the clarifier infers scope from context on the next turn

**File: `backend/services/characterPrompts.ts`**
In `CHARACTER_CLARIFIER_SYSTEM`, add to the beginning of the clarifier's context awareness section:

```
SCOPE AWARENESS: Check the constraint ledger for confirmed cast_scale and scope/length from the hook module. If present, briefly acknowledge it on turn 1:
  - "We settled on [X] characters in the hook — I'm building from there. Let me know if that still feels right as we develop them."
  - If the actual character dynamics during clarification suggest a different count, flag it: "You mentioned a mentor figure — that would make 4 characters instead of the 3 we planned. They'd add [value] but each character gets slightly less depth. Add them?"
Do NOT repeat the full scope advisory from the hook — just a brief acknowledgment and course-correct if needed.
```

**Why this matters:** The app currently knows things the user doesn't — how long generation takes, how scene count scales with cast, how depth trades off with breadth. Sharing that knowledge proactively respects the user's time and lets them make informed creative choices. It also prevents the disappointment of getting 20 minutes into a session and realizing the scope is wrong.

**Relationship to other issues:**
- Issue 5 (dynamic beat count) provides the beat-count-from-scope mapping that feeds the experience_note
- Issue 7 + 10 (cast size) become more effective when the user has already been advised about cast trade-offs
- Issue 9 (warnings) handles cases where the user's choices create problems; Issue 24 handles the case where choices are valid but the user doesn't understand the implications

---

## BATCH 3: Scene Module & Performance
**Issues: 12 (scene speed), 13 (scene readability)**
**Goal:** Add "Generate All" mode and fix scene rendering.

### Issue 12: Scene Speed — Generate All Mode

**VERIFY:** Read `sceneService.ts` — understand the current phase flow and how auto-pass works.

**File: `backend/services/sceneService.ts`**
Add a new method `generateAllScenes(projectId: string)` that:
1. Runs the scene planner (Phase 0) normally
2. Skips Phase 1 clarification entirely for all scenes
3. Builds all scenes sequentially (or in batches of 3 using Promise.all with concurrency limit)
4. Skips minor judges for non-turning-point scenes
5. Runs the final judge on the complete output
6. Returns the full scene pack

Also add a parameter to the existing clarification flow to lower auto-pass threshold:
```typescript
// In the auto-pass logic, change:
// if (confidence >= 0.85 && !needsInput) → auto-pass
// to:
const threshold = scene.turning_point_ref ? 0.85 : 0.70;
if (confidence >= threshold && !needsInput) → auto-pass
```

**File: Add route** for the Generate All endpoint:
- `POST /api/projects/:id/scene/generate-all` → calls `generateAllScenes`

**Frontend:** Add a "Generate All Scenes" button alongside the existing per-scene flow. Show progress: "Scene 4/15 — The Betrayal". After completion, show a "Director's Review" screen where user reads through all scenes and can flag individual scenes for revision.

---

### Issue 13: Scene Screenplay Rendering

**VERIFY:** Read `shared/types/scene.ts` `ReadableScene` interface (~line 178) — confirm it has a `screenplay_text` field. Check what the frontend currently renders.

**Frontend fix:** The `ReadableScene` type has `screenplay_text` which is pre-formatted screenplay text. The frontend should:
1. Render this field with proper CSS:
   - Character names (ALL CAPS at start of line) → bold, slightly larger
   - Parenthetical delivery notes (in parentheses) → gray italic
   - Stage directions (bracketed or prose blocks) → left-border accent, gray italic
   - Dialogue → standard font, indented under character name
   - INTERNAL monologue → italic
2. Use a monospace or screenplay-style font (Courier New or similar)
3. Add a "Script View" toggle if there are other view modes

This is primarily a CSS/rendering change. If `screenplay_text` is not being generated properly, check `scenePrompts.ts` for the builder's formatting instructions.

---

## BATCH 4: Visibility & Transparency
**Issues: 4 (debug panel), 6 (pre-scene audit), 11 (tournament visibility), 14 (export previews), 17 (cross-module visibility), 19 (token tracking)**
**Goal:** Make the engine's internal work visible to users.

### Issue 4: Debug/Insights Panel

**Frontend:** Add a collapsible "Engine Insights" drawer accessible via a gear/debug icon on each module's clarifier screen. Hidden behind a "Developer Mode" toggle in app settings (off by default). Shows:

1. **Cultural Brief** — the evidence items and creative applications from the most recent cultural research
2. **Divergence Map** — the alternative direction map from the divergence explorer
3. **Psychology Signals** — active signals with confidence scores, adaptation plan
4. **Development Targets** — upstream weaknesses and their status

**Backend:** Add an endpoint to retrieve engine debug data:
- `GET /api/projects/:id/:module/debug` → returns `{ culturalBrief, divergenceMap, psychologyLedger, developmentTargets }`

This data already exists in the session state — just needs to be exposed via API.

---

### Issue 6: Pre-Scene Audit

**File: `backend/services/sceneService.ts`** (or new file `backend/services/auditService.ts`)
Add a method `getPreSceneAudit(projectId: string)` that:
1. Loads all locked packs (hook, character, characterImage, world, plot)
2. Aggregates all `weaknesses` and `upstream_target_assessment` entries
3. Filters to unresolved/partially_addressed targets
4. Groups by severity: "critical" (affects story coherence), "review" (quality improvement), "minor" (cosmetic)
5. Returns the grouped list with fix suggestions from the judge outputs

**File: Add route:**
- `GET /api/projects/:id/scene/audit` → returns the audit
- `POST /api/projects/:id/scene/audit/resolve` → accepts user decisions on each target

**Frontend:** Show a single audit screen between plot lock and scene start. Auto-skip if zero unresolved targets. Show grouped by severity with "Accept as-is" defaults for minor items. "Skip audit" button for users who trust the system.

---

### Issue 11: Tournament Visibility

**VERIFY:** Read the build-judge loop in any service (e.g., `hookService.ts`) — find where the tournament/retry happens.

**Backend:** During the builder-judge loop, emit progress events (if using SSE/websockets) or update the session state with:
```typescript
buildProgress: {
  attempt: number;      // 1, 2, 3
  maxAttempts: number;  // 3
  status: "building" | "judging" | "passed" | "failed_retrying" | "best_effort";
  lastFailReason?: string;  // from judge, only populated on failure
}
```

**Frontend:** Display "Refining your story... (quality check 2/3)" during the loop. Only show failure details if all attempts fail and user needs to choose.

---

### Issue 14: Export Preview Renderers

**VERIFY:** Check the frontend for which pack types have preview components and which don't.

**Frontend:** Build a generic `PackPreview` component that:
1. For ANY pack type, renders `state_summary` as the primary text
2. Add module-specific detail sections:
   - HookPack: hook_sentence, emotional_promise, premise
   - CharacterPack: character cards (role, description, presentation)
   - WorldPack: arena, factions, rules
   - PlotPack: tension chain as a timeline
   - ScenePack: scene titles + status
   - CharacterImagePack: generated images (if available)

Use `state_summary` as the immediate fix for all modules — even plain text is better than a broken screen.

---

### Issue 17: Cross-Module Visibility (free if Issues 4 + 6 are built)

No additional code needed. The debug panel (Issue 4) shows development targets with their status. The pre-scene audit (Issue 6) shows the full history. Just ensure the development target data flows through the debug endpoint.

---

### Issue 19: Token Tracking

**File: `backend/services/llmClient.ts`**
After each API call, accumulate token usage:
```typescript
// Add to LLMClient class:
private sessionTokens: { input: number; output: number; calls: number } = { input: 0, output: 0, calls: 0 };

// After each call:
this.sessionTokens.input += response.usage.input_tokens;
this.sessionTokens.output += response.usage.output_tokens;
this.sessionTokens.calls++;
```

Add a getter: `getTokenUsage()` → returns the accumulated stats.

Expose via the debug endpoint from Issue 4.

---

## BATCH 5: Architecture & Long-Term
**Issues: 18 (psych reset), 21 (story bible), 22 (module revision)**
**Goal:** Deep architectural improvements.

### Issue 18: Psychology Ledger Reset at Module Boundaries

**VERIFY:** Read `psychologyEngine.ts` — find the `runConsolidation` function and how it's called.

**File: `backend/services/psychologyEngine.ts`**
Add a new exported function:
```typescript
export function moduleBoundaryConsolidation(ledger: UserPsychologyLedger): UserPsychologyLedger {
  // 1. Run existing consolidation
  let consolidated = runConsolidation(ledger);
  // 2. Drop signals with confidence < 0.2
  consolidated.signals = consolidated.signals.filter(s => s.confidence >= 0.2);
  // 3. Cap active signals at 8 (keep highest confidence)
  consolidated.signals.sort((a, b) => b.confidence - a.confidence);
  consolidated.signals = consolidated.signals.slice(0, 8);
  return consolidated;
}
```

Call this function in each service's `lockModule()` / `generatePack()` method, right before writing the pack:
```typescript
session.psychologyLedger = moduleBoundaryConsolidation(session.psychologyLedger);
```

---

### Issue 21: Story Bible

**File: Create `backend/services/storyBibleService.ts`**
```typescript
export class StoryBibleService {
  constructor(private llm: LLMClient, private projectStore: ProjectStore) {}

  async generateBible(projectId: string, newPackSummary: string): Promise<string> {
    const existing = await this.projectStore.getStoryBible(projectId);
    const prompt = `Update this story bible with the new module output. Keep it under 500 words. Only include CONFIRMED facts.\n\nCurrent bible:\n${existing || "(empty)"}\n\nNew module output:\n${newPackSummary}`;
    const response = await this.llm.call({ role: "cultural_summarizer", system: "You are a concise story bible writer.", user: prompt });
    const bible = response.text;
    await this.projectStore.saveStoryBible(projectId, bible);
    return bible;
  }
}
```

**File: `backend/storage/projectStore.ts`**
Add `getStoryBible(projectId)` and `saveStoryBible(projectId, bible)` — file-based JSON following existing patterns.

Call `generateBible()` at each module lock. Inject the bible into each module's prompt prefix as:
```
═══ STORY BIBLE (do NOT contradict — these are confirmed canonical facts) ═══
{{STORY_BIBLE}}
```

---

### Issue 22: Module Revision (Stage 1 only — regenerate current module)

**VERIFY:** Check if there's already a way to re-run the builder on a locked module.

**Backend:** In each service, add a `regenerateBuilder(projectId: string, constraintOverrides?: Record<string, string>)` method that:
1. Takes the current session (must be in "locked" status)
2. Applies any constraint overrides to the ledger
3. Re-runs the builder + judge loop
4. Replaces the locked output
5. Does NOT affect downstream modules (they'll use the new pack when they load it)

**Frontend:** Add a "Regenerate" button on the locked module screen. Optionally shows constraint edits before regenerating.

---

## VERIFICATION CHECKLIST

After ALL batches are complete:
1. Run `npx tsc --noEmit` — zero errors
2. Start the dev server — no crash on startup
3. Run a test session through hook → character to verify:
   - Gender assumption is surfaced in character clarifier
   - MUST HONOR block appears at end of prompts (check prompt preview)
   - Character review screen appears after clarifier readiness
4. Check that the prompt preview endpoints still work for all modules
5. Verify no regressions in existing test sessions (load an old session, confirm it still renders)
