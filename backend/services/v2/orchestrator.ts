/**
 * v2 Orchestrator — Project State Machine
 *
 * Drives the 6-step flow. Validates transitions, manages abort signals,
 * coordinates batch operations with checkpointing.
 */

import { randomUUID } from "crypto";
import type {
  ProjectState, ProjectId, OperationId,
  Step1_IdeaGathering, Step2_PremiseGenerating,
  Step3_PremiseReview, Step4_BibleGenerating,
  Step5_SceneReview, Step6_SceneGenerating,
  StepCompleted, StepFailed, StepAborted,
} from "../../../shared/types/project";
import { createProjectId, createOperationId } from "../../../shared/types/project";
import type { PremiseArtifact, StoryBibleArtifact, ScenePlanArtifact, GeneratedScene } from "../../../shared/types/artifacts";
import { ProjectStoreV2 } from "../../storage/v2/projectStoreV2";
import { ensureLedgerShape } from "../psychologyEngine";

// ── Abort controller registry (per-project) ────────────────────────

const abortControllers = new Map<string, AbortController>();

export function getAbortSignal(projectId: string): AbortSignal | undefined {
  return abortControllers.get(projectId)?.signal;
}

export function registerAbort(projectId: string): AbortController {
  // Cancel any existing operation first
  const existing = abortControllers.get(projectId);
  if (existing) existing.abort();

  const controller = new AbortController();
  abortControllers.set(projectId, controller);
  return controller;
}

export function abortProject(projectId: string): boolean {
  const controller = abortControllers.get(projectId);
  if (controller) {
    controller.abort();
    abortControllers.delete(projectId);
    return true;
  }
  return false;
}

export function clearAbort(projectId: string): void {
  abortControllers.delete(projectId);
}

// ── Orchestrator ────────────────────────────────────────────────────

export class Orchestrator {
  constructor(private store: ProjectStoreV2) {}

  // ── Project lifecycle ───────────────────────────────────────────

  async createProject(seedInput?: string, culturalContext?: string, mode?: string): Promise<Step1_IdeaGathering> {
    const projectId = createProjectId(`v2_${randomUUID()}`);
    const now = new Date().toISOString();

    const project: Step1_IdeaGathering = {
      step: "idea_gathering",
      projectId,
      createdAt: now,
      updatedAt: now,
      traces: [],
      psychologyLedger: ensureLedgerShape({} as any),
      constraintLedger: [],
      culturalInsights: [],
      seedInput: seedInput ?? null,
      conversationTurns: [],
      culturalContext,
      mode: (mode as any) ?? "default",
    };

    await this.store.save(project);
    return project;
  }

  async getProject(projectId: ProjectId): Promise<ProjectState | null> {
    return this.store.get(projectId);
  }

  async deleteProject(projectId: ProjectId): Promise<void> {
    abortProject(projectId);
    await this.store.delete(projectId);
  }

  // ── Step transitions ────────────────────────────────────────────

  async transitionToPremiseGenerating(
    projectId: ProjectId,
    current: Step1_IdeaGathering,
  ): Promise<Step2_PremiseGenerating> {
    // Derive seed from conversation if not explicitly set
    const seedInput = current.seedInput
      ?? current.conversationTurns[0]?.userInput
      ?? null;

    if (!seedInput) {
      throw new Error("Cannot generate premise without seed input or conversation");
    }

    const next: Step2_PremiseGenerating = {
      ...current,
      step: "premise_generating",
      operationId: createOperationId(randomUUID()),
      seedInput,
    };
    await this.store.transition(projectId, next);
    return next;
  }

  // All transitions use spread (...current) so that any field on ProjectBase
  // (like `mode`) is automatically carried forward. This prevents silent field
  // loss when new base fields are added in the future.

  async transitionToPremiseReview(
    projectId: ProjectId,
    current: Step2_PremiseGenerating,
    premise: PremiseArtifact,
  ): Promise<Step3_PremiseReview> {
    const next: Step3_PremiseReview = {
      ...current,
      step: "premise_review",
      updatedAt: new Date().toISOString(),
      premise,
      reviewRound: 0,
      reviewTurns: [],
    };
    await this.store.transition(projectId, next);
    return next;
  }

  async transitionToBibleGenerating(
    projectId: ProjectId,
    current: Step3_PremiseReview,
  ): Promise<Step4_BibleGenerating> {
    if (current.premise.state !== "approved") {
      throw new Error("Cannot generate bible: premise not approved");
    }

    const next: Step4_BibleGenerating = {
      ...current,
      step: "bible_generating",
      updatedAt: new Date().toISOString(),
      operationId: createOperationId(randomUUID()),
      premise: current.premise,
      checkpoint: { completedSubSteps: [] },
    };
    await this.store.transition(projectId, next);
    return next;
  }

  async transitionToSceneReview(
    projectId: ProjectId,
    current: Step4_BibleGenerating,
    storyBible: StoryBibleArtifact,
    scenePlan: ScenePlanArtifact,
  ): Promise<Step5_SceneReview> {
    const next: Step5_SceneReview = {
      ...current,
      step: "scene_review",
      updatedAt: new Date().toISOString(),
      premise: current.premise,
      storyBible,
      scenePlan,
      reviewTurns: [],
    };
    await this.store.transition(projectId, next);
    return next;
  }

  async transitionToSceneGenerating(
    projectId: ProjectId,
    current: Step5_SceneReview,
  ): Promise<Step6_SceneGenerating> {
    if (current.scenePlan.state !== "approved" && current.scenePlan.state !== "draft") {
      throw new Error("Cannot generate scenes: scene plan in invalid state");
    }

    const next: Step6_SceneGenerating = {
      ...current,
      step: "scene_generating",
      updatedAt: new Date().toISOString(),
      operationId: createOperationId(randomUUID()),
      premise: current.premise,
      storyBible: { ...current.storyBible, state: "approved" },
      scenePlan: { ...current.scenePlan, state: "approved" },
      generatedScenes: [],
      checkpoint: {
        totalScenes: current.scenePlan.scenes.length,
        completedSceneIds: [],
      },
    };
    await this.store.transition(projectId, next);
    return next;
  }

  async transitionToCompleted(
    projectId: ProjectId,
    current: Step6_SceneGenerating,
    scenes: GeneratedScene[],
  ): Promise<StepCompleted> {
    const next: StepCompleted = {
      ...current,
      step: "completed",
      updatedAt: new Date().toISOString(),
      scenes,
    };
    await this.store.transition(projectId, next);
    clearAbort(projectId as string);
    return next;
  }

  async transitionToFailed(
    projectId: ProjectId,
    current: ProjectState,
    error: string,
  ): Promise<StepFailed> {
    const next: StepFailed = {
      ...current,
      step: "failed",
      updatedAt: new Date().toISOString(),
      failedAt: current.step,
      error,
      recoverySnapshot: JSON.stringify(current),
    };
    await this.store.transition(projectId, next);
    clearAbort(projectId as string);
    return next;
  }

  async transitionToAborted(
    projectId: ProjectId,
    current: ProjectState,
  ): Promise<StepAborted> {
    const next: StepAborted = {
      ...current,
      step: "aborted",
      updatedAt: new Date().toISOString(),
      abortedDuring: current.step,
    };
    await this.store.transition(projectId, next);
    clearAbort(projectId as string);
    return next;
  }

  // ── Retry from failure ───────────────────────────────────────

  async retryFromFailure(
    projectId: ProjectId,
    current: StepFailed,
  ): Promise<ProjectState> {
    // Restore the state the project was in when it failed
    let restored: ProjectState;
    try {
      restored = JSON.parse(current.recoverySnapshot) as ProjectState;
    } catch {
      throw new Error("Cannot retry: recovery snapshot is invalid");
    }

    // Ensure the restored state has the right projectId and metadata
    restored.projectId = current.projectId;
    restored.createdAt = current.createdAt;
    restored.updatedAt = new Date().toISOString();
    restored.traces = current.traces;
    restored.psychologyLedger = current.psychologyLedger;
    restored.constraintLedger = current.constraintLedger;
    restored.culturalInsights = current.culturalInsights;

    // Save directly (bypass transition validation — we're restoring)
    await this.store.save(restored);
    return restored;
  }

  // ── Checkpoint helpers ──────────────────────────────────────────

  async saveCheckpoint(projectId: ProjectId, state: ProjectState): Promise<void> {
    await this.store.save(state);
  }
}
