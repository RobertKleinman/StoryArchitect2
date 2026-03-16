import { Router } from "express";
import fs from "fs/promises";
import nodePath from "path";
import { characterFeatureFlagGuard } from "../middleware/characterFeatureFlagGuard";
import { characterService, characterStore, culturalStore } from "../services/runtime";
import { handleRouteError, getModelOverride, debugGuard } from "./routeUtils";

export const characterRoutes = Router();

characterRoutes.use(characterFeatureFlagGuard);

const handleError = (res: any, err: unknown) => handleRouteError(res, err, "CHARACTER");

characterRoutes.post("/preview-prompt", async (req, res) => {
  const { projectId, stage } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }
  if (!stage || !["clarifier", "builder", "judge", "polish", "summary"].includes(stage)) {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "stage must be clarifier|builder|judge|polish|summary" });
  }

  try {
    const result = await characterService.previewPrompt(projectId, stage);
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

characterRoutes.post("/clarify", async (req, res) => {
  const modelOverride = getModelOverride(req.header("X-Model-Override"));
  const { projectId, hookProjectId, userSelection, assumptionResponses, promptOverrides, characterSeed } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }
  if (!hookProjectId || typeof hookProjectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "hookProjectId is required" });
  }

  try {
    const result = await characterService.runClarifierTurn(
      projectId, hookProjectId, userSelection, modelOverride, promptOverrides, assumptionResponses, characterSeed
    );
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

characterRoutes.post("/generate", async (req, res) => {
  const modelOverride = getModelOverride(req.header("X-Model-Override"));
  const { projectId, promptOverrides } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }

  try {
    const result = await characterService.runGenerate(projectId, modelOverride, promptOverrides);
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

characterRoutes.post("/reroll", async (req, res) => {
  const modelOverride = getModelOverride(req.header("X-Model-Override"));
  const { projectId, promptOverrides, constraintOverrides } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }

  try {
    const result = await characterService.reroll(projectId, modelOverride, promptOverrides, constraintOverrides);
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

characterRoutes.post("/lock", async (req, res) => {
  const modelOverride = getModelOverride(req.header("X-Model-Override"));
  const { projectId } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }

  try {
    const result = await characterService.lockCharacters(projectId, modelOverride);
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

// ─── Review endpoints (Issue 8) ───

characterRoutes.get("/review/:projectId", async (req, res) => {
  try {
    const result = await characterService.getCharacterReview(req.params.projectId);
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

characterRoutes.post("/review", async (req, res) => {
  const { projectId, edits } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId is required" });
  }
  if (!Array.isArray(edits)) {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "edits must be an array" });
  }

  try {
    const result = await characterService.applyCharacterReviewEdits(projectId, edits);
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

// ─── Export endpoints (MUST be before /:projectId) ───

/** Get a character module export by project ID */
characterRoutes.get("/export-session/:projectId", async (req, res) => {
  try {
    const exportData = await characterStore.getExport(req.params.projectId);
    if (!exportData) {
      // Maybe the session exists but hasn't been exported yet — check status
      const session = await characterService.getSession(req.params.projectId);
      if (!session) {
        return res.status(404).json({ error: true, code: "NOT_FOUND", message: "Character session not found" });
      }
      return res.status(400).json({
        error: true,
        code: "INVALID_INPUT",
        message: `Character session exists but is not locked (status: ${session.status}). Lock the characters first.`,
      });
    }
    return res.json(exportData);
  } catch (err) {
    return handleError(res, err);
  }
});

/** List all available character sessions (for the next module to discover) */
characterRoutes.get("/list-sessions", async (_req, res) => {
  try {
    // Use characterStore to scan for sessions instead of raw fs
    // We'll read known session IDs from localStorage keys sent by the frontend
    // OR we do a simple directory listing via Node's native fs
    const dataDir = "./data/characters";
    const exportDir = nodePath.join(dataDir, "exports");

    let sessionFiles: string[] = [];
    try {
      const allFiles: string[] = await fs.readdir(dataDir);
      sessionFiles = allFiles.filter((f: string) => f.endsWith(".json"));
    } catch { /* empty dir */ }

    const sessions: Array<{
      projectId: string;
      status: string;
      turnCount: number;
      castCount: number;
      characterRoles: string[];
      hasExport: boolean;
      ensembleDynamic: string;
    }> = [];

    for (const file of sessionFiles) {
      try {
        const raw = await fs.readFile(nodePath.join(dataDir, file), "utf-8");
        const session = JSON.parse(raw);
        const roles = Object.keys(session.characters ?? {});

        // Check if export exists
        let hasExport = false;
        try {
          await fs.readFile(nodePath.join(exportDir, file), "utf-8");
          hasExport = true;
        } catch {}

        sessions.push({
          projectId: session.projectId,
          status: session.status,
          turnCount: session.turns?.length ?? 0,
          castCount: roles.length,
          characterRoles: roles,
          hasExport,
          ensembleDynamic: session.revealedCharacters?.ensemble_dynamic ?? "",
        });
      } catch { /* skip corrupt files */ }
    }

    return res.json({ sessions });
  } catch (err) {
    return handleError(res, err);
  }
});

characterRoutes.get("/debug/insights/:projectId", debugGuard, async (req, res) => {
  try {
    const session = await characterService.getSession(req.params.projectId);
    const psychologyLedger = session?.psychologyLedger ?? null;
    let culturalBrief = null;
    try {
      const turnNumber = session?.turns?.length ?? 99;
      culturalBrief = await culturalStore.getCachedBrief(req.params.projectId, "character", turnNumber + 10);
    } catch { /* no brief cached yet */ }
    const divergenceMap = psychologyLedger?.lastDirectionMap ?? null;
    const developmentTargets: any[] = [];
    return res.json({ psychologyLedger, culturalBrief, divergenceMap, developmentTargets });
  } catch (err) {
    return handleError(res, err);
  }
});

characterRoutes.get("/debug/psychology/:projectId", debugGuard, async (req, res) => {
  try {
    const session = await characterService.getSession(req.params.projectId);
    if (!session?.psychologyLedger) {
      return res.json({ psychologyLedger: null });
    }
    return res.json({ psychologyLedger: session.psychologyLedger });
  } catch (err) {
    return handleError(res, err);
  }
});

// ─── Review (Issue #8 — "Meet your cast" last-tweaks before lock) ───

characterRoutes.get("/review/:projectId", async (req, res) => {
  try {
    const session = await characterService.getSession(req.params.projectId);
    if (!session?.revealedCharacters) {
      return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "Characters not yet generated" });
    }
    const characters = Object.entries(session.revealedCharacters.characters).map(([roleKey, profile]: [string, any]) => ({
      roleKey,
      role: profile.role,
      presentation: profile.presentation ?? "unspecified",
      age_range: profile.age_range ?? "",
      ethnicity: profile.ethnicity ?? "",
      description_summary: profile.description?.slice(0, 200) ?? "",
      confirmed_traits: Object.fromEntries(
        (session.constraintLedger ?? [])
          .filter((e: any) => e.key.startsWith(roleKey + ".") && e.confidence === "confirmed")
          .map((e: any) => [e.key.replace(roleKey + ".", ""), e.value]),
      ),
      inferred_traits: Object.fromEntries(
        (session.constraintLedger ?? [])
          .filter((e: any) => e.key.startsWith(roleKey + ".") && e.confidence === "inferred")
          .map((e: any) => [e.key.replace(roleKey + ".", ""), e.value]),
      ),
    }));
    return res.json({
      characters,
      ready: session.status === "revealed",
    });
  } catch (err) {
    return handleError(res, err);
  }
});

characterRoutes.post("/review", async (req, res) => {
  const { projectId, edits } = req.body ?? {};
  if (!projectId || !Array.isArray(edits)) {
    return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "projectId and edits[] are required" });
  }
  try {
    const session = await characterService.getSession(projectId);
    if (!session?.revealedCharacters) {
      return res.status(400).json({ error: true, code: "INVALID_INPUT", message: "Characters not yet generated" });
    }
    let applied = 0;
    for (const edit of edits) {
      const char = session.revealedCharacters.characters[edit.roleKey];
      if (char && edit.field && edit.value !== undefined) {
        (char as any)[edit.field] = edit.value;
        applied++;
      }
    }
    await characterStore.save(session);
    return res.json({ applied });
  } catch (err) {
    return handleError(res, err);
  }
});

// /:projectId MUST be after all /debug/* and other static GET routes
characterRoutes.get("/:projectId", async (req, res) => {
  try {
    const session = await characterService.getSession(req.params.projectId);
    if (!session) {
      return res.status(404).json({ error: true, code: "NOT_FOUND", message: "Character session not found" });
    }
    return res.json(session);
  } catch (err) {
    return handleError(res, err);
  }
});

characterRoutes.delete("/:projectId", async (req, res) => {
  try {
    await characterService.resetSession(req.params.projectId);
    return res.json({ deleted: true });
  } catch (err) {
    return handleError(res, err);
  }
});
