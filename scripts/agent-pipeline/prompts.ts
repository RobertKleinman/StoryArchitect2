/**
 * Agent Pipeline — prompt builders.
 *
 * Thin wrappers around the real v2 prompt builder functions. Given a
 * current AgentProject + role context, produce an AgentPromptSpec
 * that the CLI can emit as JSON for the orchestrator (me, in chat)
 * to pass to a subagent.
 *
 * These wrappers NEVER modify state. They only read it.
 */

import {
  INTAKE_SYSTEM_PROMPT,
  buildIntakeUserPrompt,
} from "../../backend/services/v2/prompts/intakePrompts";
import {
  PREMISE_WRITER_SYSTEM,
  PREMISE_JUDGE_SYSTEM,
  buildPremiseWriterPrompt,
  buildPremiseJudgePrompt,
} from "../../backend/services/v2/prompts/premisePrompts";
import {
  WORLD_WRITER_SYSTEM,
  CHARACTER_WRITER_SYSTEM,
  PLOT_WRITER_SYSTEM,
  BIBLE_JUDGE_SYSTEM,
  SCENE_PLANNER_SYSTEM,
  buildWorldPrompt,
  buildCharacterPrompt,
  buildPlotPrompt,
  buildBibleJudgePrompt,
  buildScenePlannerPrompt,
} from "../../backend/services/v2/prompts/biblePrompts";
import {
  INTAKE_SCHEMA,
  PREMISE_WRITER_SCHEMA,
  PREMISE_JUDGE_SCHEMA,
} from "../../backend/services/v2/schemas/premiseSchemas";
import {
  WORLD_WRITER_SCHEMA,
  CHARACTER_WRITER_SCHEMA,
  PLOT_WRITER_SCHEMA,
  BIBLE_JUDGE_SCHEMA,
  SCENE_PLANNER_SCHEMA,
} from "../../backend/services/v2/schemas/bibleSchemas";
import {
  SCENE_WRITER_SYSTEM,
  SCENE_JUDGE_SYSTEM,
  buildSceneWriterPrompt,
  buildSceneJudgePrompt,
  formatScenePlanForWriter,
} from "../../backend/services/v2/prompts/scenePrompts";
import {
  SCENE_WRITER_SCHEMA,
  SCENE_JUDGE_SCHEMA,
} from "../../backend/services/v2/schemas/sceneSchemas";
import {
  compressForScene,
  previousSceneDigest,
  buildCanonicalNames,
} from "../../backend/services/v2/contextCompressor";
import {
  SENSORY_PALETTE_SYSTEM,
  buildSensoryPalettePrompt,
  SENSORY_PALETTE_SCHEMA,
} from "../../shared/sensoryPalette";
import {
  getForcingFunctions,
  formatForcingBlock,
} from "../../shared/narrativeForcingFunctions";
import {
  loadFingerprints,
  buildFreshnessBlock,
} from "../../shared/fingerprint";
import { buildMustHonorBlock } from "../../backend/services/mustHonorBlock";
import { formatPsychologyLedgerForPrompt } from "../../backend/services/psychologyEngine";
import { DEFAULT_V2_MODEL_CONFIG } from "../../shared/modelConfig";

import type { AgentProject } from "./state";
import type {
  Step1_IdeaGathering,
  Step2_PremiseGenerating,
  Step4_BibleGenerating,
  Step6_SceneGenerating,
} from "../../shared/types/project";

// ── The spec the CLI emits ──────────────────────────────────────────

export interface AgentPromptSpec {
  role: string;
  model: string;                // real default-mode model (informational only)
  subagentTier: "sonnet" | "haiku" | "opus"; // which tier I should route to
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  userPrompt: string;
  schema: Record<string, unknown>;
  stage: string;                // human-readable action label
  turnNumber?: number;          // only for intake
}

// ── Role → subagent tier mapping (mirrors DEFAULT_V2_MODEL_CONFIG) ──
//
// Strong (sonnet) for writers, intake, premise/bible judges.
// Fast (haiku) for scene judge + summarizer. We'll add those in later
// phases.

function tierFor(role: string): "sonnet" | "haiku" | "opus" {
  switch (role) {
    case "scene_judge":
    case "v2_summarizer":
      return "haiku";
    default:
      return "sonnet";
  }
}

// ── Premise formatting + compression helpers (mirror bibleService private methods) ──

export function formatPremiseForBible(
  premise: any,
  nameMap?: Map<string, string>,
): string {
  let result = [
    `HOOK: ${premise.hook_sentence}`,
    `EMOTIONAL PROMISE: ${premise.emotional_promise}`,
    `PREMISE: ${premise.premise_paragraph}`,
    `SYNOPSIS: ${premise.synopsis}`,
    `SETTING: ${premise.setting_anchor} (${premise.time_period})`,
    `TONE: ${premise.tone_chips?.join(", ")}`,
    `CORE CONFLICT: ${premise.core_conflict}`,
    `CHARACTERS: ${premise.characters_sketch?.map((c: any) => `${c.name} (${c.role}): ${c.one_liner}`).join("; ")}`,
    premise.bans?.length ? `BANS: ${premise.bans.join(", ")}` : "",
  ].filter(Boolean).join("\n");

  if (nameMap) {
    for (const [name, placeholder] of nameMap) {
      result = result.replaceAll(name, placeholder);
    }
  }
  return result;
}

export function buildPremiseNameMap(premise: any): Map<string, string> {
  const map = new Map<string, string>();
  const sketches = premise.characters_sketch ?? [];
  for (let i = 0; i < sketches.length; i++) {
    if (sketches[i].name) {
      map.set(sketches[i].name, `__CHAR_${String.fromCharCode(65 + i)}__`);
    }
  }
  return map;
}

export function compressWorldForPlot(world: any): string {
  if (!world) return "(world not available)";
  const parts = [
    `Thesis: ${world.world_thesis ?? ""}`,
    `Locations: ${(world.arena?.locations ?? []).map((l: any) => l.name).join(", ")}`,
    `Rules: ${(world.rules ?? []).map((r: any) => r.rule).join("; ")}`,
    `Factions: ${(world.factions ?? []).map((f: any) => `${f.name}: ${f.goal}`).join("; ")}`,
  ];
  return parts.join("\n");
}

export function compressCharsForPlot(chars: any): string {
  if (!chars) return "(characters not available)";
  const parts: string[] = [];
  for (const c of (chars.characters ?? [])) {
    const pp = c.psychological_profile ?? {};
    parts.push(
      `${c.name} (${c.role}): wants ${pp.want ?? "?"}; misbelieves ${pp.misbelief ?? "?"}; breaks when ${pp.break_point ?? "?"}`,
    );
  }
  if (chars.relationships?.length) {
    parts.push("");
    for (const r of chars.relationships) {
      parts.push(
        `${(r.between ?? []).join(" + ")}: ${r.nature} (stated: ${r.stated_dynamic}; true: ${r.true_dynamic})`,
      );
    }
  }
  return parts.join("\n");
}

export function compressBibleForPlanner(world: any, chars: any, plot: any): string {
  const parts: string[] = [];
  if (world) {
    parts.push("WORLD:");
    parts.push(`  Thesis: ${world.world_thesis}`);
    parts.push("  LOCATIONS:");
    for (const loc of (world.arena?.locations ?? [])) {
      parts.push(`    ${loc.name}: ${(loc.description ?? "").slice(0, 80)}`);
      if (loc.affordances?.length) {
        parts.push(`      Affordances: ${loc.affordances.join("; ")}`);
      }
    }
    parts.push(`  Rules: ${world.rules?.map((r: any) => r.rule).join("; ")}`);
  }
  if (chars) {
    parts.push("\nCHARACTERS:");
    for (const c of (chars.characters ?? [])) {
      parts.push(
        `  ${c.name} (${c.role}): wants ${c.psychological_profile?.want}; misbelieves ${c.psychological_profile?.misbelief}`,
      );
    }
  }
  if (plot) {
    parts.push("\nTENSION CHAIN:");
    for (const beat of (plot.tension_chain ?? [])) {
      parts.push(`  ${beat.id}: ${beat.beat} [${beat.characters_involved?.join(", ")}]`);
    }
    parts.push(`\nCLIMAX: ${plot.climax?.beat}`);
    parts.push(`RESOLUTION: ${plot.resolution?.emotional_landing}`);
  }
  return parts.join("\n");
}

// ── Helpers ──────────────────────────────────────────────────────────

function formatConstraints(ledger: Array<{ key: string; value: string; confidence: string }>): string {
  if (!ledger || ledger.length === 0) return "";
  return ledger
    .filter((e) => e.confidence === "confirmed")
    .map((e) => `${e.key}: ${e.value}`)
    .join("\n");
}

// ── Intake prompt ────────────────────────────────────────────────────
//
// `userInput` is required for turns ≥ 2 (the user's answer to the
// previous intake question). For turn 1, it's the seed itself.

export function buildIntakePrompt(
  project: AgentProject,
  userInput: string,
): AgentPromptSpec {
  const state = project.state;
  if (state.step !== "idea_gathering") {
    throw new Error(`Cannot build intake prompt from step=${state.step}`);
  }
  const s1 = state as Step1_IdeaGathering;
  const turnNumber = s1.conversationTurns.length + 1;
  if (turnNumber > 2) {
    throw new Error("Intake is capped at 2 turns");
  }

  const psychBlock = formatPsychologyLedgerForPrompt(s1.psychologyLedger);
  const mustHonor = buildMustHonorBlock(s1.constraintLedger);

  const userPrompt = buildIntakeUserPrompt({
    seedInput: s1.seedInput ?? userInput,
    userInput,
    turnNumber,
    conversationHistory: s1.conversationTurns,
    psychologyBlock: psychBlock,
    mustHonorBlock: mustHonor,
    culturalContext: s1.culturalContext,
  });

  return {
    role: "intake",
    model: DEFAULT_V2_MODEL_CONFIG.intake,
    subagentTier: tierFor("intake"),
    temperature: 0.7,
    maxTokens: 2000,
    systemPrompt: INTAKE_SYSTEM_PROMPT,
    userPrompt,
    schema: INTAKE_SCHEMA,
    stage: `intake-turn-${turnNumber}`,
    turnNumber,
  };
}

// ── Premise writer ───────────────────────────────────────────────────

export function buildPremiseWriterSpec(project: AgentProject): AgentPromptSpec {
  const state = project.state;
  if (state.step !== "premise_generating") {
    throw new Error(`Cannot build premise writer prompt from step=${state.step}`);
  }
  const s2 = state as Step2_PremiseGenerating;
  const mustHonor = buildMustHonorBlock(s2.constraintLedger);
  const psychBlock = formatPsychologyLedgerForPrompt(s2.psychologyLedger);
  const forcingBlock = formatForcingBlock(getForcingFunctions(s2.mode, "premise"));

  const userPrompt = buildPremiseWriterPrompt({
    seedInput: s2.seedInput,
    conversationTurns: s2.conversationTurns,
    constraintBlock: formatConstraints(s2.constraintLedger),
    mustHonorBlock: mustHonor,
    psychologyBlock: psychBlock,
    forcingBlock,
    mode: s2.mode,
  });

  return {
    role: "premise_writer",
    model: DEFAULT_V2_MODEL_CONFIG.premise_writer,
    subagentTier: tierFor("premise_writer"),
    temperature: 0.8,
    maxTokens: 3000,
    systemPrompt: PREMISE_WRITER_SYSTEM,
    userPrompt,
    schema: PREMISE_WRITER_SCHEMA,
    stage: "premise-writer",
  };
}

// ── Premise writer (repair) ─────────────────────────────────────────

export function buildPremiseRepairSpec(project: AgentProject): AgentPromptSpec {
  const state = project.state;
  if (state.step !== "premise_generating") {
    throw new Error(`Cannot build premise repair prompt from step=${state.step}`);
  }
  const s2 = state as Step2_PremiseGenerating;
  const draft = project.extension.draftPremise;
  const judge = project.extension.premiseJudge;
  if (!draft || !judge) {
    throw new Error("Cannot repair premise without draft + judge result");
  }

  const mustHonor = buildMustHonorBlock(s2.constraintLedger);
  const psychBlock = formatPsychologyLedgerForPrompt(s2.psychologyLedger);
  const forcingBlock = formatForcingBlock(getForcingFunctions(s2.mode, "premise"));

  const revisionFeedback = judge.issues
    .map((i) => `${i.field}: ${i.fix_instruction}`)
    .join("\n");

  const userPrompt = buildPremiseWriterPrompt({
    seedInput: s2.seedInput,
    conversationTurns: s2.conversationTurns,
    constraintBlock: formatConstraints(s2.constraintLedger),
    mustHonorBlock: mustHonor,
    psychologyBlock: psychBlock,
    forcingBlock,
    revisionFeedback,
    currentPremise: JSON.stringify(draft, null, 2),
    mode: s2.mode,
  });

  return {
    role: "premise_writer",
    model: DEFAULT_V2_MODEL_CONFIG.premise_writer,
    subagentTier: tierFor("premise_writer"),
    temperature: 0.7, // lower on repair, matches real service
    maxTokens: 3000,
    systemPrompt: PREMISE_WRITER_SYSTEM,
    userPrompt,
    schema: PREMISE_WRITER_SCHEMA,
    stage: "premise-writer-repair",
  };
}

// ── Premise judge ────────────────────────────────────────────────────

export function buildPremiseJudgeSpec(project: AgentProject): AgentPromptSpec {
  const state = project.state;
  if (state.step !== "premise_generating") {
    throw new Error(`Cannot build premise judge prompt from step=${state.step}`);
  }
  const s2 = state as Step2_PremiseGenerating;
  const draft = project.extension.draftPremise;
  if (!draft) {
    throw new Error("Cannot judge premise without a draft");
  }
  const mustHonor = buildMustHonorBlock(s2.constraintLedger);

  const userPrompt = buildPremiseJudgePrompt({
    premise: JSON.stringify(draft, null, 2),
    mustHonorBlock: mustHonor,
  });

  return {
    role: "premise_judge",
    model: DEFAULT_V2_MODEL_CONFIG.premise_judge,
    subagentTier: tierFor("premise_judge"),
    temperature: 0.3,
    maxTokens: 800,
    systemPrompt: PREMISE_JUDGE_SYSTEM,
    userPrompt,
    schema: PREMISE_JUDGE_SCHEMA,
    stage: "premise-judge",
  };
}

// ─────────────────────────────────────────────────────────────────────
// Phase 2 — Bible generation specs
// ─────────────────────────────────────────────────────────────────────

function requireBibleState(project: AgentProject): Step4_BibleGenerating {
  if (project.state.step !== "bible_generating") {
    throw new Error(`Expected step=bible_generating, got ${project.state.step}`);
  }
  return project.state as Step4_BibleGenerating;
}

// World writer ─────────────────────────────────────────────────────

export async function buildWorldWriterSpec(project: AgentProject): Promise<AgentPromptSpec> {
  const s4 = requireBibleState(project);
  const mustHonor = buildMustHonorBlock(s4.constraintLedger);
  const nameMap = buildPremiseNameMap(s4.premise);
  const premiseStr = formatPremiseForBible(s4.premise, nameMap);
  const fingerprints = await loadFingerprints();
  const freshnessBlock = buildFreshnessBlock(fingerprints);
  const forcingBlock = formatForcingBlock(getForcingFunctions(s4.mode, "bible"));

  const userPrompt = buildWorldPrompt({
    premise: premiseStr,
    mustHonorBlock: mustHonor,
    freshnessBlock,
    forcingBlock,
    mode: s4.mode,
  });

  return {
    role: "bible_writer",
    model: DEFAULT_V2_MODEL_CONFIG.bible_writer,
    subagentTier: tierFor("bible_writer"),
    temperature: 0.8,
    maxTokens: 4000,
    systemPrompt: WORLD_WRITER_SYSTEM,
    userPrompt,
    schema: WORLD_WRITER_SCHEMA,
    stage: "bible-world",
  };
}

// Character writer ─────────────────────────────────────────────────

export async function buildCharacterWriterSpec(project: AgentProject): Promise<AgentPromptSpec> {
  const s4 = requireBibleState(project);
  const worldData = s4.checkpoint.worldData;
  if (!worldData) {
    throw new Error("buildCharacterWriterSpec: worldData missing from checkpoint");
  }
  const mustHonor = buildMustHonorBlock(s4.constraintLedger);
  const nameMap = buildPremiseNameMap(s4.premise);
  const premiseStr = formatPremiseForBible(s4.premise, nameMap);
  const fingerprints = await loadFingerprints();
  const freshnessBlock = buildFreshnessBlock(fingerprints);
  const forcingBlock = formatForcingBlock(getForcingFunctions(s4.mode, "bible"));

  const userPrompt = buildCharacterPrompt({
    premise: premiseStr,
    worldSection: JSON.stringify(worldData, null, 2),
    mustHonorBlock: mustHonor,
    freshnessBlock,
    forcingBlock,
    mode: s4.mode,
    eroticaOrientation: s4.premise.erotica_orientation,
  });

  return {
    role: "bible_writer",
    model: DEFAULT_V2_MODEL_CONFIG.bible_writer,
    subagentTier: tierFor("bible_writer"),
    temperature: 0.8,
    maxTokens: 5000,
    systemPrompt: CHARACTER_WRITER_SYSTEM,
    userPrompt,
    schema: CHARACTER_WRITER_SCHEMA,
    stage: "bible-characters",
  };
}

// Plot writer (optional repair feedback) ───────────────────────────

export function buildPlotWriterSpec(project: AgentProject): AgentPromptSpec {
  const s4 = requireBibleState(project);
  const worldData = s4.checkpoint.worldData;
  const charData = s4.checkpoint.charData;
  if (!worldData || !charData) {
    throw new Error("buildPlotWriterSpec: requires worldData and charData");
  }
  const mustHonor = buildMustHonorBlock(s4.constraintLedger);
  // By the character stage the premise should already have resolved names,
  // so no placeholder map here
  const premiseStr = formatPremiseForBible(s4.premise);

  let userPrompt = buildPlotPrompt({
    premise: premiseStr,
    worldSection: compressWorldForPlot(worldData),
    characterSection: compressCharsForPlot(charData),
    mustHonorBlock: mustHonor,
    suggestedLength: s4.premise.suggested_length,
    mode: s4.mode,
  });

  // Repair mode: append judge feedback as "PREVIOUS ATTEMPT FAILED" appendix
  const judgeResult = project.extension.bibleJudgeResult;
  const isRepair = Boolean(judgeResult) && (project.extension.bibleJudgeAttempts ?? 0) > 0;
  if (isRepair && judgeResult) {
    const criticalIssues = [
      ...(judgeResult.consistency_issues ?? []).filter((i) => i.severity === "critical"),
      ...(judgeResult.quality_issues ?? []).filter(
        (i) => i.severity === "critical" || i.severity === "major",
      ),
    ];
    const feedback = criticalIssues
      .map((i) => `- [${i.severity}] ${i.issue}: ${i.fix_instruction}`)
      .join("\n");
    userPrompt = `${userPrompt}\n\nPREVIOUS ATTEMPT FAILED QUALITY REVIEW. Fix these issues:\n${feedback}`;
  }

  return {
    role: "bible_writer",
    model: DEFAULT_V2_MODEL_CONFIG.bible_writer,
    subagentTier: tierFor("bible_writer"),
    temperature: 0.8,
    maxTokens: 8000,
    systemPrompt: PLOT_WRITER_SYSTEM,
    userPrompt,
    schema: PLOT_WRITER_SCHEMA,
    stage: isRepair ? "bible-plot-repair" : "bible-plot",
  };
}

// Bible judge ──────────────────────────────────────────────────────

export function buildBibleJudgeSpec(project: AgentProject): AgentPromptSpec {
  const s4 = requireBibleState(project);
  const worldData = s4.checkpoint.worldData;
  const charData = s4.checkpoint.charData;
  const plotData = s4.checkpoint.plotData;
  if (!worldData || !charData || !plotData) {
    throw new Error("buildBibleJudgeSpec: requires world, char, and plot data");
  }
  const mustHonor = buildMustHonorBlock(s4.constraintLedger);

  const userPrompt = buildBibleJudgePrompt({
    worldSection: compressWorldForPlot(worldData),
    characterSection: compressCharsForPlot(charData),
    plotSection: JSON.stringify(plotData),
    mustHonorBlock: mustHonor,
    mode: s4.mode,
    eroticaOrientation: s4.premise.erotica_orientation,
  });

  return {
    role: "bible_judge",
    model: DEFAULT_V2_MODEL_CONFIG.bible_judge,
    subagentTier: tierFor("bible_judge"),
    temperature: 0.3,
    maxTokens: 2000,
    systemPrompt: BIBLE_JUDGE_SYSTEM,
    userPrompt,
    schema: BIBLE_JUDGE_SCHEMA,
    stage: "bible-judge",
  };
}

// Sensory palette (non-fatal, haiku tier) ──────────────────────────

export function buildSensoryPaletteSpec(project: AgentProject): AgentPromptSpec {
  const s4 = requireBibleState(project);
  const worldData = s4.checkpoint.worldData;
  const worldStr = worldData ? JSON.stringify(worldData, null, 2).slice(0, 1500) : "";

  const userPrompt = buildSensoryPalettePrompt({
    worldSection: worldStr,
    settingAnchor: s4.premise.setting_anchor ?? "",
    toneChips: s4.premise.tone_chips ?? [],
  });

  return {
    role: "v2_summarizer",
    model: DEFAULT_V2_MODEL_CONFIG.v2_summarizer,
    subagentTier: tierFor("v2_summarizer"),
    temperature: 0.8,
    maxTokens: 1500,
    systemPrompt: SENSORY_PALETTE_SYSTEM,
    userPrompt,
    schema: SENSORY_PALETTE_SCHEMA as Record<string, unknown>,
    stage: "bible-sensory-palette",
  };
}

// Step-back architectural sub-prompt ────────────────────────────────

export function buildStepBackSpec(project: AgentProject): AgentPromptSpec {
  const s4 = requireBibleState(project);
  const bibleCompressed = compressBibleForPlanner(
    s4.checkpoint.worldData,
    s4.checkpoint.charData,
    s4.checkpoint.plotData,
  );

  const systemPrompt =
    "You are a story architect. Answer these questions briefly and precisely — one sentence each. Do not plan scenes yet. Just think about the story's shape.";

  const userPrompt = [
    `STORY BIBLE:\n${bibleCompressed}`,
    `\nAnswer these questions:`,
    `1. What is the ONE dramatic question this story must answer by the end?`,
    `2. What is the point of no return — the moment where the protagonist cannot go back to who they were?`,
    `3. Which relationship is the engine of the story? Where must that relationship be at the midpoint versus the climax?`,
    `4. What is the one scene the reader will remember a week later? What makes it unforgettable — a revelation, a betrayal, a silence, a choice?`,
    `5. Where should the story's emotional register BREAK — the moment that is tonally different from everything around it?`,
  ].join("\n");

  return {
    role: "scene_planner",
    model: DEFAULT_V2_MODEL_CONFIG.scene_planner,
    subagentTier: tierFor("scene_planner"),
    temperature: 0.5,
    maxTokens: 800,
    systemPrompt,
    userPrompt,
    // No JSON schema — this is free-text architectural thinking
    schema: { type: "object", required: [] } as Record<string, unknown>,
    stage: "bible-step-back",
  };
}

// Scene planner ────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────
// Phase 3 — Scene generation specs
// ─────────────────────────────────────────────────────────────────────

function requireSceneState(project: AgentProject): Step6_SceneGenerating {
  if (project.state.step !== "scene_generating") {
    throw new Error(`Expected step=scene_generating, got ${project.state.step}`);
  }
  return project.state as Step6_SceneGenerating;
}

function formatTensionStateBlock(state: any): string {
  if (!state || state.scene_count === 0) return "";
  const lines: string[] = ["=== STORY STATE (cumulative — what has happened so far) ==="];
  const rels = Object.entries(state.relationships ?? {});
  if (rels.length > 0) {
    lines.push("\nRELATIONSHIP STATE:");
    for (const [pair, info] of rels) {
      const i = info as any;
      lines.push(`- ${pair}: ${i.current} (${i.trajectory}). Last shift: ${i.last_shift}`);
    }
  }
  if ((state.what_hasnt_broken_yet ?? []).length > 0) {
    lines.push("\nWHAT HASN'T BROKEN YET (pressure available to release):");
    for (const item of state.what_hasnt_broken_yet) lines.push(`- ${item}`);
  }
  if ((state.unresolved_threads ?? []).length > 0) {
    lines.push("\nUNRESOLVED THREADS:");
    for (const thread of state.unresolved_threads) lines.push(`- ${thread}`);
  }
  if ((state.what_the_reader_knows ?? []).length > 0) {
    lines.push("\nWHAT THE READER KNOWS:");
    for (const fact of state.what_the_reader_knows) lines.push(`- ${fact}`);
  }
  lines.push(`\nEMOTIONAL TEMPERATURE: ${state.emotional_temperature}/10`);
  if ((state.register_history ?? []).length > 0) {
    lines.push(`REGISTER HISTORY: ${state.register_history.join(" → ")}`);
  }
  if ((state.used_phrases ?? []).length > 0) {
    lines.push("\nPHRASES ALREADY USED IN PREVIOUS SCENES (find different language for similar ideas):");
    const recent = state.used_phrases.slice(-30);
    for (const phrase of recent) lines.push(`- "${phrase}"`);
    lines.push(
      "A deliberate callback to an earlier scene is fine if it's spaced 4+ scenes apart and used once. But do NOT reuse the same short phrases or motifs scene after scene.",
    );
  }
  return lines.join("\n");
}

// Scene writer ─────────────────────────────────────────────────────

export function buildSceneWriterSpec(project: AgentProject): AgentPromptSpec {
  const s6 = requireSceneState(project);
  const idx = project.extension.currentSceneIndex ?? 0;
  const plan = s6.scenePlan.scenes[idx];
  if (!plan) throw new Error(`No scene plan at index ${idx}`);

  const { characterProfiles, worldContext } = compressForScene(s6.storyBible, plan);
  const prevDigest = previousSceneDigest(s6.generatedScenes);
  const tensionBlock = formatTensionStateBlock(project.extension.tensionState);
  const mustHonor = buildMustHonorBlock(s6.constraintLedger);

  // Build cacheable prefix that would be shared across scenes in the real pipeline
  const canonicalNames = buildCanonicalNames(s6.storyBible);
  const cacheablePrefix = [
    "STORY BIBLE CONTEXT (shared across all scenes):",
    `World: ${s6.storyBible.world?.world_thesis ?? ""}`,
    `Locations: ${(s6.storyBible.world?.arena?.locations ?? []).map((l: any) => l.name).join(", ")}`,
    `Tone: ${s6.storyBible.world?.scope?.tone_rule ?? ""}`,
    `\n${canonicalNames}`,
    mustHonor ? `\n${mustHonor}` : "",
  ].filter(Boolean).join("\n");

  const userPrompt = buildSceneWriterPrompt({
    scenePlan: formatScenePlanForWriter(plan),
    characterProfiles,
    worldContext,
    previousSceneDigest: prevDigest,
    mustHonorBlock: mustHonor,
    tensionState: tensionBlock,
  });

  // Prepend cacheable prefix (no real caching available for subagents, but fidelity)
  const combinedUserPrompt = `${cacheablePrefix}\n\n${userPrompt}`;

  const substep = project.extension.sceneSubstep;
  const isCandidateB = substep === "writer_b";

  return {
    role: isCandidateB ? "scene_writer_b" : "scene_writer",
    model: DEFAULT_V2_MODEL_CONFIG.scene_writer,
    subagentTier: tierFor("scene_writer"),
    temperature: 0.85,
    maxTokens: 8000,
    systemPrompt: SCENE_WRITER_SYSTEM,
    userPrompt: combinedUserPrompt,
    schema: SCENE_WRITER_SCHEMA,
    stage: `scene-${plan.scene_id}-${isCandidateB ? "writer-b" : "writer"}`,
  };
}

// Scene judge ──────────────────────────────────────────────────────

export function buildSceneJudgeSpec(project: AgentProject): AgentPromptSpec {
  const s6 = requireSceneState(project);
  const idx = project.extension.currentSceneIndex ?? 0;
  const plan = s6.scenePlan.scenes[idx];
  const substep = project.extension.sceneSubstep;
  const isCandidateB = substep === "judge_b";
  const candidate = isCandidateB ? project.extension.candidateB : project.extension.candidateA;
  if (!candidate) throw new Error(`No candidate ${isCandidateB ? "B" : "A"} to judge`);

  const mustHonor = buildMustHonorBlock(s6.constraintLedger);
  const userPrompt = buildSceneJudgePrompt({
    scene: candidate.readable.screenplay_text,
    scenePlan: JSON.stringify(plan, null, 2),
    mustHonorBlock: mustHonor,
  });

  return {
    role: isCandidateB ? "scene_judge_b" : "scene_judge",
    model: DEFAULT_V2_MODEL_CONFIG.scene_judge,
    subagentTier: tierFor("scene_judge"),
    temperature: 0,
    maxTokens: 2000,
    systemPrompt: SCENE_JUDGE_SYSTEM,
    userPrompt,
    schema: SCENE_JUDGE_SCHEMA,
    stage: `scene-${plan.scene_id}-${isCandidateB ? "judge-b" : "judge"}`,
  };
}

// Tension update (Haiku) ───────────────────────────────────────────

export function buildTensionUpdateSpec(project: AgentProject): AgentPromptSpec {
  const s6 = requireSceneState(project);
  const idx = project.extension.currentSceneIndex ?? 0;
  const plan = s6.scenePlan.scenes[idx];

  // The accepted scene is whichever candidate won (committed into
  // s6.generatedScenes by the orchestrator BEFORE calling this).
  const lastScene = s6.generatedScenes[s6.generatedScenes.length - 1];
  if (!lastScene) throw new Error("buildTensionUpdateSpec: no accepted scene");

  const current = project.extension.tensionState ?? {
    relationships: {},
    unresolved_threads: [],
    emotional_temperature: 3,
    register_history: [],
    what_the_reader_knows: [],
    what_hasnt_broken_yet: [],
    scene_count: 0,
    used_phrases: [],
  };

  const systemPrompt =
    "You track cumulative dramatic state across scenes. Output ONLY a JSON object. No commentary.";

  const userPrompt = [
    "You are tracking the cumulative dramatic state of a story in progress.",
    `\nCURRENT STATE (after ${current.scene_count} scenes):\n${JSON.stringify(current, null, 2)}`,
    `\nSCENE JUST COMPLETED (${lastScene.scene_id} — "${(lastScene as any).readable?.title ?? plan.title}"):\n${((lastScene as any).readable?.screenplay_text ?? "").slice(0, 2000)}`,
    `\nCHARACTERS IN STORY:\n${Object.keys(s6.storyBible.characters ?? {}).join(", ")}`,
    "\nUpdate the tension state based on what happened in this scene. Be concrete and specific:",
    '- relationships: update any relationships that shifted. Use character names as keys (e.g. "Nikos-Zara").',
    "- unresolved_threads: add new threads, remove resolved ones. Be specific about what's unresolved.",
    "- emotional_temperature: 1-10. Should generally climb across scenes but can dip after aftermath scenes.",
    '- register_history: append this scene\'s dominant register (e.g., "tense_procedural", "warm_communal", "confrontational").',
    "- what_the_reader_knows: add any new information the reader learned. Be factual.",
    "- what_hasnt_broken_yet: list things that are under pressure but haven't ruptured. This is the most important field — it tells the next scene's writer what pressure is available to release.",
    "\nOutput ONLY the updated JSON object. No commentary.",
  ].join("\n");

  return {
    role: "tension_update",
    model: DEFAULT_V2_MODEL_CONFIG.v2_summarizer,
    subagentTier: tierFor("v2_summarizer"),
    temperature: 0.2,
    maxTokens: 1500,
    systemPrompt,
    userPrompt,
    // Tension update is loose JSON — only require relationships + what_hasnt_broken_yet + unresolved_threads
    schema: {
      type: "object",
      required: ["relationships", "unresolved_threads", "what_hasnt_broken_yet"],
    } as Record<string, unknown>,
    stage: `scene-${plan.scene_id}-tension`,
  };
}

export function buildScenePlannerSpec(project: AgentProject): AgentPromptSpec {
  const s4 = requireBibleState(project);
  const bibleCompressed = compressBibleForPlanner(
    s4.checkpoint.worldData,
    s4.checkpoint.charData,
    s4.checkpoint.plotData,
  );
  const mustHonor = buildMustHonorBlock(s4.constraintLedger);

  const basePrompt = buildScenePlannerPrompt({
    bibleCompressed,
    mustHonorBlock: mustHonor,
    suggestedLength: s4.premise.suggested_length,
  });

  const architecturalContext = project.extension.stepBackContext
    ? `\nSTORY ARCHITECTURE (think about these while planning):\n${project.extension.stepBackContext}\n`
    : "";

  return {
    role: "scene_planner",
    model: DEFAULT_V2_MODEL_CONFIG.scene_planner,
    subagentTier: tierFor("scene_planner"),
    temperature: 0.7,
    maxTokens: 6000,
    systemPrompt: SCENE_PLANNER_SYSTEM,
    userPrompt: basePrompt + architecturalContext,
    schema: SCENE_PLANNER_SCHEMA,
    stage: "bible-scene-plan",
  };
}
