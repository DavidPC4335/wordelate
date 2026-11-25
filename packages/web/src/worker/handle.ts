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
  retentionStart,
} from "../lib/standings.js";
import type { BoardSnapshot, BoardStep } from "../lib/standings.js";
import { calendarDay } from "../lib/storage.js";
import { adoptAccount, allowHit, buckets, claimScores, getScore, getScoreForUser, linkAccount, rankOf, renameOwn, saveBest, scoreForAccount, setName, topScores } from "./board-db.js";
import type { ScoreRow } from "./board-db.js";
import { clientIp, fail, json, originAllowed, secureRequest } from "./http.js";
import type { Failure } from "./http.js";
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
  /** Only this puzzle can post a score. Past days are for practice. */
  dailyPuzzleId: string;
  /**
   * The account signed in on this request, if any. The picture is already null
   * when the person chose not to show it.
   */
  account?: (request: Request) => Promise<BoardAccount | null>;
  limits?: BoardLimits;
};

export type BoardAccount = { id: string; name: string; picture: string | null };

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
  accountId: string | null = null,
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
      start: row.answer.start,
      goal: row.answer.goal,
      steps: row.answer.steps,
      betterThan: betterThanPercent(below, total),
      place: curvePlace(below, tied, total),
      picture: row.picture,
    };
  });
  const row = await standingRow(sql, day, playerId, accountId);
  let you: BoardSnapshot["you"] = null;
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
      picture: row.picture,
      linked: accountId !== null && row.userId === accountId,
      answer: formatBoardAnswer(row.answer),
      start: row.answer.start,
      goal: row.answer.goal,
      steps: row.answer.steps,
    };
  }
  return { day, total, top, you, submitted };
}

/**
 * The score that belongs to the person looking.
 * This browser's row wins when it is unclaimed or already theirs. Otherwise a
 * signed-in account is matched across browsers, and a row left on this browser
 * by someone else stays visible but unlinked.
 */
async function standingRow(
  sql: Sql,
  day: string,
  playerId: string | null,
  accountId: string | null,
): Promise<ScoreRow | null> {
  const browser = playerId ? await getScore(sql, day, playerId) : null;
  if (browser && (accountId === null || browser.userId === null || browser.userId === accountId)) return browser;
  if (accountId) {
    const owned = await getScoreForUser(sql, day, accountId);
    if (owned) return owned;
  }
  return browser;
}

/**
 * A signed-in player with a top score and no name gets their username on the board
 * without being asked. They can change it afterwards.
 */
async function nameFromAccount(deps: BoardDeps, day: string, playerId: string, account: BoardAccount | null): Promise<void> {
  if (!account) return;
  // Every signed-in score remembers the account, so another device cannot post a second one.
  await linkAccount(deps.sql, day, playerId, { id: account.id, picture: account.picture });
  const name = cleanName(account.name);
  if (!name) return;
  const row = await getScore(deps.sql, day, playerId);
  if (!row || row.name != null || (row.userId != null && row.userId !== account.id)) return;
  const rank = await rankOf(deps.sql, day, row.score, row.createdAt);
  if (rank > TOP_SIZE) return;
  await adoptAccount(deps.sql, day, playerId, { id: account.id, name, picture: account.picture });
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
    const account = (await deps.account?.(request)) ?? null;
    if (session && account) {
      await claimScores(deps.sql, session.playerId, retentionStart(today), today, {
        id: account.id,
        picture: account.picture,
      });
    }
    if (session && requested === today) await nameFromAccount(deps, today, session.playerId, account);
    const snapshot = await snapshotFor(deps.sql, requested, session?.playerId ?? null, null, account?.id ?? null);
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
    if (parsed.puzzleId !== deps.dailyPuzzleId) return fail(400, "That puzzle is not today's.");
    if (!deps.pack) return fail(503, "The board is unavailable.");
    const verified = await verifySolution(deps.pack, puzzle, parsed.steps);
    if (!verified) return fail(400, "That solution does not score.");
    const account = (await deps.account?.(request)) ?? null;
    if (account) {
      const owned = await scoreForAccount(deps.sql, today, account.id);
      if (owned && owned.playerId !== session.playerId) {
        return fail(409, "This account already finished today.");
      }
    }
    const saved = await saveBest(deps.sql, today, session.playerId, {
      puzzleId: puzzle.id,
      score: verified.score,
      moves: verified.moves,
      answer: verified.answer,
      createdAt: now,
    });
    console.log(JSON.stringify({ event: "score", day: today, puzzleId: puzzle.id, score: verified.score, counted: saved.counted }));
    await nameFromAccount(deps, today, session.playerId, account);
    const snapshot = await snapshotFor(
      deps.sql,
      today,
      session.playerId,
      { score: verified.score, counted: saved.counted },
      account?.id ?? null,
    );
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
    const account = (await deps.account?.(request)) ?? null;
    // Someone signed in may rename their own entry. Anyone else names a score once.
    const own = account !== null && row.userId === account.id;
    if (row.name != null && !own) return fail(409, "This score already has a name.");
    const rank = await rankOf(deps.sql, today, row.score, row.createdAt);
    if (rank > TOP_SIZE) return fail(403, "Only a top score can carry a name.");
    const wrote = own && account ? await renameOwn(deps.sql, today, session.playerId, account.id, name) : await setName(deps.sql, today, session.playerId, name);
    if (!wrote) return fail(409, "This score already has a name.");
    const snapshot = await snapshotFor(deps.sql, today, session.playerId, null, account?.id ?? null);
    return json(snapshot, 200);
  }

  return fail(404, "Not found.");
}
