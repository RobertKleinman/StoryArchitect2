import { promises as fs } from "fs";
import * as path from "path";
import { migrateSession, CURRENT_SCHEMA_VERSION } from "./migrations";
import {
  WorldSessionState,
  WorldPack,
} from "../../shared/types/world";

export interface WorldModuleExport {
  exportedAt: string;
  module: "world";
  projectId: string;
  hookProjectId: string;
  characterProjectId: string;
  characterImageProjectId?: string;
  worldPack: WorldPack;
  constraintLedger: WorldSessionState["constraintLedger"];
  stats: {
    totalTurns: number;
    totalLlmCalls: number;
    editedLlmCalls: number;
  };
}

export class WorldStore {
  private dataDir: string;

  constructor(dataDir = "./data/worlds") {
    this.dataDir = dataDir;
    fs.mkdir(this.dataDir, { recursive: true }).catch((e) =>
      console.error(`[WorldStore] mkdir failed: ${this.dataDir}`, e.message));
    fs.mkdir(path.join(this.dataDir, "exports"), { recursive: true }).catch((e) =>
      console.error(`[WorldStore] mkdir failed: exports`, e.message));
  }

  private sanitize(id: string): string {
    return id.replace(/[^a-zA-Z0-9_-]/g, "");
  }

  async get(projectId: string): Promise<WorldSessionState | null> {
    const filePath = path.join(this.dataDir, `${this.sanitize(projectId)}.json`);
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const session = JSON.parse(raw) as WorldSessionState;
      if (migrateSession(session, "world")) {
        await this.save(session);
      }
      return session;
    } catch (e: any) {
      if (e.code !== "ENOENT") {
        console.error(`[WorldStore] get failed: ${filePath}`, e.code === undefined ? "parse error" : e.code, e.message);
      }
      return null;
    }
  }

  async save(session: WorldSessionState): Promise<void> {
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
        console.error(`[WorldStore] delete failed: ${filePath}`, e.code, e.message);
      }
    }
  }

  async saveExport(
    session: WorldSessionState,
    worldPack: WorldPack
  ): Promise<WorldModuleExport> {
    // Compute stats
    let totalLlmCalls = 0;
    let editedLlmCalls = 0;
    if (session.promptHistory) {
      totalLlmCalls = session.promptHistory.length;
      editedLlmCalls = session.promptHistory.filter((e) => e.wasEdited).length;
    }

    const moduleExport: WorldModuleExport = {
      exportedAt: new Date().toISOString(),
      module: "world",
      projectId: session.projectId,
      hookProjectId: session.hookProjectId,
      characterProjectId: session.characterProjectId,
      characterImageProjectId: session.characterImageProjectId,
      worldPack,
      constraintLedger: session.constraintLedger,
      stats: {
        totalTurns: session.turns.length,
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

  async getExport(projectId: string): Promise<WorldModuleExport | null> {
    const filePath = path.join(
      this.dataDir,
      "exports",
      `${this.sanitize(projectId)}.json`
    );
    try {
      const raw = await fs.readFile(filePath, "utf8");
      return JSON.parse(raw) as WorldModuleExport;
    } catch (e: any) {
      if (e.code !== "ENOENT") {
        console.error(`[WorldStore] getExport failed: ${filePath}`, e.code === undefined ? "parse error" : e.code, e.message);
      }
      return null;
    }
  }
}
