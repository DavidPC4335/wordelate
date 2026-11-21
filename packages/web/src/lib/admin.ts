import { SCHEDULE_EPOCH } from "./puzzles.js";
import type { Puzzle } from "./puzzles.js";
import type { CosmeticId } from "./rewards.js";
import { daysBetween, shiftDay } from "./standings.js";
import type { ScoreEntry } from "./storage.js";

/** The one account that is always an admin and the only one that can edit the admin list. */
export const SUPERADMIN_EMAIL = "daviddev4335@gmail.com";

export type AdminRole = "player" | "admin" | "super";

const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

/** Lower case, or null when it is not a plain email address. */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length < 6 || email.length > 320 || !EMAIL.test(email)) return null;
  return email;
}

export function isSuperadmin(email: string): boolean {
  return email === SUPERADMIN_EMAIL;
}

/** Where a stack position falls on the calendar. Position 0 is the first scheduled day. */
export function dayForPosition(position: number): string {
  return shiftDay(SCHEDULE_EPOCH, position);
}

/** The stack position for a calendar day, or null when that day is before the schedule. */
export function positionForDay(day: string): number | null {
  const delta = daysBetween(SCHEDULE_EPOCH, day);
  if (delta == null || delta < 0) return null;
  return delta;
}

export type AdminPerson = {
  email: string;
  super: boolean;
  addedBy: string | null;
  createdAt: number | null;
};

export type QuestionSlot = {
  position: number;
  day: string;
  /** Today and every earlier day are frozen. */
  locked: boolean;
  puzzle: Puzzle;
};

export type AuditEntry = {
  at: number;
  actorEmail: string;
  action: string;
  detail: string;
};

export type AdminOverview = {
  role: Exclude<AdminRole, "player">;
  email: string;
  today: string;
  todayIndex: number;
  admins: AdminPerson[];
  questions: QuestionSlot[];
  scores: ScoreEntry[];
  unlocks: CosmeticId[];
  audit: AuditEntry[];
};
