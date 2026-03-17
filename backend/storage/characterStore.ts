import fs from "fs/promises";
import path from "path";
import { CharacterPack, CharacterSessionState } from "../../shared/types/character";
import { UserPsychologyLedger } from "../../shared/types/userPsychology";
import { migrateSession, CURRENT_SCHEMA_VERSION } from "./migrations";

/**
 * Character module export — the clean handoff payload saved separately from the session.
 * The session keeps full data (revealedCharacters, turns, etc.) for crash recovery.
 * The export is the curated payload for downstream modules.
 */
export interface CharacterModuleExport {
  exportedAt: string;
  module: "character";
  projectId: string;
  hookProjectId: string;

  /** The locked CharacterPack — primary handoff payload for next module */
  characterPack: CharacterPack;

  /** Full constraint ledger — every confirmed and inferred character decision */
  constraintLedger: CharacterSessionState["constraintLedger"];

  /** Psychology ledger — accumulated user psychology data for downstream modules */
  psychologyLedger?: UserPsychologyLedger;

  /** Stats summary */
  stats: {
    totalTurns: number;
    totalLlmCalls: number;
    editedLlmCalls: number;
  };
}

export class CharacterStore {
  private dataDir: string;
  private exportDir: string;

  constructor(dataDir = "./data/characters") {
    this.dataDir = dataDir;
    this.exportDir = path.join(dataDir, "exports");
    fs.mkdir(dataDir, { recursive: true }).catch((e) =>
      console.error(`[CharacterStore] mkdir failed: ${dataDir}`, e.message));
    fs.mkdir(this.exportDir, { recursive: true }).catch((e) =>
      console.error(`[CharacterStore] mkdir failed: ${this.exportDir}`, e.message));
  }

  private filePath(projectId: string): string {
    const safe = projectId.replace(/[^a-zA-Z0-9_-]/g, "");
    return path.join(this.dataDir, `${safe}.json`);
  }

  private exportPath(projectId: string): string {
    const safe = projectId.replace(/[^a-zA-Z0-9_-]/g, "");
    return path.join(this.exportDir, `${safe}.json`);
  }

  async get(projectId: string): Promise<CharacterSessionState | null> {
    const fp = this.filePath(projectId);
    try {
      const raw = await fs.readFile(fp, "utf-8");
      const session: CharacterSessionState = JSON.parse(raw);
      if (migrateSession(session, "character")) {
        await this.save(session);
      }
      return session;
    } catch (e: any) {
      if (e.code !== "ENOENT") {
        console.error(`[CharacterStore] get failed: ${fp}`, e.code === undefined ? "parse error" : e.code, e.message);
      }
      return null;
    }
  }

  async save(session: CharacterSessionState): Promise<void> {
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
        console.error(`[CharacterStore] delete failed: ${this.filePath(projectId)}`, e.code, e.message);
      }
    }
  }

  /** Build and save a comprehensive module export for handoff to the next module */
  async saveExport(
    session: CharacterSessionState,
    characterPack: CharacterPack
  ): Promise<CharacterModuleExport> {
    const history = session.promptHistory ?? [];
    const exportData: CharacterModuleExport = {
      exportedAt: new Date().toISOString(),
      module: "character",
      projectId: session.projectId,
      hookProjectId: session.hookProjectId,
      characterPack,
      constraintLedger: session.constraintLedger,
      psychologyLedger: session.psychologyLedger,
      stats: {
        totalTurns: session.turns.length,
        totalLlmCalls: history.length,
        editedLlmCalls: history.filter((h) => h.wasEdited).length,
      },
    };

    const fp = this.exportPath(session.projectId);
    const tmp = fp + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(exportData, null, 2));
    await fs.rename(tmp, fp);

    return exportData;
  }

  /** Get a previously saved export */
  async getExport(projectId: string): Promise<CharacterModuleExport | null> {
    const fp = this.exportPath(projectId);
    try {
      const raw = await fs.readFile(fp, "utf-8");
      return JSON.parse(raw);
    } catch (e: any) {
      if (e.code !== "ENOENT") {
        console.error(`[CharacterStore] getExport failed: ${fp}`, e.code === undefined ? "parse error" : e.code, e.message);
      }
      return null;
    }
  }
}
