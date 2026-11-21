import { statsFor, streakFromDays } from "../lib/account.js";
import { daysBetween } from "../lib/standings.js";
import type { ScoreEntry } from "../lib/storage.js";
import { forgetUser } from "./board-db.js";
import type { Sql } from "./sql.js";

export type UserRow = {
  id: string;
  googleSub: string;
  email: string;
  fullName: string;
  displayName: string;
  picture: string | null;
  /** True once the person chose their own username, so a later login does not overwrite it. */
  usernameSet: boolean;
  /** Whether the picture link may appear on the leaderboard. */
  showPicture: boolean;
  inviteGen: number;
  totalPoints: number;
  wins: number;
  streak: number;
  streakDay: string | null;
  bestStreak: number;
  createdAt: number;
  lastLoginAt: number;
};

type UserRecord = {
  id: string;
  google_sub: string;
  email: string;
  full_name: string;
  display_name: string;
  picture: string | null;
  username_set: number;
  show_picture: number;
  invite_gen: number;
  total_points: number;
  wins: number;
  streak: number;
  streak_day: string | null;
  best_streak: number;
  created_at: number;
  last_login_at: number;
};

const USER_COLUMNS =
  "id, google_sub, email, full_name, display_name, picture, username_set, show_picture, invite_gen, total_points, wins, streak, streak_day, best_streak, created_at, last_login_at";

function userFrom(record: UserRecord): UserRow {
  return {
    id: record.id,
    googleSub: record.google_sub,
    email: record.email,
    fullName: record.full_name,
    displayName: record.display_name,
    picture: record.picture,
    usernameSet: Number(record.username_set) === 1,
    showPicture: Number(record.show_picture) !== 0,
    inviteGen: Number(record.invite_gen),
    totalPoints: Number(record.total_points),
    wins: Number(record.wins),
    streak: Number(record.streak),
    streakDay: record.streak_day,
    bestStreak: Number(record.best_streak),
    createdAt: Number(record.created_at),
    lastLoginAt: Number(record.last_login_at),
  };
}

export async function getUser(sql: Sql, id: string): Promise<UserRow | null> {
  const record = await sql.get<UserRecord>(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`, [id]);
  return record ? userFrom(record) : null;
}

/** Create the account on a first login, or refresh the Google details on a later one. */
export async function upsertUser(
  sql: Sql,
  profile: { sub: string; email: string; fullName: string; displayName: string; picture: string | null },
  newId: string,
  now: number,
): Promise<UserRow> {
  await sql.run(
    `INSERT INTO users (id, google_sub, email, full_name, display_name, picture, created_at, last_login_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (google_sub) DO UPDATE SET
       email = excluded.email,
       full_name = excluded.full_name,
       display_name = CASE WHEN users.username_set = 1 THEN users.display_name ELSE excluded.display_name END,
       picture = excluded.picture,
       last_login_at = excluded.last_login_at`,
    [newId, profile.sub, profile.email, profile.fullName, profile.displayName, profile.picture, now, now],
  );
  const record = await sql.get<UserRecord>(`SELECT ${USER_COLUMNS} FROM users WHERE google_sub = ?`, [profile.sub]);
  if (!record) throw new Error("User did not read back");
  return userFrom(record);
}

/* ---------- Sessions ---------- */

const MAX_SESSIONS = 10;

export async function createSession(
  sql: Sql,
  tokenHash: string,
  userId: string,
  now: number,
  expiresAt: number,
): Promise<void> {
  await sql.run(
    `INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)`,
    [tokenHash, userId, now, expiresAt, now],
  );
  // Keep the newest few. An old, forgotten browser should not stay signed in forever.
  await sql.run(
    `DELETE FROM sessions WHERE user_id = ? AND token_hash NOT IN (
       SELECT token_hash FROM sessions WHERE user_id = ? ORDER BY created_at DESC, token_hash LIMIT ?
     )`,
    [userId, userId, MAX_SESSIONS],
  );
}

export type SessionRow = { tokenHash: string; user: UserRow; lastSeenAt: number; expiresAt: number };

export async function getSession(sql: Sql, tokenHash: string, now: number): Promise<SessionRow | null> {
  const record = await sql.get<{ last_seen_at: number; expires_at: number; user_id: string }>(
    `SELECT last_seen_at, expires_at, user_id FROM sessions WHERE token_hash = ? AND expires_at > ?`,
    [tokenHash, now],
  );
  if (!record) return null;
  const user = await getUser(sql, record.user_id);
  if (!user) return null;
  return { tokenHash, user, lastSeenAt: Number(record.last_seen_at), expiresAt: Number(record.expires_at) };
}

export async function extendSession(sql: Sql, tokenHash: string, now: number, expiresAt: number): Promise<void> {
  await sql.run(`UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?`, [now, expiresAt, tokenHash]);
}

export async function deleteSession(sql: Sql, tokenHash: string): Promise<void> {
  await sql.run(`DELETE FROM sessions WHERE token_hash = ?`, [tokenHash]);
}

export async function deleteUserSessions(sql: Sql, userId: string): Promise<void> {
  await sql.run(`DELETE FROM sessions WHERE user_id = ?`, [userId]);
}

export async function deleteExpiredSessions(sql: Sql, now: number): Promise<void> {
  await sql.run(`DELETE FROM sessions WHERE expires_at <= ?`, [now]);
}

/* ---------- Scores ---------- */

type AccountScoreRecord = { day: string; puzzle_id: string; score: number; moves: number };

export async function scoresOf(sql: Sql, userId: string): Promise<ScoreEntry[]> {
  const rows = await sql.all<AccountScoreRecord>(
    `SELECT day, puzzle_id, score, moves FROM account_scores WHERE user_id = ? ORDER BY day, puzzle_id`,
    [userId],
  );
  return rows.map((row) => ({
    day: row.day,
    puzzleId: row.puzzle_id,
    score: Number(row.score),
    moves: Number(row.moves),
  }));
}

/** D1 allows 100 bound values in one statement. Six per row keeps this well under. */
const ROWS_PER_INSERT = 15;

/** Add what is new and keep the better score where the account already has one. */
export async function saveScores(
  sql: Sql,
  userId: string,
  entries: readonly ScoreEntry[],
  now: number,
): Promise<void> {
  for (let start = 0; start < entries.length; start += ROWS_PER_INSERT) {
    const chunk = entries.slice(start, start + ROWS_PER_INSERT);
    const values = chunk.map(() => "(?, ?, ?, ?, ?, ?)").join(", ");
    const params: unknown[] = [];
    for (const entry of chunk) params.push(userId, entry.day, entry.puzzleId, entry.score, entry.moves, now);
    await sql.run(
      `INSERT INTO account_scores (user_id, day, puzzle_id, score, moves, updated_at) VALUES ${values}
       ON CONFLICT (user_id, day, puzzle_id) DO UPDATE SET
         score = excluded.score, moves = excluded.moves, updated_at = excluded.updated_at
       WHERE excluded.score > account_scores.score`,
      params,
    );
  }
}

export async function scoreCount(sql: Sql, userId: string): Promise<number> {
  const record = await sql.get<{ n: number }>(`SELECT COUNT(*) AS n FROM account_scores WHERE user_id = ?`, [userId]);
  return Number(record?.n ?? 0);
}

/** Work out points and streaks from the stored scores and keep them on the user. */
export async function refreshStats(sql: Sql, userId: string, entries: readonly ScoreEntry[], today: string) {
  const stats = statsFor(entries, today);
  const run = streakFromDays(entries.map((entry) => entry.day));
  await sql.run(
    `UPDATE users SET total_points = ?, wins = ?, streak = ?, streak_day = ?, best_streak = ? WHERE id = ?`,
    [stats.totalPoints, stats.wins, run.count, run.lastDay, run.best, userId],
  );
  return stats;
}

/** A streak only counts while its last day is today or yesterday. */
export function liveStreak(count: number, lastDay: string | null, today: string): number {
  if (!lastDay || count < 1) return 0;
  if (lastDay === today || daysBetween(lastDay, today) === 1) return count;
  return 0;
}

/* ---------- Friends ---------- */

export function orderedPair(one: string, two: string): [string, string] {
  return one < two ? [one, two] : [two, one];
}

export async function friendCount(sql: Sql, userId: string): Promise<number> {
  const record = await sql.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM friendships WHERE user_a = ? OR user_b = ?`,
    [userId, userId],
  );
  return Number(record?.n ?? 0);
}

export async function areFriends(sql: Sql, one: string, two: string): Promise<boolean> {
  const [a, b] = orderedPair(one, two);
  const record = await sql.get<{ n: number }>(`SELECT COUNT(*) AS n FROM friendships WHERE user_a = ? AND user_b = ?`, [a, b]);
  return Number(record?.n ?? 0) > 0;
}

export async function addFriendship(sql: Sql, one: string, two: string, now: number): Promise<boolean> {
  const [a, b] = orderedPair(one, two);
  const added = await sql.run(
    `INSERT INTO friendships (user_a, user_b, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING`,
    [a, b, now],
  );
  return added === 1;
}

export async function removeFriendship(sql: Sql, one: string, two: string): Promise<boolean> {
  const [a, b] = orderedPair(one, two);
  const removed = await sql.run(`DELETE FROM friendships WHERE user_a = ? AND user_b = ?`, [a, b]);
  return removed === 1;
}

export async function friendsOf(sql: Sql, userId: string): Promise<UserRow[]> {
  const rows = await sql.all<UserRecord>(
    `SELECT ${USER_COLUMNS.split(", ").map((column) => `u.${column}`).join(", ")}
     FROM friendships f
     JOIN users u ON u.id = CASE WHEN f.user_a = ? THEN f.user_b ELSE f.user_a END
     WHERE f.user_a = ? OR f.user_b = ?
     ORDER BY u.display_name COLLATE NOCASE, u.id`,
    [userId, userId, userId],
  );
  return rows.map(userFrom);
}

/** The best result for each of these players on each day since `sinceDay`. */
export async function recentScores(
  sql: Sql,
  userIds: readonly string[],
  sinceDay: string,
): Promise<Map<string, { day: string; score: number; moves: number }[]>> {
  const out = new Map<string, { day: string; score: number; moves: number }[]>();
  if (userIds.length === 0) return out;
  const rows = await sql.all<{ user_id: string; day: string; score: number; moves: number }>(
    `SELECT user_id, day, score, moves FROM account_scores
     WHERE user_id IN (${userIds.map(() => "?").join(", ")}) AND day >= ?
     ORDER BY day DESC, score DESC`,
    [...userIds, sinceDay],
  );
  for (const row of rows) {
    const list = out.get(row.user_id) ?? [];
    if (list.some((held) => held.day === row.day)) continue;
    list.push({ day: row.day, score: Number(row.score), moves: Number(row.moves) });
    out.set(row.user_id, list);
  }
  return out;
}

/** Remove the person and everything that belongs to them. */
/** Change the username and/or whether the picture may be shown. Returns false when nothing was found. */
export async function updateProfile(
  sql: Sql,
  userId: string,
  change: { username?: string; showPicture?: boolean },
): Promise<boolean> {
  const sets: string[] = [];
  const params: (string | number)[] = [];
  if (change.username !== undefined) {
    sets.push("display_name = ?", "username_set = 1");
    params.push(change.username);
  }
  if (change.showPicture !== undefined) {
    sets.push("show_picture = ?");
    params.push(change.showPicture ? 1 : 0);
  }
  if (sets.length === 0) return true;
  params.push(userId);
  return (await sql.run(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, params)) === 1;
}

export async function deleteUser(sql: Sql, userId: string): Promise<void> {
  await forgetUser(sql, userId);
  await sql.run(`DELETE FROM sessions WHERE user_id = ?`, [userId]);
  await sql.run(`DELETE FROM friendships WHERE user_a = ? OR user_b = ?`, [userId, userId]);
  await sql.run(`DELETE FROM account_scores WHERE user_id = ?`, [userId]);
  await sql.run(`DELETE FROM users WHERE id = ?`, [userId]);
}
