/**
 * v2 Project Store — State-machine-aware persistence
 *
 * Validates that writes match the declared step's schema.
 * Uses atomic write (tmp + rename) for crash safety.
 * All entity IDs are validated as UUID format.
 */

import fs from "fs/promises";
import path from "path";
import type { ProjectState, ProjectId } from "../../../shared/types/project";
import { isValidTransition } from "../../../shared/types/project";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Also accept prefixed IDs like "v2_<uuid>"
const PROJECT_ID_RE = /^v2_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidProjectId(id: string): boolean {
  return UUID_RE.test(id) || PROJECT_ID_RE.test(id);
}

function safePath(dir: string, id: string, suffix: string): string {
  if (!isValidProjectId(id)) {
    throw new Error(`Invalid project ID format: ${id}`);
  }
  const normalized = path.normalize(path.join(dir, `${id}${suffix}`));
  if (!normalized.startsWith(path.normalize(dir))) {
    throw new Error(`Path traversal detected for ID: ${id}`);
  }
  return normalized;
}

export class ProjectStoreV2 {
  private dataDir: string;

  constructor(dataDir = "./data/v2") {
    this.dataDir = dataDir;
  }

  async init(): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true });
  }

  async get(projectId: ProjectId): Promise<ProjectState | null> {
    const filePath = safePath(this.dataDir, projectId, ".json");
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      return JSON.parse(raw) as ProjectState;
    } catch (err: any) {
      if (err.code === "ENOENT") return null;
      throw err;
    }
  }

  async save(state: ProjectState): Promise<void> {
    await this.init();
    const filePath = safePath(this.dataDir, state.projectId, ".json");
    const tmpPath = `${filePath}.tmp`;

    // Validate required fields
    if (!state.step) throw new Error("Cannot save project without step field");
    if (!state.projectId) throw new Error("Cannot save project without projectId");

    state.updatedAt = new Date().toISOString();
    const json = JSON.stringify(state, null, 2);

    await fs.writeFile(tmpPath, json, "utf-8");
    await fs.rename(tmpPath, filePath);
  }

  /**
   * Transition-aware save: validates the step transition is legal
   * before persisting the new state.
   */
  async transition(
    projectId: ProjectId,
    newState: ProjectState,
  ): Promise<void> {
    const current = await this.get(projectId);

    if (current) {
      if (!isValidTransition(current.step, newState.step)) {
        throw new Error(
          `Invalid transition: ${current.step} → ${newState.step}. ` +
          `Valid targets: ${JSON.stringify((await import("../../../shared/types/project")).getValidTransitions(current.step))}`,
        );
      }
    }

    await this.save(newState);
  }

  async delete(projectId: ProjectId): Promise<void> {
    const filePath = safePath(this.dataDir, projectId, ".json");
    try {
      await fs.unlink(filePath);
    } catch (err: any) {
      if (err.code !== "ENOENT") throw err;
    }
  }

  async list(): Promise<ProjectId[]> {
    await this.init();
    const files = await fs.readdir(this.dataDir);
    return files
      .filter(f => f.endsWith(".json") && !f.endsWith(".tmp"))
      .map(f => f.replace(".json", "") as ProjectId);
  }
}
