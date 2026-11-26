import {
  FRIEND_DAYS,
  MAX_ACCOUNT_SCORES,
  MAX_FRIENDS,
  MAX_SYNC_SCORES,
  cleanScore,
  displayNameFrom,
  mergeScores,
  scoreKey,
} from "../lib/account.js";
import type { AccountStats, AccountView, FriendView, SyncResult } from "../lib/account.js";
import { cleanName, shiftDay } from "../lib/standings.js";
import { calendarDay } from "../lib/storage.js";
import type { ScoreEntry } from "../lib/storage.js";
import {
  addFriendship,
  areFriends,
  createSession,
  deleteExpiredSessions,
  deleteSession,
  deleteUser,
  deleteUserSessions,
  extendSession,
  friendCount,
  friendsOf,
  adminRole,
  getSession,
  getUser,
  liveStreak,
  recentScores,
  refreshStats,
  removeFriendship,
  saveScores,
  scoreOnDay,
  scoresOf,
  updateProfile,
  upsertUser,
} from "./account-db.js";
import type { UserRow } from "./account-db.js";
import { allowHit, setPictureFor } from "./board-db.js";
import {
  authorizeUrl,
  base64UrlToBytes,
  bytesToBase64Url,
  completeLogin,
  pkceChallenge,
  randomToken,
} from "./google.js";
import type { Fetcher, GoogleConfig } from "./google.js";
import {
  clearCookie,
  clientIp,
  cookieName,
  cookieValue,
  fail,
  json,
  originAllowed,
  readJson,
  secureRequest,
  setCookie,
} from "./http.js";
import type { Sql } from "./sql.js";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** Signed in for a year, and every day of use pushes that a year further out. */
export const SESSION_MS = 365 * DAY_MS;
const OAUTH_MS = 10 * 60 * 1000;
const MAX_BODY = 64 * 1024;

const ACCOUNT_COOKIE = "wl_account";
const OAUTH_COOKIE = "wl_oauth";

export type AccountLimits = {
  authPerHour: number;
  syncPerHour: number;
  friendPerHour: number;
  friendIpPerHour: number;
};

export const ACCOUNT_LIMITS: AccountLimits = {
  authPerHour: 30,
  syncPerHour: 120,
  friendPerHour: 60,
  friendIpPerHour: 200,
};

export type AccountDeps = {
  sql: Sql;
  /** Signs the sign-in cookie and the private friend links. */
  secret: string;
  now: () => number;
  google: GoogleConfig;
  fetcher: Fetcher;
  limits?: AccountLimits;
};

/** Where a person lands after signing in. Only these shapes, so the redirect cannot leave the site. */
const NEXT_PATH = /^\/(?:account|admin(?:\/top)?|friend\/[0-9a-f-]{36}\.[A-Za-z0-9_-]{22})?$/;

function safeNext(raw: string | null): string {
  return raw !== null && NEXT_PATH.test(raw) ? raw : "/";
}

/* ---------- Crypto helpers ---------- */

async function hmac(secret: string, payload: string): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

function sameText(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  return sameBytes(encoder.encode(left), encoder.encode(right));
}

async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/* ---------- The sign-in cookie: state, nonce and PKCE verifier, signed and short-lived ---------- */

type OauthState = { s: string; n: string; v: string; r: string; e: number };

async function sealState(secret: string, state: OauthState): Promise<string> {
  const body = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(state)));
  return `${body}.${bytesToBase64Url(await hmac(secret, `oauth|${body}`))}`;
}

async function openState(secret: string, sealed: string, now: number): Promise<OauthState | null> {
  const parts = sealed.split(".");
  if (parts.length !== 2) return null;
  const [body, signature] = parts as [string, string];
  const provided = base64UrlToBytes(signature);
  if (!provided || !sameBytes(provided, await hmac(secret, `oauth|${body}`))) return null;
  const bytes = base64UrlToBytes(body);
  if (!bytes) return null;
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes)) as Partial<OauthState>;
    if (
      typeof value.s !== "string" ||
      typeof value.n !== "string" ||
      typeof value.v !== "string" ||
      typeof value.r !== "string" ||
      typeof value.e !== "number" ||
      value.e < now
    ) {
      return null;
    }
    return { s: value.s, n: value.n, v: value.v, r: value.r, e: value.e };
  } catch {
    return null;
  }
}

/* ---------- Private friend links ---------- */

/** Nothing secret is stored. The link is the user id plus a signature that changes when the link is reset. */
export async function inviteToken(secret: string, user: Pick<UserRow, "id" | "inviteGen">): Promise<string> {
  const mac = await hmac(secret, `invite|${user.id}|${user.inviteGen}`);
  return `${user.id}.${bytesToBase64Url(mac.slice(0, 16))}`;
}

async function userForInvite(sql: Sql, secret: string, token: string): Promise<UserRow | null> {
  if (token.length > 80) return null;
  const dot = token.indexOf(".");
  if (dot !== 36) return null;
  const id = token.slice(0, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return null;
  const user = await getUser(sql, id);
  if (!user) return null;
  return sameText(token, await inviteToken(secret, user)) ? user : null;
}

/* ---------- Signed-in requests ---------- */

type Auth = { user: UserRow; tokenHash: string; token: string; renewed: boolean };

async function authenticate(request: Request, deps: AccountDeps): Promise<Auth | null> {
  const secure = secureRequest(request);
  const token = cookieValue(request.headers.get("cookie"), cookieName(ACCOUNT_COOKIE, secure));
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const now = deps.now();
  const tokenHash = await sha256Hex(token);
  const row = await getSession(deps.sql, tokenHash, now);
  if (!row) return null;
  let renewed = false;
  if (now - row.lastSeenAt > DAY_MS) {
    await extendSession(deps.sql, tokenHash, now, now + SESSION_MS);
    renewed = true;
  }
  return { user: row.user, tokenHash, token, renewed };
}

function reply(body: unknown, status: number, request: Request, auth: Auth | null): Response {
  const headers = new Headers();
  if (auth?.renewed) {
    const secure = secureRequest(request);
    headers.append(
      "set-cookie",
      setCookie(cookieName(ACCOUNT_COOKIE, secure), auth.token, { maxAge: Math.floor(SESSION_MS / 1000), secure }),
    );
  }
  return json(body, status, headers);
}

function redirect(location: string, cookies: string[]): Response {
  const headers = new Headers({
    location,
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(null, { status: 302, headers });
}

function statsOf(user: UserRow, today: string): AccountStats {
  return {
    totalPoints: user.totalPoints,
    wins: user.wins,
    streak: liveStreak(user.streak, user.streakDay, today),
    bestStreak: user.bestStreak,
  };
}

async function viewOf(user: UserRow, secret: string, today: string, sql: Sql): Promise<AccountView> {
  return {
    profile: { id: user.id, username: user.displayName, name: user.fullName || user.displayName, showPicture: user.showPicture, email: user.email, picture: user.picture, memberSince: user.createdAt },
    stats: statsOf(user, today),
    invitePath: `/friend/${await inviteToken(secret, user)}`,
    role: await adminRole(sql, user.email),
    unlocks: user.unlocks,
    today: await scoreOnDay(sql, user.id, today),
  };
}

async function limited(sql: Sql, key: string, limit: number, now: number, ttl: number): Promise<boolean> {
  return !(await allowHit(sql, key, limit, now, ttl));
}

function tokenFrom(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const token = (value as { token?: unknown }).token;
  return typeof token === "string" && token.length <= 80 ? token : null;
}

/** True when this path belongs to the account system. */
export function isAccountPath(pathname: string): boolean {
  return pathname.startsWith("/auth/") || pathname.startsWith("/api/account/") || pathname.startsWith("/api/friends/") || pathname === "/api/friends";
}

export async function handleAccount(request: Request, deps: AccountDeps): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const secure = secureRequest(request);
  const now = deps.now();
  const today = calendarDay(new Date(now));
  const limits = deps.limits ?? ACCOUNT_LIMITS;
  const ip = clientIp(request);

  if (path === "/auth/google" && request.method === "GET") return startLogin(request, deps, limits, ip, secure, now);
  if (path === "/auth/redirect" && request.method === "GET") return finishLogin(request, deps, limits, ip, secure, now);

  if (!path.startsWith("/api/")) return fail(404, "Not found.");
  if (!originAllowed(request)) return fail(403, "That request was refused.");
  if (deps.secret.length < 32) return fail(503, "Accounts are unavailable.");

  if (path === "/api/account/logout" && request.method === "POST") {
    const auth = await authenticate(request, deps);
    if (auth) await deleteSession(deps.sql, auth.tokenHash);
    const headers = new Headers({ "set-cookie": clearCookie(cookieName(ACCOUNT_COOKIE, secure), secure) });
    return json({ ok: true }, 200, headers);
  }

  const auth = await authenticate(request, deps);
  if (!auth) return fail(401, "Not signed in.");
  const user = auth.user;

  if (path === "/api/account/me" && request.method === "GET") {
    return reply({ account: await viewOf(user, deps.secret, today, deps.sql) }, 200, request, auth);
  }

  if (path === "/api/account/sync" && request.method === "POST") {
    if (await limited(deps.sql, `user:${user.id}:sync:${Math.floor(now / HOUR_MS)}`, limits.syncPerHour, now, HOUR_MS)) {
      return fail(429, "Too many syncs. Try again later.");
    }
    const body = await readJson(request, MAX_BODY);
    if (!body.ok) return fail(body.status, body.error);
    const sent = body.value && typeof body.value === "object" ? (body.value as { scores?: unknown }).scores : null;
    if (!Array.isArray(sent) || sent.length > MAX_SYNC_SCORES) return fail(400, "That sync was not understood.");
    const accepted: ScoreEntry[] = [];
    let rejected = 0;
    for (const item of sent) {
      const clean = cleanScore(item, today);
      if (clean) accepted.push(clean);
      else rejected += 1;
    }
    const held = await scoresOf(deps.sql, user.id);
    const have = new Map(held.map((entry) => [scoreKey(entry), entry]));
    const fresh = accepted.filter((entry) => {
      const existing = have.get(scoreKey(entry));
      return !existing || entry.score > existing.score;
    });
    const added = new Set(fresh.map(scoreKey));
    for (const key of have.keys()) added.delete(key);
    if (held.length + added.size > MAX_ACCOUNT_SCORES) return fail(413, "This account is full.");
    if (fresh.length > 0) await saveScores(deps.sql, user.id, fresh, now);
    const merged = mergeScores(held, accepted);
    const stats = fresh.length > 0 || user.wins !== merged.length ? await refreshStats(deps.sql, user.id, merged, today) : statsOf(user, today);
    const result: SyncResult = { scores: merged, stats, rejected };
    return reply(result, 200, request, auth);
  }

  if (path === "/api/account/profile" && request.method === "POST") {
    if (await limited(deps.sql, `user:${user.id}:profile:${Math.floor(now / HOUR_MS)}`, limits.friendPerHour, now, HOUR_MS)) {
      return fail(429, "Too many changes. Try again later.");
    }
    const body = await readJson(request, 1024);
    if (!body.ok) return fail(body.status, body.error);
    const input = body.value && typeof body.value === "object" ? (body.value as { username?: unknown; showPicture?: unknown }) : {};
    const change: { username?: string; showPicture?: boolean } = {};
    if (input.username !== undefined) {
      const username = typeof input.username === "string" ? cleanName(input.username) : null;
      if (!username) return fail(400, "Use letters and numbers, up to 24 characters.");
      change.username = username;
    }
    if (input.showPicture !== undefined) {
      if (typeof input.showPicture !== "boolean") return fail(400, "That change was not understood.");
      change.showPicture = input.showPicture;
    }
    if (change.username === undefined && change.showPicture === undefined) return fail(400, "That change was not understood.");
    if (!(await updateProfile(deps.sql, user.id, change))) return fail(404, "Not found.");
    // Hiding or showing the picture reaches the entries still on the leaderboard.
    if (change.showPicture !== undefined) await setPictureFor(deps.sql, user.id, change.showPicture ? user.picture : null);
    const fresh = await getUser(deps.sql, user.id);
    if (!fresh) return fail(404, "Not found.");
    return reply({ account: await viewOf(fresh, deps.secret, today, deps.sql) }, 200, request, auth);
  }

  if (path === "/api/account/invite/reset" && request.method === "POST") {
    if (await limited(deps.sql, `user:${user.id}:friend:${Math.floor(now / HOUR_MS)}`, limits.friendPerHour, now, HOUR_MS)) {
      return fail(429, "Too many requests. Try again later.");
    }
    const bumped = await deps.sql.run(`UPDATE users SET invite_gen = invite_gen + 1 WHERE id = ?`, [user.id]);
    if (bumped !== 1) return fail(404, "Not found.");
    const fresh = await getUser(deps.sql, user.id);
    if (!fresh) return fail(404, "Not found.");
    return reply({ invitePath: `/friend/${await inviteToken(deps.secret, fresh)}` }, 200, request, auth);
  }

  if (path === "/api/account/logout-all" && request.method === "POST") {
    await deleteUserSessions(deps.sql, user.id);
    const headers = new Headers({ "set-cookie": clearCookie(cookieName(ACCOUNT_COOKIE, secure), secure) });
    return json({ ok: true }, 200, headers);
  }

  if (path === "/api/account/delete" && request.method === "POST") {
    const body = await readJson(request, 1024);
    if (!body.ok) return fail(body.status, body.error);
    const confirm = body.value && typeof body.value === "object" ? (body.value as { confirm?: unknown }).confirm : null;
    if (confirm !== "delete") return fail(400, "Type delete to confirm.");
    await deleteUser(deps.sql, user.id);
    console.log(JSON.stringify({ event: "account-deleted" }));
    const headers = new Headers({ "set-cookie": clearCookie(cookieName(ACCOUNT_COOKIE, secure), secure) });
    return json({ ok: true }, 200, headers);
  }

  if (path === "/api/friends" && request.method === "GET") {
    const friends = await friendsOf(deps.sql, user.id);
    const since = shiftDay(today, -(FRIEND_DAYS - 1));
    const recent = await recentScores(deps.sql, friends.map((friend) => friend.id), since);
    const list: FriendView[] = friends.map((friend) => ({
      id: friend.id,
      name: friend.displayName,
      picture: friend.showPicture ? friend.picture : null,
      stats: statsOf(friend, today),
      recent: recent.get(friend.id) ?? [],
    }));
    return reply({ friends: list, limit: MAX_FRIENDS }, 200, request, auth);
  }

  if (path === "/api/friends/preview" && request.method === "POST") {
    if (await friendLimited(deps, limits, user.id, ip, now)) return fail(429, "Too many requests. Try again later.");
    const body = await readJson(request, 1024);
    if (!body.ok) return fail(body.status, body.error);
    const token = tokenFrom(body.value);
    const owner = token ? await userForInvite(deps.sql, deps.secret, token) : null;
    if (!owner) return fail(404, "That link does not work. Ask for a new one.");
    const self = owner.id === user.id;
    return reply(
      {
        name: owner.displayName,
        picture: owner.showPicture ? owner.picture : null,
        self,
        friends: self ? false : await areFriends(deps.sql, user.id, owner.id),
      },
      200,
      request,
      auth,
    );
  }

  if (path === "/api/friends/accept" && request.method === "POST") {
    if (await friendLimited(deps, limits, user.id, ip, now)) return fail(429, "Too many requests. Try again later.");
    const body = await readJson(request, 1024);
    if (!body.ok) return fail(body.status, body.error);
    const token = tokenFrom(body.value);
    const owner = token ? await userForInvite(deps.sql, deps.secret, token) : null;
    if (!owner) return fail(404, "That link does not work. Ask for a new one.");
    if (owner.id === user.id) return fail(400, "That is your own link.");
    if (!(await areFriends(deps.sql, user.id, owner.id))) {
      if ((await friendCount(deps.sql, user.id)) >= MAX_FRIENDS) return fail(409, "Your friend list is full.");
      if ((await friendCount(deps.sql, owner.id)) >= MAX_FRIENDS) return fail(409, "Their friend list is full.");
      await addFriendship(deps.sql, user.id, owner.id, now);
    }
    return reply({ ok: true, name: owner.displayName }, 200, request, auth);
  }

  if (path === "/api/friends/remove" && request.method === "POST") {
    if (await friendLimited(deps, limits, user.id, ip, now)) return fail(429, "Too many requests. Try again later.");
    const body = await readJson(request, 1024);
    if (!body.ok) return fail(body.status, body.error);
    const id = body.value && typeof body.value === "object" ? (body.value as { id?: unknown }).id : null;
    if (typeof id !== "string" || id.length !== 36) return fail(400, "That request was not understood.");
    await removeFriendship(deps.sql, user.id, id);
    return reply({ ok: true }, 200, request, auth);
  }

  return fail(404, "Not found.");
}

async function friendLimited(deps: AccountDeps, limits: AccountLimits, userId: string, ip: string, now: number): Promise<boolean> {
  const hour = Math.floor(now / HOUR_MS);
  const byUser = await limited(deps.sql, `user:${userId}:friend:${hour}`, limits.friendPerHour, now, HOUR_MS);
  const byIp = await limited(deps.sql, `ip:${ip}:friend:${hour}`, limits.friendIpPerHour, now, HOUR_MS);
  return byUser || byIp;
}

/* ---------- Sign in with Google ---------- */

async function startLogin(
  request: Request,
  deps: AccountDeps,
  limits: AccountLimits,
  ip: string,
  secure: boolean,
  now: number,
): Promise<Response> {
  const url = new URL(request.url);
  const home = new URL(deps.google.redirectUri).origin;
  // The sign-in cookie must be set on the same host Google sends the person back to.
  if (url.origin !== home) return redirect(`${home}${url.pathname}${url.search}`, []);
  if (deps.secret.length < 32 || !deps.google.clientId || !deps.google.clientSecret) return redirect("/?login=unavailable", []);
  if (await limited(deps.sql, `ip:${ip}:auth:${Math.floor(now / HOUR_MS)}`, limits.authPerHour, now, HOUR_MS)) {
    return redirect("/?login=busy", []);
  }
  const verifier = randomToken(48);
  const state: OauthState = {
    s: randomToken(),
    n: randomToken(),
    v: verifier,
    r: safeNext(url.searchParams.get("next")),
    e: now + OAUTH_MS,
  };
  const cookie = setCookie(cookieName(OAUTH_COOKIE, secure), await sealState(deps.secret, state), {
    maxAge: Math.floor(OAUTH_MS / 1000),
    secure,
  });
  const target = authorizeUrl(deps.google, { state: state.s, nonce: state.n, challenge: await pkceChallenge(verifier) });
  return redirect(target, [cookie]);
}

async function finishLogin(
  request: Request,
  deps: AccountDeps,
  limits: AccountLimits,
  ip: string,
  secure: boolean,
  now: number,
): Promise<Response> {
  const url = new URL(request.url);
  const spent = clearCookie(cookieName(OAUTH_COOKIE, secure), secure);
  if (await limited(deps.sql, `ip:${ip}:auth:${Math.floor(now / HOUR_MS)}`, limits.authPerHour, now, HOUR_MS)) {
    return redirect("/?login=busy", [spent]);
  }
  if (url.searchParams.get("error")) return redirect("/?login=cancelled", [spent]);
  const code = url.searchParams.get("code");
  const returned = url.searchParams.get("state");
  const sealed = cookieValue(request.headers.get("cookie"), cookieName(OAUTH_COOKIE, secure));
  if (!code || code.length > 2048 || !returned || !sealed || deps.secret.length < 32) return redirect("/?login=failed", [spent]);
  const state = await openState(deps.secret, sealed, now);
  if (!state || !sameText(state.s, returned)) return redirect("/?login=failed", [spent]);

  let identity;
  try {
    identity = await completeLogin(deps.google, { code, verifier: state.v, nonce: state.n }, deps.fetcher, now);
  } catch (error) {
    console.error(JSON.stringify({ event: "login", message: error instanceof Error ? error.message : "failed" }));
    return redirect("/?login=failed", [spent]);
  }
  if (!identity) return redirect("/?login=failed", [spent]);

  const user = await upsertUser(
    deps.sql,
    {
      sub: identity.sub,
      email: identity.email,
      fullName: identity.fullName,
      displayName: cleanName(displayNameFrom(identity.givenName, identity.fullName)) ?? "Player",
      picture: identity.picture,
    },
    crypto.randomUUID(),
    now,
  );
  const token = randomToken(32);
  await createSession(deps.sql, await sha256Hex(token), user.id, now, now + SESSION_MS);
  console.log(JSON.stringify({ event: "login", returning: user.createdAt < now }));
  const session = setCookie(cookieName(ACCOUNT_COOKIE, secure), token, { maxAge: Math.floor(SESSION_MS / 1000), secure });
  return redirect(state.r, [spent, session]);
}

/** The account signed in on this request, without renewing anything. Used by the leaderboard. */
export async function accountFromRequest(request: Request, sql: Sql, now: number): Promise<UserRow | null> {
  const token = cookieValue(request.headers.get("cookie"), cookieName(ACCOUNT_COOKIE, secureRequest(request)));
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const row = await getSession(sql, await sha256Hex(token), now);
  return row ? row.user : null;
}

/** Housekeeping for the weekly job. */
export async function pruneSessions(sql: Sql, now: number): Promise<void> {
  await deleteExpiredSessions(sql, now);
}
