import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import dailyPuzzles from "../public/puzzles.json" with { type: "json" };
import { MAX_FRIENDS, MAX_SYNC_SCORES } from "../src/lib/account.js";
import { scoreForMoves } from "../src/lib/storage.js";
import type { ScoreEntry } from "../src/lib/storage.js";
import { mergePuzzles } from "../src/lib/puzzles.js";
import { handleAdmin, handleSchedule } from "../src/worker/admin.js";
import { handleAccount } from "../src/worker/account.js";
import { resetScheduleCache } from "../src/worker/schedule.js";
import type { AccountDeps } from "../src/worker/account.js";
import { accountFromRequest } from "../src/worker/account.js";
import { backupAccounts, backupKey } from "../src/worker/backup.js";
import { bytesToBase64Url, pkceChallenge } from "../src/worker/google.js";
import type { GoogleConfig } from "../src/worker/google.js";
import type { Sql } from "../src/worker/sql.js";

const SECRET = "test-secret-test-secret-test-secret";
const NOW = Date.parse("2026-11-20T15:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const CLIENT_ID = "client-123.apps.googleusercontent.com";
const HOME = "http://127.0.0.1";

const SCHEMA = ["0001_board.sql", "0002_accounts.sql", "0003_profile.sql", "0004_admin.sql"]
  .map((file) => readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"))
  .join("\n");

function openSql(): { sql: Sql; db: DatabaseSync } {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  const sql: Sql = {
    async get(statement, params) {
      const row = db.prepare(statement).get(...(params as never[]));
      return (row as Record<string, unknown> | undefined) ?? null;
    },
    async all(statement, params) {
      return db.prepare(statement).all(...(params as never[])) as Record<string, unknown>[];
    },
    async run(statement, params) {
      return Number(db.prepare(statement).run(...(params as never[])).changes);
    },
    async batch(statements) {
      const changed: number[] = [];
      db.exec("BEGIN");
      try {
        for (const item of statements) {
          changed.push(Number(db.prepare(item.statement).run(...(item.params as never[])).changes));
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return changed;
    },
  };
  return { sql, db };
}

/* ---------- A fake Google that signs real RS256 tokens ---------- */

const pair = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"],
);
const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
const otherPair = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"],
);

function b64(text: string): string {
  return bytesToBase64Url(new TextEncoder().encode(text));
}

async function signToken(
  claims: Record<string, unknown>,
  options: { alg?: string; key?: CryptoKey; kid?: string } = {},
): Promise<string> {
  const head = b64(JSON.stringify({ alg: options.alg ?? "RS256", kid: options.kid ?? "k1", typ: "JWT" }));
  const body = b64(JSON.stringify(claims));
  if (options.alg === "none") return `${head}.${body}.`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    options.key ?? pair.privateKey,
    new TextEncoder().encode(`${head}.${body}`),
  );
  return `${head}.${body}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

const google: GoogleConfig = {
  clientId: CLIENT_ID,
  clientSecret: "shh-shh",
  redirectUri: `${HOME}/auth/redirect`,
  authUri: "https://accounts.example.test/auth",
  tokenUri: "https://accounts.example.test/token",
  jwksUri: "https://accounts.example.test/certs",
  issuers: ["https://accounts.google.com"],
};

type Grant = { redirect: string; challenge: string; nonce: string; claims: Record<string, unknown>; options: Parameters<typeof signToken>[1] };

class FakeGoogle {
  grants = new Map<string, Grant>();
  tokenCalls = 0;
  tokenBodies: URLSearchParams[] = [];

  fetcher = async (input: string, init?: RequestInit): Promise<Response> => {
    if (input === google.jwksUri) return Response.json({ keys: [{ ...publicJwk, kid: "k1", use: "sig", alg: "RS256" }] });
    if (input === google.tokenUri) {
      this.tokenCalls += 1;
      const form = new URLSearchParams(String(init?.body));
      this.tokenBodies.push(form);
      const grant = this.grants.get(form.get("code") ?? "");
      if (
        !grant ||
        form.get("client_secret") !== google.clientSecret ||
        form.get("client_id") !== CLIENT_ID ||
        form.get("redirect_uri") !== grant.redirect ||
        form.get("grant_type") !== "authorization_code" ||
        (await pkceChallenge(form.get("code_verifier") ?? "")) !== grant.challenge
      ) {
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      }
      this.grants.delete(form.get("code") ?? "");
      const token = await signToken({ nonce: grant.nonce, ...grant.claims }, grant.options);
      return Response.json({ id_token: token, access_token: "unused" });
    }
    return new Response("nope", { status: 404 });
  };

  /** The person approves on Google's page: Google sends back a code for the request the browser began. */
  approve(
    location: string,
    person: { sub: string; name?: string; given?: string; email?: string },
    tweak: {
      claims?: Record<string, unknown>;
      options?: Parameters<typeof signToken>[1];
      nonce?: string;
    } = {},
  ): { code: string; state: string } {
    const url = new URL(location);
    const code = `code-${this.grants.size}-${Math.random().toString(36).slice(2)}`;
    const seconds = Math.floor(NOW / 1000);
    this.grants.set(code, {
      redirect: url.searchParams.get("redirect_uri") ?? "",
      challenge: url.searchParams.get("code_challenge") ?? "",
      nonce: tweak.nonce ?? url.searchParams.get("nonce") ?? "",
      claims: {
        iss: "https://accounts.google.com",
        aud: CLIENT_ID,
        sub: person.sub,
        email: person.email ?? `${person.sub}@example.com`,
        email_verified: true,
        name: person.name ?? `Person ${person.sub}`,
        given_name: person.given ?? person.name?.split(" ")[0] ?? person.sub,
        picture: "https://lh3.googleusercontent.com/a/photo",
        iat: seconds,
        exp: seconds + 3600,
        ...tweak.claims,
      },
      options: tweak.options ?? {},
    });
    return { code, state: url.searchParams.get("state") ?? "" };
  }
}

/* ---------- Harness ---------- */

function harness(extra?: Partial<AccountDeps>) {
  const { sql, db } = openSql();
  const clock = { now: NOW };
  const fake = new FakeGoogle();
  const deps: AccountDeps = {
    sql,
    secret: SECRET,
    now: () => clock.now,
    google,
    fetcher: fake.fetcher,
    ...extra,
  };
  return { deps, clock, fake, sql, db };
}

type Harness = ReturnType<typeof harness>;

function cookiesOf(response: Response): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of response.headers.getSetCookie()) {
    const pair = line.split(";")[0] ?? "";
    const eq = pair.indexOf("=");
    out.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  return out;
}

function get(h: Harness, path: string, cookie = "", headers: HeadersInit = {}): Promise<Response> {
  return handleAccount(
    new Request(`${HOME}${path}`, { headers: { cookie, "cf-connecting-ip": "203.0.113.9", ...headers }, redirect: "manual" }),
    h.deps,
  );
}

function post(h: Harness, path: string, body: unknown, cookie = "", headers: HeadersInit = {}): Promise<Response> {
  return handleAccount(
    new Request(`${HOME}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "cf-connecting-ip": "203.0.113.9", ...headers },
      body: JSON.stringify(body),
    }),
    h.deps,
  );
}

/** Walk the whole sign-in and return the cookie header for the new session. */
async function login(
  h: Harness,
  person: { sub: string; name?: string; given?: string; email?: string },
  next = "",
): Promise<{ cookie: string; landed: string }> {
  const start = await get(h, `/auth/google${next}`);
  expect(start.status).toBe(302);
  const oauth = cookiesOf(start).get("wl_oauth");
  expect(oauth).toBeTruthy();
  const { code, state } = h.fake.approve(start.headers.get("location") ?? "", person);
  const back = await get(h, `/auth/redirect?code=${code}&state=${state}`, `wl_oauth=${oauth}`);
  expect(back.status).toBe(302);
  const account = cookiesOf(back).get("wl_account");
  expect(account).toBeTruthy();
  return { cookie: `wl_account=${account}`, landed: back.headers.get("location") ?? "" };
}

async function loginFails(h: Harness, cookie: string, query: string): Promise<Response> {
  const back = await get(h, `/auth/redirect?${query}`, cookie);
  expect(back.status).toBe(302);
  expect(back.headers.get("location")).toBe("/?login=failed");
  expect(cookiesOf(back).get("wl_account")).toBeUndefined();
  return back;
}

const entry = (day: string, puzzleId: string, moves: number): ScoreEntry => ({
  day,
  puzzleId,
  moves,
  score: scoreForMoves(moves),
});

/* ---------- Sign in ---------- */

describe("sign in with Google", () => {
  it("sends the person to Google with a state, a nonce and a PKCE challenge", async () => {
    const h = harness();
    const start = await get(h, "/auth/google");
    expect(start.status).toBe(302);
    const target = new URL(start.headers.get("location") ?? "");
    expect(`${target.origin}${target.pathname}`).toBe(google.authUri);
    expect(target.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(target.searchParams.get("redirect_uri")).toBe(google.redirectUri);
    expect(target.searchParams.get("response_type")).toBe("code");
    expect(target.searchParams.get("scope")).toBe("openid email profile");
    expect(target.searchParams.get("code_challenge_method")).toBe("S256");
    expect((target.searchParams.get("state") ?? "").length).toBeGreaterThanOrEqual(40);
    expect((target.searchParams.get("nonce") ?? "").length).toBeGreaterThanOrEqual(40);
    expect(start.headers.get("referrer-policy")).toBe("no-referrer");
    const header = start.headers.getSetCookie().join("\n");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    // The verifier travels in the signed cookie, never in the URL.
    expect(start.headers.get("location")).not.toContain("code_verifier");
  });

  it("creates the account, a hashed session, and lands on the home page", async () => {
    const h = harness();
    const { cookie, landed } = await login(h, { sub: "g-1", name: "Ada Lovelace", given: "Ada", email: "Ada@Example.com" });
    expect(landed).toBe("/");
    const me = await (await get(h, "/api/account/me", cookie)).json();
    expect(me.account.profile).toMatchObject({ name: "Ada Lovelace", email: "ada@example.com" });
    expect(me.account.invitePath).toMatch(/^\/friend\/[0-9a-f-]{36}\.[A-Za-z0-9_-]{22}$/);
    const stored = h.db.prepare("SELECT token_hash FROM sessions").all() as { token_hash: string }[];
    expect(stored).toHaveLength(1);
    const token = cookie.split("=")[1] ?? "";
    expect(stored[0]?.token_hash).not.toBe(token);
    expect(stored[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM users").get()).toMatchObject({ n: 1 });
  });

  it("keeps the same account across logins and refreshes the Google details", async () => {
    const h = harness();
    await login(h, { sub: "g-1", name: "Ada Lovelace", given: "Ada" });
    await login(h, { sub: "g-1", name: "Ada King", given: "Ada" });
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM users").get()).toMatchObject({ n: 1 });
    expect(h.db.prepare("SELECT full_name FROM users").get()).toMatchObject({ full_name: "Ada King" });
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM sessions").get()).toMatchObject({ n: 2 });
  });

  it("sets a long-lived HttpOnly cookie with the __Host- prefix over https", async () => {
    const h = harness({ google: { ...google, redirectUri: "https://wordelate.com/auth/redirect" } });
    const start = await handleAccount(new Request("https://wordelate.com/auth/google", { redirect: "manual" }), h.deps);
    const oauth = cookiesOf(start).get("__Host-wl_oauth");
    expect(oauth).toBeTruthy();
    const { code, state } = h.fake.approve(start.headers.get("location") ?? "", { sub: "g-2" });
    const back = await handleAccount(
      new Request(`https://wordelate.com/auth/redirect?code=${code}&state=${state}`, {
        headers: { cookie: `__Host-wl_oauth=${oauth}` },
        redirect: "manual",
      }),
      h.deps,
    );
    const line = back.headers.getSetCookie().find((value) => value.startsWith("__Host-wl_account="));
    expect(line).toBeTruthy();
    expect(line).toContain("HttpOnly");
    expect(line).toContain("Secure");
    expect(line).toContain("Path=/");
    expect(line).toContain("SameSite=Lax");
    expect(line).not.toContain("Domain");
    expect(line).toContain(`Max-Age=${365 * 24 * 60 * 60}`);
    expect(back.headers.getSetCookie().find((value) => value.startsWith("__Host-wl_oauth="))).toContain("Max-Age=0");
  });

  it("only lands on a safe page afterwards", async () => {
    const h = harness();
    expect((await login(h, { sub: "a" }, "?next=%2Faccount")).landed).toBe("/account");
    expect((await login(h, { sub: "b" }, "?next=https%3A%2F%2Fevil.example")).landed).toBe("/");
    expect((await login(h, { sub: "c" }, "?next=%2F%2Fevil.example")).landed).toBe("/");
    expect((await login(h, { sub: "d" }, "?next=%2Fapi%2Faccount%2Fdelete")).landed).toBe("/");
    const token = `${crypto.randomUUID()}.${"A".repeat(22)}`;
    expect((await login(h, { sub: "e" }, `?next=${encodeURIComponent(`/friend/${token}`)}`)).landed).toBe(`/friend/${token}`);
  });

  it("starts on the one host Google returns to", async () => {
    const h = harness();
    const response = await handleAccount(new Request("http://other.test/auth/google?next=%2Faccount", { redirect: "manual" }), h.deps);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`${HOME}/auth/google?next=%2Faccount`);
    expect(response.headers.getSetCookie()).toHaveLength(0);
  });

  it("refuses a return with the wrong state", async () => {
    const h = harness();
    const start = await get(h, "/auth/google");
    const oauth = cookiesOf(start).get("wl_oauth");
    const { code } = h.fake.approve(start.headers.get("location") ?? "", { sub: "g-1" });
    await loginFails(h, `wl_oauth=${oauth}`, `code=${code}&state=not-the-state`);
    expect(h.fake.tokenCalls).toBe(0);
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM users").get()).toMatchObject({ n: 0 });
  });

  it("refuses a return that did not begin in this browser", async () => {
    const h = harness();
    const start = await get(h, "/auth/google");
    const { code, state } = h.fake.approve(start.headers.get("location") ?? "", { sub: "g-1" });
    await loginFails(h, "", `code=${code}&state=${state}`);
    expect(h.fake.tokenCalls).toBe(0);
  });

  it("refuses a tampered or expired sign-in cookie", async () => {
    const h = harness();
    const start = await get(h, "/auth/google");
    const oauth = cookiesOf(start).get("wl_oauth") ?? "";
    const { code, state } = h.fake.approve(start.headers.get("location") ?? "", { sub: "g-1" });
    const [body, signature] = oauth.split(".") as [string, string];
    const forged = b64(JSON.stringify({ s: state, n: "x", v: "y", r: "/", e: NOW + DAY }));
    await loginFails(h, `wl_oauth=${forged}.${signature}`, `code=${code}&state=${state}`);
    await loginFails(h, `wl_oauth=${body}`, `code=${code}&state=${state}`);
    h.clock.now = NOW + 11 * 60 * 1000;
    await loginFails(h, `wl_oauth=${oauth}`, `code=${code}&state=${state}`);
    expect(h.fake.tokenCalls).toBe(0);
  });

  it("treats a cancelled consent screen as a plain return home", async () => {
    const h = harness();
    const back = await get(h, "/auth/redirect?error=access_denied&state=whatever", "wl_oauth=junk");
    expect(back.headers.get("location")).toBe("/?login=cancelled");
    expect(back.headers.getSetCookie().join("\n")).toContain("Max-Age=0");
  });

  it("does not let a code be replayed", async () => {
    const h = harness();
    const start = await get(h, "/auth/google");
    const oauth = cookiesOf(start).get("wl_oauth");
    const { code, state } = h.fake.approve(start.headers.get("location") ?? "", { sub: "g-1" });
    expect((await get(h, `/auth/redirect?code=${code}&state=${state}`, `wl_oauth=${oauth}`)).headers.get("location")).toBe("/");
    await loginFails(h, `wl_oauth=${oauth}`, `code=${code}&state=${state}`);
  });

  it("rejects an ID token that fails any check", async () => {
    const seconds = Math.floor(NOW / 1000);
    const cases: [string, { claims?: Record<string, unknown>; options?: Parameters<typeof signToken>[1]; nonce?: string }][] = [
      ["wrong nonce", { nonce: "somebody-elses-nonce" }],
      ["wrong audience", { claims: { aud: "someone-else.apps.googleusercontent.com" } }],
      ["wrong issuer", { claims: { iss: "https://evil.example" } }],
      ["expired", { claims: { exp: seconds - 3600 } }],
      ["future issue time", { claims: { iat: seconds + 3600 } }],
      ["email not verified", { claims: { email_verified: false } }],
      ["no email", { claims: { email: undefined } }],
      ["no subject", { claims: { sub: "" } }],
      ["algorithm none", { options: { alg: "none" } }],
      ["signed by another key", { options: { key: otherPair.privateKey } }],
      ["unknown key id", { options: { kid: "k404" } }],
      ["HMAC algorithm", { options: { alg: "HS256" } }],
    ];
    for (const [label, tweak] of cases) {
      const h = harness();
      const start = await get(h, "/auth/google");
      const oauth = cookiesOf(start).get("wl_oauth");
      const { code, state } = h.fake.approve(start.headers.get("location") ?? "", { sub: "g-1" }, tweak);
      const back = await get(h, `/auth/redirect?code=${code}&state=${state}`, `wl_oauth=${oauth}`);
      expect(back.headers.get("location"), label).toBe("/?login=failed");
      expect(cookiesOf(back).get("wl_account"), label).toBeUndefined();
      expect(h.db.prepare("SELECT COUNT(*) AS n FROM users").get(), label).toMatchObject({ n: 0 });
    }
  });

  it("sends the client secret and the PKCE verifier only to Google's token endpoint", async () => {
    const h = harness();
    await login(h, { sub: "g-1" });
    const body = h.fake.tokenBodies[0];
    expect(body?.get("client_secret")).toBe(google.clientSecret);
    expect((body?.get("code_verifier") ?? "").length).toBeGreaterThanOrEqual(43);
  });

  it("limits how often one connection can start a sign in", async () => {
    const h = harness();
    let last = 0;
    for (let i = 0; i < 35; i++) {
      const response = await get(h, "/auth/google");
      last = response.status;
      if (response.headers.get("location") === "/?login=busy") break;
    }
    const blocked = await get(h, "/auth/google");
    expect(blocked.headers.get("location")).toBe("/?login=busy");
    expect(last).toBe(302);
  });

  it("is unavailable until the Worker has its secrets", async () => {
    const h = harness({ google: { ...google, clientSecret: "" } });
    expect((await get(h, "/auth/google")).headers.get("location")).toBe("/?login=unavailable");
  });
});

/* ---------- Sessions ---------- */

describe("sessions", () => {
  it("rejects a missing, malformed or unknown token", async () => {
    const h = harness();
    expect((await get(h, "/api/account/me")).status).toBe(401);
    expect((await get(h, "/api/account/me", "wl_account=short")).status).toBe(401);
    expect((await get(h, "/api/account/me", `wl_account=${"a".repeat(43)}`)).status).toBe(401);
  });

  it("renews a year at a time while the person keeps coming back", async () => {
    const h = harness();
    const { cookie } = await login(h, { sub: "g-1" });
    h.clock.now = NOW + 200 * DAY;
    const renewed = await get(h, "/api/account/me", cookie);
    expect(renewed.status).toBe(200);
    expect(cookiesOf(renewed).get("wl_account")).toBe(cookie.split("=")[1]);
    expect(renewed.headers.getSetCookie().join("\n")).toContain(`Max-Age=${365 * 24 * 60 * 60}`);
    // 200 days in, the original year would be nearly gone. Renewal moved it out.
    h.clock.now = NOW + 500 * DAY;
    expect((await get(h, "/api/account/me", cookie)).status).toBe(200);
  });

  it("does not set a cookie on every request", async () => {
    const h = harness();
    const { cookie } = await login(h, { sub: "g-1" });
    h.clock.now = NOW + 60 * 60 * 1000;
    expect((await get(h, "/api/account/me", cookie)).headers.getSetCookie()).toHaveLength(0);
  });

  it("expires after a year of silence", async () => {
    const h = harness();
    const { cookie } = await login(h, { sub: "g-1" });
    h.clock.now = NOW + 366 * DAY;
    expect((await get(h, "/api/account/me", cookie)).status).toBe(401);
  });

  it("logs out one browser, and the old token stops working", async () => {
    const h = harness();
    const first = await login(h, { sub: "g-1" });
    const second = await login(h, { sub: "g-1" });
    const out = await post(h, "/api/account/logout", {}, first.cookie);
    expect(out.status).toBe(200);
    expect(out.headers.getSetCookie().join("\n")).toContain("Max-Age=0");
    expect((await get(h, "/api/account/me", first.cookie)).status).toBe(401);
    expect((await get(h, "/api/account/me", second.cookie)).status).toBe(200);
  });

  it("logs out everywhere", async () => {
    const h = harness();
    const first = await login(h, { sub: "g-1" });
    const second = await login(h, { sub: "g-1" });
    expect((await post(h, "/api/account/logout-all", {}, first.cookie)).status).toBe(200);
    expect((await get(h, "/api/account/me", first.cookie)).status).toBe(401);
    expect((await get(h, "/api/account/me", second.cookie)).status).toBe(401);
  });

  it("keeps only the newest ten sessions", async () => {
    const h = harness();
    const cookies: string[] = [];
    for (let i = 0; i < 12; i++) {
      h.clock.now = NOW + i * 1000;
      cookies.push((await login(h, { sub: "g-1" })).cookie);
    }
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM sessions").get()).toMatchObject({ n: 10 });
    expect((await get(h, "/api/account/me", cookies[0] ?? "")).status).toBe(401);
    expect((await get(h, "/api/account/me", cookies[11] ?? "")).status).toBe(200);
  });

  it("refuses a request from another site and one that is not JSON", async () => {
    const h = harness();
    const { cookie } = await login(h, { sub: "g-1" });
    expect((await post(h, "/api/account/sync", { scores: [] }, cookie, { origin: "https://evil.example" })).status).toBe(403);
    const form = await handleAccount(
      new Request(`${HOME}/api/account/sync`, {
        method: "POST",
        headers: { "content-type": "text/plain", cookie },
        body: JSON.stringify({ scores: [] }),
      }),
      h.deps,
    );
    expect(form.status).toBe(415);
  });
});

/* ---------- Sync ---------- */

describe("sync", () => {
  it("needs a signed-in person", async () => {
    const h = harness();
    expect((await post(h, "/api/account/sync", { scores: [] })).status).toBe(401);
  });

  it("saves scores, keeps the better one, and works out the stats", async () => {
    const h = harness();
    const { cookie } = await login(h, { sub: "g-1" });
    const first = await (await post(h, "/api/account/sync", { scores: [entry("2026-11-18", "a-b", 3), entry("2026-11-19", "c-d", 2)] }, cookie)).json();
    expect(first.scores).toHaveLength(2);
    expect(first.rejected).toBe(0);
    expect(first.stats).toMatchObject({ totalPoints: 130 + 140, wins: 2, streak: 2, bestStreak: 2 });

    const again = await (await post(h, "/api/account/sync", { scores: [entry("2026-11-18", "a-b", 3), entry("2026-11-20", "e-f", 1)] }, cookie)).json();
    expect(again.scores).toHaveLength(3);
    expect(again.stats).toMatchObject({ totalPoints: 130 + 140 + 150, wins: 3, streak: 3 });
    const me = await (await get(h, "/api/account/me", cookie)).json();
    expect(me.account.today).toEqual({ day: "2026-11-20", puzzleId: "e-f", moves: 1, score: 150 });

    const better = await (await post(h, "/api/account/sync", { scores: [entry("2026-11-18", "a-b", 1)] }, cookie)).json();
    expect(better.scores.find((s: ScoreEntry) => s.day === "2026-11-18")).toMatchObject({ moves: 1, score: 150 });
    const worse = await (await post(h, "/api/account/sync", { scores: [entry("2026-11-18", "a-b", 9)] }, cookie)).json();
    expect(worse.scores.find((s: ScoreEntry) => s.day === "2026-11-18")).toMatchObject({ moves: 1, score: 150 });
  });

  it("returns what the account holds when nothing is sent", async () => {
    const h = harness();
    const { cookie } = await login(h, { sub: "g-1" });
    await post(h, "/api/account/sync", { scores: [entry("2026-11-19", "c-d", 2)] }, cookie);
    const pulled = await (await post(h, "/api/account/sync", { scores: [] }, cookie)).json();
    expect(pulled.scores).toEqual([entry("2026-11-19", "c-d", 2)]);
  });

  it("ignores scores that were made up", async () => {
    const h = harness();
    const { cookie } = await login(h, { sub: "g-1" });
    const bad: unknown[] = [
      { day: "2026-11-19", puzzleId: "a-b", moves: 3, score: 160 },
      { day: "2026-11-19", puzzleId: "a-b", moves: 0, score: 160 },
      { day: "2026-11-19", puzzleId: "a-b", moves: 17, score: 0 },
      { day: "2026-11-19", puzzleId: "A B", moves: 3, score: 130 },
      { day: "2027-02-01", puzzleId: "a-b", moves: 3, score: 130 },
      { day: "2025-01-01", puzzleId: "a-b", moves: 3, score: 130 },
      { day: "2026-13-40", puzzleId: "a-b", moves: 3, score: 130 },
      { day: "2026-11-19", puzzleId: "a-b", moves: 3.5, score: 125 },
      "nonsense",
      null,
    ];
    const result = await (await post(h, "/api/account/sync", { scores: [...bad, entry("2026-11-19", "ok-ok", 3)] }, cookie)).json();
    expect(result.rejected).toBe(bad.length);
    expect(result.scores).toEqual([entry("2026-11-19", "ok-ok", 3)]);
  });

  it("refuses an oversized or malformed sync", async () => {
    const h = harness();
    const { cookie } = await login(h, { sub: "g-1" });
    const many = Array.from({ length: MAX_SYNC_SCORES + 1 }, () => entry("2026-11-19", "a-b", 3));
    expect((await post(h, "/api/account/sync", { scores: many }, cookie)).status).toBe(400);
    expect((await post(h, "/api/account/sync", { scores: "no" }, cookie)).status).toBe(400);
    expect((await post(h, "/api/account/sync", {}, cookie)).status).toBe(400);
  });

  it("keeps each person's scores apart", async () => {
    const h = harness();
    const ada = await login(h, { sub: "ada" });
    const bob = await login(h, { sub: "bob" });
    await post(h, "/api/account/sync", { scores: [entry("2026-11-19", "a-b", 3)] }, ada.cookie);
    const seen = await (await post(h, "/api/account/sync", { scores: [] }, bob.cookie)).json();
    expect(seen.scores).toEqual([]);
    expect(seen.stats.totalPoints).toBe(0);
  });

  it("limits how often a person can sync", async () => {
    const h = harness({ limits: { authPerHour: 30, syncPerHour: 3, friendPerHour: 60, friendIpPerHour: 200 } });
    const { cookie } = await login(h, { sub: "g-1" });
    for (let i = 0; i < 3; i++) expect((await post(h, "/api/account/sync", { scores: [] }, cookie)).status).toBe(200);
    expect((await post(h, "/api/account/sync", { scores: [] }, cookie)).status).toBe(429);
  });

  it("shows a streak only while it is still alive", async () => {
    const h = harness();
    const { cookie } = await login(h, { sub: "g-1" });
    await post(h, "/api/account/sync", { scores: [entry("2026-11-10", "a-b", 3), entry("2026-11-11", "a-c", 3)] }, cookie);
    const me = await (await get(h, "/api/account/me", cookie)).json();
    expect(me.account.stats).toMatchObject({ streak: 0, bestStreak: 2, wins: 2 });
  });
});

/* ---------- Friends ---------- */

async function befriend(h: Harness, owner: { cookie: string }, guest: { cookie: string }): Promise<string> {
  const me = await (await get(h, "/api/account/me", owner.cookie)).json();
  const token = String(me.account.invitePath).replace("/friend/", "");
  const accepted = await post(h, "/api/friends/accept", { token }, guest.cookie);
  expect(accepted.status).toBe(200);
  return token;
}

describe("friends", () => {
  it("previews and accepts a private link, and both see each other", async () => {
    const h = harness();
    const ada = await login(h, { sub: "ada", name: "Ada Lovelace", given: "Ada" });
    const bob = await login(h, { sub: "bob", name: "Bob Barker", given: "Bob" });
    await post(h, "/api/account/sync", { scores: [entry("2026-11-20", "a-b", 2)] }, ada.cookie);
    await post(h, "/api/account/sync", { scores: [entry("2026-11-19", "c-d", 5), entry("2026-11-20", "a-b", 3)] }, bob.cookie);
    const me = await (await get(h, "/api/account/me", ada.cookie)).json();
    const token = String(me.account.invitePath).replace("/friend/", "");

    const preview = await (await post(h, "/api/friends/preview", { token }, bob.cookie)).json();
    expect(preview).toMatchObject({ name: "Ada", self: false, friends: false });
    expect((await post(h, "/api/friends/accept", { token }, bob.cookie)).status).toBe(200);
    // Doing it twice changes nothing.
    expect((await post(h, "/api/friends/accept", { token }, bob.cookie)).status).toBe(200);
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM friendships").get()).toMatchObject({ n: 1 });

    const bobsFriends = await (await get(h, "/api/friends", bob.cookie)).json();
    expect(bobsFriends.friends).toHaveLength(1);
    expect(bobsFriends.friends[0]).toMatchObject({ name: "Ada", stats: { totalPoints: 140, wins: 1 } });
    expect(bobsFriends.friends[0].recent).toEqual([{ day: "2026-11-20", score: 140, moves: 2 }]);

    const adasFriends = await (await get(h, "/api/friends", ada.cookie)).json();
    expect(adasFriends.friends[0]).toMatchObject({ name: "Bob", stats: { totalPoints: 110 + 130, wins: 2 } });
    expect(adasFriends.friends[0].recent.map((r: { day: string }) => r.day)).toEqual(["2026-11-20", "2026-11-19"]);
  });

  it("never shows a friend's email, full name, or Google id", async () => {
    const h = harness();
    const ada = await login(h, { sub: "ada-secret-sub", name: "Ada Lovelace", given: "Ada", email: "ada.private@example.com" });
    const bob = await login(h, { sub: "bob" });
    await befriend(h, ada, bob);
    const text = JSON.stringify(await (await get(h, "/api/friends", bob.cookie)).json());
    expect(text).not.toContain("ada.private");
    expect(text).not.toContain("Lovelace");
    expect(text).not.toContain("ada-secret-sub");
  });

  it("refuses a link that was altered, made up, or is your own", async () => {
    const h = harness();
    const ada = await login(h, { sub: "ada" });
    const bob = await login(h, { sub: "bob" });
    const me = await (await get(h, "/api/account/me", ada.cookie)).json();
    const token = String(me.account.invitePath).replace("/friend/", "");
    const [id, mac] = token.split(".") as [string, string];
    const altered = `${id}.${mac.slice(0, -1)}${mac.endsWith("A") ? "B" : "A"}`;
    expect((await post(h, "/api/friends/preview", { token: altered }, bob.cookie)).status).toBe(404);
    expect((await post(h, "/api/friends/accept", { token: altered }, bob.cookie)).status).toBe(404);
    expect((await post(h, "/api/friends/accept", { token: `${crypto.randomUUID()}.${mac}` }, bob.cookie)).status).toBe(404);
    expect((await post(h, "/api/friends/accept", { token: "nonsense" }, bob.cookie)).status).toBe(404);
    expect((await post(h, "/api/friends/accept", {}, bob.cookie)).status).toBe(404);
    expect((await post(h, "/api/friends/accept", { token }, ada.cookie)).status).toBe(400);
    expect(await (await post(h, "/api/friends/preview", { token }, ada.cookie)).json()).toMatchObject({ self: true });
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM friendships").get()).toMatchObject({ n: 0 });
  });

  it("needs a signed-in person to use a link", async () => {
    const h = harness();
    const ada = await login(h, { sub: "ada" });
    const me = await (await get(h, "/api/account/me", ada.cookie)).json();
    const token = String(me.account.invitePath).replace("/friend/", "");
    expect((await post(h, "/api/friends/preview", { token })).status).toBe(401);
    expect((await post(h, "/api/friends/accept", { token })).status).toBe(401);
    expect((await get(h, "/api/friends")).status).toBe(401);
  });

  it("keeps a link the same until it is reset, then the old one dies", async () => {
    const h = harness();
    const ada = await login(h, { sub: "ada" });
    const bob = await login(h, { sub: "bob" });
    const cy = await login(h, { sub: "cy" });
    const one = String((await (await get(h, "/api/account/me", ada.cookie)).json()).account.invitePath);
    const two = String((await (await get(h, "/api/account/me", ada.cookie)).json()).account.invitePath);
    expect(two).toBe(one);
    const reset = await (await post(h, "/api/account/invite/reset", {}, ada.cookie)).json();
    expect(reset.invitePath).not.toBe(one);
    expect((await post(h, "/api/friends/accept", { token: one.replace("/friend/", "") }, bob.cookie)).status).toBe(404);
    expect((await post(h, "/api/friends/accept", { token: String(reset.invitePath).replace("/friend/", "") }, cy.cookie)).status).toBe(200);
  });

  it("lets either side remove a friend", async () => {
    const h = harness();
    const ada = await login(h, { sub: "ada" });
    const bob = await login(h, { sub: "bob" });
    await befriend(h, ada, bob);
    const list = await (await get(h, "/api/friends", ada.cookie)).json();
    const bobId = list.friends[0].id as string;
    expect((await post(h, "/api/friends/remove", { id: bobId }, ada.cookie)).status).toBe(200);
    expect((await (await get(h, "/api/friends", bob.cookie)).json()).friends).toHaveLength(0);
    // A stranger cannot remove other people's friendships.
    await befriend(h, ada, bob);
    const cy = await login(h, { sub: "cy" });
    await post(h, "/api/friends/remove", { id: bobId }, cy.cookie);
    expect((await (await get(h, "/api/friends", ada.cookie)).json()).friends).toHaveLength(1);
    expect((await post(h, "/api/friends/remove", { id: "short" }, ada.cookie)).status).toBe(400);
  });

  it("stops at the friend limit", async () => {
    const h = harness({ limits: { authPerHour: 1000, syncPerHour: 1000, friendPerHour: 1000, friendIpPerHour: 1000 } });
    const ada = await login(h, { sub: "ada" });
    const me = await (await get(h, "/api/account/me", ada.cookie)).json();
    const token = String(me.account.invitePath).replace("/friend/", "");
    const adaId = token.slice(0, 36);
    for (let i = 0; i < MAX_FRIENDS; i++) {
      const id = crypto.randomUUID();
      h.db
        .prepare(
          "INSERT INTO users (id, google_sub, email, full_name, display_name, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, 1, 1)",
        )
        .run(id, `sub-${i}`, `u${i}@example.com`, `User ${i}`, `User${i}`);
      const [a, b] = id < adaId ? [id, adaId] : [adaId, id];
      h.db.prepare("INSERT INTO friendships (user_a, user_b, created_at) VALUES (?, ?, 1)").run(a, b);
    }
    const bob = await login(h, { sub: "bob" });
    expect((await post(h, "/api/friends/accept", { token }, bob.cookie)).status).toBe(409);
  });

  it("limits how fast a person can try links", async () => {
    const h = harness({ limits: { authPerHour: 30, syncPerHour: 120, friendPerHour: 3, friendIpPerHour: 200 } });
    const bob = await login(h, { sub: "bob" });
    for (let i = 0; i < 3; i++) expect((await post(h, "/api/friends/preview", { token: "x" }, bob.cookie)).status).toBe(404);
    expect((await post(h, "/api/friends/preview", { token: "x" }, bob.cookie)).status).toBe(429);
  });
});

/* ---------- Deleting an account ---------- */

describe("deleting an account", () => {
  it("removes the person, their scores, sessions and friendships", async () => {
    const h = harness();
    const ada = await login(h, { sub: "ada" });
    const bob = await login(h, { sub: "bob" });
    await post(h, "/api/account/sync", { scores: [entry("2026-11-20", "a-b", 2)] }, ada.cookie);
    await befriend(h, ada, bob);
    expect((await post(h, "/api/account/delete", { confirm: "nope" }, ada.cookie)).status).toBe(400);
    const gone = await post(h, "/api/account/delete", { confirm: "delete" }, ada.cookie);
    expect(gone.status).toBe(200);
    expect(gone.headers.getSetCookie().join("\n")).toContain("Max-Age=0");
    expect((await get(h, "/api/account/me", ada.cookie)).status).toBe(401);
    for (const table of ["account_scores", "friendships"]) {
      expect(h.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toMatchObject({ n: 0 });
    }
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM users").get()).toMatchObject({ n: 1 });
    expect((await get(h, "/api/account/me", bob.cookie)).status).toBe(200);
    expect((await (await get(h, "/api/friends", bob.cookie)).json()).friends).toHaveLength(0);
  });
});

/* ---------- Profile ---------- */

describe("profile", () => {
  const profileOf = async (h: Harness, cookie: string) => (await (await get(h, "/api/account/me", cookie)).json()).account.profile;

  it("starts with the Google first name as the username, picture shown", async () => {
    const h = harness();
    const { cookie } = await login(h, { sub: "ada", name: "Ada Lovelace", given: "Ada" });
    expect(await profileOf(h, cookie)).toMatchObject({ username: "Ada", name: "Ada Lovelace", showPicture: true });
  });

  it("changes the username, and keeps it through the next login", async () => {
    const h = harness();
    const { cookie } = await login(h, { sub: "ada", name: "Ada Lovelace", given: "Ada" });
    const done = await post(h, "/api/account/profile", { username: "  Countess  Ada " }, cookie);
    expect(done.status).toBe(200);
    expect((await done.json()).account.profile.username).toBe("Countess Ada");
    const again = await login(h, { sub: "ada", name: "Ada King", given: "Ada" });
    expect(await profileOf(h, again.cookie)).toMatchObject({ username: "Countess Ada", name: "Ada King" });
  });

  it("refuses usernames that are empty, too long, or not plain text", async () => {
    const h = harness();
    const { cookie } = await login(h, { sub: "ada", given: "Ada" });
    for (const username of ["", "  ", "x".repeat(25), "<script>", "ada 🔥", "ada\u202eevil", 42, null]) {
      expect((await post(h, "/api/account/profile", { username }, cookie)).status).toBe(400);
    }
    expect((await post(h, "/api/account/profile", {}, cookie)).status).toBe(400);
    expect((await post(h, "/api/account/profile", { showPicture: "yes" }, cookie)).status).toBe(400);
    expect((await profileOf(h, cookie)).username).toBe("Ada");
  });

  it("accepts accented names", async () => {
    const h = harness();
    const { cookie } = await login(h, { sub: "ada", given: "Ada" });
    expect((await post(h, "/api/account/profile", { username: "José Ñandú" }, cookie)).status).toBe(200);
    expect((await profileOf(h, cookie)).username).toBe("José Ñandú");
  });

  it("needs a signed-in person and a same-site JSON request", async () => {
    const h = harness();
    const { cookie } = await login(h, { sub: "ada", given: "Ada" });
    expect((await post(h, "/api/account/profile", { username: "Zed" })).status).toBe(401);
    expect((await post(h, "/api/account/profile", { username: "Zed" }, cookie, { origin: "https://evil.example" })).status).toBe(403);
  });

  it("hides the picture link from the board entries and brings it back", async () => {
    const h = harness();
    const { cookie } = await login(h, { sub: "ada", given: "Ada" });
    const id = (await profileOf(h, cookie)).id as string;
    const photo = "https://lh3.googleusercontent.com/a/photo";
    h.db.prepare(
      `INSERT INTO scores (day, player_id, puzzle_id, score, moves, answer_json, name, user_id, picture, created_at)
       VALUES ('2026-11-20', ?, 'a-b', 150, 1, '[]', 'Ada', ?, ?, 1)`,
    ).run("p".repeat(36), id, photo);
    const picture = () => (h.db.prepare("SELECT picture FROM scores").get() as { picture: string | null }).picture;

    expect((await post(h, "/api/account/profile", { showPicture: false }, cookie)).status).toBe(200);
    expect(picture()).toBeNull();
    expect((await profileOf(h, cookie)).showPicture).toBe(false);

    // Signing in again does not turn it back on.
    const again = await login(h, { sub: "ada", given: "Ada" });
    expect((await profileOf(h, again.cookie)).showPicture).toBe(false);

    expect((await post(h, "/api/account/profile", { showPicture: true }, cookie)).status).toBe(200);
    expect(picture()).toBe(photo);
  });

  it("keeps a hidden picture from friends too", async () => {
    const h = harness();
    const ada = await login(h, { sub: "ada", given: "Ada" });
    const bob = await login(h, { sub: "bob", given: "Bob" });
    const link = await befriend(h, ada, bob);
    expect(link).toBeTruthy();
    const seen = async () => (await (await get(h, "/api/friends", bob.cookie)).json()).friends[0].picture;
    expect(await seen()).toBe("https://lh3.googleusercontent.com/a/photo");
    await post(h, "/api/account/profile", { showPicture: false }, ada.cookie);
    expect(await seen()).toBeNull();
  });

  it("gives the board the account only while signed in, without the picture when hidden", async () => {
    const h = harness();
    const { cookie } = await login(h, { sub: "ada", given: "Ada" });
    const request = (cookieHeader: string) => new Request(`${HOME}/api/leaderboard`, { headers: { cookie: cookieHeader } });
    expect(await accountFromRequest(request(cookie), h.sql, NOW)).toMatchObject({ displayName: "Ada", showPicture: true });
    expect(await accountFromRequest(request(""), h.sql, NOW)).toBeNull();
    expect(await accountFromRequest(request("wl_account=nope"), h.sql, NOW)).toBeNull();
    await post(h, "/api/account/logout", {}, cookie);
    expect(await accountFromRequest(request(cookie), h.sql, NOW)).toBeNull();
  });

  it("limits how often the profile can change", async () => {
    const h = harness();
    const { cookie } = await login(h, { sub: "ada", given: "Ada" });
    let last = 200;
    for (let i = 0; i < 70 && last === 200; i++) {
      last = (await post(h, "/api/account/profile", { username: `Name${i}` }, cookie)).status;
    }
    expect(last).toBe(429);
  });

  it("scrubs the name, picture and link from board entries when the account is deleted", async () => {
    const h = harness();
    const { cookie } = await login(h, { sub: "ada", given: "Ada" });
    const id = (await profileOf(h, cookie)).id as string;
    h.db.prepare(
      `INSERT INTO scores (day, player_id, puzzle_id, score, moves, answer_json, name, user_id, picture, created_at)
       VALUES ('2026-11-20', ?, 'a-b', 150, 1, '[]', 'Ada', ?, 'https://lh3.googleusercontent.com/a/photo', 1)`,
    ).run("p".repeat(36), id);
    expect((await post(h, "/api/account/delete", { confirm: "delete" }, cookie)).status).toBe(200);
    expect(h.db.prepare("SELECT name, user_id, picture, score FROM scores").get()).toMatchObject({
      name: null,
      user_id: null,
      picture: null,
      score: 150,
    });
  });
});

/* ---------- Weekly backup ---------- */

describe("weekly backup", () => {
  function archive() {
    const objects = new Map<string, string>();
    return { objects, put: async (key: string, body: string) => void objects.set(key, body) };
  }

  it("copies users, scores and friendships to R2, but never sessions", async () => {
    const h = harness();
    const ada = await login(h, { sub: "ada", email: "ada@example.com" });
    const bob = await login(h, { sub: "bob" });
    await post(h, "/api/account/sync", { scores: [entry("2026-11-20", "a-b", 2)] }, ada.cookie);
    await befriend(h, ada, bob);
    const store = archive();
    const result = await backupAccounts(h.sql, store, "2026-11-22", NOW);
    expect(result).toMatchObject({ users: 2, scores: 1, friendships: 1 });
    expect([...store.objects.keys()].sort()).toEqual([
      backupKey("2026-11-22", "admin_audit", 1),
      backupKey("2026-11-22", "admins", 1),
      backupKey("2026-11-22", "friendships", 1),
      backupKey("2026-11-22", "manifest"),
      backupKey("2026-11-22", "questions", 1),
      backupKey("2026-11-22", "scores", 1),
      backupKey("2026-11-22", "users", 1),
    ]);
    const users = JSON.parse(store.objects.get(backupKey("2026-11-22", "users", 1)) ?? "{}");
    expect(users.rows).toHaveLength(2);
    expect(users.rows.map((r: { email: string }) => r.email)).toContain("ada@example.com");
    const everything = [...store.objects.values()].join("\n");
    expect(everything).not.toContain("token_hash");
    const sessions = h.db.prepare("SELECT token_hash FROM sessions").all() as { token_hash: string }[];
    for (const row of sessions) expect(everything).not.toContain(row.token_hash);
    const manifest = JSON.parse(store.objects.get(backupKey("2026-11-22", "manifest")) ?? "{}");
    expect(manifest).toMatchObject({ day: "2026-11-22", counts: { users: 2, scores: 1, friendships: 1 } });
  });

  it("writes an empty part for an empty table, so a restore never guesses", async () => {
    const h = harness();
    const store = archive();
    await backupAccounts(h.sql, store, "2026-11-22", NOW);
    expect(JSON.parse(store.objects.get(backupKey("2026-11-22", "users", 1)) ?? "{}").rows).toEqual([]);
    expect(store.objects.has(backupKey("2026-11-22", "manifest"))).toBe(true);
  });

  it("splits a large table into parts without losing or repeating a row", async () => {
    const h = harness();
    h.db.exec("BEGIN");
    const insert = h.db.prepare(
      "INSERT INTO users (id, google_sub, email, full_name, display_name, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, 1, 1)",
    );
    const ids: string[] = [];
    for (let i = 0; i < 2005; i++) {
      const id = crypto.randomUUID();
      ids.push(id);
      insert.run(id, `sub-${i}`, `u${i}@example.com`, `User ${i}`, `U${i}`);
    }
    h.db.exec("COMMIT");
    const store = archive();
    const result = await backupAccounts(h.sql, store, "2026-11-22", NOW);
    expect(result.users).toBe(2005);
    const seen: string[] = [];
    for (const part of [1, 2, 3]) {
      const body = JSON.parse(store.objects.get(backupKey("2026-11-22", "users", part)) ?? "{}");
      for (const row of body.rows) seen.push(row.id);
    }
    expect(seen).toHaveLength(2005);
    expect(new Set(seen).size).toBe(2005);
    expect(store.objects.has(backupKey("2026-11-22", "users", 4))).toBe(false);
  });

  it("leaves no manifest when an upload fails, and keeps the data", async () => {
    const h = harness();
    await login(h, { sub: "ada" });
    const store = archive();
    let calls = 0;
    const flaky = {
      put: async (key: string, body: string) => {
        calls += 1;
        if (calls === 2) throw new Error("R2 down");
        await store.put(key, body);
      },
    };
    await expect(backupAccounts(h.sql, flaky, "2026-11-22", NOW)).rejects.toThrow("R2 down");
    expect(store.objects.has(backupKey("2026-11-22", "manifest"))).toBe(false);
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM users").get()).toMatchObject({ n: 1 });
  });

  it("forgets expired sessions after a good copy", async () => {
    const h = harness();
    const ada = await login(h, { sub: "ada" });
    h.clock.now = NOW + 400 * DAY;
    await backupAccounts(h.sql, archive(), "2026-11-22", h.clock.now);
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM sessions").get()).toMatchObject({ n: 0 });
    expect(ada.cookie).toBeTruthy();
  });
});

const seed = mergePuzzles(dailyPuzzles);

describe("admins", () => {
  beforeEach(() => resetScheduleCache());

  function getAdmin(h: Harness, cookie = "") {
    return handleAdmin(
      new Request(`${HOME}/api/admin`, { headers: { cookie, "cf-connecting-ip": "203.0.113.9" } }),
      h.deps,
      seed,
    );
  }

  function postAdmin(h: Harness, path: string, body: unknown, cookie: string) {
    return handleAdmin(
      new Request(`${HOME}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie, "cf-connecting-ip": "203.0.113.9" },
        body: JSON.stringify(body),
      }),
      h.deps,
      seed,
    );
  }

  it("hides the admin API from everyone else and seeds the question stack", async () => {
    const h = harness();
    expect((await getAdmin(h)).status).toBe(401);
    const ada = await login(h, { sub: "ada", email: "ada@example.com" });
    expect((await getAdmin(h, ada.cookie)).status).toBe(404);
    expect((await postAdmin(h, "/api/admin/questions", {}, ada.cookie)).status).toBe(404);

    const boss = await login(h, { sub: "boss", email: "DavidDev4335@gmail.com" });
    const overview = await (await getAdmin(h, boss.cookie)).json();
    expect(overview.role).toBe("super");
    expect(overview.questions).toHaveLength(seed.length);
    expect(overview.questions[0]).toMatchObject({ day: "2026-11-20", locked: true });
    expect(overview.questions[1].locked).toBe(false);
    expect(overview.admins.map((person: { email: string }) => person.email)).toContain("daviddev4335@gmail.com");

    const published = await (await handleSchedule(h.deps, seed)).json();
    expect(published.puzzles).toHaveLength(1);
    expect(published.puzzles[0].id).toBe(seed[0]?.id);
    expect(JSON.stringify(published)).not.toContain(seed[1]?.id ?? "missing");
  });

  it("refuses today's question, allows a later one, and records the change", async () => {
    const h = harness();
    const boss = await login(h, { sub: "boss", email: "daviddev4335@gmail.com" });
    const today = seed[0];
    expect(today).toBeTruthy();
    expect((await postAdmin(h, "/api/admin/questions", { position: 0, puzzle: today }, boss.cookie)).status).toBe(409);

    const next = { ...seed[1], solutionSimilarity: 0.42 };
    const saved = await postAdmin(h, "/api/admin/questions", { position: 1, puzzle: next }, boss.cookie);
    expect(saved.status).toBe(200);
    const body = await saved.json();
    expect(body.questions[1].puzzle.solutionSimilarity).toBe(0.42);
    expect(body.audit[0]).toMatchObject({ action: "question.update", detail: expect.stringContaining(next?.id) });

    const added = { ...seed[2], id: "extra-pair" };
    const appended = await postAdmin(h, "/api/admin/questions", { position: null, puzzle: added }, boss.cookie);
    expect(appended.status).toBe(200);
    const after = await appended.json();
    expect(after.questions).toHaveLength(seed.length + 1);
    expect(after.questions.at(-1)).toMatchObject({ locked: false, puzzle: { id: "extra-pair" } });
  });

  it("inserts a question on a future day and moves the rest back a day", async () => {
    const h = harness();
    const ada = await login(h, { sub: "ada", email: "ada@example.com" });
    const boss = await login(h, { sub: "boss", email: "daviddev4335@gmail.com" });
    const before = await (await getAdmin(h, boss.cookie)).json();
    const ids = before.questions.map((slot: { puzzle: { id: string } }) => slot.puzzle.id);
    const fresh = { ...seed[2], id: "playtest-find" };
    const insert = (position: number | null, puzzle: unknown, cookie = boss.cookie) =>
      postAdmin(h, "/api/admin/questions", { position, puzzle, insert: true }, cookie);

    // Players learn nothing about it.
    expect((await insert(3, fresh, ada.cookie)).status).toBe(404);
    // Today and every earlier day are locked, and a missing day is refused.
    expect((await insert(0, fresh)).status).toBe(409);
    expect((await insert(null, fresh)).status).toBe(400);
    expect((await insert(seed.length + 1, fresh)).status).toBe(400);
    // An id another day already uses is refused.
    expect((await insert(3, { ...fresh, id: ids[5] })).status).toBe(409);

    const placed = await insert(3, fresh);
    expect(placed.status).toBe(200);
    const after = await placed.json();
    const afterIds = after.questions.map((slot: { puzzle: { id: string } }) => slot.puzzle.id);
    expect(afterIds).toHaveLength(ids.length + 1);
    expect(afterIds.slice(0, 3)).toEqual(ids.slice(0, 3));
    expect(afterIds[3]).toBe("playtest-find");
    expect(afterIds.slice(4)).toEqual(ids.slice(3));
    expect(after.questions[3].day).toBe("2026-11-23");
    expect(after.audit[0]).toMatchObject({ action: "question.insert", detail: expect.stringContaining("playtest-find") });

    // The public schedule still has only today, and a reload from the database agrees.
    resetScheduleCache();
    const reloaded = await (await getAdmin(h, boss.cookie)).json();
    expect(reloaded.questions.map((slot: { puzzle: { id: string } }) => slot.puzzle.id)).toEqual(afterIds);

    // The very end of the list moves nothing.
    const end = await insert(afterIds.length, { ...fresh, id: "playtest-last" });
    expect(end.status).toBe(200);
    expect((await end.json()).questions.at(-1).puzzle.id).toBe("playtest-last");
  });

  it("lets only the superadmin edit the admin list", async () => {
    const h = harness();
    const boss = await login(h, { sub: "boss", email: "daviddev4335@gmail.com" });
    const ada = await login(h, { sub: "ada", email: "ada@example.com" });
    expect((await postAdmin(h, "/api/admin/admins", { email: "ada@example.com" }, ada.cookie)).status).toBe(404);

    expect((await postAdmin(h, "/api/admin/admins", { email: "not an email" }, boss.cookie)).status).toBe(400);
    expect((await postAdmin(h, "/api/admin/admins", { email: "daviddev4335@gmail.com" }, boss.cookie)).status).toBe(409);
    const added = await postAdmin(h, "/api/admin/admins", { email: "Ada@Example.com" }, boss.cookie);
    expect(added.status).toBe(200);
    expect((await added.json()).audit[0]).toMatchObject({ action: "admin.add", detail: "ada@example.com" });

    const asAda = await (await getAdmin(h, ada.cookie)).json();
    expect(asAda.role).toBe("admin");
    expect((await postAdmin(h, "/api/admin/admins", { email: "cy@example.com" }, ada.cookie)).status).toBe(404);
    expect((await postAdmin(h, "/api/admin/admins/remove", { email: "daviddev4335@gmail.com" }, boss.cookie)).status).toBe(403);

    const removed = await postAdmin(h, "/api/admin/admins/remove", { email: "ada@example.com" }, boss.cookie);
    expect(removed.status).toBe(200);
    expect((await getAdmin(h, ada.cookie)).status).toBe(404);
    expect((await removed.json()).audit.map((entry: { action: string }) => entry.action)).toContain("admin.remove");
  });

  it("replaces the admin's own scores and looks on the account", async () => {
    const h = harness();
    const boss = await login(h, { sub: "boss", email: "daviddev4335@gmail.com" });
    await post(h, "/api/account/sync", { scores: [entry("2026-11-20", "old-puzzle", 2)] }, boss.cookie);
    const saved = await postAdmin(
      h,
      "/api/admin/account",
      { scores: [entry("2026-11-19", "mother-son", 4)], unlocks: ["classic", "sunset"] },
      boss.cookie,
    );
    expect(saved.status).toBe(200);
    const body = await saved.json();
    expect(body.scores).toEqual([entry("2026-11-19", "mother-son", 4)]);
    expect(body.unlocks).toEqual(["classic", "sunset"]);
    const me = await (await get(h, "/api/account/me", boss.cookie)).json();
    expect(me.account.role).toBe("super");
    expect(me.account.unlocks).toEqual(["classic", "sunset"]);
    expect(me.account.stats.totalPoints).toBe(entry("2026-11-19", "mother-son", 4).score);
    expect(me.account.stats.wins).toBe(1);
    expect((await postAdmin(h, "/api/admin/account", { unlocks: ["nope"] }, boss.cookie)).status).toBe(400);
    expect((await postAdmin(h, "/api/admin/account", { scores: [{ day: "2026-11-19", puzzleId: "x", moves: 4, score: 1 }] }, boss.cookie)).status).toBe(400);
  });
});
