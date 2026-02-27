# Hook Module — Codex Implementation Spec (v3 — Final Merged)

> **Scope**: Module 1 only (HookClarifier → HookBuilder → HookJudge → HookPack).
> **Repo**: Greenfield. Express + Vite/React + TypeScript.
> No theme, setting, characters, or plot modules.

---

## 0. Deployment Guide (Step-by-Step)

### Prerequisites
- Node.js 20+ installed
- An Anthropic API key (get one at https://console.anthropic.com)
- GitHub account (for Codex)

### Step 1: Create the repo

```bash
mkdir story-architect && cd story-architect
git init
```

### Step 2: Feed this spec to Codex in 4 tasks

Open Codex in the repo. Run these tasks IN ORDER. Paste the relevant spec sections with each task.

**Task 1 — Foundation files (types, flags, config, prompts, schemas)**

Prompt for Codex:
```
Create the following files based on the attached spec. Only create these files, don't wire anything yet:

1. shared/featureFlags.ts (§3)
2. shared/modelConfig.ts (§2)
3. shared/types/hook.ts (§4)
4. shared/types/api.ts (§4)
5. backend/services/hookPrompts.ts (§8)
6. backend/services/hookSchemas.ts (§9)
7. backend/services/llmClient.ts (§2)
8. .env.example

Use the exact code from the spec. These are foundational — other files depend on them.
```

Attach: This entire spec.

**Task 2 — Storage + Service layer + Routes**

Prompt for Codex:
```
Implement the backend based on the attached spec:

1. backend/storage/projectStore.ts (§5)
2. backend/services/hookService.ts (§7 — full class with all methods)
3. backend/featureFlags.ts (§3)
4. backend/middleware/featureFlagGuard.ts (§3)
5. backend/routes/hook.ts (§6 — all 6 hook endpoints)
6. backend/routes/models.ts (§6 — GET and PUT model config)
7. backend/index.ts (§12 — Express entry with dotenv)

Use the types from shared/types/, prompts from hookPrompts.ts, schemas from hookSchemas.ts, and LLMClient from llmClient.ts.
Follow the endpoint logic exactly as specified in §6.
```

Attach: This entire spec.

**Task 3 — Frontend**

Prompt for Codex:
```
Build the frontend based on the attached spec:

1. frontend/index.html (minimal, mounts React app)
2. frontend/main.tsx (React entry point)
3. frontend/api/hookApi.ts (§10)
4. frontend/components/HookWorkshop.tsx (§11 — single-page component, all phases)

Use Vite + React. The component should match the UI layout and interaction flow in §11 exactly.
Style with basic CSS (inline or a single .css file) — keep it clean but minimal.
```

Attach: This entire spec.

**Task 4 — Project config + wiring**

Prompt for Codex:
```
Create project configuration and wire everything:

1. package.json (§12)
2. tsconfig.json (standard strict TypeScript config)
3. vite.config.ts (§12 — proxy /api to backend)

Ensure:
- "npm run dev" starts both backend and frontend via concurrently
- Frontend proxies /api/* to localhost:3001
- All TypeScript compiles cleanly
```

Attach: This entire spec.

### Step 3: Install and run

```bash
# Copy env template and add your API key
cp .env.example .env
# Edit .env: set ANTHROPIC_API_KEY=sk-ant-...

# Install dependencies
npm install

# Start both servers
npm run dev
```

Backend runs on http://localhost:3001
Frontend runs on http://localhost:5173

### Step 4: Smoke test with curl (before touching the UI)

```bash
# 1. Check models
curl -s http://localhost:3001/api/models | jq .

# 2. First clarifier turn
curl -s -X POST http://localhost:3001/api/hook/clarify \
  -H "Content-Type: application/json" \
  -d '{"projectId":"test-1","seedInput":"A chef who poisons people"}' | jq .

# 3. Second turn (paste an option label from step 2)
curl -s -X POST http://localhost:3001/api/hook/clarify \
  -H "Content-Type: application/json" \
  -d '{"projectId":"test-1","userSelection":{"type":"option","optionId":"A","label":"PASTE_LABEL_HERE"}}' | jq .

# 4. Generate hook (tournament)
curl -s -X POST http://localhost:3001/api/hook/generate \
  -H "Content-Type: application/json" \
  -d '{"projectId":"test-1"}' | jq .

# 5. Lock it
curl -s -X POST http://localhost:3001/api/hook/lock \
  -H "Content-Type: application/json" \
  -d '{"projectId":"test-1"}' | jq .

# 6. Verify persistence
curl -s http://localhost:3001/api/hook/test-1 | jq .status
# Should return "locked"

# 7. Reset and start over
curl -s -X DELETE http://localhost:3001/api/hook/test-1 | jq .
```

### Step 5: Test model switching

```bash
# Switch judge to Haiku (fast, cheap)
curl -s -X PUT http://localhost:3001/api/models \
  -H "Content-Type: application/json" \
  -d '{"judge":"claude-haiku-4-5-20251001"}' | jq .

# Switch clarifier to Opus (richest questions)
curl -s -X PUT http://localhost:3001/api/models \
  -H "Content-Type: application/json" \
  -d '{"clarifier":"claude-opus-4-6"}' | jq .

# One-off override: everything uses Opus for a single request
curl -s -X POST http://localhost:3001/api/hook/generate \
  -H "Content-Type: application/json" \
  -H "X-Model-Override: claude-opus-4-6" \
  -d '{"projectId":"test-2"}' | jq .
```

### Step 6: Open the UI

Go to http://localhost:5173 — you should see the Hook Workshop.

### Troubleshooting

| Problem | Fix |
|---|---|
| `ANTHROPIC_API_KEY` not found | Make sure `.env` exists in project root with the key. `dotenv` loads it. |
| 429 rate limit errors | LLMClient retries automatically (3 attempts, exponential backoff). If persistent, switch to Haiku for testing. |
| JSON parse errors | Structured outputs should prevent these. If using a model that doesn't support them, fence-stripping + retry handles it. |
| Port 3001 in use | Set `PORT=3002` in `.env` and update `vite.config.ts` proxy target. |
| Frontend shows blank | Check browser console. Make sure Vite proxy is set to the correct backend port. |

---

## 1. Architecture

```
story-architect/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── .env.example
├── shared/
│   ├── featureFlags.ts             ← pure constants, no process.env
│   ├── modelConfig.ts
│   └── types/
│       ├── hook.ts
│       └── api.ts
├── backend/
│   ├── index.ts                    ← Express entry, imports dotenv/config
│   ├── featureFlags.ts             ← reads process.env (backend-only)
│   ├── routes/
│   │   ├── hook.ts
│   │   └── models.ts
│   ├── services/
│   │   ├── hookService.ts
│   │   ├── hookPrompts.ts
│   │   ├── hookSchemas.ts          ← JSON Schema for structured outputs
│   │   └── llmClient.ts
│   ├── middleware/
│   │   └── featureFlagGuard.ts
│   └── storage/
│       └── projectStore.ts
└── frontend/
    ├── index.html
    ├── main.tsx
    ├── components/
    │   └── HookWorkshop.tsx
    └── api/
        └── hookApi.ts
```

```
┌─────────────────────────────────────────────────┐
│  Frontend: Single-page HookWorkshop (Vite+React)│
└────────────────┬────────────────────────────────┘
                 │ REST
┌────────────────▼────────────────────────────────┐
│  Backend: Express + TypeScript                   │
│  POST /api/hook/clarify     → HookClarifier      │
│  POST /api/hook/generate    → HookBuilder tourn.  │
│  POST /api/hook/reroll      → Re-run tournament   │
│  POST /api/hook/lock        → Persist HookPack    │
│  GET  /api/hook/:projectId  → Load saved state    │
│  DELETE /api/hook/:projectId→ Reset session        │
│  GET  /api/models           → Current model cfg   │
│  PUT  /api/models           → Update models live   │
└─────────────────────────────────────────────────┘
```

---

## 2. Model Switching

### File: `shared/modelConfig.ts`

```typescript
export type HookRole = "clarifier" | "builder" | "judge" | "summary";

export interface ModelConfig {
  clarifier: string;
  builder: string;
  judge: string;
  summary: string;
}

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  clarifier: "claude-sonnet-4-6",
  builder: "claude-sonnet-4-6",
  judge: "claude-sonnet-4-6",
  summary: "claude-sonnet-4-6",
};

export const SUPPORTED_MODELS = [
  "claude-sonnet-4-6",              // Sonnet 4.6 (latest Sonnet, default)
  "claude-sonnet-4-5-20250929",     // Sonnet 4.5
  "claude-sonnet-4-20250514",       // Sonnet 4.0
  "claude-opus-4-6",                // Opus 4.6 (most capable)
  "claude-haiku-4-5-20251001",      // Haiku 4.5 (fastest/cheapest)
] as const;
```

### Runtime behavior
- Server holds mutable `activeModelConfig` in memory (initialized from env vars or defaults).
- `GET /api/models` → returns current config.
- `PUT /api/models` → partial update, validates against `SUPPORTED_MODELS`.
- **Per-request override**: Any `/api/hook/*` request can include header `X-Model-Override: <model-id>` to override ALL roles for that single request.
- **Per-role env vars** (optional, override defaults on startup): `HOOK_MODEL_CLARIFIER`, `HOOK_MODEL_BUILDER`, `HOOK_MODEL_JUDGE`, `HOOK_MODEL_SUMMARY`.

### File: `backend/services/llmClient.ts`

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { HookRole, ModelConfig } from "../../shared/modelConfig";

const STRUCTURED_OUTPUTS_BETA = "structured-outputs-2025-11-13";

export interface CallOptions {
  temperature?: number;
  maxTokens?: number;
  modelOverride?: string;
  /** If provided, enables structured outputs — response is guaranteed valid JSON */
  jsonSchema?: Record<string, unknown>;
}

export class LLMClient {
  private client: Anthropic;
  private config: ModelConfig;

  constructor(config: ModelConfig) {
    this.client = new Anthropic();
    this.config = config;
  }

  updateConfig(partial: Partial<ModelConfig>): void {
    Object.assign(this.config, partial);
  }

  getConfig(): ModelConfig {
    return { ...this.config };
  }

  /**
   * Call the LLM with:
   * - Retry + exponential backoff for 429/500/529
   * - Optional structured outputs (guaranteed JSON schema compliance)
   * - Multi-block response handling (joins all text blocks)
   */
  async call(
    role: HookRole,
    systemPrompt: string,
    userPrompt: string,
    options?: CallOptions
  ): Promise<string> {
    const model = options?.modelOverride ?? this.config[role];
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const params: Record<string, unknown> = {
          model,
          max_tokens: options?.maxTokens ?? 1024,
          temperature: options?.temperature ?? 0.7,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        };

        // Structured outputs: constrained JSON decoding via beta header
        const extraHeaders: Record<string, string> = {};
        if (options?.jsonSchema) {
          extraHeaders["anthropic-beta"] = STRUCTURED_OUTPUTS_BETA;
          (params as any).output_format = {
            type: "json_schema",
            schema: options.jsonSchema,
          };
        }

        const response = await this.client.messages.create(
          params as any,
          extraHeaders["anthropic-beta"]
            ? { headers: extraHeaders }
            : undefined
        );

        // Join ALL text blocks (Claude can return multiple content blocks)
        const text = response.content
          .filter((block): block is Anthropic.TextBlock => block.type === "text")
          .map((block) => block.text)
          .join("");

        // Structured outputs = already valid JSON; otherwise strip fences
        return options?.jsonSchema ? text : stripJsonFences(text);

      } catch (err: any) {
        const status = err?.status ?? err?.error?.status;
        const retryable = [429, 500, 529].includes(status);

        if (!retryable || attempt === maxAttempts) {
          throw err;
        }

        const retryAfter = err?.headers?.["retry-after"];
        const waitMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : Math.min(1000 * Math.pow(2, attempt - 1), 8000);

        console.warn(
          `LLM [${role}] attempt ${attempt} failed (${status}), retrying in ${waitMs}ms...`
        );
        await sleep(waitMs);
      }
    }

    throw new Error(`LLM [${role}] failed after max retries`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Strip ```json fences — only needed when NOT using structured outputs */
export function stripJsonFences(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }
  return s.trim();
}
```

---

## 3. Feature Flag

### File: `shared/featureFlags.ts`

```typescript
/**
 * Pure constants — no process.env. Safe for frontend import.
 * Backend reads env vars separately in backend/featureFlags.ts.
 */
export const DEFAULT_FEATURE_FLAGS = {
  HOOK_MODULE_ENABLED: true,
} as const;

export type FeatureFlags = typeof DEFAULT_FEATURE_FLAGS;
```

### File: `backend/featureFlags.ts`

```typescript
import { DEFAULT_FEATURE_FLAGS, FeatureFlags } from "../shared/featureFlags";

/** Runtime flags — reads env vars. Import only in backend code. */
export const FEATURE_FLAGS: FeatureFlags = {
  HOOK_MODULE_ENABLED:
    process.env.HOOK_MODULE_ENABLED !== undefined
      ? process.env.HOOK_MODULE_ENABLED !== "false"
      : DEFAULT_FEATURE_FLAGS.HOOK_MODULE_ENABLED,
};
```

### File: `backend/middleware/featureFlagGuard.ts`

```typescript
import { Request, Response, NextFunction } from "express";
import { FEATURE_FLAGS } from "../featureFlags";

export function featureFlagGuard(req: Request, res: Response, next: NextFunction) {
  if (!FEATURE_FLAGS.HOOK_MODULE_ENABLED) {
    return res.status(404).json({
      error: true,
      code: "FEATURE_DISABLED",
      message: "Hook module is disabled",
    });
  }
  next();
}
```

---

## 4. Data Contracts

### File: `shared/types/hook.ts`

```typescript
// ─── HookClarifier ───

export interface HookClarifierOption {
  id: string;        // "A" | "B" | "C" | "D" | "E"
  label: string;     // max ~60 chars
}

export interface HookStateUpdate {
  hook_engine?: string;
  stakes?: string;
  taboo_or_tension?: string;
  opening_image_seed?: string;
  setting_anchor?: string;
  protagonist_role?: string;
  antagonist_form?: string;
  tone_chips?: string[];
  bans?: string[];
}

export interface HookClarifierResponse {
  hypothesis_line: string;
  question: string;
  options: HookClarifierOption[];
  allow_free_text: boolean;
  ready_for_hook: boolean;
  missing_signal: string;
  state_update: HookStateUpdate;
}

// ─── HookBuilder ───

export interface CollisionSource {
  source: string;
  element_extracted: string;
}

export interface HookBuilderOutput {
  premise: string;
  opening_image: string;
  page_1_splash_prompt: string;
  page_turn_trigger: string;
  why_addictive: [string, string, string];
  collision_sources: CollisionSource[];
}

// ─── HookJudge ───

export interface HookJudgeScores {
  specificity: number;
  drawability: number;
  page_turn: number;
  mechanism: number;
  freshness: number;
}

export interface HookJudgeOutput {
  pass: boolean;
  hard_fail_reasons: string[];
  scores: HookJudgeScores;
  most_generic_part: string;
  one_fix_instruction: string;
}

// ─── HookPack (module handoff) ───

export interface HookPack {
  module: "hook";
  locked: {
    premise: string;
    page1_splash: string;
    page_turn_trigger: string;
    core_engine: {
      hook_engine: string;
      stakes: string;
      taboo_or_tension: string;
      protagonist_role: string;
      antagonist_form: string;
      setting_anchor: string;
    };
  };
  preferences: {
    tone_chips: string[];
    bans: string[];
  };
  source_dna: CollisionSource[];
  open_threads: string[];
  state_summary: string;
}

// ─── Session state ───

export interface HookSessionState {
  projectId: string;
  seedInput: string;
  turns: HookTurn[];
  currentState: HookStateUpdate;
  revealedHook?: HookBuilderOutput;
  revealedJudge?: HookJudgeOutput;
  hookPack?: HookPack;
  rerollCount: number;
  status: "clarifying" | "generating" | "revealed" | "locked";
}

export interface HookTurn {
  turnNumber: number;
  clarifierResponse: HookClarifierResponse;
  userSelection: {
    type: "option" | "free_text" | "surprise_me";
    optionId?: string;   // "A", "B", etc. — set when type is "option"
    label: string;       // display text: option label, free text, or "surprise_me"
  } | null;
}
```

### File: `shared/types/api.ts`

```typescript
import {
  HookClarifierResponse,
  HookBuilderOutput,
  HookJudgeScores,
  HookPack,
  HookSessionState,
} from "./hook";

/** Standard error shape for all endpoints */
export interface ApiError {
  error: true;
  code:
    | "FEATURE_DISABLED"
    | "NOT_FOUND"
    | "INVALID_INPUT"
    | "LLM_PARSE_ERROR"
    | "LLM_CALL_FAILED";
  message: string;
}

/** POST /api/hook/clarify */
export interface ClarifyResponse {
  clarifier: HookClarifierResponse;
  turnNumber: number;
  totalTurns: number;
}

/** POST /api/hook/generate and /reroll */
export interface GenerateResponse {
  hook: HookBuilderOutput;
  judge: {
    passed: boolean;
    hard_fail_reasons: string[];
    scores: HookJudgeScores;
    most_generic_part: string;
    one_fix_instruction: string;
  };
  rerollCount: number;
}

/** POST /api/hook/lock */
export type LockResponse = HookPack;

/** GET /api/hook/:projectId */
export type SessionResponse = HookSessionState;
```

---

## 5. Storage

### File: `backend/storage/projectStore.ts`

```typescript
import fs from "fs/promises";
import path from "path";
import { HookSessionState } from "../../shared/types/hook";

export class ProjectStore {
  private dataDir: string;

  constructor(dataDir = "./data") {
    this.dataDir = dataDir;
    fs.mkdir(dataDir, { recursive: true }).catch(() => {});
  }

  private filePath(projectId: string): string {
    const safe = projectId.replace(/[^a-zA-Z0-9_-]/g, "");
    return path.join(this.dataDir, `${safe}.json`);
  }

  async get(projectId: string): Promise<HookSessionState | null> {
    try {
      const raw = await fs.readFile(this.filePath(projectId), "utf-8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async save(session: HookSessionState): Promise<void> {
    const fp = this.filePath(session.projectId);
    const tmp = fp + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(session, null, 2));
    await fs.rename(tmp, fp);
  }

  async delete(projectId: string): Promise<void> {
    try {
      await fs.unlink(this.filePath(projectId));
    } catch {
      // already gone
    }
  }
}
```

---

## 6. Backend Endpoints

### File: `backend/routes/hook.ts`

All routes behind feature flag guard. All return JSON. All read `X-Model-Override` header.

#### 6.1 `POST /api/hook/clarify`

**Request**:
```json
{
  "projectId": "string",
  "seedInput": "string (first turn only)",
  "userSelection": {
    "type": "option | free_text | surprise_me",
    "optionId": "A (only when type=option)",
    "label": "the display text"
  }
}
```

**Validation**:
- First turn: `seedInput` required, `userSelection` absent.
- Subsequent turns: `userSelection` required.
- When `type === "option"`: validate `optionId` exists in previous turn's options.
- If status is `revealed` or `locked`: return `INVALID_INPUT` ("reset session first").

**Logic**:
1. Load or create `HookSessionState`.
2. First turn: store `seedInput`, set `currentState = {}`, `status = "clarifying"`, `rerollCount = 0`.
3. Subsequent turn: record `userSelection` on the previous turn entry.
4. Build clarifier prompt (§8).
5. Call LLM (role: `clarifier`, with `jsonSchema: HOOK_CLARIFIER_SCHEMA`). Parse JSON.
6. **If parse fails** (should be rare with structured outputs): retry once. Still fails → return `LLM_PARSE_ERROR`.
7. Merge `state_update` into `currentState`:
   - String fields: new value overwrites (only if non-empty).
   - `tone_chips`: append, deduplicate.
   - `bans`: append, deduplicate.
8. Append turn to `turns[]`.
9. **Hard cap**: if `turns.length >= 3` and `ready_for_hook` is false, force it to `true`.
10. Persist. Return `ClarifyResponse`.

#### 6.2 `POST /api/hook/generate`

**Request**: `{ "projectId": "string" }`

**Logic**:
1. Load session. Must have `seedInput` set. Set `status = "generating"`.
2. Build builder prompt from `seedInput` + `currentState` + turn history (§8).
3. **Tournament**: 3 parallel builder calls at temperatures 0.7, 0.9, 1.1 (with `jsonSchema: HOOK_BUILDER_SCHEMA`).
4. **Judge**: 3 parallel judge calls (with `jsonSchema: HOOK_JUDGE_SCHEMA`).
5. **Selection**:
   - Filter candidates where `pass === true`.
   - Multiple pass → highest average score across 5 dimensions.
   - None pass → fewest `hard_fail_reasons`.
6. Store `revealedHook` and `revealedJudge`. Set `status = "revealed"`. Set `rerollCount = 0`.
7. Persist. Return `GenerateResponse`.

#### 6.3 `POST /api/hook/reroll`

**Request**: `{ "projectId": "string" }`

**Logic**: Same as generate. Must be in `revealed` status. Increments `rerollCount`. No cap — unlimited rerolls.

#### 6.4 `POST /api/hook/lock`

**Request**:
```json
{
  "projectId": "string",
  "edits": {
    "premise": "optional override",
    "page_turn_trigger": "optional override"
  }
}
```

**Logic**:
1. Load session. Must be `revealed` with `revealedHook` present.
2. Apply edits (simple field overwrite on `revealedHook`).
3. Generate `state_summary` via LLM call (role: `summary`, §8.7).
4. Build `HookPack`:
   - `locked.premise` ← hook premise (edited or original)
   - `locked.page1_splash` ← hook `page_1_splash_prompt`
   - `locked.page_turn_trigger` ← hook trigger (edited or original)
   - `locked.core_engine` ← from `currentState` (fill empty strings for missing fields)
   - `preferences.tone_chips` ← `currentState.tone_chips ?? []`
   - `preferences.bans` ← `currentState.bans ?? []`
   - `source_dna` ← hook `collision_sources`
   - `open_threads` ← all `missing_signal` values from turns where `ready_for_hook` was false
   - `state_summary` ← LLM-generated summary
5. Set `status = "locked"`. Store `hookPack`. Persist. Return `HookPack`.

#### 6.5 `GET /api/hook/:projectId`

Load and return `HookSessionState`. Return `NOT_FOUND` if absent.

#### 6.6 `DELETE /api/hook/:projectId`

Delete session file. Return `{ deleted: true }`. Idempotent.

#### 6.7 `GET /api/models`

Return current `ModelConfig`.

#### 6.8 `PUT /api/models`

**Request**: Partial `ModelConfig`.
**Validation**: Each value must be in `SUPPORTED_MODELS`.
Updates in-memory config. Returns updated full config.

---

## 7. Backend Service Layer

### File: `backend/services/hookService.ts`

```typescript
export class HookService {
  constructor(
    private store: ProjectStore,
    private llm: LLMClient
  ) {}

  async runClarifierTurn(
    projectId: string,
    seedInput?: string,
    userSelection?: { type: "option" | "free_text" | "surprise_me"; optionId?: string; label: string },
    modelOverride?: string
  ): Promise<ClarifyResponse>

  async runTournament(
    projectId: string,
    modelOverride?: string
  ): Promise<GenerateResponse>

  async reroll(
    projectId: string,
    modelOverride?: string
  ): Promise<GenerateResponse>

  async lockHook(
    projectId: string,
    edits?: { premise?: string; page_turn_trigger?: string },
    modelOverride?: string
  ): Promise<HookPack>

  async getSession(projectId: string): Promise<HookSessionState | null>

  async resetSession(projectId: string): Promise<void>

  // ─── Internal ───

  private buildClarifierPrompt(session: HookSessionState): {
    system: string; user: string;
  }

  private buildBuilderPrompt(session: HookSessionState): {
    system: string; user: string;
  }

  private buildJudgePrompt(
    candidate: HookBuilderOutput, state: HookStateUpdate
  ): { system: string; user: string }

  private buildSummaryPrompt(session: HookSessionState): {
    system: string; user: string;
  }

  /**
   * Format prior turns for prompt injection.
   * Format: Q{n}: "{question}" → User chose [{optionId}]: "{label}"
   * Or: Q{n}: "{question}" → User chose: (surprise me)
   * Or: Q{n}: "{question}" → User typed: "{free text}"
   * Cap total at ~300 words.
   */
  private formatPriorTurns(turns: HookTurn[]): string

  private selectWinner(
    candidates: Array<{ hook: HookBuilderOutput; judge: HookJudgeOutput }>
  ): { hook: HookBuilderOutput; judge: HookJudgeOutput }

  /**
   * Merge rules:
   * - String fields: new overwrites old (only if new is non-empty)
   * - tone_chips: append, deduplicate
   * - bans: append, deduplicate
   */
  private mergeStateUpdate(
    current: HookStateUpdate, update: HookStateUpdate
  ): HookStateUpdate

  private parseAndValidate<T>(raw: string, requiredFields: string[]): T
}
```

---

## 8. Prompts (verbatim — `backend/services/hookPrompts.ts`)

Export each as a named `const string`.

### 8.1 `HOOK_CLARIFIER_SYSTEM`

```
You are HookClarifier: your job is to pull a strong story hook out of a vague idea with MINIMUM friction.

USER EXPERIENCE RULES:
- Ask EXACTLY ONE question.
- Provide 2–5 clickable options that meaningfully change the hook.
- Options are NOT limited to genre. Choose the dimension that best helps form a hook right now: stakes, taboo, protagonist role, opening image, antagonist, setting anchor, hook engine.
- Include at least: 1 fits-the-vibe option, 1 fresher/adjacent option, 1 left-field-but-plausible option.
- Keep everything short and punchy. No writing-school language. Never use: "theme," "motif," "thesis," "arc," "juxtaposition," "narrative."
- The question must spark imagination, not feel like a form.

ANTI-GENERIC RULES:
- Never use: "in a world where", "nothing is what it seems", "web of lies", "tension escalates", "dark secrets", "dangerous game", "everything changes."
- Force concreteness: at least one specific noun in hypothesis_line and in every option.

CONVERGENCE RULES:
- Always update hypothesis_line so it becomes more concrete each turn.
- Set ready_for_hook=true ONLY when you have: hook_engine + concrete stakes + drawable opening_image_seed. If any is vague or missing, keep ready_for_hook=false.
- Do NOT use probabilistic confidence. Use ready_for_hook boolean + missing_signal.

HANDLING "SURPRISE ME":
- If the user selected "surprise me": pick the most unexpected but coherent direction. Do NOT ask "what kind of surprise?" — just commit to a bold choice and reflect it in your state_update and hypothesis_line. Then ask your next question based on that choice.

SAFETY:
- Default non-graphic. If adult content, keep non-explicit and clearly consensual. Never depict coercion as erotic.

OUTPUT:
Return ONLY valid JSON matching the HookClarifier schema. No markdown fences. No commentary before or after.
```

### 8.2 `HOOK_CLARIFIER_USER_TEMPLATE`

```
You are helping a user find the hook they actually want.

Seed input: "{{USER_SEED}}"

Prior turns:
{{PRIOR_TURNS}}

Current draft state:
{{CURRENT_STATE_JSON}}

Banned phrases: {{BAN_LIST}}

Produce the next HookClarifier JSON.
```

**Template variables**:
- `{{USER_SEED}}` — user's original sentence, always included
- `{{PRIOR_TURNS}}` — output of `formatPriorTurns()`. Empty string on first turn.
- `{{CURRENT_STATE_JSON}}` — `JSON.stringify(currentState)` with null/undefined stripped
- `{{BAN_LIST}}` — `JSON.stringify(currentState.bans ?? [])`

### 8.3 `HOOK_BUILDER_SYSTEM`

```
You are HookBuilder. Use COLLISION + specificity to generate a hook that feels like it could only be THIS story.

COLLISION METHOD:
1. Pick 3–5 real sources (fiction, real events, subcultures, scandals, institutions). Don't pick broad pop culture references unless you extract a specific mechanism from them.
2. Extract ONE concrete structural element from each source: a loyalty test, recruitment ritual, punishment system, enforcement mechanism, transaction type, visual signature, or specific rule.
3. AT LEAST TWO of your extracted elements must be mechanisms (a rule, ritual, enforcement system, transaction, or proof system) — not aesthetics, tone, or visual style. Aesthetic-only extractions don't count toward the minimum.
4. Collide these elements into a premise that is not attributable to any single source.

HARD CONSTRAINTS:
- Premise must include at least 1 story-specific mechanism, object, ritual, or rule.
- opening_image and page_1_splash_prompt must describe DRAWABLE ACTION — a specific visual moment with a character doing something in a specific place. Not mood. Not theme.
- page_turn_trigger must be a CONCRETE EVENT that happens, not "tension rises" or "secrets emerge."
- Never use: "underground scene", "power dynamics", "web of lies", "dark secret", "everything changes", "nothing is what it seems."
- Respect all items in the ban list.

OUTPUT:
Return ONLY valid JSON matching the HookBuilder schema. No markdown fences. No commentary.
```

### 8.4 `HOOK_BUILDER_USER_TEMPLATE`

```
Generate a hook from this creative brief:

User's original idea: "{{USER_SEED}}"

Conversation so far:
{{PRIOR_TURNS}}

Accumulated creative state:
{{CURRENT_STATE_JSON}}

Banned phrases: {{BAN_LIST}}
Tone: {{TONE_CHIPS}}

Return ONLY the HookBuilder JSON.
```

### 8.5 `HOOK_JUDGE_SYSTEM`

```
You are HookJudge. Be mean. Your job is to prevent "competent but generic" hooks from shipping.

HARD-FAIL if ANY of these are true:
1. Premise is genre-average — it could describe dozens of stories, not just this one.
2. opening_image or page_1_splash_prompt is not a drawable action scene (no mood boards, no abstractions).
3. page_turn_trigger is generic: "danger escalates", "a secret is revealed", "everything changes", "they realize the truth."
4. No concrete mechanism — the story has no specific ritual, rule, object, enforcement system, or transaction that makes it unique.
5. collision_sources are a "vibe collage" — if the extracted elements are aesthetics, tones, or visual styles ("inspired by noir," "the loneliness of Blade Runner," "Twin Peaks weirdness") rather than concrete mechanisms (rules, rituals, enforcement systems, transactions, proof systems), hard-fail. At least 2 of the collision sources must extract a mechanism, not a vibe.

Score each 0–10: specificity, drawability, page_turn, mechanism, freshness.
Identify the most_generic_part (quote the weakest phrase from the hook).
Provide one_fix_instruction (one concrete action to improve it).

OUTPUT:
Return ONLY valid JSON: {"pass": bool, "hard_fail_reasons": [], "scores": {}, "most_generic_part": "...", "one_fix_instruction": "..."}
No markdown fences. No commentary.
```

### 8.6 `HOOK_JUDGE_USER_TEMPLATE`

```
Judge this hook candidate:
{{CANDIDATE_JSON}}

Story state context:
{{CURRENT_STATE_JSON}}

Return judgment JSON only.
```

### 8.7 `HOOK_SUMMARY_SYSTEM`

```
You are a concise creative summarizer. Given a hook development session (seed idea, conversation turns, final hook), produce a steering summary in 10–15 lines. This summary will guide future modules that build on this hook.

Include:
- The core premise and why it's specific (not generic)
- The key creative decisions made during clarification
- The mechanism/rule/ritual that makes this story unique
- Tone and what to avoid
- Any unresolved questions worth exploring later

Be direct. No fluff. No writing-school language.
```

### 8.8 `HOOK_SUMMARY_USER_TEMPLATE`

```
Seed: "{{USER_SEED}}"

Conversation turns:
{{PRIOR_TURNS}}

Final state:
{{CURRENT_STATE_JSON}}

Locked hook:
{{HOOK_JSON}}

Write the steering summary (10–15 lines).
```

---

## 9. JSON Schemas for Structured Outputs

### File: `backend/services/hookSchemas.ts`

```typescript
/**
 * JSON Schema definitions for Anthropic structured outputs.
 * These mirror the TypeScript interfaces in shared/types/hook.ts.
 * Passed to LLMClient.call() via the jsonSchema option.
 */

export const HOOK_CLARIFIER_SCHEMA = {
  type: "object",
  properties: {
    hypothesis_line: { type: "string" },
    question: { type: "string" },
    options: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          label: { type: "string" },
        },
        required: ["id", "label"],
        additionalProperties: false,
      },
      minItems: 2,
      maxItems: 5,
    },
    allow_free_text: { type: "boolean" },
    ready_for_hook: { type: "boolean" },
    missing_signal: { type: "string" },
    state_update: {
      type: "object",
      properties: {
        hook_engine: { type: "string" },
        stakes: { type: "string" },
        taboo_or_tension: { type: "string" },
        opening_image_seed: { type: "string" },
        setting_anchor: { type: "string" },
        protagonist_role: { type: "string" },
        antagonist_form: { type: "string" },
        tone_chips: { type: "array", items: { type: "string" } },
        bans: { type: "array", items: { type: "string" } },
      },
      additionalProperties: false,
    },
  },
  required: [
    "hypothesis_line", "question", "options",
    "allow_free_text", "ready_for_hook", "missing_signal", "state_update"
  ],
  additionalProperties: false,
} as const;

export const HOOK_BUILDER_SCHEMA = {
  type: "object",
  properties: {
    premise: { type: "string" },
    opening_image: { type: "string" },
    page_1_splash_prompt: { type: "string" },
    page_turn_trigger: { type: "string" },
    why_addictive: {
      type: "array",
      items: { type: "string" },
      minItems: 3,
      maxItems: 3,
    },
    collision_sources: {
      type: "array",
      items: {
        type: "object",
        properties: {
          source: { type: "string" },
          element_extracted: { type: "string" },
        },
        required: ["source", "element_extracted"],
        additionalProperties: false,
      },
      minItems: 3,
      maxItems: 5,
    },
  },
  required: [
    "premise", "opening_image", "page_1_splash_prompt",
    "page_turn_trigger", "why_addictive", "collision_sources"
  ],
  additionalProperties: false,
} as const;

export const HOOK_JUDGE_SCHEMA = {
  type: "object",
  properties: {
    pass: { type: "boolean" },
    hard_fail_reasons: {
      type: "array",
      items: { type: "string" },
    },
    scores: {
      type: "object",
      properties: {
        specificity: { type: "number" },
        drawability: { type: "number" },
        page_turn: { type: "number" },
        mechanism: { type: "number" },
        freshness: { type: "number" },
      },
      required: ["specificity", "drawability", "page_turn", "mechanism", "freshness"],
      additionalProperties: false,
    },
    most_generic_part: { type: "string" },
    one_fix_instruction: { type: "string" },
  },
  required: ["pass", "hard_fail_reasons", "scores", "most_generic_part", "one_fix_instruction"],
  additionalProperties: false,
} as const;
```

---

## 10. Frontend API Client

### File: `frontend/api/hookApi.ts`

```typescript
import type { ModelConfig } from "../../shared/modelConfig";
import type {
  HookClarifierResponse,
  HookBuilderOutput,
  HookSessionState,
  HookPack,
} from "../../shared/types/hook";
import type {
  ClarifyResponse,
  GenerateResponse,
} from "../../shared/types/api";

const BASE = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json();
  if (data.error) throw new Error(data.message);
  return data as T;
}

export const hookApi = {
  clarify: (body: {
    projectId: string;
    seedInput?: string;
    userSelection?: { type: string; optionId?: string; label: string };
  }) =>
    request<ClarifyResponse>("/hook/clarify", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  generate: (projectId: string) =>
    request<GenerateResponse>("/hook/generate", {
      method: "POST",
      body: JSON.stringify({ projectId }),
    }),

  reroll: (projectId: string) =>
    request<GenerateResponse>("/hook/reroll", {
      method: "POST",
      body: JSON.stringify({ projectId }),
    }),

  lock: (
    projectId: string,
    edits?: { premise?: string; page_turn_trigger?: string }
  ) =>
    request<HookPack>("/hook/lock", {
      method: "POST",
      body: JSON.stringify({ projectId, edits }),
    }),

  getSession: (projectId: string) =>
    request<HookSessionState>(`/hook/${projectId}`),

  reset: (projectId: string) =>
    request<{ deleted: true }>(`/hook/${projectId}`, { method: "DELETE" }),

  getModels: () => request<ModelConfig>("/models"),

  setModels: (config: Partial<ModelConfig>) =>
    request<ModelConfig>("/models", {
      method: "PUT",
      body: JSON.stringify(config),
    }),
};
```

---

## 11. Frontend Component

### File: `frontend/components/HookWorkshop.tsx`

Single-page React component. All phases render in the same view.

### 11.1 Component State

```typescript
interface HookWorkshopState {
  phase: "seed" | "clarifying" | "generating" | "revealed" | "locked";
  seedInput: string;
  hypothesisLine: string;
  question: string;
  options: HookClarifierOption[];
  allowFreeText: boolean;
  freeTextValue: string;
  showFreeTextInput: boolean;
  turnNumber: number;
  readyForHook: boolean;
  revealedHook: HookBuilderOutput | null;
  judgeInfo: {
    passed: boolean;
    hard_fail_reasons: string[];
    scores: HookJudgeScores;
    most_generic_part: string;
    one_fix_instruction: string;
  } | null;
  rerollCount: number;
  loading: boolean;
  loadingMessage: string;
  error: string | null;
  // Edit mode
  editing: boolean;
  editPremise: string;
  editTrigger: string;
}
```

### 11.2 UI Layout

```
┌──────────────────────────────────────────────────────────┐
│  ╔════════════════════════════════════════════════════╗   │
│  ║  HYPOTHESIS BANNER (hidden in seed phase)         ║   │
│  ║  "Here's how I see your hook shaping so far…"     ║   │
│  ║  {hypothesisLine}                                  ║   │
│  ╚════════════════════════════════════════════════════╝   │
│                                                          │
│  ── phase: "seed" ─────────────────────────────────────  │
│  "If you could write a story, what would you             │
│   want it to include?"                                   │
│  [ text input ............................... ] [ Go → ] │
│                                                          │
│  ── phase: "clarifying" ──────────────────────────────── │
│  {question}                      Question {n} of ~3      │
│                                                          │
│  [ Option A label               ]                        │
│  [ Option B label               ]                        │
│  [ Option C label               ]                        │
│  [ 🎲 Surprise me               ]                        │
│  [ ✏️  None of these             ]                       │
│       └─ (if clicked: inline free text + submit)         │
│                                                          │
│  ┌────────────────────────────────────┐                  │
│  │  ⚡ Generate hook now             │  ← always visible │
│  └────────────────────────────────────┘                  │
│                                                          │
│  ── phase: "generating" ─────────────────────────────    │
│  ⏳ "Building 3 hook candidates and judging them…"       │
│                                                          │
│  ── phase: "revealed" ───────────────────────────────    │
│  ┌──────────────────────────────────────────────┐        │
│  │ YOUR HOOK                                    │        │
│  │                                              │        │
│  │ PREMISE                                      │        │
│  │ {premise}                                    │        │
│  │                                              │        │
│  │ PAGE 1 SPLASH                                │        │
│  │ {page_1_splash_prompt}                       │        │
│  │                                              │        │
│  │ PAGE-TURN TRIGGER                            │        │
│  │ {page_turn_trigger}                          │        │
│  │                                              │        │
│  │ WHY IT'S ADDICTIVE                           │        │
│  │ • {bullet 1}                                 │        │
│  │ • {bullet 2}                                 │        │
│  │ • {bullet 3}                                 │        │
│  │                                              │        │
│  │ ▸ Sources (collapsible)                      │        │
│  │   {source} → {element_extracted}             │        │
│  └──────────────────────────────────────────────┘        │
│                                                          │
│  {if !judge.passed: amber warning banner}                │
│  ⚠️ Judge didn't fully pass this hook:                   │
│  • {hard_fail_reasons[0]}                                │
│  • {hard_fail_reasons[1]}                                │
│  Weakest part: "{most_generic_part}"                     │
│  Suggestion: {one_fix_instruction}                       │
│                                                          │
│  [ 🔄 Reroll ]  [ ✏️ Edit & Lock ]  [ ✅ Lock it ]     │
│                                                          │
│  ── phase: "locked" ─────────────────────────────────    │
│  ✅ Hook locked                                          │
│  (same card, non-editable, with "Start over" button)     │
└──────────────────────────────────────────────────────────┘
```

### 11.3 Interaction Flow

1. **Seed** → user types sentence → Go → `POST /api/hook/clarify` with `seedInput`.
2. **Clarifying** → response populates banner + question + options.
   - Click option → `POST /api/hook/clarify` with `{ type: "option", optionId: "A", label: "..." }`.
   - Click "Surprise me" → `POST /api/hook/clarify` with `{ type: "surprise_me", label: "surprise_me" }`.
   - Click "None of these" → show inline text input → submit → `POST /api/hook/clarify` with `{ type: "free_text", label: "user's text" }`.
   - Click "Generate hook now" → `POST /api/hook/generate`.
   - If response has `ready_for_hook === true` → auto-call `/api/hook/generate`.
3. **Generating** → spinner + loading message.
4. **Revealed** → show card + judge info (including hard_fail_reasons if any).
   - Reroll → `POST /api/hook/reroll`.
   - Edit & Lock → toggle inline editing on premise + trigger fields → save calls `POST /api/hook/lock` with edits.
   - Lock it → `POST /api/hook/lock` with no edits.
5. **Locked** → show final card. "Start over" → `DELETE /api/hook/:projectId` → reset to seed phase.

### 11.4 UX Details

- **Hypothesis banner**: CSS fade transition on text change. Hidden during seed phase.
- **Turn counter**: "Question 1 of ~3" — subtle, right-aligned.
- **Generate now button**: secondary style until `readyForHook` is true → promoted to primary.
- **Loading**: clarifier ~2-3s, tournament ~5-8s with distinct messages.
- **Errors**: "Something went wrong" + retry button. Clears on next action.
- **Collision sources**: collapsed by default in reveal, expandable toggle.
- **Judge warnings**: amber banner between hook card and action buttons. Shown only when `judge.passed === false`. User can still lock, reroll, or edit.

---

## 12. Project Config

### `package.json`

```json
{
  "name": "story-architect",
  "private": true,
  "scripts": {
    "dev:backend": "tsx watch backend/index.ts",
    "dev:frontend": "vite",
    "dev": "concurrently \"npm run dev:backend\" \"npm run dev:frontend\""
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "express": "^4.21.0",
    "cors": "^2.8.5",
    "dotenv": "^16.4.0"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/cors": "^2.8.17",
    "typescript": "^5.7.0",
    "tsx": "^4.19.0",
    "vite": "^6.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "concurrently": "^9.1.0"
  }
}
```

### `.env.example`

```bash
ANTHROPIC_API_KEY=sk-ant-...
HOOK_MODULE_ENABLED=true

# Optional: override models per role (defaults to claude-sonnet-4-6)
# HOOK_MODEL_CLARIFIER=claude-sonnet-4-6
# HOOK_MODEL_BUILDER=claude-sonnet-4-6
# HOOK_MODEL_JUDGE=claude-sonnet-4-6
# HOOK_MODEL_SUMMARY=claude-haiku-4-5-20251001
```

### `vite.config.ts`

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: "frontend",
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
});
```

### `backend/index.ts`

```typescript
import "dotenv/config"; // MUST be first import
import express from "express";
import cors from "cors";
import { hookRoutes } from "./routes/hook";
import { modelRoutes } from "./routes/models";

const app = express();
app.use(cors());
app.use(express.json());
app.use("/api/hook", hookRoutes);
app.use("/api", modelRoutes);

const PORT = process.env.PORT ?? 3001;
app.listen(PORT, () => console.log(`Backend running on :${PORT}`));
```

---

## 13. API Call Patterns

```typescript
// Clarifier: 1 call per turn, structured output
llm.call("clarifier", HOOK_CLARIFIER_SYSTEM, filledUserPrompt, {
  temperature: 0.7,
  maxTokens: 800,
  modelOverride,
  jsonSchema: HOOK_CLARIFIER_SCHEMA,
});

// Builder tournament: 3 parallel, varied temperatures, structured output
const temperatures = [0.7, 0.9, 1.1];
const candidates = await Promise.all(
  temperatures.map((temp) =>
    llm.call("builder", HOOK_BUILDER_SYSTEM, filledBuilderPrompt, {
      temperature: temp,
      modelOverride,
      jsonSchema: HOOK_BUILDER_SCHEMA,
    })
  )
);

// Judge: 3 parallel (one per candidate), structured output
const judgments = await Promise.all(
  parsedCandidates.map((c) =>
    llm.call("judge", HOOK_JUDGE_SYSTEM, filledJudgePrompt(c), {
      temperature: 0.3,
      modelOverride,
      jsonSchema: HOOK_JUDGE_SCHEMA,
    })
  )
);

// Summary: 1 call on lock (no structured output needed — free text)
llm.call("summary", HOOK_SUMMARY_SYSTEM, filledSummaryPrompt, {
  temperature: 0.5,
  maxTokens: 600,
  modelOverride,
});
```

**Total LLM calls per full flow**: 1–3 clarifier + 3 builder + 3 judge + 1 summary = **8–10 max**.

---

## 14. Verification Checklist

### Build
- [ ] `npm install` succeeds
- [ ] `npm run dev` starts backend (3001) and frontend (5173)
- [ ] `shared/types/hook.ts` compiles cleanly
- [ ] Frontend does not import backend modules or `process.env`

### Smoke tests (curl — see §0 Step 4 & 5 for copy-paste commands)
- [ ] Full flow: clarify → clarify → generate → lock
- [ ] Immediate generation: clarify once → generate
- [ ] Surprise me: sends surprise_me selection, gets bold direction back
- [ ] Hard cap: 3 clarifier turns forces ready_for_hook=true
- [ ] Reroll: generates different hook each time
- [ ] Edit & Lock: edited premise persists in HookPack
- [ ] Reset: DELETE clears session, GET returns NOT_FOUND
- [ ] Model switching: PUT changes config, X-Model-Override works per-request
- [ ] Feature flag off: returns FEATURE_DISABLED 404

### Frontend
- [ ] Seed input → Go → banner + question + options appear
- [ ] Clicking option → new question, banner updates
- [ ] "Generate hook now" → loading → reveal card
- [ ] Judge warnings show when hook doesn't pass (hard_fail_reasons visible)
- [ ] Reroll works
- [ ] Edit & Lock → can edit premise and trigger → lock persists
- [ ] "Start over" in locked phase → reset to seed
- [ ] Refresh in locked phase → loads saved state

---

## 15. Constraints & Non-Goals

**In scope**: Hook module. Seed → Clarify → Build → Judge → Lock.

**Out of scope** (don't implement):
- Theme / setting / character / plot modules
- Multi-chapter structure
- Image generation
- Auth / user accounts
- Database (file storage is fine)
- Reroll cap (unlimited)

**Hard rules**:
- Max 3 clarifier turns (hard cap, force ready_for_hook)
- User can always force generation at any point
- No probabilistic confidence — boolean ready_for_hook only
- No literary jargon in user-facing text
- "Surprise me" on every clarifier turn with explicit LLM handling
- HookJudge hard-fails generic hooks and vibe-collage collision sources
- Model switchable at runtime per role or per request
- Structured outputs used for all JSON-returning LLM calls (Clarifier, Builder, Judge)
- Summary call uses free text (no structured output needed)
