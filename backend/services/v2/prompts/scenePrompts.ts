/**
 * v2 Scene Prompts — Step 6: Generate VN Scenes
 */

export const SCENE_WRITER_SYSTEM = `You are a visual novel scene writer. Given a scene plan and story context, write the scene as structured VN output with speaker lines, emotions, and stage directions.

RULES:
- Every line has a speaker (character name, "NARRATION", or "INTERNAL" for inner thoughts)
- Dialogue must match each character's voice_pattern from their profile
- Show conflict through action and dialogue, not exposition
- The scene must follow its dramatic spine: objective → opposition → stakes
- End with the exit_hook to pull the reader into the next scene
- Respect all MUST HONOR constraints

OUTPUT FORMAT: JSON matching the provided schema.`;

export const SCENE_JUDGE_SYSTEM = `You are a quality judge for visual novel scenes. Check that the scene follows its plan, maintains character voice consistency, and advances the tension chain.

CHECK FOR:
1. Objective addressed: Does the scene tackle the planned objective?
2. Voice consistency: Does each character sound like their profile?
3. Pacing match: Does the scene match its planned pacing type?
4. Exit hook: Does the scene end with a compelling hook?
5. MUST HONOR compliance: No constraints violated

OUTPUT FORMAT: JSON matching the provided schema.`;

export function buildSceneWriterPrompt(args: {
  scenePlan: string;
  characterProfiles: string;
  worldContext: string;
  previousSceneDigest: string;
  mustHonorBlock: string;
}): string {
  return [
    `SCENE PLAN:\n${args.scenePlan}`,
    `\nCHARACTERS IN THIS SCENE:\n${args.characterProfiles}`,
    `\nWORLD CONTEXT:\n${args.worldContext}`,
    args.previousSceneDigest ? `\nPREVIOUS SCENE:\n${args.previousSceneDigest}` : "",
    args.mustHonorBlock ? `\n${args.mustHonorBlock}` : "",
    "\nWrite this scene. Make it vivid, specific, and true to each character's voice.",
  ].filter(Boolean).join("\n");
}

export function buildSceneJudgePrompt(args: {
  scene: string;
  scenePlan: string;
  mustHonorBlock: string;
}): string {
  return [
    `SCENE PLAN:\n${args.scenePlan}`,
    `\nWRITTEN SCENE:\n${args.scene}`,
    args.mustHonorBlock ? `\n${args.mustHonorBlock}` : "",
    "\nEvaluate this scene against its plan and constraints.",
  ].filter(Boolean).join("\n");
}
