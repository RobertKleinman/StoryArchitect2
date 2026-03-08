import { promises as fs } from "fs";
import * as path from "path";
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
    // Create directories (non-blocking, ignore errors if they exist)
    fs.mkdir(this.dataDir, { recursive: true }).catch(() => {});
    fs.mkdir(path.join(this.dataDir, "exports"), { recursive: true }).catch(() => {});
  }

  private sanitize(id: string): string {
    return id.replace(/[^a-zA-Z0-9_-]/g, "");
  }

  async get(projectId: string): Promise<WorldSessionState | null> {
    try {
      const filePath = path.join(this.dataDir, `${this.sanitize(projectId)}.json`);
      const raw = await fs.readFile(filePath, "utf8");
      return JSON.parse(raw) as WorldSessionState;
    } catch {
      return null;
    }
  }

  async save(session: WorldSessionState): Promise<void> {
    const filePath = path.join(this.dataDir, `${this.sanitize(session.projectId)}.json`);
    const tmpPath = filePath + ".tmp";
    await fs.writeFile(tmpPath, JSON.stringify(session, null, 2), "utf8");
    await fs.rename(tmpPath, filePath);
  }

  async delete(projectId: string): Promise<void> {
    try {
      const filePath = path.join(this.dataDir, `${this.sanitize(projectId)}.json`);
      await fs.unlink(filePath);
    } catch {
      // Silent fail on missing file
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
    try {
      const filePath = path.join(
        this.dataDir,
        "exports",
        `${this.sanitize(projectId)}.json`
      );
      const raw = await fs.readFile(filePath, "utf8");
      return JSON.parse(raw) as WorldModuleExport;
    } catch {
      return null;
    }
  }
}
