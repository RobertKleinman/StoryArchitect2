// ─── HookClarifier ───

export interface HookClarifierOption {
  id: string;        // "A" | "B" | "C" | "D" | "E"
  label: string;     // max ~60 chars
}

export interface HookStateUpdate {
  hook_engine?: string;
  stakes?: string;
  taboo_or_tension?: string;
  opening_image_seed?: string;
  setting_anchor?: string;
  protagonist_role?: string;
  antagonist_form?: string;
  tone_chips?: string[];
  bans?: string[];
}

export interface HookClarifierResponse {
  hypothesis_line: string;
  question: string;
  options: HookClarifierOption[];
  allow_free_text: boolean;
  ready_for_hook: boolean;
  missing_signal: string;
  state_update: HookStateUpdate;
}

// ─── HookBuilder ───

export interface CollisionSource {
  source: string;
  element_extracted: string;
}

export interface HookBuilderOutput {
  premise: string;
  opening_image: string;
  page_1_splash_prompt: string;
  page_turn_trigger: string;
  why_addictive: [string, string, string];
  collision_sources: CollisionSource[];
}

// ─── HookJudge ───

export interface HookJudgeScores {
  specificity: number;
  drawability: number;
  page_turn: number;
  mechanism: number;
  freshness: number;
}

export interface HookJudgeOutput {
  pass: boolean;
  hard_fail_reasons: string[];
  scores: HookJudgeScores;
  most_generic_part: string;
  one_fix_instruction: string;
}

// ─── HookPack (module handoff) ───

export interface HookPack {
  module: "hook";
  locked: {
    premise: string;
    page1_splash: string;
    page_turn_trigger: string;
    core_engine: {
      hook_engine: string;
      stakes: string;
      taboo_or_tension: string;
      protagonist_role: string;
      antagonist_form: string;
      setting_anchor: string;
    };
  };
  preferences: {
    tone_chips: string[];
    bans: string[];
  };
  source_dna: CollisionSource[];
  open_threads: string[];
  state_summary: string;
}

// ─── Session state ───

export interface HookSessionState {
  projectId: string;
  seedInput: string;
  turns: HookTurn[];
  currentState: HookStateUpdate;
  revealedHook?: HookBuilderOutput;
  revealedJudge?: HookJudgeOutput;
  hookPack?: HookPack;
  rerollCount: number;
  status: "clarifying" | "generating" | "revealed" | "locked";
}

export interface HookTurn {
  turnNumber: number;
  clarifierResponse: HookClarifierResponse;
  userSelection: {
    type: "option" | "free_text" | "surprise_me";
    optionId?: string;   // "A", "B", etc. — set when type is "option"
    label: string;       // display text: option label, free text, or "surprise_me"
  } | null;
}
