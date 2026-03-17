import { Router } from "express";
import fs from "fs/promises";
import nodePath from "path";
import { featureFlagGuard } from "../middleware/featureFlagGuard";
import { hookService, projectStore, culturalStore, llmClient } from "../services/runtime";
import { handleRouteError, getModelOverride, debugGuard, createRequestAbort } from "./routeUtils";
import { buildInflightKey, acquireInflight, releaseInflight } from "../services/inflightGuard";

export const hookRoutes = Router();

hookRoutes.use(featureFlagGuard);

const handleError = (res: any, err: unknown) => handleRouteError(res, err, "HOOK");

hookRoutes.post("/preview-prompt", async (req, res) => {
  const { projectId, stage, seedInput, userSelection } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }
  if (!stage || !["clarifier", "builder", "judge", "summary"].includes(stage)) {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "stage must be clarifier|builder|judge|summary" });
  }

  try {
    const result = await hookService.previewPrompt(projectId, stage, seedInput, userSelection);
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

hookRoutes.post("/clarify", async (req, res) => {
  const modelOverride = getModelOverride(req.header("X-Model-Override"));
  const { projectId, seedInput, userSelection, assumptionResponses, promptOverrides } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }

  const inflightKey = buildInflightKey(projectId, "hook", "clarify");
  if (!acquireInflight(inflightKey)) {
    return res.status(409).json({ error: true, code: "IN_FLIGHT", message: "A clarifier turn is already in progress for this project" });
  }

  const { signal, cleanup } = createRequestAbort(req);
  llmClient.setDefaultAbortSignal(signal);
  try {
    const result = await hookService.runClarifierTurn(projectId, seedInput, userSelection, modelOverride, promptOverrides, assumptionResponses);
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  } finally {
    llmClient.setDefaultAbortSignal(undefined);
    cleanup();
    releaseInflight(inflightKey);
  }
});

hookRoutes.post("/generate", async (req, res) => {
  const modelOverride = getModelOverride(req.header("X-Model-Override"));
  const { projectId, promptOverrides } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }

  const inflightKey = buildInflightKey(projectId, "hook", "generate");
  if (!acquireInflight(inflightKey)) {
    return res.status(409).json({ error: true, code: "IN_FLIGHT", message: "Hook generation is already in progress for this project" });
  }

  const { signal, cleanup } = createRequestAbort(req);
  llmClient.setDefaultAbortSignal(signal);
  try {
    const result = await hookService.runTournament(projectId, modelOverride, promptOverrides);
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  } finally {
    llmClient.setDefaultAbortSignal(undefined);
    cleanup();
    releaseInflight(inflightKey);
  }
});

hookRoutes.post("/reroll", async (req, res) => {
  const modelOverride = getModelOverride(req.header("X-Model-Override"));
  const { projectId, promptOverrides, constraintOverrides } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }

  try {
    const result = await hookService.reroll(projectId, modelOverride, promptOverrides, constraintOverrides);
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

hookRoutes.post("/lock", async (req, res) => {
  const modelOverride = getModelOverride(req.header("X-Model-Override"));
  const { projectId, edits } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }

  try {
    const result = await hookService.lockHook(projectId, edits, modelOverride);
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

hookRoutes.get("/export-prompts/:projectId", async (req, res) => {
  try {
    const session = await hookService.getSession(req.params.projectId);
    if (!session) {
      return res.status(404).json({ error: true, code: "NOT_FOUND", message: "Session not found" });
    }
    const history = hookService.getPromptHistory(session);

    // Build a rich export with session context
    const exportData = {
      exportedAt: new Date().toISOString(),
      projectId: session.projectId,
      seedInput: session.seedInput,
      sessionStatus: session.status,
      totalTurns: session.turns.length,
      promptHistory: history,
      // Include the current default prompts for reference
      currentState: session.currentState,
      // Summary stats
      stats: {
        totalCalls: history.length,
        editedCalls: history.filter(h => h.wasEdited).length,
        stageBreakdown: {
          clarifier: history.filter(h => h.stage === "clarifier").length,
          builder: history.filter(h => h.stage === "builder").length,
          judge: history.filter(h => h.stage === "judge").length,
          summary: history.filter(h => h.stage === "summary").length,
        },
      },
    };

    return res.json(exportData);
  } catch (err) {
    return handleError(res, err);
  }
});

/** List all available hook sessions (for the next module to discover) */
hookRoutes.get("/list-sessions", async (_req, res) => {
  try {
    const dataDir = "./data";
    const exportDir = nodePath.join(dataDir, "exports");

    let allFiles: string[] = [];
    try {
      allFiles = await fs.readdir(dataDir);
    } catch (err) { console.warn("[HOOK] readdir failed:", err); }
    const sessionFiles = allFiles.filter((f: string) => f.endsWith(".json"));

    const sessions: Array<{
      projectId: string;
      status: string;
      turnCount: number;
      seedInput: string;
      hookSentence: string;
      premise: string;
      emotionalPromise: string;
      hasExport: boolean;
    }> = [];

    for (const file of sessionFiles) {
      try {
        const raw = await fs.readFile(nodePath.join(dataDir, file), "utf-8");
        const session = JSON.parse(raw);
        // Only include actual hook sessions (they have seedInput and turns)
        if (!session.projectId || !Array.isArray(session.turns)) continue;

        let hasExport = false;
        try {
          await fs.readFile(nodePath.join(exportDir, file), "utf-8");
          hasExport = true;
        } catch (err) { console.warn("[HOOK] non-critical error:", err); }

        const rh = session.revealedHook;
        sessions.push({
          projectId: session.projectId,
          status: session.status ?? "unknown",
          turnCount: session.turns?.length ?? 0,
          seedInput: session.seedInput ?? "",
          hookSentence: rh?.hook_sentence ?? "",
          premise: rh?.premise ?? "",
          emotionalPromise: rh?.emotional_promise ?? "",
          hasExport,
        });
      } catch (err) { console.warn("[HOOK] skipping corrupt file:", err); }
    }

    return res.json({ sessions });
  } catch (err) {
    return handleError(res, err);
  }
});

hookRoutes.get("/export-session/:projectId", async (req, res) => {
  try {
    // Try to get a previously saved export first
    let exportData = await projectStore.getExport(req.params.projectId);

    // If no saved export, generate one on the fly from the session
    if (!exportData) {
      const session = await hookService.getSession(req.params.projectId);
      if (!session) {
        return res.status(404).json({ error: true, code: "NOT_FOUND", message: "Session not found" });
      }
      exportData = await projectStore.saveExport(session);
    }

    return res.json(exportData);
  } catch (err) {
    return handleError(res, err);
  }
});

hookRoutes.get("/debug/insights/:projectId", debugGuard, async (req, res) => {
  try {
    const session = await hookService.getSession(req.params.projectId);
    const psychologyLedger = session?.psychologyLedger ?? null;
    let culturalBrief = null;
    try {
      culturalBrief = await culturalStore.getCachedBrief(req.params.projectId, "hook", 0);
    } catch (err) { console.warn("[HOOK] no cached cultural brief:", err); }
    const divergenceMap = psychologyLedger?.lastDirectionMap ?? null;
    const developmentTargets: any[] = [];
    return res.json({ psychologyLedger, culturalBrief, divergenceMap, developmentTargets });
  } catch (err) {
    return handleError(res, err);
  }
});

hookRoutes.get("/debug/psychology/:projectId", debugGuard, async (req, res) => {
  try {
    const session = await hookService.getSession(req.params.projectId);
    if (!session?.psychologyLedger) {
      return res.json({ psychologyLedger: null });
    }
    return res.json({ psychologyLedger: session.psychologyLedger });
  } catch (err) {
    return handleError(res, err);
  }
});

// /:projectId MUST be after all /debug/* and other static GET routes
hookRoutes.get("/:projectId", async (req, res) => {
  const modelOverride = getModelOverride(req.header("X-Model-Override"));
  try {
    const session = await hookService.getSession(req.params.projectId, modelOverride);
    if (!session) {
      return res.status(404).json({ error: true, code: "NOT_FOUND", message: "Session not found" });
    }
    return res.json(session);
  } catch (err) {
    return handleError(res, err);
  }
});

hookRoutes.delete("/:projectId", async (req, res) => {
  const modelOverride = getModelOverride(req.header("X-Model-Override"));
  try {
    await hookService.resetSession(req.params.projectId, modelOverride);
    return res.json({ deleted: true });
  } catch (err) {
    return handleError(res, err);
  }
});
