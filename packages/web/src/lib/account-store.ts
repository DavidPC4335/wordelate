import { useEffect, useState } from "preact/hooks";
import { AUTO_SYNC_MAX, MAX_SYNC_SCORES, mergeScores, scoreKey, statsFor, streakFromDays } from "./account.js";
import type { AccountStats, AccountView } from "./account.js";
import type { CosmeticId } from "./rewards.js";
import { accountApi } from "./account-api.js";
import {
  BEST_STREAK_KEY,
  SCORES_KEY,
  STREAK_KEY,
  currentRewardStats,
  readBestStreak,
  readScores,
  readStreak,
  storageGet,
  storageRemove,
  storageSet,
  syncUnlocked,
  writeUnlockOverride,
  UNLOCK_OVERRIDE_KEY,
  UNLOCKED_KEY,
  calendarDay,
} from "./storage.js";
import type { ScoreEntry } from "./storage.js";

export const LINKED_KEY = "wordelate.linkedAccount";
export const SYNCED_AT_KEY = "wordelate.syncedAt";

export type SyncPhase = "idle" | "syncing" | "done" | "error";

export type AccountState = {
  status: "loading" | "out" | "in";
  account: AccountView | null;
  stats: AccountStats | null;
  sync: { phase: SyncPhase; message: string | null; at: number | null };
  /**
   * True when this device holds a lot of scores and the account already has some, so
   * merging them waits for a tap instead of happening on its own.
   */
  needsConfirm: boolean;
  /** How many scores this device would add. Only meaningful while `needsConfirm` is true. */
  localCount: number;
  /** Bumps when a sync changed what this device holds, so the game can read it again. */
  localVersion: number;
};

let state: AccountState = {
  status: "loading",
  account: null,
  stats: null,
  sync: { phase: "idle", message: null, at: readSyncedAt() },
  needsConfirm: false,
  localCount: 0,
  localVersion: 0,
};

const listeners = new Set<() => void>();

function readSyncedAt(): number | null {
  const value = Number(storageGet(SYNCED_AT_KEY));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function update(patch: Partial<AccountState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

export function getAccountState(): AccountState {
  return state;
}

export function useAccount(): AccountState {
  const [, setTick] = useState(0);
  useEffect(() => {
    const listener = () => setTick((tick) => tick + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return state;
}

/** True once this device has been linked to the signed-in account by a first sync. */
export function isLinked(account: AccountView | null): boolean {
  return account !== null && storageGet(LINKED_KEY) === account.profile.id;
}

function signedOut(): void {
  update({ status: "out", account: null, stats: null, needsConfirm: false, localCount: 0, sync: { phase: "idle", message: null, at: state.sync.at } });
}

/** The scores the account has that this device lacks or holds worse. They are added. Nothing is removed. */
function applyRemote(remote: readonly ScoreEntry[]): boolean {
  const local = readScores();
  const have = new Map<string, ScoreEntry>();
  for (const entry of local) {
    const key = scoreKey(entry);
    const held = have.get(key);
    if (!held || entry.score > held.score) have.set(key, entry);
  }
  const add = remote.filter((entry) => {
    const held = have.get(scoreKey(entry));
    return !held || entry.score > held.score;
  });
  if (add.length === 0) return false;
  const all = [...local, ...add];
  storageSet(SCORES_KEY, JSON.stringify(all));
  const run = streakFromDays(all.map((entry) => entry.day));
  const before = readStreak();
  if (run.lastDay !== null && (before.lastDay === null || run.lastDay >= before.lastDay)) {
    storageSet(STREAK_KEY, JSON.stringify({ count: run.count, lastDay: run.lastDay }));
  }
  storageSet(BEST_STREAK_KEY, String(Math.max(readBestStreak(), run.best)));
  syncUnlocked(currentRewardStats(all, readStreak()));
  return true;
}

function stamp(now: number): void {
  storageSet(SYNCED_AT_KEY, String(now));
}

/** Load who is signed in. Called once when the page opens. */
export async function loadAccount(): Promise<void> {
  const reply = await accountApi.me();
  if (reply.ok) {
    const account = reply.value.account;
    let version = state.localVersion;
    if (account.unlocks && account.unlocks.length > 0) {
      const next = JSON.stringify(account.unlocks);
      if (storageGet(UNLOCKED_KEY) !== next || storageGet(UNLOCK_OVERRIDE_KEY) !== "1") {
        writeUnlockOverride(account.unlocks);
        version += 1;
      }
    }
    update({ status: "in", account, stats: account.stats, localVersion: version });
    if (isLinked(account) || account.stats.wins === 0) {
      // Already linked, or a brand new account: nothing to decide. Save quietly.
      void syncAccount();
    } else {
      const count = mergeScores(readScores()).length;
      // A few scores merge on their own. A lot waits for the person to say so.
      if (count <= AUTO_SYNC_MAX) void syncAccount();
      else update({ needsConfirm: true, localCount: count });
    }
    watchVisibility();
    return;
  }
  if (reply.status === 401) {
    signedOut();
    return;
  }
  // The server could not be reached. Stay out of the way and let play continue.
  update({ status: "out" });
}

let watching = false;
let lastCheck = 0;
const RECHECK_MS = 5 * 60 * 1000;

/** Coming back to the tab after a while picks up wins from the account's other devices. */
function watchVisibility(): void {
  if (watching || typeof document === "undefined") return;
  watching = true;
  lastCheck = Date.now();
  document.addEventListener("visibilitychange", () => {
    const now = Date.now();
    if (document.visibilityState !== "visible" || now - lastCheck < RECHECK_MS) return;
    lastCheck = now;
    if (state.status === "in" && isLinked(state.account) && state.sync.phase !== "syncing") void syncAccount();
  });
}

/**
 * Send what this device has, take back what the account has, and keep the better of each.
 * The first time this runs for an account it also links this device to it.
 */
export async function syncAccount(): Promise<boolean> {
  const current = state.account;
  if (!current || state.sync.phase === "syncing") return false;
  update({ sync: { phase: "syncing", message: null, at: state.sync.at } });

  const local = mergeScores(readScores());
  const chunks: ScoreEntry[][] = [];
  for (let i = 0; i < local.length; i += MAX_SYNC_SCORES) chunks.push(local.slice(i, i + MAX_SYNC_SCORES));
  if (chunks.length === 0) chunks.push([]);

  let last = null;
  let rejected = 0;
  for (const chunk of chunks) {
    const reply = await accountApi.sync(chunk);
    if (!reply.ok) {
      if (reply.status === 401) {
        signedOut();
        return false;
      }
      update({ sync: { phase: "error", message: reply.error, at: state.sync.at } });
      return false;
    }
    last = reply.value;
    rejected += reply.value.rejected;
  }
  if (!last) return false;
  const changed = applyRemote(last.scores);
  storageSet(LINKED_KEY, current.profile.id);
  const now = Date.now();
  stamp(now);
  update({
    stats: last.stats,
    needsConfirm: false,
    localCount: 0,
    sync: {
      phase: "done",
      message: rejected > 0 ? `${rejected} older ${rejected === 1 ? "score" : "scores"} could not be saved.` : null,
      at: now,
    },
    localVersion: changed ? state.localVersion + 1 : state.localVersion,
  });
  return true;
}

/** After a game: save the newest win to the account right away. Quietly does nothing when signed out. */
export async function pushWin(entry: ScoreEntry): Promise<void> {
  const current = state.account;
  if (!current) return;
  const reply = await accountApi.sync([entry]);
  if (!reply.ok) {
    if (reply.status === 401) signedOut();
    else update({ sync: { phase: "error", message: "Your last score is saved here and will reach your account on the next sync.", at: state.sync.at } });
    return;
  }
  const now = Date.now();
  stamp(now);
  update({ stats: reply.value.stats, sync: { phase: "done", message: null, at: now } });
}

async function end(call: () => Promise<{ ok: boolean }>): Promise<boolean> {
  const reply = await call();
  if (!reply.ok) return false;
  storageRemove(LINKED_KEY);
  signedOut();
  return true;
}

export const logout = () => end(() => accountApi.logout());
export const logoutEverywhere = () => end(() => accountApi.logoutAll());
export const deleteAccount = () => end(() => accountApi.remove());

/** Change the username and/or whether the profile picture shows on the leaderboard. Returns an error message, or null. */
export async function updateProfile(change: { username?: string; showPicture?: boolean }): Promise<string | null> {
  const reply = await accountApi.profile(change);
  if (!reply.ok) {
    if (reply.status === 401) signedOut();
    return reply.error;
  }
  update({ account: reply.value.account });
  return null;
}

/** An admin replaced their account scores. This browser keeps the same list. */
export function adoptAccountScores(entries: readonly ScoreEntry[]): void {
  storageSet(SCORES_KEY, JSON.stringify(entries));
  const run = streakFromDays(entries.map((entry) => entry.day));
  storageSet(STREAK_KEY, JSON.stringify({ count: run.count, lastDay: run.lastDay }));
  storageSet(BEST_STREAK_KEY, String(run.best));
  const stats = statsFor(entries, calendarDay(new Date()));
  update({
    stats,
    account: state.account ? { ...state.account, stats } : state.account,
    localVersion: state.localVersion + 1,
  });
}

/** An admin set the looks on their account. */
export function adoptUnlocks(ids: readonly CosmeticId[]): void {
  writeUnlockOverride(ids);
  update({
    account: state.account ? { ...state.account, unlocks: [...ids] } : state.account,
    localVersion: state.localVersion + 1,
  });
}
