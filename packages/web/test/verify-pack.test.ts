import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodePack } from "../src/lib/pack.js";
import { mergePuzzles } from "../src/lib/puzzles.js";
import daily from "../public/puzzles.json" with { type: "json" };
import { verifySolution } from "../src/worker/verify.js";

describe("real vocabulary", () => {
  it("accepts the published paris to sushi path and rejects a one-word miss", async () => {
    const buffer = readFileSync(new URL("../public/vocab/nearest.i8", import.meta.url));
    const pack = await decodePack(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), () => {});
    const puzzle = mergePuzzles(daily).find((item) => item.id === "paris-sushi");
    expect(puzzle).toBeTruthy();
    if (!puzzle) return;
    const scored = await verifySolution(pack, puzzle, puzzle.solution);
    expect(scored).toMatchObject({ score: 130, moves: 3 });
    const missed = await verifySolution(pack, puzzle, [{ op: "+", word: "france" }]);
    expect(missed).toBeNull();
  }, 60_000);
});
