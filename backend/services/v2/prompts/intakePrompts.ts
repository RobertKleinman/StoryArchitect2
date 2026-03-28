/**
 * v2 Intake Prompts — Step 1: Get the Idea
 */

import type { IntakeTurn } from "../../../../shared/types/project";

export const INTAKE_SYSTEM_PROMPT = `You are a story concept interviewer for a visual novel creation tool. Your job is to understand what story the user wants to create in 1-2 focused exchanges.

GOALS:
- Understand the core "what if?" of their story
- Identify genre, tone, setting, and protagonist
- Surface 3-5 key assumptions for the user to confirm or change
- Determine readiness to move to premise generation

RULES:
- Ask ONE focused question per turn (not a list)
- Surface assumptions as structured objects — things you're inferring that the user should confirm
- If the user gives you enough to work with on turn 1, you CAN set readyForPremise=true
- Never ask more than 2 turns total — if turn 2, set readyForPremise=true
- Be warm and collaborative, not clinical
- Extract behavioral signals about how the user communicates (do they give detail? are they decisive?)
- When suggesting character names, draw from diverse real-world cultural/linguistic traditions. Do NOT default to short, vaguely Northern European names like Kael, Thane, Voss, Sorin, Elara, Maren, Preva — these are recognizably AI-generated. Mix cultural origins and phonetic structures.

OUTPUT FORMAT: JSON matching the provided schema.`;

export function buildIntakeUserPrompt(args: {
  seedInput: string;
  userInput: string;
  turnNumber: number;
  conversationHistory: IntakeTurn[];
  psychologyBlock: string;
  mustHonorBlock: string;
  culturalContext?: string;
}): string {
  const parts: string[] = [];

  if (args.turnNumber === 1) {
    parts.push(`The user wants to create a visual novel. Here is their initial idea:\n\n"${args.seedInput}"`);
  } else {
    parts.push("CONVERSATION SO FAR:");
    for (const turn of args.conversationHistory) {
      parts.push(`\nUser (turn ${turn.turnNumber}): ${turn.userInput}`);
      if (turn.systemResponse.question) {
        parts.push(`System: ${turn.systemResponse.question}`);
      }
    }
    parts.push(`\nUser (turn ${args.turnNumber}): ${args.userInput}`);
  }

  if (args.culturalContext) {
    parts.push(`\nCULTURAL CONTEXT PROVIDED BY USER:\n${args.culturalContext}`);
  }

  if (args.psychologyBlock) {
    parts.push(`\nUSER BEHAVIOR SIGNALS:\n${args.psychologyBlock}`);
  }

  if (args.mustHonorBlock) {
    parts.push(`\n${args.mustHonorBlock}`);
  }

  parts.push(`\nThis is turn ${args.turnNumber} of max 2. ${args.turnNumber >= 2 ? "You MUST set readyForPremise=true." : "Set readyForPremise=true if you have enough to generate a compelling premise."}`);

  return parts.join("\n");
}
