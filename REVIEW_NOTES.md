# Refactor Review Notes
> Generated 2026-03-17. Covers commits d18964d..dd7ab0d (4 commits, 45 files, +1691/-311 lines).

## Changes by Category

### New Files (7)
| File | Purpose |
|------|---------|
| `backend/services/inflightGuard.ts` | In-flight request dedup (single-process, in-memory Map) |
| `backend/services/schemaValidation.ts` | Two-tier post-parse validation (hard-fail + soft-coerce) for removed enums |
| `backend/services/contextObservability.ts` | Token count logging per prompt block + selective compression utilities |
| `backend/storage/projectMutex.ts` | Per-project write mutex (single-process, in-memory promise chain) |
| `backend/storage/migrations.ts` | Schema versioning framework (v1→v2 migration: presentation/age_range backfill) |
| (types only) `shared/types/scene.ts` | ConsequenceEntry, UDQEntry, EchoEntry, ArtifactProvenance interfaces |
| (types only) `shared/types/userPsychology.ts` | StoryFuture.constraintVeto field |

### Tier 1 — Correctness Bugs
| ID | Change | Files |
|----|--------|-------|
| 1A | Remove duplicate character review routes | `routes/character.ts` |
| 1B | Judge gate: `issue_class` (prose/continuity/structural/emotional/logic) on flagged_scenes + arc_issues. Gate: fail on any must_fix OR 2+ structural should_fix. Missing issue_class defaults to "structural" (conservative). | `sceneSchemas.ts`, `scenePrompts.ts`, `sceneService.ts`, `shared/types/scene.ts` |
| 1C | Psychology decay with `stability_class` + `source` on BehaviorSignal | `psychologyEngine.ts`, `psychologyPromptFragments.ts`, `shared/types/userPsychology.ts` |
| 1D | AbortSignal on LLM calls, in-flight dedup guard (409 on duplicate), req.on('close') abort propagation | `llmClient.ts`, `inflightGuard.ts`, all route files |

### Tier 2 — Data Hygiene + Observability
| ID | Change | Files |
|----|--------|-------|
| 2A | Base64 extraction to `.b64` asset files. Migration-on-load for old sessions. Hydration in getSession() for API responses. Image-serving route added. | `characterImageStore.ts`, `characterImageService.ts`, `routes/characterImage.ts`, `shared/types/characterImage.ts` |
| 2B | `schemaVersion` on all 6 session types. Migration framework. v1→v2 backfills presentation/age_range. All stores call migrateSession on get(), set version on save(). | `migrations.ts`, all 6 store files, all 6 session type files |
| 2C | Two-tier schema validation (hard-fail + soft-coerce) | `schemaValidation.ts` |
| 2D | Per-project write mutex | `projectMutex.ts` |
| 2E | Context observability: logPromptBlocks with token estimates | `contextObservability.ts`, `sceneService.ts` |
| 2F | Artifact provenance: `CallProvenance` on LLMClient, provider/model on all PromptHistoryEntry types, provenance on BuiltScene | `llmClient.ts`, all 6 service files, all 6 PromptHistoryEntry types, `shared/types/scene.ts` |

### Tier 3 — Product Intelligence (all feature-flagged)
| ID | Flag | Change | Files |
|----|------|--------|-------|
| 3A | (always on) | Retry with 1.5x maxTokens before JSON repair. `truncationMode: "critical"` for builder/judge (fail, no repair). | `llmClient.ts`, `sceneService.ts` |
| 3B | (always on) | Silent catch blocks → logged warnings in routes | All route files |
| 3C | `ENABLE_CONSEQUENCE_LEDGER` | ConsequenceEntry type, builder schema fields, judge verification of overdue items, processLedgerUpdates(), markOverdueConsequences() | `sceneService.ts`, `sceneSchemas.ts`, `shared/types/scene.ts` |
| 3D | `ENABLE_ECHO_LEDGER` | EchoEntry type, echo candidate injection into builder prompt, echo_usage tracking | `sceneService.ts`, `sceneSchemas.ts`, `shared/types/scene.ts` |
| 3E | `ENABLE_ESCALATION` | Psychology-gated micro-call on free-text input. shouldEscalate() checks explorer/director signals. Max 200 tokens. | `hookService.ts`, `shared/types/hook.ts`, `shared/modelConfig.ts`, `runtime.ts` |
| 3F | `ENABLE_UDQ_LEDGER` | UDQEntry type, builder schema fields, judge verification, status tracking | `sceneService.ts`, `sceneSchemas.ts`, `shared/types/scene.ts` |
| 3G | `ENABLE_STRATEGIC_AMBIGUITY` | ambiguity_target/must_not_obscure/ambiguity_domain on ScenePlan. Planner, builder, and judge prompt additions. | `sceneService.ts`, `sceneSchemas.ts`, `shared/types/scene.ts` |
| 3H | (always on) | ANTONYM_PAIRS filter: flag-and-preserve instead of silent delete. constraintVeto field on StoryFuture. Prompt formatter skips vetoed futures. | `divergenceExplorer.ts`, `shared/types/userPsychology.ts` |
| 3I | `ENABLE_CONTEXT_COMPRESSION` | compressCharacterProfilesJson() strips verbose description fields. Applied to builder prompt character profiles. | `contextObservability.ts`, `sceneService.ts` |

---

## Potential Issues to Review

### HIGH PRIORITY

1. **Base64 hydration in pack exports vs session responses**
   - `getSession()` hydrates base64 from refs before returning → frontend works
   - `lockImages()` also hydrates (fixed in 8ab58e7)
   - **CHECK**: Does `saveExport()` also need hydration? The export pack stores image_ref but downstream modules (world, plot) strip images anyway. Verify the scene module's sourceCharacterImagePack handling when it reads from an export.

2. **Schema migration re-save on load could conflict with projectMutex**
   - All stores now re-save on get() if migration was needed
   - If two concurrent requests both call get() on an unmigrated session, both may try to re-save
   - The projectMutex exists but is NOT wired into the store layer (it's service-level)
   - **CHECK**: Is this a real race condition? Probably not in practice (migration is idempotent), but verify.

3. **characterImageStore double-save during get()**
   - `migrateInlineBase64()` re-saves if it extracts images
   - Schema migration also re-saves if schemaVersion changed
   - Both can happen on the same `get()` call → 2 disk writes
   - **CHECK**: Not a bug but inefficient. Could consolidate to single save.

4. **truncationRetried + retry loop interaction**
   - When truncation triggers `continue`, the `attempt` counter still increments
   - This means the truncation retry counts toward the 3-attempt limit
   - If attempt 1 truncates → retry with 1.5x → attempt 2 may truncate again → repair (no 3rd attempt for other errors)
   - **CHECK**: Is this the intended behavior? The plan says "retry once" but a network error on attempt 1 + truncation on attempt 2 would mean only 1 retry for truncation, which may be fine.

5. **`issue_class` required in schema but optional in TypeScript**
   - Schema has `required: ["scene_id", "issue", "severity", "issue_class"]`
   - TypeScript has `issue_class?: JudgeIssueClass`
   - New sessions: LLM always produces issue_class (schema enforces it)
   - Old sessions: `finalJudge` may lack issue_class → defaults to "structural" in gate logic
   - **CHECK**: If an old session's finalJudge is re-evaluated, the missing field defaults conservatively. But if someone reads old finalJudge data expecting issue_class, they get undefined. Is this a frontend concern?

### MEDIUM PRIORITY

6. **Escalation mechanic quality**
   - `shouldEscalate()` does keyword matching on signal hypotheses ("explorer", "director")
   - This is fragile — hypothesis text is LLM-generated and could use different wording
   - **CHECK**: Would a category-based check (signal.category === "control_orientation") with weight thresholds be more robust?

7. **Echo ledger population**
   - The echo ledger gets entries but there's no code that POPULATES initial entries
   - `processLedgerUpdates()` only updates existing entries or tracks usage
   - **CHECK**: Need to add code in the clarifier to detect user-originated motifs and create initial EchoEntry records. Currently the ledger will always be empty.

8. **Consequence ledger population**
   - Similar to echo: `processLedgerUpdates()` updates existing entries
   - The builder output can set `consequence_updates` but who creates the initial `ConsequenceEntry`?
   - **CHECK**: The plan says "Plot module LLM populates when generating." No changes were made to plotService. Need to add consequence entry creation in the plot module or scene planner.

9. **UDQ ledger: new entries created correctly?**
   - `processLedgerUpdates()` creates new UDQ entries when status is "opened"
   - But the builder needs to be instructed to output `udq_updates` with new questions
   - **CHECK**: The builder prompt doesn't currently mention UDQ unless the flag is on AND there are existing open questions. For the FIRST scene, no questions exist yet, so the prompt won't mention UDQ at all. Need a builder prompt addition that asks it to identify dramatic questions from the scene plan.

10. **Context compression stripping useful data**
    - `compressCharacterProfilesJson()` drops description, all_traits, backstory
    - These may be important for character voice and interiority in the builder
    - **CHECK**: Run the golden test harness (2G) with and without compression. Compare output quality.

11. **Divergence filter: vetoed futures still count toward family.novelty**
    - Families with all-vetoed futures still appear in the direction map
    - formatDirectionMapForPrompt skips vetoed futures but shows the family header
    - **CHECK**: Should families with 0 non-vetoed futures be hidden from the prompt entirely?

### LOW PRIORITY

12. **`hook_escalation` role has no dedicated prompt tuning**
    - Uses FAST model tier (haiku) — appropriate for micro-call
    - System prompt is inline in `runEscalationMicroCall()`, not in a prompts file
    - **CHECK**: Fine for now, but inconsistent with other modules that use dedicated prompt files.

13. **schemaValidation.ts created but not wired in**
    - The file exists with validators for pacing_type, compulsion_vector, presentation, etc.
    - No service currently calls these validators
    - **CHECK**: Was this intentional (Tier 2C was just the infrastructure)? If so, need a follow-up to wire validators into parse paths.

14. **projectMutex created but not wired into store save() methods**
    - `withProjectLock()` exists but no store uses it yet
    - The plan says "In-memory mutex keyed by projectId. Acquire before read-modify-write."
    - **CHECK**: Was this intentional? Need follow-up to wrap background task save paths with withProjectLock.

15. **provenance not captured for background tasks**
    - Divergence explorer, cultural researcher, psychology consolidator don't record provenance
    - Only prompt history and BuiltScene get provenance
    - **CHECK**: Is this acceptable? Background tasks are fire-and-forget, but provenance could still be useful for debugging.

16. **Frontend impact of type changes**
    - `GeneratedCharacterImage.image_base64` changed from required to optional
    - Frontend TypeScript may have strict checks that fail
    - **CHECK**: Run frontend build (`tsc` / `vite build`) to verify no frontend type errors.

---

## Test Plan for Reviewers

### Automated
- [ ] `npx tsc --noEmit` — passes (only pre-existing vitest import error)
- [ ] Run existing unit tests if any
- [ ] Run golden test harness (2G) if available

### Manual Integration Tests
- [ ] Create a new project from scratch (hook → character → image → world → plot → scene) — verify full pipeline works
- [ ] Load an OLD project (pre-schemaVersion) — verify migration runs, re-saves, session loads correctly
- [ ] Load an old project with inline base64 images — verify migration extracts to .b64 files
- [ ] Run final judge — verify issue_class appears on flagged_scenes and arc_issues
- [ ] Trigger truncation (set maxTokens very low) — verify retry with 1.5x, then repair (best-effort) or throw (critical)
- [ ] Enable `ENABLE_ESCALATION` + provide free-text input in hook — verify escalation_note appears
- [ ] Enable `ENABLE_STRATEGIC_AMBIGUITY` + run scene planner — verify ambiguity fields in scene plans
- [ ] Enable `ENABLE_CONSEQUENCE_LEDGER` — verify consequence entries in session after scene builds
- [ ] Double-submit a request — verify 409 from inflightGuard

### Things That Changed Behavior Without Feature Flags
- Divergence filter now flags instead of deleting (3H) — verify divergence output still useful
- JSON repair now retries with 1.5x first (3A) — may increase latency on truncation
- Builder/judge calls now throw on truncation instead of repairing (3A) — verify no silent failures become loud ones
- Base64 extracted from session JSON (2A) — session files should shrink dramatically
- All prompt history entries now include provider/model (2F) — verify debug UI handles extra fields
