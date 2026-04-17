/**
 * Agent Pipeline — orchestrator.
 *
 * Pure state → next-action mapping. Called by the CLI to figure out
 * what happens next given the current AgentProject. Also contains
 * the ingest logic that takes a parsed subagent output and mutates
 * state accordingly. No LLM calls here.
 *
 * Phase 1 handles: idea_gathering → premise_generating → premise_review.
 * Later phases will extend the switch statements.
 */

import type { AgentProject } from "./state";
import type {
  IntakeTurn,
  Step1_IdeaGathering,
  Step2_PremiseGenerating,
  Step3_PremiseReview,
  Step4_BibleGenerating,
  Step5_SceneReview,
  StepTrace,
  BibleSubStep,
} from "../../shared/types/project";
import { createOperationId } from "../../shared/types/project";
import type {
  PremiseArtifact,
  StoryBibleArtifact,
  ScenePlanArtifact,
  CharacterProfile,
  CharacterRelationship,
  GeneratedScene,
} from "../../shared/types/artifacts";
import type { Step6_SceneGenerating, StepCompleted } from "../../shared/types/project";
import { createHash, randomUUID } from "crypto";
import {
  resolveAllNames,
  replacePlaceholders,
} from "../../shared/namePool";
import {
  assignVoicePatterns,
  applyVoicePatterns,
} from "../../shared/voicePool";
import { loadFingerprints } from "../../shared/fingerprint";

// ── Action types ─────────────────────────────────────────────────────

export type NextAction =
  /** A subagent call is needed. The CLI will build the prompt. */
  | { kind: "call"; role: string; stage: string; needsUserInput?: boolean }
  /** Need the user to answer an intake question. */
  | { kind: "await-user-input"; question: string }
  /** Review gate — auto-approve flag tells the CLI what to do. */
  | { kind: "gate"; gate: "premise_review" | "scene_review" }
  /** Pipeline finished. */
  | { kind: "done" }
  /** Pipeline is past Phase 1's scope. */
  | { kind: "phase-boundary"; nextPhase: 2 | 3; current: string };

// ── nextAction: what should happen next? ────────────────────────────

export function nextAction(project: AgentProject): NextAction {
  const s = project.state;
  const ext = project.extension;

  switch (s.step) {
    case "idea_gathering": {
      const s1 = s as Step1_IdeaGathering;
      const turns = s1.conversationTurns;
      if (turns.length === 0) {
        // First turn: seed is already in state, no user input needed
        return { kind: "call", role: "intake", stage: "intake-turn-1" };
      }
      const last = turns[turns.length - 1];
      if (last.systemResponse.readyForPremise) {
        // Auto-advance to premise_generating; caller will transition + call writer
        return { kind: "call", role: "premise_writer", stage: "premise-writer-from-intake" };
      }
      if (turns.length >= 2) {
        // Hard cap — transition anyway
        return { kind: "call", role: "premise_writer", stage: "premise-writer-from-intake" };
      }
      // Need user to answer the system's question
      return {
        kind: "await-user-input",
        question: last.systemResponse.question ?? "(no question recorded)",
      };
    }

    case "premise_generating": {
      if (!ext.draftPremise) {
        return { kind: "call", role: "premise_writer", stage: "premise-writer" };
      }
      if (!ext.premiseJudge) {
        return { kind: "call", role: "premise_judge", stage: "premise-judge" };
      }
      if (!ext.premiseJudge.pass && !ext.premiseRepairAttempted) {
        return { kind: "call", role: "premise_writer", stage: "premise-writer-repair" };
      }
      // Judge passed (or repair attempted) — transition to review, auto-approve
      return { kind: "gate", gate: "premise_review" };
    }

    case "premise_review": {
      // With auto-approve, premise_review auto-transitions to
      // bible_generating. approvePremiseGate() handles the cascade,
      // so if we see this state it means the user ran approve-premise
      // separately (partial flow). Report the gate so the CLI can
      // cascade.
      return { kind: "gate", gate: "premise_review" };
    }

    case "bible_generating": {
      const s4 = s as Step4_BibleGenerating;
      const completed = s4.checkpoint.completedSubSteps;
      const has = (k: BibleSubStep) => completed.includes(k);

      if (!has("world")) {
        return { kind: "call", role: "bible_world", stage: "bible-world" };
      }
      if (!has("characters")) {
        return { kind: "call", role: "bible_characters", stage: "bible-characters" };
      }
      if (!has("plot")) {
        return { kind: "call", role: "bible_plot", stage: "bible-plot" };
      }
      if (!has("judge")) {
        return { kind: "call", role: "bible_judge", stage: "bible-judge" };
      }
      if (!has("sensory_palette") && !ext.sensoryPaletteDone) {
        return { kind: "call", role: "bible_sensory_palette", stage: "bible-sensory-palette" };
      }
      if (!ext.stepBackDone) {
        return { kind: "call", role: "bible_step_back", stage: "bible-step-back" };
      }
      if (!has("scene_plan")) {
        return { kind: "call", role: "bible_scene_plan", stage: "bible-scene-plan" };
      }
      // Everything done — transition to scene_review
      return { kind: "gate", gate: "scene_review" };
    }

    case "scene_review": {
      // Auto-approve cascades into scene_generating via approveScenesGate
      return { kind: "gate", gate: "scene_review" };
    }

    case "scene_generating": {
      const s6 = s as Step6_SceneGenerating;
      const idx = ext.currentSceneIndex ?? 0;
      if (idx >= s6.scenePlan.scenes.length) {
        // All scenes done — finalize
        return { kind: "done" };
      }
      const plan = s6.scenePlan.scenes[idx];
      const substep = ext.sceneSubstep ?? "writer_a";
      const stagePrefix = `scene-${plan.scene_id}`;
      switch (substep) {
        case "writer_a":
          return { kind: "call", role: "scene_writer", stage: `${stagePrefix}-writer` };
        case "judge_a":
          return { kind: "call", role: "scene_judge", stage: `${stagePrefix}-judge` };
        case "writer_b":
          return { kind: "call", role: "scene_writer_b", stage: `${stagePrefix}-writer-b` };
        case "judge_b":
          return { kind: "call", role: "scene_judge_b", stage: `${stagePrefix}-judge-b` };
        case "tension_update":
          return { kind: "call", role: "tension_update", stage: `${stagePrefix}-tension` };
        default:
          return { kind: "call", role: "scene_writer", stage: `${stagePrefix}-writer` };
      }
    }
    case "completed":
      return { kind: "done" };
    case "failed":
    case "aborted":
      throw new Error(`Project is in terminal state: ${s.step}`);
  }
}

// ── Ingest: apply a parsed subagent output to state ─────────────────

export interface IngestContext {
  role: string;
  output: unknown;                // parsed JSON from subagent
  userInput?: string;             // only for intake
  durationMs?: number;
}

export function ingest(project: AgentProject, ctx: IngestContext): void {
  switch (ctx.role) {
    case "intake":
      return ingestIntake(project, ctx);
    case "premise_writer":
      return ingestPremiseWriter(project, ctx);
    case "premise_judge":
      return ingestPremiseJudge(project, ctx);
    case "bible_world":
      return ingestBibleWorld(project, ctx);
    case "bible_characters":
      return ingestBibleCharacters(project, ctx);
    case "bible_plot":
      return ingestBiblePlot(project, ctx);
    case "bible_judge":
      return ingestBibleJudge(project, ctx);
    case "bible_sensory_palette":
      return ingestBibleSensoryPalette(project, ctx);
    case "bible_step_back":
      return ingestBibleStepBack(project, ctx);
    case "bible_scene_plan":
      return ingestBibleScenePlan(project, ctx);
    case "scene_writer":
    case "scene_writer_b":
      return ingestSceneWriter(project, ctx);
    case "scene_judge":
    case "scene_judge_b":
      return ingestSceneJudge(project, ctx);
    case "tension_update":
      return ingestTensionUpdate(project, ctx);
    default:
      throw new Error(`Unknown role for ingest: ${ctx.role}`);
  }
}

// ── Intake ingest ────────────────────────────────────────────────────

interface IntakeLLMResponse {
  question?: string | null;
  assumptions?: Array<{ id: string; category: string; assumption: string; alternatives: string[] }>;
  readyForPremise: boolean;
  readiness_note: string;
  raw_signals?: unknown;
  constraint_updates?: Array<{ key: string; value: string; source: string }>;
}

function ingestIntake(project: AgentProject, ctx: IngestContext): void {
  const s = project.state;
  if (s.step !== "idea_gathering") {
    throw new Error(`ingestIntake: expected idea_gathering, got ${s.step}`);
  }
  const s1 = s as Step1_IdeaGathering;
  const parsed = ctx.output as IntakeLLMResponse;
  const turnNumber = s1.conversationTurns.length + 1;
  const userInput = ctx.userInput ?? (turnNumber === 1 ? (s1.seedInput ?? "") : "");

  // Hard-cap readiness at turn 2
  let ready = parsed.readyForPremise;
  let note = parsed.readiness_note;
  if (turnNumber >= 2 && !ready) {
    ready = true;
    note = "Maximum intake turns reached — proceeding with available context.";
  }

  const turn: IntakeTurn = {
    turnNumber,
    userInput,
    systemResponse: {
      question: parsed.question ?? undefined,
      assumptions: parsed.assumptions ?? [],
      readyForPremise: ready,
      readiness_note: note,
    },
  };
  s1.conversationTurns.push(turn);

  // Constraint updates inferred by the LLM
  if (parsed.constraint_updates) {
    const isFromUserSeed = turnNumber === 1;
    for (const cu of parsed.constraint_updates) {
      if (!s1.constraintLedger.find((e) => e.key === cu.key)) {
        s1.constraintLedger.push({
          key: cu.key,
          value: cu.value,
          source: isFromUserSeed ? "user_typed" : "llm_inferred",
          confidence: isFromUserSeed ? "confirmed" : "inferred",
          turnNumber,
        } as any);
      }
    }
  }

  s1.traces.push(
    makeTrace({
      role: "intake",
      operationId: `intake_t${turnNumber}`,
      templateKey: "INTAKE_SYSTEM_PROMPT",
      durationMs: ctx.durationMs ?? 0,
    }),
  );
}

// ── Premise writer ingest ────────────────────────────────────────────

function ingestPremiseWriter(project: AgentProject, ctx: IngestContext): void {
  const s = project.state;
  const isRepair = Boolean(project.extension.draftPremise);

  // Transition idea_gathering → premise_generating on first writer call
  if (s.step === "idea_gathering") {
    const s1 = s as Step1_IdeaGathering;
    const seed = s1.seedInput ?? "";
    if (!seed) {
      throw new Error("Cannot advance to premise_generating without a seed");
    }
    const s2: Step2_PremiseGenerating = {
      step: "premise_generating",
      projectId: s1.projectId,
      createdAt: s1.createdAt,
      updatedAt: s1.updatedAt,
      traces: s1.traces,
      psychologyLedger: s1.psychologyLedger,
      constraintLedger: s1.constraintLedger,
      culturalInsights: s1.culturalInsights,
      mode: s1.mode ?? "default",
      operationId: createOperationId(`premise_${randomUUID().slice(0, 8)}`),
      seedInput: seed,
      conversationTurns: s1.conversationTurns,
      culturalContext: s1.culturalContext,
    };
    project.state = s2;
  }

  if (project.state.step !== "premise_generating") {
    throw new Error(`ingestPremiseWriter: unexpected step=${project.state.step}`);
  }

  project.extension.draftPremise = ctx.output;
  if (isRepair) {
    project.extension.premiseRepairAttempted = true;
  }

  project.state.traces.push(
    makeTrace({
      role: "premise_writer",
      operationId: project.state.operationId,
      templateKey: "PREMISE_WRITER_SYSTEM",
      durationMs: ctx.durationMs ?? 0,
      judgeOutcome: isRepair ? "fail_repaired" : undefined,
    }),
  );
}

// ── Premise judge ingest ─────────────────────────────────────────────

function ingestPremiseJudge(project: AgentProject, ctx: IngestContext): void {
  const s = project.state;
  if (s.step !== "premise_generating") {
    throw new Error(`ingestPremiseJudge: expected premise_generating, got ${s.step}`);
  }
  const parsed = ctx.output as {
    pass: boolean;
    issues?: Array<{ field: string; problem: string; fix_instruction: string }>;
    constraint_violations?: string[];
  };
  project.extension.premiseJudge = {
    pass: Boolean(parsed.pass),
    issues: parsed.issues ?? [],
    constraint_violations: parsed.constraint_violations ?? [],
  };

  s.traces.push(
    makeTrace({
      role: "premise_judge",
      operationId: s.operationId,
      templateKey: "PREMISE_JUDGE_SYSTEM",
      durationMs: ctx.durationMs ?? 0,
      judgeOutcome: parsed.pass ? "pass" : "fail_accepted",
    }),
  );
}

// ── Gate actions: apply auto-approval / revision ────────────────────

/**
 * Auto-approve the premise gate and cascade into bible_generating.
 * Accepts both premise_generating (normal path) and premise_review
 * (resuming a project that was previously left at the gate).
 */
export function approvePremiseGate(project: AgentProject): void {
  const s = project.state;
  let premise: PremiseArtifact;
  let createdAt: string;
  let updatedAt: string;

  if (s.step === "premise_generating") {
    const draft = project.extension.draftPremise;
    if (!draft) {
      throw new Error("approvePremiseGate: no draftPremise in extension");
    }
    premise = buildPremiseArtifact(draft, s.operationId);
    premise.state = "approved";
    createdAt = s.createdAt;
    updatedAt = s.updatedAt;
    project.state.traces.push(
      makeTrace({
        role: "premise_review",
        operationId: s.operationId,
        templateKey: "auto_approve",
        durationMs: 0,
      }),
    );
  } else if (s.step === "premise_review") {
    premise = s.premise as PremiseArtifact;
    premise.state = "approved";
    createdAt = s.createdAt;
    updatedAt = s.updatedAt;
  } else {
    throw new Error(`approvePremiseGate: unexpected step=${s.step}`);
  }

  const s4: Step4_BibleGenerating = {
    step: "bible_generating",
    projectId: s.projectId,
    createdAt,
    updatedAt,
    traces: s.traces,
    psychologyLedger: s.psychologyLedger,
    constraintLedger: s.constraintLedger,
    culturalInsights: s.culturalInsights,
    mode: s.mode,
    operationId: createOperationId(`bible_${randomUUID().slice(0, 8)}`),
    premise,
    checkpoint: {
      completedSubSteps: [],
    },
  };
  project.state = s4;

  // Clear Phase 1 extension fields now that they're folded into state
  delete project.extension.draftPremise;
  delete project.extension.premiseJudge;
  delete project.extension.premiseRepairAttempted;
  // Initialise Phase 2 bookkeeping — judgeAttempts lives on the checkpoint
  // (not extension) so it survives resume across crashes.
  s4.checkpoint.judgeAttempts = 0;
}

/**
 * Auto-approve the scene plan gate and cascade into scene_generating.
 * Initialises the scene loop extension fields (tension state, current
 * scene index, substep, descriptor tracker).
 */
export function approveScenesGate(project: AgentProject): void {
  const s = project.state;
  if (s.step !== "scene_review") {
    throw new Error(`approveScenesGate: expected scene_review, got ${s.step}`);
  }
  (s.scenePlan as any).state = "approved";
  (s.reviewTurns as any[]).push({ turnNumber: 1, action: "approve" });

  const s6: Step6_SceneGenerating = {
    step: "scene_generating",
    projectId: s.projectId,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    traces: s.traces,
    psychologyLedger: s.psychologyLedger,
    constraintLedger: s.constraintLedger,
    culturalInsights: s.culturalInsights,
    mode: s.mode,
    operationId: createOperationId(`scenes_${randomUUID().slice(0, 8)}`),
    premise: s.premise,
    storyBible: s.storyBible,
    scenePlan: s.scenePlan,
    generatedScenes: [],
    checkpoint: {
      totalScenes: s.scenePlan.scenes.length,
      completedSceneIds: [],
    },
  };
  project.state = s6;

  // Initialise Phase 3 extension
  project.extension.currentSceneIndex = 0;
  project.extension.sceneSubstep = "writer_a";
  project.extension.tensionState = {
    relationships: {},
    unresolved_threads: [],
    emotional_temperature: 3,
    register_history: [],
    what_the_reader_knows: [],
    what_hasnt_broken_yet: [],
    scene_count: 0,
    used_phrases: [],
  };
  project.extension.descriptorTracker = { counts: {}, total: 0 };
  delete project.extension.candidateA;
  delete project.extension.candidateB;
}

// ─────────────────────────────────────────────────────────────────────
// Phase 2 — Bible ingest handlers
// ─────────────────────────────────────────────────────────────────────

function requireBibleState(project: AgentProject): Step4_BibleGenerating {
  if (project.state.step !== "bible_generating") {
    throw new Error(`Expected bible_generating, got ${project.state.step}`);
  }
  return project.state as Step4_BibleGenerating;
}

function ingestBibleWorld(project: AgentProject, ctx: IngestContext): void {
  const s4 = requireBibleState(project);
  s4.checkpoint.worldData = ctx.output;
  if (!s4.checkpoint.completedSubSteps.includes("world")) {
    s4.checkpoint.completedSubSteps.push("world");
  }
  s4.traces.push(
    makeTrace({
      role: "bible_writer:world",
      operationId: s4.operationId,
      templateKey: "WORLD_WRITER_SYSTEM",
      durationMs: ctx.durationMs ?? 0,
    }),
  );
}

// ── Phantom name scrubber (copied from bibleService.scrubPhantomNames) ──

function scrubPhantomNames(
  beatText: string,
  knownNames: Set<string>,
  worldData?: any,
): string {
  const knownFirstNames = new Set<string>();
  const knownFullNormalized = new Set<string>();
  for (const name of knownNames) {
    knownFullNormalized.add(name.toLowerCase());
    const first = name.split(/\s+/)[0];
    if (first) knownFirstNames.add(first.toLowerCase());
  }

  // Extract every capitalised word from the world's location names so the
  // scrubber treats them as known vocabulary rather than phantom characters.
  const locationWords = new Set<string>();
  for (const loc of worldData?.arena?.locations ?? []) {
    for (const word of (loc.name ?? "").split(/[\s\-–—]+/)) {
      const clean = word.replace(/[^a-zA-Z]/g, "");
      if (clean.length >= 2) locationWords.add(clean.toLowerCase());
    }
  }

  const NOT_NAMES = new Set([
    "but", "and", "or", "the", "a", "an", "in", "on", "at", "for", "so",
    "yet", "nor", "as", "if", "when", "while", "after", "before", "during",
    "main", "old", "new", "hidden", "narrow", "dark", "dim", "dimly",
    "central", "upper", "lower", "north", "south", "east", "west",
    "abandoned", "dilapidated", "cracked", "failing", "rundown", "cluttered",
    "cargo", "crew", "bunk", "med", "observation", "engineering", "docking",
    "command", "bridge", "deck", "bay", "hold", "pod", "pods", "chamber",
    "corridor", "tunnel", "tunnels", "hall", "room", "vault", "lair",
    "corporate", "imperial", "royal", "galactic", "interstellar",
    "french", "consulate", "coat", "check", "velvet", "wound",
    "inscription", "nexus", "threshold", "seal", "sanctum", "gear",
    "inner", "outer", "first", "deputy", "governor", "administrative",
    "quarter", "annex", "arcade", "district", "territory", "market",
    "palace", "garden", "gate", "plaza", "tower", "temple",
    "scriptorium", "atrium", "nave", "shrine", "club",
    // Merge dynamic location words from this story's world data
    ...locationWords,
  ]);

  return beatText.replace(
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g,
    (match) => {
      const lower = match.toLowerCase();
      if (knownFullNormalized.has(lower)) return match;
      const words = match.split(/\s+/);
      const firstWord = words[0].toLowerCase();
      if (knownFirstNames.has(firstWord)) return match;
      const lastWord = words[words.length - 1].toLowerCase();
      if (NOT_NAMES.has(firstWord) || NOT_NAMES.has(lastWord)) return match;
      if (words.length === 2) return "an outsider";
      return match;
    },
  );
}

// ── Character ingest: full name resolution + voice + placeholder sweeps ──

async function runCharacterPostProcessing(
  s4: Step4_BibleGenerating,
  charDataRaw: any,
): Promise<any> {
  let charData = charDataRaw;
  const worldData = s4.checkpoint.worldData;
  const fingerprints = await loadFingerprints();

  const isErotica = s4.mode?.startsWith("erotica");
  const eroticaOrientation = s4.premise.erotica_orientation;
  const genderLock: "masculine" | "feminine" | undefined =
    eroticaOrientation === "gay male"
      ? "masculine"
      : eroticaOrientation === "lesbian"
        ? "feminine"
        : undefined;

  // User-provided name preservation: the premise name map substituted real
  // names (e.g. "LaLa") with placeholders (__CHAR_B__) before the character
  // writer saw the premise. Walk character writer output and, for any
  // character whose placeholder corresponds to a position in the original
  // characters_sketch, restore the intended name so resolveAllNames honors it.
  const userProvidedNames = new Set<string>();
  const sketches = s4.premise.characters_sketch ?? [];
  for (const char of charData.characters ?? []) {
    const placeholder: string | undefined = char.name_spec?.placeholder;
    if (!placeholder) continue;
    const match = placeholder.match(/^__CHAR_([A-Z])__$/);
    if (!match) continue;
    const idx = match[1].charCodeAt(0) - 65;
    const intended = sketches[idx]?.name;
    if (intended) {
      char.name = intended;
      userProvidedNames.add(intended);
    }
  }

  const resolved = resolveAllNames(
    charData.characters ?? [],
    fingerprints,
    worldData,
    s4.premise.tone_chips,
    s4.premise.setting_anchor,
    userProvidedNames.size > 0 ? userProvidedNames : undefined,
    genderLock,
  );

  for (let i = 0; i < (charData.characters ?? []).length; i++) {
    const r = resolved[i];
    if (r) charData.characters[i].name = r.resolvedName;
  }
  if (charData.relationships) {
    for (const rel of charData.relationships) {
      rel.between = rel.between.map((name: string) => {
        const match = resolved.find((r) => r.placeholder === name);
        return match ? match.resolvedName : name;
      });
      rel.nature = replacePlaceholders(rel.nature, resolved);
      rel.stated_dynamic = replacePlaceholders(rel.stated_dynamic, resolved);
      rel.true_dynamic = replacePlaceholders(rel.true_dynamic, resolved);
    }
  }
  if (charData.ensemble_dynamic) {
    charData.ensemble_dynamic = replacePlaceholders(charData.ensemble_dynamic, resolved);
  }
  for (const c of charData.characters ?? []) {
    if (c.description) c.description = replacePlaceholders(c.description, resolved);
    if (c.threshold_statement)
      c.threshold_statement = replacePlaceholders(c.threshold_statement, resolved);
  }

  // Deep placeholder sweep across all string fields
  const placeholderPattern = /__CHAR_[A-Z]__/g;
  const placeholderMap = new Map(resolved.map((r) => [r.placeholder, r.resolvedName]));
  function deepReplace(obj: any): any {
    if (typeof obj === "string") {
      return obj.replace(placeholderPattern, (m) => placeholderMap.get(m) ?? m);
    }
    if (Array.isArray(obj)) return obj.map(deepReplace);
    if (obj && typeof obj === "object") {
      for (const key of Object.keys(obj)) obj[key] = deepReplace(obj[key]);
    }
    return obj;
  }
  charData = deepReplace(charData);
  s4.checkpoint.worldData = deepReplace(s4.checkpoint.worldData);

  // Gender lock enforcement
  if (genderLock) {
    for (const c of charData?.characters ?? []) {
      const p = (c.presentation ?? "").toLowerCase();
      if (p && p !== genderLock && p !== "unspecified") {
        c.presentation = genderLock;
      }
    }
  }

  // Presentation normalization (belt + suspenders)
  const PRESENTATION_MAP: Record<string, string> = {
    male: "masculine",
    female: "feminine",
    "non-binary": "androgynous",
    nonbinary: "androgynous",
  };
  for (const c of charData?.characters ?? []) {
    const p = c.presentation?.toLowerCase?.() ?? "";
    if (PRESENTATION_MAP[p]) c.presentation = PRESENTATION_MAP[p];
    else if (!["masculine", "feminine", "androgynous", "unspecified"].includes(p)) {
      c.presentation = "unspecified";
    }
  }

  // Voice pattern assignment
  const charList = (charData.characters ?? []).map((c: any) => ({ name: c.name, role: c.role }));
  const voiceAssignments = assignVoicePatterns(charList);
  applyVoicePatterns(charData, voiceAssignments);

  // Sync resolved names back to the premise artifact
  for (let i = 0; i < resolved.length && i < (s4.premise.characters_sketch ?? []).length; i++) {
    const oldName = s4.premise.characters_sketch[i].name;
    const newName = resolved[i].resolvedName;
    if (oldName && oldName !== newName) {
      s4.premise.characters_sketch[i].name = newName;
      for (const field of [
        "hook_sentence",
        "synopsis",
        "premise_paragraph",
        "emotional_promise",
        "core_conflict",
      ] as const) {
        if ((s4.premise as any)[field]) {
          (s4.premise as any)[field] = (s4.premise as any)[field].replaceAll(oldName, newName);
        }
      }
    }
  }

  return charData;
}

function ingestBibleCharacters(project: AgentProject, ctx: IngestContext): void {
  const s4 = requireBibleState(project);
  // Run post-processing synchronously via a wrapped promise — the CLI
  // awaits this at the call site. runCharacterPostProcessing is async
  // because loadFingerprints is async.
  //
  // Callers of ingest() that trigger async post-processing should use
  // `ingestAsync` below instead of this wrapper.
  throw new Error("ingestBibleCharacters must be called through ingestAsync");
}

async function ingestBibleCharactersAsync(
  project: AgentProject,
  ctx: IngestContext,
): Promise<void> {
  const s4 = requireBibleState(project);
  const charData = await runCharacterPostProcessing(s4, ctx.output);
  s4.checkpoint.charData = charData;
  if (!s4.checkpoint.completedSubSteps.includes("characters")) {
    s4.checkpoint.completedSubSteps.push("characters");
  }
  s4.traces.push(
    makeTrace({
      role: "bible_writer:characters",
      operationId: s4.operationId,
      templateKey: "CHARACTER_WRITER_SYSTEM",
      durationMs: ctx.durationMs ?? 0,
    }),
  );
}

function ingestBiblePlot(project: AgentProject, ctx: IngestContext): void {
  const s4 = requireBibleState(project);
  const plotData = ctx.output as any;
  const charData = s4.checkpoint.charData as any;

  // Phantom-name scrub on beats
  const knownNames = new Set<string>((charData?.characters ?? []).map((c: any) => c.name));
  if (plotData?.tension_chain) {
    for (const beat of plotData.tension_chain) {
      beat.beat = scrubPhantomNames(beat.beat ?? "", knownNames, s4.checkpoint.worldData);
      if (beat.characters_involved) {
        beat.characters_involved = beat.characters_involved.filter((n: string) => knownNames.has(n));
      }
    }
  }

  s4.checkpoint.plotData = plotData;
  if (!s4.checkpoint.completedSubSteps.includes("plot")) {
    s4.checkpoint.completedSubSteps.push("plot");
  }
  const isRepair = (s4.checkpoint.judgeAttempts ?? 0) > 0;
  s4.traces.push(
    makeTrace({
      role: "bible_writer:plot",
      operationId: s4.operationId,
      templateKey: "PLOT_WRITER_SYSTEM",
      durationMs: ctx.durationMs ?? 0,
      judgeOutcome: isRepair ? "fail_repaired" : undefined,
    }),
  );
}

function ingestBibleJudge(project: AgentProject, ctx: IngestContext): void {
  const s4 = requireBibleState(project);
  const parsed = ctx.output as any;
  project.extension.bibleJudgeResult = {
    pass: Boolean(parsed.pass),
    consistency_issues: parsed.consistency_issues ?? [],
    quality_issues: parsed.quality_issues ?? [],
    constraint_violations: parsed.constraint_violations ?? [],
  };

  const criticalIssues = [
    ...(parsed.consistency_issues ?? []).filter((i: any) => i.severity === "critical"),
    ...(parsed.quality_issues ?? []).filter(
      (i: any) => i.severity === "critical" || i.severity === "major",
    ),
  ];
  const attempts = s4.checkpoint.judgeAttempts ?? 0;
  const MAX = 2;

  const pass = parsed.pass || criticalIssues.length === 0 || attempts >= MAX;

  s4.traces.push(
    makeTrace({
      role: "bible_judge",
      operationId: s4.operationId,
      templateKey: "BIBLE_JUDGE_SYSTEM",
      durationMs: ctx.durationMs ?? 0,
      judgeOutcome: pass ? (parsed.pass ? "pass" : "fail_accepted") : "fail_repaired",
    }),
  );

  if (pass) {
    // Accept output and mark judge complete
    if (!s4.checkpoint.completedSubSteps.includes("judge")) {
      s4.checkpoint.completedSubSteps.push("judge");
    }
    // Clean the judge result from extension so we don't confuse later reads
    project.extension.bibleJudgeResult = undefined;
  } else {
    // Trigger plot regeneration: remove "plot" from completed, bump attempts
    const idx = s4.checkpoint.completedSubSteps.indexOf("plot");
    if (idx !== -1) s4.checkpoint.completedSubSteps.splice(idx, 1);
    s4.checkpoint.plotData = undefined;
    s4.checkpoint.judgeAttempts = attempts + 1;
    // Keep bibleJudgeResult so buildPlotWriterSpec can append its feedback
  }
}

function ingestBibleSensoryPalette(project: AgentProject, ctx: IngestContext): void {
  const s4 = requireBibleState(project);
  project.extension.sensoryPaletteData = ctx.output;
  project.extension.sensoryPaletteDone = true;
  if (!s4.checkpoint.completedSubSteps.includes("sensory_palette")) {
    s4.checkpoint.completedSubSteps.push("sensory_palette");
  }
  s4.traces.push(
    makeTrace({
      role: "v2_summarizer:sensory_palette",
      operationId: s4.operationId,
      templateKey: "SENSORY_PALETTE_SYSTEM",
      durationMs: ctx.durationMs ?? 0,
    }),
  );
}

function ingestBibleStepBack(project: AgentProject, ctx: IngestContext): void {
  const s4 = requireBibleState(project);
  // Step-back output is free text, not JSON — ctx.output may be a string
  // or an object. Accept both.
  const text =
    typeof ctx.output === "string"
      ? ctx.output
      : typeof (ctx.output as any)?.text === "string"
        ? (ctx.output as any).text
        : JSON.stringify(ctx.output);
  project.extension.stepBackContext = text;
  project.extension.stepBackDone = true;
  s4.traces.push(
    makeTrace({
      role: "scene_planner:step_back",
      operationId: s4.operationId,
      templateKey: "STEP_BACK_SUBPROMPT",
      durationMs: ctx.durationMs ?? 0,
    }),
  );
}

function ingestBibleScenePlan(project: AgentProject, ctx: IngestContext): void {
  const s4 = requireBibleState(project);
  const scenePlanData = ctx.output as any;
  project.extension.scenePlanData = scenePlanData;
  if (!s4.checkpoint.completedSubSteps.includes("scene_plan")) {
    s4.checkpoint.completedSubSteps.push("scene_plan");
  }
  s4.traces.push(
    makeTrace({
      role: "scene_planner",
      operationId: s4.operationId,
      templateKey: "SCENE_PLANNER_SYSTEM",
      durationMs: ctx.durationMs ?? 0,
    }),
  );

  // Assemble StoryBibleArtifact + ScenePlanArtifact and transition to scene_review
  const worldData = s4.checkpoint.worldData as any;
  const charData = s4.checkpoint.charData as any;
  const plotData = s4.checkpoint.plotData as any;

  const characters: Record<string, CharacterProfile> = {};
  for (const c of charData?.characters ?? []) {
    characters[c.name] = {
      name: c.name,
      role: c.role,
      description: c.description,
      presentation: c.presentation,
      age_range: c.age_range,
      psychological_profile: c.psychological_profile,
      threshold_statement: c.threshold_statement,
      competence_axis: c.competence_axis,
    };
  }
  const relationships: CharacterRelationship[] = (charData?.relationships ?? []).map((r: any) => ({
    between: r.between as [string, string],
    nature: r.nature,
    stated_dynamic: r.stated_dynamic,
    true_dynamic: r.true_dynamic,
  }));

  const storyBible: StoryBibleArtifact = {
    state: "draft",
    operationId: s4.operationId,
    world: {
      scope: worldData?.scope ?? {},
      arena: worldData?.arena ?? { locations: [], edges: [], primary_stage: "", hidden_stage: "" },
      rules: worldData?.rules ?? [],
      factions: worldData?.factions ?? [],
      consequence_patterns: worldData?.consequence_patterns ?? [],
      canon_facts: worldData?.canon_facts ?? [],
      world_thesis: worldData?.world_thesis ?? "",
    },
    characters,
    relationships,
    ensemble_dynamic: charData?.ensemble_dynamic ?? "",
    plot: {
      core_conflict: plotData?.core_conflict ?? "",
      tension_chain: plotData?.tension_chain ?? [],
      turning_points: plotData?.turning_points ?? [],
      theme_cluster: plotData?.theme_cluster ?? { topic: "", question: "", statement: "", countertheme: "" },
      dramatic_irony_points: plotData?.dramatic_irony_points ?? [],
      motifs: plotData?.motifs ?? [],
      mystery_hooks: plotData?.mystery_hooks ?? [],
      climax: plotData?.climax ?? { beat: "", why_now: "", core_conflict_collision: "" },
      resolution: plotData?.resolution ?? { new_normal: "", emotional_landing: "", ending_energy: "" },
      dirty_hands: plotData?.dirty_hands ?? undefined,
      addiction_engine: plotData?.addiction_engine ?? "",
    },
    sensory_palette: project.extension.sensoryPaletteData as any,
  };

  const scenePlan: ScenePlanArtifact = {
    state: "draft",
    operationId: s4.operationId,
    scenes: scenePlanData?.scenes ?? [],
    total_scenes: scenePlanData?.scenes?.length ?? 0,
    estimated_word_count: scenePlanData?.estimated_word_count ?? 0,
  };

  const s5: Step5_SceneReview = {
    step: "scene_review",
    projectId: s4.projectId,
    createdAt: s4.createdAt,
    updatedAt: s4.updatedAt,
    traces: s4.traces,
    psychologyLedger: s4.psychologyLedger,
    constraintLedger: s4.constraintLedger,
    culturalInsights: s4.culturalInsights,
    mode: s4.mode,
    premise: s4.premise,
    storyBible,
    scenePlan,
    reviewTurns: [],
  };
  project.state = s5;

  // Clear bible drafts from extension (judgeAttempts lives on the checkpoint)
  delete project.extension.bibleJudgeResult;
  delete project.extension.sensoryPaletteData;
  delete project.extension.sensoryPaletteDone;
  delete project.extension.stepBackContext;
  delete project.extension.stepBackDone;
  delete project.extension.scenePlanData;
}

// ─────────────────────────────────────────────────────────────────────
// Phase 3 — Scene ingest handlers
// ─────────────────────────────────────────────────────────────────────

function requireSceneGenState(project: AgentProject): Step6_SceneGenerating {
  if (project.state.step !== "scene_generating") {
    throw new Error(`Expected scene_generating, got ${project.state.step}`);
  }
  return project.state as Step6_SceneGenerating;
}

function toReadableScene(vnScene: any): any {
  const lines: string[] = [];
  for (const line of vnScene.lines ?? []) {
    if (line.stage_direction) lines.push(`[${line.stage_direction}]`);
    if (line.speaker === "NARRATION") {
      lines.push(line.text);
    } else if (line.speaker === "INTERNAL") {
      lines.push(`(${line.text})`);
    } else {
      const delivery = line.delivery ? ` ${line.delivery}` : "";
      const emotion = line.emotion ? ` [${line.emotion}]` : "";
      lines.push(`${line.speaker}${emotion}${delivery}: ${line.text}`);
    }
  }
  const text = lines.join("\n");
  return {
    scene_id: vnScene.scene_id ?? "",
    title: vnScene.title ?? "",
    screenplay_text: text,
    word_count: text.split(/\s+/).length,
  };
}

function countVitalityFlags(vitality: any): number {
  if (!vitality) return 0;
  const isGenuine = (flag: any): boolean => {
    if (typeof flag === "boolean") return flag;
    return flag?.present && flag?.quality === "genuine";
  };
  let score = [
    vitality.failed_intention ?? vitality.has_failed_intention,
    vitality.non_optimal_response ?? vitality.has_non_optimal_response,
    vitality.behavioral_turn ?? vitality.has_behavioral_turn,
    vitality.asymmetry ?? vitality.has_asymmetry,
    vitality.discovery ?? vitality.has_discovery,
  ].filter(isGenuine).length;
  const overExp = vitality.over_explanation_lines ?? 0;
  if (overExp >= 7) score -= 2;
  else if (overExp >= 4) score -= 1;
  return Math.max(0, score);
}

const VITALITY_REROLL_THRESHOLD = 3;

function extractDistinctivePhrases(vnScene: any): string[] {
  const lines = vnScene?.lines ?? [];
  const phrases: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const speaker = (line.speaker ?? "").toUpperCase();
    const text = (line.text ?? "").trim();
    if (!text) continue;
    if ((speaker === "INTERNAL" || !["NARRATION"].includes(speaker)) && text.split(/\s+/).length <= 8) {
      const normalized = text.toLowerCase().replace(/[.!?,;:'"—\-]+$/g, "").trim();
      if (normalized.length >= 4 && !seen.has(normalized)) {
        seen.add(normalized);
        phrases.push(text);
      }
    }
    if (speaker === "INTERNAL") {
      const matches = text.match(
        /(?:there (?:it )?is|something in (?:my|his|her) \w+|the \w+ (?:of|in|at) \w+|I (?:don't|didn't|can't) know)/gi,
      );
      if (matches) {
        for (const m of matches) {
          const norm = m.toLowerCase().trim();
          if (!seen.has(norm)) {
            seen.add(norm);
            phrases.push(m);
          }
        }
      }
    }
  }
  return phrases;
}

function ingestSceneWriter(project: AgentProject, ctx: IngestContext): void {
  const s6 = requireSceneGenState(project);
  const isCandidateB = ctx.role === "scene_writer_b";
  const vnScene = ctx.output as any;
  const readable = toReadableScene(vnScene);
  const candidate = { vnScene, readable, judgeResult: undefined as any, vitalityScore: undefined as any };

  if (isCandidateB) {
    project.extension.candidateB = candidate;
    project.extension.sceneSubstep = "judge_b";
  } else {
    project.extension.candidateA = candidate;
    project.extension.sceneSubstep = "judge_a";
  }

  const idx = project.extension.currentSceneIndex ?? 0;
  const sceneId = s6.scenePlan.scenes[idx]?.scene_id ?? "?";
  s6.traces.push(
    makeTrace({
      role: isCandidateB ? `scene_writer_b:${sceneId}` : `scene_writer:${sceneId}`,
      operationId: s6.operationId,
      templateKey: "SCENE_WRITER_SYSTEM",
      durationMs: ctx.durationMs ?? 0,
    }),
  );
}

function ingestSceneJudge(project: AgentProject, ctx: IngestContext): void {
  const s6 = requireSceneGenState(project);
  const isCandidateB = ctx.role === "scene_judge_b";
  const judgeOutput = ctx.output as any;
  const vitalityScore = countVitalityFlags(judgeOutput.vitality);

  if (isCandidateB) {
    const cb = project.extension.candidateB;
    if (!cb) throw new Error("ingestSceneJudge: no candidateB to attach judge to");
    cb.judgeResult = judgeOutput;
    cb.vitalityScore = vitalityScore;
  } else {
    const ca = project.extension.candidateA;
    if (!ca) throw new Error("ingestSceneJudge: no candidateA to attach judge to");
    ca.judgeResult = judgeOutput;
    ca.vitalityScore = vitalityScore;
  }

  const idx = project.extension.currentSceneIndex ?? 0;
  const sceneId = s6.scenePlan.scenes[idx]?.scene_id ?? "?";
  s6.traces.push(
    makeTrace({
      role: isCandidateB ? `scene_judge_b:${sceneId}` : `scene_judge:${sceneId}`,
      operationId: s6.operationId,
      templateKey: "SCENE_JUDGE_SYSTEM",
      durationMs: ctx.durationMs ?? 0,
      judgeOutcome: judgeOutput.pass ? "pass" : "fail_accepted",
    }),
  );

  // Decide next substep
  if (isCandidateB) {
    // Pick winning candidate (higher vitality) and commit it
    const a = project.extension.candidateA!;
    const b = project.extension.candidateB!;
    const winner = (b.vitalityScore ?? 0) > (a.vitalityScore ?? 0) ? b : a;
    commitWinningScene(project, winner);
    project.extension.sceneSubstep = "tension_update";
    project.extension.sceneJudgeRetries = 0;  // reset for next scene
    delete project.extension.candidateA;
    delete project.extension.candidateB;
    return;
  }

  // After candidate A judge: retry on judge fail, reroll on low vitality, or commit
  const ca = project.extension.candidateA!;
  const MAX_SCENE_RETRIES = 2;
  const retries = project.extension.sceneJudgeRetries ?? 0;

  if (!judgeOutput.pass && retries < MAX_SCENE_RETRIES) {
    // Judge rejected — retry the writer for this scene (mirror v2 sceneGenerationService)
    project.extension.sceneJudgeRetries = retries + 1;
    project.extension.sceneSubstep = "writer_a";
    delete project.extension.candidateA;
    return;
  }

  if (judgeOutput.pass && (ca.vitalityScore ?? 0) < VITALITY_REROLL_THRESHOLD) {
    // Passed judge but vitality is marginal — roll candidate B
    project.extension.sceneSubstep = "writer_b";
  } else {
    // Either passed with good vitality, or failed after retries exhausted — commit A and move on
    commitWinningScene(project, ca);
    project.extension.sceneSubstep = "tension_update";
    project.extension.sceneJudgeRetries = 0;  // reset for next scene
    delete project.extension.candidateA;
  }
}

function commitWinningScene(
  project: AgentProject,
  winner: { vnScene: any; readable: any; judgeResult?: any; vitalityScore?: number },
): void {
  const s6 = requireSceneGenState(project);
  const idx = project.extension.currentSceneIndex ?? 0;
  const plan = s6.scenePlan.scenes[idx];
  const judgeResult = winner.judgeResult ?? { pass: true, issues: [] };
  const generated: GeneratedScene = {
    scene_id: plan.scene_id,
    state: "completed",
    operationId: s6.operationId,
    plan,
    vn_scene: winner.vnScene,
    readable: winner.readable,
    judge_result: {
      pass: Boolean(judgeResult.pass),
      issues: (judgeResult.issues ?? []).map((i: any) =>
        typeof i === "string" ? i : `[${i.category}] ${i.problem}`,
      ),
      repaired: false,
      vitality: judgeResult.vitality,
    },
  };
  s6.generatedScenes.push(generated);
  s6.checkpoint.completedSceneIds.push(plan.scene_id);

  // Extract distinctive phrases into tension state
  const newPhrases = extractDistinctivePhrases(winner.vnScene);
  if (newPhrases.length > 0 && project.extension.tensionState) {
    const used = project.extension.tensionState.used_phrases ?? [];
    project.extension.tensionState.used_phrases = [...used, ...newPhrases].slice(-60);
  }
}

function ingestTensionUpdate(project: AgentProject, ctx: IngestContext): void {
  const s6 = requireSceneGenState(project);
  const idx = project.extension.currentSceneIndex ?? 0;
  const parsed = ctx.output as any;

  // Keep previous state's used_phrases (deterministically accumulated) and
  // merge the LLM's updates onto it. The real service does the same trick.
  const previous = project.extension.tensionState ?? ({} as any);
  const updated = {
    relationships: parsed.relationships ?? previous.relationships ?? {},
    unresolved_threads: parsed.unresolved_threads ?? previous.unresolved_threads ?? [],
    emotional_temperature: Math.max(
      1,
      Math.min(10, parsed.emotional_temperature ?? previous.emotional_temperature ?? 3),
    ),
    register_history: parsed.register_history ?? previous.register_history ?? [],
    what_the_reader_knows: parsed.what_the_reader_knows ?? previous.what_the_reader_knows ?? [],
    what_hasnt_broken_yet: parsed.what_hasnt_broken_yet ?? previous.what_hasnt_broken_yet ?? [],
    scene_count: (previous.scene_count ?? 0) + 1,
    used_phrases: previous.used_phrases ?? [],
  };
  project.extension.tensionState = updated;

  const sceneId = s6.scenePlan.scenes[idx]?.scene_id ?? "?";
  s6.traces.push(
    makeTrace({
      role: `v2_summarizer:tension:${sceneId}`,
      operationId: s6.operationId,
      templateKey: "TENSION_UPDATE",
      durationMs: ctx.durationMs ?? 0,
    }),
  );

  // Advance to next scene, or finish
  const nextIdx = idx + 1;
  if (nextIdx >= s6.scenePlan.scenes.length) {
    // All scenes generated — transition to StepCompleted
    const completed: StepCompleted = {
      step: "completed",
      projectId: s6.projectId,
      createdAt: s6.createdAt,
      updatedAt: s6.updatedAt,
      traces: s6.traces,
      psychologyLedger: s6.psychologyLedger,
      constraintLedger: s6.constraintLedger,
      culturalInsights: s6.culturalInsights,
      mode: s6.mode,
      premise: s6.premise,
      storyBible: s6.storyBible,
      scenePlan: s6.scenePlan,
      scenes: s6.generatedScenes,
    };
    project.state = completed;
    // Clear scene-loop extension fields
    delete project.extension.currentSceneIndex;
    delete project.extension.sceneSubstep;
    delete project.extension.tensionState;
    delete project.extension.descriptorTracker;
    delete project.extension.candidateA;
    delete project.extension.candidateB;
    return;
  }
  project.extension.currentSceneIndex = nextIdx;
  project.extension.sceneSubstep = "writer_a";
}

// ── Async ingest wrapper: used for roles that need async post-processing ──

export async function ingestAsync(project: AgentProject, ctx: IngestContext): Promise<void> {
  if (ctx.role === "bible_characters") {
    return ingestBibleCharactersAsync(project, ctx);
  }
  ingest(project, ctx);
}

// ── Build the PremiseArtifact from raw LLM output ───────────────────

function buildPremiseArtifact(raw: unknown, operationId: any): PremiseArtifact {
  const d = raw as any;
  return {
    state: "draft",
    operationId,
    hook_sentence: d.hook_sentence ?? "",
    emotional_promise: d.emotional_promise ?? "",
    premise_paragraph: d.premise_paragraph ?? "",
    synopsis: d.synopsis ?? "",
    tone_chips: d.tone_chips ?? [],
    bans: d.bans ?? [],
    setting_anchor: d.setting_anchor ?? "",
    time_period: d.time_period ?? "",
    characters_sketch: d.characters_sketch ?? [],
    core_conflict: d.core_conflict ?? "",
    suggested_length: d.suggested_length ?? "medium",
    suggested_cast: d.suggested_cast ?? "small_ensemble",
  };
}

// ── Trace helper ─────────────────────────────────────────────────────

function makeTrace(args: {
  role: string;
  operationId: any;
  templateKey: string;
  durationMs: number;
  judgeOutcome?: StepTrace["judgeOutcome"];
}): StepTrace {
  return {
    operationId: args.operationId,
    role: args.role,
    templateVersion: createHash("sha256").update(args.templateKey).digest("hex").slice(0, 16),
    schemaVersion: 1,
    model: "claude-via-subagent",
    provider: "claude-agent",
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    durationMs: args.durationMs,
    judgeOutcome: args.judgeOutcome,
    retryCount: 0,
    timestamp: new Date().toISOString(),
  };
}
