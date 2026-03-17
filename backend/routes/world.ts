import { Router } from "express";
import fs from "fs/promises";
import nodePath from "path";
import { worldFeatureFlagGuard } from "../middleware/worldFeatureFlagGuard";
import { worldService, culturalStore, llmClient } from "../services/runtime";
import { handleRouteError, getModelOverride, debugGuard, createRequestAbort } from "./routeUtils";
import { buildInflightKey, acquireInflight, releaseInflight } from "../services/inflightGuard";

export const worldRoutes = Router();

worldRoutes.use(worldFeatureFlagGuard);

const handleError = (res: any, err: unknown) => handleRouteError(res, err, "WORLD");

// ─── Preview Prompt ───

worldRoutes.post("/preview-prompt", async (req, res) => {
  const { projectId, stage } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }
  if (!stage || !["clarifier", "builder", "judge", "polish", "summary"].includes(stage)) {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "stage must be clarifier|builder|judge|polish|summary" });
  }

  try {
    const result = await worldService.previewPrompt(projectId, stage);
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

// ─── Clarify ───

worldRoutes.post("/clarify", async (req, res) => {
  const modelOverride = getModelOverride(req.header("X-Model-Override"));
  const {
    projectId,
    characterImageProjectId,
    characterProjectId,
    hookProjectId,
    userSelection,
    promptOverrides,
    assumptionResponses,
    worldSeed,
  } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }
  if (characterImageProjectId !== undefined && typeof characterImageProjectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "characterImageProjectId must be a string if provided" });
  }
  if (!characterProjectId || typeof characterProjectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "characterProjectId is required" });
  }
  if (!hookProjectId || typeof hookProjectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "hookProjectId is required" });
  }

  const inflightKey = buildInflightKey(projectId, "world", "clarify");
  if (!acquireInflight(inflightKey)) {
    return res.status(409).json({ error: true, code: "IN_FLIGHT", message: "A clarifier turn is already in progress for this project" });
  }

  const { signal, cleanup } = createRequestAbort(req);
  llmClient.setDefaultAbortSignal(signal);
  try {
    const result = await worldService.runClarifierTurn(
      projectId,
      characterImageProjectId,
      characterProjectId,
      hookProjectId,
      userSelection,
      modelOverride,
      promptOverrides,
      assumptionResponses,
      worldSeed,
    );
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  } finally {
    llmClient.setDefaultAbortSignal(undefined);
    cleanup();
    releaseInflight(inflightKey);
  }
});

// ─── Generate (builder + judge) ───

worldRoutes.post("/generate", async (req, res) => {
  const modelOverride = getModelOverride(req.header("X-Model-Override"));
  const { projectId, promptOverrides } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }

  const inflightKey = buildInflightKey(projectId, "world", "generate");
  if (!acquireInflight(inflightKey)) {
    return res.status(409).json({ error: true, code: "IN_FLIGHT", message: "World generation is already in progress for this project" });
  }

  const { signal, cleanup } = createRequestAbort(req);
  llmClient.setDefaultAbortSignal(signal);
  try {
    const result = await worldService.runGenerate(projectId, modelOverride, promptOverrides);
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  } finally {
    llmClient.setDefaultAbortSignal(undefined);
    cleanup();
    releaseInflight(inflightKey);
  }
});

// ─── Reroll ───

worldRoutes.post("/reroll", async (req, res) => {
  const modelOverride = getModelOverride(req.header("X-Model-Override"));
  const { projectId, promptOverrides, constraintOverrides } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }

  try {
    const result = await worldService.reroll(projectId, modelOverride, promptOverrides, constraintOverrides);
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

// ─── Lock ───

worldRoutes.post("/lock", async (req, res) => {
  const modelOverride = getModelOverride(req.header("X-Model-Override"));
  const { projectId } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }

  try {
    const result = await worldService.lockWorld(projectId, modelOverride);
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

// ─── Export Session ───

worldRoutes.get("/export-session/:projectId", async (req, res) => {
  try {
    const session = await worldService.getSession(req.params.projectId);
    if (!session) {
      return res.status(404).json({ error: true, code: "NOT_FOUND", message: "World session not found" });
    }
    return res.json(session);
  } catch (err) {
    return handleError(res, err);
  }
});

// ─── Debug Psychology ───

worldRoutes.get("/debug/insights/:projectId", debugGuard, async (req, res) => {
  try {
    const session = await worldService.getSession(req.params.projectId);
    const psychologyLedger = session?.psychologyLedger ?? null;
    let culturalBrief = null;
    try {
      culturalBrief = await culturalStore.getCachedBrief(req.params.projectId, "world", 0);
    } catch (err) { console.warn("[WORLD] no cached cultural brief:", err); }
    const divergenceMap = psychologyLedger?.lastDirectionMap ?? null;
    const developmentTargets = session?.developmentTargets ?? [];
    return res.json({ psychologyLedger, culturalBrief, divergenceMap, developmentTargets });
  } catch (err) {
    return handleError(res, err);
  }
});

worldRoutes.get("/debug/psychology/:projectId", debugGuard, async (req, res) => {
  try {
    const session = await worldService.getSession(req.params.projectId);
    if (!session?.psychologyLedger) {
      return res.json({ psychologyLedger: null });
    }
    return res.json({ psychologyLedger: session.psychologyLedger });
  } catch (err) {
    return handleError(res, err);
  }
});

/** List all available world sessions (for the Plot module to discover) */
worldRoutes.get("/list-sessions", async (_req, res) => {
  try {
    const dataDir = "./data/worlds";
    const exportDir = nodePath.join(dataDir, "exports");

    let sessionFiles: string[] = [];
    try {
      const allFiles: string[] = await fs.readdir(dataDir);
      sessionFiles = allFiles.filter((f: string) => f.endsWith(".json"));
    } catch (err) { console.warn("[WORLD] readdir failed:", err); }

    const sessions: Array<{
      projectId: string;
      characterImageProjectId?: string;
      characterProjectId: string;
      hookProjectId: string;
      status: string;
      turnCount: number;
      hasExport: boolean;
    }> = [];

    for (const file of sessionFiles) {
      try {
        const raw = await fs.readFile(nodePath.join(dataDir, file), "utf-8");
        const session = JSON.parse(raw);

        // Check if export exists
        let hasExport = false;
        try {
          await fs.readFile(nodePath.join(exportDir, file), "utf-8");
          hasExport = true;
        } catch (err) { console.warn("[WORLD] non-critical error:", err); }

        sessions.push({
          projectId: session.projectId,
          characterImageProjectId: session.characterImageProjectId,
          characterProjectId: session.characterProjectId ?? "",
          hookProjectId: session.hookProjectId ?? "",
          status: session.status,
          turnCount: session.turns?.length ?? 0,
          hasExport,
        });
      } catch (err) { console.warn("[WORLD] skipping corrupt file:", err); }
    }

    return res.json({ sessions });
  } catch (err) {
    return handleError(res, err);
  }
});

// ─── Session endpoints (/:projectId MUST be last) ───

worldRoutes.get("/:projectId", async (req, res) => {
  try {
    const session = await worldService.getSession(req.params.projectId);
    if (!session) {
      return res.status(404).json({ error: true, code: "NOT_FOUND", message: "World session not found" });
    }
    return res.json(session);
  } catch (err) {
    return handleError(res, err);
  }
});

worldRoutes.delete("/:projectId", async (req, res) => {
  try {
    await worldService.resetSession(req.params.projectId);
    return res.json({ deleted: true });
  } catch (err) {
    return handleError(res, err);
  }
});
