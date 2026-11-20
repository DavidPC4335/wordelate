import type { Puzzle } from "../lib/puzzles.js";
import type { Pack } from "../lib/pack.js";
import {
  ANONYMOUS,
  TOP_SIZE,
  belowCount,
  betterThanPercent,
  curvePlace,
  cleanName,
  dayInWindow,
  formatBoardAnswer,
  formatPuzzle,
} from "../lib/standings.js";
import type { BoardSnapshot, BoardStep } from "../lib/standings.js";
import { calendarDay } from "../lib/storage.js";
import { allowHit, buckets, getScore, rankOf, saveBest, setName, topScores } from "./board-db.js";
import { issueSession, readCookie, readSession, sessionCookie } from "./session.js";
import type { Sql } from "./sql.js";
import { verifySolution } from "./verify.js";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MAX_BODY = 4096;

export type BoardLimits = {
  sessionPerHour: number;
  scorePerHour: number;
  scorePerDay: number;
  namePerHour: number;
};

export const BOARD_LIMITS: BoardLimits = {
  sessionPerHour: 20,
  scorePerHour: 80,
  scorePerDay: 200,
  namePerHour: 15,
};

export type BoardDeps = {
  sql: Sql;
  secret: string;
  now: () => number;
  pack: Pack | null;
  puzzle: (id: string) => Puzzle | null;
  limits?: BoardLimits;
};

type Failure = { ok: false; status: number; error: string };

function json(body: unknown, status: number, headers?: Headers): Response {
  const out = headers ?? new Headers();
  out.set("content-type", "application/json; charset=utf-8");
  out.set("x-content-type-options", "nosniff");
  out.set("cache-control", "no-store");
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: out });
}

function fail(status: number, error: string): Response {
  return json({ error }, status);
}

function originAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  let sent: URL;
  try {
    sent = new URL(origin);
  } catch {
    return false;
  }
  const target = new URL(request.url);
  if (sent.origin === target.origin) return true;
  const local = (host: string) => host === "localhost" || host === "127.0.0.1";
  return local(sent.hostname) && local(target.hostname);
}

function clientIp(request: Request): string {
  const header = request.headers.get("CF-Connecting-IP") ?? "";
  if (/^[0-9a-fA-F:.]{3,64}$/.test(header)) return header;
  return "unknown";
}

function secureRequest(request: Request): boolean {
  return new URL(request.url).protocol === "https:";
}

async function readBody(request: Request): Promise<{ ok: true; value: unknown } | Failure> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY) {
    return { ok: false, status: 413, error: "That request is too large." };
  }
  const text = await request.text();
  if (text.length > MAX_BODY) return { ok: false, status: 413, error: "That request is too large." };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, status: 400, error: "That solution does not score." };
  }
}

const STEP_WORD = /^[a-z]{1,32}$/;
const PUZZLE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function parseSteps(value: unknown): { puzzleId: string; steps: BoardStep[] } | Failure {
  if (!value || typeof value !== "object") return { ok: false, status: 400, error: "That solution does not score." };
  const record = value as { puzzleId?: unknown; steps?: unknown };
  if (typeof record.puzzleId !== "string" || !PUZZLE_ID.test(record.puzzleId) || record.puzzleId.length > 64) {
    return { ok: false, status: 400, error: "That solution does not score." };
  }
  if (!Array.isArray(record.steps) || record.steps.length < 1 || record.steps.length > 16) {
    return { ok: false, status: 400, error: "That solution does not score." };
  }
  const steps: BoardStep[] = [];
  for (const step of record.steps) {
    if (!step || typeof step !== "object") return { ok: false, status: 400, error: "That solution does not score." };
    const op = (step as { op?: unknown }).op;
    const word = (step as { word?: unknown }).word;
    if ((op !== "+" && op !== "-") || typeof word !== "string" || !STEP_WORD.test(word)) {
      return { ok: false, status: 400, error: "That solution does not score." };
    }
    steps.push({ op, word });
  }
  return { puzzleId: record.puzzleId, steps };
}

async function snapshotFor(
  sql: Sql,
  day: string,
  playerId: string | null,
  submitted: BoardSnapshot["submitted"],
): Promise<BoardSnapshot> {
  const counts = await buckets(sql, day);
  const total = counts.reduce((sum, bucket) => sum + bucket.n, 0);
  const leaders = await topScores(sql, day, TOP_SIZE);
  const top = leaders.map((row, index) => {
    const below = belowCount(counts, row.score);
    const tied = counts.find((bucket) => bucket.score === row.score)?.n ?? 0;
    return {
      rank: index + 1,
      name: row.name ?? ANONYMOUS,
      score: row.score,
      moves: row.moves,
      puzzle: formatPuzzle(row.answer),
      answer: formatBoardAnswer(row.answer),
      betterThan: betterThanPercent(below, total),
      place: curvePlace(below, tied, total),
    };
  });
  let you: BoardSnapshot["you"] = null;
  if (playerId) {
    const row = await getScore(sql, day, playerId);
    if (row) {
      const rank = await rankOf(sql, day, row.score, row.createdAt);
      const below = belowCount(counts, row.score);
      const tied = counts.find((bucket) => bucket.score === row.score)?.n ?? 0;
      you = {
        score: row.score,
        rank,
        total,
        betterThan: betterThanPercent(below, total),
        place: curvePlace(below, tied, total),
        nameEligible: rank <= TOP_SIZE && row.name == null,
        named: row.name != null,
        displayName: row.name ?? ANONYMOUS,
      };
    }
  }
  return { day, total, top, you, submitted };
}

export async function handleBoard(request: Request, deps: BoardDeps): Promise<Response> {
  const url = new URL(request.url);
  if (!originAllowed(request)) return fail(403, "That request was refused.");
  if (deps.secret.length < 32) return fail(503, "The board is unavailable.");
  const limits = deps.limits ?? BOARD_LIMITS;
  const now = deps.now();
  const today = calendarDay(new Date(now));
  const ip = clientIp(request);

  if (url.pathname === "/api/session" && request.method === "POST") {
    const existing = await readSession(deps.secret, readCookie(request.headers.get("cookie")) ?? "", now);
    if (existing) return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
    const allowed = await allowHit(deps.sql, `ip:${ip}:session:${Math.floor(now / HOUR_MS)}`, limits.sessionPerHour, now, HOUR_MS);
    if (!allowed) return fail(429, "Too many new players from this connection. Try again later.");
    const issued = await issueSession(deps.secret, now);
    const headers = new Headers({ "cache-control": "no-store" });
    headers.set("set-cookie", sessionCookie(issued.token, secureRequest(request)));
    return new Response(null, { status: 204, headers });
  }

  if (url.pathname === "/api/leaderboard" && request.method === "GET") {
    const requested = url.searchParams.get("day") ?? today;
    if (!dayInWindow(requested, today)) return fail(404, "That day is not on the board.");
    const session = await readSession(deps.secret, readCookie(request.headers.get("cookie")) ?? "", now);
    const snapshot = await snapshotFor(deps.sql, requested, session?.playerId ?? null, null);
    return json(snapshot, 200);
  }

  if (url.pathname === "/api/score" && request.method === "POST") {
    const session = await readSession(deps.secret, readCookie(request.headers.get("cookie")) ?? "", now);
    if (!session) return fail(401, "Play again to join the board.");
    const hour = Math.floor(now / HOUR_MS);
    const ipAllowed = await allowHit(deps.sql, `ip:${ip}:score:${hour}`, limits.scorePerHour, now, HOUR_MS);
    const dayAllowed = await allowHit(deps.sql, `ip:${ip}:score-day:${today}`, limits.scorePerDay, now, DAY_MS);
    const playerAllowed = await allowHit(deps.sql, `player:${session.playerId}:score:${hour}`, limits.scorePerHour, now, HOUR_MS);
    if (!ipAllowed || !dayAllowed || !playerAllowed) {
      return fail(429, "Too many scores from this connection. Try again later.");
    }
    const body = await readBody(request);
    if (!body.ok) return fail(body.status, body.error);
    const parsed = parseSteps(body.value);
    if (!("steps" in parsed)) return fail(parsed.status, parsed.error);
    const puzzle = deps.puzzle(parsed.puzzleId);
    if (!puzzle) return fail(404, "That puzzle is not on the board.");
    if (!deps.pack) return fail(503, "The board is unavailable.");
    const verified = await verifySolution(deps.pack, puzzle, parsed.steps);
    if (!verified) return fail(400, "That solution does not score.");
    const saved = await saveBest(deps.sql, today, session.playerId, {
      puzzleId: puzzle.id,
      score: verified.score,
      moves: verified.moves,
      answer: verified.answer,
      createdAt: now,
    });
    console.log(JSON.stringify({ event: "score", day: today, puzzleId: puzzle.id, score: verified.score, counted: saved.counted }));
    const snapshot = await snapshotFor(deps.sql, today, session.playerId, {
      score: verified.score,
      counted: saved.counted,
    });
    return json(snapshot, 200);
  }

  if (url.pathname === "/api/name" && request.method === "POST") {
    const session = await readSession(deps.secret, readCookie(request.headers.get("cookie")) ?? "", now);
    if (!session) return fail(401, "Play again to join the board.");
    const allowed = await allowHit(
      deps.sql,
      `ip:${ip}:name:${Math.floor(now / HOUR_MS)}`,
      limits.namePerHour,
      now,
      HOUR_MS,
    );
    if (!allowed) return fail(429, "Too many name changes from this connection. Try again later.");
    const body = await readBody(request);
    if (!body.ok) return fail(body.status, body.error);
    const raw = body.value && typeof body.value === "object" ? (body.value as { name?: unknown }).name : null;
    if (typeof raw !== "string") return fail(400, "Use letters and numbers, up to 24 characters.");
    const name = cleanName(raw);
    if (!name) return fail(400, "Use letters and numbers, up to 24 characters.");
    const row = await getScore(deps.sql, today, session.playerId);
    if (!row) return fail(403, "Only a top score can carry a name.");
    if (row.name != null) return fail(409, "This score already has a name.");
    const rank = await rankOf(deps.sql, today, row.score, row.createdAt);
    if (rank > TOP_SIZE) return fail(403, "Only a top score can carry a name.");
    const wrote = await setName(deps.sql, today, session.playerId, name);
    if (!wrote) return fail(409, "This score already has a name.");
    const snapshot = await snapshotFor(deps.sql, today, session.playerId, null);
    return json(snapshot, 200);
  }

  return fail(404, "Not found.");
}
