import { Router } from "express";
import fs from "fs/promises";
import nodePath from "path";
import { sceneFeatureFlagGuard } from "../middleware/sceneFeatureFlagGuard";
import { sceneService, sceneStore, culturalStore, plotStore, worldStore, characterImageStore, characterStore, projectStore } from "../services/runtime";
import { SceneServiceError } from "../services/sceneService";

export const sceneRoutes = Router();

sceneRoutes.use(sceneFeatureFlagGuard);

function getModelOverride(header: string | string[] | undefined): string | undefined {
  if (Array.isArray(header)) return header[0];
  return header;
}

function handleError(res: any, err: unknown) {
  console.error("SCENE ROUTE ERROR:", err);
  if (err instanceof SceneServiceError) {
    const status = err.code === "NOT_FOUND" ? 404
      : err.code === "INVALID_INPUT" ? 400
      : err.code === "LLM_PARSE_ERROR" ? 422
      : 502;
    return res.status(status).json({ error: true, code: err.code, message: err.message });
  }
  const msg = err instanceof Error ? err.message : "Unexpected server error";
  return res.status(500).json({ error: true, code: "LLM_CALL_FAILED", message: msg });
}

// ─── Phase 0: Planning ───

/** POST /api/scene/plan — initial planning: cluster beats into scenes + first plan clarifier turn */
sceneRoutes.post("/plan", async (req, res) => {
  const modelOverride = getModelOverride(req.header("X-Model-Override"));
  const { projectId, plotProjectId, promptOverrides } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }
  if (!plotProjectId || typeof plotProjectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "plotProjectId is required" });
  }

  try {
    const result = await sceneService.initPlan(projectId, plotProjectId, modelOverride, promptOverrides);
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

/** POST /api/scene/plan-clarify — refine the plan with user feedback */
sceneRoutes.post("/plan-clarify", async (req, res) => {
  const modelOverride = getModelOverride(req.header("X-Model-Override"));
  const { projectId, userSelection, assumptionResponses, promptOverrides } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }

  try {
    const result = await sceneService.clarifyPlan(
      projectId, userSelection, assumptionResponses, modelOverride, promptOverrides
    );
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

/** POST /api/scene/confirm-plan — user confirms the scene plan, transition to writing */
sceneRoutes.post("/confirm-plan", async (req, res) => {
  const { projectId } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }

  try {
    const result = await sceneService.confirmPlan(projectId);
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

// ─── Phase 1: Per-Scene Clarification ───

/** POST /api/scene/clarify — per-scene steering (or auto-pass) */
sceneRoutes.post("/clarify", async (req, res) => {
  const modelOverride = getModelOverride(req.header("X-Model-Override"));
  const { projectId, userSelection, assumptionResponses, promptOverrides } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }

  try {
    const result = await sceneService.clarifyScene(
      projectId, userSelection, assumptionResponses, modelOverride, promptOverrides
    );

    // If auto-build happened, include scene metadata for the frontend
    if (result.autoBuiltScene) {
      const session = await sceneService.getSession(projectId);
      return res.json({
        ...result,
        autoBuiltSceneIndex: result.sceneIndex,
        autoBuiltTotalScenes: result.totalScenes,
        allScenesBuilt: session ? session.currentSceneIndex >= (session.scenePlan?.length ?? 0) : false,
      });
    }

    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

// ─── Phase 2: Scene Building ───

/** POST /api/scene/build — build the current scene (builder + minor judge) */
sceneRoutes.post("/build", async (req, res) => {
  const modelOverride = getModelOverride(req.header("X-Model-Override"));
  const { projectId, promptOverrides } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }

  try {
    // Get session state before build to capture index info
    const sessionBefore = await sceneService.getSession(projectId);
    const sceneIndex = sessionBefore?.currentSceneIndex ?? 0;
    const totalScenes = sessionBefore?.scenePlan?.length ?? 0;

    const builtScene = await sceneService.buildScene(projectId, modelOverride, promptOverrides);
    return res.json({
      scene: builtScene,
      sceneIndex,
      totalScenes,
    });
  } catch (err) {
    return handleError(res, err);
  }
});

// ─── Generate All (batch build, skip clarification) ───

/** POST /api/scene/generate-all — build all scenes sequentially, skipping clarification */
sceneRoutes.post("/generate-all", async (req, res) => {
  const modelOverride = getModelOverride(req.header("X-Model-Override"));
  const { projectId } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }

  try {
    const result = await sceneService.generateAllScenes(projectId, modelOverride);
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

// ─── Phase 4: Final Judge ───

/** POST /api/scene/final-judge — intensive full-work assessment */
sceneRoutes.post("/final-judge", async (req, res) => {
  const modelOverride = getModelOverride(req.header("X-Model-Override"));
  const { projectId, promptOverrides } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }

  try {
    const judge = await sceneService.runFinalJudge(projectId, modelOverride, promptOverrides);
    return res.json({ judge });
  } catch (err) {
    return handleError(res, err);
  }
});

// ─── Complete ───

/** POST /api/scene/complete — lock and package ScenePack */
sceneRoutes.post("/complete", async (req, res) => {
  const { projectId } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }

  try {
    const result = await sceneService.complete(projectId);
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

// ─── Debug endpoints (MUST be before /:projectId) ───

/** GET /api/scene/debug/scenes/:projectId — testing sidebar: raw scene output */
sceneRoutes.get("/debug/scenes/:projectId", async (req, res) => {
  try {
    const session = await sceneService.getSession(req.params.projectId);
    if (!session) {
      return res.status(404).json({ error: true, code: "NOT_FOUND", message: "Scene session not found" });
    }

    const readableScenes = session.builtScenes.map(s => s.builder_output.readable);

    return res.json({
      builtScenes: session.builtScenes,
      readableScenes,
      scenePlan: session.scenePlan ?? null,
      narrativePreview: session.narrativePreview ?? null,
      rhythmSnapshot: session.rhythmSnapshot ?? null,
    });
  } catch (err) {
    return handleError(res, err);
  }
});

/** GET /api/scene/debug/psychology/:projectId — psychology ledger debug */
sceneRoutes.get("/debug/psychology/:projectId", async (req, res) => {
  try {
    const session = await sceneService.getSession(req.params.projectId);
    if (!session?.psychologyLedger) {
      return res.json({ psychologyLedger: null });
    }
    return res.json({ psychologyLedger: session.psychologyLedger });
  } catch (err) {
    return handleError(res, err);
  }
});

/** GET /api/scene/debug/insights/:projectId — unified engine insights panel */
sceneRoutes.get("/debug/insights/:projectId", async (req, res) => {
  try {
    const session = await sceneService.getSession(req.params.projectId);
    const psychologyLedger = session?.psychologyLedger ?? null;

    // Cultural brief
    let culturalBrief = null;
    try {
      const turnNumber = session?.planningTurns?.length ?? 0;
      culturalBrief = await culturalStore.getCachedBrief(req.params.projectId, "scene", turnNumber);
    } catch {}

    // Divergence map from psychology ledger
    const divergenceMap = psychologyLedger?.lastDirectionMap ?? null;

    // Development targets from session
    const developmentTargets = session?.developmentTargets ?? [];

    return res.json({ psychologyLedger, culturalBrief, divergenceMap, developmentTargets });
  } catch (err) {
    return handleError(res, err);
  }
});

// ─── Pre-Scene Audit (Issue 6) ───

/** GET /api/scene/audit/:projectId — aggregate weaknesses from all locked upstream packs */
sceneRoutes.get("/audit/:projectId", async (req, res) => {
  try {
    const session = await sceneService.getSession(req.params.projectId);

    // Collect weaknesses from all source packs stored on the session
    const allTargets: Array<{
      id: string;
      source_module: string;
      target: string;
      status: string;
      severity: "critical" | "review" | "minor";
      notes?: string;
      current_gap?: string;
      suggestion?: string;
    }> = [];

    let idCounter = 0;

    // Helper: classify severity based on status and quality hints
    function classifySeverity(status: string, quality?: string): "critical" | "review" | "minor" {
      if (status === "unaddressed") return "critical";
      if (status === "partially_addressed" && quality !== "strong") return "review";
      return "minor";
    }

    // 1. Development targets from the plot pack (aggregates all upstream targets)
    if (session?.sourcePlotPack?.development_targets) {
      for (const dt of session.sourcePlotPack.development_targets) {
        if (dt.status === "addressed" && (dt as any).quality === "strong") continue; // skip fully resolved
        allTargets.push({
          id: `dt-${++idCounter}`,
          source_module: dt.source_module,
          target: dt.target,
          status: dt.status,
          severity: classifySeverity(dt.status, (dt as any).quality),
          notes: dt.notes,
          current_gap: (dt as any).current_gap,
          suggestion: (dt as any).suggestion,
        });
      }
    }

    // 2. Weaknesses from plot pack itself
    if (session?.sourcePlotPack?.weaknesses) {
      for (const w of session.sourcePlotPack.weaknesses) {
        allTargets.push({
          id: `pw-${++idCounter}`,
          source_module: "plot",
          target: w.weakness,
          status: "unaddressed",
          severity: "review",
          notes: w.development_opportunity,
          current_gap: w.area,
          suggestion: w.development_opportunity,
        });
      }
    }

    // 3. Weaknesses from world pack
    if (session?.sourceWorldPack?.weaknesses) {
      for (const w of session.sourceWorldPack.weaknesses) {
        allTargets.push({
          id: `ww-${++idCounter}`,
          source_module: "world",
          target: w.weakness,
          status: "unaddressed",
          severity: "review",
          notes: w.development_opportunity,
          current_gap: w.area,
          suggestion: w.development_opportunity,
        });
      }
    }

    // 4. Weaknesses from character pack
    if (session?.sourceCharacterPack?.weaknesses) {
      for (const w of session.sourceCharacterPack.weaknesses) {
        allTargets.push({
          id: `cw-${++idCounter}`,
          source_module: "character",
          target: w.weakness,
          status: "unaddressed",
          severity: "review",
          notes: w.development_opportunity,
          current_gap: (w as any).role ?? "character",
          suggestion: w.development_opportunity,
        });
      }
    }

    // 5. Development targets already on the scene session (if any)
    if (session?.developmentTargets) {
      for (const dt of session.developmentTargets) {
        // Avoid duplicates — check if we already have this target
        const isDuplicate = allTargets.some(
          t => t.target === dt.target && t.source_module === dt.source_module
        );
        if (isDuplicate) continue;
        if (dt.status === "addressed" && (dt as any).quality === "strong") continue;
        allTargets.push({
          id: `sd-${++idCounter}`,
          source_module: dt.source_module,
          target: dt.target,
          status: dt.status,
          severity: classifySeverity(dt.status, (dt as any).quality),
          notes: dt.notes,
          current_gap: (dt as any).current_gap,
          suggestion: (dt as any).suggestion,
        });
      }
    }

    // Group by severity
    const critical = allTargets.filter(t => t.severity === "critical");
    const review = allTargets.filter(t => t.severity === "review");
    const minor = allTargets.filter(t => t.severity === "minor");

    return res.json({
      critical,
      review,
      minor,
      totalCount: allTargets.length,
    });
  } catch (err) {
    return handleError(res, err);
  }
});

/** POST /api/scene/audit/resolve — user accepts/resolves audit targets */
sceneRoutes.post("/audit/resolve", async (req, res) => {
  const { projectId, resolvedTargets } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }
  if (!Array.isArray(resolvedTargets)) {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "resolvedTargets array is required" });
  }

  try {
    const session = await sceneService.getSession(projectId);
    if (!session) {
      return res.status(404).json({ error: true, code: "NOT_FOUND", message: "Scene session not found" });
    }

    // Mark matching development targets as deferred/acknowledged
    const resolvedSet = new Set(resolvedTargets);
    let resolvedCount = 0;

    if (session.developmentTargets) {
      for (const dt of session.developmentTargets) {
        if (resolvedSet.has(dt.id) || resolvedSet.has(dt.target)) {
          dt.status = "deferred";
          dt.notes = (dt.notes ? dt.notes + " | " : "") + "User acknowledged in pre-scene audit";
          resolvedCount++;
        }
      }
    }

    const remaining = (session.developmentTargets ?? []).filter(
      dt => dt.status === "unaddressed" || dt.status === "partially_addressed"
    ).length;

    return res.json({
      resolved: resolvedTargets,
      remaining,
    });
  } catch (err) {
    return handleError(res, err);
  }
});

/** GET /api/scene/export-session/:projectId */
sceneRoutes.get("/export-session/:projectId", async (req, res) => {
  try {
    const exportData = await sceneStore.getExport(req.params.projectId);
    if (!exportData) {
      const session = await sceneService.getSession(req.params.projectId);
      if (!session) {
        return res.status(404).json({ error: true, code: "NOT_FOUND", message: "Scene session not found" });
      }
      return res.status(400).json({
        error: true,
        code: "INVALID_INPUT",
        message: `Scene session exists but is not complete (status: ${session.status}). Complete the scene module first.`,
      });
    }
    return res.json(exportData);
  } catch (err) {
    return handleError(res, err);
  }
});

/** List all available scene sessions */
sceneRoutes.get("/list-sessions", async (_req, res) => {
  try {
    const dataDir = "./data/scenes";
    const exportDir = nodePath.join(dataDir, "exports");

    let sessionFiles: string[] = [];
    try {
      const allFiles: string[] = await fs.readdir(dataDir);
      sessionFiles = allFiles.filter((f: string) => f.endsWith(".json"));
    } catch { /* empty dir */ }

    const sessions: Array<{
      projectId: string;
      plotProjectId: string;
      status: string;
      planningTurnCount: number;
      writingTurnCount: number;
      builtSceneCount: number;
      totalScenes: number;
      hasExport: boolean;
    }> = [];

    for (const file of sessionFiles) {
      try {
        const raw = await fs.readFile(nodePath.join(dataDir, file), "utf-8");
        const session = JSON.parse(raw);

        let hasExport = false;
        try {
          await fs.readFile(nodePath.join(exportDir, file), "utf-8");
          hasExport = true;
        } catch {}

        sessions.push({
          projectId: session.projectId,
          plotProjectId: session.plotProjectId ?? "",
          status: session.status,
          planningTurnCount: session.planningTurns?.length ?? 0,
          writingTurnCount: session.writingTurns?.length ?? 0,
          builtSceneCount: session.builtScenes?.length ?? 0,
          totalScenes: session.scenePlan?.length ?? 0,
          hasExport,
        });
      } catch { /* skip corrupt files */ }
    }

    return res.json({ sessions });
  } catch (err) {
    return handleError(res, err);
  }
});

// ─── Session endpoints (/:projectId MUST be last) ───

sceneRoutes.get("/:projectId", async (req, res) => {
  try {
    const session = await sceneService.getSession(req.params.projectId);
    if (!session) {
      return res.status(404).json({ error: true, code: "NOT_FOUND", message: "Scene session not found" });
    }
    return res.json(session);
  } catch (err) {
    return handleError(res, err);
  }
});

sceneRoutes.delete("/:projectId", async (req, res) => {
  try {
    await sceneService.resetSession(req.params.projectId);
    return res.json({ deleted: true });
  } catch (err) {
    return handleError(res, err);
  }
});
