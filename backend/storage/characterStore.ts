import fs from "fs/promises";
import path from "path";
import { CharacterPack, CharacterSessionState } from "../../shared/types/character";
import { UserPsychologyLedger } from "../../shared/types/userPsychology";

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

  async get(projectId: string): Promise<CharacterSessionState | null> {
    try {
      const raw = await fs.readFile(this.filePath(projectId), "utf-8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async save(session: CharacterSessionState): Promise<void> {
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
    try {
      const raw = await fs.readFile(this.exportPath(projectId), "utf-8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
}
