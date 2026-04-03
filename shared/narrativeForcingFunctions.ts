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
  modes: GenerationMode[] | "all";
  stage: "premise" | "bible" | "both";
  constraint: string;
  rationale: string;   // for maintainer reference, not injected into prompts
}

const FORCING_FUNCTIONS: ForcingFunction[] = [
  // ── Erotica modes ─────────────────────────────────────────────
  {
    id: "ero_personal_desire",
    modes: ["erotica", "erotica-fast"],
    stage: "both",
    constraint: "Sexual or fetish content MUST be driven by personal desire, attraction, or curiosity between specific characters — not by systemic worldbuilding justification (no 'society requires it', no 'ritual demands it', no 'biological necessity').",
    rationale: "LLMs wrap kink in systemic justification to avoid seeming to endorse personal desire. Observed in 5/5 test stories.",
  },
  {
    id: "ero_personal_agency",
    modes: ["erotica", "erotica-fast"],
    stage: "premise",
    constraint: "Characters who want each other should pursue that want through personal agency — not wait for institutional permission, cultural ritual, or plot-mandated proximity.",
    rationale: "Attractor pattern: elaborate permission structures before characters can act on desire.",
  },
  {
    id: "ero_spontaneous_encounter",
    modes: ["erotica", "erotica-fast"],
    stage: "bible",
    constraint: "At least one sexual or intimate encounter must arise from spontaneous mutual desire, not from plot-mandated proximity, forced circumstances, or ceremonial obligation.",
    rationale: "Every erotica story had encounters triggered by external plot mechanisms, never by characters simply wanting each other.",
  },
  {
    id: "ero_character_depth",
    modes: ["erotica", "erotica-fast"],
    stage: "bible",
    constraint: "Every character MUST have at least one strong want, fear, or goal that has NOTHING to do with sex or the fetish. A mechanic who takes pride in his work. A soldier ashamed of a past failure. A con artist with a debt to repay. These non-sexual dimensions must drive at least 2-3 plot beats and create conflict that isn't resolved through sex.",
    rationale: "Bottom-scoring erotica stories (3.5-4.5/10) had characters whose only trait was fetish desire. Top-scoring story (7/10, bathhouse) had characters with jobs, social dynamics, and non-sexual motivations.",
  },
  {
    id: "ero_scene_variety",
    modes: ["erotica", "erotica-fast"],
    stage: "bible",
    constraint: "At least 2-3 scenes must function as CHARACTER scenes first and erotic scenes second. Comedy, argument, negotiation, vulnerability, professional conflict — scenes where the erotic element is present but not the primary activity. A story where every scene is a worship scene becomes monotonous regardless of quality.",
    rationale: "Stories 2,4,5 had zero non-fetish scenes and scored 3.5-4.5/10. Stories 1,3 had comedy/social scenes and scored 6.5-7/10.",
  },
  {
    id: "ero_dom_personality",
    modes: ["erotica", "erotica-fast"],
    stage: "bible",
    constraint: "Dominant characters MUST have personality beyond dominance. They should have humor, preferences, contradictions, moments of gentleness or uncertainty. A dom who only says 'Kneel' and 'Deeper' is not a character — give them dry wit, specific tastes, a backstory that informs HOW they dominate.",
    rationale: "4/5 dom characters across test stories were interchangeable command-machines. The one exception (Behrouz, bathhouse) was the best character in the batch.",
  },

  // ── Default mode ──────────────────────────────────────────────
  {
    id: "def_no_chosen_one",
    modes: ["default"],
    stage: "premise",
    constraint: "The protagonist's importance comes from their choices and actions, not from being uniquely chosen, prophesied, or inherently special.",
    rationale: "Chosen One is a massive LLM attractor pattern across all genres.",
  },
  {
    id: "def_no_rebellion_default",
    modes: ["default"],
    stage: "premise",
    constraint: "The central conflict must NOT default to 'protagonist rebels against oppressive institution.' Explore other conflict shapes: interpersonal, ideological, self-vs-self, mystery, survival, competition, creative tension.",
    rationale: "Rebellion-against-institution was the default plot in 80%+ of generated stories.",
  },

  // ── All modes ─────────────────────────────────────────────────
  {
    id: "all_show_dont_explain",
    modes: "all",
    stage: "bible",
    constraint: "The antagonist reveals their reasoning through action and reaction, not through explanatory monologue. Their philosophy is shown, not declared.",
    rationale: "LLMs give antagonists expository speeches instead of showing their worldview through behavior.",
  },
  {
    id: "all_varied_conflict",
    modes: "all",
    stage: "premise",
    constraint: "If the setting involves an institution, the protagonist's relationship to it must be more complex than simple opposition. Consider complicity, reform from within, reluctant enforcement, or genuine belief in a flawed system.",
    rationale: "Nuanced institutional relationships are more interesting than default rebellion.",
  },
  {
    id: "all_no_discovery_default",
    modes: "all",
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
      (f.modes === "all" || f.modes.includes(effectiveMode)) &&
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
