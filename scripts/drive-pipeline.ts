#!/usr/bin/env tsx
/**
 * Drive remaining pipeline stages for an existing v2 project.
 * Usage: npx tsx scripts/drive-pipeline.ts <projectId>
 */

import "dotenv/config";
import { writeFile, mkdir } from "fs/promises";

const BASE_URL = process.env.PIPELINE_BASE_URL ?? "http://localhost:3001";
const V2_API = `${BASE_URL}/api/v2/project`;

const projectId = process.argv[2];
if (!projectId) {
  console.error("Usage: npx tsx scripts/drive-pipeline.ts <projectId>");
  process.exit(1);
}

function log(phase: string, msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] [${phase}] ${msg}`);
}

async function api(method: string, path: string, body?: any): Promise<any> {
  const url = `${V2_API}${path}`;
  const opts: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { _raw: text, _status: res.status }; }
}

async function poll(path: string, statusField: string, timeoutMs = 900_000): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await api("GET", path);
    if (result[statusField] === "complete") return result;
    if (result[statusField] === "failed" || result.error) {
      throw new Error(`Failed: ${result.error ?? JSON.stringify(result)}`);
    }

    const project = await api("GET", `/${projectId}`);
    const step = project?.project?.step;
    if (step === "failed") throw new Error(`Project failed: ${project.project.error}`);

    const elapsed = ((Date.now() - start) / 1000).toFixed(0);
    const subSteps = project?.project?.checkpoint?.completedSubSteps;
    log("poll", `${elapsed}s — step: ${step}, sub-steps: ${subSteps?.join(", ") ?? "..."}`);
    await new Promise(r => setTimeout(r, 4000));
  }
  throw new Error(`Timeout after ${timeoutMs}ms`);
}

async function main() {
  log("START", `Project: ${projectId}`);

  // Check current state
  const state = await api("GET", `/${projectId}`);
  const step = state?.project?.step;
  log("STATE", `Current step: ${step}`);

  // Generate bible
  if (step === "premise_review") {
    log("BIBLE", "Generating bible + scene plan...");
    const r = await api("POST", `/${projectId}/generate-bible`);
    if (r.error) throw new Error(r.error);
    log("BIBLE", `Operation: ${r.operationId}`);
    const bible = await poll(`/${projectId}/bible`, "status");
    const chars = Object.keys(bible.storyBible?.characters ?? {}).length;
    const scenes = bible.scenePlan?.scenes?.length ?? 0;
    log("BIBLE", `Done: ${chars} characters, ${scenes} scenes planned`);
  }

  // Approve scene plan
  const afterBible = await api("GET", `/${projectId}`);
  if (afterBible?.project?.step === "scene_review") {
    log("APPROVE", "Auto-approving scene plan...");
    const r = await api("POST", `/${projectId}/review-scenes`, { action: "approve" });
    if (r.error) throw new Error(r.error);
    log("APPROVE", "Scene plan approved");
  }

  // Generate scenes
  const afterApprove = await api("GET", `/${projectId}`);
  if (afterApprove?.project?.step === "scene_approved") {
    log("SCENES", "Generating scenes...");
    const r = await api("POST", `/${projectId}/generate-scenes`);
    if (r.error) throw new Error(r.error);
    log("SCENES", `Operation: ${r.operationId}`);
    const result = await poll(`/${projectId}/scenes`, "status");
    log("SCENES", `Done: ${result.scenes?.length ?? 0} scenes generated`);
  }

  // Export
  log("EXPORT", "Exporting...");
  const exp = await api("GET", `/${projectId}/export`);
  const outDir = "./data/pipeline-output";
  await mkdir(outDir, { recursive: true });
  const outPath = `${outDir}/${projectId}.json`;
  await writeFile(outPath, JSON.stringify(exp, null, 2), "utf-8");
  log("EXPORT", `Saved to ${outPath}`);

  log("DONE", "Pipeline complete. Run postproduction next.");
}

main().catch(err => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
