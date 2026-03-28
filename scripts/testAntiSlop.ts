#!/usr/bin/env npx tsx
/**
 * Anti-Slop Test Script
 *
 * Run the anti-slop scanner against text input and see detailed results.
 *
 * Usage:
 *   npx tsx scripts/testAntiSlop.ts --text "Some text to scan"
 *   npx tsx scripts/testAntiSlop.ts --file path/to/scene.json
 *   npx tsx scripts/testAntiSlop.ts --file path/to/scene.txt
 *   npx tsx scripts/testAntiSlop.ts --sample                         # built-in sample texts
 *   echo "text" | npx tsx scripts/testAntiSlop.ts --stdin
 *
 * Options:
 *   --verbose     Show full context for every hit
 *   --summary     Show only the score and pass/fail
 *   --json        Output as JSON (for piping to other tools)
 *   --threshold N Override fail threshold (default 40)
 *   --tier N      Show only hits from a specific tier (1-5)
 */

import * as fs from "fs";
import * as path from "path";
import { scanForSlop, type ScanOptions } from "../backend/services/antiSlopScanner";
import type { ScanReport } from "../shared/antiSlop";

// ═══════════════════════════════════════════════════════════════
// CLI PARSING
// ═══════════════════════════════════════════════════════════════

interface CliArgs {
  text?: string;
  file?: string;
  stdin?: boolean;
  sample?: boolean;
  verbose?: boolean;
  summary?: boolean;
  json?: boolean;
  threshold?: number;
  tier?: number;
}

function parseArgs(): CliArgs {
  const args: CliArgs = {};
  const argv = process.argv.slice(2);

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--text":
        args.text = argv[++i];
        break;
      case "--file":
        args.file = argv[++i];
        break;
      case "--stdin":
        args.stdin = true;
        break;
      case "--sample":
        args.sample = true;
        break;
      case "--verbose":
        args.verbose = true;
        break;
      case "--summary":
        args.summary = true;
        break;
      case "--json":
        args.json = true;
        break;
      case "--threshold":
        args.threshold = parseInt(argv[++i], 10);
        break;
      case "--tier":
        args.tier = parseInt(argv[++i], 10);
        break;
      default:
        // If no flag, treat as text
        if (!argv[i].startsWith("--")) {
          args.text = argv[i];
        }
    }
  }

  return args;
}

// ═══════════════════════════════════════════════════════════════
// INPUT SOURCES
// ═══════════════════════════════════════════════════════════════

function readFileInput(filePath: string): string {
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    console.error(`File not found: ${absPath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(absPath, "utf-8");

  // If it's JSON, try to extract scene text
  if (filePath.endsWith(".json")) {
    try {
      const parsed = JSON.parse(raw);
      return extractTextFromScene(parsed);
    } catch {
      return raw; // Not valid JSON, treat as plain text
    }
  }

  return raw;
}

/** Extract readable text from a VN scene JSON object */
function extractTextFromScene(scene: any): string {
  // Direct scene object with lines array
  if (scene.lines && Array.isArray(scene.lines)) {
    return sceneLinesToText(scene);
  }

  // GeneratedScene wrapper
  if (scene.vn_scene?.lines) {
    return sceneLinesToText(scene.vn_scene);
  }

  // Readable scene with screenplay_text
  if (scene.readable?.screenplay_text) {
    return scene.readable.screenplay_text;
  }

  if (scene.screenplay_text) {
    return scene.screenplay_text;
  }

  // Array of scenes
  if (Array.isArray(scene)) {
    return scene.map((s: any) => extractTextFromScene(s)).join("\n\n---\n\n");
  }

  // Fallback: stringify
  return JSON.stringify(scene, null, 2);
}

function sceneLinesToText(scene: any): string {
  const lines: string[] = [];
  for (const line of scene.lines ?? []) {
    if (line.stage_direction) lines.push(`[${line.stage_direction}]`);
    if (line.speaker === "NARRATION") {
      lines.push(line.text);
    } else if (line.speaker === "INTERNAL") {
      lines.push(`(${line.text})`);
    } else {
      const delivery = line.delivery ? ` ${line.delivery}` : "";
      const emotion = line.emotion ? ` [${line.emotion}]` : "";
      lines.push(`${line.speaker}${emotion}${delivery}: ${line.text}`);
    }
  }
  return lines.join("\n");
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

// ═══════════════════════════════════════════════════════════════
// SAMPLE TEXTS (for quick testing)
// ═══════════════════════════════════════════════════════════════

const SAMPLE_CLEAN = `Marcus wiped the counter. The diner was empty except for the woman in booth four who hadn't touched her coffee.

"Closing in ten," he said.

She looked up. Mascara smudged under one eye. "Already?"

He shrugged. The clock above the register was wrong — had been for months. Nobody fixed it because nobody cared.

"I can make a fresh pot if you want."

She shook her head, pulled a twenty from her purse, left it on the table. Didn't wait for change.

The bell above the door rang. Marcus picked up the twenty. Underneath it, a note on a napkin: "Don't open the basement."

He looked at the basement door. The padlock was still on it. Had been since he started working here three years ago.

He pocketed the twenty and started mopping.`;

const SAMPLE_SLOPPY = `Elara took a deep breath, her heart pounding in her chest as she delved into the labyrinthine corridors of the ancient tapestry of memories that sprawled before her like a kaleidoscope of emotions.

"I couldn't help but feel a sense of unease," she whispered, her voice barely above a whisper, as the ethereal glow of the gossamer curtains cast long shadows across the room.

Something shifted in the air — it was palpable, visceral, a newfound understanding that sent shivers down her spine. Furthermore, the implications were clear: nothing would ever be the same.

She realized that the weight of it all was not just about the past, but about the multifaceted tapestry of experiences that had led her to this pivotal moment. It's worth noting that her journey had been nothing short of an odyssey.

Her eyes widened in surprise as a figure emerged from the shadows. "Here's the thing," the stranger said, his voice laced with something she couldn't quite place. "The truth is, it goes without saying that what you're about to discover will be unprecedented."

In that moment, Elara steeled herself, squaring her shoulders with unwavering determination. The gravity of the situation was undeniable. At its core, this was a testament to the human spirit — moreover, it was a symphony of resilience and hope.

She took a step forward, casting one last glance behind her. Time seemed to stand still. For the first time in as long as she could remember, she felt a renewed sense of purpose wash over her like a wave of emotion.

And with that, she disappeared into the night.`;

const SAMPLE_MODERATE = `The coffee shop was busier than usual. Rain drummed against the windows while Sarah waited at the corner table, her fingers wrapped around a lukewarm latte.

Marcus arrived ten minutes late, water dripping from his jacket. He slumped into the chair across from her.

"Sorry. Train." He ran a hand through his hair and sighed.

"It's fine." It wasn't, but she'd learned which battles mattered. "Did you bring the files?"

He nodded, pulling a folder from his bag. His hands trembled slightly as he slid it across the table. She noticed but didn't comment.

The documents inside were worse than she'd expected. Three pages of financial projections, each one more damning than the last. The company wasn't just losing money — it was hemorrhaging it.

"How long have you known?" she murmured, her gaze fixed on the numbers.

"Two months. Maybe three." He swallowed hard, couldn't meet her eyes. "I kept thinking it would turn around."

Sarah set the folder down. Outside, the rain intensified, casting long shadows through the café windows. A couple at the next table laughed about something — the sound felt obscene given what she'd just read.

She took a deep breath. "We have to tell the board."

"I know."

Neither of them moved. The espresso machine hissed behind the counter, filling the silence that stretched between them.`;

// ═══════════════════════════════════════════════════════════════
// OUTPUT FORMATTING
// ═══════════════════════════════════════════════════════════════

function printReport(report: ScanReport, args: CliArgs, label?: string): void {
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (label) {
    console.log("\n" + "═".repeat(60));
    console.log(label);
    console.log("═".repeat(60));
  }

  if (args.summary) {
    const icon = report.pass ? "✓" : "✗";
    console.log(`${icon} Score: ${report.score}/100 | ${report.pass ? "PASS" : "FAIL"} | ${report.wordCount} words | ${report.totalHits} issues`);
    return;
  }

  // Full report
  console.log("");
  console.log(report.summary);

  if (args.verbose) {
    console.log("\n" + "─".repeat(40));
    console.log("ALL POSITIONS:");
    const allHits = [
      ...report.tier1,
      ...(report.tier2.uniqueCount >= report.tier2.clusterThreshold ? report.tier2.hits : []),
      ...report.tier3,
      ...report.tier4,
      ...report.tier5,
    ];
    for (const h of allHits) {
      console.log(`  [T${h.tier}] "${h.term}" at positions: ${h.positions.join(", ")}`);
      for (const c of h.context) console.log(`       ${c}`);
    }
  }
}

function printTierFilter(report: ScanReport, tier: number): void {
  const tierMap: Record<number, SlopHit[]> = {
    1: report.tier1,
    2: report.tier2.hits,
    3: report.tier3,
    4: report.tier4,
    5: report.tier5,
  };

  const hits = tierMap[tier] ?? [];
  console.log(`\nTIER ${tier} HITS (${hits.length}):`);
  for (const h of hits) {
    console.log(`  "${h.term}" ×${h.count} [${h.severity}]`);
    for (const c of h.context) console.log(`    → ${c}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

async function main() {
  const args = parseArgs();
  const options: ScanOptions = {};
  if (args.threshold) options.failThreshold = args.threshold;

  // Determine input
  let texts: { label: string; text: string }[] = [];

  if (args.sample) {
    texts = [
      { label: "SAMPLE: Clean (human-like writing)", text: SAMPLE_CLEAN },
      { label: "SAMPLE: Moderate (some LLM patterns)", text: SAMPLE_MODERATE },
      { label: "SAMPLE: Sloppy (heavy LLM-isms)", text: SAMPLE_SLOPPY },
    ];
  } else if (args.text) {
    texts = [{ label: "Input text", text: args.text }];
  } else if (args.file) {
    texts = [{ label: `File: ${args.file}`, text: readFileInput(args.file) }];
  } else if (args.stdin) {
    const input = await readStdin();
    texts = [{ label: "stdin", text: input }];
  } else {
    console.log(`Anti-Slop Scanner — Test Tool

Usage:
  npx tsx scripts/testAntiSlop.ts --sample                Run against built-in sample texts
  npx tsx scripts/testAntiSlop.ts --text "Some text"      Scan inline text
  npx tsx scripts/testAntiSlop.ts --file scene.json       Scan a scene file (JSON or plain text)
  echo "text" | npx tsx scripts/testAntiSlop.ts --stdin    Scan from stdin

Options:
  --verbose     Show all hit positions and full context
  --summary     Show only score and pass/fail
  --json        Output as JSON
  --threshold N Set fail threshold (default 40)
  --tier N      Filter to show only tier N hits (1-5)`);
    process.exit(0);
  }

  // Run scans
  for (const { label, text } of texts) {
    const report = scanForSlop(text, options);

    if (args.tier) {
      console.log(`\n${"═".repeat(60)}\n${label}\n${"═".repeat(60)}`);
      console.log(`Score: ${report.score}/100 | ${report.pass ? "PASS" : "FAIL"}`);
      printTierFilter(report, args.tier);
    } else {
      printReport(report, args, label);
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
