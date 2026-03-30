/**
 * PASS 1 — STRUCTURAL SCAN
 * ═════════════════════════
 * Zero LLM calls. Deterministic checks for:
 * - Truncation (mid-word cutoffs, unclosed quotes)
 * - Speaker/location reference validation
 * - VN compatibility (line length, narration blocks, transitions)
 * - Empty/near-empty scenes, duplicate lines, normalization collisions
 */

import {
  normalizeSpecialSpeaker,
} from "./types";
import type {
  PipelineOutput,
  VNScene,
  VNLine,
  StructuralIssue,
  StructuralReport,
  IdentifiedScene,
  IdentifiedLine,
} from "./types";
import { extractVNScene } from "./loader";

// ── Config ──

const MAX_LINE_CHARS = 200;
const MAX_CONSECUTIVE_NARRATION = 5;
const MAX_CONSECUTIVE_INTERNAL = 3;
const MIN_SCENE_LINES = 3;

// ── Main ──

export function runStructuralScan(input: PipelineOutput): {
  report: StructuralReport;
  scenes: IdentifiedScene[];
} {
  const issues: StructuralIssue[] = [];

  // Build reference sets
  const characterNames = new Set(Object.keys(input.storyBible.characters));
  const characterNamesLower = new Map<string, string[]>();
  for (const name of characterNames) {
    const lower = name.toLowerCase();
    const existing = characterNamesLower.get(lower) ?? [];
    existing.push(name);
    characterNamesLower.set(lower, existing);
  }

  const locationIds = new Set(input.storyBible.world.arena.locations.map(l => l.id));
  const locationNames = new Map(input.storyBible.world.arena.locations.map(l => [l.name.toLowerCase(), l.id]));

  // Build speaker normalization map and check for collisions
  const speakerNormMap = buildSpeakerNormMap(characterNames);
  checkNormalizationCollisions(speakerNormMap, issues);

  // Extract and assign stable line IDs to all scenes
  const identifiedScenes: IdentifiedScene[] = [];
  let totalLines = 0;

  for (const pScene of input.scenes) {
    const vnScene = extractVNScene(pScene);
    if (!vnScene) {
      issues.push({
        category: "missing_data",
        severity: "error",
        scene_id: pScene.scene_id ?? "unknown",
        message: "Scene has no vn_scene data",
        auto_fixable: false,
      });
      continue;
    }

    const identifiedScene = assignLineIds(vnScene);
    identifiedScenes.push(identifiedScene);

    const sid = vnScene.scene_id;
    totalLines += vnScene.lines.length;

    // Check: empty/near-empty scene
    if (vnScene.lines.length < MIN_SCENE_LINES) {
      issues.push({
        category: "missing_data",
        severity: "warning",
        scene_id: sid,
        message: `Scene has only ${vnScene.lines.length} line(s) (minimum ${MIN_SCENE_LINES})`,
        auto_fixable: false,
      });
    }

    // Check: missing transition_out
    if (!vnScene.transition_out) {
      issues.push({
        category: "vn_compatibility",
        severity: "warning",
        scene_id: sid,
        message: "Missing transition_out",
        auto_fixable: false,
      });
    }

    // Check: zero dialogue (all narration/internal)
    const dialogueLines = vnScene.lines.filter(l =>
      !normalizeSpecialSpeaker(l.speaker)
    );
    if (dialogueLines.length === 0 && vnScene.lines.length > 0) {
      issues.push({
        category: "vn_compatibility",
        severity: "warning",
        scene_id: sid,
        message: "Scene has no dialogue lines — all narration/internal",
        auto_fixable: false,
      });
    }

    // Per-line checks
    let consecutiveNarration = 0;
    let consecutiveInternal = 0;
    let prevLineText = "";

    for (const line of identifiedScene.lines) {
      const lid = line._lid;

      // Truncation detection
      checkTruncation(line.text, sid, lid, "text", issues);
      if (line.stage_direction) {
        checkTruncation(line.stage_direction, sid, lid, "stage_direction", issues);
      }

      // Line length for VN text boxes
      if (line.text.length > MAX_LINE_CHARS) {
        issues.push({
          category: "vn_compatibility",
          severity: "warning",
          scene_id: sid,
          line_id: lid,
          message: `Line text is ${line.text.length} chars (max ${MAX_LINE_CHARS}): "${line.text.slice(0, 60)}..."`,
          auto_fixable: true,
        });
      }

      // Speaker validation
      if (!normalizeSpecialSpeaker(line.speaker)) {
        const resolved = resolvesSpeaker(line.speaker, characterNames, speakerNormMap);
        if (!resolved) {
          issues.push({
            category: "reference_mismatch",
            severity: "error",
            scene_id: sid,
            line_id: lid,
            message: `Unknown speaker "${line.speaker}" — not in storyBible characters`,
            auto_fixable: false,
          });
        }
      }

      // Consecutive narration blocks
      const specialSpeaker = normalizeSpecialSpeaker(line.speaker);
      if (specialSpeaker === "NARRATION" || specialSpeaker === "narration") {
        consecutiveNarration++;
        consecutiveInternal = 0;
        if (consecutiveNarration > MAX_CONSECUTIVE_NARRATION) {
          issues.push({
            category: "vn_compatibility",
            severity: "warning",
            scene_id: sid,
            line_id: lid,
            message: `${consecutiveNarration} consecutive narration lines — may overwhelm VN text display`,
            auto_fixable: true,
          });
        }
      } else if (specialSpeaker === "INTERNAL" || specialSpeaker === "internal") {
        consecutiveInternal++;
        consecutiveNarration = 0;
        if (consecutiveInternal > MAX_CONSECUTIVE_INTERNAL) {
          issues.push({
            category: "vn_compatibility",
            severity: "warning",
            scene_id: sid,
            line_id: lid,
            message: `${consecutiveInternal} consecutive INTERNAL lines — internal monologue overload, break with action or dialogue`,
            auto_fixable: true,
          });
        }
      } else {
        consecutiveNarration = 0;
        consecutiveInternal = 0;
      }

      // Duplicate consecutive lines
      if (line.text === prevLineText && line.text.length > 10) {
        issues.push({
          category: "missing_data",
          severity: "warning",
          scene_id: sid,
          line_id: lid,
          message: `Duplicate consecutive line: "${line.text.slice(0, 60)}..."`,
          auto_fixable: true,
        });
      }
      prevLineText = line.text;
    }

    // Check characters_present vs actual speakers
    const actualSpeakers = new Set(
      vnScene.lines
        .filter(l => !normalizeSpecialSpeaker(l.speaker))
        .map(l => l.speaker.toUpperCase())
    );
    for (const speaker of actualSpeakers) {
      const inPresent = vnScene.characters_present.some(
        cp => cp.toUpperCase().includes(speaker) || speaker.includes(cp.toUpperCase())
      );
      if (!inPresent) {
        issues.push({
          category: "reference_mismatch",
          severity: "warning",
          scene_id: sid,
          message: `Speaker "${speaker}" speaks but is not in characters_present`,
          auto_fixable: false,
        });
      }
    }

    // Check for speaker-to-line mismatch: dialogue dominated by one speaker
    // when multiple characters are present (potential attribution bug like Dris/Idris)
    if (vnScene.characters_present.length >= 2) {
      const speakerLineCounts = new Map<string, number>();
      for (const line of vnScene.lines) {
        if (normalizeSpecialSpeaker(line.speaker)) continue;
        const key = line.speaker.toUpperCase();
        speakerLineCounts.set(key, (speakerLineCounts.get(key) ?? 0) + 1);
      }
      const presentButSilent = vnScene.characters_present.filter(cp => {
        const upper = cp.toUpperCase();
        // Check if this character spoke at all (by full name or partial match)
        for (const [speaker] of speakerLineCounts) {
          if (speaker.includes(upper) || upper.includes(speaker.split(/[\s—\-]+/)[0])) return false;
        }
        return true;
      });
      for (const silent of presentButSilent) {
        issues.push({
          category: "reference_mismatch",
          severity: "warning",
          scene_id: sid,
          message: `"${silent}" is in characters_present but has zero dialogue lines — possible speaker attribution error`,
          auto_fixable: false,
        });
      }

      // Check for name-similarity collisions among characters_present
      const presentNames = vnScene.characters_present.map(n => n.toLowerCase());
      for (let i = 0; i < presentNames.length; i++) {
        for (let j = i + 1; j < presentNames.length; j++) {
          const a = presentNames[i], b = presentNames[j];
          // Check if one name is a substring of another (Dris/Idris problem)
          if (a.includes(b) || b.includes(a)) {
            issues.push({
              category: "reference_mismatch",
              severity: "warning",
              scene_id: sid,
              message: `Name collision risk: "${vnScene.characters_present[i]}" and "${vnScene.characters_present[j]}" — one name contains the other, may cause LLM attribution errors`,
              auto_fixable: false,
            });
          }
        }
      }
    }
  }

  // Check premise truncation
  if (input.premise.hook_sentence) {
    checkTruncation(input.premise.hook_sentence, undefined, undefined, "premise.hook_sentence", issues);
  }
  if (input.premise.premise_paragraph) {
    checkTruncation(input.premise.premise_paragraph, undefined, undefined, "premise.premise_paragraph", issues);
  }

  const report: StructuralReport = {
    issues,
    stats: {
      total_scenes: identifiedScenes.length,
      total_lines: totalLines,
      error_count: issues.filter(i => i.severity === "error").length,
      warning_count: issues.filter(i => i.severity === "warning").length,
    },
  };

  return { report, scenes: identifiedScenes };
}

// ── Helpers ──

function assignLineIds(scene: VNScene): IdentifiedScene {
  const lines: IdentifiedLine[] = scene.lines.map((line, i) => ({
    ...line,
    _lid: `${scene.scene_id}_L${String(i).padStart(3, "0")}`,
  }));
  return { ...scene, lines };
}

function checkTruncation(
  text: string,
  sceneId: string | undefined,
  lineId: string | undefined,
  field: string,
  issues: StructuralIssue[],
) {
  if (!text || text.length < 10) return;

  const trimmed = text.trimEnd();

  // Mid-word cutoff: ends with a letter but no sentence-ending punctuation
  const lastChar = trimmed[trimmed.length - 1];
  const endsClean = /[.!?…"'\-—)\]:]$/.test(trimmed);
  if (!endsClean && /[a-zA-Z,]$/.test(trimmed)) {
    // Could be intentional trailing word — check if it looks like a cutoff
    const lastWord = trimmed.split(/\s+/).pop() ?? "";
    if (lastWord.length <= 3 && /^[a-z]/.test(lastWord)) {
      issues.push({
        category: "truncation",
        severity: "error",
        scene_id: sceneId,
        line_id: lineId,
        field,
        message: `Possible truncation — ends with "${trimmed.slice(-30)}"`,
        auto_fixable: true,
      });
    }
  }

  // Unclosed quotes
  const doubleQuotes = (text.match(/"/g) || []).length;
  if (doubleQuotes % 2 !== 0) {
    issues.push({
      category: "truncation",
      severity: "warning",
      scene_id: sceneId,
      line_id: lineId,
      field,
      message: `Unclosed double quote in ${field}`,
      auto_fixable: true,
    });
  }
}

function buildSpeakerNormMap(characterNames: Set<string>): Map<string, string> {
  const map = new Map<string, string>();
  for (const name of characterNames) {
    map.set(name.toUpperCase(), name);
    map.set(name.toLowerCase(), name);
    // First name
    const firstName = name.split(/[\s—\-]+/)[0];
    if (firstName && firstName.length > 1) {
      map.set(firstName.toUpperCase(), name);
      map.set(firstName.toLowerCase(), name);
    }
  }
  return map;
}

function checkNormalizationCollisions(normMap: Map<string, string>, issues: StructuralIssue[]) {
  const seen = new Map<string, string>();
  for (const [key, canonical] of normMap) {
    const lower = key.toLowerCase();
    if (seen.has(lower) && seen.get(lower) !== canonical) {
      issues.push({
        category: "reference_mismatch",
        severity: "warning",
        message: `Speaker normalization collision: "${key}" maps to both "${canonical}" and "${seen.get(lower)}"`,
        auto_fixable: false,
      });
    }
    seen.set(lower, canonical);
  }
}

function resolvesSpeaker(
  speaker: string,
  characterNames: Set<string>,
  normMap: Map<string, string>,
): boolean {
  if (characterNames.has(speaker)) return true;
  if (normMap.has(speaker)) return true;
  if (normMap.has(speaker.toUpperCase())) return true;
  if (normMap.has(speaker.toLowerCase())) return true;
  // Fuzzy: check if any character name contains this speaker or vice versa
  for (const name of characterNames) {
    if (name.toUpperCase().includes(speaker.toUpperCase())) return true;
    if (speaker.toUpperCase().includes(name.split(/[\s—\-]+/)[0].toUpperCase())) return true;
  }
  return false;
}
