import { TOP_PLAYERS } from "../lib/admin.js";
import type { TopPlayer, TopPlayersView, TopWindow } from "../lib/admin.js";
import { parseAnswer, retentionStart, shiftDay } from "../lib/standings.js";
import type { BoardAnswer } from "../lib/standings.js";
import { archiveKey } from "./archive.js";
import type { Sql } from "./sql.js";

/** Read access to the private score archive. Older days live only there. */
export type ArchiveReader = {
  get(key: string): Promise<string | null>;
};

/** One signed-in player's best result on one day. Server-checked, from the leaderboard. */
export type DayResult = {
  userId: string;
  day: string;
  score: number;
  moves: number;
  answer: BoardAnswer;
  createdAt: number;
};

const USER_ID = /^[0-9a-f-]{36}$/;
/** Archive reads run a few at a time. */
const ARCHIVE_PARALLEL = 6;
/** Accounts are looked up in small groups until enough still exist. */
const USER_CHUNK = 20;

function validResult(value: unknown, day: string): DayResult | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { userId?: unknown; score?: unknown; moves?: unknown; answer?: unknown; createdAt?: unknown };
  if (typeof record.userId !== "string" || !USER_ID.test(record.userId)) return null;
  const score = Number(record.score);
  const moves = Number(record.moves);
  if (!Number.isInteger(score) || score < 0 || score > 160) return null;
  if (!Number.isInteger(moves) || moves < 1 || moves > 16) return null;
  const answer = parseAnswer(JSON.stringify(record.answer ?? null));
  if (!answer) return null;
  return { userId: record.userId, day, score, moves, answer, createdAt: Number(record.createdAt) || 0 };
}

/** Signed-in results still in the database for these days. */
async function liveResults(sql: Sql, from: string, to: string): Promise<DayResult[]> {
  const rows = await sql.all<{ user_id: string; day: string; score: number; moves: number; answer_json: string; created_at: number }>(
    `SELECT user_id, day, score, moves, answer_json, created_at FROM scores
     WHERE day >= ? AND day <= ? AND user_id IS NOT NULL`,
    [from, to],
  );
  const out: DayResult[] = [];
  for (const row of rows) {
    const answer = parseAnswer(row.answer_json);
    if (!answer) continue;
    out.push({
      userId: row.user_id,
      day: row.day,
      score: Number(row.score),
      moves: Number(row.moves),
      answer,
      createdAt: Number(row.created_at),
    });
  }
  return out;
}

/** Signed-in results from one archived day. A missing or damaged file counts as an empty day. */
async function archivedResults(archive: ArchiveReader, day: string): Promise<DayResult[]> {
  let text: string | null;
  try {
    text = await archive.get(archiveKey(day));
  } catch (error) {
    console.error(JSON.stringify({ event: "top-archive", day, message: error instanceof Error ? error.message : "failed" }));
    return [];
  }
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as { scores?: unknown };
    if (!Array.isArray(parsed.scores)) return [];
    return parsed.scores.map((entry) => validResult(entry, day)).filter((entry): entry is DayResult => entry !== null);
  } catch {
    return [];
  }
}

type Standing = { userId: string; totalPoints: number; daysPlayed: number; best: DayResult };

function better(a: DayResult, b: DayResult): boolean {
  if (a.score !== b.score) return a.score > b.score;
  // The more recent of two equal days is the one to show.
  if (a.day !== b.day) return a.day > b.day;
  return a.createdAt < b.createdAt;
}

/**
 * Most points over the window first. A higher best day, then the earlier finish, breaks a tie.
 * A player with two entries on one day (two browsers) counts the better one.
 */
export function rankResults(results: readonly DayResult[]): Standing[] {
  const perDay = new Map<string, DayResult>();
  for (const result of results) {
    const key = `${result.userId}|${result.day}`;
    const held = perDay.get(key);
    if (!held || better(result, held)) perDay.set(key, result);
  }
  const byUser = new Map<string, Standing>();
  for (const result of perDay.values()) {
    const held = byUser.get(result.userId);
    if (!held) {
      byUser.set(result.userId, { userId: result.userId, totalPoints: result.score, daysPlayed: 1, best: result });
      continue;
    }
    held.totalPoints += result.score;
    held.daysPlayed += 1;
    if (better(result, held.best)) held.best = result;
  }
  return [...byUser.values()].sort((a, b) => {
    if (a.totalPoints !== b.totalPoints) return b.totalPoints - a.totalPoints;
    if (a.best.score !== b.best.score) return b.best.score - a.best.score;
    if (a.best.createdAt !== b.best.createdAt) return a.best.createdAt - b.best.createdAt;
    return a.userId < b.userId ? -1 : 1;
  });
}

async function mapLimited<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await work(items[index] as T);
    }
  });
  await Promise.all(runners);
  return out;
}

/**
 * The top players over the last `days` days, today included. Only signed-in players can be
 * ranked, since an anonymous entry has no name or picture to put on a card.
 */
export async function topPlayers(sql: Sql, archive: ArchiveReader | null, days: TopWindow, today: string): Promise<TopPlayersView> {
  const from = shiftDay(today, -(days - 1));
  const results = await liveResults(sql, from, today);
  if (archive) {
    // Days before the board's own window may already have moved to the archive.
    const seen = new Set(results.map((result) => result.day));
    const keep = retentionStart(today);
    const older: string[] = [];
    for (let day = from; day < keep; day = shiftDay(day, 1)) if (!seen.has(day)) older.push(day);
    const archived = await mapLimited(older, ARCHIVE_PARALLEL, (day) => archivedResults(archive, day));
    for (const list of archived) results.push(...list);
  }

  const ranked = rankResults(results);
  const players: TopPlayer[] = [];
  for (let start = 0; start < ranked.length && players.length < TOP_PLAYERS; start += USER_CHUNK) {
    const chunk = ranked.slice(start, start + USER_CHUNK);
    const marks = chunk.map(() => "?").join(", ");
    const users = await sql.all<{ id: string; display_name: string; picture: string | null; show_picture: number }>(
      `SELECT id, display_name, picture, show_picture FROM users WHERE id IN (${marks})`,
      chunk.map((standing) => standing.userId),
    );
    const byId = new Map(users.map((user) => [user.id, user]));
    for (const standing of chunk) {
      // A deleted account drops out. Its archived entries still name the old id.
      const user = byId.get(standing.userId);
      if (!user) continue;
      const best = standing.best;
      players.push({
        place: players.length + 1,
        name: user.display_name,
        picture: Number(user.show_picture) !== 0 ? user.picture : null,
        totalPoints: standing.totalPoints,
        daysPlayed: standing.daysPlayed,
        bestDay: {
          day: best.day,
          score: best.score,
          moves: best.moves,
          start: best.answer.start,
          goal: best.answer.goal,
          steps: best.answer.steps.map((step) => ({ op: step.op, word: step.word })),
        },
      });
      if (players.length >= TOP_PLAYERS) break;
    }
  }
  return { days, from, to: today, players };
}
