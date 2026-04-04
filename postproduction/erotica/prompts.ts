/**
 * EROTICA SCENE REWRITER PROMPT
 * ================================
 * Builds a single editorial brief for scene-level rewriting.
 * The LLM receives the full scene, character context, and editorial notes,
 * then returns a complete rewritten scene — like a real second draft.
 */

import type { IdentifiedScene, PipelineStoryBible } from "../types";
import type { EroticaDiagnosticReport, SceneDiagnostic } from "./types";

/**
 * Build the system prompt for the scene rewriter.
 * This is the editorial voice — it tells the LLM how to think like an editor.
 */
export function buildRewriteSystemPrompt(): string {
  return `You are a developmental editor rewriting scenes in adult fiction (visual novel format).

You receive a first draft scene with editorial notes identifying specific problems. Your job is to rewrite the ENTIRE scene as a polished second draft that fixes the noted issues while preserving the story.

EDITORIAL PRINCIPLES:

1. CHARACTERS MUST STAY IN ROLE
   - An announcer announces. She talks about the crowd, the stakes, the rivalry — not the fetish acts in pornographic detail.
   - A military officer speaks like an officer, not a cartoon villain.
   - Supporting characters have their own agenda, not just reactions to the main dynamic.
   - Every character should sound like a real person doing their job, not a narrator of kink.

2. INTERNAL MONOLOGUE IS A SCALPEL, NOT A CRUTCH
   - Maximum 3 INTERNAL lines per scene. If the original has more, cut the weakest ones.
   - INTERNAL should reveal something the dialogue and action CAN'T — a hidden motive, a lie, a contradiction.
   - Never use INTERNAL to explain what the reader can already see from the action.
   - Format: short, declarative, unsentimental. "This is wrong." Not "*A deep conflict stirs within—why does this pull?*"
   - No rhetorical self-questions. State it. "Mouth watering. That's new." Not "Why's my mouth watering?"

3. THE FETISH IS ONE INGREDIENT, NOT THE WHOLE DISH
   - Fetish content should be present and unflinching — do NOT sanitize or fade to black.
   - But the scene needs OTHER dramatic content: information exchange, power negotiation, relationship shifts, humor, professional stakes.
   - If 5+ consecutive lines are all fetish-focused, break the run with a non-fetish beat.
   - The tension between the fetish and the rest of the scene IS the story.

4. DIALOGUE SHOULD SOUND LIKE PEOPLE TALKING
   - Short lines are fine. Long lines are fine. Vary naturally based on what the character is saying.
   - Characters sometimes talk past each other, change subject, or don't respond to what was just said.
   - Don't force length. A 2-word command can be perfect. A 20-word tease can be perfect. The problem is when every line is the same shape.
   - Reduce vocative address terms (nicknames, titles). People don't say each other's name/title in every sentence.
   - Exclamation marks: almost never. Quiet intensity beats shouting.

5. PRESERVE WHAT WORKS
   - Keep the same plot beats and scene outcome.
   - Keep the same characters and power dynamic.
   - Keep all explicit/fetish content — just don't let it crowd out everything else.
   - Keep the scene's word count within 80-120% of the original.

OUTPUT FORMAT:
Return the rewritten scene as a JSON object matching this exact structure:
{
  "lines": [
    { "speaker": "CHARACTER NAME", "text": "dialogue text", "emotion": "emotion_tag", "stage_direction": null, "delivery": null },
    { "speaker": "NARRATION", "text": "action/description", "emotion": null, "stage_direction": null, "delivery": null },
    { "speaker": "INTERNAL", "text": "thought text", "emotion": "emotion_tag", "stage_direction": null, "delivery": null }
  ]
}

Return ONLY the JSON. No commentary.`;
}

/**
 * Build the user prompt for a specific scene, including the original scene,
 * character context, and editorial notes from the diagnostic.
 */
export function buildRewriteUserPrompt(
  scene: IdentifiedScene,
  bible: PipelineStoryBible,
  sceneDiagnostic: SceneDiagnostic,
  report: EroticaDiagnosticReport,
): string {
  const parts: string[] = [];

  // Character context
  parts.push("## CHARACTERS IN THIS SCENE");
  for (const charName of scene.characters_present) {
    const char = bible.characters[charName];
    if (char) {
      parts.push(`- **${charName}**: ${char.role ?? "unknown role"}. ${(char.description ?? "").substring(0, 150)}`);
    }
  }

  // Editorial notes from diagnostic
  parts.push("\n## EDITORIAL NOTES FOR THIS SCENE");

  const notes: string[] = [];

  if (sceneDiagnostic.dom_command_count > 0) {
    notes.push(`- DOM COMMAND MONOTONY: ${sceneDiagnostic.dom_command_count} lines are short barked imperatives. Vary the dominant character's tactics — teasing, questioning, psychological pressure, quiet menace, not just "Kneel." and "Strip."`);
  }

  if (sceneDiagnostic.nickname_count > 0) {
    notes.push(`- NICKNAME OVERUSE: ${sceneDiagnostic.nickname_count} lines use vocative address terms as decoration. Strip most of them — people don't say "rebel" or "pilot" or "pet" every sentence.`);
  }

  if (sceneDiagnostic.internal_template_count > 0) {
    notes.push(`- INTERNAL TEMPLATE: ${sceneDiagnostic.internal_template_count} internal lines share the same structural pattern (asterisk-wrapped, em-dash, body sensation). Vary the format and cut to max 3 INTERNAL lines total.`);
  }

  // Check for role-breaking (announcer/supporting characters narrating fetish)
  const nonProtagLines = scene.lines.filter(l => {
    const sp = l.speaker.toUpperCase();
    if (sp === "NARRATION" || sp === "INTERNAL") return false;
    const char = Object.entries(bible.characters).find(([name]) => name.toUpperCase() === sp);
    return char && char[1].role !== "protagonist" && char[1].role !== "antagonist";
  });
  const fetishNarrating = nonProtagLines.filter(l =>
    /lick|suck|worship|sole|toe|foot|feet|boot|musk|sweat|tongue|arch|heel/i.test(l.text)
  );
  if (fetishNarrating.length > 0) {
    const speakers = [...new Set(fetishNarrating.map(l => l.speaker))].join(", ");
    notes.push(`- ROLE BREAK: ${speakers} is narrating fetish acts in detail instead of speaking in their professional role. Rewrite their lines to stay in character — they can react to what's happening but shouldn't describe it like a porn narrator.`);
  }

  // Count INTERNAL lines
  const internalCount = scene.lines.filter(l => l.speaker.toUpperCase() === "INTERNAL").length;
  if (internalCount > 3) {
    notes.push(`- TOO MUCH INTERNAL: ${internalCount} internal monologue lines. Cut to 3 max. Keep only the ones that reveal something the reader can't see from the action.`);
  }

  // Fetish density — check for long runs of fetish-only content
  let fetishRun = 0;
  let maxFetishRun = 0;
  for (const line of scene.lines) {
    if (/lick|suck|worship|sole|toe|foot|feet|boot|musk|sweat|tongue|arch|heel|kneel|sniff|inhale/i.test(line.text)) {
      fetishRun++;
      if (fetishRun > maxFetishRun) maxFetishRun = fetishRun;
    } else {
      fetishRun = 0;
    }
  }
  if (maxFetishRun >= 5) {
    notes.push(`- FETISH DENSITY: ${maxFetishRun} consecutive lines are all fetish-focused. Break up with non-fetish dramatic beats (intel, relationship tension, humor, professional stakes).`);
  }

  // Exclamation marks
  const exclCount = scene.lines.filter(l =>
    l.speaker.toUpperCase() !== "NARRATION" && l.text.includes("!")
  ).length;
  if (exclCount > 2) {
    notes.push(`- EXCLAMATION OVERUSE: ${exclCount} lines with exclamation marks. Quiet intensity beats shouting. Cut to 1-2 max.`);
  }

  // Vulnerability
  if (sceneDiagnostic.vulnerability_rate === 0) {
    notes.push(`- NO VULNERABILITY: Every character is either commanding or defiant. Add at least one moment where someone drops the mask — even briefly.`);
  }

  if (notes.length === 0) {
    notes.push("- No major issues detected. Polish for naturalness.");
  }

  parts.push(notes.join("\n"));

  // The original scene
  parts.push("\n## ORIGINAL SCENE (first draft)");
  parts.push(`Title: "${scene.title}"`);
  parts.push(`Setting: ${typeof scene.setting === "string" ? scene.setting : scene.setting.location}`);
  parts.push("");
  for (const line of scene.lines) {
    const emotion = line.emotion ? ` (${line.emotion})` : "";
    parts.push(`[${line.speaker}]${emotion} ${line.text}`);
  }

  parts.push("\n## YOUR TASK");
  parts.push("Rewrite this scene as a complete second draft, fixing the editorial notes above. Return the full scene as JSON.");

  return parts.join("\n");
}
