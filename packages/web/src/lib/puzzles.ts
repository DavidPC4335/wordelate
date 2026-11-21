import type { AppliedStep } from "./game.js";
import { daysBetween } from "./standings.js";
import morePuzzles from "./puzzles-more.json" with { type: "json" };

/** First scheduled day. Puzzle 0 is this date, then the list repeats in order. */
export const SCHEDULE_EPOCH = "2026-11-20";

export type Puzzle = {
  id: string;
  start: string;
  goal: string;
  par: number;
  solution: AppliedStep[];
  solutionSimilarity: number;
  here: string;
  accepted: readonly string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readSolution(value: unknown, id: string): AppliedStep[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Puzzle ${id} is missing a solution`);
  }
  return value.map((step, index) => {
    if (!isRecord(step)) throw new Error(`Puzzle ${id} solution step ${index} is invalid`);
    const op = step.op;
    const word = step.word;
    if (op !== "+" && op !== "-") {
      throw new Error(`Puzzle ${id} solution step ${index} has a bad operation`);
    }
    if (typeof word !== "string" || word.trim().length === 0) {
      throw new Error(`Puzzle ${id} solution step ${index} is missing a word`);
    }
    return { op, word: word.trim().toLowerCase() };
  });
}

function readAccepted(value: unknown, id: string): string[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 3) {
    throw new Error(`Puzzle ${id} needs 2 or 3 accepted words`);
  }
  return value.map((entry, index) => {
    if (typeof entry !== "string") {
      throw new Error(`Puzzle ${id} accepted word ${index + 1} must be lowercase a-z`);
    }
    const word = entry.trim();
    if (!/^[a-z]+$/.test(word)) {
      throw new Error(`Puzzle ${id} accepted word ${index + 1} must be lowercase a-z`);
    }
    return word;
  });
}

export function parsePuzzleFile(data: unknown): Puzzle[] {
  if (!Array.isArray(data)) throw new Error("Puzzle file must be a list");
  const ids = new Set<string>();
  const puzzles = data.map((row, index) => {
    if (!isRecord(row)) throw new Error(`Puzzle ${index + 1} is not an object`);
    const id = row.id;
    const start = row.start;
    const goal = row.goal;
    const par = row.par;
    const solutionSimilarity = row.solutionSimilarity;
    const here = row.here;
    if (typeof id !== "string" || id.length === 0) {
      throw new Error(`Puzzle ${index + 1} is missing an id`);
    }
    if (ids.has(id)) throw new Error(`Duplicate puzzle id ${id}`);
    ids.add(id);
    if (typeof start !== "string" || typeof goal !== "string") {
      throw new Error(`Puzzle ${id} needs a start and a goal`);
    }
    const solution = readSolution(row.solution, id);
    if (typeof par !== "number" || par !== solution.length) {
      throw new Error(`Puzzle ${id} par does not match the solution length`);
    }
    if (typeof solutionSimilarity !== "number" || !Number.isFinite(solutionSimilarity)) {
      throw new Error(`Puzzle ${id} is missing solutionSimilarity`);
    }
    if (typeof here !== "string" || here.length === 0) {
      throw new Error(`Puzzle ${id} is missing here`);
    }
    const accepted = readAccepted(row.accepted, id);
    return {
      id,
      start: start.trim().toLowerCase(),
      goal: goal.trim().toLowerCase(),
      par,
      solution,
      solutionSimilarity,
      here: here.trim().toLowerCase(),
      accepted,
    };
  });
  if (puzzles.length === 0) throw new Error("Puzzle file is empty");
  return puzzles;
}

/** A free pair from Admin. There is no authored solution to reveal. `similarity` is 0 to 1. */
export function customPuzzle(start: string, goal: string, similarity = 0.75): Puzzle {
  const startWord = start.trim().toLowerCase();
  const goalWord = goal.trim().toLowerCase();
  return {
    id: `custom-${startWord}-${goalWord}`,
    start: startWord,
    goal: goalWord,
    par: 0,
    solution: [],
    solutionSimilarity: similarity,
    here: goalWord,
    accepted: [],
  };
}

/** The puzzle scheduled for an Eastern calendar day. The list order is the schedule. */
export function puzzleForDay(puzzles: readonly Puzzle[], day: string): Puzzle | null {
  if (puzzles.length === 0) return null;
  const delta = daysBetween(SCHEDULE_EPOCH, day);
  if (delta == null) return null;
  const index = ((delta % puzzles.length) + puzzles.length) % puzzles.length;
  return puzzles[index] ?? null;
}

/**
 * The puzzle at that calendar day, with no wrap. A day before the schedule, or past
 * the end of the list, has no puzzle. This is the schedule the admin stack uses.
 */
export function puzzleAt(puzzles: readonly Puzzle[], day: string): Puzzle | null {
  const delta = daysBetween(SCHEDULE_EPOCH, day);
  if (delta == null || delta < 0 || delta >= puzzles.length) return null;
  return puzzles[delta] ?? null;
}

/** Daily puzzles plus the extra complex set. Accepted words stay on each row. */
export function mergePuzzles(main: unknown): Puzzle[] {
  if (!Array.isArray(main) || !Array.isArray(morePuzzles)) {
    throw new Error("Puzzle file must be a list");
  }
  return parsePuzzleFile([...main, ...morePuzzles]);
}
