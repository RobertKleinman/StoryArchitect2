/**
 * Shared background work throttling logic.
 *
 * Determines whether consolidation and divergence exploration should fire
 * after a clarifier turn. Used by hookService, characterService, and worldService.
 *
 * Extracted to avoid duplicating the same decision logic (and the same bugs)
 * across every module service.
 */

import type { UserPsychologyLedger } from "../../shared/types/userPsychology";

/**
 * Minimal turn shape — works with HookTurn, CharacterTurn, WorldTurn, PlotTurn.
 * We only need the fields relevant to throttling decisions.
 */
export interface ThrottlingTurnInfo {
  turnNumber: number;
  userSelection?: { type: string } | null;
}

/**
 * Minimal previous-turn shape — we only check if any assumption was changed.
 */
export interface ThrottlingPrevTurnInfo {
  assumptionResponses?: Array<{ action: string }> | null;
}

/**
 * Minimal session shape for throttling decisions.
 */
export interface ThrottlingSessionInfo {
  turns: Array<{ assumptionResponses?: Array<{ action: string }> | null }>;
  psychologyLedger?: UserPsychologyLedger | null;
}

/**
 * Determine whether background consolidation should fire after this turn.
 *
 * Fires when:
 *   - User typed free text (strong signal of engagement)
 *   - Previous turn had assumption changes (not just "keep")
 *   - Every 5th turn as a fallback cadence
 *   - Signal store has accumulated 5+ signals since last consolidation
 */
export function shouldConsolidate(
  turn: ThrottlingTurnInfo,
  session: ThrottlingSessionInfo,
): boolean {
  const prevTurn: ThrottlingPrevTurnInfo | null =
    session.turns.length >= 2 ? session.turns[session.turns.length - 2] : null;

  const hasSignals =
    session.psychologyLedger &&
    session.psychologyLedger.signalStore &&
    session.psychologyLedger.signalStore.length > 0;

  if (!hasSignals) return false;

  const meaningfulInput =
    turn.userSelection?.type === "free_text";

  const assumptionChanged =
    prevTurn?.assumptionResponses?.some(r => r.action !== "keep") ?? false;

  const cadenceFallback =
    turn.turnNumber % 5 === 0;

  const signalBacklog =
    (session.psychologyLedger?.signalStore?.length ?? 0) -
    (session.psychologyLedger?.lastConsolidation?.afterTurn ?? 0) >= 5;

  return meaningfulInput || assumptionChanged || cadenceFallback || signalBacklog;
}

/**
 * Determine whether background divergence exploration should fire after this turn.
 *
 * Fires when:
 *   - User typed free text
 *   - Previous turn had assumption changes
 *   - Every 4th turn as a fallback cadence
 *
 * Also requires at least 2 turns to have passed (need some context before diverging).
 */
export function shouldDiverge(
  turn: ThrottlingTurnInfo,
  session: ThrottlingSessionInfo,
): boolean {
  if (turn.turnNumber < 2) return false;

  const prevTurn: ThrottlingPrevTurnInfo | null =
    session.turns.length >= 2 ? session.turns[session.turns.length - 2] : null;

  const meaningfulInput =
    turn.userSelection?.type === "free_text";

  const assumptionChanged =
    prevTurn?.assumptionResponses?.some(r => r.action !== "keep") ?? false;

  const cadenceFallback =
    turn.turnNumber % 4 === 0;

  return meaningfulInput || assumptionChanged || cadenceFallback;
}

/**
 * Determine whether cultural research should fire after this turn.
 * Lighter cadence than consolidation/divergence — every 3rd turn or on free text.
 */
export function shouldResearchCulture(
  turn: ThrottlingTurnInfo,
  _session: ThrottlingSessionInfo,
): boolean {
  if (turn.turnNumber < 2) return false;
  const meaningfulInput = turn.userSelection?.type === "free_text";
  const cadenceFallback = turn.turnNumber % 3 === 0;
  return meaningfulInput || cadenceFallback;
}
