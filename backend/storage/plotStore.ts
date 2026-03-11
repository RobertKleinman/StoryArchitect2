import { promises as fs } from "fs";
import * as path from "path";
import {
  PlotSessionState,
  PlotPack,
} from "../../shared/types/plot";

export interface PlotModuleExport {
  exportedAt: string;
  module: "plot";
  projectId: string;
  hookProjectId: string;
  characterProjectId: string;
  characterImageProjectId?: string;
  worldProjectId: string;
  plotPack: PlotPack;
  constraintLedger: PlotSessionState["constraintLedger"];
  stats: {
    totalTurns: number;
    totalLlmCalls: number;
    editedLlmCalls: number;
  };
}

export class PlotStore {
  private dataDir: string;

  constructor(dataDir = "./data/plots") {
    this.dataDir = dataDir;
    fs.mkdir(this.dataDir, { recursive: true }).catch((e) =>
      console.error(`[PlotStore] mkdir failed: ${this.dataDir}`, e.message));
    fs.mkdir(path.join(this.dataDir, "exports"), { recursive: true }).catch((e) =>
      console.error(`[PlotStore] mkdir failed: exports`, e.message));
  }

  private sanitize(id: string): string {
    return id.replace(/[^a-zA-Z0-9_-]/g, "");
  }

  async get(projectId: string): Promise<PlotSessionState | null> {
    const filePath = path.join(this.dataDir, `${this.sanitize(projectId)}.json`);
    try {
      const raw = await fs.readFile(filePath, "utf8");
      return JSON.parse(raw) as PlotSessionState;
    } catch (e: any) {
      if (e.code !== "ENOENT") {
        console.error(`[PlotStore] get failed: ${filePath}`, e.code === undefined ? "parse error" : e.code, e.message);
      }
      return null;
    }
  }

  async save(session: PlotSessionState): Promise<void> {
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
        console.error(`[PlotStore] delete failed: ${filePath}`, e.code, e.message);
      }
    }
  }

  async saveExport(
    session: PlotSessionState,
    plotPack: PlotPack
  ): Promise<PlotModuleExport> {
    let totalLlmCalls = 0;
    let editedLlmCalls = 0;
    if (session.promptHistory) {
      totalLlmCalls = session.promptHistory.length;
      editedLlmCalls = session.promptHistory.filter((e) => e.wasEdited).length;
    }

    const moduleExport: PlotModuleExport = {
      exportedAt: new Date().toISOString(),
      module: "plot",
      projectId: session.projectId,
      hookProjectId: session.hookProjectId,
      characterProjectId: session.characterProjectId,
      characterImageProjectId: session.characterImageProjectId,
      worldProjectId: session.worldProjectId,
      plotPack,
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

  async getExport(projectId: string): Promise<PlotModuleExport | null> {
    const filePath = path.join(
      this.dataDir,
      "exports",
      `${this.sanitize(projectId)}.json`
    );
    try {
      const raw = await fs.readFile(filePath, "utf8");
      return JSON.parse(raw) as PlotModuleExport;
    } catch (e: any) {
      if (e.code !== "ENOENT") {
        console.error(`[PlotStore] getExport failed: ${filePath}`, e.code === undefined ? "parse error" : e.code, e.message);
      }
      return null;
    }
  }
}
