/**
 * Agent Pipeline — state manager.
 *
 * Persists an AgentProject (wrapping the real ProjectState discriminated
 * union plus an orchestrator-only extension for draft artifacts that
 * don't fit cleanly in the canonical state). One JSON file per project,
 * atomic writes via tmp + rename. Separate data namespace (data/v2-agent/)
 * so nothing collides with the real v2 backend.
 */

import { promises as fs } from "fs";
import { join, dirname, normalize, resolve } from "path";
import { randomUUID } from "crypto";

import type {
  ProjectState,
  Step1_IdeaGathering,
  ProjectId,
  GenerationMode,
} from "../../shared/types/project";
import { createProjectId, isValidTransition } from "../../shared/types/project";
import { createEmptyLedger } from "../../shared/types/userPsychology";

// ── Paths ────────────────────────────────────────────────────────────

const DATA_DIR = join(process.cwd(), "data", "v2-agent");
const AGENT_ID_RE = /^agt_[0-9a-f-]{36}$/i;

function assertSafeProjectId(projectId: string): void {
  if (!AGENT_ID_RE.test(projectId)) {
    throw new Error(`Invalid agent project ID: ${projectId}`);
  }
}

function safeJoin(...segments: string[]): string {
  const resolved = resolve(normalize(join(...segments)));
  const dataDirResolved = resolve(DATA_DIR);
  if (!resolved.startsWith(dataDirResolved)) {
    throw new Error(`Path traversal detected: ${resolved} escapes ${dataDirResolved}`);
  }
  return resolved;
}

export function projectPath(projectId: string): string {
  assertSafeProjectId(projectId);
  return safeJoin(DATA_DIR, `${projectId}.json`);
}

export function rawDir(projectId: string): string {
  assertSafeProjectId(projectId);
  return safeJoin(DATA_DIR, projectId, "raw");
}

// ── Orchestrator extension (transient drafts) ───────────────────────

export interface AgentExtension {
  // Phase 1: premise
  draftPremise?: unknown;            // writer output before judge
  premiseJudge?: {
    pass: boolean;
    issues: Array<{ field: string; problem: string; fix_instruction: string }>;
    constraint_violations: string[];
  };
  premiseRepairAttempted?: boolean;

  // Phase 2: bible
  bibleJudgeResult?: {
    pass: boolean;
    consistency_issues: Array<{ section: string; issue: string; severity: string; fix_instruction: string }>;
    quality_issues: Array<{ dimension: string; issue: string; severity: string; fix_instruction: string }>;
    constraint_violations: string[];
  };
  // NOTE: bibleJudgeAttempts moved to checkpoint.judgeAttempts so resumed projects
  // preserve the retry counter. Do not add it back to this extension.
  sensoryPaletteData?: unknown;
  sensoryPaletteDone?: boolean;
  stepBackContext?: string;
  stepBackDone?: boolean;
  scenePlanData?: unknown;

  // Phase 3: scenes
  /** Tension state accumulated across scenes (real type: TensionState) */
  tensionState?: {
    relationships: Record<string, { current: string; trajectory: string; last_shift: string }>;
    unresolved_threads: string[];
    emotional_temperature: number;
    register_history: string[];
    what_the_reader_knows: string[];
    what_hasnt_broken_yet: string[];
    scene_count: number;
    used_phrases: string[];
  };
  /** Sensory descriptor frequency tracker (deterministic) */
  descriptorTracker?: unknown;
  /** Which scene plan index we're currently generating (0-based) */
  currentSceneIndex?: number;
  /** Per-scene substep */
  sceneSubstep?:
    | "writer_a"
    | "judge_a"
    | "writer_b"
    | "judge_b"
    | "tension_update"
    | "done";
  /** Scene-writer retries performed in response to judge rejection (0-2). Per-scene, resets on commit. */
  sceneJudgeRetries?: number;
  /** Candidate A: first writer+judge pass on current scene */
  candidateA?: {
    vnScene: any;
    readable: any;
    judgeResult?: any;
    vitalityScore?: number;
  };
  /** Candidate B: optional second roll if vitality was marginal */
  candidateB?: {
    vnScene: any;
    readable: any;
    judgeResult?: any;
    vitalityScore?: number;
  };
}

export interface AgentProject {
  state: ProjectState;
  extension: AgentExtension;
}

// ── Init ─────────────────────────────────────────────────────────────

const VALID_MODES: readonly GenerationMode[] = [
  "default", "fast", "erotica", "erotica-fast", "erotica-hybrid", "haiku",
] as const;

export function isValidMode(m: string): m is GenerationMode {
  return (VALID_MODES as readonly string[]).includes(m);
}

export function newProject(seedInput: string, projectId?: string, mode?: GenerationMode): AgentProject {
  const id = projectId ?? `agt_${randomUUID()}`;
  const now = new Date().toISOString();
  const step1: Step1_IdeaGathering = {
    step: "idea_gathering",
    projectId: createProjectId(id),
    createdAt: now,
    updatedAt: now,
    traces: [],
    psychologyLedger: createEmptyLedger(),
    constraintLedger: [],
    culturalInsights: [],
    mode: mode ?? "default",
    seedInput,
    conversationTurns: [],
  };
  return { state: step1, extension: {} };
}

// ── Load / save ──────────────────────────────────────────────────────

export async function loadProject(projectId: string): Promise<AgentProject> {
  const path = projectPath(projectId);
  const raw = await fs.readFile(path, "utf8");
  const parsed = JSON.parse(raw) as AgentProject;
  if (!parsed.state || !parsed.extension) {
    throw new Error(`Invalid project file at ${path} — missing state or extension`);
  }
  return parsed;
}

export async function saveProject(project: AgentProject): Promise<void> {
  const id = project.state.projectId as string;
  project.state.updatedAt = new Date().toISOString();
  const path = projectPath(id);
  await fs.mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(project, null, 2), "utf8");
  await fs.rename(tmp, path);
}

export async function saveRawOutput(
  projectId: string,
  role: string,
  content: string,
): Promise<string> {
  const dir = rawDir(projectId);
  await fs.mkdir(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join(dir, `${role}-${ts}.json`);
  await fs.writeFile(path, content, "utf8");
  return path;
}

// ── Transitions ──────────────────────────────────────────────────────

export function assertTransition(
  from: ProjectState["step"],
  to: ProjectState["step"],
): void {
  if (!isValidTransition(from, to)) {
    throw new Error(`Invalid transition: ${from} → ${to}`);
  }
}
