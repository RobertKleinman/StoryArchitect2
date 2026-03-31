/**
 * TREND ANALYSIS — Compare patterns across generated stories
 *
 * Loads all story fingerprints + pipeline outputs and reports:
 * - Name reuse and name-style clustering
 * - Character archetype repetition
 * - Plot structure similarity
 * - Dialogue pattern frequency (LLM-isms)
 * - Setting/location convergence
 * - Pacing type distribution
 *
 * Usage:
 *   npx tsx scripts/analyze-trends.ts              # full analysis
 *   npx tsx scripts/analyze-trends.ts --dialogue    # dialogue patterns only (reads full outputs)
 */

import dotenv from "dotenv";
dotenv.config();

import { readFileSync, readdirSync, existsSync } from "fs";
import { writeFile, mkdir } from "fs/promises";
import { loadFingerprints, StoryFingerprint } from "../shared/fingerprint";

async function main() {
  const args = process.argv.slice(2);
  const dialogueOnly = args.includes("--dialogue");

  const fingerprints = await loadFingerprints();
  if (fingerprints.length === 0) {
    console.log("No fingerprints found. Run some stories through the pipeline first.");
    console.log("Or run: npx tsx scripts/fingerprint-existing.ts");
    return;
  }

  console.log(`Analyzing ${fingerprints.length} stories...\n`);

  const report: string[] = [
    "# Story Trend Analysis",
    `*${fingerprints.length} stories analyzed — ${new Date().toISOString().slice(0, 10)}*`,
    "",
  ];

  // ── 1. Name Analysis ──
  report.push("## 1. Character Names");
  report.push("");

  const allNames = fingerprints.flatMap(fp => fp.character_names);
  const nameCounts = countOccurrences(allNames);
  const repeatedNames = Object.entries(nameCounts).filter(([, c]) => c > 1);

  if (repeatedNames.length > 0) {
    report.push("**Repeated names across stories:**");
    for (const [name, count] of repeatedNames.sort((a, b) => b[1] - a[1])) {
      report.push(`- "${name}" — used in ${count} stories`);
    }
  } else {
    report.push("No exact name reuse detected.");
  }

  // Name style clustering — check for similar phonetic patterns
  report.push("");
  report.push("**Name style analysis:**");
  const nameStyles = analyzeNameStyles(allNames);
  for (const [style, names] of Object.entries(nameStyles)) {
    if (names.length >= 2) {
      report.push(`- ${style}: ${names.join(", ")}`);
    }
  }

  // ── 2. Archetype Analysis ──
  report.push("");
  report.push("## 2. Character Archetypes");
  report.push("");

  const stopWords = new Set(["whose", "with", "that", "this", "from", "been", "have", "into",
    "their", "them", "they", "than", "what", "when", "where", "which", "while", "after", "before",
    "about", "between", "through", "under", "over", "year", "years", "late", "early"]);

  // Strip generic role labels, analyze the actual character descriptions
  const genericRoles = new Set(["protagonist", "antagonist", "supporting", "catalyst", "ally", "foil",
    "love", "interest", "comic", "relief", "authority", "mentor", "threshold", "figure", "adjacent",
    "institutional", "instrument", "unreliable", "confidant", "facilitator", "counterweight",
    "complication", "echo", "contact", "the"]);

  const descriptionWords = fingerprints.flatMap(fp =>
    fp.character_archetypes.flatMap(a => {
      // Take the description part after the colon
      const desc = a.split(":").slice(1).join(":").trim().toLowerCase();
      return desc.split(/[\s,—\-]+/)
        .filter(w => w.length > 3 && !genericRoles.has(w) && !stopWords.has(w));
    })
  );
  const descWordCounts = countOccurrences(descriptionWords);
  const commonDescWords = Object.entries(descWordCounts)
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1]);

  if (commonDescWords.length > 0) {
    report.push("**Most common character description words (LLM character templates):**");
    for (const [word, count] of commonDescWords.slice(0, 20)) {
      report.push(`- "${word}" — ${count} occurrences`);
    }
  }

  // Look for "X hides/masks Y" patterns — classic LLM character formula
  report.push("");
  report.push("**Character formula patterns (\"X hides/masks Y\"):**");
  const formulaPatterns: string[] = [];
  for (const fp of fingerprints) {
    for (const arch of fp.character_archetypes) {
      const desc = arch.split(":").slice(1).join(":").trim();
      const maskMatch = desc.match(/(hides|masks|conceals|beneath|behind|under).{5,50}/i);
      if (maskMatch) {
        formulaPatterns.push(`"...${maskMatch[0].slice(0, 60)}" (${fp.id.slice(0, 15)})`);
      }
    }
  }
  if (formulaPatterns.length > 0) {
    for (const p of formulaPatterns) report.push(`- ${p}`);
  } else {
    report.push("None detected.");
  }

  report.push("");
  report.push("**Full archetype list:**");
  for (const fp of fingerprints) {
    report.push(`\n*${fp.id.slice(0, 20)}:*`);
    for (const arch of fp.character_archetypes) {
      report.push(`  - ${arch}`);
    }
  }

  // ── 3. Setting/Location Analysis ──
  report.push("");
  report.push("## 3. Settings & Locations");
  report.push("");

  const allLocations = fingerprints.flatMap(fp => fp.location_names);
  const locationWords = allLocations.flatMap(l =>
    l.toLowerCase().split(/[\s\-_']+/).filter(w => w.length > 3)
  );
  const locationWordCounts = countOccurrences(locationWords);
  const commonLocWords = Object.entries(locationWordCounts)
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1]);

  if (commonLocWords.length > 0) {
    report.push("**Repeated location words:**");
    for (const [word, count] of commonLocWords.slice(0, 15)) {
      report.push(`- "${word}" — ${count} occurrences`);
    }
  }

  report.push("");
  for (const fp of fingerprints) {
    report.push(`*${fp.id.slice(0, 20)}:* ${fp.location_names.join(", ")}`);
  }

  // ── 4. Plot Structure ──
  report.push("");
  report.push("## 4. Plot Structure");
  report.push("");

  for (const fp of fingerprints) {
    report.push(`*${fp.id.slice(0, 20)}:*`);
    report.push(`  Shape: ${fp.plot_shape}`);
    report.push(`  Themes: ${fp.themes.join(", ") || "none extracted"}`);
    report.push(`  Motifs: ${fp.motifs.join(", ") || "none extracted"}`);
    report.push("");
  }

  // ── 5. Pacing Distribution ──
  report.push("## 5. Pacing Type Distribution");
  report.push("");

  const allPacing = fingerprints.flatMap(fp => fp.pacing_types);
  const pacingCounts = countOccurrences(allPacing);

  report.push("| Pacing Type | Count | % |");
  report.push("|---|---|---|");
  const totalPacing = allPacing.length;
  for (const [type, count] of Object.entries(pacingCounts).sort((a, b) => b[1] - a[1])) {
    report.push(`| ${type} | ${count} | ${Math.round(count / totalPacing * 100)}% |`);
  }

  // ── 6. Dialogue Analysis (optional, reads full outputs) ──
  if (dialogueOnly || !args.includes("--skip-dialogue")) {
    report.push("");
    report.push("## 6. Dialogue Patterns");
    report.push("");

    const outputDir = "./data/pipeline-output";
    if (existsSync(outputDir)) {
      const files = readdirSync(outputDir).filter(f => f.endsWith(".json"));
      const allDialogueLines: string[] = [];
      const allInternalLines: string[] = [];
      const shortLines: string[] = []; // lines <8 words, likely motifs

      for (const f of files) {
        try {
          const project = JSON.parse(readFileSync(`${outputDir}/${f}`, "utf8"));
          const scenes = project.scenes ?? project.generatedScenes ?? [];
          for (const scene of scenes) {
            const vnScene = scene.vn_scene ?? scene;
            for (const line of (vnScene.lines ?? [])) {
              const speaker = (line.speaker ?? "").toUpperCase();
              const text = (line.text ?? "").trim();
              if (!text) continue;

              if (speaker === "INTERNAL") {
                allInternalLines.push(text);
              } else if (speaker !== "NARRATION") {
                allDialogueLines.push(text);
              }

              // Short punchy lines
              if (text.split(/\s+/).length <= 6 && text.length > 3) {
                shortLines.push(text.toLowerCase().replace(/[.!?,;:'"—\-]+$/g, "").trim());
              }
            }
          }
        } catch { /* skip malformed files */ }
      }

      report.push(`Total dialogue lines: ${allDialogueLines.length}`);
      report.push(`Total internal lines: ${allInternalLines.length}`);
      report.push("");

      // Find repeated short lines (motif candidates)
      const shortLineCounts = countOccurrences(shortLines);
      const repeatedMotifs = Object.entries(shortLineCounts)
        .filter(([, c]) => c >= 2)
        .sort((a, b) => b[1] - a[1]);

      if (repeatedMotifs.length > 0) {
        report.push("**Repeated short phrases (potential LLM-isms):**");
        for (const [phrase, count] of repeatedMotifs.slice(0, 20)) {
          report.push(`- "${phrase}" — ${count} times`);
        }
      }

      // Dialogue length distribution
      const dialogueLengths = allDialogueLines.map(l => l.split(/\s+/).length);
      const avgLength = dialogueLengths.reduce((a, b) => a + b, 0) / dialogueLengths.length;
      const internalLengths = allInternalLines.map(l => l.split(/\s+/).length);
      const avgInternalLength = internalLengths.reduce((a, b) => a + b, 0) / internalLengths.length;

      report.push("");
      report.push(`**Average dialogue line length:** ${avgLength.toFixed(1)} words`);
      report.push(`**Average internal line length:** ${avgInternalLength.toFixed(1)} words`);

      // Find common dialogue starters (LLM tells)
      const starters = allDialogueLines.map(l => l.split(/\s+/).slice(0, 2).join(" ").toLowerCase());
      const starterCounts = countOccurrences(starters);
      const commonStarters = Object.entries(starterCounts)
        .filter(([, c]) => c >= 3)
        .sort((a, b) => b[1] - a[1]);

      if (commonStarters.length > 0) {
        report.push("");
        report.push("**Most common dialogue openings:**");
        for (const [starter, count] of commonStarters.slice(0, 15)) {
          report.push(`- "${starter}..." — ${count} times`);
        }
      }

      // Find common internal monologue patterns
      const internalStarters = allInternalLines.map(l => l.split(/\s+/).slice(0, 3).join(" ").toLowerCase());
      const internalStarterCounts = countOccurrences(internalStarters);
      const commonInternalStarters = Object.entries(internalStarterCounts)
        .filter(([, c]) => c >= 3)
        .sort((a, b) => b[1] - a[1]);

      if (commonInternalStarters.length > 0) {
        report.push("");
        report.push("**Most common internal monologue openings:**");
        for (const [starter, count] of commonInternalStarters.slice(0, 15)) {
          report.push(`- "${starter}..." — ${count} times`);
        }
      }
    }
  }

  // ── 7. Summary Stats ──
  report.push("");
  report.push("## 7. Summary");
  report.push("");
  report.push(`| Metric | Value |`);
  report.push(`|---|---|`);
  report.push(`| Stories analyzed | ${fingerprints.length} |`);
  report.push(`| Total unique character names | ${new Set(allNames).size} |`);
  report.push(`| Total unique locations | ${new Set(allLocations).size} |`);
  report.push(`| Avg scenes per story | ${(fingerprints.reduce((a, fp) => a + fp.scene_count, 0) / fingerprints.length).toFixed(1)} |`);
  report.push(`| Avg lines per story | ${(fingerprints.reduce((a, fp) => a + fp.total_lines, 0) / fingerprints.length).toFixed(0)} |`);

  // Save report
  await mkdir("data/trend-reports", { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outPath = `data/trend-reports/trends-${ts}.md`;
  await writeFile(outPath, report.join("\n"), "utf-8");
  console.log(report.join("\n"));
  console.log(`\nReport saved to: ${outPath}`);
}

function countOccurrences(arr: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of arr) {
    counts[item] = (counts[item] ?? 0) + 1;
  }
  return counts;
}

function analyzeNameStyles(names: string[]): Record<string, string[]> {
  const styles: Record<string, string[]> = {
    "Short (≤4 chars)": [],
    "Long (≥12 chars)": [],
    "Single word": [],
    "Two+ words": [],
    "Contains title/rank": [],
  };

  const rankWords = ["commander", "officer", "warrant", "petty", "captain", "lieutenant", "dr", "dr."];

  for (const name of names) {
    if (name.length <= 4) styles["Short (≤4 chars)"].push(name);
    if (name.length >= 12) styles["Long (≥12 chars)"].push(name);
    if (!name.includes(" ")) styles["Single word"].push(name);
    else styles["Two+ words"].push(name);
    if (rankWords.some(r => name.toLowerCase().startsWith(r))) {
      styles["Contains title/rank"].push(name);
    }
  }

  return styles;
}

main().catch(console.error);
