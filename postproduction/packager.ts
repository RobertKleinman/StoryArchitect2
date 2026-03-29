/**
 * PACKAGER
 * ════════
 * Zero LLM calls. Pure transformation.
 * - Extracts only what VNBuilder uses
 * - Maps freeform emotions to VNBuilder's 8 expressions
 * - Normalizes speaker names
 * - Validates all references resolve
 * - Fail-closed: hard-fail on unresolved references, invalid data
 * - Emits versioned manifest with stable IDs, warnings, package status
 */

import {
  normalizeSpecialSpeaker,
} from "./types";
import type {
  PipelineOutput,
  IdentifiedScene,
  SceneEditResult,
  VNPackage,
  VNPackageScene,
  VNPackageLine,
  VNPackageCharacter,
  PackagerManifest,
  PackageStatus,
} from "./types";

// ── Emotion Mapping (ported from VNBuilder/vnbuilder/parser.py:121-174) ──

type VNExpression = "neutral" | "angry" | "sad" | "tense" | "warm" | "amused" | "calm" | "formal";

const EMOTION_MAP: Record<string, VNExpression> = {
  // Angry
  frustrated: "angry", irritated: "angry", sharp: "angry", sharper: "angry",
  warning: "angry", cold: "angry", harder: "angry",
  // Sad
  hollow: "sad", fractured: "sad", cracking: "sad", strained: "sad",
  tired: "sad", bare: "sad", brittle: "sad",
  // Tense
  tight: "tense", controlled: "tense", braced: "tense", guarded: "tense",
  careful: "tense", unease: "tense", pressing: "tense", clipped: "tense",
  watching: "tense", waiting: "tense", still: "tense",
  // Warm
  warm: "warm", kind: "warm", gentle: "warm", earnest: "warm",
  sincere: "warm", generous: "warm", soft: "warm", tender: "warm",
  affectionate: "warm", fond: "warm",
  // Amused
  wry: "amused", dry: "amused", shrugging: "amused", playful: "amused",
  teasing: "amused", light: "amused", amused: "amused",
  // Calm
  calm: "calm", even: "calm", measured: "calm", steady: "calm",
  patient: "calm", neutral: "calm", reflective: "calm", thoughtful: "calm",
  mild: "calm", quiet: "calm", conversational: "calm", matter: "calm",
  // Formal
  professional: "formal", procedural: "formal", businesslike: "formal",
  formal: "formal", clinical: "formal", precise: "formal", declarative: "formal",
  focused: "formal", redirecting: "formal",
};

// Fuzzy matchers (substring-based, matching VNBuilder's approach)
const FUZZY_EMOTION_RULES: Array<{ pattern: string; expression: VNExpression }> = [
  { pattern: "louder", expression: "angry" },
  { pattern: "something complicated", expression: "tense" },
  { pattern: "curious", expression: "tense" },
  { pattern: "skeptical", expression: "tense" },
  { pattern: "confused", expression: "tense" },
  { pattern: "flat", expression: "calm" },
  { pattern: "quiet", expression: "calm" },
];

function mapEmotion(emotion: string | null | undefined): {
  mapped: VNExpression;
  confidence: "exact" | "fuzzy" | "default";
  original: string | null;
} {
  if (!emotion) return { mapped: "neutral", confidence: "default", original: null };

  const lower = emotion.toLowerCase().trim();

  // Exact match
  if (EMOTION_MAP[lower]) {
    return { mapped: EMOTION_MAP[lower], confidence: "exact", original: emotion };
  }

  // Try first word (handles "controlled fraying" → "controlled" → tense)
  const firstWord = lower.split(/\s+/)[0];
  if (EMOTION_MAP[firstWord]) {
    return { mapped: EMOTION_MAP[firstWord], confidence: "fuzzy", original: emotion };
  }

  // Fuzzy substring match
  for (const rule of FUZZY_EMOTION_RULES) {
    if (lower.includes(rule.pattern)) {
      return { mapped: rule.expression, confidence: "fuzzy", original: emotion };
    }
  }

  // Default
  return { mapped: "neutral", confidence: "default", original: emotion };
}

// ── Main ──

export function runPackager(
  input: PipelineOutput,
  scenes: IdentifiedScene[],
  editResults: SceneEditResult[],
  options: { forceUnfixed?: boolean } = {},
): { pkg: VNPackage | null; manifest: PackagerManifest } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const emotionMappings: PackagerManifest["emotion_mappings"] = [];
  const unfixedScenes: string[] = [];

  // Check for unfixed scenes
  for (const result of editResults) {
    if (result.status === "unfixed" && result.issues_addressed.length > 0) {
      unfixedScenes.push(result.scene_id);
    }
  }

  if (unfixedScenes.length > 0 && !options.forceUnfixed) {
    errors.push(`${unfixedScenes.length} scene(s) have unresolved issues: ${unfixedScenes.join(", ")}. Use --force to package anyway.`);
  }

  // Extract title
  const title = (input.premise.hook_sentence ?? "Untitled").slice(0, 60);

  // Extract characters
  const characters: Record<string, VNPackageCharacter> = {};
  for (const [name, char] of Object.entries(input.storyBible.characters)) {
    characters[name] = {
      name,
      description: char.description ?? "",
      presentation: char.presentation ?? "",
      role: char.role ?? "unknown",
    };
  }

  // Extract locations
  const locations = input.storyBible.world.arena.locations.map(l => ({
    id: l.id,
    name: l.name,
    description: l.description,
  }));

  // Build speaker normalization map
  const speakerMap = new Map<string, string>();
  for (const name of Object.keys(characters)) {
    speakerMap.set(name.toUpperCase(), name);
    speakerMap.set(name.toLowerCase(), name);
    const firstName = name.split(/[\s—\-]+/)[0];
    if (firstName && firstName.length > 1) {
      speakerMap.set(firstName.toUpperCase(), name);
      speakerMap.set(firstName.toLowerCase(), name);
    }
  }

  // Package scenes
  const packagedScenes: VNPackageScene[] = [];
  let totalLines = 0;

  for (const scene of scenes) {
    const lines: VNPackageLine[] = [];

    for (const line of scene.lines) {
      // Normalize speaker — handle special speakers first
      let speaker = line.speaker;
      const specialSpeaker = normalizeSpecialSpeaker(speaker);
      if (specialSpeaker) {
        speaker = specialSpeaker;
      } else {
        const resolved = speakerMap.get(speaker) ?? speakerMap.get(speaker.toUpperCase());
        if (resolved) {
          speaker = resolved;
        } else {
          // Try fuzzy match
          let found = false;
          for (const [key, canonical] of speakerMap) {
            if (speaker.toUpperCase().includes(key.toUpperCase().split(/[\s—\-]+/)[0]) ||
                key.toUpperCase().includes(speaker.toUpperCase())) {
              speaker = canonical;
              found = true;
              break;
            }
          }
          if (!found) {
            errors.push(`Scene ${scene.scene_id}, line ${line._lid}: unresolved speaker "${speaker}"`);
          }
        }
      }

      // Map emotion
      const { mapped, confidence, original } = mapEmotion(line.emotion);
      if (confidence === "default" && original) {
        warnings.push(`Unmapped emotion "${original}" → neutral (scene ${scene.scene_id}, line ${line._lid})`);
      }
      emotionMappings.push({
        original: original ?? "(none)",
        mapped_to: mapped,
        confidence,
        scene_id: scene.scene_id,
        line_id: line._lid,
      });

      lines.push({
        speaker,
        text: line.text,
        emotion: mapped,
        stage_direction: line.stage_direction ?? null,
        delivery: line.delivery ?? null,
      });
    }

    // Normalize setting to string
    const setting = typeof scene.setting === "string"
      ? scene.setting
      : scene.setting.location;

    // Validate transition
    if (!scene.transition_out) {
      warnings.push(`Scene ${scene.scene_id}: missing transition_out, defaulting to "cut"`);
    }

    packagedScenes.push({
      scene_id: scene.scene_id,
      title: scene.title,
      setting,
      characters_present: scene.characters_present,
      lines,
      transition_out: scene.transition_out || "cut",
    });

    totalLines += lines.length;
  }

  // Validate: no empty scenes
  for (const s of packagedScenes) {
    if (s.lines.length === 0) {
      errors.push(`Scene ${s.scene_id} has 0 lines`);
    }
  }

  // Validate: no empty text
  for (const s of packagedScenes) {
    for (const l of s.lines) {
      if (!l.text || l.text.trim() === "") {
        errors.push(`Scene ${s.scene_id}: empty text in line`);
      }
    }
  }

  // Determine package status
  let packageStatus: PackageStatus;
  if (errors.length > 0 && !options.forceUnfixed) {
    packageStatus = "failed";
  } else if (unfixedScenes.length > 0 || warnings.length > 0) {
    packageStatus = "degraded";
  } else {
    packageStatus = "success";
  }

  const manifest: PackagerManifest = {
    version: 1,
    package_status: packageStatus,
    title,
    characters: Object.keys(characters).length,
    locations: locations.length,
    scenes: packagedScenes.length,
    total_lines: totalLines,
    errors,
    warnings,
    unfixed_scenes: unfixedScenes,
    emotion_mappings: emotionMappings.filter(e => e.confidence !== "exact"), // Only log non-trivial mappings
    generated_at: new Date().toISOString(),
  };

  if (packageStatus === "failed") {
    return { pkg: null, manifest };
  }

  return {
    pkg: { title, characters, locations, scenes: packagedScenes },
    manifest,
  };
}
