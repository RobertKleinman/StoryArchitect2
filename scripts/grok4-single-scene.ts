import "dotenv/config";
import { callLLM } from "../postproduction/llm";
import { readFileSync, writeFileSync } from "fs";
import { SCENE_WRITER_SYSTEM } from "../backend/services/v2/prompts/scenePrompts";

async function main() {
  const data = JSON.parse(readFileSync("data/postproduction/bible-tests/bible-test-2026-04-04T18-14-23.json", "utf8"));
  const entry = data.find((r: any) => r.seedId === "arena_rivals");
  const bible = entry.bible;
  const sceneIdx = parseInt(process.argv[2] ?? "0");
  const plan = entry.scenePlan.scenes[sceneIdx];
  console.log(`Scene ${sceneIdx}: "${plan.title}"\n`);

  const chars = Object.entries(bible.characters).map(([name, c]: [string, any]) => {
    const pp = c.psychological_profile || {};
    return `${name} (${c.role}): ${(c.description || "").substring(0, 120)}\n  voice: ${pp.voice_pattern || ""}\n  speech_card: typical_length=${pp.speech_card?.typical_length || ""}, under_pressure=${(pp.speech_card?.under_pressure || "").substring(0, 80)}, deflection=${(pp.speech_card?.deflection_style || "").substring(0, 80)}`;
  }).join("\n\n");

  const user = `SCENE PLAN:
Title: ${plan.title}
Setting: ${plan.setting}
Characters: ${plan.characters_present.join(", ")}
POV: ${plan.pov_character}

SITUATION:
Want: ${plan.objective.want}
Opposition: ${plan.objective.opposition}
Stakes: ${plan.objective.stakes}
Exit hook: ${plan.exit_hook}
Content directives: none

BACKGROUND PRESSURE (submerged guidance only):
Purpose: ${plan.purpose}
Emotion arc: ${plan.emotion_arc.start} > ${plan.emotion_arc.trigger} > ${plan.emotion_arc.end}

CHARACTERS:
${chars}

Write this scene. JSON output with lines array.`;

  console.log("Calling grok-4 (full model)...");
  const start = Date.now();
  const response = await callLLM(
    "openai-compat",
    "https://api.x.ai/v1",
    process.env.GROK_API_KEY!,
    SCENE_WRITER_SYSTEM,
    user,
    "grok-4",
    0.7,
    4000,
  );
  console.log(`Done in ${((Date.now() - start) / 1000).toFixed(1)}s\n`);

  const json = response.match(/\{[\s\S]*\}/);
  if (json) {
    const parsed = JSON.parse(json[0]);
    console.log(`=== ${plan.title} (${parsed.lines.length} lines) ===\n`);
    for (const l of parsed.lines) {
      const em = l.emotion ? ` (${l.emotion})` : "";
      console.log(`[${l.speaker}]${em} ${l.text}`);
    }
    writeFileSync("data/postproduction/scene-tests/grok4-scene1.json", JSON.stringify(parsed, null, 2));
    console.log("\nSaved to data/postproduction/scene-tests/grok4-scene1.json");
  } else {
    console.log("No JSON found in response:");
    console.log(response.substring(0, 1000));
  }
}

main().catch(e => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
