import { replay, type Move, type VectorFor } from "@wordelate/game-math";
import { MAX_MOVES, type AppliedStep } from "./game.js";
import type { Point3 } from "./project.js";

export type PathDrawState = {
  start: Point3;
  goal: Point3;
  startWord: string;
  goalWord: string;
  path: readonly Point3[];
  /**
   * Labels drawn on the latest point.
   * [0] is the equation, or the start word before any move.
   * [1], when present, is the current nearest word under that line.
   */
  recentLabels: readonly string[];
  /** Latest point is the start vector, so that word is the large label. */
  atStart: boolean;
  /** Latest point has been drawn on the goal, because this position wins. */
  arrived: boolean;
};

/**
 * Positions from the start vector through each step still on the equation.
 * Undo shortens this sequence because `steps` is the applied equation, not the raw log.
 * Each sample comes from `replay`, the same sum the board uses.
 */
export function equationPositions(input: {
  start: Float32Array;
  goal: Float32Array;
  startWord: string;
  goalWord: string;
  steps: readonly AppliedStep[];
  vectorFor: VectorFor;
}): Float32Array[] {
  const positions: Float32Array[] = [];
  const moves: Move[] = [];
  for (let i = 0; i <= input.steps.length; i++) {
    const result = replay({
      start: input.start,
      goal: input.goal,
      startWord: input.startWord,
      goalWord: input.goalWord,
      moves,
      vectorFor: input.vectorFor,
      banned: [],
      maxMoves: MAX_MOVES,
    });
    if (!result.ok) break;
    positions.push(result.position);
    const step = input.steps[i];
    if (step === undefined) break;
    moves.push({ op: step.op, word: step.word });
  }
  return positions;
}
