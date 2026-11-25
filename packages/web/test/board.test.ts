import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Pack } from "../src/lib/pack.js";
import type { Puzzle } from "../src/lib/puzzles.js";
import type { BoardSnapshot } from "../src/lib/standings.js";
import { calendarDay } from "../src/lib/storage.js";
import { archiveExpiredDays, archiveKey } from "../src/worker/archive.js";
import { handleBoard } from "../src/worker/handle.js";
import type { BoardDeps, BoardLimits } from "../src/worker/handle.js";
import type { Sql } from "../src/worker/sql.js";

const SECRET = "test-secret-test-secret-test-secret";
const SCHEMA = ["0001_board.sql", "0002_accounts.sql", "0003_profile.sql", "0004_admin.sql"]
  .map((file) => readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"))
  .join("\n");
const NOW = Date.parse("2026-11-20T15:00:00.000Z");

const puzzle: Puzzle = {
  id: "alpha-omega",
  start: "alpha",
  goal: "omega",
  par: 1,
  solution: [{ op: "+", word: "bridge" }],
  solutionSimilarity: 1,
  here: "omega",
  accepted: ["portal", "target"],
};

function vectors(): Pack {
  const entries: { word: string; row: number[] }[] = [
    { word: "alpha", row: [1, 0, 0] },
    { word: "away", row: [0, 0, 1] },
    { word: "bridge", row: [-1, 1, 0] },
    { word: "hop", row: [0, 0.5, 0] },
    { word: "nudge", row: [-1, 0.5, 0] },
    { word: "omega", row: [0, 1, 0] },
    { word: "side", row: [0.5, 1, 0.5] },
  ];
  return {
    words: entries.map((entry) => entry.word),
    rows: entries.map((entry) => Float32Array.from(entry.row)),
    index: new Map(entries.map((entry, index) => [entry.word, index])),
    display: new Uint8Array(entries.length).fill(1),
  };
}

function openSql(): Sql {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  return {
    async get(statement, params) {
      const row = db.prepare(statement).get(...params);
      return (row as Record<string, unknown> | undefined) ?? null;
    },
    async all(statement, params) {
      return db.prepare(statement).all(...params) as Record<string, unknown>[];
    },
    async run(statement, params) {
      return Number(db.prepare(statement).run(...params).changes);
    },
    async batch(statements) {
      const changed: number[] = [];
      db.exec("BEGIN");
      try {
        for (const item of statements) changed.push(Number(db.prepare(item.statement).run(...item.params).changes));
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return changed;
    },
  };
}

function harness(limits?: BoardLimits): { deps: BoardDeps; clock: { now: number }; sql: Sql } {
  const clock = { now: NOW };
  const sql = openSql();
  const deps: BoardDeps = {
    sql,
    secret: SECRET,
    now: () => clock.now,
    pack: vectors(),
    puzzle: (id) => (id === puzzle.id || id === "side-quest" ? { ...puzzle, id } : null),
    dailyPuzzleId: puzzle.id,
    limits,
  };
  return { deps, clock, sql };
}

function cookieOf(response: Response): string {
  const header = response.headers.get("set-cookie") ?? "";
  const pair = header.split(";")[0] ?? "";
  if (!pair.startsWith("wl_session=")) throw new Error("missing session cookie");
  return pair;
}

async function session(deps: BoardDeps, ip = "203.0.113.9"): Promise<string> {
  const response = await handleBoard(
    new Request("http://127.0.0.1/api/session", { method: "POST", headers: { "cf-connecting-ip": ip } }),
    deps,
  );
  expect(response.status).toBe(204);
  return cookieOf(response);
}

async function post(
  deps: BoardDeps,
  path: string,
  body: unknown,
  cookie: string,
  extra?: HeadersInit,
): Promise<Response> {
  return handleBoard(
    new Request(`http://127.0.0.1${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "cf-connecting-ip": "203.0.113.9",
        ...extra,
      },
      body: JSON.stringify(body),
    }),
    deps,
  );
}

const shortPath = { puzzleId: "alpha-omega", steps: [{ op: "+", word: "bridge" }], score: 999 };
const longPath = {
  puzzleId: "alpha-omega",
  steps: [
    { op: "+", word: "hop" },
    { op: "+", word: "nudge" },
  ],
};
const missPath = { puzzleId: "alpha-omega", steps: [{ op: "+", word: "away" }] };

async function snapshot(response: Response): Promise<BoardSnapshot> {
  expect(response.status).toBe(200);
  return (await response.json()) as BoardSnapshot;
}

describe("daily board", () => {
  it("stores the verified score, ignores a client score, and ranks earlier ties first", async () => {
    const { deps, clock } = harness();
    const first = await session(deps);
    const early = await snapshot(await post(deps, "/api/score", shortPath, first));
    expect(early.submitted).toEqual({ score: 150, counted: true });
    expect(early.you).toMatchObject({ score: 150, rank: 1, total: 1, betterThan: 100, nameEligible: true, named: false });
    expect(early.top[0]).toMatchObject({
      rank: 1,
      name: "Anonymous",
      score: 150,
      answer: "alpha + bridge",
      betterThan: 100,
    });

    clock.now += 1000;
    const second = await session(deps);
    const later = await snapshot(await post(deps, "/api/score", shortPath, second));
    expect(later.top.map((entry) => entry.score)).toEqual([150, 150]);
    expect(later.you).toMatchObject({ rank: 2, betterThan: 50 });
    expect(later.top[0]?.betterThan).toBe(50);
    expect(later.top[1]?.rank).toBe(2);
  });

  it("counts an undone step in the score", async () => {
    const { deps } = harness();
    const cookie = await session(deps);
    const scored = await snapshot(
      await post(deps, "/api/score", {
        puzzleId: "alpha-omega",
        steps: [
          { op: "+", word: "hop" },
          { op: "-", word: "hop" },
          { op: "+", word: "bridge" },
        ],
      }, cookie),
    );
    expect(scored.submitted).toEqual({ score: 130, counted: true });
    expect(scored.top[0]?.answer).toBe("alpha + hop − hop + bridge");
    expect(scored.top[0]?.moves).toBe(3);
  });

  it("refuses a score for a puzzle that is not today's", async () => {
    const { deps } = harness();
    const cookie = await session(deps);
    const refused = await post(deps, "/api/score", { puzzleId: "side-quest", steps: [{ op: "+", word: "bridge" }] }, cookie);
    expect(refused.status).toBe(400);
  });

  it("keeps a better score and an earlier time, then asks the top five for a name", async () => {
    const { deps, clock } = harness();
    const cookies: string[] = [];
    for (let i = 0; i < 5; i++) {
      cookies.push(await session(deps));
      clock.now += 10;
      await post(deps, "/api/score", shortPath, cookies[i] ?? "");
    }
    clock.now += 10;
    const sixth = await session(deps);
    const low = await snapshot(await post(deps, "/api/score", longPath, sixth));
    expect(low.submitted).toEqual({ score: 140, counted: true });
    expect(low.you).toMatchObject({ score: 140, rank: 6, nameEligible: false, betterThan: 16 });
    expect(low.top).toHaveLength(5);
    expect(low.top[0]?.betterThan).toBe(33);

    const refused = await post(deps, "/api/name", { name: "Sneaky" }, sixth);
    expect(refused.status).toBe(403);

    const named = await snapshot(await post(deps, "/api/name", { name: "  Ada   Lovelace " }, cookies[0] ?? ""));
    expect(named.you).toMatchObject({ named: true, displayName: "Ada Lovelace", nameEligible: false });
    expect(named.top[0]?.name).toBe("Ada Lovelace");

    const again = await post(deps, "/api/name", { name: "Bea" }, cookies[0] ?? "");
    expect(again.status).toBe(409);

    const junk = await post(deps, "/api/name", { name: "<b>ada</b>" }, cookies[1] ?? "");
    expect(junk.status).toBe(400);
  });

  it("refuses a second device after this account has finished today", async () => {
    const { deps, sql } = harness();
    const ada = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Ada", picture: null as string | null };
    for (let i = 0; i < 5; i++) {
      deps.account = async () => null;
      const cookie = await session(deps, `203.0.113.${i + 1}`);
      expect((await post(deps, "/api/score", shortPath, cookie, { "cf-connecting-ip": `203.0.113.${i + 1}` })).status).toBe(200);
    }
    deps.account = async () => ada;
    const first = await session(deps, "203.0.113.20");
    const posted = await post(deps, "/api/score", longPath, first, { "cf-connecting-ip": "203.0.113.20" });
    expect(posted.status).toBe(200);
    // Below the top, so it carries no public name, but it still belongs to the account.
    const row = await sql.get<{ user_id: string; name: string | null }>(
      "SELECT user_id, name FROM scores WHERE user_id = ?",
      [ada.id],
    );
    expect(row).toMatchObject({ user_id: ada.id, name: null });
    const second = await session(deps, "203.0.113.21");
    const again = await post(deps, "/api/score", shortPath, second, { "cf-connecting-ip": "203.0.113.21" });
    expect(again.status).toBe(409);
    const count = await sql.get<{ n: number }>("SELECT COUNT(*) AS n FROM scores WHERE user_id = ?", [ada.id]);
    expect(count?.n).toBe(1);
  });

  it("replaces a lower score and drops the old bucket", async () => {
    const { deps, clock, sql } = harness();
    const cookie = await session(deps);
    await post(deps, "/api/score", longPath, cookie);
    clock.now += 500;
    const better = await snapshot(await post(deps, "/api/score", shortPath, cookie));
    expect(better.submitted).toEqual({ score: 150, counted: true });
    expect(better.you).toMatchObject({ score: 150, rank: 1 });
    const stale = await post(deps, "/api/score", longPath, cookie);
    const held = await snapshot(stale);
    expect(held.submitted).toEqual({ score: 140, counted: false });
    expect(held.you?.score).toBe(150);
    const buckets = await sql.all<{ score: number; n: number }>("SELECT score, n FROM buckets", []);
    expect(buckets).toEqual([{ score: 150, n: 1 }]);
  });

  it("rejects a path that does not land on the goal, a forged cookie, and an unknown puzzle", async () => {
    const { deps } = harness();
    const cookie = await session(deps);
    const missed = await post(deps, "/api/score", missPath, cookie);
    expect(missed.status).toBe(400);
    const board = await handleBoard(new Request("http://127.0.0.1/api/leaderboard"), deps);
    expect(((await board.json()) as BoardSnapshot).total).toBe(0);

    const forged = await post(deps, "/api/score", shortPath, "wl_session=not-a-real-token");
    expect(forged.status).toBe(401);

    const missing = await post(deps, "/api/score", { puzzleId: "no-such-puzzle", steps: shortPath.steps }, cookie);
    expect(missing.status).toBe(404);

    const evil = await post(deps, "/api/score", shortPath, cookie, { origin: "https://evil.test" });
    expect(evil.status).toBe(403);
  });

  it("limits new sessions per address", async () => {
    const { deps } = harness({ sessionPerHour: 2, scorePerHour: 10, scorePerDay: 10, namePerHour: 5 });
    await session(deps);
    await session(deps);
    const blocked = await handleBoard(
      new Request("http://127.0.0.1/api/session", { method: "POST", headers: { "cf-connecting-ip": "203.0.113.9" } }),
      deps,
    );
    expect(blocked.status).toBe(429);
  });

  it("archives a week-old day to long-term storage before deleting it", async () => {
    const { deps, clock, sql } = harness();
    clock.now = Date.parse("2026-11-10T15:00:00.000Z");
    const oldCookie = await session(deps);
    await post(deps, "/api/score", shortPath, oldCookie);
    clock.now = NOW;
    const fresh = await session(deps);
    await post(deps, "/api/score", shortPath, fresh);

    const stored = new Map<string, string>();
    const archive = {
      async put(key: string, body: string) {
        stored.set(key, body);
      },
    };
    const result = await archiveExpiredDays(sql, archive, "2026-11-14", clock.now);
    expect(result.days).toEqual(["2026-11-10"]);
    const copy = JSON.parse(stored.get(archiveKey("2026-11-10")) ?? "{}") as {
      day?: string;
      scores?: { score?: number; answer?: { start?: string } }[];
    };
    expect(copy.day).toBe("2026-11-10");
    expect(copy.scores?.[0]).toMatchObject({ score: 150, answer: { start: "alpha" } });

    const oldRows = await sql.get<{ n: number }>("SELECT COUNT(*) AS n FROM scores WHERE day = ?", ["2026-11-10"]);
    const kept = await sql.get<{ n: number }>("SELECT COUNT(*) AS n FROM scores WHERE day = ?", ["2026-11-20"]);
    expect(Number(oldRows?.n)).toBe(0);
    expect(Number(kept?.n)).toBe(1);
  });

  it("leaves a day in the database when the archive write fails", async () => {
    const { deps, clock, sql } = harness();
    clock.now = Date.parse("2026-11-10T15:00:00.000Z");
    const oldCookie = await session(deps);
    await post(deps, "/api/score", shortPath, oldCookie);
    clock.now = NOW;
    const archive = {
      async put() {
        throw new Error("storage unavailable");
      },
    };
    await expect(archiveExpiredDays(sql, archive, "2026-11-14", clock.now)).rejects.toThrow(/2026-11-10/);
    const oldRows = await sql.get<{ n: number }>("SELECT COUNT(*) AS n FROM scores WHERE day = ?", ["2026-11-10"]);
    expect(Number(oldRows?.n)).toBe(1);
  });
});

describe("leaderboard with an account", () => {
  const ada = { id: "11111111-1111-4111-8111-111111111111", name: "Ada", picture: "https://lh3.googleusercontent.com/a/ada" };
  const bob = { id: "22222222-2222-4222-8222-222222222222", name: "Bob", picture: null };

  async function leaderboard(deps: BoardDeps, cookie: string): Promise<BoardSnapshot> {
    return snapshot(
      await handleBoard(
        new Request("http://127.0.0.1/api/leaderboard", { headers: { cookie, "cf-connecting-ip": "203.0.113.9" } }),
        deps,
      ),
    );
  }

  it("puts the account username and picture link on a top score without asking", async () => {
    const { deps } = harness();
    deps.account = async () => ada;
    const cookie = await session(deps);
    const board = await snapshot(await post(deps, "/api/score", shortPath, cookie));
    expect(board.you).toMatchObject({
      named: true,
      nameEligible: false,
      displayName: "Ada",
      picture: ada.picture,
      linked: true,
    });
    expect(board.top[0]).toMatchObject({ name: "Ada", picture: ada.picture });
  });

  it("leaves the picture off when the account hides it", async () => {
    const { deps } = harness();
    deps.account = async () => ({ ...ada, picture: null });
    const cookie = await session(deps);
    const board = await snapshot(await post(deps, "/api/score", shortPath, cookie));
    expect(board.top[0]).toMatchObject({ name: "Ada", picture: null });
  });

  it("does not name a score outside the top five", async () => {
    const { deps } = harness();
    for (let i = 0; i < 5; i++) {
      const cookie = await session(deps, `203.0.113.${i + 20}`);
      await post(deps, "/api/score", shortPath, cookie, { "cf-connecting-ip": `203.0.113.${i + 20}` });
    }
    deps.account = async () => ada;
    const cookie = await session(deps);
    const board = await snapshot(await post(deps, "/api/score", longPath, cookie));
    expect(board.you).toMatchObject({ rank: 6, named: false, linked: true });
  });

  it("falls back to asking when the username cannot be shown", async () => {
    const { deps } = harness();
    deps.account = async () => ({ ...ada, name: "ada 🔥" });
    const cookie = await session(deps);
    const board = await snapshot(await post(deps, "/api/score", shortPath, cookie));
    expect(board.you).toMatchObject({ named: false, nameEligible: true, linked: true });
  });

  it("names an earlier anonymous score when the person signs in afterwards", async () => {
    const { deps } = harness();
    const cookie = await session(deps);
    await post(deps, "/api/score", shortPath, cookie);
    expect((await leaderboard(deps, cookie)).you).toMatchObject({ named: false, nameEligible: true });
    deps.account = async () => ada;
    const board = await leaderboard(deps, cookie);
    expect(board.you).toMatchObject({ named: true, displayName: "Ada", linked: true, picture: ada.picture });
  });

  it("lets the owner change the name again and again, and nobody else", async () => {
    const { deps } = harness();
    deps.account = async () => ada;
    const cookie = await session(deps);
    await post(deps, "/api/score", shortPath, cookie);

    const renamed = await snapshot(await post(deps, "/api/name", { name: "Countess" }, cookie));
    expect(renamed.you).toMatchObject({ displayName: "Countess", linked: true });
    const again = await snapshot(await post(deps, "/api/name", { name: "Augusta Ada" }, cookie));
    expect(again.top[0]?.name).toBe("Augusta Ada");
    expect((await post(deps, "/api/name", { name: "<b>x</b>" }, cookie)).status).toBe(400);

    // The same browser, signed in as someone else, or signed out, cannot change it.
    deps.account = async () => bob;
    expect((await post(deps, "/api/name", { name: "Mine now" }, cookie)).status).toBe(409);
    deps.account = async () => null;
    expect((await post(deps, "/api/name", { name: "Mine now" }, cookie)).status).toBe(409);
    expect((await leaderboard(deps, cookie)).top[0]?.name).toBe("Augusta Ada");
  });

  it("does not hand another account an entry that already belongs to someone", async () => {
    const { deps, sql } = harness();
    deps.account = async () => ada;
    const cookie = await session(deps);
    await post(deps, "/api/score", shortPath, cookie);
    await sql.run(`UPDATE scores SET name = NULL`, []);
    deps.account = async () => bob;
    const board = await leaderboard(deps, cookie);
    expect(board.you).toMatchObject({ named: false, linked: false });
  });

  it("shows a signed-in player's answer on a past day from another browser", async () => {
    const { deps, clock } = harness();
    deps.account = async () => ada;
    const phone = await session(deps, "203.0.113.40");
    await post(deps, "/api/score", longPath, phone, { "cf-connecting-ip": "203.0.113.40" });
    for (let i = 0; i < 5; i++) {
      deps.account = async () => null;
      const cookie = await session(deps, `203.0.113.${50 + i}`);
      await post(deps, "/api/score", shortPath, cookie, { "cf-connecting-ip": `203.0.113.${50 + i}` });
    }
    const played = calendarDay(new Date(clock.now));
    clock.now += 86_400_000;

    deps.account = async () => null;
    const sameBrowser = await snapshot(
      await handleBoard(
        new Request(`http://127.0.0.1/api/leaderboard?day=${played}`, {
          headers: { cookie: phone, "cf-connecting-ip": "203.0.113.40" },
        }),
        deps,
      ),
    );
    expect(sameBrowser.you).toMatchObject({ rank: 6, answer: "alpha + hop + nudge", start: "alpha", goal: "omega" });

    deps.account = async () => ada;
    const laptop = await session(deps, "203.0.113.41");
    const board = await snapshot(
      await handleBoard(
        new Request(`http://127.0.0.1/api/leaderboard?day=${played}`, {
          headers: { cookie: laptop, "cf-connecting-ip": "203.0.113.41" },
        }),
        deps,
      ),
    );
    expect(board.you).toMatchObject({
      rank: 6,
      linked: true,
      score: 140,
      answer: "alpha + hop + nudge",
      start: "alpha",
      goal: "omega",
      steps: [
        { op: "+", word: "hop" },
        { op: "+", word: "nudge" },
      ],
    });
    expect(board.top.some((entry) => entry.answer === "alpha + hop + nudge")).toBe(false);

    deps.account = async () => bob;
    const stranger = await snapshot(
      await handleBoard(
        new Request(`http://127.0.0.1/api/leaderboard?day=${played}`, {
          headers: { cookie: laptop, "cf-connecting-ip": "203.0.113.41" },
        }),
        deps,
      ),
    );
    expect(stranger.you).toBeNull();
  });

  it("keeps an earlier anonymous answer once the player signs in, on any browser", async () => {
    const { deps, clock } = harness();
    const phone = await session(deps, "203.0.113.70");
    await post(deps, "/api/score", longPath, phone, { "cf-connecting-ip": "203.0.113.70" });
    const played = calendarDay(new Date(clock.now));
    clock.now += 86_400_000;

    deps.account = async () => ada;
    const claimed = await snapshot(
      await handleBoard(
        new Request("http://127.0.0.1/api/leaderboard", {
          headers: { cookie: phone, "cf-connecting-ip": "203.0.113.70" },
        }),
        deps,
      ),
    );
    expect(claimed.you).toBeNull();

    const laptop = await session(deps, "203.0.113.71");
    const board = await snapshot(
      await handleBoard(
        new Request(`http://127.0.0.1/api/leaderboard?day=${played}`, {
          headers: { cookie: laptop, "cf-connecting-ip": "203.0.113.71" },
        }),
        deps,
      ),
    );
    expect(board.you).toMatchObject({
      linked: true,
      score: 140,
      answer: "alpha + hop + nudge",
      start: "alpha",
      goal: "omega",
      steps: [
        { op: "+", word: "hop" },
        { op: "+", word: "nudge" },
      ],
    });
  });

  it("still asks an anonymous player once, and only once", async () => {
    const { deps } = harness();
    const cookie = await session(deps);
    await post(deps, "/api/score", shortPath, cookie);
    expect((await post(deps, "/api/name", { name: "Zed" }, cookie)).status).toBe(200);
    expect((await post(deps, "/api/name", { name: "Zed2" }, cookie)).status).toBe(409);
  });
});
