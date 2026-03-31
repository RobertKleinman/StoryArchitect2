/**
 * Fingerprint all existing pipeline outputs and v2 project files.
 * Run once to seed the fingerprint database, or re-run to pick up new projects.
 */
import dotenv from "dotenv";
dotenv.config();

import { readFileSync, readdirSync, existsSync } from "fs";
import { extractFingerprint, saveFingerprint, loadFingerprints } from "../shared/fingerprint";

async function main() {
  const existing = await loadFingerprints();
  const existingIds = new Set(existing.map(fp => fp.id));
  let added = 0;

  // Scan pipeline-output/ (exported projects)
  const dirs = [
    { path: "./data/pipeline-output", label: "pipeline-output" },
    { path: "./data/v2", label: "v2 projects" },
  ];

  for (const { path: dir, label } of dirs) {
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir).filter(f => f.endsWith(".json"));
    console.log(`\n${label}: ${files.length} files`);

    for (const f of files) {
      try {
        const project = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
        const id = project.projectId ?? f.replace(".json", "");

        // Skip if already fingerprinted
        if (existingIds.has(id)) {
          continue;
        }

        const hasBible = !!project.storyBible?.characters && Object.keys(project.storyBible.characters).length > 0;
        if (!hasBible) continue;

        // Override projectId for v2 files that might not have it at top level
        if (!project.projectId) project.projectId = id;

        const fp = extractFingerprint(project);
        await saveFingerprint(fp);
        existingIds.add(id);
        added++;
        console.log(`  + ${id.slice(0, 25)} | ${fp.character_names.join(", ")} | ${fp.scene_count} scenes`);
      } catch (err: any) {
        // Skip malformed files silently
      }
    }
  }

  const total = (await loadFingerprints()).length;
  console.log(`\nDone: ${added} new fingerprints added (${total} total)`);
}

main().catch(console.error);
