import { replay } from "@wordelate/game-math";
import type { BoardAnswer, BoardStep } from "../lib/standings.js";
import { LABEL_NEAR_DUPLICATE_CUTOFF, LABEL_WARM_SIMILARITY, MAX_MOVES, countsAsWin, hereAtPosition } from "../lib/game.js";
import { nearestLabels, rowFor } from "../lib/pack.js";
import type { Pack } from "../lib/pack.js";
import type { Puzzle } from "../lib/puzzles.js";
import { scoreForMoves } from "../lib/storage.js";

/**
 * Replay the submitted equation and accept it only when the same nearest-word
 * rule the page uses calls it a win. The score is the move count, computed here.
 */
export async function verifySolution(
  pack: Pack,
  puzzle: Puzzle,
  steps: readonly BoardStep[],
): Promise<{ score: number; moves: number; answer: BoardAnswer } | null> {
  if (steps.length < 1 || steps.length > MAX_MOVES) return null;
  const start = rowFor(pack, puzzle.start);
  const goal = rowFor(pack, puzzle.goal);
  if (!start || !goal) return null;
  const played = replay({
    start,
    goal,
    startWord: puzzle.start,
    goalWord: puzzle.goal,
    moves: steps.map((step) => ({ op: step.op, word: step.word })),
    vectorFor: (word) => rowFor(pack, word),
    banned: [],
    maxMoves: MAX_MOVES,
  });
  if (!played.ok || played.equationWords.length < 1 || played.scoredSteps.length < 1) return null;
  const anchors = [{ word: puzzle.start, vector: start }];
  for (const word of played.equationWords) {
    const vector = rowFor(pack, word);
    if (!vector) return null;
    anchors.push({ word, vector });
  }
  const labels = await nearestLabels(
    pack,
    played.position,
    anchors,
    puzzle.goal,
    LABEL_NEAR_DUPLICATE_CUTOFF,
    played.similarity,
    LABEL_WARM_SIMILARITY,
    { blocking: true },
  );
  const here = hereAtPosition({
    startWord: puzzle.start,
    equationWords: played.equationWords,
    nearest: labels[0] ?? null,
  });
  const won = countsAsWin({
    similarity: played.similarity,
    hereWord: here,
    goalWord: puzzle.goal,
    movesUsed: played.equationWords.length,
    acceptedWords: puzzle.accepted,
  });
  if (!won) return null;
  const moves = played.scoredSteps.length;
  if (steps.length !== moves) return null;
  for (let i = 0; i < moves; i++) {
    const scored = played.scoredSteps[i];
    const sent = steps[i];
    if (!scored || !sent || scored.word !== sent.word || scored.op !== sent.op) return null;
  }
  return {
    score: scoreForMoves(moves),
    moves,
    answer: {
      puzzleId: puzzle.id,
      start: puzzle.start,
      goal: puzzle.goal,
      steps: played.scoredSteps.map((step) => ({ op: step.op, word: step.word })),
    },
  };
}
