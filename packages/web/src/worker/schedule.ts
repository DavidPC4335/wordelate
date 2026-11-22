import { dayForPosition, positionForDay } from "../lib/admin.js";
import { parsePuzzleFile } from "../lib/puzzles.js";
import type { Puzzle } from "../lib/puzzles.js";
import type { Sql } from "./sql.js";

/**
 * The question stack stays in memory and is read again only after an admin edits it.
 * `revision` lives in the database, so a different worker learns about a change on its next read.
 */
type Memory = { revision: number; count: number; puzzles: Puzzle[] };

let memory: Memory | null = null;

export function resetScheduleCache(): void {
  memory = null;
}

const INSERT_ROWS = 10;

async function meta(sql: Sql): Promise<{ revision: number; count: number }> {
  const row = await sql.get<{ revision: number; n: number }>(
    `SELECT revision, (SELECT COUNT(*) FROM questions) AS n FROM schedule_meta WHERE id = 1`,
    [],
  );
  return { revision: Number(row?.revision ?? 0), count: Number(row?.n ?? 0) };
}

async function seed(sql: Sql, puzzles: readonly Puzzle[], now: number): Promise<void> {
  for (let start = 0; start < puzzles.length; start += INSERT_ROWS) {
    const chunk = puzzles.slice(start, start + INSERT_ROWS);
    const values = chunk.map(() => "(?, ?, ?, ?)").join(", ");
    const params: unknown[] = [];
    chunk.forEach((puzzle, offset) => {
      params.push(start + offset, JSON.stringify(puzzle), now, "seed");
    });
    await sql.run(
      `INSERT INTO questions (position, puzzle_json, updated_at, updated_by) VALUES ${values}
       ON CONFLICT (position) DO NOTHING`,
      params,
    );
  }
}

async function readStack(sql: Sql): Promise<Puzzle[]> {
  const info = await meta(sql);
  if (memory && memory.revision === info.revision && memory.count === info.count && info.count > 0) {
    return memory.puzzles;
  }
  const rows = await sql.all<{ position: number; puzzle_json: string }>(
    `SELECT position, puzzle_json FROM questions ORDER BY position`,
    [],
  );
  for (let index = 0; index < rows.length; index++) {
    if (Number(rows[index]?.position) !== index) throw new Error("The question stack has a gap.");
  }
  const puzzles = parsePuzzleFile(rows.map((row) => JSON.parse(row.puzzle_json) as unknown));
  memory = { revision: info.revision, count: puzzles.length, puzzles };
  return puzzles;
}

/** Load the stack, filling it from the built-in list the first time. */
export async function ensureSchedule(sql: Sql, seedPuzzles: readonly Puzzle[], now: number): Promise<Puzzle[]> {
  await sql.run(`INSERT INTO schedule_meta (id, revision) VALUES (1, 0) ON CONFLICT (id) DO NOTHING`, []);
  const info = await meta(sql);
  if (info.count === 0 && seedPuzzles.length > 0) {
    await seed(sql, seedPuzzles, now);
    await sql.run(`UPDATE schedule_meta SET revision = revision + 1 WHERE id = 1`, []);
    memory = null;
  }
  return readStack(sql);
}

/** What the game may see: today and earlier. Later days stay on the admin page. */
export function publicStack(puzzles: readonly Puzzle[], today: string): Puzzle[] {
  const index = positionForDay(today);
  if (index == null) return [];
  if (index >= puzzles.length) return [...puzzles];
  return puzzles.slice(0, index + 1);
}

export type SaveResult =
  | { ok: true; position: number; added: boolean }
  | { ok: false; status: number; error: string };

/**
 * Replace a future question, or add one at the end. Today and every earlier day are refused.
 */
export async function saveQuestion(
  sql: Sql,
  stack: readonly Puzzle[],
  position: number | null,
  puzzle: Puzzle,
  today: string,
  actor: string,
  now: number,
): Promise<SaveResult> {
  const todayIndex = positionForDay(today) ?? -1;
  const index = position === null ? stack.length : position;
  if (!Number.isInteger(index) || index < 0 || index > stack.length) {
    return { ok: false, status: 400, error: "That day is not on the schedule." };
  }
  if (index <= todayIndex) {
    return { ok: false, status: 409, error: "Today's question is locked, and so is every day before it." };
  }
  if (position !== null && index === stack.length) {
    return { ok: false, status: 400, error: "Add a new question at the end of the list." };
  }
  if (stack.some((held, heldIndex) => held.id === puzzle.id && heldIndex !== index)) {
    return { ok: false, status: 409, error: "Another day already uses that id." };
  }
  const body = JSON.stringify(puzzle);
  if (body.length > 8000) return { ok: false, status: 400, error: "That question is too large." };
  if (position === null) {
    const wrote = await sql.run(
      `INSERT INTO questions (position, puzzle_json, updated_at, updated_by) VALUES (?, ?, ?, ?)`,
      [index, body, now, actor],
    );
    if (wrote !== 1) return { ok: false, status: 409, error: "That day was just added. Reload and try again." };
  } else {
    const wrote = await sql.run(
      `UPDATE questions SET puzzle_json = ?, updated_at = ?, updated_by = ? WHERE position = ?`,
      [body, now, actor, index],
    );
    if (wrote !== 1) return { ok: false, status: 404, error: "That day is not on the schedule." };
  }
  await sql.run(`UPDATE schedule_meta SET revision = revision + 1 WHERE id = 1`, []);
  memory = null;
  return { ok: true, position: index, added: position === null };
}

/** Positions are parked this far out while the later days shift, so no two rows ever share one. */
const PARK = 1_000_000;

export type InsertResult =
  | { ok: true; position: number; moved: number }
  | { ok: false; status: number; error: string };

/**
 * Put a new question on a future day and move that day's question, and every one after it, back
 * one day. Today and every earlier day stay exactly as they are. The shift and the insert are one
 * transaction, so the stack never has a gap or a repeat.
 */
export async function insertQuestion(
  sql: Sql,
  stack: readonly Puzzle[],
  position: number,
  puzzle: Puzzle,
  today: string,
  actor: string,
  now: number,
): Promise<InsertResult> {
  const todayIndex = positionForDay(today) ?? -1;
  if (!Number.isInteger(position) || position < 0 || position > stack.length) {
    return { ok: false, status: 400, error: "That day is not on the schedule." };
  }
  if (position <= todayIndex) {
    return { ok: false, status: 409, error: "Today's question is locked, and so is every day before it." };
  }
  if (stack.some((held) => held.id === puzzle.id)) {
    return { ok: false, status: 409, error: "Another day already uses that id." };
  }
  const body = JSON.stringify(puzzle);
  if (body.length > 8000) return { ok: false, status: 400, error: "That question is too large." };
  const moved = stack.length - position;
  try {
    await sql.batch([
      { statement: `UPDATE questions SET position = position + ? WHERE position >= ?`, params: [PARK, position] },
      { statement: `UPDATE questions SET position = position - ? WHERE position >= ?`, params: [PARK - 1, PARK] },
      {
        statement: `INSERT INTO questions (position, puzzle_json, updated_at, updated_by) VALUES (?, ?, ?, ?)`,
        params: [position, body, now, actor],
      },
      { statement: `UPDATE schedule_meta SET revision = revision + 1 WHERE id = 1`, params: [] },
    ]);
  } catch {
    memory = null;
    return { ok: false, status: 409, error: "The list changed while you were saving. Reload and try again." };
  }
  memory = null;
  return { ok: true, position, moved };
}

export function slotDay(position: number): string {
  return dayForPosition(position);
}
