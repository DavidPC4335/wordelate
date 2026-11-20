import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { customPuzzle, mergePuzzles, parsePuzzleFile } from "../src/lib/puzzles.js";

const here = dirname(fileURLToPath(import.meta.url));
const moreFile = resolve(here, "../src/lib/puzzles-more.json");
const mainFile = resolve(here, "../public/puzzles.json");

describe("more puzzles", () => {
  it("parses the extra puzzles with accepted neighbors and unique ids", () => {
    const puzzles = parsePuzzleFile(JSON.parse(readFileSync(moreFile, "utf8")));
    expect(puzzles).toHaveLength(60);
    expect(new Set(puzzles.map((puzzle) => puzzle.id)).size).toBe(puzzles.length);
    for (const puzzle of puzzles) {
      expect(puzzle.par).toBeGreaterThanOrEqual(3);
      expect(puzzle.accepted.length === 2 || puzzle.accepted.length === 3).toBe(true);
      expect(puzzle.here).toBe(puzzle.goal);
    }
  });

  it("appends them after the main list and keeps accepted words", () => {
    const main = JSON.parse(readFileSync(mainFile, "utf8")) as { id: string; accepted: string[] }[];
    const more = parsePuzzleFile(JSON.parse(readFileSync(moreFile, "utf8")));
    const merged = mergePuzzles(main);
    expect(merged.map((puzzle) => puzzle.id)).toEqual([
      ...main.map((puzzle) => puzzle.id),
      ...more.map((puzzle) => puzzle.id),
    ]);
    expect(merged[0]?.accepted).toEqual(main[0]?.accepted);
    expect(merged.at(-1)?.accepted).toEqual(more.at(-1)?.accepted);
  });

  it("builds a custom pair with no authored solution", () => {
    const puzzle = customPuzzle("  Paris ", "Sushi");
    expect(puzzle).toMatchObject({
      id: "custom-paris-sushi",
      start: "paris",
      goal: "sushi",
      par: 0,
      solution: [],
      accepted: [],
    });
  });
});
