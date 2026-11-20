import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isWin } from "@wordelate/game-math";
import { describe, expect, it } from "vitest";
import {
  commitMove,
  countsAsWin,
  hereAtPosition,
  progressTowardGoal,
  formatEquation,
  shareHtml,
  shareMessage,
  shareText,
  shareDate,
  WORD_ELATE_URL,
} from "../src/lib/game.js";
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

  it("reports the start word on a fresh position and wins only on the landing word after a move", () => {
    expect(hereAtPosition({ startWord: "king", equationWords: [], nearest: "kings" })).toBe("king");
    expect(hereAtPosition({ startWord: "walk", equationWords: [], nearest: "walking" })).toBe("walk");
    expect(hereAtPosition({ startWord: "king", equationWords: ["woman"], nearest: "queen" })).toBe(
      "queen",
    );
    expect(
      countsAsWin({ similarity: 0.837, hereWord: "king", goalWord: "queen", movesUsed: 0 }),
    ).toBe(false);
    expect(
      countsAsWin({ similarity: 1, hereWord: "queen", goalWord: "queen", movesUsed: 0 }),
    ).toBe(false);
    expect(
      countsAsWin({ similarity: 0.6, hereWord: "sushi", goalWord: "sushi", movesUsed: 3 }),
    ).toBe(true);
    expect(
      countsAsWin({ similarity: 0.71, hereWord: "Queen", goalWord: "queen", movesUsed: 1 }),
    ).toBe(true);
    expect(
      countsAsWin({
        similarity: 0.9,
        hereWord: "royalty",
        goalWord: "queen",
        movesUsed: 2,
        acceptedWords: [],
      }),
    ).toBe(false);
    expect(
      countsAsWin({
        similarity: 0.5,
        hereWord: "seafood",
        goalWord: "sushi",
        movesUsed: 2,
        acceptedWords: ["seafood"],
      }),
    ).toBe(true);
    expect(
      countsAsWin({
        similarity: 0.4,
        hereWord: "Seafood",
        goalWord: "sushi",
        movesUsed: 1,
        acceptedWords: ["SEAFOOD"],
      }),
    ).toBe(true);
    expect(
      countsAsWin({
        similarity: 0.536,
        hereWord: "airplanes",
        goalWord: "airplane",
        movesUsed: 1,
      }),
    ).toBe(true);
    expect(
      countsAsWin({ similarity: 0.536, hereWord: "wings", goalWord: "wing", movesUsed: 1 }),
    ).toBe(true);
    expect(
      countsAsWin({
        similarity: 0.5,
        hereWord: "seafoods",
        goalWord: "sushi",
        movesUsed: 1,
        acceptedWords: ["seafood"],
      }),
    ).toBe(true);
  });
});

describe("puzzles", () => {
  it("lists the easy puzzles first, then the longer ones", () => {
    const puzzles = parsePuzzleFile(JSON.parse(readFileSync(puzzleFile, "utf8")));
    expect(puzzles.map((puzzle) => puzzle.id)).toEqual([
      "paris-sushi",
      "mother-son",
      "apple-wine",
      "son-grandmother",
      "beach-ski",
      "sun-snow",
    ]);
    expect(puzzles.every((puzzle) => puzzle.par >= 3)).toBe(true);
    expect(puzzles[0]?.start).toBe("paris");
    expect(puzzles[0]?.goal).toBe("sushi");
  });
});

describe("progress meter", () => {
  it("starts at zero and fills the remaining gap", () => {
    expect(
      progressTowardGoal({ similarity: 0.837, startSimilarity: 0.837, won: false }),
    ).toBe(0);
    expect(
      progressTowardGoal({ similarity: 0.9, startSimilarity: 0.8, won: false }),
    ).toBeCloseTo(0.5);
    expect(
      progressTowardGoal({ similarity: 0.2, startSimilarity: 0.8, won: false }),
    ).toBe(0);
  });

  it("draws a win as a completed trip", () => {
    expect(
      progressTowardGoal({ similarity: 0.61, startSimilarity: 0.16, won: true }),
    ).toBe(1);
  });
});

describe("share text", () => {
  const base = {
    day: "2026-11-20",
    start: "paris",
    goal: "sushi",
    movesUsed: 5,
    similarity: 0.71199,
    equation: "paris + food + fish",
    won: true,
    points: 110,
    par: 3,
    streak: 1,
    practice: false,
  };

  it("leads a win with the day and the points", () => {
    expect(shareText(base)).toBe(
      "Wordelate Nov 20th: 110 points!\nI got from paris to sushi in 5 moves (par 3).\nparis + food + fish",
    );
  });

  it("mentions a streak of two or more, but not in practice", () => {
    expect(shareText({ ...base, streak: 4 })).toContain("4 day streak.");
    expect(shareText({ ...base, streak: 4, practice: true })).not.toContain("streak");
    expect(shareText({ ...base, practice: true }).split("\n")[0]).toBe("Wordelate Nov 20th (practice): 110 points!");
  });

  it("describes an unfinished game by how far along it is", () => {
    const text = shareText({ ...base, won: false, movesUsed: 0, similarity: 0.16, equation: "   " });
    expect(text).toBe("Wordelate Nov 20th: paris→sushi\n16% of the way there in 0/16 moves.");
  });

  it("writes the day with the right ordinal", () => {
    expect(shareDate("2026-11-01")).toBe("Nov 1st");
    expect(shareDate("2026-11-02")).toBe("Nov 2nd");
    expect(shareDate("2026-11-03")).toBe("Nov 3rd");
    expect(shareDate("2026-11-11")).toBe("Nov 11th");
    expect(shareDate("2026-11-22")).toBe("Nov 22nd");
    expect(shareDate("nope")).toBe("nope");
  });

  it("escapes the words, links the name, and embeds the graph for a rich paste", () => {
    const html = shareHtml('Wordelate Nov 20th\nking < queen + "man"', "data:image/png;base64,abc");
    expect(html).toContain(`<a href="${WORD_ELATE_URL}">Wordelate</a> Nov 20th<br>king &lt; queen + &quot;man&quot;`);
    expect(html).toContain('src="data:image/png;base64,abc"');
    expect(shareHtml("king→queen", null)).toBe("<p>king→queen</p>");
  });

  it("adds the wordelate link under the plain message", () => {
    const message = shareMessage("Wordelate Nov 20th: 110 points!\nking + man − woman");
    expect(message.endsWith(`\n\n${WORD_ELATE_URL}`)).toBe(true);
    expect(message).toContain("king + man − woman");
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
    const inverse = commitMove({ ...input, moves: first.moves }, { op: "-", word: "cat" });
    expect(inverse.ok).toBe(true);
    if (!inverse.ok) return;
    expect(inverse.result.movesUsed).toBe(2);
    expect(inverse.result.equationWords).toEqual([]);
    expect(inverse.result.scoredSteps).toEqual([
      { op: "+", word: "cat" },
      { op: "-", word: "cat" },
    ]);
    const repeated = commitMove(input, { op: "+", word: "cat" });
    expect(repeated.ok).toBe(true);
    if (!repeated.ok) return;
    const again = commitMove({ ...input, moves: repeated.moves }, { op: "+", word: "cat" });
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.error).toBe("Word already used");
  });
});
