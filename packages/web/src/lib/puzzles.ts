import type { AppliedStep } from "./game.js";

export type Puzzle = {
  id: string;
  start: string;
  goal: string;
  par: number;
  solution: AppliedStep[];
  solutionSimilarity: number;
  here: string;
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
    return {
      id,
      start: start.trim().toLowerCase(),
      goal: goal.trim().toLowerCase(),
      par,
      solution,
      solutionSimilarity,
      here: here.trim().toLowerCase(),
    };
  });
  if (puzzles.length === 0) throw new Error("Puzzle file is empty");
  return puzzles;
}
