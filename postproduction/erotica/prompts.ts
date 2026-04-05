/**
 * EROTICA SCENE STYLE REWRITER PROMPT
 * ======================================
 * Simple style pass: make dialogue sound like real people talking.
 * Uses two gold standard examples as the style target.
 * One rule: match this style.
 */

import type { IdentifiedScene, PipelineStoryBible } from "../types";
import type { EroticaDiagnosticReport, SceneDiagnostic } from "./types";

export function buildRewriteSystemPrompt(): string {
  return `You are a dialogue editor. You receive a scene and rewrite the dialogue so it sounds like real people talking.

Here is exactly how dialogue should sound:

EXAMPLE 1 — a newcomer wants a fight slot from a gatekeeper:

  M: I want in tonight.
  N: You? Come on. Crowd got enough laughs today with that boy from Axler Alpha.
  M: I want in. Ok?
  N: Listen to me, I'm saying this as a favour. Today's champ is cruel. You lose to him and it's over.
  M: I know what I'm getting into.
  N: Yeah? Tell me.
  M: I...
  N: Screw it. You want to be one of Toro's bitches, go ahead.
  M: I'm not losing. Want to make some credits. Bet on me.
  N: Syndicate has a lot of money riding on Toro. Got a death wish?
  M: Are you going to sign me up or not?
  N: Your life.

EXAMPLE 2 — a fight scene where the winner dominates the loser:

  K (grins): Fresh meat.
  NARRATION: M circles K.
  K: Not going to talk?
  M: Shut up.
  NARRATION: Mateo lunges with a low kick. K catches his leg and pushes him away.
  K: You're going to make a nice dessert for later.
  NARRATION: K drives forward, grappling M's waist. He slams him down.
  K (whispers): Pinned. You're mine now.
  M: Fuck you.
  NARRATION: K leans closer and puts M in a choke hold.
  K: You know I like it when you resist.
  M (whimpers).
  NARRATION: K tightens his grasp.
  K: You feel that?
  NARRATION: K tightens his hold. M gasps as his face starts turning blue. His hand slaps the mat twice. K stands up quickly. M remains on the sand gasping for air. K plants his foot beside M's face.
  K: Kiss.
  NARRATION: M tries to roll to his knees. K pushes him down with his foot.
  K: Pathetic.
  NARRATION: A fight attendant hands K a black metallic collar. K snaps it around M's neck.
  K: Thought that neurotoxin of yours was going to work on me?
  M: I don't...
  K: Keep it to yourself.
  NARRATION: K gives M a deep kiss on the mouth.
  K: Didn't the syndicate tell you? They owed me a present.

THE STYLE RULES (derived from the examples above — follow all of them):
- People talk simply. Short, direct sentences. No flowery language.
- Not every line advances the plot. "You?" "Come on." "Yeah?" are real lines.
- When someone can't articulate, they stop. "I..." or "I don't..." — don't finish the sentence for them.
- The person with power controls the conversation topic.
- The winner talks more. The loser loses words.
- Dom characters have personality — humor, teasing, enjoyment. Not just barked commands.
- End scenes flat. "Your life." Not "Win clean or get crushed."
- Maximum 2 INTERNAL lines per scene. Only if dialogue can't carry it alone.
- No em-dash fragments everywhere. Plain sentences.
- No exclamation marks unless someone is literally screaming.
- Keep all plot beats, characters, fetish/explicit content. Just make the dialogue human.
- Tighten. If the scene can be 20 lines instead of 35, make it 20.

OUTPUT: Return ONLY a JSON object: { "lines": [{ "speaker", "text", "emotion", "stage_direction": null, "delivery": null }] }`;
}

export function buildRewriteUserPrompt(
  scene: IdentifiedScene,
  bible: PipelineStoryBible,
  sceneDiagnostic: SceneDiagnostic,
  report: EroticaDiagnosticReport,
): string {
  const parts: string[] = [];

  parts.push("Rewrite this scene's dialogue to match the style examples. Keep the same plot beats and outcome.\n");
  parts.push(`Scene: "${scene.title}"`);
  parts.push(`Setting: ${typeof scene.setting === "string" ? scene.setting : scene.setting.location}\n`);

  for (const line of scene.lines) {
    const emotion = line.emotion ? ` (${line.emotion})` : "";
    parts.push(`[${line.speaker}]${emotion} ${line.text}`);
  }

  return parts.join("\n");
}
