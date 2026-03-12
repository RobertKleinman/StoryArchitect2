/**
 * Golden Test Set Infrastructure
 *
 * Purpose: Regression testing for LLM output quality across modules.
 *
 * How it works:
 *   1. CAPTURE mode: Run the pipeline normally, save inputs + outputs as golden baselines
 *   2. COMPARE mode: Run the pipeline again (after changes), compare new outputs against baselines
 *   3. REPORT mode: Generate a human-readable quality diff report
 *
 * This does NOT auto-judge quality. It produces structured diffs that a human
 * (or a separate judge LLM) can evaluate. The point is to make regressions visible.
 *
 * Usage:
 *   // Capture a baseline
 *   const runner = new GoldenTestRunner("./golden-tests");
 *   await runner.capture("hook", "dark-romance-seed", { inputs, outputs });
 *
 *   // Compare against baseline after making changes
 *   const report = await runner.compare("hook", "dark-romance-seed", { inputs, outputs: newOutputs });
 *   console.log(report);
 */

import * as fs from "fs";
import * as path from "path";

// ─── Types ───

export type ModuleName = "hook" | "character" | "character_image" | "world" | "plot" | "scene";

export interface GoldenTestCase {
  /** Unique ID for this test case */
  id: string;
  /** Which module this tests */
  module: ModuleName;
  /** Human description of what makes this test case interesting */
  description: string;
  /** Why this test case was chosen (edge case? typical? complex?) */
  rationale: string;
  /** The seed/input that started the session */
  seedInput: string;
  /** Full inputs to the module (upstream packs, session state, etc.) */
  inputs: Record<string, unknown>;
  /** The captured outputs (clarifier responses, builder output, judge scores, etc.) */
  outputs: Record<string, unknown>;
  /** Prompt template versions at time of capture */
  promptVersions?: Record<string, string>;
  /** Quality criteria specific to this test case */
  qualityCriteria: QualityCriterion[];
  /** When this baseline was captured */
  capturedAt: string;
  /** Optional tags for filtering */
  tags?: string[];
}

export interface QualityCriterion {
  /** What to check */
  name: string;
  /** How to check it (human instruction or automated check type) */
  checkType: "human_review" | "field_present" | "field_not_empty" | "score_above" | "contains_keyword" | "custom";
  /** For score_above: minimum score. For contains_keyword: the keyword. */
  threshold?: number | string;
  /** Path to the field in outputs (dot notation) */
  fieldPath?: string;
  /** Human-readable description of what good looks like */
  description: string;
}

export interface ComparisonResult {
  testCaseId: string;
  module: ModuleName;
  description: string;
  /** Overall: did the automated checks pass? */
  automatedChecksPassed: boolean;
  /** Individual check results */
  checks: CheckResult[];
  /** Structural diffs: fields that changed, appeared, or disappeared */
  structuralDiffs: StructuralDiff[];
  /** Fields that need human review */
  humanReviewNeeded: string[];
  /** Timestamp */
  comparedAt: string;
}

export interface CheckResult {
  criterion: QualityCriterion;
  passed: boolean;
  baselineValue?: unknown;
  currentValue?: unknown;
  note?: string;
}

export interface StructuralDiff {
  path: string;
  type: "added" | "removed" | "changed" | "unchanged";
  baselineValue?: unknown;
  currentValue?: unknown;
  /** For string fields: rough similarity (0-1) */
  similarity?: number;
}

// ─── Runner ───

export class GoldenTestRunner {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }
  }

  // ─── Capture ───

  async capture(testCase: GoldenTestCase): Promise<string> {
    const dir = path.join(this.baseDir, testCase.module);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const filePath = path.join(dir, `${testCase.id}.json`);
    testCase.capturedAt = new Date().toISOString();

    fs.writeFileSync(filePath, JSON.stringify(testCase, null, 2));
    return filePath;
  }

  // ─── Compare ───

  async compare(
    testCaseId: string,
    module: ModuleName,
    currentOutputs: Record<string, unknown>,
  ): Promise<ComparisonResult> {
    const baseline = this.loadBaseline(testCaseId, module);
    if (!baseline) {
      throw new Error(`No baseline found for ${module}/${testCaseId}`);
    }

    const checks = this.runAutomatedChecks(baseline, currentOutputs);
    const structuralDiffs = this.computeStructuralDiffs(baseline.outputs, currentOutputs);
    const humanReviewNeeded = baseline.qualityCriteria
      .filter(c => c.checkType === "human_review")
      .map(c => c.name);

    return {
      testCaseId,
      module,
      description: baseline.description,
      automatedChecksPassed: checks.every(c => c.passed),
      checks,
      structuralDiffs: structuralDiffs.filter(d => d.type !== "unchanged"),
      humanReviewNeeded,
      comparedAt: new Date().toISOString(),
    };
  }

  // ─── List ───

  listTestCases(module?: ModuleName): GoldenTestCase[] {
    const modules = module ? [module] : ["hook", "character", "character_image", "world", "plot", "scene"] as ModuleName[];
    const cases: GoldenTestCase[] = [];

    for (const mod of modules) {
      const dir = path.join(this.baseDir, mod);
      if (!fs.existsSync(dir)) continue;

      const files = fs.readdirSync(dir).filter(f => f.endsWith(".json"));
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(dir, file), "utf-8");
          cases.push(JSON.parse(content));
        } catch {
          // skip malformed files
        }
      }
    }

    return cases;
  }

  // ─── Report ───

  formatReport(result: ComparisonResult): string {
    const lines: string[] = [];
    lines.push(`═══ Golden Test Report: ${result.module}/${result.testCaseId} ═══`);
    lines.push(`Description: ${result.description}`);
    lines.push(`Compared at: ${result.comparedAt}`);
    lines.push("");

    // Automated checks
    lines.push(`── Automated Checks: ${result.automatedChecksPassed ? "ALL PASSED" : "SOME FAILED"} ──`);
    for (const check of result.checks) {
      const icon = check.passed ? "✓" : "✗";
      lines.push(`  ${icon} ${check.criterion.name}: ${check.note || (check.passed ? "passed" : "FAILED")}`);
    }
    lines.push("");

    // Structural diffs
    if (result.structuralDiffs.length > 0) {
      lines.push(`── Structural Changes (${result.structuralDiffs.length}) ──`);
      for (const diff of result.structuralDiffs) {
        switch (diff.type) {
          case "added":
            lines.push(`  + ${diff.path}: ${truncate(String(diff.currentValue))}`);
            break;
          case "removed":
            lines.push(`  - ${diff.path}: was ${truncate(String(diff.baselineValue))}`);
            break;
          case "changed":
            lines.push(`  ~ ${diff.path}${diff.similarity !== undefined ? ` (similarity: ${(diff.similarity * 100).toFixed(0)}%)` : ""}`);
            lines.push(`    was: ${truncate(String(diff.baselineValue))}`);
            lines.push(`    now: ${truncate(String(diff.currentValue))}`);
            break;
        }
      }
      lines.push("");
    }

    // Human review needed
    if (result.humanReviewNeeded.length > 0) {
      lines.push(`── Human Review Needed ──`);
      for (const item of result.humanReviewNeeded) {
        lines.push(`  ? ${item}`);
      }
    }

    return lines.join("\n");
  }

  // ─── Internal ───

  private loadBaseline(testCaseId: string, module: ModuleName): GoldenTestCase | null {
    const filePath = path.join(this.baseDir, module, `${testCaseId}.json`);
    if (!fs.existsSync(filePath)) return null;

    try {
      const content = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  private runAutomatedChecks(baseline: GoldenTestCase, currentOutputs: Record<string, unknown>): CheckResult[] {
    return baseline.qualityCriteria
      .filter(c => c.checkType !== "human_review")
      .map(criterion => this.runCheck(criterion, baseline.outputs, currentOutputs));
  }

  private runCheck(criterion: QualityCriterion, baselineOutputs: Record<string, unknown>, currentOutputs: Record<string, unknown>): CheckResult {
    const baselineValue = criterion.fieldPath ? getNestedValue(baselineOutputs, criterion.fieldPath) : undefined;
    const currentValue = criterion.fieldPath ? getNestedValue(currentOutputs, criterion.fieldPath) : undefined;

    switch (criterion.checkType) {
      case "field_present":
        return {
          criterion,
          passed: currentValue !== undefined && currentValue !== null,
          baselineValue,
          currentValue,
          note: currentValue !== undefined ? "field present" : "field MISSING",
        };

      case "field_not_empty":
        return {
          criterion,
          passed: currentValue !== undefined && currentValue !== null && currentValue !== "" &&
                  (!Array.isArray(currentValue) || currentValue.length > 0),
          baselineValue,
          currentValue: typeof currentValue === "string" ? truncate(currentValue) : currentValue,
          note: currentValue ? "field has content" : "field is EMPTY",
        };

      case "score_above": {
        const score = typeof currentValue === "number" ? currentValue : parseFloat(String(currentValue));
        const threshold = typeof criterion.threshold === "number" ? criterion.threshold : parseFloat(String(criterion.threshold));
        return {
          criterion,
          passed: !isNaN(score) && score >= threshold,
          baselineValue,
          currentValue: score,
          note: `score ${score} ${score >= threshold ? ">=" : "<"} threshold ${threshold}`,
        };
      }

      case "contains_keyword": {
        const text = String(currentValue || "").toLowerCase();
        const keyword = String(criterion.threshold || "").toLowerCase();
        return {
          criterion,
          passed: text.includes(keyword),
          baselineValue: truncate(String(baselineValue)),
          currentValue: truncate(String(currentValue)),
          note: text.includes(keyword) ? `contains "${keyword}"` : `MISSING "${keyword}"`,
        };
      }

      default:
        return {
          criterion,
          passed: true,
          note: "custom check — needs manual evaluation",
        };
    }
  }

  private computeStructuralDiffs(baseline: Record<string, unknown>, current: Record<string, unknown>, prefix = ""): StructuralDiff[] {
    const diffs: StructuralDiff[] = [];
    const allKeys = new Set([...Object.keys(baseline), ...Object.keys(current)]);

    for (const key of allKeys) {
      const path = prefix ? `${prefix}.${key}` : key;
      const bVal = baseline[key];
      const cVal = current[key];

      if (bVal === undefined && cVal !== undefined) {
        diffs.push({ path, type: "added", currentValue: cVal });
      } else if (bVal !== undefined && cVal === undefined) {
        diffs.push({ path, type: "removed", baselineValue: bVal });
      } else if (typeof bVal === "object" && typeof cVal === "object" && bVal !== null && cVal !== null && !Array.isArray(bVal) && !Array.isArray(cVal)) {
        diffs.push(...this.computeStructuralDiffs(bVal as Record<string, unknown>, cVal as Record<string, unknown>, path));
      } else if (JSON.stringify(bVal) !== JSON.stringify(cVal)) {
        const similarity = typeof bVal === "string" && typeof cVal === "string" ? computeStringSimilarity(bVal, cVal) : undefined;
        diffs.push({ path, type: "changed", baselineValue: bVal, currentValue: cVal, similarity });
      } else {
        diffs.push({ path, type: "unchanged" });
      }
    }

    return diffs;
  }
}

// ─── Helpers ───

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function truncate(s: string, max = 120): string {
  return s.length > max ? s.slice(0, max) + "..." : s;
}

/** Simple bigram-based string similarity (0-1) */
function computeStringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const bigramsA = new Set<string>();
  for (let i = 0; i < a.length - 1; i++) bigramsA.add(a.slice(i, i + 2));

  let intersections = 0;
  for (let i = 0; i < b.length - 1; i++) {
    if (bigramsA.has(b.slice(i, i + 2))) intersections++;
  }

  return (2 * intersections) / (a.length - 1 + b.length - 1);
}

// ─── Predefined Quality Criteria Templates ───

export const HOOK_QUALITY_CRITERIA: QualityCriterion[] = [
  { name: "Hook sentence present", checkType: "field_not_empty", fieldPath: "builder.hook_sentence", description: "Builder must produce a hook sentence" },
  { name: "Premise present", checkType: "field_not_empty", fieldPath: "builder.premise", description: "Builder must produce a premise" },
  { name: "Emotional promise present", checkType: "field_not_empty", fieldPath: "builder.emotional_promise", description: "Builder must produce an emotional promise" },
  { name: "Judge specificity score", checkType: "score_above", fieldPath: "judge.scores.specificity", threshold: 6, description: "Specificity score should be 6+" },
  { name: "Judge mechanism score", checkType: "score_above", fieldPath: "judge.scores.mechanism", threshold: 6, description: "Mechanism score should be 6+" },
  { name: "Judge user_fit score", checkType: "score_above", fieldPath: "judge.scores.user_fit", threshold: 6, description: "User fit score should be 6+" },
  { name: "Hook is specific (not generic)", checkType: "human_review", description: "Hook sentence should be a specific 'what if' situation, not a genre label" },
  { name: "Premise has mechanism", checkType: "human_review", description: "Premise should contain at least one specific mechanism/ritual/rule" },
  { name: "Character voice differentiation", checkType: "human_review", description: "Characters mentioned should feel distinct, not interchangeable" },
];

export const CHARACTER_QUALITY_CRITERIA: QualityCriterion[] = [
  { name: "Character profiles present", checkType: "field_not_empty", fieldPath: "builder.characters", description: "Builder must produce character profiles" },
  { name: "Protagonist has want", checkType: "field_not_empty", fieldPath: "builder.characters.protagonist.want", description: "Protagonist must have a defined want" },
  { name: "Protagonist has misbelief", checkType: "field_not_empty", fieldPath: "builder.characters.protagonist.misbelief", description: "Protagonist must have a misbelief" },
  { name: "Psychological depth", checkType: "human_review", description: "Characters should have layered psychology, not just surface traits" },
  { name: "Relationship tensions feel earned", checkType: "human_review", description: "Tensions should emerge from character psychology, not be imposed" },
  { name: "Consistency with hook", checkType: "human_review", description: "Characters should match the hook's tone, stakes, and situation" },
];

export const SCENE_QUALITY_CRITERIA: QualityCriterion[] = [
  { name: "VN scene has lines", checkType: "field_not_empty", fieldPath: "builder.vn_scene.lines", description: "Scene must have dialogue/narration lines" },
  { name: "Continuity anchor present", checkType: "field_not_empty", fieldPath: "builder.continuity_anchor", description: "Scene must produce a continuity anchor" },
  { name: "Delivery notes present", checkType: "field_not_empty", fieldPath: "builder.delivery_notes.objective_delivered", description: "Builder must note how objective was delivered" },
  { name: "Scene question addressed", checkType: "field_not_empty", fieldPath: "builder.delivery_notes.scene_question_status", description: "Builder must report scene question status" },
  { name: "Continuity with previous scene", checkType: "human_review", description: "Scene should honor the previous scene's exit hook and emotional state" },
  { name: "Value shift executed", checkType: "human_review", description: "Character's emotional/strategic position should change during the scene" },
  { name: "Dialogue feels character-specific", checkType: "human_review", description: "Each character's lines should sound distinct, not interchangeable" },
  { name: "Exit hook plants curiosity", checkType: "human_review", description: "Scene ending should make the reader want to continue" },
];

export const PLOT_QUALITY_CRITERIA: QualityCriterion[] = [
  { name: "Tension chain present", checkType: "field_not_empty", fieldPath: "builder.tension_chain", description: "Builder must produce a tension chain" },
  { name: "Core conflict present", checkType: "field_not_empty", fieldPath: "builder.core_conflict", description: "Builder must produce a core conflict" },
  { name: "Turning points present", checkType: "field_not_empty", fieldPath: "builder.turning_points", description: "Builder must produce turning points" },
  { name: "Every beat has causal_logic", checkType: "human_review", description: "Every tension chain beat must connect via but/therefore, not 'and then'" },
  { name: "Stakes escalate", checkType: "human_review", description: "Stakes should generally increase through the tension chain" },
  { name: "Development targets addressed", checkType: "human_review", description: "Plot should address upstream development targets where possible" },
];
