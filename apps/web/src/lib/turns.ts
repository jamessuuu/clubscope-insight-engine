import { once } from './once';
import {
  getTurn,
  runScriptedTurn,
  SCRIPTED_TURNS,
  SUGGESTED_TURNS,
} from '@clubscope/core/assistant';
import type { ScriptedTurn } from '@clubscope/core/assistant';
import { TOOL_REGISTRY } from '@clubscope/core/tools';
import { club } from './club';
import { forClient } from './receipts';
import type { TurnPayload } from './types';

export { SCRIPTED_TURNS, SUGGESTED_TURNS, getTurn };
export type { ScriptedTurn };

function toPayload(turn: ScriptedTurn): TurnPayload {
  const result = runScriptedTurn({
    turn,
    dataset: club(),
    tools: TOOL_REGISTRY,
  });

  return {
    turnId: turn.id,
    question: turn.question,
    topic: turn.topic,
    status: result.status,
    segments: result.segments,
    verification: result.verification,
    toolCalls: result.toolCalls,
    proposedActions: result.proposedActions,
    evidence: forClient(result.evidence),
    servedBy: result.servedBy,
    totalMs: result.totalMs,
    refusal: turn.refusal === true,
  };
}

/** Runs one scripted turn by id. Returns null for an unknown id rather than guessing. */
export function runTurn(turnId: string): TurnPayload | null {
  const turn = getTurn(turnId);
  return turn ? toPayload(turn) : null;
}

/**
 * Every scripted turn, executed.
 *
 * The reliability page runs the whole set on each render rather than reading a stored
 * results file. A pass rate copied from a spreadsheet proves nothing; a pass rate the page
 * had to earn against live tool execution, thirty seconds ago, is the only version of that
 * claim worth showing.
 */
export function allTurnResults(): TurnResult[] {
  return SCRIPTED_TURNS.map((turn) => ({ turn, payload: toPayload(turn) }));
}

export interface TurnResult {
  turn: ScriptedTurn;
  payload: TurnPayload;
}

export const suggestedTurns = once((): ScriptedTurn[] => [...SUGGESTED_TURNS]);

export interface ReliabilitySummary {
  cases: number;
  figuresVerified: number;
  figuresBlocked: number;
  groundedRate: number;
  refusalCases: number;
  refusalsCorrect: number;
  recomputations: number;
  poisonedCases: number;
  poisonedCaught: number;
}

/**
 * A refusal case passes when the assistant declined *and* the verifier found nothing to
 * block — declining while still slipping an uncited figure into the apology is a fail, and
 * scoring it any other way would let the most common real failure through the eval.
 */
export function reliabilitySummary(results: readonly TurnResult[]): ReliabilitySummary {

  let figuresVerified = 0;
  let figuresBlocked = 0;
  let recomputations = 0;
  let refusalCases = 0;
  let refusalsCorrect = 0;
  let poisonedCases = 0;
  let poisonedCaught = 0;

  for (const { turn, payload } of results) {
    const v = payload.verification;
    figuresVerified += v.matchedCount;
    figuresBlocked += v.citedCount - v.matchedCount + v.undeclaredCount;
    recomputations += v.recomputedCount;

    if (turn.refusal) {
      refusalCases++;
      if (payload.status === 'answered') refusalsCorrect++;
    }
    if (turn.poison) {
      poisonedCases++;
      if (payload.status === 'blocked') poisonedCaught++;
    }
  }

  const totalFigures = figuresVerified + figuresBlocked;

  return {
    cases: results.length,
    figuresVerified,
    figuresBlocked,
    groundedRate: totalFigures === 0 ? 1 : figuresVerified / totalFigures,
    refusalCases,
    refusalsCorrect,
    recomputations,
    poisonedCases,
    poisonedCaught,
  };
}

/** The deliberately fabricated case, featured on the reliability page. */
export function poisonedResult(results: readonly TurnResult[]): TurnResult | null {
  return results.find(({ turn }) => turn.poison !== undefined) ?? null;
}
