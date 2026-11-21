import { cleanScore, mergeScores } from "../lib/account.js";
import type { AccountDeps } from "./account.js";
import { accountFromRequest } from "./account.js";
import {
  SUPERADMIN_EMAIL,
  dayForPosition,
  isSuperadmin,
  normalizeEmail,
  positionForDay,
} from "../lib/admin.js";
import type { AdminOverview, AdminPerson, AuditEntry, QuestionSlot } from "../lib/admin.js";
import { parsePuzzleFile } from "../lib/puzzles.js";
import type { Puzzle } from "../lib/puzzles.js";
import { DEFAULT_COSMETIC, isCosmeticId } from "../lib/rewards.js";
import type { CosmeticId } from "../lib/rewards.js";
import { calendarDay } from "../lib/storage.js";
import type { ScoreEntry } from "../lib/storage.js";
import { adminRole, refreshStats, replaceScores, scoresOf, setUnlocks } from "./account-db.js";
import type { UserRow } from "./account-db.js";
import { allowHit } from "./board-db.js";
import { fail, json, originAllowed, readJson } from "./http.js";
import { ensureSchedule, publicStack, saveQuestion } from "./schedule.js";

const HOUR_MS = 60 * 60 * 1000;
const WRITE_LIMIT = 40;
const AUDIT_LIMIT = 40;

type Gate = { user: UserRow; role: "admin" | "super" } | Response;

function isResponse(value: Gate): value is Response {
  return value instanceof Response;
}

async function gate(request: Request, deps: AccountDeps, now: number): Promise<Gate> {
  if (!originAllowed(request)) return fail(403, "That request was refused.");
  const user = await accountFromRequest(request, deps.sql, now);
  if (!user) return fail(401, "Log in to continue.");
  const role = await adminRole(deps.sql, user.email);
  // A player learns nothing about this route.
  if (role === "player") return fail(404, "Not found.");
  return { user, role };
}

async function limited(deps: AccountDeps, userId: string, now: number): Promise<boolean> {
  return !(await allowHit(deps.sql, `admin:${userId}:${Math.floor(now / HOUR_MS)}`, WRITE_LIMIT, now, HOUR_MS));
}

async function audit(deps: AccountDeps, user: UserRow, action: string, detail: string, now: number): Promise<void> {
  const note = detail.slice(0, 2000);
  const wrote = await deps.sql.run(
    `INSERT INTO admin_audit (at, actor_id, actor_email, action, detail) VALUES (?, ?, ?, ?, ?)`,
    [now, user.id, user.email, action, note],
  );
  if (wrote !== 1) throw new Error("audit");
}

function slots(stack: readonly Puzzle[], todayIndex: number): QuestionSlot[] {
  return stack.map((puzzle, position) => ({
    position,
    day: dayForPosition(position),
    locked: position <= todayIndex,
    puzzle,
  }));
}

async function overview(deps: AccountDeps, user: UserRow, role: "admin" | "super", stack: readonly Puzzle[], today: string): Promise<AdminOverview> {
  const todayIndex = positionForDay(today) ?? -1;
  const stored = await deps.sql.all<{ email: string; added_by: string; created_at: number }>(
    `SELECT email, added_by, created_at FROM admins ORDER BY email`,
    [],
  );
  const admins: AdminPerson[] = [
    { email: SUPERADMIN_EMAIL, super: true, addedBy: null, createdAt: null },
    ...stored
      .filter((row) => !isSuperadmin(row.email))
      .map((row) => ({ email: row.email, super: false, addedBy: row.added_by, createdAt: Number(row.created_at) })),
  ];
  const auditRows = await deps.sql.all<{ at: number; actor_email: string; action: string; detail: string }>(
    `SELECT at, actor_email, action, detail FROM admin_audit ORDER BY id DESC LIMIT ?`,
    [AUDIT_LIMIT],
  );
  const auditLog: AuditEntry[] = auditRows.map((row) => ({
    at: Number(row.at),
    actorEmail: row.actor_email,
    action: row.action,
    detail: row.detail,
  }));
  return {
    role,
    email: user.email,
    today,
    todayIndex,
    admins,
    questions: slots(stack, todayIndex),
    scores: await scoresOf(deps.sql, user.id),
    unlocks: user.unlocks ?? [],
    audit: auditLog,
  };
}

function puzzleFrom(value: unknown): Puzzle | null {
  try {
    const parsed = parsePuzzleFile([value]);
    return parsed[0] ?? null;
  } catch {
    return null;
  }
}

/** The public schedule: today and earlier, so tomorrow's answer is not in the page. */
export async function handleSchedule(deps: AccountDeps, seed: readonly Puzzle[]): Promise<Response> {
  const now = deps.now();
  const today = calendarDay(new Date(now));
  try {
    const stack = await ensureSchedule(deps.sql, seed, now);
    return json({ epoch: "2026-11-20", today, puzzles: publicStack(stack, today) }, 200);
  } catch (error) {
    console.error(JSON.stringify({ event: "schedule", message: error instanceof Error ? error.message : "failed" }));
    return fail(503, "The puzzles are unavailable.");
  }
}

export async function handleAdmin(request: Request, deps: AccountDeps, seed: readonly Puzzle[]): Promise<Response> {
  const now = deps.now();
  const today = calendarDay(new Date(now));
  const url = new URL(request.url);
  const path = url.pathname;
  const opened = await gate(request, deps, now);
  if (isResponse(opened)) return opened;
  const { user, role } = opened;

  let stack: Puzzle[];
  try {
    stack = await ensureSchedule(deps.sql, seed, now);
  } catch (error) {
    console.error(JSON.stringify({ event: "schedule", message: error instanceof Error ? error.message : "failed" }));
    return fail(503, "The puzzles are unavailable.");
  }

  if (path === "/api/admin" && request.method === "GET") {
    return json(await overview(deps, user, role, stack, today), 200);
  }

  if (request.method !== "POST") return fail(404, "Not found.");
  if (await limited(deps, user.id, now)) return fail(429, "Too many changes. Try again later.");
  const body = await readJson(request, 256 * 1024);
  if (!body.ok) return fail(body.status, body.error);
  const input = body.value && typeof body.value === "object" ? (body.value as Record<string, unknown>) : {};

  if (path === "/api/admin/admins") {
    if (role !== "super") return fail(404, "Not found.");
    const email = normalizeEmail(input.email);
    if (!email) return fail(400, "That email address is not valid.");
    if (isSuperadmin(email)) return fail(409, "That account is already an admin.");
    const added = await deps.sql.run(`INSERT INTO admins (email, added_by, created_at) VALUES (?, ?, ?) ON CONFLICT (email) DO NOTHING`, [
      email,
      user.email,
      now,
    ]);
    if (added !== 1) return fail(409, "That account is already an admin.");
    await audit(deps, user, "admin.add", email, now);
    return json(await overview(deps, user, role, stack, today), 200);
  }

  if (path === "/api/admin/admins/remove") {
    if (role !== "super") return fail(404, "Not found.");
    const email = normalizeEmail(input.email);
    if (!email) return fail(400, "That email address is not valid.");
    if (isSuperadmin(email)) return fail(403, "The superadmin cannot be removed.");
    const removed = await deps.sql.run(`DELETE FROM admins WHERE email = ?`, [email]);
    if (removed !== 1) return fail(404, "That account is not an admin.");
    await audit(deps, user, "admin.remove", email, now);
    return json(await overview(deps, user, role, stack, today), 200);
  }

  if (path === "/api/admin/questions") {
    const puzzle = puzzleFrom(input.puzzle);
    if (!puzzle) return fail(400, "That question needs an id, a start, a goal, a solution and 2 or 3 accepted words.");
    const position = input.position === undefined || input.position === null ? null : input.position;
    if (position !== null && (typeof position !== "number" || !Number.isInteger(position))) {
      return fail(400, "That day is not on the schedule.");
    }
    const saved = await saveQuestion(deps.sql, stack, position, puzzle, today, user.email, now);
    if (!saved.ok) return fail(saved.status, saved.error);
    await audit(deps, user, saved.added ? "question.add" : "question.update", `${dayForPosition(saved.position)} ${puzzle.id}`, now);
    const fresh = await ensureSchedule(deps.sql, seed, now);
    return json(await overview(deps, user, role, fresh, today), 200);
  }

  if (path === "/api/admin/account") {
    const hasScores = input.scores !== undefined;
    const hasUnlocks = input.unlocks !== undefined;
    if (!hasScores && !hasUnlocks) return fail(400, "That change was not understood.");
    let scores: ScoreEntry[] | null = null;
    let unlocks: CosmeticId[] | null = null;
    if (hasScores) {
      if (!Array.isArray(input.scores) || input.scores.length > 3000) return fail(400, "That score list was not understood.");
      const cleaned: ScoreEntry[] = [];
      for (const entry of input.scores) {
        const score = cleanScore(entry, today);
        if (!score) return fail(400, "One of those scores is not valid.");
        cleaned.push(score);
      }
      scores = mergeScores(cleaned);
    }
    if (hasUnlocks) {
      if (!Array.isArray(input.unlocks) || input.unlocks.length > 20) return fail(400, "That list of looks was not understood.");
      const ids = [...new Set(input.unlocks.filter(isCosmeticId))];
      if (ids.length !== input.unlocks.length) return fail(400, "That list of looks was not understood.");
      if (!ids.includes(DEFAULT_COSMETIC)) ids.unshift(DEFAULT_COSMETIC);
      unlocks = ids;
    }
    if (scores) {
      await replaceScores(deps.sql, user.id, scores, now);
      await refreshStats(deps.sql, user.id, scores, today);
      await audit(deps, user, "scores.replace", `${scores.length} scores`, now);
    }
    if (unlocks) {
      await setUnlocks(deps.sql, user.id, unlocks);
      user.unlocks = unlocks;
      await audit(deps, user, "unlocks.set", unlocks.join(","), now);
    }
    return json(await overview(deps, user, role, stack, today), 200);
  }

  return fail(404, "Not found.");
}
