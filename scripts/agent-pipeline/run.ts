#!/usr/bin/env tsx
/**
 * Agent Pipeline — CLI entry point.
 *
 * Drives a visnovgen default-mode pipeline end-to-end where every
 * LLM call is routed to a Claude subagent in the parent chat session
 * instead of a provider API. This CLI does NOT make LLM calls itself.
 * Instead, for each step:
 *   1. `prompt` emits the next system+user prompt as JSON for me (the
 *      chat orchestrator) to feed into a subagent
 *   2. I capture the subagent's raw output and save it to a file
 *   3. `ingest` reads that file, parses the JSON, validates, advances
 *      state, and reports what's next
 *
 * Phase 1 scope: init → intake → premise_writer → premise_judge →
 * (optional repair) → premise_review (auto-approved).
 *
 * Usage:
 *   tsx scripts/agent-pipeline/run.ts init --seed "..." [--project-id ID] [--skip-intake]
 *   tsx scripts/agent-pipeline/run.ts status --project-id ID
 *   tsx scripts/agent-pipeline/run.ts prompt --project-id ID [--user-input "..."]
 *   tsx scripts/agent-pipeline/run.ts ingest --project-id ID --input FILE [--user-input "..."] [--duration MS]
 *   tsx scripts/agent-pipeline/run.ts approve-premise --project-id ID
 *   tsx scripts/agent-pipeline/run.ts export --project-id ID
 */

import { promises as fs } from "fs";
import {
  newProject,
  loadProject,
  saveProject,
  saveRawOutput,
  projectPath,
  type AgentProject,
} from "./state";
import {
  nextAction,
  ingest,
  ingestAsync,
  approvePremiseGate,
  approveScenesGate,
  type NextAction,
} from "./orchestrator";
import {
  buildIntakePrompt,
  buildPremiseWriterSpec,
  buildPremiseJudgeSpec,
  buildPremiseRepairSpec,
  buildWorldWriterSpec,
  buildCharacterWriterSpec,
  buildPlotWriterSpec,
  buildBibleJudgeSpec,
  buildSensoryPaletteSpec,
  buildStepBackSpec,
  buildScenePlannerSpec,
  buildSceneWriterSpec,
  buildSceneJudgeSpec,
  buildTensionUpdateSpec,
  type AgentPromptSpec,
} from "./prompts";
import { extractJson, validateRequired } from "./parse";

// ── Arg parsing ──────────────────────────────────────────────────────

function parseArgs(argv: string[]): { cmd: string; flags: Record<string, string | boolean> } {
  const [, , cmd, ...rest] = argv;
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = rest[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return { cmd: cmd ?? "help", flags };
}

function requireFlag(flags: Record<string, any>, key: string): string {
  const v = flags[key];
  if (!v || typeof v !== "string") {
    fail(`missing --${key}`);
  }
  return v as string;
}

function fail(msg: string): never {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

function print(obj: unknown) {
  console.log(JSON.stringify(obj, null, 2));
}

// ── Commands ─────────────────────────────────────────────────────────

async function cmdInit(flags: Record<string, any>) {
  const seed = requireFlag(flags, "seed");
  const projectId = (flags["project-id"] as string) || undefined;
  const skipIntake = Boolean(flags["skip-intake"]);

  const project = newProject(seed, projectId);

  if (skipIntake) {
    // Skip intake: push a synthetic turn 1 marking ready, then transition
    // to premise_generating. The premise writer prompt will still see the
    // (empty) conversationTurns, which mirrors a direct seed-to-premise path.
    (project.state as any).conversationTurns.push({
      turnNumber: 1,
      userInput: seed,
      systemResponse: {
        question: undefined,
        assumptions: [],
        readyForPremise: true,
        readiness_note: "Intake skipped by --skip-intake",
      },
    });
  }

  await saveProject(project);
  const action = nextAction(project);
  print({
    projectId: project.state.projectId,
    step: project.state.step,
    path: projectPath(project.state.projectId as string),
    seed,
    mode: project.state.mode,
    skipIntake,
    nextAction: action,
  });
}

async function cmdStatus(flags: Record<string, any>) {
  const id = requireFlag(flags, "project-id");
  const project = await loadProject(id);
  const action = nextAction(project);
  print({
    projectId: project.state.projectId,
    step: project.state.step,
    mode: project.state.mode,
    traces: project.state.traces.length,
    nextAction: action,
    extension: summarizeExtension(project),
  });
}

function summarizeExtension(project: AgentProject) {
  const ext = project.extension;
  const s: any = project.state;
  const completed = s.checkpoint?.completedSubSteps;
  return {
    hasDraftPremise: Boolean(ext.draftPremise),
    hasPremiseJudge: Boolean(ext.premiseJudge),
    premiseJudgePass: ext.premiseJudge?.pass,
    premiseRepairAttempted: Boolean(ext.premiseRepairAttempted),
    bibleCompleted: completed,
    bibleJudgeAttempts: ext.bibleJudgeAttempts,
    bibleJudgePending: ext.bibleJudgeResult ? !ext.bibleJudgeResult.pass : false,
    stepBackDone: Boolean(ext.stepBackDone),
    sensoryPaletteDone: Boolean(ext.sensoryPaletteDone),
  };
}

async function cmdPrompt(flags: Record<string, any>) {
  const id = requireFlag(flags, "project-id");
  const project = await loadProject(id);
  const action = nextAction(project);

  if (action.kind === "await-user-input") {
    print({ awaitUserInput: true, question: action.question });
    return;
  }
  if (action.kind === "gate") {
    print({
      gate: action.gate,
      hint: "call `approve-premise` to auto-approve and transition",
    });
    return;
  }
  if (action.kind === "phase-boundary") {
    print({ phaseBoundary: action });
    return;
  }
  if (action.kind === "done") {
    print({ done: true });
    return;
  }

  // action.kind === "call"
  let spec: AgentPromptSpec;
  switch (action.role) {
    case "intake": {
      const s1: any = project.state;
      const turnNumber = (s1.conversationTurns?.length ?? 0) + 1;
      let userInput: string;
      if (turnNumber === 1) {
        userInput = s1.seedInput ?? "";
      } else {
        userInput = requireFlag(flags, "user-input");
      }
      spec = buildIntakePrompt(project, userInput);
      break;
    }
    case "premise_writer": {
      // Transition idea_gathering → premise_generating first, if needed
      // (prompt builder requires step=premise_generating)
      if (project.state.step === "idea_gathering") {
        // Synthesize a lightweight transition for the purposes of prompt building.
        // Real transition happens in ingestPremiseWriter, but we need to present
        // the correct prompt now. We mutate a COPY for builder only.
        const scratch: AgentProject = {
          state: {
            ...(project.state as any),
            step: "premise_generating",
            operationId: "tmp" as any,
          },
          extension: project.extension,
        };
        spec = buildPremiseWriterSpec(scratch);
      } else if (project.extension.draftPremise && project.extension.premiseJudge && !project.extension.premiseJudge.pass) {
        spec = buildPremiseRepairSpec(project);
      } else {
        spec = buildPremiseWriterSpec(project);
      }
      break;
    }
    case "premise_judge":
      spec = buildPremiseJudgeSpec(project);
      break;
    case "bible_world":
      spec = await buildWorldWriterSpec(project);
      break;
    case "bible_characters":
      spec = await buildCharacterWriterSpec(project);
      break;
    case "bible_plot":
      spec = buildPlotWriterSpec(project);
      break;
    case "bible_judge":
      spec = buildBibleJudgeSpec(project);
      break;
    case "bible_sensory_palette":
      spec = buildSensoryPaletteSpec(project);
      break;
    case "bible_step_back":
      spec = buildStepBackSpec(project);
      break;
    case "bible_scene_plan":
      spec = buildScenePlannerSpec(project);
      break;
    case "scene_writer":
    case "scene_writer_b":
      spec = buildSceneWriterSpec(project);
      break;
    case "scene_judge":
    case "scene_judge_b":
      spec = buildSceneJudgeSpec(project);
      break;
    case "tension_update":
      spec = buildTensionUpdateSpec(project);
      break;
    default:
      fail(`Unknown call role: ${action.role}`);
  }

  print({
    stage: spec.stage,
    role: spec.role,
    subagentTier: spec.subagentTier,
    realModel: spec.model,
    temperature: spec.temperature,
    maxTokens: spec.maxTokens,
    systemPrompt: spec.systemPrompt,
    userPrompt: spec.userPrompt,
    schema: spec.schema,
    turnNumber: spec.turnNumber,
    instructions: [
      "Pass systemPrompt + userPrompt to a Claude subagent at the specified tier.",
      "Require the subagent to return a single JSON object matching `schema`.",
      "Save the raw subagent output to a file, then run `ingest` with --input pointing at that file.",
    ],
  });
}

async function cmdIngest(flags: Record<string, any>) {
  const id = requireFlag(flags, "project-id");
  const input = requireFlag(flags, "input");
  const userInput = (flags["user-input"] as string) || undefined;
  const durationMs = flags["duration"] ? Number(flags["duration"]) : 0;

  const project = await loadProject(id);
  const action = nextAction(project);
  if (action.kind !== "call") {
    fail(`Cannot ingest while next action is '${action.kind}'`);
  }

  const raw = await fs.readFile(input, "utf8");
  // Archive the raw output for debugging / replay
  const archivedPath = await saveRawOutput(id, action.role, raw);

  // step_back is free text, not JSON
  const isFreeText = action.role === "bible_step_back";
  let parsed: unknown;
  if (isFreeText) {
    parsed = raw.trim();
  } else {
    try {
      parsed = extractJson(raw);
    } catch (e) {
      fail(`Failed to parse subagent output: ${(e as Error).message}`);
    }

    // Minimal required-keys check, based on the schema the prompt used
    const schemaOnly = await pickSchemaFor(project, action.role);
    const missing = schemaOnly ? validateRequired(parsed, schemaOnly) : [];
    if (missing.length > 0) {
      fail(`Parsed output is missing required keys: ${missing.join(", ")}`);
    }
  }

  await ingestAsync(project, {
    role: action.role,
    output: parsed,
    userInput,
    durationMs,
  });
  await saveProject(project);

  const next = nextAction(project);
  print({
    ingested: action.role,
    archivedPath,
    step: project.state.step,
    nextAction: next,
    extension: summarizeExtension(project),
  });
}

async function pickSchemaFor(project: AgentProject, role: string): Promise<{ required?: string[] } | null> {
  try {
    switch (role) {
      case "intake": {
        const s1: any = project.state;
        const turnNumber = (s1.conversationTurns?.length ?? 0) + 1;
        const userInput = turnNumber === 1 ? (s1.seedInput ?? "") : "(resuming)";
        return buildIntakePrompt(project, userInput).schema as any;
      }
      case "premise_writer": {
        if (project.state.step === "idea_gathering") {
          const scratch: AgentProject = {
            state: { ...(project.state as any), step: "premise_generating", operationId: "tmp" as any },
            extension: project.extension,
          };
          return buildPremiseWriterSpec(scratch).schema as any;
        }
        if (project.extension.draftPremise && project.extension.premiseJudge && !project.extension.premiseJudge.pass) {
          return buildPremiseRepairSpec(project).schema as any;
        }
        return buildPremiseWriterSpec(project).schema as any;
      }
      case "premise_judge":
        return buildPremiseJudgeSpec(project).schema as any;
      case "bible_world":
        return (await buildWorldWriterSpec(project)).schema as any;
      case "bible_characters":
        return (await buildCharacterWriterSpec(project)).schema as any;
      case "bible_plot":
        return buildPlotWriterSpec(project).schema as any;
      case "bible_judge":
        return buildBibleJudgeSpec(project).schema as any;
      case "bible_sensory_palette":
        return buildSensoryPaletteSpec(project).schema as any;
      case "bible_scene_plan":
        return buildScenePlannerSpec(project).schema as any;
      case "scene_writer":
      case "scene_writer_b":
        return buildSceneWriterSpec(project).schema as any;
      case "scene_judge":
      case "scene_judge_b":
        return buildSceneJudgeSpec(project).schema as any;
      case "tension_update":
        return buildTensionUpdateSpec(project).schema as any;
      default:
        return null;
    }
  } catch {
    return null;
  }
}

async function cmdApprovePremise(flags: Record<string, any>) {
  const id = requireFlag(flags, "project-id");
  const project = await loadProject(id);
  approvePremiseGate(project);
  await saveProject(project);
  const next = nextAction(project);
  print({
    approved: true,
    step: project.state.step,
    nextAction: next,
  });
}

async function cmdApproveScenes(flags: Record<string, any>) {
  const id = requireFlag(flags, "project-id");
  const project = await loadProject(id);
  approveScenesGate(project);
  await saveProject(project);
  const next = nextAction(project);
  print({
    approved: true,
    step: project.state.step,
    nextAction: next,
  });
}

async function cmdExport(flags: Record<string, any>) {
  const id = requireFlag(flags, "project-id");
  const project = await loadProject(id);

  // On completed projects, save the fingerprint for freshness on future runs.
  if (project.state.step === "completed") {
    try {
      const { extractFingerprint, saveFingerprint } = await import(
        "../../shared/fingerprint"
      );
      const fp = extractFingerprint(project.state);
      await saveFingerprint(fp);
      console.error(`[export] saved fingerprint for ${id}`);
    } catch (e) {
      console.error(`[export] fingerprint save failed (non-fatal): ${(e as Error).message}`);
    }
  }

  print(project);
}

// ── Dispatch ─────────────────────────────────────────────────────────

async function main() {
  const { cmd, flags } = parseArgs(process.argv);
  try {
    switch (cmd) {
      case "init":
        return await cmdInit(flags);
      case "status":
        return await cmdStatus(flags);
      case "prompt":
        return await cmdPrompt(flags);
      case "ingest":
        return await cmdIngest(flags);
      case "approve-premise":
        return await cmdApprovePremise(flags);
      case "approve-scenes":
        return await cmdApproveScenes(flags);
      case "export":
        return await cmdExport(flags);
      case "help":
      default:
        console.error(
          "commands: init | status | prompt | ingest | approve-premise | approve-scenes | export",
        );
        process.exit(cmd === "help" ? 0 : 1);
    }
  } catch (e) {
    fail((e as Error).message ?? String(e));
  }
}

main();
