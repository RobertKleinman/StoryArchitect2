import fs from "fs/promises";
import path from "path";
import { HookSessionState } from "../../shared/types/hook";

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

  constructor(dataDir = "./data") {
    this.dataDir = dataDir;
    this.exportDir = path.join(dataDir, "exports");
    fs.mkdir(dataDir, { recursive: true }).catch(() => {});
    fs.mkdir(this.exportDir, { recursive: true }).catch(() => {});
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
    try {
      const raw = await fs.readFile(this.filePath(projectId), "utf-8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async save(session: HookSessionState): Promise<void> {
    const fp = this.filePath(session.projectId);
    const tmp = fp + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(session, null, 2));
    await fs.rename(tmp, fp);
  }

  async delete(projectId: string): Promise<void> {
    try {
      await fs.unlink(this.filePath(projectId));
    } catch {
      // already gone
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
    try {
      const raw = await fs.readFile(this.exportPath(projectId), "utf-8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
}
