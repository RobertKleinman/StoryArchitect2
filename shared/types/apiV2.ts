/**
 * Story Architect v2 — API Request/Response Types
 */

import type { ProjectState, BatchProgress } from "./project";
import type { PremiseArtifact, StoryBibleArtifact, ScenePlanArtifact, GeneratedScene } from "./artifacts";

// ── Project CRUD ────────────────────────────────────────────────────

export interface CreateProjectRequest {
  seedInput?: string;
  culturalContext?: string;
}

export interface CreateProjectResponse {
  projectId: string;
}

export interface GetProjectResponse {
  project: ProjectState;
}

// ── Step 1: Intake ──────────────────────────────────────────────────

export interface IntakeRequest {
  seedInput?: string;
  userResponse?: string;
  assumptionResponses?: Array<{
    assumptionId: string;
    action: "keep" | "change";
    newValue?: string;
  }>;
  culturalContext?: string;
}

export interface IntakeResponse {
  question?: string;
  assumptions: Array<{
    id: string;
    category: string;
    assumption: string;
    alternatives: string[];
  }>;
  readyForPremise: boolean;
  readiness_note: string;
  turnNumber: number;
}

// ── Step 2: Generate Premise ────────────────────────────────────────

export interface GeneratePremiseResponse {
  operationId: string;
}

export interface GetPremiseResponse {
  status: "generating" | "complete" | "failed";
  premise?: PremiseArtifact;
  error?: string;
  progress?: BatchProgress;
}

// ── Step 3: Premise Review ──────────────────────────────────────────

export interface ReviewPremiseRequest {
  action: "approve" | "revise";
  changes?: string;
  inlineEdits?: Record<string, string>;
}

export interface ReviewPremiseResponse {
  approved: boolean;
  premise?: PremiseArtifact;
  reviewRound: number;
}

// ── Step 4: Generate Bible ──────────────────────────────────────────

export interface GenerateBibleResponse {
  operationId: string;
}

export interface GetBibleResponse {
  status: "generating" | "complete" | "failed";
  storyBible?: StoryBibleArtifact;
  scenePlan?: ScenePlanArtifact;
  error?: string;
  progress?: BatchProgress;
}

// ── Step 5: Scene Plan Review ───────────────────────────────────────

export interface ScenePlanEdit {
  scene_id: string;
  action: "modify" | "remove" | "reorder";
  changes?: Record<string, string>;
  newPosition?: number;
}

export interface ReviewScenesRequest {
  action: "approve" | "revise" | "skip";
  changes?: ScenePlanEdit[];
  feedback?: string;
}

export interface ReviewScenesResponse {
  approved: boolean;
  scenePlan?: ScenePlanArtifact;
}

// ── Step 6: Generate Scenes ─────────────────────────────────────────

export interface GenerateScenesResponse {
  operationId: string;
}

export interface GetScenesResponse {
  status: "generating" | "complete" | "failed";
  scenes: GeneratedScene[];
  error?: string;
  progress?: BatchProgress;
}

// ── SSE Event Types ─────────────────────────────────────────────────

export type SSEEvent =
  | { type: "progress"; data: BatchProgress }
  | { type: "scene_complete"; data: { scene_id: string; index: number; total: number } }
  | { type: "step_complete"; data: { step: ProjectState["step"] } }
  | { type: "error"; data: { message: string; step: string } }
  | { type: "aborted"; data: { step: string } };
