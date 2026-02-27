import fs from "fs/promises";
import path from "path";
import { HookSessionState } from "../../shared/types/hook";

export class ProjectStore {
  private dataDir: string;

  constructor(dataDir = "./data") {
    this.dataDir = dataDir;
    fs.mkdir(dataDir, { recursive: true }).catch(() => {});
  }

  private filePath(projectId: string): string {
    const safe = projectId.replace(/[^a-zA-Z0-9_-]/g, "");
    return path.join(this.dataDir, `${safe}.json`);
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
}
