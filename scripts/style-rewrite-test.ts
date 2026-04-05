import "dotenv/config";
import { callLLM } from "../postproduction/llm";
import { buildRewriteSystemPrompt } from "../postproduction/erotica/prompts";
import { readFileSync } from "fs";

async function main() {
  const scene = JSON.parse(readFileSync("data/postproduction/scene-tests/grok4-scene1.json", "utf8"));

  // Extract plot beats from the first draft instead of showing the dialogue
  const plotSummary = `Scene: "Fatal Fix and Evidence Handover"
Setting: Central pit, just after a fight has gone wrong. A fighter is dead on the mat.
Characters: Mateo Cifuentes (newcomer), Kweku Owusu (champion), Nguyen Bao (fixer/promoter), Ogawa Kaito (medic/whistleblower)

WHAT HAPPENS IN THIS SCENE (plot beats only — write fresh dialogue):
1. A fighter is dead on the mat from a throw that went wrong. Enforcers are present.
2. Mateo tries to defend Kweku, claiming the fight was rigged by Nguyen.
3. Nguyen deflects with stories and denials. He speaks in parables.
4. Kweku accepts the expulsion stoically — "that's the rule."
5. Ogawa makes sarcastic asides that cut through Nguyen's stories.
6. Ogawa secretly slips Mateo a data drive with evidence of the fixes.
7. Mateo threatens to go public. Nguyen warns him.
8. Kweku calls Mateo an idiot for getting involved, but doesn't stop him.
9. Scene ends with alarms starting — lockdown coming.

CHARACTER VOICES:
- Mateo: direct, frustrated, can't always finish his thoughts
- Kweku: few words, blunt, doesn't explain himself
- Nguyen: speaks in parables and stories to deflect, never gives a straight answer
- Ogawa: dry sarcasm, says the real thing as an aside or muttered comment`;

  const system = buildRewriteSystemPrompt();

  console.log("Calling grok-4 style rewriter (plot summary, no original dialogue)...");
  const start = Date.now();
  const response = await callLLM("openai-compat", "https://api.x.ai/v1", process.env.GROK_API_KEY!, system, plotSummary, "grok-4", 0.7, 4000);
  console.log(`Done in ${((Date.now() - start) / 1000).toFixed(1)}s\n`);

  const json = response.match(/\{[\s\S]*\}/);
  if (!json) {
    console.log("No JSON found");
    console.log(response.substring(0, 1000));
    return;
  }

  const parsed = JSON.parse(json[0]);

  console.log(`=== FIRST DRAFT (${scene.lines.length} lines) ===\n`);
  for (const l of scene.lines) {
    console.log(`[${l.speaker}] ${l.text}`);
  }

  console.log(`\n=== REWRITE FROM PLOT SUMMARY (${parsed.lines.length} lines) ===\n`);
  for (const l of parsed.lines) {
    console.log(`[${l.speaker}] ${l.text}`);
  }
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
