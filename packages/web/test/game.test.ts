import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isWin } from "@wordelate/game-math";
import { describe, expect, it } from "vitest";
import { commitMove, countsAsWin, hereAtPosition, shareText, WIN_SIMILARITY } from "../src/lib/game.js";
import { parsePuzzleFile } from "../src/lib/puzzles.js";

const puzzleFile = resolve(dirname(fileURLToPath(import.meta.url)), "../public/puzzles.json");

describe("win line", () => {
  it("treats 0.95 as a win and 0.949 as short", () => {
    expect(isWin(0.95, 0.95)).toBe(true);
    expect(isWin(0.949, 0.95)).toBe(false);
  });

  it("turns 0.712 into a win when the line drops from 0.95 to 0.70", () => {
    expect(isWin(0.712, 0.95)).toBe(false);
    expect(isWin(0.712, 0.7)).toBe(true);
  });

  it("reports the start word on a fresh position and counts the goal word as a win below 0.75", () => {
    expect(WIN_SIMILARITY).toBe(0.75);
    expect(hereAtPosition({ startWord: "king", equationWords: [], nearest: "kings" })).toBe("king");
    expect(hereAtPosition({ startWord: "walk", equationWords: [], nearest: "walking" })).toBe("walk");
    expect(hereAtPosition({ startWord: "king", equationWords: ["woman"], nearest: "queen" })).toBe(
      "queen",
    );
    expect(countsAsWin({ similarity: 0.71, hereWord: "queen", goalWord: "queen" })).toBe(true);
    expect(countsAsWin({ similarity: 0.71, hereWord: "Queen", goalWord: "queen" })).toBe(true);
    expect(countsAsWin({ similarity: 0.71, hereWord: "king", goalWord: "queen" })).toBe(false);
    expect(countsAsWin({ similarity: 0.75, hereWord: "royalty", goalWord: "queen" })).toBe(true);
  });
});

describe("puzzles", () => {
  it("lists all 10 puzzles with king → queen first", () => {
    const puzzles = parsePuzzleFile(JSON.parse(readFileSync(puzzleFile, "utf8")));
    expect(puzzles.map((puzzle) => puzzle.id)).toEqual([
      "king-queen",
      "uncle-aunt",
      "brother-sister",
      "prince-princess",
      "father-mother",
      "boy-girl",
      "man-woman",
      "dog-puppy",
      "cat-kitten",
      "good-bad",
    ]);
    expect(puzzles[0]?.start).toBe("king");
    expect(puzzles[0]?.goal).toBe("queen");
  });
});

describe("share text", () => {
  it("omits operand words", () => {
    const text = shareText({
      start: "king",
      goal: "queen",
      movesUsed: 2,
      similarity: 0.71199,
    });
    expect(text).toBe("Wordelate king→queen · 2/16 · 71.2%");
    expect(text.includes("man")).toBe(false);
    expect(text.includes("woman")).toBe(false);
  });
});

describe("moves", () => {
  it("rejects a repeated word", () => {
    const start = new Float32Array([1, 0, 0]);
    const goal = new Float32Array([0, 1, 0]);
    const cat = new Float32Array([0, 1, 0]);
    const input = {
      start,
      goal,
      startWord: "alpha",
      goalWord: "beta",
      moves: [],
      vectorFor: (word: string) => (word === "cat" ? cat : null),
      banned: [],
      maxMoves: 16,
    };
    const first = commitMove(input, { op: "+", word: "cat" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = commitMove({ ...input, moves: first.moves }, { op: "-", word: "cat" });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toBe("Word already used");
  });
});
