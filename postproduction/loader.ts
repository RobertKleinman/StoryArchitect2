/**
 * PIPELINE OUTPUT LOADER
 * ══════════════════════
 * Assembles a PipelineOutput from the pipeline's export files.
 * Handles both the multi-file export format (separate hook/char/world/scene exports)
 * and a single combined JSON.
 */

import { readFile } from "fs/promises";
import type {
  PipelineOutput,
  PipelinePremise,
  PipelineStoryBible,
  PipelineScene,
  VNScene,
} from "./types";

/** Load from a scene export file (the most complete artifact) and resolve references */
export async function loadFromSceneExport(sceneExportPath: string): Promise<PipelineOutput> {
  const raw = JSON.parse(await readFile(sceneExportPath, "utf-8"));

  const hookProjectId = raw.hookProjectId;
  const characterProjectId = raw.characterProjectId;
  const worldProjectId = raw.worldProjectId;

  // Load referenced exports
  const baseDir = sceneExportPath.replace(/[/\\]scenes[/\\]exports[/\\].*$/, "");

  const hookExport = await tryLoadExport(baseDir, "exports", hookProjectId);
  const charExport = await tryLoadExport(baseDir, "characters/exports", characterProjectId);
  const worldExport = await tryLoadExport(baseDir, "worlds/exports", worldProjectId);

  // Extract premise from hook
  const hookLocked = hookExport?.hookPack?.locked ?? {};
  const premise: PipelinePremise = {
    hook_sentence: hookLocked.hook_sentence ?? "(untitled)",
    emotional_promise: hookLocked.emotional_promise,
    premise_paragraph: hookLocked.premise,
    synopsis: hookLocked.synopsis,
    tone_chips: hookLocked.tone_chips,
    setting_anchor: hookLocked.setting_anchor,
    core_conflict: hookLocked.core_conflict,
  };

  // Extract characters
  const charLocked = charExport?.characterPack?.locked ?? {};
  const characters = charLocked.characters ?? {};

  // Extract world/locations
  const worldLocked = worldExport?.worldPack?.locked ?? {};
  const locations = worldLocked.arena?.locations ?? [];

  const storyBible: PipelineStoryBible = {
    characters,
    world: {
      arena: {
        locations,
        edges: worldLocked.arena?.edges,
      },
    },
    relationships: charLocked.relationship_tensions,
  };

  // Extract scenes
  const scenePack = raw.scenePack ?? raw;
  const rawScenes: any[] = scenePack.scenes ?? [];
  const scenes: PipelineScene[] = rawScenes.map((s: any) => ({
    scene_id: s.scene_id,
    state: s.state,
    plan: s.plan,
    builder_output: s.builder_output,
    vn_scene: s.builder_output?.vn_scene ?? s.vn_scene,
  }));

  const seed = hookExport?.seedInput;

  return { premise, storyBible, scenes, seed };
}

/** Load from a single combined JSON (e.g., v2 pipeline output or manually assembled) */
export async function loadFromCombinedJSON(path: string): Promise<PipelineOutput> {
  const raw = JSON.parse(await readFile(path, "utf-8"));

  // If it has the expected top-level structure, use directly
  if (raw.premise && raw.storyBible && raw.scenes) {
    return raw as PipelineOutput;
  }

  // If it's a scene export, delegate
  if (raw.scenePack) {
    return loadFromSceneExport(path);
  }

  throw new Error("Unrecognized JSON format — expected premise + storyBible + scenes, or a scene export with scenePack");
}

/** Extract the VNScene from a PipelineScene (handles nesting variations) */
export function extractVNScene(scene: PipelineScene): VNScene | null {
  return scene.vn_scene ?? scene.builder_output?.vn_scene ?? null;
}

// ── Helpers ──

async function tryLoadExport(baseDir: string, subdir: string, projectId: string | undefined): Promise<any> {
  if (!projectId) return null;
  const path = `${baseDir}/${subdir}/${projectId}.json`;
  try {
    return JSON.parse(await readFile(path, "utf-8"));
  } catch {
    return null;
  }
}
