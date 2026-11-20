import type { Move } from "@wordelate/game-math";

export const WIN_SIMILARITY_KEY = "wordelate.winSimilarity";
export const PLAYER_ID_KEY = "wordelate.playerId";
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
