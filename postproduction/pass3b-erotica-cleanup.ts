/**
 * PASS 3B — EROTICA-SPECIFIC CLEANUP
 * ═══════════════════════════════════
 * Runs ONLY for erotica/erotica-fast modes, between Pass 3 and Pass 4.
 *
 * Phase 1: Deterministic detection of erotica-specific quality issues
 * Phase 2: LLM-based surgical fix via Grok (same diff protocol as Pass 3)
 *
 * Detects: thesis-statement dialogue, "Mmph" crutch, repeated dom commands,
 * interrupt scene endings, vocabulary overuse, name leaks from premise.
 */

import type {
  IdentifiedScene,
  IdentifiedLine,
  PipelineOutput,
  SceneEditResult,
  LineDiff,
  PostproductionConfig,
} from "./types";
import { callLLM } from "./llm";
import { SENSORY_WORDS } from "../shared/sensoryPalette";

// ── Detection Types ─────────────────────────────────────────────────

interface EroticaIssue {
  type: "thesis_dialogue" | "mmph_crutch" | "repeated_commands" | "interrupt_ending" | "vocab_overuse" | "name_leak";
  scene_id: string;
  line_id?: string;
  description: string;
  severity: "major" | "minor";
}

// ── Abstract nouns that signal thesis-statement dialogue ─────────────

const THESIS_WORDS = new Set([
  "bond", "eternal", "eternity", "core", "truth", "soul", "fate", "destiny",
  "essence", "forever", "surrender", "dominion", "submission", "power",
  "transcend", "infinite", "primal", "cosmic", "void", "oblivion",
]);

// ── Onomatopoeia that signals dialogue crutch ───────────────────────

const ONOMATOPOEIA = new Set([
  "mmph", "ngh", "ahh", "ohh", "mmm", "nngh", "hah", "unh", "mph",
  "ugh", "gah", "hmm", "hnn", "aah", "ooh", "mhm", "hnng",
]);

// ── Main ────────────────────────────────────────────────────────────

export async function runEroticaCleanup(
  scenes: IdentifiedScene[],
  input: PipelineOutput,
  config: PostproductionConfig,
): Promise<{ scenes: IdentifiedScene[]; results: SceneEditResult[] }> {
  const llm = config.llm;

  // Phase 1: Detect issues
  const allIssues = detectIssues(scenes, input);

  if (allIssues.length === 0) {
    console.log("[EROTICA] No erotica-specific issues detected");
    return {
      scenes,
      results: scenes.map(s => ({
        scene_id: s.scene_id,
        status: "unchanged" as const,
        diffs_applied: 0,
        diffs_rejected: 0,
        issues_addressed: [],
      })),
    };
  }

  console.log(`[EROTICA] Detected ${allIssues.length} issues across ${new Set(allIssues.map(i => i.scene_id)).size} scenes`);
  for (const issue of allIssues) {
    console.log(`  [${issue.type}] ${issue.scene_id}: ${issue.description.slice(0, 80)}`);
  }

  // Phase 2: Fix via LLM (per-scene, only scenes with issues)
  const issuesByScene = new Map<string, EroticaIssue[]>();
  for (const issue of allIssues) {
    const existing = issuesByScene.get(issue.scene_id) ?? [];
    existing.push(issue);
    issuesByScene.set(issue.scene_id, existing);
  }

  const updatedScenes = [...scenes];
  const results: SceneEditResult[] = [];

  for (let i = 0; i < updatedScenes.length; i++) {
    const scene = updatedScenes[i];
    const sceneIssues = issuesByScene.get(scene.scene_id);

    if (!sceneIssues || sceneIssues.length === 0) {
      results.push({
        scene_id: scene.scene_id,
        status: "unchanged",
        diffs_applied: 0,
        diffs_rejected: 0,
        issues_addressed: [],
      });
      continue;
    }

    try {
      const fixResult = await fixScene(scene, sceneIssues, llm);
      if (fixResult.fixedScene) {
        updatedScenes[i] = fixResult.fixedScene;
      }
      results.push({
        scene_id: scene.scene_id,
        status: fixResult.diffs_applied > 0 ? "fixed" : "unfixed",
        diffs_applied: fixResult.diffs_applied,
        diffs_rejected: fixResult.diffs_rejected,
        issues_addressed: sceneIssues.map(i => `[erotica:${i.type}] ${i.description}`),
      });
    } catch (err: any) {
      console.warn(`[EROTICA] Fix failed for ${scene.scene_id}: ${err.message}`);
      results.push({
        scene_id: scene.scene_id,
        status: "unfixed",
        diffs_applied: 0,
        diffs_rejected: 0,
        issues_addressed: sceneIssues.map(i => `[erotica:${i.type}] ${i.description}`),
      });
    }
  }

  return { scenes: updatedScenes, results };
}

// ── Phase 1: Deterministic Detection ────────────────────────────────

function detectIssues(scenes: IdentifiedScene[], input: PipelineOutput): EroticaIssue[] {
  const issues: EroticaIssue[] = [];

  // Build name leak set: premise names NOT in storyBible characters
  const bibleNames = new Set(Object.keys(input.storyBible?.characters ?? {}));
  const premiseText = [
    input.premise?.hook_sentence,
    input.premise?.premise_paragraph,
    input.premise?.synopsis,
  ].filter(Boolean).join(" ");
  const premiseNamePattern = /\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?)\b/g;
  const premiseNames = new Set<string>();
  let match;
  while ((match = premiseNamePattern.exec(premiseText)) !== null) {
    const name = match[1];
    if (!bibleNames.has(name) && !COMMON_WORDS.has(name)) {
      premiseNames.add(name);
    }
  }

  // Track vocabulary frequency across scenes
  const vocabCounts = new Map<string, number>();

  for (const scene of scenes) {
    // ── Thesis-statement dialogue ──
    for (const line of scene.lines) {
      if (line.speaker === "NARRATION" || line.speaker === "INTERNAL") continue;
      if (!line.text) continue;

      const words = line.text.toLowerCase().split(/\s+/);
      const thesisCount = words.filter(w => THESIS_WORDS.has(w.replace(/[^a-z]/g, ""))).length;
      if (thesisCount >= 2 && words.length <= 10) {
        issues.push({
          type: "thesis_dialogue",
          scene_id: scene.scene_id,
          line_id: (line as any)._lid,
          description: `Thesis-statement dialogue: "${line.text.slice(0, 60)}" — ${thesisCount} abstract nouns in ${words.length} words`,
          severity: "major",
        });
      }
    }

    // ── "Mmph" crutch ──
    for (const line of scene.lines) {
      if (line.speaker === "NARRATION" || line.speaker === "INTERNAL") continue;
      if (!line.text) continue;

      const words = line.text.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter(Boolean);
      const onomatopoeiaCount = words.filter(w => ONOMATOPOEIA.has(w)).length;
      if (words.length > 0 && words.length <= 4 && onomatopoeiaCount / words.length > 0.5) {
        issues.push({
          type: "mmph_crutch",
          scene_id: scene.scene_id,
          line_id: (line as any)._lid,
          description: `Sound-effect-only dialogue: "${line.text.slice(0, 40)}" — should show internal state through action instead`,
          severity: "minor",
        });
      }
    }

    // ── Repeated dom commands ──
    const shortImperatives = new Map<string, number>();
    for (const line of scene.lines) {
      if (line.speaker === "NARRATION" || line.speaker === "INTERNAL") continue;
      if (!line.text) continue;
      const words = line.text.split(/\s+/);
      if (words.length <= 4 && line.text.endsWith(".")) {
        const normalized = line.text.toLowerCase().replace(/[^a-z\s]/g, "").trim();
        shortImperatives.set(normalized, (shortImperatives.get(normalized) ?? 0) + 1);
      }
    }
    for (const [cmd, count] of shortImperatives) {
      if (count >= 3) {
        issues.push({
          type: "repeated_commands",
          scene_id: scene.scene_id,
          description: `Command "${cmd}" repeated ${count}x in scene — dom character needs more varied dialogue`,
          severity: "major",
        });
      }
    }
    const totalShortImperatives = [...shortImperatives.values()].reduce((s, c) => s + c, 0);
    if (totalShortImperatives >= 5 && !issues.some(i => i.scene_id === scene.scene_id && i.type === "repeated_commands")) {
      issues.push({
        type: "repeated_commands",
        scene_id: scene.scene_id,
        description: `${totalShortImperatives} short imperative lines in scene — monotonous dom dialogue`,
        severity: "minor",
      });
    }

    // ── Interrupt scene endings ──
    const lastLines = scene.lines.slice(-3);
    const lastNarration = lastLines.filter(l => l.speaker === "NARRATION");
    const interruptKeywords = /alarm|door|enters|burst|interrupts?|footsteps|approaches|walks in|knock|voice from|someone|heard|corridor|alert/i;
    for (const line of lastNarration) {
      if (line.text && interruptKeywords.test(line.text)) {
        issues.push({
          type: "interrupt_ending",
          scene_id: scene.scene_id,
          line_id: (line as any)._lid,
          description: `Scene ends with external interruption: "${line.text.slice(0, 60)}" — consider ending through character decision instead`,
          severity: "minor",
        });
        break;
      }
    }

    // ── Vocabulary overuse (cross-scene tracking) ──
    const sceneText = scene.lines.map(l => l.text ?? "").join(" ").toLowerCase();
    const sceneWords = sceneText.replace(/[^a-z\s]/g, "").split(/\s+/);
    const seenInScene = new Set<string>();
    for (const w of sceneWords) {
      if (SENSORY_WORDS.has(w) && !seenInScene.has(w)) {
        seenInScene.add(w);
        vocabCounts.set(w, (vocabCounts.get(w) ?? 0) + 1);
      }
    }

    // ── Name leaks ──
    const fullText = scene.lines.map(l => l.text ?? "").join(" ");
    for (const name of premiseNames) {
      if (fullText.includes(name)) {
        issues.push({
          type: "name_leak",
          scene_id: scene.scene_id,
          description: `Premise name "${name}" appears in scene text but is not a storyBible character — likely a name leak from pre-rename`,
          severity: "major",
        });
      }
    }
  }

  // Flag vocabulary overuse (words in 3+ scenes)
  if (scenes.length >= 4) {
    for (const [word, count] of vocabCounts) {
      if (count >= 3) {
        issues.push({
          type: "vocab_overuse",
          scene_id: scenes[scenes.length - 1].scene_id, // attribute to last scene for fixing
          description: `Sensory word "${word}" used in ${count}/${scenes.length} scenes — find alternatives`,
          severity: "minor",
        });
      }
    }
  }

  return issues;
}

// ── Phase 2: LLM-based Fix ─────────────────────────────────────────

async function fixScene(
  scene: IdentifiedScene,
  issues: EroticaIssue[],
  llm: PostproductionConfig["llm"],
): Promise<{ fixedScene?: IdentifiedScene; diffs_applied: number; diffs_rejected: number }> {
  const flaggedLids = issues.map(i => i.line_id).filter(Boolean) as string[];

  const systemPrompt = `You are a surgical editor for adult fiction. Fix the flagged quality issues while preserving explicit content.

RULES:
- Return edits as a JSON array of diffs
- Each diff targets a specific line by its _lid
- You may ONLY modify lines that are flagged
- Preserve all explicit sexual content — do NOT sanitize
- For thesis-statement dialogue: replace with in-character speech that reveals the same dynamic through specific detail, not abstract declaration
- For sound-effect-only dialogue ("Mmph—"): replace with a brief action beat showing the character's physical state, or short in-character speech
- For repeated commands: vary the dominant character's language — give them specific desires, reactions, humor, not just "Kneel" and "Deeper" on repeat
- For interrupt endings: suggest an internal resolution (character decision, emotional shift) rather than external interruption
- For vocabulary overuse: find fresher sensory language specific to this world

DIFF FORMAT:
{ "diffs": [{ "line_id": "...", "expected_old_text": "...", "action": "replace", "new_line": { "speaker": "...", "text": "...", "emotion": "...", "stage_direction": null, "delivery": null } }] }` + llm.systemPromptSuffix;

  const sceneText = scene.lines.map(l => {
    const lid = (l as any)._lid ?? "";
    const flagged = flaggedLids.includes(lid) ? " [FLAGGED]" : "";
    return `${lid}${flagged} | ${l.speaker} [${l.emotion ?? ""}]: ${l.text}`;
  }).join("\n");

  const issueList = issues.map(i => `- [${i.type}] ${i.description}`).join("\n");

  const userPrompt = `## SCENE: ${scene.scene_id}
${sceneText}

## ISSUES TO FIX
${issueList}

## FLAGGED LINE IDS (only these may be changed)
${flaggedLids.join(", ") || "(scene-level issues — pick the most relevant lines to improve)"}

Return JSON only.`;

  const response = await callLLM(
    llm.provider, llm.baseUrl, llm.apiKey,
    systemPrompt, userPrompt, llm.editorialModel, 0.5, 8000,
  );

  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { diffs_applied: 0, diffs_rejected: 0 };

  const parsed = JSON.parse(jsonMatch[0]);
  const diffs: LineDiff[] = parsed.diffs ?? [];

  if (diffs.length === 0) return { diffs_applied: 0, diffs_rejected: 0 };

  // Apply diffs
  const fixedScene = { ...scene, lines: [...scene.lines] };
  let applied = 0;
  let rejected = 0;

  for (const diff of diffs) {
    const lineIdx = fixedScene.lines.findIndex(l => (l as any)._lid === diff.line_id);
    if (lineIdx === -1) {
      rejected++;
      continue;
    }

    if (diff.action === "replace" && diff.new_line) {
      fixedScene.lines[lineIdx] = {
        ...fixedScene.lines[lineIdx],
        ...diff.new_line,
        _lid: (fixedScene.lines[lineIdx] as any)._lid,
      } as IdentifiedLine;
      applied++;
    } else if (diff.action === "delete") {
      fixedScene.lines.splice(lineIdx, 1);
      applied++;
    } else if (diff.action === "insert_after" && diff.new_line) {
      const newLine = {
        ...diff.new_line,
        _lid: `${(fixedScene.lines[lineIdx] as any)._lid}_ins`,
      } as IdentifiedLine;
      fixedScene.lines.splice(lineIdx + 1, 0, newLine);
      applied++;
    } else {
      rejected++;
    }
  }

  return { fixedScene: applied > 0 ? fixedScene : undefined, diffs_applied: applied, diffs_rejected: rejected };
}

// ── Common English words that look like names ───────────────────────

const COMMON_WORDS = new Set([
  "The", "This", "That", "They", "Their", "There", "Then", "When", "Where",
  "What", "Which", "While", "With", "From", "Into", "Upon", "Over", "Under",
  "After", "Before", "Between", "Through", "During", "Against", "Around",
  "Doctor", "Captain", "Commander", "Lord", "Lady", "Sir", "Master",
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
  "January", "February", "March", "April", "May", "June", "July", "August",
  "September", "October", "November", "December",
  "North", "South", "East", "West", "Central",
  "Grace", "Rose", "Mark", "Will", "Art", "Dawn", "Hope", "Faith", "Joy",
]);
