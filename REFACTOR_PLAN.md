# Visnovgen Refactor Plan
> Finalized 2026-03-16. Reviewed by Claude, ChatGPT, and Gemini.

## Already Done (this session, uncommitted)

- Divergence/cultural JSON truncation: increased maxTokens 2500→4096, added `stopReason` to all providers, added `repairTruncatedJson` fallback
- Cultural research turn-1 gate removed: fires from turn 1 instead of turn 2+
- Insights display staleness bug: all 6 debug routes fixed (inverted stale check)
- Prompt conciseness: divergence 15-20→8-10 futures, cultural researcher capped at 3-5 evidence items

---

## Tier 1 — Correctness Bugs

### 1A. Remove duplicate character review routes
- **File:** `backend/routes/character.ts`
- **Action:** Delete lines 240-296 (second GET /review/:projectId and POST /review)
- **Why:** Dead code — Express matches first definition. Second implementation bypasses service layer.

### 1B. Severity-based judge gate
- **Files:** `backend/services/sceneService.ts` (judge logic), scene judge prompt/schema
- **Action:** Add severity (`critical | major | minor | cosmetic`) and class (`prose | continuity | structural | emotional | logic`) to judge `should_fix` items. Fail pass if: any critical, or 2+ major in continuity/structural/emotional/logic.
- **Why:** Current judge flags real problems ("prince interiority missing") but passes anyway.

### 1C. Psychology decay with `stability_class` + `source`
- **Files:** `shared/types/userPsychology.ts`, `backend/services/psychologyEngine.ts`
- **Action:**
  - Add `source: "explicit" | "inferred"` to BehaviorSignal
  - Add `stability_class: "core" | "medium" | "volatile"` to BehaviorSignal
  - Core signals (genre, tone, boundaries, taboos): 2x grace period (6 turns), half decay (0.025/turn), never fully suppress — floor at 0.10
  - Volatile signals (micro-tactics like option count preference): current decay rate
  - Medium: default behavior
  - Clarifier marks signals from direct user statements as `source: "explicit"`
  - Categories `content_preferences` and `tonal_risk` default to `stability_class: "core"`
- **Why:** "Gothic horror" signal shouldn't vanish because user spent 4 turns discussing castle layouts.

### 1D. Request abort + in-flight deduplication
- **Files:** backend route files, `backend/services/llmClient.ts`
- **Action:**
  - Add optional `AbortSignal` to `LLMClient.call()`
  - Check signal before each retry attempt; throw on abort
  - Per-project in-flight guard: reject duplicate submissions for same `projectId + module + turn` with 409 Conflict
  - Listen for `req.on('close')` in route handlers, propagate abort
  - Add idempotency fingerprint (`projectId + module + turn + action`) for dedup
- **Why:** Frontend times out at 180s, backend continues running 5+ min LLM calls with no cancellation.
- **Boundary note:** Single-process, single-machine guard only.

---

## Tier 2 — Data Hygiene + Observability

### 2A. Base64 extraction from session JSON
- **Files:** `backend/storage/characterImageStore.ts`, `shared/types/characterImage.ts`
- **Action:**
  - Write base64 to separate file: `data/characterImages/assets/{imageId}.b64`
  - Store only file path in session JSON
  - Migration: on load, if `image_base64` exists, extract and replace with `image_ref`
- **Why:** Session files are 4-7MB. Destroys I/O, debugging, backups.

### 2B. Schema versioning + migration-on-load
- **Files:** new `backend/storage/migrations.ts`, all store classes, `shared/types/*.ts`
- **Action:**
  - Add `schemaVersion: number` to all session interfaces. Current = 2.
  - Check version on load, run migrations sequentially, re-save.
  - v1→v2: populate missing `presentation`, `age_range` with `"unspecified"`.
  - Remove fallback inference logic from `characterImageService.ts` (~lines 1220-1250).
- **Why:** Old sessions silently degrade downstream output quality.

### 2C. Two-tier post-parse validation
- **File:** new `backend/services/schemaValidation.ts`
- **Action:**
  - **Hard-fail + retry:** pacing mode, scene objective, dramatic turn type, reveal type, character presentation (if image gen depends on it), any field that branches logic
  - **Soft-coerce + warn:** style chip variants, display labels, decorative fields
- **Why:** Enums removed from schemas for Anthropic grammar limits. Bad values can enter and branch logic silently.

### 2D. Per-project write mutex
- **Files:** all store classes
- **Action:** In-memory mutex keyed by projectId. Acquire before read-modify-write, release in finally block.
- **Why:** Background tasks (consolidation, divergence, cultural) save to same session file. Prevents lost updates.
- **Boundary:** Single-process, single-machine, in-memory only. Document this explicitly. Does not solve multi-process or distributed concurrency.

### 2E. Context observability
- **Files:** service files (builder prompt construction), llmClient
- **Action:**
  - Log token count estimates per prompt block (system, each context section, dynamic suffix)
  - Log which blocks were injected vs omitted per call
  - Log judge failure classes and counts
  - Log retries by reason
- **Why:** Cannot optimize context without measuring it. Replaces abstract arguments with data.

### 2F. Artifact provenance
- **Files:** all session/artifact types
- **Action:** Add to all saved artifacts:
  - `schemaVersion`
  - `provider` (which LLM provider generated this)
  - `model` (which model)
  - `generatedAt` (ISO timestamp)
  - `sourceTurn` (which turn produced this)
- **Why:** Mixed old/new outputs make future audits impossible without provenance.

### 2G. Golden test harness
- **Action:** Create a fixed test pack:
  - One strong project, one weak, one noisy/edge-case, one with legacy data
  - Measure: token usage by module, latency, retries, judge failure rate, continuity errors
  - Run before and after Tier 3 changes to verify quality didn't regress
- **Why:** Need baseline before adding product features. Prevents "improving" architecture while flattening output quality.

---

## Tier 3 — Product Intelligence + Quality

### 3A. JSON repair improvement
- **File:** `backend/services/llmClient.ts`
- **Action:**
  - On truncation: retry once with `maxTokens * 1.5` before falling back to repair
  - Repair only for fire-and-forget tasks (divergence, cultural, consolidation)
  - Mark repaired artifacts with `truncated: true`
  - Critical-path outputs (builder, judge): fail on truncation, do not repair
- **Why:** Repaired JSON silently loses data. Retry-then-repair is safer.

### 3B. Silent catch blocks → logged warnings
- **Files:** all route files, store files (~10 instances)
- **Action:** Replace `catch {}` with `catch (err) { console.warn("[MODULE] non-critical:", err); }`
- **Why:** Silent swallowing hides real problems.

### 3C. Choice consequence ledger
- **Files:** new type in `shared/types/`, plot service, scene judge
- **Schema:**
  ```
  { choiceId, sourceTurn, decision, stakes, owedSceneWindowEnd, status: "pending" | "acknowledged" | "overdue" }
  ```
- **Action:**
  - Plot module LLM populates when generating
  - Judge verifies overdue items are addressed
  - Scene builder receives active/overdue consequences as context
- **Feature flag:** `ENABLE_CONSEQUENCE_LEDGER`
- **Why:** Users need to feel their choices have structural consequences, not just flavor.

### 3D. Echo ledger
- **Files:** new type, clarifier/builder prompts
- **Action:**
  - Track user-originated motifs (distinctive details, emotionally charged imagery, symbolic elements)
  - Priority scoring: `symbolic | sensory | emotional | distinctive`
  - Tracking fields: `timesEchoed`, `lastEchoedScene`, `echoCooldown`
  - Inject echo candidates into builder prompts at appropriate timing (2-4 scenes later)
- **Feature flag:** `ENABLE_ECHO_LEDGER`
- **Why:** Deliberate callback of user-originated details creates ownership and co-authorship feel. Highest-impact co-authorship feature.

### 3E. Escalation mechanic in clarifier
- **Files:** hookService (clarifier loop), psychology engine
- **Action:**
  - When user provides free-text creative input, add micro-step that heightens/complicates/tempts
  - Not every turn — gated by psychology signals (does user respond well to provocation?)
  - Users with `control_orientation` toward "director" get less escalation; "explorers" get more
- **Feature flag:** `ENABLE_ESCALATION`
- **Cost ceiling:** Max 1 escalation micro-call per turn
- **Why:** Validates user creativity immediately while handing back a heightened version.

### 3F. Simple UDQ ledger
- **Files:** new type, plot service, scene service, judge
- **Schema:**
  ```
  { question, openedInScene, lastEscalatedScene, status: "opened" | "escalated" | "answered" | "deferred" }
  ```
- **Action:**
  - Plot/scene LLM explicitly outputs UDQ status changes
  - Judge rule: every scene must contribute to story pressure, emotional movement, consequence, OR atmosphere. UDQ progress is one valid path, not the only path. Judge flags scenes that do *none of these*.
  - NOT mandatory that every scene touches a UDQ
- **Feature flag:** `ENABLE_UDQ_LEDGER`
- **Cost ceiling:** No extra LLM calls — UDQ tracking is part of existing builder/judge output
- **Why:** Suspense requires knowing what the reader is waiting to learn. Simple tracking enables payoff timing.

### 3G. Strategic ambiguity targets
- **Files:** scene plan types, scene builder prompt, scene judge
- **Action:**
  - Scene plans include `ambiguity_target` — what to leave unsaid/unseen
  - Also include `must_not_obscure` — scene objective, emotional clarity, causal readability are never hidden
  - `ambiguity_domain`: visual, motivation, history, threat, symbolic
  - Builder honors negative space
  - Judge verifies ambiguity preserved (not over-resolved) AND clarity maintained (not vague)
- **Feature flag:** `ENABLE_STRATEGIC_AMBIGUITY`
- **Why:** Imagination happens in gaps. Over-resolved scenes make users passive readers.

### 3H. Divergence filter → flagged safety net
- **File:** `backend/services/divergenceExplorer.ts`
- **Action:**
  - Convert ANTONYM_PAIRS from silent hard delete to flagged-veto
  - Flagged candidates logged with reasons, kept in debug output
  - Track false positive rate
  - If false positive rate is high, reassess filter approach
- **Why:** Lexical filters are brittle. Observability before removal.

### 3I. Selective context compression
- **Action:**
  - Use 2E data to identify the 3 fattest prompt blocks by token count
  - Compress those blocks with targeted distillation (shorter summaries, not schema changes)
  - No indirection layer — direct compression of worst offenders
  - Measure before/after token counts and output quality via 2G goldens
- **Why:** Data-driven compression, not architectural speculation.

### Cost ceilings (applies to all Tier 3)
- Max micro-calls per turn: 2 (escalation + one other)
- Max judge reruns: 2
- Max retries per module: 3 (existing)
- Max context expansion from new features: tracked via 2E, flagged if >15% increase

---

## Tier 4 — Roadmap

| ID | Item |
|---|---|
| 4A | Provider-specific caching (OpenAI Responses API, Gemini CachedContent) |
| 4B | Creativity profile (ambiguity tolerance, escalation preference, inventor vs reactor) |
| 4C | Adaptive pacing based on creativity profile + engagement signals |
| 4D | Advanced context retrieval if 2E measurement shows remaining waste after 3I |

---

## Not Doing (and why)

| Proposal | Why not |
|---|---|
| Replace prose context with canonical cards / indirection layer | Measure first (2E), compress worst offenders (3I). Don't build infrastructure for unquantified problem. |
| Split scene builder into multiple LLM calls | 3-6x cost/latency. Judge already catches structural failures. |
| Full compulsion state machine | Simple UDQ + consequence ledger covers 80% of value at 10% complexity. |
| SQLite migration | Premature for single-user tool. File storage + mutex is sufficient. |
| Remove ANTONYM_PAIRS filter | Filter works correctly. Convert to flagged-veto with observability instead. |
| `promptVersion` / `moduleVersion` in provenance | Over-engineering. schemaVersion + git history covers this. |
| Cached-result-return for idempotency | Defer until proven needed. In-flight dedup + fingerprint covers primary case. |
