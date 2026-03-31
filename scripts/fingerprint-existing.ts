/**
 * Fingerprint all existing pipeline outputs.
 * Run once to seed the fingerprint database.
 */
import dotenv from "dotenv";
dotenv.config();

import { readFileSync, readdirSync } from "fs";
import { extractFingerprint, saveFingerprint } from "../shared/fingerprint";

async function main() {
  const dir = "./data/pipeline-output";
  const files = readdirSync(dir).filter(f => f.endsWith(".json"));
  console.log(`Found ${files.length} pipeline outputs`);

  for (const f of files) {
    const project = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
    const hasBible = !!project.storyBible?.characters;
    const hasScenes = !!project.scenePlan?.scenes;
    console.log(`${f}: bible=${hasBible}, scenes=${hasScenes}`);

    if (!hasBible) {
      console.log("  Skipping — no story bible");
      continue;
    }

    const fp = extractFingerprint(project);
    await saveFingerprint(fp);
    console.log(`  Saved: ${fp.character_names.join(", ")} | ${fp.scene_count} scenes`);
  }
}

main().catch(console.error);
