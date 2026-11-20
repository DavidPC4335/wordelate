import { describe, expect, it } from "vitest";
import { cosine, isWin, replay } from "../src/index.js";
import type { Move } from "../src/index.js";

const start = new Float32Array([1, 0, 0]);
const goal = new Float32Array([0, 1, 0]);
const cat = new Float32Array([0, 1, 0]);
const dog = new Float32Array([0, 0, 1]);

const vectors: Record<string, Float32Array> = {
  alpha: start,
  beta: goal,
  cat,
  dog,
  start: new Float32Array([0.2, 0.3, 0.4]),
  star: new Float32Array([0.5, 0, 0]),
};

function vectorFor(word: string): Float32Array | null {
  return vectors[word] ?? null;
}

function play(moves: Move[], maxMoves = 16) {
  return replay({
    start,
    goal,
    startWord: "alpha",
    goalWord: "beta",
    moves,
    vectorFor,
    banned: [],
    maxMoves,
  });
}

describe("replay", () => {
  it("counts undo as a move and restores the position", () => {
    const startCopy = Array.from(start);
    const result = play([
      { op: "+", word: "cat" },
      { op: "undo" },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.movesUsed).toBe(2);
    expect(result.equationWords).toEqual([]);
    expect(result.scoredSteps).toEqual([
      { op: "+", word: "cat" },
      { op: "-", word: "cat" },
    ]);
    expect(Array.from(result.position)).toEqual([1, 0, 0]);
    expect(result.similarity).toBe(cosine(start, goal));
    expect(Array.from(start)).toEqual(startCopy);
  });

  it("rejects a second use of a word that is still on the equation", () => {
    const result = play([
      { op: "+", word: "cat" },
      { op: "+", word: "cat" },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("Word already used");
  });

  it("records the inverse of the last step as an undo", () => {
    const result = play([
      { op: "+", word: "cat" },
      { op: "-", word: "cat" },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.movesUsed).toBe(2);
    expect(result.equationWords).toEqual([]);
    expect(result.scoredSteps).toEqual([
      { op: "+", word: "cat" },
      { op: "-", word: "cat" },
    ]);
    expect(Array.from(result.position)).toEqual([1, 0, 0]);
  });

  it("allows the same word again after it has been undone", () => {
    const result = play([
      { op: "+", word: "cat" },
      { op: "undo" },
      { op: "+", word: "cat" },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.movesUsed).toBe(3);
    expect(result.equationWords).toEqual(["cat"]);
    expect(result.scoredSteps).toEqual([
      { op: "+", word: "cat" },
      { op: "-", word: "cat" },
      { op: "+", word: "cat" },
    ]);
    expect(Array.from(result.position)).toEqual([1, 1, 0]);
  });

  it("rejects unknown words, banned operands, and a 17th event", () => {
    const unknown = play([{ op: "+", word: "nope" }]);
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error).toBe("Unknown word");

    const banned = play([{ op: "+", word: "alpha" }]);
    expect(banned.ok).toBe(false);
    if (!banned.ok) expect(banned.error).toBe("Banned operand");

    const goalMove = play([{ op: "-", word: "beta" }]);
    expect(goalMove.ok).toBe(false);

    const moves: Move[] = [];
    for (let i = 0; i < 17; i++) {
      moves.push(i % 2 === 0 ? { op: "+", word: "cat" } : { op: "undo" });
    }
    const limited = play(moves, 16);
    expect(limited.ok).toBe(false);
    if (!limited.ok) expect(limited.error).toBe("Move limit exceeded");
  });

  it("does not ban a one-letter extension that is not a listed suffix", () => {
    const result = replay({
      start: vectors.star ?? new Float32Array(),
      goal,
      startWord: "star",
      goalWord: "beta",
      moves: [{ op: "+", word: "start" }],
      vectorFor: (word) =>
        word === "start" ? new Float32Array([0, 0, 1]) : vectorFor(word),
      banned: ["mice"],
      maxMoves: 16,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.equationWords).toEqual(["start"]);
    expect(result.movesUsed).toBe(1);
  });

  it("reports cosine of the final position against the goal", () => {
    const result = play([{ op: "+", word: "dog" }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const expected = cosine(new Float32Array([1, 0, 1]), goal);
    expect(result.similarity).toBe(expected);
    expect(result.equationWords).toEqual(["dog"]);
  });

  it("rejects undo when the equation is empty", () => {
    const result = play([{ op: "undo" }]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("Nothing to undo");
  });
});

describe("isWin", () => {
  it("wins at the threshold and loses below it", () => {
    expect(isWin(0.55, 0.55)).toBe(true);
    expect(isWin(0.5500001, 0.55)).toBe(true);
    expect(isWin(0.549999, 0.55)).toBe(false);
    expect(isWin(1, 0.55)).toBe(true);
    expect(isWin(0, 0.55)).toBe(false);
  });
});
