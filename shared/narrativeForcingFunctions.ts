/**
 * NARRATIVE FORCING FUNCTIONS
 * ===========================
 * Mode-specific positive constraints injected at premise/bible stage.
 * Framed as mandatory positive actions, not prohibitions.
 *
 * Grown empirically from observed attractor patterns in generated stories.
 * Cap at 7 per mode+stage combo.
 */

import type { GenerationMode } from "./types/project";

interface ForcingFunction {
  id: string;
  mode: GenerationMode | "all";
  stage: "premise" | "bible" | "both";
  constraint: string;
  rationale: string;   // for maintainer reference, not injected into prompts
}

const FORCING_FUNCTIONS: ForcingFunction[] = [
  // ── Erotica modes ─────────────────────────────────────────────
  {
    id: "ero_personal_desire",
    mode: "erotica",
    stage: "both",
    constraint: "Sexual or fetish content MUST be driven by personal desire, attraction, or curiosity between specific characters — not by systemic worldbuilding justification (no 'society requires it', no 'ritual demands it', no 'biological necessity').",
    rationale: "LLMs wrap kink in systemic justification to avoid seeming to endorse personal desire. Observed in 5/5 test stories.",
  },
  {
    id: "ero_personal_desire_fast",
    mode: "erotica-fast",
    stage: "both",
    constraint: "Sexual or fetish content MUST be driven by personal desire, attraction, or curiosity between specific characters — not by systemic worldbuilding justification (no 'society requires it', no 'ritual demands it', no 'biological necessity').",
    rationale: "Same pattern in erotica-fast mode.",
  },
  {
    id: "ero_personal_agency",
    mode: "erotica",
    stage: "premise",
    constraint: "Characters who want each other should pursue that want through personal agency — not wait for institutional permission, cultural ritual, or plot-mandated proximity.",
    rationale: "Attractor pattern: elaborate permission structures before characters can act on desire.",
  },
  {
    id: "ero_personal_agency_fast",
    mode: "erotica-fast",
    stage: "premise",
    constraint: "Characters who want each other should pursue that want through personal agency — not wait for institutional permission, cultural ritual, or plot-mandated proximity.",
    rationale: "Same pattern in erotica-fast mode.",
  },
  {
    id: "ero_spontaneous_encounter",
    mode: "erotica",
    stage: "bible",
    constraint: "At least one sexual or intimate encounter must arise from spontaneous mutual desire, not from plot-mandated proximity, forced circumstances, or ceremonial obligation.",
    rationale: "Every erotica story had encounters triggered by external plot mechanisms, never by characters simply wanting each other.",
  },
  {
    id: "ero_spontaneous_encounter_fast",
    mode: "erotica-fast",
    stage: "bible",
    constraint: "At least one sexual or intimate encounter must arise from spontaneous mutual desire, not from plot-mandated proximity, forced circumstances, or ceremonial obligation.",
    rationale: "Same pattern in erotica-fast mode.",
  },

  // ── Default mode ──────────────────────────────────────────────
  {
    id: "def_no_chosen_one",
    mode: "default",
    stage: "premise",
    constraint: "The protagonist's importance comes from their choices and actions, not from being uniquely chosen, prophesied, or inherently special.",
    rationale: "Chosen One is a massive LLM attractor pattern across all genres.",
  },
  {
    id: "def_no_rebellion_default",
    mode: "default",
    stage: "premise",
    constraint: "The central conflict must NOT default to 'protagonist rebels against oppressive institution.' Explore other conflict shapes: interpersonal, ideological, self-vs-self, mystery, survival, competition, creative tension.",
    rationale: "Rebellion-against-institution was the default plot in 80%+ of generated stories.",
  },

  // ── All modes ─────────────────────────────────────────────────
  {
    id: "all_show_dont_explain",
    mode: "all",
    stage: "bible",
    constraint: "The antagonist reveals their reasoning through action and reaction, not through explanatory monologue. Their philosophy is shown, not declared.",
    rationale: "LLMs give antagonists expository speeches instead of showing their worldview through behavior.",
  },
  {
    id: "all_varied_conflict",
    mode: "all",
    stage: "premise",
    constraint: "If the setting involves an institution, the protagonist's relationship to it must be more complex than simple opposition. Consider complicity, reform from within, reluctant enforcement, or genuine belief in a flawed system.",
    rationale: "Nuanced institutional relationships are more interesting than default rebellion.",
  },
  {
    id: "all_no_discovery_default",
    mode: "all",
    stage: "bible",
    constraint: "At least half the story's escalation must come from INTERNAL sources (self-sabotage, desire outpacing comfort, identity confrontation, vulnerability, commitment escalation) rather than external discovery or third-party interference. Characters should create their own problems.",
    rationale: "'Someone almost catches them' appeared as the primary escalation in 6/6 test stories. Internal escalation is more interesting.",
  },
];

/**
 * Get forcing function constraint strings for a given mode and pipeline stage.
 * Returns constraints matching the mode (or "all") and the stage (or "both").
 * Capped at 7 to prevent prompt bloat.
 */
export function getForcingFunctions(mode: GenerationMode | undefined, stage: "premise" | "bible"): string[] {
  const effectiveMode = mode ?? "default";
  return FORCING_FUNCTIONS
    .filter(f =>
      (f.mode === effectiveMode || f.mode === "all") &&
      (f.stage === stage || f.stage === "both"),
    )
    .map(f => f.constraint)
    .slice(0, 7);
}

/**
 * Format forcing functions into a prompt block.
 * Returns empty string if no constraints apply.
 */
export function formatForcingBlock(constraints: string[]): string {
  if (constraints.length === 0) return "";
  const lines = [
    "NARRATIVE CONSTRAINTS (mandatory — these override default instincts):",
    ...constraints.map((c, i) => `${i + 1}. ${c}`),
  ];
  return lines.join("\n");
}
