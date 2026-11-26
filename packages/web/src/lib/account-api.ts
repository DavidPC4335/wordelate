import type { AccountView, FriendView, SyncResult } from "./account.js";
import type { AdminOverview, TopPlayersView, TopWindow } from "./admin.js";
import type { Puzzle } from "./puzzles.js";

export type Reply<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

const NETWORK: Reply<never> = { ok: false, status: 0, error: "Could not reach Wordelate. Check your connection." };

async function call<T>(path: string, body?: unknown): Promise<Reply<T>> {
  try {
    const response = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (!response.ok) {
      const error =
        data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
          ? (data as { error: string }).error
          : "Something went wrong.";
      return { ok: false, status: response.status, error };
    }
    return { ok: true, value: data as T };
  } catch {
    return NETWORK;
  }
}

export const accountApi = {
  me: () => call<{ account: AccountView }>("/api/account/me"),
  sync: (scores: readonly unknown[]) => call<SyncResult>("/api/account/sync", { scores }),
  profile: (change: { username?: string; showPicture?: boolean }) => call<{ account: AccountView }>("/api/account/profile", change),
  resetInvite: () => call<{ invitePath: string }>("/api/account/invite/reset", {}),
  logout: () => call<{ ok: true }>("/api/account/logout", {}),
  logoutAll: () => call<{ ok: true }>("/api/account/logout-all", {}),
  remove: () => call<{ ok: true }>("/api/account/delete", { confirm: "delete" }),
  friends: () => call<{ friends: FriendView[]; limit: number }>("/api/friends"),
  preview: (token: string) => call<{ name: string; picture: string | null; self: boolean; friends: boolean }>("/api/friends/preview", { token }),
  accept: (token: string) => call<{ ok: true; name: string }>("/api/friends/accept", { token }),
  unfriend: (id: string) => call<{ ok: true }>("/api/friends/remove", { id }),
};

export const adminApi = {
  load: () => call<AdminOverview>("/api/admin"),
  addAdmin: (email: string) => call<AdminOverview>("/api/admin/admins", { email }),
  removeAdmin: (email: string) => call<AdminOverview>("/api/admin/admins/remove", { email }),
  saveQuestion: (position: number | null, puzzle: Puzzle) => call<AdminOverview>("/api/admin/questions", { position, puzzle }),
  /** Put a new question on that day. Its question and every later one move back a day. */
  insertQuestion: (position: number, puzzle: Puzzle) =>
    call<AdminOverview>("/api/admin/questions", { position, puzzle, insert: true }),
  /** The top players over the last 7, 30 or 90 days. */
  topPlayers: (days: TopWindow) => call<TopPlayersView>(`/api/admin/top?days=${days}`),
  saveAccount: (body: { scores?: readonly unknown[]; unlocks?: readonly string[] }) => call<AdminOverview>("/api/admin/account", body),
};

/** Where the Google sign-in starts. `next` is one of the few pages the server will return to. */
export function loginUrl(next?: string): string {
  return next && next !== "/" ? `/auth/google?next=${encodeURIComponent(next)}` : "/auth/google";
}
