#!/usr/bin/env tsx
/**
 * Injects a hook export into the v2 pipeline as an approved premise.
 * Creates a v2 project at the premise_review step, ready for bible generation.
 *
 * Usage: npx tsx scripts/inject-hook-to-v2.ts <hook-export.json>
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { randomUUID } from "crypto";

const hookPath = process.argv[2];
if (!hookPath) {
  console.error("Usage: npx tsx scripts/inject-hook-to-v2.ts <hook-export.json>");
  process.exit(1);
}

async function main() {
  const hook = JSON.parse(await readFile(hookPath, "utf-8"));
  const locked = hook.hookPack?.locked;
  if (!locked) {
    console.error("Hook export has no locked premise");
    process.exit(1);
  }

  const projectId = `v2_${randomUUID()}`;
  const now = new Date().toISOString();
  const operationId = randomUUID();

  // Build character sketches from the hook data
  const characters_sketch = [];
  if (locked.core_engine?.protagonist_role) {
    characters_sketch.push({
      name: "TBD",
      role: "protagonist" as const,
      one_liner: locked.core_engine.protagonist_role,
    });
  }
  if (locked.core_engine?.antagonist_form) {
    characters_sketch.push({
      name: "TBD",
      role: "antagonist" as const,
      one_liner: locked.core_engine.antagonist_form,
    });
  }

  const project = {
    step: "premise_review",
    projectId,
    createdAt: now,
    updatedAt: now,
    traces: [],
    psychologyLedger: hook.hookPack?.psychologyLedger ?? {
      reads: [],
      hypotheses: [],
      activeHypotheses: [],
    },
    constraintLedger: [],
    culturalInsights: [],
    premise: {
      state: "approved",
      operationId,
      hook_sentence: locked.hook_sentence,
      emotional_promise: locked.emotional_promise,
      premise_paragraph: locked.premise,
      synopsis: locked.premise, // Use premise as synopsis if no separate synopsis
      tone_chips: hook.hookPack?.preferences?.tone_chips ?? [],
      bans: hook.hookPack?.preferences?.bans ?? [],
      setting_anchor: locked.core_engine?.setting_anchor ?? "",
      time_period: "future",
      characters_sketch,
      core_conflict: locked.core_engine?.stakes ?? "",
      suggested_length: "long",
      suggested_cast: "small_ensemble",
    },
    reviewRound: 0,
    reviewTurns: [],
    // Preserve hook data for downstream reference
    _hookProjectId: hook.projectId,
    _hookExport: hook,
  };

  await mkdir("./data/v2", { recursive: true });
  await writeFile(`./data/v2/${projectId}.json`, JSON.stringify(project, null, 2), "utf-8");

  console.log(`Created v2 project: ${projectId}`);
  console.log(`Step: premise_review (approved)`);
  console.log(`Hook: ${locked.hook_sentence.slice(0, 80)}...`);
  console.log(`\nNext: curl -X POST http://localhost:3001/api/v2/project/${projectId}/generate-bible`);
}

main().catch(err => {
  console.error("Failed:", err);
  process.exit(1);
});
