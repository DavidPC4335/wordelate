import type { BoardAnswer } from "../lib/standings.js";
import { parseAnswer } from "../lib/standings.js";
import type { Sql } from "./sql.js";

export type ScoreRow = {
  playerId: string;
  puzzleId: string;
  score: number;
  moves: number;
  answer: BoardAnswer;
  name: string | null;
  createdAt: number;
};

type ScoreRecord = {
  player_id: string;
  puzzle_id: string;
  score: number;
  moves: number;
  answer_json: string;
  name: string | null;
  created_at: number;
};

function rowFrom(record: ScoreRecord): ScoreRow | null {
  const answer = parseAnswer(record.answer_json);
  if (!answer) return null;
  return {
    playerId: record.player_id,
    puzzleId: record.puzzle_id,
    score: record.score,
    moves: record.moves,
    answer,
    name: record.name,
    createdAt: record.created_at,
  };
}

const SCORE_COLUMNS = "player_id, puzzle_id, score, moves, answer_json, name, created_at";

export async function getScore(sql: Sql, day: string, playerId: string): Promise<ScoreRow | null> {
  const record = await sql.get<ScoreRecord>(
    `SELECT ${SCORE_COLUMNS} FROM scores WHERE day = ? AND player_id = ?`,
    [day, playerId],
  );
  return record ? rowFrom(record) : null;
}

export async function saveBest(
  sql: Sql,
  day: string,
  playerId: string,
  next: { puzzleId: string; score: number; moves: number; answer: BoardAnswer; createdAt: number },
): Promise<{ row: ScoreRow; counted: boolean }> {
  const answerJson = JSON.stringify(next.answer);
  const existing = await getScore(sql, day, playerId);
  if (!existing) {
    const inserted = await sql.run(
      `INSERT INTO scores (day, player_id, puzzle_id, score, moves, answer_json, name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
       ON CONFLICT DO NOTHING`,
      [day, playerId, next.puzzleId, next.score, next.moves, answerJson, next.createdAt],
    );
    if (inserted === 1) {
      await addBucket(sql, day, next.score);
      const row = await getScore(sql, day, playerId);
      if (!row) throw new Error("Score insert did not read back");
      return { row, counted: true };
    }
  }
  const current = existing ?? (await getScore(sql, day, playerId));
  if (!current) throw new Error("Score row disappeared");
  if (next.score <= current.score) return { row: current, counted: false };
  const updated = await sql.run(
    `UPDATE scores
     SET puzzle_id = ?, score = ?, moves = ?, answer_json = ?, created_at = ?
     WHERE day = ? AND player_id = ? AND score = ? AND score < ?`,
    [next.puzzleId, next.score, next.moves, answerJson, next.createdAt, day, playerId, current.score, next.score],
  );
  if (updated !== 1) {
    const latest = await getScore(sql, day, playerId);
    return { row: latest ?? current, counted: false };
  }
  await removeBucket(sql, day, current.score);
  await addBucket(sql, day, next.score);
  const row = await getScore(sql, day, playerId);
  if (!row) throw new Error("Score update did not read back");
  return { row, counted: true };
}

async function addBucket(sql: Sql, day: string, score: number): Promise<void> {
  await sql.run(
    `INSERT INTO buckets (day, score, n) VALUES (?, ?, 1)
     ON CONFLICT (day, score) DO UPDATE SET n = n + 1`,
    [day, score],
  );
}

async function removeBucket(sql: Sql, day: string, score: number): Promise<void> {
  await sql.run(`UPDATE buckets SET n = n - 1 WHERE day = ? AND score = ? AND n > 0`, [day, score]);
  await sql.run(`DELETE FROM buckets WHERE day = ? AND score = ? AND n <= 0`, [day, score]);
}

export async function buckets(sql: Sql, day: string): Promise<{ score: number; n: number }[]> {
  const rows = await sql.all<{ score: number; n: number }>(
    `SELECT score, n FROM buckets WHERE day = ? AND n > 0`,
    [day],
  );
  return rows;
}

export async function topScores(sql: Sql, day: string, limit: number): Promise<ScoreRow[]> {
  const rows = await sql.all<ScoreRecord>(
    `SELECT ${SCORE_COLUMNS} FROM scores WHERE day = ? ORDER BY score DESC, created_at ASC LIMIT ?`,
    [day, limit],
  );
  const out: ScoreRow[] = [];
  for (const record of rows) {
    const row = rowFrom(record);
    if (row) out.push(row);
  }
  return out;
}

export async function rankOf(sql: Sql, day: string, score: number, createdAt: number): Promise<number> {
  const record = await sql.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM scores
     WHERE day = ? AND (score > ? OR (score = ? AND created_at < ?))`,
    [day, score, score, createdAt],
  );
  return Number(record?.n ?? 0) + 1;
}

export async function setName(sql: Sql, day: string, playerId: string, name: string): Promise<boolean> {
  const updated = await sql.run(
    `UPDATE scores SET name = ? WHERE day = ? AND player_id = ? AND name IS NULL`,
    [name, day, playerId],
  );
  return updated === 1;
}

/** True when this hit is still inside the limit. The counter always moves. */
export async function allowHit(sql: Sql, bucket: string, limit: number, now: number, ttlMs: number): Promise<boolean> {
  const expires = now + ttlMs;
  await sql.run(
    `INSERT INTO hits (bucket, n, expires_at) VALUES (?, 1, ?)
     ON CONFLICT (bucket) DO UPDATE SET
       n = CASE WHEN hits.expires_at < ? THEN 1 ELSE hits.n + 1 END,
       expires_at = CASE WHEN hits.expires_at < ? THEN ? ELSE hits.expires_at END`,
    [bucket, expires, now, now, expires],
  );
  const record = await sql.get<{ n: number }>(`SELECT n FROM hits WHERE bucket = ?`, [bucket]);
  return Number(record?.n ?? limit + 1) <= limit;
}

export async function daysBefore(sql: Sql, day: string): Promise<string[]> {
  const rows = await sql.all<{ day: string }>(
    `SELECT DISTINCT day FROM scores WHERE day < ? ORDER BY day`,
    [day],
  );
  return rows.map((row) => row.day);
}

export async function scoresOnDay(sql: Sql, day: string): Promise<ScoreRow[]> {
  const rows = await sql.all<ScoreRecord>(
    `SELECT ${SCORE_COLUMNS} FROM scores WHERE day = ? ORDER BY score DESC, created_at ASC`,
    [day],
  );
  const out: ScoreRow[] = [];
  for (const record of rows) {
    const row = rowFrom(record);
    if (row) out.push(row);
  }
  return out;
}

export async function deleteDay(sql: Sql, day: string): Promise<void> {
  await sql.run(`DELETE FROM scores WHERE day = ?`, [day]);
  await sql.run(`DELETE FROM buckets WHERE day = ?`, [day]);
}

export async function deleteExpiredHits(sql: Sql, now: number): Promise<void> {
  await sql.run(`DELETE FROM hits WHERE expires_at < ?`, [now]);
}
