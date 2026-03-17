import fs from "fs/promises";
import path from "path";
import { CharacterImagePack, CharacterImageSessionState, GeneratedCharacterImage } from "../../shared/types/characterImage";
import { migrateSession, CURRENT_SCHEMA_VERSION } from "./migrations";

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
  private assetsDir: string;

  constructor(dataDir = "./data/characterImages") {
    this.dataDir = dataDir;
    this.exportDir = path.join(dataDir, "exports");
    this.assetsDir = path.join(dataDir, "assets");
    fs.mkdir(dataDir, { recursive: true }).catch((e) =>
      console.error(`[CharacterImageStore] mkdir failed: ${dataDir}`, e.message));
    fs.mkdir(this.exportDir, { recursive: true }).catch((e) =>
      console.error(`[CharacterImageStore] mkdir failed: ${this.exportDir}`, e.message));
    fs.mkdir(this.assetsDir, { recursive: true }).catch((e) =>
      console.error(`[CharacterImageStore] mkdir failed: ${this.assetsDir}`, e.message));
  }

  private filePath(projectId: string): string {
    const safe = projectId.replace(/[^a-zA-Z0-9_-]/g, "");
    return path.join(this.dataDir, `${safe}.json`);
  }

  private exportPath(projectId: string): string {
    const safe = projectId.replace(/[^a-zA-Z0-9_-]/g, "");
    return path.join(this.exportDir, `${safe}.json`);
  }

  private assetPath(projectId: string, imageId: string): string {
    const safeProject = projectId.replace(/[^a-zA-Z0-9_-]/g, "");
    const safeImage = imageId.replace(/[^a-zA-Z0-9_-]/g, "");
    return path.join(this.assetsDir, `${safeProject}_${safeImage}.b64`);
  }

  /** Relative ref stored in session JSON (portable across moves) */
  private assetRef(projectId: string, imageId: string): string {
    const safeProject = projectId.replace(/[^a-zA-Z0-9_-]/g, "");
    const safeImage = imageId.replace(/[^a-zA-Z0-9_-]/g, "");
    return `assets/${safeProject}_${safeImage}.b64`;
  }

  async get(projectId: string): Promise<CharacterImageSessionState | null> {
    const fp = this.filePath(projectId);
    try {
      const raw = await fs.readFile(fp, "utf-8");
      const session: CharacterImageSessionState = JSON.parse(raw);
      // Schema migration
      const schemaMigrated = migrateSession(session, "character_image");
      // Migration: extract any inline base64 that wasn't extracted yet
      await this.migrateInlineBase64(session);
      if (schemaMigrated) {
        // migrateInlineBase64 already re-saves if it extracts, but schema-only migration needs a save too
        const fp2 = this.filePath(session.projectId);
        const tmp2 = fp2 + ".tmp";
        await fs.writeFile(tmp2, JSON.stringify(session, null, 2));
        await fs.rename(tmp2, fp2);
      }
      return session;
    } catch (e: any) {
      if (e.code !== "ENOENT") {
        console.error(`[CharacterImageStore] get failed: ${fp}`, e.code === undefined ? "parse error" : e.code, e.message);
      }
      return null;
    }
  }

  async save(session: CharacterImageSessionState): Promise<void> {
    session.schemaVersion = CURRENT_SCHEMA_VERSION;
    // Extract base64 to separate files before saving session JSON
    await this.extractBase64ToAssets(session);
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

  /** Read a base64 image from its asset file */
  async readImageBase64(ref: string): Promise<string | null> {
    const fp = path.join(this.dataDir, ref);
    try {
      return await fs.readFile(fp, "utf-8");
    } catch (e: any) {
      if (e.code !== "ENOENT") {
        console.error(`[CharacterImageStore] readImageBase64 failed: ${fp}`, e.message);
      }
      return null;
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

  // ── Base64 extraction helpers ─────────────────────────────────────

  /**
   * Extract inline image_base64 from GeneratedCharacterImage entries to separate .b64 files.
   * Replaces image_base64 with image_ref in the session object (mutates in place).
   */
  private async extractBase64ToAssets(session: CharacterImageSessionState): Promise<void> {
    for (const [role, img] of Object.entries(session.generatedImages)) {
      if (img.image_base64 && !img.image_ref) {
        const ref = this.assetRef(session.projectId, role);
        const fp = path.join(this.dataDir, ref);
        await fs.writeFile(fp, img.image_base64, "utf-8");
        img.image_ref = ref;
        delete img.image_base64;
        console.log(`[CharacterImageStore] Extracted base64 for ${role} → ${ref}`);
      }
    }
  }

  /**
   * Migration-on-load: if a session still has inline image_base64, extract and re-save.
   */
  private async migrateInlineBase64(session: CharacterImageSessionState): Promise<void> {
    let migrated = false;
    for (const [role, img] of Object.entries(session.generatedImages)) {
      if (img.image_base64 && !img.image_ref) {
        const ref = this.assetRef(session.projectId, role);
        const fp = path.join(this.dataDir, ref);
        await fs.writeFile(fp, img.image_base64, "utf-8");
        img.image_ref = ref;
        delete img.image_base64;
        migrated = true;
        console.log(`[CharacterImageStore] Migrated inline base64 for ${role} → ${ref}`);
      }
    }
    if (migrated) {
      // Re-save session without inline base64
      const sessionFp = this.filePath(session.projectId);
      const tmp = sessionFp + ".tmp";
      await fs.writeFile(tmp, JSON.stringify(session, null, 2));
      await fs.rename(tmp, sessionFp);
      console.log(`[CharacterImageStore] Migration re-saved session ${session.projectId}`);
    }
  }
}
