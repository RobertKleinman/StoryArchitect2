/**
 * EROTICA DIALOGUE REWRITER PROMPTS
 * ====================================
 * Three separate prompt strategies for the three fixable issue types.
 * Each returns a system prompt and user message for the LLM.
 */

import type { IdentifiedScene, IdentifiedLine } from "../types";
import type { FlaggedLine } from "./types";

// ── Dom Command Rewrite ─────────────────────────────────────────

export function buildDomCommandPrompt(
  scene: IdentifiedScene,
  flagged: FlaggedLine[],
): { system: string; user: string } {
  const system = `You are rewriting dom character dialogue in adult fiction to add variety.

PROBLEM: The dominant character speaks almost exclusively in short barked imperatives (2-6 words).
Real dominance is expressed through varied tactics: teasing, psychological pressure, rhetorical questions,
longer provocations, and occasional softness that makes the control more unsettling.

YOUR JOB: Rewrite ONLY the flagged lines. For each, choose a DIFFERENT approach:
- Tease or provoke with a longer sentence (10-20 words)
- Ask a rhetorical question that asserts control
- Show specific desire or reaction, not just a generic command
- Use humor, mockery, or psychological insight
- Occasionally drop the voice — quiet, almost gentle (this is MORE threatening)

RULES:
- Keep the SAME power dynamic and sexual/fetish content
- New text must be within 80-120% of original word count for the scene total
- Do NOT add new characters or change what physically happens
- Do NOT sanitize, euphemize, or remove explicit language, body descriptions, or sexual acts
- Preserve all fetish content exactly — your job is VARIETY, not censorship
- Not every line needs to be long — some short commands are fine. The problem is ALL of them being short.

OUTPUT FORMAT: Return a JSON object:
{
  "diffs": [
    {
      "line_id": "the _lid of the line",
      "expected_old_text": "the current text (for verification)",
      "action": "replace",
      "new_line": { "speaker": "same speaker", "text": "new text", "emotion": "new emotion tag", "stage_direction": null, "delivery": null }
    }
  ]
}

Only include diffs for lines you are actually changing. If a flagged line is fine as-is, skip it.`;

  const flaggedIds = new Set(flagged.map(f => f.line_id));
  const sceneLines = scene.lines.map(l => {
    const marker = flaggedIds.has(l._lid) ? " ← FLAGGED" : "";
    return `[${l._lid}] [${l.speaker}] (${l.emotion ?? ""}) ${l.text}${marker}`;
  }).join("\n");

  const user = `SCENE: "${scene.title}"

LINES:
${sceneLines}

Rewrite the FLAGGED dom command lines to add variety. Return JSON diffs only.`;

  return { system, user };
}

// ── Nickname Overuse Rewrite ────────────────────────────────────

export function buildNicknamePrompt(
  scene: IdentifiedScene,
  flagged: FlaggedLine[],
): { system: string; user: string } {
  const system = `You are removing excessive vocative address terms (nicknames, insults, titles) from dialogue.

PROBLEM: Characters overuse address terms like "pet", "rebel", "commander", "champ" as sentence decoration.
Using someone's nickname occasionally is fine — using it in 30%+ of lines makes the dialogue feel robotic.

YOUR JOB: For each flagged line, choose ONE approach:
(a) Delete the address term entirely — the line still makes sense without it
(b) Replace with a different address that hasn't been used in this scene yet
(c) Restructure the sentence so the address is implicit

RULES:
- Only touch the address term and immediately surrounding punctuation
- Keep the rest of the line EXACTLY as-is
- Do NOT change the meaning, emotion, or explicit content of the line
- Aim for < 10% address rate across the scene's dialogue
- Some address terms should survive — don't strip them ALL. Remove the decorative ones.

OUTPUT FORMAT: Return a JSON object:
{
  "diffs": [
    {
      "line_id": "the _lid of the line",
      "expected_old_text": "the current text",
      "action": "replace",
      "new_line": { "speaker": "same speaker", "text": "new text", "emotion": "same emotion", "stage_direction": null, "delivery": null }
    }
  ]
}`;

  const flaggedIds = new Set(flagged.map(f => f.line_id));
  const sceneLines = scene.lines.map(l => {
    const marker = flaggedIds.has(l._lid) ? ` ← FLAGGED (${flagged.find(f => f.line_id === l._lid)?.reason ?? ""})` : "";
    return `[${l._lid}] [${l.speaker}] (${l.emotion ?? ""}) ${l.text}${marker}`;
  }).join("\n");

  const user = `SCENE: "${scene.title}"

LINES:
${sceneLines}

Remove or vary the excessive address terms in FLAGGED lines. Return JSON diffs only.`;

  return { system, user };
}

// ── Internal Template Rewrite ───────────────────────────────────

export function buildInternalTemplatePrompt(
  scene: IdentifiedScene,
  flagged: FlaggedLine[],
): { system: string; user: string } {
  const system = `You are diversifying the structural format of INTERNAL monologue lines in adult fiction.

PROBLEM: 60%+ of INTERNAL lines share the same structural template:
  *Asterisk-wrapped. Em-dash interruption—body sensation word.*
The individual words vary but the SHAPE is identical, making every thought feel formulaic.

YOUR JOB: Rewrite flagged INTERNAL lines using DIFFERENT structural approaches. Distribute across these:
- Complete thought without interruption (no em-dash or ellipsis): "The taste of him is already familiar."
- Short fragment without asterisks (2-5 words): "Too close. Too fast."
- Emotion or memory focus instead of body sensation: "Last time someone held me like this, I still had choices."
- Metaphor or association: "Like pressing your tongue to a battery and wanting more."
- Observation rather than reaction: "His hands haven't moved but mine are shaking."

RULES:
- Keep the CHARACTER'S emotional state and what they're responding to
- New text must be within 80-120% of original word count
- Preserve explicit content and body references where they serve the scene
- Do NOT make all internals the same NEW template — the goal is VARIETY
- Do NOT sanitize, euphemize, or remove any sexual/fetish content
- Some asterisk-wrapped lines can stay — the problem is when ALL of them are

OUTPUT FORMAT: Return a JSON object:
{
  "diffs": [
    {
      "line_id": "the _lid of the line",
      "expected_old_text": "the current text",
      "action": "replace",
      "new_line": { "speaker": "INTERNAL", "text": "new text", "emotion": "appropriate emotion", "stage_direction": null, "delivery": null }
    }
  ]
}`;

  const flaggedIds = new Set(flagged.map(f => f.line_id));
  const sceneLines = scene.lines.map(l => {
    const marker = flaggedIds.has(l._lid) ? " ← FLAGGED" : "";
    return `[${l._lid}] [${l.speaker}] (${l.emotion ?? ""}) ${l.text}${marker}`;
  }).join("\n");

  const user = `SCENE: "${scene.title}"

LINES:
${sceneLines}

Rewrite the FLAGGED INTERNAL lines to use varied structural formats. Return JSON diffs only.`;

  return { system, user };
}
