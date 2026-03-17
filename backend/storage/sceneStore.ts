import { promises as fs } from "fs";
import * as path from "path";
import { migrateSession, CURRENT_SCHEMA_VERSION } from "./migrations";
import {
  SceneSessionState,
  ScenePack,
} from "../../shared/types/scene";

export interface SceneModuleExport {
  exportedAt: string;
  module: "scene";
  projectId: string;
  plotProjectId: string;
  worldProjectId: string;
  characterProjectId: string;
  characterImageProjectId?: string;
  hookProjectId: string;
  scenePack: ScenePack;
  constraintLedger: SceneSessionState["constraintLedger"];
  stats: {
    totalPlanningTurns: number;
    totalWritingTurns: number;
    totalScenesBuilt: number;
    autoPassedScenes: number;
    steeredScenes: number;
    totalLlmCalls: number;
    editedLlmCalls: number;
  };
}

export class SceneStore {
  private dataDir: string;

  constructor(dataDir = "./data/scenes") {
    this.dataDir = dataDir;
    fs.mkdir(this.dataDir, { recursive: true }).catch((e) =>
      console.error(`[SceneStore] mkdir failed: ${this.dataDir}`, e.message));
    fs.mkdir(path.join(this.dataDir, "exports"), { recursive: true }).catch((e) =>
      console.error(`[SceneStore] mkdir failed: exports`, e.message));
  }

  private sanitize(id: string): string {
    return id.replace(/[^a-zA-Z0-9_-]/g, "");
  }

  async get(projectId: string): Promise<SceneSessionState | null> {
    const filePath = path.join(this.dataDir, `${this.sanitize(projectId)}.json`);
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const session = JSON.parse(raw) as SceneSessionState;
      if (migrateSession(session, "scene")) {
        await this.save(session);
      }
      return session;
    } catch (e: any) {
      if (e.code !== "ENOENT") {
        console.error(`[SceneStore] get failed: ${filePath}`, e.code === undefined ? "parse error" : e.code, e.message);
      }
      return null;
    }
  }

  async save(session: SceneSessionState): Promise<void> {
    session.schemaVersion = CURRENT_SCHEMA_VERSION;
    const filePath = path.join(this.dataDir, `${this.sanitize(session.projectId)}.json`);
    const tmpPath = filePath + ".tmp";
    await fs.writeFile(tmpPath, JSON.stringify(session, null, 2), "utf8");
    await fs.rename(tmpPath, filePath);
  }

  async delete(projectId: string): Promise<void> {
    const filePath = path.join(this.dataDir, `${this.sanitize(projectId)}.json`);
    try {
      await fs.unlink(filePath);
    } catch (e: any) {
      if (e.code !== "ENOENT") {
        console.error(`[SceneStore] delete failed: ${filePath}`, e.code, e.message);
      }
    }
  }

  async saveExport(
    session: SceneSessionState,
    scenePack: ScenePack
  ): Promise<SceneModuleExport> {
    let totalLlmCalls = 0;
    let editedLlmCalls = 0;
    if (session.promptHistory) {
      totalLlmCalls = session.promptHistory.length;
      editedLlmCalls = session.promptHistory.filter((e) => e.wasEdited).length;
    }

    const autoPassedScenes = session.writingTurns.filter(
      (t) => t.userSelection?.type === "auto_pass"
    ).length;
    const steeredScenes = session.builtScenes.length - autoPassedScenes;

    const moduleExport: SceneModuleExport = {
      exportedAt: new Date().toISOString(),
      module: "scene",
      projectId: session.projectId,
      plotProjectId: session.plotProjectId,
      worldProjectId: session.worldProjectId,
      characterProjectId: session.characterProjectId,
      characterImageProjectId: session.characterImageProjectId,
      hookProjectId: session.hookProjectId,
      scenePack,
      constraintLedger: session.constraintLedger,
      stats: {
        totalPlanningTurns: session.planningTurns.length,
        totalWritingTurns: session.writingTurns.length,
        totalScenesBuilt: session.builtScenes.length,
        autoPassedScenes,
        steeredScenes,
        totalLlmCalls,
        editedLlmCalls,
      },
    };

    const filePath = path.join(
      this.dataDir,
      "exports",
      `${this.sanitize(session.projectId)}.json`
    );
    const tmpPath = filePath + ".tmp";
    await fs.writeFile(tmpPath, JSON.stringify(moduleExport, null, 2), "utf8");
    await fs.rename(tmpPath, filePath);

    return moduleExport;
  }

  async deleteExport(projectId: string): Promise<void> {
    const filePath = path.join(
      this.dataDir,
      "exports",
      `${this.sanitize(projectId)}.json`
    );
    try {
      await fs.unlink(filePath);
    } catch (e: any) {
      if (e.code !== "ENOENT") {
        console.error(`[SceneStore] deleteExport failed: ${filePath}`, e.code, e.message);
      }
    }
  }

  async getExport(projectId: string): Promise<SceneModuleExport | null> {
    const filePath = path.join(
      this.dataDir,
      "exports",
      `${this.sanitize(projectId)}.json`
    );
    try {
      const raw = await fs.readFile(filePath, "utf8");
      return JSON.parse(raw) as SceneModuleExport;
    } catch (e: any) {
      if (e.code !== "ENOENT") {
        console.error(`[SceneStore] getExport failed: ${filePath}`, e.code === undefined ? "parse error" : e.code, e.message);
      }
      return null;
    }
  }
}
