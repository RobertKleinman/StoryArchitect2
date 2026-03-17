import { Router } from "express";
import fs from "fs/promises";
import nodePath from "path";
import { sceneFeatureFlagGuard } from "../middleware/sceneFeatureFlagGuard";
import { sceneService, sceneStore, culturalStore, llmClient } from "../services/runtime";
import { handleRouteError, getModelOverride, debugGuard, createRequestAbort } from "./routeUtils";
import { buildInflightKey, acquireInflight, releaseInflight } from "../services/inflightGuard";

export const sceneRoutes = Router();

sceneRoutes.use(sceneFeatureFlagGuard);

const handleError = (res: any, err: unknown) => handleRouteError(res, err, "SCENE");

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

  const inflightKey = buildInflightKey(projectId, "scene", "clarify");
  if (!acquireInflight(inflightKey)) {
    return res.status(409).json({ error: true, code: "IN_FLIGHT", message: "A scene clarifier turn is already in progress for this project" });
  }

  const { signal, cleanup } = createRequestAbort(req);
  llmClient.setDefaultAbortSignal(signal);
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
  } finally {
    llmClient.setDefaultAbortSignal(undefined);
    cleanup();
    releaseInflight(inflightKey);
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

  const inflightKey = buildInflightKey(projectId, "scene", "build");
  if (!acquireInflight(inflightKey)) {
    return res.status(409).json({ error: true, code: "IN_FLIGHT", message: "Scene building is already in progress for this project" });
  }

  const { signal, cleanup } = createRequestAbort(req);
  llmClient.setDefaultAbortSignal(signal);
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
  } finally {
    llmClient.setDefaultAbortSignal(undefined);
    cleanup();
    releaseInflight(inflightKey);
  }
});

// ─── Generate All (skip clarification, build sequentially) ───

/** POST /api/scene/generate-all — build all scenes sequentially, skipping per-scene clarification */
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

  const inflightKey = buildInflightKey(projectId, "scene", "judge");
  if (!acquireInflight(inflightKey)) {
    return res.status(409).json({ error: true, code: "IN_FLIGHT", message: "Scene judging is already in progress for this project" });
  }

  const { signal, cleanup } = createRequestAbort(req);
  llmClient.setDefaultAbortSignal(signal);
  try {
    const judge = await sceneService.runFinalJudge(projectId, modelOverride, promptOverrides);
    return res.json({ judge });
  } catch (err) {
    return handleError(res, err);
  } finally {
    llmClient.setDefaultAbortSignal(undefined);
    cleanup();
    releaseInflight(inflightKey);
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

sceneRoutes.get("/debug/insights/:projectId", debugGuard, async (req, res) => {
  try {
    const session = await sceneService.getSession(req.params.projectId);
    const psychologyLedger = session?.psychologyLedger ?? null;
    let culturalBrief = null;
    try {
      culturalBrief = await culturalStore.getCachedBrief(req.params.projectId, "scene", 0);
    } catch (err) { console.warn("[SCENE] no cached cultural brief:", err); }
    const divergenceMap = psychologyLedger?.lastDirectionMap ?? null;
    const developmentTargets = session?.developmentTargets ?? [];
    return res.json({ psychologyLedger, culturalBrief, divergenceMap, developmentTargets });
  } catch (err) {
    return handleError(res, err);
  }
});

/** GET /api/scene/debug/scenes/:projectId — testing sidebar: raw scene output */
sceneRoutes.get("/debug/scenes/:projectId", debugGuard, async (req, res) => {
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
sceneRoutes.get("/debug/psychology/:projectId", debugGuard, async (req, res) => {
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
    } catch (err) { console.warn("[SCENE] readdir failed:", err); }

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
        } catch (err) { console.warn("[SCENE] non-critical error:", err); }

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
      } catch (err) { console.warn("[SCENE] skipping corrupt file:", err); }
    }

    return res.json({ sessions });
  } catch (err) {
    return handleError(res, err);
  }
});

// ─── Pre-Scene Audit (Issue 6) ───

/** GET /api/scene/audit/:projectId — aggregate weaknesses from locked upstream packs */
sceneRoutes.get("/audit/:projectId", async (req, res) => {
  try {
    const session = await sceneService.getSession(req.params.projectId);
    if (!session) {
      return res.status(404).json({ error: true, code: "NOT_FOUND", message: "Scene session not found" });
    }

    // Collect all targets from upstream packs
    const allTargets: Array<{
      id: string; source_module: string; target: string; status: string;
      notes?: string; current_gap?: string; suggestion?: string;
    }> = [];
    const seenIds = new Set<string>();

    // 1. Accumulated development_targets from the plot pack (carries upstream targets)
    const plotTargets = session.sourcePlotPack?.development_targets ?? [];
    for (const t of plotTargets) {
      if (!seenIds.has(t.id)) {
        seenIds.add(t.id);
        allTargets.push(t);
      }
    }

    // 2. Plot pack weaknesses
    const plotWeaknesses = session.sourcePlotPack?.weaknesses ?? [];
    for (let i = 0; i < plotWeaknesses.length; i++) {
      const w = plotWeaknesses[i];
      const id = `plot_w${i}`;
      if (!seenIds.has(id)) {
        seenIds.add(id);
        allTargets.push({
          id,
          source_module: "plot",
          target: w.area,
          status: "unaddressed",
          notes: w.weakness,
          suggestion: w.development_opportunity,
        });
      }
    }

    // 3. World pack weaknesses
    const worldWeaknesses = session.sourceWorldPack?.weaknesses ?? [];
    for (let i = 0; i < worldWeaknesses.length; i++) {
      const w = worldWeaknesses[i];
      const id = `world_w${i}`;
      if (!seenIds.has(id)) {
        seenIds.add(id);
        allTargets.push({
          id,
          source_module: "world",
          target: w.area,
          status: "unaddressed",
          notes: w.weakness,
          suggestion: w.development_opportunity,
        });
      }
    }

    // 4. Character pack weaknesses
    const charWeaknesses = session.sourceCharacterPack?.weaknesses ?? [];
    for (let i = 0; i < charWeaknesses.length; i++) {
      const w = charWeaknesses[i];
      const id = `char_w${i}`;
      if (!seenIds.has(id)) {
        seenIds.add(id);
        allTargets.push({
          id,
          source_module: "character",
          target: w.role ?? w.weakness,
          status: "unaddressed",
          notes: w.weakness,
          suggestion: w.development_opportunity,
        });
      }
    }

    // 5. Scene session development targets (deduped)
    const sessionTargets = session.developmentTargets ?? [];
    for (const t of sessionTargets) {
      if (!seenIds.has(t.id)) {
        seenIds.add(t.id);
        allTargets.push(t);
      }
    }

    // Classify by severity
    const critical: typeof allTargets & { severity: string }[] = [];
    const review: typeof allTargets & { severity: string }[] = [];
    const minor: typeof allTargets & { severity: string }[] = [];

    for (const t of allTargets) {
      const severity = t.status === "unaddressed" ? "critical"
        : t.status === "partially_addressed" ? "review"
        : "minor";
      const auditTarget = { ...t, severity };
      if (severity === "critical") critical.push(auditTarget);
      else if (severity === "review") review.push(auditTarget);
      else minor.push(auditTarget);
    }

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

/** POST /api/scene/audit/resolve — mark targets as deferred */
sceneRoutes.post("/audit/resolve", async (req, res) => {
  const { projectId, resolvedTargets } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }
  if (!Array.isArray(resolvedTargets)) {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "resolvedTargets must be an array" });
  }

  try {
    const session = await sceneService.getSession(projectId);
    if (!session) {
      return res.status(404).json({ error: true, code: "NOT_FOUND", message: "Scene session not found" });
    }

    const resolvedSet = new Set(resolvedTargets);
    const targets = session.developmentTargets ?? [];
    for (const t of targets) {
      if (resolvedSet.has(t.id)) {
        t.status = "deferred";
        t.notes = (t.notes ? t.notes + " | " : "") + "Deferred via pre-scene audit";
      }
    }

    // Save updated session via the store
    await sceneStore.save(session);

    const remaining = targets.filter(t => t.status !== "deferred" && t.status !== "addressed").length;
    return res.json({ resolved: resolvedTargets, remaining });
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
