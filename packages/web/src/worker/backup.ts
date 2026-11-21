import { deleteExpiredSessions } from "./account-db.js";
import type { ScoreArchive } from "./archive.js";
import type { Sql } from "./sql.js";

/** Rows per object. A large community still fits in memory one part at a time. */
const PART_ROWS = 1000;

export function backupKey(day: string, name: string, part?: number): string {
  const file = part === undefined ? name : `${name}-${String(part).padStart(4, "0")}`;
  return `accounts/${day}/${file}.json`;
}

type Page = { rows: Record<string, unknown>[]; next: unknown[] | null };

/**
 * Every table that belongs to people, but not the login sessions: a copy of those
 * would be a way to sign in. Each run is its own dated folder, closed by a manifest
 * that is written last, so a folder without a manifest is an unfinished run.
 */
const TABLES: {
  name: string;
  /** The page query takes the cursor columns first, then the limit. */
  first: string;
  after: string;
  cursor: string[];
}[] = [
  {
    name: "users",
    first: "SELECT * FROM users ORDER BY id LIMIT ?",
    after: "SELECT * FROM users WHERE id > ? ORDER BY id LIMIT ?",
    cursor: ["id"],
  },
  {
    name: "scores",
    first: "SELECT * FROM account_scores ORDER BY user_id, day, puzzle_id LIMIT ?",
    after:
      "SELECT * FROM account_scores WHERE (user_id, day, puzzle_id) > (?, ?, ?) ORDER BY user_id, day, puzzle_id LIMIT ?",
    cursor: ["user_id", "day", "puzzle_id"],
  },
  {
    name: "friendships",
    first: "SELECT * FROM friendships ORDER BY user_a, user_b LIMIT ?",
    after: "SELECT * FROM friendships WHERE (user_a, user_b) > (?, ?) ORDER BY user_a, user_b LIMIT ?",
    cursor: ["user_a", "user_b"],
  },
  {
    name: "admins",
    first: "SELECT * FROM admins ORDER BY email LIMIT ?",
    after: "SELECT * FROM admins WHERE email > ? ORDER BY email LIMIT ?",
    cursor: ["email"],
  },
  {
    name: "questions",
    first: "SELECT * FROM questions ORDER BY position LIMIT ?",
    after: "SELECT * FROM questions WHERE position > ? ORDER BY position LIMIT ?",
    cursor: ["position"],
  },
  {
    name: "admin_audit",
    first: "SELECT * FROM admin_audit ORDER BY id LIMIT ?",
    after: "SELECT * FROM admin_audit WHERE id > ? ORDER BY id LIMIT ?",
    cursor: ["id"],
  },
];

async function page(sql: Sql, table: (typeof TABLES)[number], cursor: unknown[] | null): Promise<Page> {
  const rows = cursor
    ? await sql.all<Record<string, unknown>>(table.after, [...cursor, PART_ROWS])
    : await sql.all<Record<string, unknown>>(table.first, [PART_ROWS]);
  const last = rows[rows.length - 1];
  return {
    rows,
    next: rows.length === PART_ROWS && last ? table.cursor.map((column) => last[column]) : null,
  };
}

export type BackupResult = { users: number; scores: number; friendships: number; objects: number };

/** Copy all account data to the archive, then forget sessions that have run out. */
export async function backupAccounts(
  sql: Sql,
  archive: ScoreArchive,
  day: string,
  now: number,
): Promise<BackupResult> {
  const counts: Record<string, number> = {};
  const parts: Record<string, number> = {};
  let objects = 0;
  for (const table of TABLES) {
    let cursor: unknown[] | null = null;
    let part = 0;
    let total = 0;
    do {
      const current: Page = await page(sql, table, cursor);
      // An empty table still gets one part, so a restore never has to guess.
      if (current.rows.length > 0 || part === 0) {
        part += 1;
        await archive.put(backupKey(day, table.name, part), JSON.stringify({ table: table.name, part, rows: current.rows }));
        objects += 1;
      }
      total += current.rows.length;
      cursor = current.next;
    } while (cursor);
    counts[table.name] = total;
    parts[table.name] = part;
  }
  await archive.put(
    backupKey(day, "manifest"),
    JSON.stringify({ day, createdAt: new Date(now).toISOString(), counts, parts }),
  );
  objects += 1;
  await deleteExpiredSessions(sql, now);
  return {
    users: counts.users ?? 0,
    scores: counts.scores ?? 0,
    friendships: counts.friendships ?? 0,
    objects,
  };
}
