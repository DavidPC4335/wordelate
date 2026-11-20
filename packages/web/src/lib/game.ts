import { isWin, replay } from "@wordelate/game-math";
import type { Move, ReplaySuccess, VectorFor } from "@wordelate/game-math";

export const MAX_MOVES = 16;

export type AppliedStep = { op: "+" | "-"; word: string };

export type PlayInput = {
  start: Float32Array;
  goal: Float32Array;
  startWord: string;
  goalWord: string;
  moves: readonly Move[];
  vectorFor: VectorFor;
  banned: readonly string[];
  maxMoves: number;
};

export type CommitResult =
  | { ok: true; moves: Move[]; result: ReplaySuccess }
  | { ok: false; error: string };

export function formatPercent(similarity: number): string {
  return (similarity * 100).toFixed(1);
}

/** Share line. Operand words are not part of the text. */
export function shareText(input: {
  start: string;
  goal: string;
  movesUsed: number;
  similarity: number;
}): string {
  const percent = formatPercent(input.similarity);
  return `Wordelate ${input.start}→${input.goal} · ${input.movesUsed}/${MAX_MOVES} · ${percent}%`;
}

/** Hidden similarity threshold. Not shown, and not read from the query or storage. */
export const WIN_SIMILARITY = 0.75;

/** Hide a label this close to the start word or any single operand. Not shown. */
export const LABEL_NEAR_DUPLICATE_CUTOFF = 0.7;

/** At or above this similarity to the goal, show three labels instead of one. Not shown. */
export const LABEL_WARM_SIMILARITY = 0.45;

export function positionWins(similarity: number): boolean {
  return isWin(similarity, WIN_SIMILARITY);
}

/**
 * Win when similarity reaches the hidden threshold, or when the word shown
 * as "You are here" is the goal. The landing word counts even below the threshold.
 */
export function countsAsWin(input: {
  similarity: number;
  hereWord: string | null;
  goalWord: string;
}): boolean {
  if (positionWins(input.similarity)) return true;
  const here = input.hereWord?.trim().toLowerCase() ?? "";
  if (here.length === 0) return false;
  return here === input.goalWord.trim().toLowerCase();
}

/**
 * With no operands left on the equation, the position is the start word's vector.
 * Report that word even if a neighbor would otherwise win the scan.
 */
export function hereAtPosition(input: {
  startWord: string;
  equationWords: readonly string[];
  nearest: string | null;
}): string | null {
  if (input.equationWords.length === 0) {
    const start = input.startWord.trim();
    return start.length > 0 ? start : null;
  }
  return input.nearest;
}

/**
 * Once the position counts as a win, the goal is "You are here" even if
 * another vocab word is slightly closer. Callers keep a fresh start as the
 * start word instead of using this substitution.
 */
export function hereLabel(won: boolean, goal: string, nearest: string | null): string | null {
  if (won) return goal;
  return nearest;
}

export function appliedSteps(moves: readonly Move[]): AppliedStep[] {
  const stack: AppliedStep[] = [];
  for (const move of moves) {
    if (move.op === "undo") {
      stack.pop();
      continue;
    }
    const word = move.word?.trim().toLowerCase() ?? "";
    if ((move.op === "+" || move.op === "-") && word.length > 0) {
      stack.push({ op: move.op, word });
    }
  }
  return stack;
}

export function formatEquation(start: string, steps: readonly AppliedStep[]): string {
  let text = start;
  for (const step of steps) {
    const sign = step.op === "+" ? "+" : "−";
    text += ` ${sign} ${step.word}`;
  }
  return text;
}

export function describeMoveError(error: string): string {
  switch (error) {
    case "Unknown word":
      return "That word isn’t in the vocabulary.";
    case "Banned operand":
      return "You can’t use the start word, the goal, or an obvious variant.";
    case "Word already used":
      return "That word is already in the equation.";
    case "Move limit exceeded":
      return "You’ve used all 16 moves.";
    case "Nothing to undo":
      return "Nothing to undo.";
    case "Missing word":
      return "Type a word first.";
    default:
      return error;
  }
}

function normalizeMove(move: Move): Move {
  if (move.op === "undo") return { op: "undo" };
  return { op: move.op, word: (move.word ?? "").trim().toLowerCase() };
}

/** Validate one more move with replay(), which also enforces undo and bans. */
export function commitMove(input: PlayInput, move: Move): CommitResult {
  const next = normalizeMove(move);
  if (next.op !== "undo" && (next.word === undefined || next.word.length === 0)) {
    return { ok: false, error: "Missing word" };
  }
  const moves = [...input.moves, next];
  const result = replay({ ...input, moves });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, moves, result };
}

export function playMoves(input: PlayInput) {
  return replay(input);
}
