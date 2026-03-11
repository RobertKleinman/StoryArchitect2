/**
 * DIVERGENCE EXPLORER
 * ═══════════════════
 * Background LLM call that explores the story possibility space during user
 * think-time. Generates 15-20 radically different futures, clusters them into
 * direction families, and produces a compact direction map.
 *
 * Runs in parallel with psychology consolidation. Both are fire-and-forget.
 * If the explorer finishes before the user's next submission, the next
 * clarifier turn gets the direction map as inspiration. If not, no harm.
 */

import type { LLMClient } from "./llmClient";
import type {
  UserPsychologyLedger,
  DirectionMap,
  DirectionMapSnapshot,
} from "../../shared/types/userPsychology";
import {
  DIVERGENCE_EXPLORER_SYSTEM,
  DIVERGENCE_EXPLORER_USER_TEMPLATE,
  DIVERGENCE_EXPLORER_SCHEMA,
} from "./divergencePrompts";

/**
 * Context needed to run divergence exploration.
 * Kept minimal — the explorer doesn't need the full session.
 */
export interface DivergenceContext {
  seedInput: string;
  /** Confirmed constraints from the constraint ledger (key: value pairs) */
  confirmedConstraints: Record<string, string>;
  /** Current creative state (the accumulating state_update) */
  currentState: Record<string, unknown>;
  /** Inferred-but-not-confirmed assumptions */
  inferredAssumptions: Record<string, string>;
  /** Brief psychology summary for user-aligned futures */
  psychologySummary: string;
  turnNumber: number;
  module: "hook" | "character" | "character_image" | "world" | "plot";
  /** Family names from the previous direction map (soft nudge to explore new territory) */
  previousFamilyNames?: string[];
}

/**
 * Run the divergence explorer. Returns a DirectionMapSnapshot if successful,
 * null if the LLM call fails or returns unparseable output.
 *
 * This is designed to be called fire-and-forget from a service's background
 * processing. Errors are caught and logged, never thrown.
 */
export async function runDivergenceExploration(
  context: DivergenceContext,
  llm: LLMClient,
): Promise<DirectionMapSnapshot | null> {
  try {
    const previousFamiliesSection = context.previousFamilyNames && context.previousFamilyNames.length > 0
      ? context.previousFamilyNames.map(n => `  - ${n}`).join("\n")
      : "(none — this is the first exploration)";

    const userPrompt = DIVERGENCE_EXPLORER_USER_TEMPLATE
      .replace("{{SEED_INPUT}}", context.seedInput)
      .replace("{{CONFIRMED_CONSTRAINTS}}", formatConstraints(context.confirmedConstraints))
      .replace("{{CURRENT_STATE}}", JSON.stringify(context.currentState, null, 2))
      .replace("{{INFERRED_ASSUMPTIONS}}", formatConstraints(context.inferredAssumptions))
      .replace("{{PSYCHOLOGY_SUMMARY}}", context.psychologySummary || "(no psychology data yet)")
      .replace("{{PREVIOUS_FAMILIES}}", previousFamiliesSection)
      .replace("{{TURN_NUMBER}}", String(context.turnNumber))
      .replace("{{MODULE}}", context.module);

    const raw = await llm.call(
      "divergence_explorer",
      DIVERGENCE_EXPLORER_SYSTEM,
      userPrompt,
      {
        temperature: 1.0, // High temp for maximum creativity
        maxTokens: 4000,
        jsonSchema: DIVERGENCE_EXPLORER_SCHEMA,
      },
    );

    const parsed = JSON.parse(raw) as DirectionMap;

    // Basic validation
    if (!parsed.families || !Array.isArray(parsed.families) || parsed.families.length === 0) {
      console.error("[DIVERGENCE] Explorer returned empty families");
      return null;
    }

    // Constraint compliance filter: remove futures that clearly violate confirmed constraints.
    // This is conservative — only drops obvious violations, not subtle mismatches.
    const filtered = filterConstraintViolations(parsed, context.confirmedConstraints);
    if (filtered.families.length === 0) {
      console.warn("[DIVERGENCE] All families filtered out by constraint compliance — using unfiltered map");
      // Fall back to unfiltered rather than returning nothing
    }
    const finalMap = filtered.families.length > 0 ? filtered : parsed;

    const snapshot: DirectionMapSnapshot = {
      timestamp: new Date().toISOString(),
      afterTurn: context.turnNumber,
      module: context.module,
      directionMap: finalMap,
    };

    return snapshot;
  } catch (err) {
    console.error("[DIVERGENCE] Explorer failed:", err);
    return null;
  }
}

/**
 * Format the direction map for injection into a clarifier prompt.
 * Returns empty string if no direction map is available or stale.
 *
 * Freshness gate: if currentTurn is provided, the direction map is only
 * injected if it was generated within the last 2 turns. This prevents
 * old maps from dragging the clarifier back into directions the
 * conversation has already moved past.
 *
 * The format is compact — just family names + signatures + blind spot.
 * The clarifier uses this as inspiration, not as a checklist.
 */
export function formatDirectionMapForPrompt(
  ledger?: UserPsychologyLedger,
  currentTurn?: number,
): string {
  const snapshot = ledger?.lastDirectionMap;
  if (!snapshot) return "";

  // Freshness gate: skip stale direction maps
  if (currentTurn !== undefined && snapshot.afterTurn < currentTurn - 1) {
    return "";
  }

  const map = snapshot.directionMap;
  if (!map.families || map.families.length === 0) return "";

  const lines: string[] = [
    "═══ DIRECTION MAP (unexplored possibility space — use as inspiration) ═══",
    `Generated after turn ${snapshot.afterTurn}. These are directions the story COULD go that you haven't explored yet.`,
    "",
  ];

  for (const family of map.families) {
    const noveltyTag = family.novelty >= 0.7 ? " ★ UNEXPLORED" : family.novelty >= 0.4 ? " ~ partially explored" : "";
    lines.push(`▸ ${family.name}${noveltyTag}`);
    lines.push(`  ${family.signature}`);
    // Include top 2 futures as examples
    const topFutures = family.futures.slice(0, 2);
    for (const f of topFutures) {
      lines.push(`  → "${f.label}": ${f.sketch}`);
    }
    lines.push("");
  }

  lines.push(`BLIND SPOT: ${map.blindSpot}`);
  lines.push(`CONVERGENCE: ${map.convergenceNote}`);
  lines.push("");
  lines.push("You are NOT required to use any of these directions. They exist to remind you");
  lines.push("that the possibility space is VAST. If your current options all funnel to the same");
  lines.push("kind of story, consider whether one of these unexplored families could inspire");
  lines.push("a genuinely different option. Especially check the ★ UNEXPLORED families.");

  return lines.join("\n");
}

// ── Helpers ──

function formatConstraints(constraints: Record<string, string>): string {
  const entries = Object.entries(constraints);
  if (entries.length === 0) return "(none yet)";
  return entries.map(([k, v]) => `- ${k}: ${v}`).join("\n");
}

/**
 * Extract divergence context from a session's constraint ledger and state.
 * Works for any module — just pass the relevant session fields.
 */
export function extractDivergenceContext(
  seedInput: string,
  constraintLedger: Array<{ key: string; value: string; confidence: string }> | undefined,
  currentState: Record<string, unknown>,
  psychologySummary: string,
  turnNumber: number,
  module: "hook" | "character" | "character_image" | "world" | "plot",
  previousFamilyNames?: string[],
): DivergenceContext {
  const confirmed: Record<string, string> = {};
  const inferred: Record<string, string> = {};

  for (const entry of constraintLedger ?? []) {
    if (entry.confidence === "confirmed") {
      confirmed[entry.key] = entry.value;
    } else {
      inferred[entry.key] = entry.value;
    }
  }

  return {
    seedInput,
    confirmedConstraints: confirmed,
    currentState,
    inferredAssumptions: inferred,
    psychologySummary,
    turnNumber,
    module,
    previousFamilyNames,
  };
}

// ── Constraint compliance filter ──

/**
 * Known binary/categorical constraint keys where violation is detectable.
 * Maps constraint value keywords to their known antonyms.
 * Only used for high-confidence violation detection — NOT for semantic analysis.
 */
const ANTONYM_PAIRS: Record<string, string[]> = {
  realistic: ["magical", "supernatural", "fantasy", "sci-fi", "sci_fi", "surreal"],
  magical: ["realistic", "grounded", "mundane"],
  fantasy: ["realistic", "contemporary", "modern-day"],
  "sci-fi": ["medieval", "historical", "fantasy"],
  sci_fi: ["medieval", "historical", "fantasy"],
  surreal: ["realistic", "grounded"],
  dark: ["lighthearted", "comedic", "whimsical", "cheerful"],
  lighthearted: ["dark", "grim", "bleak", "horror", "tragic"],
  comedic: ["tragic", "horror", "grim", "bleak"],
  horror: ["comedic", "lighthearted", "whimsical"],
};

/**
 * Conservative constraint compliance filter. Removes futures whose sketches
 * contain obvious antonyms of confirmed constraint values.
 *
 * This is deliberately conservative — it only catches clear violations where
 * a constraint value has known antonyms and the future sketch explicitly
 * uses one. Ambiguous cases are left in. The goal is to remove obvious
 * garbage without killing creative exploration.
 */
function filterConstraintViolations(
  map: DirectionMap,
  confirmedConstraints: Record<string, string>,
): DirectionMap {
  const constraintValues = Object.values(confirmedConstraints);
  if (constraintValues.length === 0) return map;

  // Build a set of antonym words that would violate confirmed constraints
  const violationWords = new Set<string>();
  for (const value of constraintValues) {
    const lowerValue = value.toLowerCase().trim();
    // Check each word in the constraint value against known antonym pairs
    for (const word of lowerValue.split(/[\s,;/]+/)) {
      const antonyms = ANTONYM_PAIRS[word];
      if (antonyms) {
        for (const a of antonyms) violationWords.add(a);
      }
    }
  }

  if (violationWords.size === 0) return map; // No detectable antonyms — skip filter

  let totalDropped = 0;
  const filteredFamilies = map.families
    .map(family => {
      const filteredFutures = family.futures.filter(future => {
        const sketchLower = future.sketch.toLowerCase();
        // A future is dropped only if its sketch contains a violation word
        // AND the violation word isn't a substring of a longer benign word
        for (const vw of violationWords) {
          // Word-boundary check: the violation word must appear as a standalone word
          const regex = new RegExp(`\\b${vw.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "i");
          if (regex.test(sketchLower)) {
            totalDropped++;
            return false;
          }
        }
        return true;
      });
      return { ...family, futures: filteredFutures };
    })
    .filter(family => family.futures.length > 0);

  if (totalDropped > 0) {
    console.log(`[DIVERGENCE] Constraint filter dropped ${totalDropped} futures, ${map.families.length - filteredFamilies.length} families emptied`);
  }

  return { ...map, families: filteredFamilies };
}
