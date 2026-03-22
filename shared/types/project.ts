/**
 * Story Architect v2 — Project State Machine
 *
 * The project is a discriminated union on the `step` field.
 * Each step carries exactly the data available at that point.
 * The persistence layer rejects writes that don't match the schema
 * for the declared state.
 */

import type { UserPsychologyLedger } from "./userPsychology";
import type { ConstraintLedgerEntry } from "./hook";
import type { CreativeInsight } from "./cultural";

// ── Branded UUID types ──────────────────────────────────────────────

declare const __brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [__brand]: B };

export type ProjectId = Brand<string, "ProjectId">;
export type OperationId = Brand<string, "OperationId">;

export function createProjectId(raw: string): ProjectId {
  return raw as ProjectId;
}

export function createOperationId(raw: string): OperationId {
  return raw as OperationId;
}

// ── Artifact lifecycle ──────────────────────────────────────────────

export type ArtifactState =
  | "draft"
  | "approved"
  | "completed"
  | "failed"
  | "aborted"
  | "partial_accepted";

// ── LLM call trace (every call logs one) ────────────────────────────

export interface StepTrace {
  operationId: OperationId;
  role: string;
  templateVersion: string;       // sha256 of prompt template (first 16 chars)
  schemaVersion: number;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  durationMs: number;
  judgeOutcome?: "pass" | "fail_repaired" | "fail_accepted";
  retryCount: number;
  timestamp: string;             // ISO
}

// ── Batch progress (Steps 2, 4, 6) ─────────────────────────────────

export interface BatchProgress {
  totalSteps: number;
  completedSteps: number;
  currentStep: string;           // human-readable: "Writing world...", "Scene 3 of 8..."
  startedAt: string;
}

// ── Conversation turns ──────────────────────────────────────────────

export interface IntakeAssumption {
  id: string;
  category: string;
  assumption: string;
  alternatives: string[];
}

export interface IntakeTurn {
  turnNumber: number;
  userInput: string;
  systemResponse: {
    question?: string;
    assumptions: IntakeAssumption[];
    readyForPremise: boolean;
    readiness_note: string;
  };
}

export interface ReviewTurn {
  turnNumber: number;
  action: "approve" | "revise" | "skip";
  userFeedback?: string;
  inlineEdits?: Record<string, string>;
}

// ── Sub-step checkpoint (for Step 4 bible generation) ───────────────

export type BibleSubStep = "world" | "characters" | "plot" | "judge" | "scene_plan";

export interface BibleCheckpoint {
  completedSubSteps: BibleSubStep[];
  failedAt?: BibleSubStep;
  error?: string;
}

// ── Scene generation checkpoint ─────────────────────────────────────

export interface SceneCheckpoint {
  totalScenes: number;
  completedSceneIds: string[];
  failedSceneId?: string;
  error?: string;
}

// ── The project state machine (discriminated union on `step`) ───────

interface ProjectBase {
  projectId: ProjectId;
  createdAt: string;
  updatedAt: string;
  traces: StepTrace[];
  psychologyLedger: UserPsychologyLedger;
  constraintLedger: ConstraintLedgerEntry[];
  culturalInsights: CreativeInsight[];
}

// Step 1: User tells us about their story
export interface Step1_IdeaGathering extends ProjectBase {
  step: "idea_gathering";
  seedInput: string | null;
  conversationTurns: IntakeTurn[];
  culturalContext?: string;
}

// Step 2: System generates premise (batch)
export interface Step2_PremiseGenerating extends ProjectBase {
  step: "premise_generating";
  operationId: OperationId;
  seedInput: string;
  conversationTurns: IntakeTurn[];
  culturalContext?: string;
}

// Step 3: User reviews the premise
export interface Step3_PremiseReview extends ProjectBase {
  step: "premise_review";
  premise: import("./artifacts").PremiseArtifact;
  reviewRound: number;               // 0-3
  reviewTurns: ReviewTurn[];
}

// Step 4: System generates bible (batch: world → chars → plot → judge → plan)
export interface Step4_BibleGenerating extends ProjectBase {
  step: "bible_generating";
  operationId: OperationId;
  premise: import("./artifacts").PremiseArtifact;
  checkpoint: BibleCheckpoint;
}

// Step 5: User reviews scene plan
export interface Step5_SceneReview extends ProjectBase {
  step: "scene_review";
  premise: import("./artifacts").PremiseArtifact;
  storyBible: import("./artifacts").StoryBibleArtifact;
  scenePlan: import("./artifacts").ScenePlanArtifact;
  reviewTurns: ReviewTurn[];
}

// Step 6: System generates scenes (batch)
export interface Step6_SceneGenerating extends ProjectBase {
  step: "scene_generating";
  operationId: OperationId;
  premise: import("./artifacts").PremiseArtifact;
  storyBible: import("./artifacts").StoryBibleArtifact;
  scenePlan: import("./artifacts").ScenePlanArtifact;
  generatedScenes: import("./artifacts").GeneratedScene[];
  checkpoint: SceneCheckpoint;
}

// Terminal: all done
export interface StepCompleted extends ProjectBase {
  step: "completed";
  premise: import("./artifacts").PremiseArtifact;
  storyBible: import("./artifacts").StoryBibleArtifact;
  scenePlan: import("./artifacts").ScenePlanArtifact;
  scenes: import("./artifacts").GeneratedScene[];
}

// Terminal: something failed
export interface StepFailed extends ProjectBase {
  step: "failed";
  failedAt: string;
  error: string;
  /** Serialized previous state for recovery */
  recoverySnapshot: string;
}

// Terminal: user aborted
export interface StepAborted extends ProjectBase {
  step: "aborted";
  abortedDuring: string;
}

// The discriminated union
export type ProjectState =
  | Step1_IdeaGathering
  | Step2_PremiseGenerating
  | Step3_PremiseReview
  | Step4_BibleGenerating
  | Step5_SceneReview
  | Step6_SceneGenerating
  | StepCompleted
  | StepFailed
  | StepAborted;

// ── Valid transitions ───────────────────────────────────────────────

const VALID_TRANSITIONS: Record<ProjectState["step"], ProjectState["step"][]> = {
  idea_gathering: ["premise_generating", "failed", "aborted"],
  premise_generating: ["premise_review", "failed", "aborted"],
  premise_review: ["premise_generating", "bible_generating", "failed", "aborted"],
  bible_generating: ["scene_review", "failed", "aborted"],
  scene_review: ["bible_generating", "scene_generating", "failed", "aborted"],
  scene_generating: ["completed", "failed", "aborted"],
  completed: [],
  failed: ["idea_gathering", "premise_generating", "bible_generating", "scene_generating"],
  aborted: ["idea_gathering"],
};

export function isValidTransition(from: ProjectState["step"], to: ProjectState["step"]): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function getValidTransitions(from: ProjectState["step"]): ProjectState["step"][] {
  return VALID_TRANSITIONS[from] ?? [];
}
