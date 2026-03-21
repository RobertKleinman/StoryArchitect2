/**
 * File-based storage for Cultural Intelligence Engine data.
 *
 * Stores:
 * - Brief cache: ./data/cultural/briefs/{projectId}_{module}_{turn}.json
 * - Decision ledger: ./data/cultural/ledgers/{projectId}.json
 * - Influence log: ./data/cultural/influence/{projectId}.json
 *
 * Follow the same pattern as ProjectStore (backend/storage/projectStore.ts).
 */

import * as fs from "fs/promises";
import * as path from "path";
import type {
  CulturalBrief,
  CulturalDecisionLedger,
  CulturalDecision,
  CulturalInfluenceLog,
  InfluenceLogEntry,
  BriefCacheEntry,
  CulturalModule,
  GroundingBrief,
  GroundingCacheEntry,
  CreativeInsight,
  CreativeInsightsLedger,
} from "../../shared/types/cultural";

const DATA_DIR = path.join(process.cwd(), "data", "cultural");
const BRIEFS_DIR = path.join(DATA_DIR, "briefs");
const GROUNDING_DIR = path.join(DATA_DIR, "grounding");
const LEDGERS_DIR = path.join(DATA_DIR, "ledgers");
const INFLUENCE_DIR = path.join(DATA_DIR, "influence");
const INSIGHTS_DIR = path.join(DATA_DIR, "insights");

const MAX_INSIGHTS = 40;

export class CulturalStore {
  private initialized = false;

  private async ensureDirs(): Promise<void> {
    if (this.initialized) return;
    await fs.mkdir(BRIEFS_DIR, { recursive: true });
    await fs.mkdir(GROUNDING_DIR, { recursive: true });
    await fs.mkdir(LEDGERS_DIR, { recursive: true });
    await fs.mkdir(INFLUENCE_DIR, { recursive: true });
    await fs.mkdir(INSIGHTS_DIR, { recursive: true });
    this.initialized = true;
  }

  // ── Brief Cache ──

  async getCachedBrief(
    projectId: string,
    module: CulturalModule,
    currentTurn: number,
  ): Promise<CulturalBrief | null> {
    await this.ensureDirs();
    // Look for most recent brief for this project+module
    const files = await fs.readdir(BRIEFS_DIR).catch(() => []);
    const prefix = `${projectId}_${module}_`;
    const matching = files
      .filter(f => f.startsWith(prefix) && f.endsWith(".json"))
      .sort()
      .reverse();

    if (matching.length === 0) return null;

    const latest = JSON.parse(
      await fs.readFile(path.join(BRIEFS_DIR, matching[0]), "utf-8"),
    ) as BriefCacheEntry;

    // Stale check: brief is stale if generated more than 2 turns ago
    if (latest.staleAfterTurn < currentTurn) return null;

    return latest.brief;
  }

  /**
   * Get the most recent brief from ANY module for this project.
   * Used as a cross-module fallback when a new module has no briefs yet.
   * No staleness check — caller decides whether to use it.
   */
  async getMostRecentBriefAnyModule(projectId: string): Promise<CulturalBrief | null> {
    await this.ensureDirs();
    const files = await fs.readdir(BRIEFS_DIR).catch(() => []);
    const prefix = `${projectId}_`;
    const matching = files
      .filter(f => f.startsWith(prefix) && f.endsWith(".json"))
      .sort()
      .reverse();

    if (matching.length === 0) return null;

    const latest = JSON.parse(
      await fs.readFile(path.join(BRIEFS_DIR, matching[0]), "utf-8"),
    ) as BriefCacheEntry;

    return latest.brief;
  }

  async saveBrief(brief: CulturalBrief): Promise<void> {
    await this.ensureDirs();
    const entry: BriefCacheEntry = {
      brief,
      createdAt: new Date().toISOString(),
      staleAfterTurn: brief.afterTurn + 2, // Stale after 2 turns
    };
    const filename = `${brief.projectId}_${brief.module}_${String(brief.afterTurn).padStart(3, "0")}.json`;
    await fs.writeFile(
      path.join(BRIEFS_DIR, filename),
      JSON.stringify(entry, null, 2),
    );
  }

  // ── Grounding Brief Cache ──

  async getCachedGroundingBrief(
    projectId: string,
    module: CulturalModule,
    currentTurn: number,
  ): Promise<GroundingBrief | null> {
    await this.ensureDirs();
    const files = await fs.readdir(GROUNDING_DIR).catch(() => []);
    const prefix = `${projectId}_${module}_`;
    const matching = files
      .filter(f => f.startsWith(prefix) && f.endsWith(".json"))
      .sort()
      .reverse();

    if (matching.length === 0) return null;

    const latest = JSON.parse(
      await fs.readFile(path.join(GROUNDING_DIR, matching[0]), "utf-8"),
    ) as GroundingCacheEntry;

    // Tighter staleness: grounding goes stale after 1 turn (sensitive to pivots)
    if (latest.staleAfterTurn < currentTurn) return null;

    return latest.brief;
  }

  async saveGroundingBrief(brief: GroundingBrief): Promise<void> {
    await this.ensureDirs();
    const entry: GroundingCacheEntry = {
      brief,
      createdAt: new Date().toISOString(),
      staleAfterTurn: brief.afterTurn + 1, // Stale after 1 turn (tighter than cultural's 2)
    };
    const filename = `${brief.projectId}_${brief.module}_${String(brief.afterTurn).padStart(3, "0")}.json`;
    await fs.writeFile(
      path.join(GROUNDING_DIR, filename),
      JSON.stringify(entry, null, 2),
    );
  }

  // ── Decision Ledger ──

  async getLedger(projectId: string): Promise<CulturalDecisionLedger> {
    await this.ensureDirs();
    try {
      const raw = await fs.readFile(
        path.join(LEDGERS_DIR, `${projectId}.json`),
        "utf-8",
      );
      return JSON.parse(raw) as CulturalDecisionLedger;
    } catch {
      return { decisions: [], negativeProfile: [] };
    }
  }

  async saveLedger(projectId: string, ledger: CulturalDecisionLedger): Promise<void> {
    await this.ensureDirs();
    await fs.writeFile(
      path.join(LEDGERS_DIR, `${projectId}.json`),
      JSON.stringify(ledger, null, 2),
    );
  }

  async recordDecision(projectId: string, decision: CulturalDecision): Promise<void> {
    const ledger = await this.getLedger(projectId);
    ledger.decisions.push(decision);
    // Update negative profile from rejections
    if (decision.outcome === "rejected") {
      ledger.negativeProfile.push(decision.offered);
      // Keep negative profile bounded (last 20 rejections)
      if (ledger.negativeProfile.length > 20) {
        ledger.negativeProfile = ledger.negativeProfile.slice(-20);
      }
    }
    await this.saveLedger(projectId, ledger);
  }

  // ── Influence Log ──

  async getInfluenceLog(projectId: string): Promise<CulturalInfluenceLog> {
    await this.ensureDirs();
    try {
      const raw = await fs.readFile(
        path.join(INFLUENCE_DIR, `${projectId}.json`),
        "utf-8",
      );
      return JSON.parse(raw) as CulturalInfluenceLog;
    } catch {
      return { entries: [] };
    }
  }

  async logInfluence(projectId: string, entry: InfluenceLogEntry): Promise<void> {
    const log = await this.getInfluenceLog(projectId);
    log.entries.push(entry);
    // Keep bounded (last 50 entries)
    if (log.entries.length > 50) {
      log.entries = log.entries.slice(-50);
    }
    await fs.writeFile(
      path.join(INFLUENCE_DIR, `${projectId}.json`),
      JSON.stringify(log, null, 2),
    );
  }

  // ── Creative Insights ──

  async getInsights(projectId: string): Promise<CreativeInsightsLedger> {
    await this.ensureDirs();
    try {
      const raw = await fs.readFile(
        path.join(INSIGHTS_DIR, `${projectId}.json`),
        "utf-8",
      );
      return JSON.parse(raw) as CreativeInsightsLedger;
    } catch {
      return { projectId, insights: [], lastUpdatedAt: new Date().toISOString() };
    }
  }

  async saveInsights(ledger: CreativeInsightsLedger): Promise<void> {
    await this.ensureDirs();
    await fs.writeFile(
      path.join(INSIGHTS_DIR, `${ledger.projectId}.json`),
      JSON.stringify(ledger, null, 2),
    );
  }

  async addInsight(projectId: string, insight: CreativeInsight): Promise<void> {
    const ledger = await this.getInsights(projectId);
    ledger.insights.push(insight);
    // Evict lowest times_utilized active insights when over capacity
    if (ledger.insights.length > MAX_INSIGHTS) {
      const active = ledger.insights
        .filter(i => i.status === "active")
        .sort((a, b) => a.times_injected - b.times_injected);
      if (active.length > 0) {
        const evictId = active[0].id;
        ledger.insights = ledger.insights.filter(i => i.id !== evictId);
      } else {
        // All superseded — drop the oldest
        ledger.insights.shift();
      }
    }
    ledger.lastUpdatedAt = new Date().toISOString();
    await this.saveInsights(ledger);
  }

  async markUtilized(projectId: string, insightIds: string[]): Promise<void> {
    if (insightIds.length === 0) return;
    const ledger = await this.getInsights(projectId);
    const idSet = new Set(insightIds);
    for (const insight of ledger.insights) {
      if (idSet.has(insight.id)) {
        insight.times_utilized.push(true);
      }
    }
    ledger.lastUpdatedAt = new Date().toISOString();
    await this.saveInsights(ledger);
  }

  // ── Cleanup ──

  async deleteProject(projectId: string): Promise<void> {
    await this.ensureDirs();
    // Delete all briefs for this project
    const files = await fs.readdir(BRIEFS_DIR).catch(() => []);
    for (const f of files) {
      if (f.startsWith(`${projectId}_`)) {
        await fs.unlink(path.join(BRIEFS_DIR, f)).catch(() => {});
      }
    }
    // Delete ledger, influence log, and insights
    await fs.unlink(path.join(LEDGERS_DIR, `${projectId}.json`)).catch(() => {});
    await fs.unlink(path.join(INFLUENCE_DIR, `${projectId}.json`)).catch(() => {});
    await fs.unlink(path.join(INSIGHTS_DIR, `${projectId}.json`)).catch(() => {});
  }
}
