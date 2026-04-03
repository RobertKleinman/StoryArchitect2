/**
 * v2 Premise Prompts — Steps 2-3: Generate and Review Premise
 */

import type { IntakeTurn } from "../../../../shared/types/project";

export const PREMISE_WRITER_SYSTEM = `You are a master visual novel premise architect. Given a user's story concept and constraints, create a compelling, specific premise that makes someone NEED to read this story.

RULES:
- The hook sentence must be irresistible — it's the "elevator pitch"
- The synopsis should cover beginning, middle, and end at a high level
- Characters must feel like real people, not archetypes
- The core conflict must create genuine tension, not a problem with an obvious solution
- Tone chips should be specific (not generic like "dramatic") — think "sardonic intimacy" or "bureaucratic dread"
- Respect all MUST HONOR constraints — never contradict confirmed facts
- Draw on any cultural research provided for specificity and authenticity

NAMES:
- Character names must draw from diverse real-world cultural/linguistic traditions. Do NOT default to the LLM name register: short, vaguely Northern European names like Kael, Thane, Voss, Elara, Maren, Sorin, Preva. These are recognizably AI-generated.
- Mix cultural origins across the cast (African, East Asian, South Asian, Arabic, Latin American, Mediterranean, Slavic, etc.). Mix phonetic structures: some short, some long, different consonant/vowel patterns.
- If the user's seed already names characters, keep those names. Only generate diverse names for characters you are creating.

OUTPUT FORMAT: JSON matching the provided schema.`;

export function buildPremiseWriterPrompt(args: {
  seedInput: string;
  conversationTurns: IntakeTurn[];
  constraintBlock: string;
  mustHonorBlock: string;
  culturalBrief?: string;
  psychologyBlock?: string;
  revisionFeedback?: string;
  currentPremise?: string;
  forcingBlock?: string;
}): string {
  const parts: string[] = [];

  parts.push(`USER'S STORY CONCEPT: "${args.seedInput}"`);

  if (args.conversationTurns.length > 0) {
    parts.push("\nCONVERSATION WITH USER:");
    for (const turn of args.conversationTurns) {
      parts.push(`  User: ${turn.userInput}`);
      if (turn.systemResponse.question) {
        parts.push(`  System: ${turn.systemResponse.question}`);
      }
      if (turn.systemResponse.assumptions.length > 0) {
        parts.push("  Confirmed assumptions:");
        for (const a of turn.systemResponse.assumptions) {
          parts.push(`    - ${a.category}: ${a.assumption}`);
        }
      }
    }
  }

  if (args.constraintBlock) {
    parts.push(`\nCONFIRMED CONSTRAINTS:\n${args.constraintBlock}`);
  }

  if (args.culturalBrief) {
    parts.push(`\nCULTURAL RESEARCH:\n${args.culturalBrief}`);
  }

  if (args.psychologyBlock) {
    parts.push(`\nUSER SIGNALS:\n${args.psychologyBlock}`);
  }

  if (args.revisionFeedback && args.currentPremise) {
    parts.push(`\nCURRENT PREMISE (to revise):\n${args.currentPremise}`);
    parts.push(`\nUSER'S REVISION REQUEST:\n${args.revisionFeedback}`);
    parts.push("\nRevise the premise according to the user's feedback. Keep everything they didn't mention unchanged.");
  }

  if (args.mustHonorBlock) {
    parts.push(`\n${args.mustHonorBlock}`);
  }

  if (args.forcingBlock) {
    parts.push(`\n${args.forcingBlock}`);
  }

  return parts.join("\n");
}

export const PREMISE_JUDGE_SYSTEM = `You are a quality judge for visual novel premises. Evaluate whether the premise is specific enough, compelling enough, and constraint-compliant to proceed to full story bible generation.

PASS CRITERIA:
- Hook sentence is specific and irresistible (not generic)
- Synopsis covers a complete arc (not just setup)
- Characters have clear wants and conflicts
- Core conflict creates genuine tension
- No MUST HONOR constraints violated
- Tone chips are specific, not generic

Be strict but fair. A premise that's "good enough" should pass — perfection is not required.

OUTPUT FORMAT: JSON matching the provided schema.`;

export function buildPremiseJudgePrompt(args: {
  premise: string;
  mustHonorBlock: string;
}): string {
  const parts: string[] = [];
  parts.push(`PREMISE TO EVALUATE:\n${args.premise}`);
  if (args.mustHonorBlock) {
    parts.push(`\n${args.mustHonorBlock}`);
  }
  parts.push("\nEvaluate this premise. Be strict on specificity and constraint compliance.");
  return parts.join("\n");
}
