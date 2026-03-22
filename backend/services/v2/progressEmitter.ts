/**
 * v2 Progress Emitter
 *
 * EventEmitter for streaming batch progress to SSE clients.
 * One emitter per project, keyed by projectId.
 */

import { EventEmitter } from "events";
import type { BatchProgress } from "../../../shared/types/project";
import type { SSEEvent } from "../../../shared/types/apiV2";

const emitters = new Map<string, EventEmitter>();

export function getProjectEmitter(projectId: string): EventEmitter {
  let emitter = emitters.get(projectId);
  if (!emitter) {
    emitter = new EventEmitter();
    emitter.setMaxListeners(10);
    emitters.set(projectId, emitter);
  }
  return emitter;
}

export function emitProgress(projectId: string, progress: BatchProgress): void {
  const emitter = emitters.get(projectId);
  if (emitter) {
    const event: SSEEvent = { type: "progress", data: progress };
    emitter.emit("sse", event);
  }
}

export function emitSceneComplete(projectId: string, sceneId: string, index: number, total: number): void {
  const emitter = emitters.get(projectId);
  if (emitter) {
    const event: SSEEvent = { type: "scene_complete", data: { scene_id: sceneId, index, total } };
    emitter.emit("sse", event);
  }
}

export function emitStepComplete(projectId: string, step: string): void {
  const emitter = emitters.get(projectId);
  if (emitter) {
    const event: SSEEvent = { type: "step_complete", data: { step: step as any } };
    emitter.emit("sse", event);
  }
}

export function emitError(projectId: string, message: string, step: string): void {
  const emitter = emitters.get(projectId);
  if (emitter) {
    const event: SSEEvent = { type: "error", data: { message, step } };
    emitter.emit("sse", event);
  }
}

export function emitAborted(projectId: string, step: string): void {
  const emitter = emitters.get(projectId);
  if (emitter) {
    const event: SSEEvent = { type: "aborted", data: { step } };
    emitter.emit("sse", event);
  }
}

export function cleanupEmitter(projectId: string): void {
  const emitter = emitters.get(projectId);
  if (emitter) {
    emitter.removeAllListeners();
    emitters.delete(projectId);
  }
}
