import type { Move } from "@wordelate/game-math";
import { COSMETICS, DEFAULT_COSMETIC, earnedIds, isCosmeticId } from "./rewards.js";
import type { CosmeticId, RewardStats } from "./rewards.js";

export const WIN_SIMILARITY_KEY = "wordelate.winSimilarity";
export const PLAYER_ID_KEY = "wordelate.playerId";
export const PATH_VIEW_KEY = "wordelate.path3d";
export const DEFAULT_WIN_SIMILARITY = 0.95;
export const MIN_WIN_SIMILARITY = 0.5;
export const MAX_WIN_SIMILARITY = 1;

const memory = new Map<string, string>();
let persistDisabled = false;

export type SavedGame = {
  moves: Move[];
  gaveUp: boolean;
};

function browserStorage(): Storage | null {
  if (persistDisabled) return null;
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    persistDisabled = true;
    return null;
  }
}

export function storageGet(key: string): string | null {
  const store = browserStorage();
  if (!store) return memory.get(key) ?? null;
  try {
    return store.getItem(key);
  } catch {
    persistDisabled = true;
    return memory.get(key) ?? null;
  }
}

export function storageSet(key: string, value: string): void {
  memory.set(key, value);
  const store = browserStorage();
  if (!store) return;
  try {
    store.setItem(key, value);
  } catch {
    persistDisabled = true;
  }
}

export function storageRemove(key: string): void {
  memory.delete(key);
  const store = browserStorage();
  if (!store) return;
  try {
    store.removeItem(key);
  } catch {
    persistDisabled = true;
  }
}

/** Snap to 0.01 and clamp to 0.50–1.00. Null when the text is not a number. */
export function parseWinSimilarity(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  const cents = Math.round(value * 100);
  const clamped = Math.min(100, Math.max(50, cents));
  return clamped / 100;
}

export function readWinSimilarity(): number | null {
  return parseWinSimilarity(storageGet(WIN_SIMILARITY_KEY));
}

export function writeWinSimilarity(value: number): void {
  const snapped = parseWinSimilarity(String(value)) ?? DEFAULT_WIN_SIMILARITY;
  storageSet(WIN_SIMILARITY_KEY, snapped.toFixed(2));
}

/** Query `win` wins over the stored line. An absent or unreadable query keeps storage. */
export function initialWinSimilarity(search: string): number {
  const params = new URLSearchParams(search);
  if (params.has("win")) {
    const fromQuery = parseWinSimilarity(params.get("win"));
    if (fromQuery != null) return fromQuery;
  }
  return readWinSimilarity() ?? DEFAULT_WIN_SIMILARITY;
}

function gameKey(puzzleId: string): string {
  return `wordelate.game.${puzzleId}`;
}

export function loadGame(puzzleId: string): SavedGame | null {
  const raw = storageGet(gameKey(puzzleId));
  if (raw == null) return null;
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object") return null;
    const record = data as { moves?: unknown; gaveUp?: unknown };
    if (!Array.isArray(record.moves)) return null;
    const moves: Move[] = [];
    for (const move of record.moves) {
      if (!move || typeof move !== "object") return null;
      const op = (move as { op?: unknown }).op;
      if (op === "undo") {
        moves.push({ op: "undo" });
        continue;
      }
      if (op !== "+" && op !== "-") return null;
      const word = (move as { word?: unknown }).word;
      if (typeof word !== "string" || word.trim().length === 0) return null;
      moves.push({ op, word: word.trim().toLowerCase() });
    }
    return { moves, gaveUp: record.gaveUp === true };
  } catch {
    return null;
  }
}

export function saveGame(puzzleId: string, game: SavedGame): void {
  storageSet(gameKey(puzzleId), JSON.stringify(game));
}

/** Shown unless the player has turned the path off. */
export function readPathView(): boolean {
  const stored = storageGet(PATH_VIEW_KEY);
  if (stored == null) return true;
  return stored === "1";
}

export function writePathView(enabled: boolean): void {
  storageSet(PATH_VIEW_KEY, enabled ? "1" : "0");
}

export function getPlayerId(): string {
  const existing = storageGet(PLAYER_ID_KEY);
  if (existing && existing.length > 0) return existing;
  const id = newPlayerId();
  storageSet(PLAYER_ID_KEY, id);
  return id;
}

function newPlayerId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to a non-crypto id. The demo still plays.
  }
  const bytes = new Uint8Array(16);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const SCORES_KEY = "wordelate.scores";
export const STREAK_KEY = "wordelate.streak";
export const SCORE_TIMEZONE = "America/New_York";

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export type ScoreEntry = {
  puzzleId: string;
  moves: number;
  score: number;
  /** Calendar day in America/New_York, YYYY-MM-DD. */
  day: string;
};

export type StreakState = {
  count: number;
  /** Last America/New_York day that counted, or null before the first win. */
  lastDay: string | null;
};

/** 160 points, minus 10 for each move, including an undo. Never below 0. */
export function scoreForMoves(moves: number): number {
  if (!Number.isFinite(moves) || moves <= 0) return 160;
  return Math.max(0, 160 - 10 * moves);
}

/** YYYY-MM-DD in the puzzle timezone. The browser zone is not used. */
export function calendarDay(date: Date, timeZone = SCORE_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) return "";
  return `${year}-${month}-${day}`;
}

function dayNumber(day: string): number | null {
  const match = DAY_RE.exec(day);
  const yearText = match?.[1];
  const monthText = match?.[2];
  const dateText = match?.[3];
  if (!yearText || !monthText || !dateText) return null;
  const year = Number(yearText);
  const month = Number(monthText);
  const date = Number(dateText);
  if (month < 1 || month > 12 || date < 1 || date > 31) return null;
  const utc = Date.UTC(year, month - 1, date);
  const check = new Date(utc);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== date
  ) {
    return null;
  }
  return utc;
}

function daysBetween(earlier: string, later: string): number | null {
  const start = dayNumber(earlier);
  const end = dayNumber(later);
  if (start == null || end == null) return null;
  return Math.round((end - start) / 86_400_000);
}

/**
 * One win counts per calendar day.
 * The next day increments. The same day holds. Any larger gap starts over at 1.
 */
export function nextStreak(state: StreakState, winDay: string): StreakState {
  if (state.lastDay === winDay) return { count: state.count, lastDay: state.lastDay };
  if (state.lastDay != null && daysBetween(state.lastDay, winDay) === 1) {
    return { count: state.count + 1, lastDay: winDay };
  }
  return { count: 1, lastDay: winDay };
}

/** Count still intact on `today`. A missed day reads as 0 and does not write storage. */
export function streakAsOf(state: StreakState, today: string): number {
  if (state.lastDay == null || state.count < 1) return 0;
  if (state.lastDay === today) return state.count;
  if (daysBetween(state.lastDay, today) === 1) return state.count;
  return 0;
}

export function totalScore(entries: readonly ScoreEntry[]): number {
  let total = 0;
  for (const entry of entries) total += entry.score;
  return total;
}

function isScoreEntry(value: unknown): value is ScoreEntry {
  if (!value || typeof value !== "object") return false;
  const record = value as { puzzleId?: unknown; moves?: unknown; score?: unknown; day?: unknown };
  return (
    typeof record.puzzleId === "string" &&
    record.puzzleId.length > 0 &&
    typeof record.moves === "number" &&
    Number.isInteger(record.moves) &&
    record.moves >= 0 &&
    typeof record.score === "number" &&
    Number.isInteger(record.score) &&
    record.score >= 0 &&
    typeof record.day === "string" &&
    DAY_RE.test(record.day)
  );
}

export function readScores(): ScoreEntry[] {
  const raw = storageGet(SCORES_KEY);
  if (raw == null) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter(isScoreEntry);
  } catch {
    return [];
  }
}

export function readStreak(): StreakState {
  const raw = storageGet(STREAK_KEY);
  if (raw == null) return { count: 0, lastDay: null };
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object") return { count: 0, lastDay: null };
    const record = data as { count?: unknown; lastDay?: unknown };
    const count = record.count;
    const lastDay = record.lastDay;
    if (typeof count !== "number" || !Number.isInteger(count) || count < 1) {
      return { count: 0, lastDay: null };
    }
    if (typeof lastDay !== "string" || !DAY_RE.test(lastDay)) return { count: 0, lastDay: null };
    return { count, lastDay };
  } catch {
    return { count: 0, lastDay: null };
  }
}

export const BEST_STREAK_KEY = "wordelate.bestStreak";
export const UNLOCKED_KEY = "wordelate.unlocked";
export const LOOK_KEY = "wordelate.look";
export const HOWTO_SEEN_KEY = "wordelate.howtoSeen";
export const LAST_PUZZLE_KEY = "wordelate.lastPuzzle";
const GAME_PREFIX = "wordelate.game.";

export function readBestStreak(): number {
  const value = Number(storageGet(BEST_STREAK_KEY));
  return Number.isInteger(value) && value > 0 ? value : 0;
}

/** Append one win and roll the streak. Give up never calls this. */
export function recordWin(input: { puzzleId: string; moves: number; day: string }): {
  scores: ScoreEntry[];
  streak: StreakState;
  bestStreak: number;
  earned: number;
} {
  const scores = readScores();
  const earned = scoreForMoves(input.moves);
  scores.push({
    puzzleId: input.puzzleId,
    moves: input.moves,
    score: earned,
    day: input.day,
  });
  storageSet(SCORES_KEY, JSON.stringify(scores));
  const streak = nextStreak(readStreak(), input.day);
  storageSet(STREAK_KEY, JSON.stringify(streak));
  const bestStreak = Math.max(readBestStreak(), streak.count);
  storageSet(BEST_STREAK_KEY, String(bestStreak));
  return { scores, streak, bestStreak, earned };
}

/** Best streak ever, including a streak that was earned before best streak was tracked. */
export function currentRewardStats(scores: readonly ScoreEntry[], streak: StreakState): RewardStats {
  return {
    totalPoints: totalScore(scores),
    bestStreak: Math.max(readBestStreak(), streak.count),
  };
}

export function readUnlocked(): CosmeticId[] {
  const raw = storageGet(UNLOCKED_KEY);
  if (raw == null) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter(isCosmeticId);
  } catch {
    return [];
  }
}

/**
 * Save every look the stats have earned, on top of what was saved before.
 * `fresh` is only what this call added, so the caller can celebrate it once.
 */
export function syncUnlocked(stats: RewardStats): { unlocked: CosmeticId[]; fresh: CosmeticId[] } {
  const saved = new Set(readUnlocked());
  const fresh: CosmeticId[] = [];
  for (const id of earnedIds(stats)) {
    if (saved.has(id)) continue;
    saved.add(id);
    if (id !== DEFAULT_COSMETIC) fresh.push(id);
  }
  saved.add(DEFAULT_COSMETIC);
  const unlocked = [...saved];
  storageSet(UNLOCKED_KEY, JSON.stringify(unlocked));
  return { unlocked, fresh };
}

/** Admin preview tool: mark every look as unlocked, whether or not it was earned. */
export function unlockAllLooks(): CosmeticId[] {
  const unlocked = COSMETICS.map((item) => item.id);
  storageSet(UNLOCKED_KEY, JSON.stringify(unlocked));
  return unlocked;
}

/** The equipped look, or the default when it is unknown or no longer unlocked. */
export function readLook(unlocked: readonly CosmeticId[]): CosmeticId {
  const stored = storageGet(LOOK_KEY);
  if (isCosmeticId(stored) && unlocked.includes(stored)) return stored;
  return DEFAULT_COSMETIC;
}

export function writeLook(id: CosmeticId): void {
  storageSet(LOOK_KEY, id);
}

export function readLastPuzzle(): string | null {
  const stored = storageGet(LAST_PUZZLE_KEY);
  return stored && stored.length > 0 ? stored : null;
}

export function writeLastPuzzle(id: string): void {
  storageSet(LAST_PUZZLE_KEY, id);
}

export function readHowToSeen(): boolean {
  return storageGet(HOWTO_SEEN_KEY) === "1";
}

export function writeHowToSeen(): void {
  storageSet(HOWTO_SEEN_KEY, "1");
}

function storageKeys(): string[] {
  const keys = new Set<string>(memory.keys());
  const store = browserStorage();
  if (store) {
    try {
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i);
        if (key) keys.add(key);
      }
    } catch {
      persistDisabled = true;
    }
  }
  return [...keys];
}

/**
 * True once the player has made a move, given up, or banked a score.
 * Opening a puzzle writes an empty game, which does not count.
 */
export function hasGameHistory(): boolean {
  if (readScores().length > 0) return true;
  for (const key of storageKeys()) {
    if (!key.startsWith(GAME_PREFIX)) continue;
    const game = loadGame(key.slice(GAME_PREFIX.length));
    if (game && (game.moves.length > 0 || game.gaveUp)) return true;
  }
  return false;
}
