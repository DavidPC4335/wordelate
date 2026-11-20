import { cosine, applyOp } from "./vector.js";
import { isBannedOperand } from "./stem.js";

export type Move = { op: "+" | "-" | "undo"; word?: string };

export type VectorFor = (
  word: string,
) => Float32Array | null | undefined;

export type ReplayInput = {
  /** Initial position. Copied; the input array is not mutated. */
  start: Float32Array;
  /** Goal vector. Similarity is cosine(position, goal). Not mutated. */
  goal: Float32Array;
  /** Surface form of the start word. It is not an operand. */
  startWord: string;
  /** Surface form of the goal word. Banned as an operand. */
  goalWord: string;
  moves: readonly Move[];
  /** Lookup for operand words. Called with a lowercased word. Null or undefined means unknown. */
  vectorFor: VectorFor;
  banned: readonly string[];
  maxMoves: number;
};

export type ReplaySuccess = {
  ok: true;
  position: Float32Array;
  movesUsed: number;
  equationWords: string[];
  similarity: number;
};

export type ReplayFailure = {
  ok: false;
  error: string;
};

export type ReplayResult = ReplaySuccess | ReplayFailure;

type Applied = { op: "+" | "-"; word: string };

function fail(error: string): ReplayFailure {
  return { ok: false, error };
}

export function replay(input: ReplayInput): ReplayResult {
  const { start, goal, startWord, goalWord, moves, vectorFor, banned, maxMoves } =
    input;
  if (start.length !== goal.length) {
    return fail("Vector length mismatch");
  }

  let position: Float32Array = new Float32Array(start);
  const undoStack: Float32Array[] = [];
  const equation: Applied[] = [];
  let movesUsed = 0;

  for (const move of moves) {
    if (movesUsed + 1 > maxMoves) return fail("Move limit exceeded");

    if (move.op === "undo") {
      if (equation.length === 0) return fail("Nothing to undo");
      const previous = undoStack.pop();
      equation.pop();
      if (previous === undefined) return fail("Nothing to undo");
      position = previous;
      movesUsed += 1;
      continue;
    }

    if (move.op !== "+" && move.op !== "-") return fail("Invalid operation");
    const raw = move.word;
    if (raw === undefined || raw.length === 0) return fail("Missing word");
    const word = raw.toLowerCase();

    const vector = vectorFor(word);
    if (vector == null) return fail("Unknown word");
    if (vector.length !== position.length) return fail("Vector length mismatch");
    if (isBannedOperand(word, startWord, goalWord, banned)) {
      return fail("Banned operand");
    }
    if (equation.some((step) => step.word === word)) {
      return fail("Word already used");
    }

    undoStack.push(position);
    position = applyOp(position, vector, move.op);
    equation.push({ op: move.op, word });
    movesUsed += 1;
  }

  return {
    ok: true,
    position,
    movesUsed,
    equationWords: equation.map((step) => step.word),
    similarity: cosine(position, goal),
  };
}

export function isWin(similarity: number, threshold: number): boolean {
  return similarity >= threshold;
}
