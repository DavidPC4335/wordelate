import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Pack } from "../src/lib/pack.js";
import type { Puzzle } from "../src/lib/puzzles.js";
import type { BoardSnapshot } from "../src/lib/standings.js";
import { archiveExpiredDays, archiveKey } from "../src/worker/archive.js";
import { handleBoard } from "../src/worker/handle.js";
import type { BoardDeps, BoardLimits } from "../src/worker/handle.js";
import type { Sql } from "../src/worker/sql.js";

const SECRET = "test-secret-test-secret-test-secret";
const SCHEMA = readFileSync(new URL("../migrations/0001_board.sql", import.meta.url), "utf8");
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
    expect(early.you).toMatchObject({ score: 150, rank: 1, total: 1, betterThan: 0, nameEligible: true, named: false });
    expect(early.top[0]).toMatchObject({
      rank: 1,
      name: "Anonymous",
      score: 150,
      answer: "alpha + bridge",
      betterThan: 0,
    });

    clock.now += 1000;
    const second = await session(deps);
    const later = await snapshot(await post(deps, "/api/score", shortPath, second));
    expect(later.top.map((entry) => entry.score)).toEqual([150, 150]);
    expect(later.you).toMatchObject({ rank: 2, betterThan: 0 });
    expect(later.top[0]?.betterThan).toBe(0);
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
    expect(low.you).toMatchObject({ score: 140, rank: 6, nameEligible: false, betterThan: 0 });
    expect(low.top).toHaveLength(5);
    expect(low.top[0]?.betterThan).toBe(16);

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
