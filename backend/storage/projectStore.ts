import fs from "fs/promises";
import path from "path";
import { HookSessionState } from "../../shared/types/hook";
import { migrateSession, CURRENT_SCHEMA_VERSION } from "./migrations";

export interface ModuleExport {
  exportedAt: string;
  module: "hook";
  projectId: string;
  seedInput: string;
  sessionStatus: string;

  /** The locked HookPack — primary handoff payload for next module */
  hookPack: HookSessionState["hookPack"];

  /** Full constraint ledger — every confirmed and inferred creative decision */
  constraintLedger: HookSessionState["constraintLedger"];

  /** Conversation turns — full context of the creative journey */
  turns: HookSessionState["turns"];

  /** Accumulated creative state at time of lock */
  currentState: HookSessionState["currentState"];

  /** Prompt history — every LLM call made during the session */
  promptHistory: HookSessionState["promptHistory"];

  /** The revealed hook output (builder result) */
  revealedHook: HookSessionState["revealedHook"];

  /** The judge's evaluation of the revealed hook */
  revealedJudge: HookSessionState["revealedJudge"];

  /** Stats summary */
  stats: {
    totalTurns: number;
    rerollCount: number;
    totalLlmCalls: number;
    editedLlmCalls: number;
  };
}

export class ProjectStore {
  private dataDir: string;
  private exportDir: string;
  private bibleDir: string;

  constructor(dataDir = "./data") {
    this.dataDir = dataDir;
    this.exportDir = path.join(dataDir, "exports");
    this.bibleDir = path.join(dataDir, "bibles");
    fs.mkdir(dataDir, { recursive: true }).catch((e) =>
      console.error(`[ProjectStore] mkdir failed: ${dataDir}`, e.message));
    fs.mkdir(this.exportDir, { recursive: true }).catch((e) =>
      console.error(`[ProjectStore] mkdir failed: ${this.exportDir}`, e.message));
    fs.mkdir(this.bibleDir, { recursive: true }).catch((e) =>
      console.error(`[ProjectStore] mkdir failed: ${this.bibleDir}`, e.message));
  }

  private filePath(projectId: string): string {
    const safe = projectId.replace(/[^a-zA-Z0-9_-]/g, "");
    return path.join(this.dataDir, `${safe}.json`);
  }

  private exportPath(projectId: string): string {
    const safe = projectId.replace(/[^a-zA-Z0-9_-]/g, "");
    return path.join(this.exportDir, `${safe}.json`);
  }

  async get(projectId: string): Promise<HookSessionState | null> {
    const fp = this.filePath(projectId);
    try {
      const raw = await fs.readFile(fp, "utf-8");
      const session: HookSessionState = JSON.parse(raw);
      if (migrateSession(session, "hook")) {
        await this.save(session);
      }
      return session;
    } catch (e: any) {
      if (e.code !== "ENOENT") {
        console.error(`[ProjectStore] get failed: ${fp}`, e.code === undefined ? "parse error" : e.code, e.message);
      }
      return null;
    }
  }

  async save(session: HookSessionState): Promise<void> {
    session.schemaVersion = CURRENT_SCHEMA_VERSION;
    const fp = this.filePath(session.projectId);
    const tmp = fp + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(session, null, 2));
    await fs.rename(tmp, fp);
  }

  async delete(projectId: string): Promise<void> {
    try {
      await fs.unlink(this.filePath(projectId));
    } catch (e: any) {
      if (e.code !== "ENOENT") {
        console.error(`[ProjectStore] delete failed: ${this.filePath(projectId)}`, e.code, e.message);
      }
    }
  }

  /** Build and save a comprehensive module export for handoff to the next module */
  async saveExport(session: HookSessionState): Promise<ModuleExport> {
    const history = session.promptHistory ?? [];
    const exportData: ModuleExport = {
      exportedAt: new Date().toISOString(),
      module: "hook",
      projectId: session.projectId,
      seedInput: session.seedInput,
      sessionStatus: session.status,
      hookPack: session.hookPack,
      constraintLedger: session.constraintLedger,
      turns: session.turns,
      currentState: session.currentState,
      promptHistory: session.promptHistory,
      revealedHook: session.revealedHook,
      revealedJudge: session.revealedJudge,
      stats: {
        totalTurns: session.turns.length,
        rerollCount: session.rerollCount,
        totalLlmCalls: history.length,
        editedLlmCalls: history.filter(h => h.wasEdited).length,
      },
    };

    const fp = this.exportPath(session.projectId);
    const tmp = fp + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(exportData, null, 2));
    await fs.rename(tmp, fp);

    return exportData;
  }

  /** Get a previously saved export */
  async getExport(projectId: string): Promise<ModuleExport | null> {
    const fp = this.exportPath(projectId);
    try {
      const raw = await fs.readFile(fp, "utf-8");
      return JSON.parse(raw);
    } catch (e: any) {
      if (e.code !== "ENOENT") {
        console.error(`[ProjectStore] getExport failed: ${fp}`, e.code === undefined ? "parse error" : e.code, e.message);
      }
      return null;
    }
  }

  // ─── Story Bible ───

  private biblePath(projectId: string): string {
    const safe = projectId.replace(/[^a-zA-Z0-9_-]/g, "");
    return path.join(this.bibleDir, `${safe}.json`);
  }

  /** Get the story bible for a project (keyed by hook project ID) */
  async getStoryBible(projectId: string): Promise<string | null> {
    const fp = this.biblePath(projectId);
    try {
      const raw = await fs.readFile(fp, "utf-8");
      const data = JSON.parse(raw);
      return data.bible ?? null;
    } catch (e: any) {
      if (e.code !== "ENOENT") {
        console.error(`[ProjectStore] getStoryBible failed: ${fp}`, e.code === undefined ? "parse error" : e.code, e.message);
      }
      return null;
    }
  }

  /** Save the story bible for a project (keyed by hook project ID) */
  async saveStoryBible(projectId: string, bible: string): Promise<void> {
    const fp = this.biblePath(projectId);
    const tmp = fp + ".tmp";
    const data = {
      projectId,
      bible,
      updatedAt: new Date().toISOString(),
    };
    await fs.writeFile(tmp, JSON.stringify(data, null, 2));
    await fs.rename(tmp, fp);
  }
}
