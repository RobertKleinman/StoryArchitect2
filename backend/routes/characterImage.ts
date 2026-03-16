import { Router } from "express";
import fs from "fs/promises";
import nodePath from "path";
import { characterImageFeatureFlagGuard } from "../middleware/characterImageFeatureFlagGuard";
import { characterImageService, characterImageStore, animeGenClient, culturalStore } from "../services/runtime";
import { handleRouteError, getModelOverride, debugGuard } from "./routeUtils";

export const characterImageRoutes = Router();

characterImageRoutes.use(characterImageFeatureFlagGuard);

const handleError = (res: any, err: unknown) => handleRouteError(res, err, "CHARACTER IMAGE");

characterImageRoutes.post("/preview-prompt", async (req, res) => {
  const { projectId, stage } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }
  if (!stage || !["clarifier", "builder", "judge", "polish", "summary"].includes(stage)) {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "stage must be clarifier|builder|judge|polish|summary" });
  }

  try {
    const result = await characterImageService.previewPrompt(projectId, stage);
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

characterImageRoutes.post("/apply-visual-edits", async (req, res) => {
  const { projectId, edits } = req.body ?? {};
  if (!projectId || !edits) {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId and edits are required" });
  }
  try {
    await characterImageService.applyVisualEdits(projectId, edits);
    return res.json({ ok: true });
  } catch (err) {
    return handleError(res, err);
  }
});

characterImageRoutes.post("/clarify", async (req, res) => {
  const modelOverride = getModelOverride(req.header("X-Model-Override"));
  const { projectId, characterProjectId, userSelection, assumptionResponses, promptOverrides, visualSeed } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }
  if (!characterProjectId || typeof characterProjectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "characterProjectId is required" });
  }

  try {
    const result = await characterImageService.runClarifierTurn(
      projectId, characterProjectId, userSelection, modelOverride, promptOverrides, assumptionResponses, visualSeed
    );
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

characterImageRoutes.post("/generate", async (req, res) => {
  const modelOverride = getModelOverride(req.header("X-Model-Override"));
  const { projectId, promptOverrides } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }

  try {
    const result = await characterImageService.runGenerate(projectId, modelOverride, promptOverrides);
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

characterImageRoutes.post("/reroll", async (req, res) => {
  const modelOverride = getModelOverride(req.header("X-Model-Override"));
  const { projectId, promptOverrides, constraintOverrides } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }

  try {
    const result = await characterImageService.reroll(projectId, modelOverride, promptOverrides, constraintOverrides);
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

characterImageRoutes.post("/generate-images", async (req, res) => {
  const { projectId, checkpoint, lora, quality, seed } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }
  if (!checkpoint || typeof checkpoint !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "checkpoint is required" });
  }

  try {
    const result = await characterImageService.generateImages(projectId, checkpoint, lora, quality, seed);
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

characterImageRoutes.post("/approve-image", async (req, res) => {
  const { projectId, role } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }
  if (!role || typeof role !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "role is required" });
  }

  try {
    const result = await characterImageService.approveCharacterImage(projectId, role);
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

characterImageRoutes.post("/redo-image", async (req, res) => {
  const { projectId, role, seed, checkpoint, lora, quality } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }
  if (!role || typeof role !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "role is required" });
  }

  const overrides = (checkpoint || lora !== undefined || quality)
    ? { checkpoint, lora, quality }
    : undefined;

  try {
    const result = await characterImageService.redoCharacterImage(projectId, role, seed, overrides);
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

characterImageRoutes.post("/lock", async (req, res) => {
  const modelOverride = getModelOverride(req.header("X-Model-Override"));
  const { projectId } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }

  try {
    const result = await characterImageService.lockImages(projectId, modelOverride);
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

// ─── Anime-Gen Proxy Endpoints (MUST be before /:projectId to avoid route conflicts) ───

characterImageRoutes.get("/anime-gen-status", async (_req, res) => {
  try {
    const status = await animeGenClient.checkStatus();
    return res.json(status);
  } catch (err) {
    return res.json({ connected: false });
  }
});

characterImageRoutes.get("/anime-gen-models", async (_req, res) => {
  try {
    const models = await animeGenClient.getModels();
    return res.json(models);
  } catch (err) {
    return res.status(503).json({ error: true, message: "Anime generator not available" });
  }
});

characterImageRoutes.get("/anime-gen-presets", async (_req, res) => {
  try {
    const presets = await animeGenClient.getPresets();
    return res.json(presets);
  } catch (err) {
    return res.status(503).json({ error: true, message: "Anime generator not available" });
  }
});

// ─── Session endpoints (/:projectId MUST be last) ───

characterImageRoutes.post("/skip", async (req, res) => {
  const { projectId, characterProjectId } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }
  if (!characterProjectId || typeof characterProjectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "characterProjectId is required" });
  }

  try {
    const result = await characterImageService.skipModule(projectId, characterProjectId);
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

characterImageRoutes.post("/set-art-style", async (req, res) => {
  const { projectId, style, customNote } = req.body ?? {};
  if (!projectId || !style) {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId and style are required" });
  }
  try {
    await characterImageService.setArtStyle(projectId, style, customNote);
    return res.json({ ok: true });
  } catch (err) {
    return handleError(res, err);
  }
});

characterImageRoutes.get("/debug/insights/:projectId", debugGuard, async (req, res) => {
  try {
    const session = await characterImageService.getSession(req.params.projectId);
    const psychologyLedger = session?.psychologyLedger ?? null;
    let culturalBrief = null;
    try {
      const turnNumber = session?.turns?.length ?? 99;
      culturalBrief = await culturalStore.getCachedBrief(req.params.projectId, "character_image", turnNumber + 10);
    } catch { /* no brief cached yet */ }
    const divergenceMap = psychologyLedger?.lastDirectionMap ?? null;
    const developmentTargets: any[] = [];
    return res.json({ psychologyLedger, culturalBrief, divergenceMap, developmentTargets });
  } catch (err) {
    return handleError(res, err);
  }
});

characterImageRoutes.get("/debug/psychology/:projectId", debugGuard, async (req, res) => {
  try {
    const session = await characterImageService.getSession(req.params.projectId);
    if (!session?.psychologyLedger) {
      return res.json({ psychologyLedger: null });
    }
    return res.json({ psychologyLedger: session.psychologyLedger });
  } catch (err) {
    return handleError(res, err);
  }
});

/** Get a character-image module export by project ID */
characterImageRoutes.get("/export-session/:projectId", async (req, res) => {
  try {
    const exportData = await characterImageStore.getExport(req.params.projectId);
    if (!exportData) {
      const session = await characterImageService.getSession(req.params.projectId);
      if (!session) {
        return res.status(404).json({ error: true, code: "NOT_FOUND", message: "Character image session not found" });
      }
      return res.status(400).json({
        error: true,
        code: "INVALID_INPUT",
        message: `Character image session exists but is not locked (status: ${session.status}). Lock the images first.`,
      });
    }
    return res.json(exportData);
  } catch (err) {
    return handleError(res, err);
  }
});

/** List all available character-image sessions (for the World module to discover) */
characterImageRoutes.get("/list-sessions", async (_req, res) => {
  try {
    const dataDir = "./data/characterImages";
    const exportDir = nodePath.join(dataDir, "exports");

    let sessionFiles: string[] = [];
    try {
      const allFiles: string[] = await fs.readdir(dataDir);
      sessionFiles = allFiles.filter((f: string) => f.endsWith(".json"));
    } catch { /* empty dir */ }

    const sessions: Array<{
      projectId: string;
      characterProjectId: string;
      status: string;
      turnCount: number;
      hasExport: boolean;
      artStyle: string;
      characterCount: number;
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

        const charCount = session.revealedSpecs
          ? Object.keys(session.revealedSpecs.characters ?? {}).length
          : 0;

        sessions.push({
          projectId: session.projectId,
          characterProjectId: session.characterProjectId ?? "",
          status: session.status,
          turnCount: session.turns?.length ?? 0,
          hasExport,
          artStyle: session.artStyle ?? "",
          characterCount: charCount,
        });
      } catch { /* skip corrupt files */ }
    }

    return res.json({ sessions });
  } catch (err) {
    return handleError(res, err);
  }
});

// /:projectId MUST be after all /debug/* and other static GET routes
characterImageRoutes.get("/:projectId", async (req, res) => {
  try {
    const session = await characterImageService.getSession(req.params.projectId);
    if (!session) {
      return res.status(404).json({ error: true, code: "NOT_FOUND", message: "Character image session not found" });
    }
    return res.json(session);
  } catch (err) {
    return handleError(res, err);
  }
});

characterImageRoutes.delete("/:projectId", async (req, res) => {
  try {
    await characterImageService.resetSession(req.params.projectId);
    return res.json({ deleted: true });
  } catch (err) {
    return handleError(res, err);
  }
});
