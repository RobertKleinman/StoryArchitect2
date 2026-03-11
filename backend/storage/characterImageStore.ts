import fs from "fs/promises";
import path from "path";
import { CharacterImagePack, CharacterImageSessionState } from "../../shared/types/characterImage";

/**
 * Character Image module export — the clean handoff payload saved separately from the session.
 * The session keeps full data (turns, generated images, etc.) for crash recovery.
 * The export is the curated payload for downstream modules.
 */
export interface CharacterImageModuleExport {
  exportedAt: string;
  module: "character_image";
  projectId: string;
  characterProjectId: string;

  /** The locked CharacterImagePack — primary handoff payload */
  characterImagePack: CharacterImagePack;

  /** Full constraint ledger — every confirmed and inferred visual decision */
  constraintLedger: CharacterImageSessionState["constraintLedger"];

  /** Stats summary */
  stats: {
    totalTurns: number;
    totalLlmCalls: number;
    editedLlmCalls: number;
    totalImagesGenerated: number;
    totalRerolls: number;
  };
}

export class CharacterImageStore {
  private dataDir: string;
  private exportDir: string;

  constructor(dataDir = "./data/characterImages") {
    this.dataDir = dataDir;
    this.exportDir = path.join(dataDir, "exports");
    fs.mkdir(dataDir, { recursive: true }).catch((e) =>
      console.error(`[CharacterImageStore] mkdir failed: ${dataDir}`, e.message));
    fs.mkdir(this.exportDir, { recursive: true }).catch((e) =>
      console.error(`[CharacterImageStore] mkdir failed: ${this.exportDir}`, e.message));
  }

  private filePath(projectId: string): string {
    const safe = projectId.replace(/[^a-zA-Z0-9_-]/g, "");
    return path.join(this.dataDir, `${safe}.json`);
  }

  private exportPath(projectId: string): string {
    const safe = projectId.replace(/[^a-zA-Z0-9_-]/g, "");
    return path.join(this.exportDir, `${safe}.json`);
  }

  async get(projectId: string): Promise<CharacterImageSessionState | null> {
    const fp = this.filePath(projectId);
    try {
      const raw = await fs.readFile(fp, "utf-8");
      return JSON.parse(raw);
    } catch (e: any) {
      if (e.code !== "ENOENT") {
        console.error(`[CharacterImageStore] get failed: ${fp}`, e.code === undefined ? "parse error" : e.code, e.message);
      }
      return null;
    }
  }

  async save(session: CharacterImageSessionState): Promise<void> {
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
        console.error(`[CharacterImageStore] delete failed: ${this.filePath(projectId)}`, e.code, e.message);
      }
    }
  }

  /** Build and save a comprehensive module export for handoff */
  async saveExport(
    session: CharacterImageSessionState,
    characterImagePack: CharacterImagePack
  ): Promise<CharacterImageModuleExport> {
    const history = session.promptHistory ?? [];
    const images = Object.values(session.generatedImages);
    const exportData: CharacterImageModuleExport = {
      exportedAt: new Date().toISOString(),
      module: "character_image",
      projectId: session.projectId,
      characterProjectId: session.characterProjectId,
      characterImagePack,
      constraintLedger: session.constraintLedger,
      stats: {
        totalTurns: session.turns.length,
        totalLlmCalls: history.length,
        editedLlmCalls: history.filter((h) => h.wasEdited).length,
        totalImagesGenerated: images.length,
        totalRerolls: images.reduce((sum, img) => sum + img.reroll_count, 0),
      },
    };

    const fp = this.exportPath(session.projectId);
    const tmp = fp + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(exportData, null, 2));
    await fs.rename(tmp, fp);

    return exportData;
  }

  /** Get a previously saved export */
  async getExport(projectId: string): Promise<CharacterImageModuleExport | null> {
    const fp = this.exportPath(projectId);
    try {
      const raw = await fs.readFile(fp, "utf-8");
      return JSON.parse(raw);
    } catch (e: any) {
      if (e.code !== "ENOENT") {
        console.error(`[CharacterImageStore] getExport failed: ${fp}`, e.code === undefined ? "parse error" : e.code, e.message);
      }
      return null;
    }
  }
}
