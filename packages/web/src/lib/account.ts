/** Account rules shared by the Worker and the page. */
import type { CosmeticId } from "./rewards.js";
import { daysBetween, isDayKey, shiftDay } from "./standings.js";
import { scoreForMoves } from "./storage.js";
import type { ScoreEntry } from "./storage.js";

export const MAX_SYNC_SCORES = 300;
export const MAX_ACCOUNT_SCORES = 3000;
export const MAX_FRIENDS = 50;
/** How many recent days each friend shows. */
export const FRIEND_DAYS = 7;
/** Up to this many local scores sync on their own. More than this waits for a tap. */
export const AUTO_SYNC_MAX = 40;
/** No score may be older than the game itself. */
export const EARLIEST_DAY = "2026-01-01";

const PUZZLE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type AccountStats = {
  totalPoints: number;
  wins: number;
  streak: number;
  bestStreak: number;
};

export type AccountProfile = {
  id: string;
  /** The username friends and leaderboards see. */
  username: string;
  /** The full name Google gave, shown only to the person themself. */
  name: string;
  /** Whether the picture link may appear on the leaderboard. */
  showPicture: boolean;
  email: string;
  picture: string | null;
  memberSince: number;
};

export type AccountView = {
  profile: AccountProfile;
  stats: AccountStats;
  /** The private link that lets a friend add you. */
  invitePath: string;
  /** Server-checked. The page uses this only to show an admin link. */
  role: "player" | "admin" | "super";
  /** Set when an admin has chosen this account's looks. Null means they are earned. */
  unlocks: CosmeticId[] | null;
  /** Today's finished puzzle, when this account already has one. Other devices use it to stay locked. */
  today: { puzzleId: string; moves: number; score: number } | null;
};

export type FriendDay = { day: string; score: number; moves: number };

export type FriendView = {
  id: string;
  name: string;
  picture: string | null;
  stats: AccountStats;
  recent: FriendDay[];
};

export type SyncResult = {
  scores: ScoreEntry[];
  stats: AccountStats;
  /** Sent scores that did not pass the checks. */
  rejected: number;
};

export function scoreKey(entry: Pick<ScoreEntry, "day" | "puzzleId">): string {
  return `${entry.day}|${entry.puzzleId}`;
}

/** One acceptable score, or null. The points must match the moves, so a score cannot be made up. */
export function cleanScore(value: unknown, today: string): ScoreEntry | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { puzzleId?: unknown; moves?: unknown; score?: unknown; day?: unknown };
  const { puzzleId, moves, score, day } = record;
  if (typeof puzzleId !== "string" || puzzleId.length > 64 || !PUZZLE_ID.test(puzzleId)) return null;
  if (typeof moves !== "number" || !Number.isInteger(moves) || moves < 1 || moves > 16) return null;
  if (typeof score !== "number" || score !== scoreForMoves(moves)) return null;
  if (typeof day !== "string" || !isDayKey(day)) return null;
  if (day < EARLIEST_DAY || day > shiftDay(today, 1)) return null;
  return { puzzleId, moves, score, day };
}

/** Both lists as one, keeping the better score for a puzzle on a day. Oldest first. */
export function mergeScores(...lists: readonly (readonly ScoreEntry[])[]): ScoreEntry[] {
  const best = new Map<string, ScoreEntry>();
  for (const list of lists) {
    for (const entry of list) {
      const key = scoreKey(entry);
      const held = best.get(key);
      if (!held || entry.score > held.score || (entry.score === held.score && entry.moves < held.moves)) {
        best.set(key, entry);
      }
    }
  }
  return [...best.values()].sort((a, b) => (a.day === b.day ? a.puzzleId.localeCompare(b.puzzleId) : a.day.localeCompare(b.day)));
}

/** The streak that ends on the latest day with a win, and the longest streak anywhere. */
export function streakFromDays(days: Iterable<string>): { count: number; lastDay: string | null; best: number } {
  const sorted = [...new Set(days)].filter(isDayKey).sort();
  let best = 0;
  let run = 0;
  let previous: string | null = null;
  for (const day of sorted) {
    run = previous !== null && daysBetween(previous, day) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    previous = day;
  }
  return { count: run, lastDay: previous, best };
}

export function statsFor(entries: readonly ScoreEntry[], today: string): AccountStats {
  let totalPoints = 0;
  for (const entry of entries) totalPoints += entry.score;
  const run = streakFromDays(entries.map((entry) => entry.day));
  const live = run.lastDay !== null && (run.lastDay === today || daysBetween(run.lastDay, today) === 1);
  return { totalPoints, wins: entries.length, streak: live ? run.count : 0, bestStreak: run.best };
}

/** Names come from Google. Keep a short, plain first name for friends to see. */
export function displayNameFrom(givenName: unknown, fullName: unknown): string {
  const pick = (value: unknown): string =>
    typeof value === "string" ? value.normalize("NFKC").replace(/\p{C}+/gu, "").replace(/\p{Z}+/gu, " ").trim() : "";
  const given = pick(givenName);
  const full = pick(fullName);
  const first = given || full.split(" ")[0] || "";
  return Array.from(first).slice(0, 24).join("") || "Player";
}
