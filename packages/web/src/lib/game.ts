import { isVariant, replay } from "@wordelate/game-math";
import type { Move, ReplaySuccess, VectorFor } from "@wordelate/game-math";

export const MAX_MOVES = 16;

export type AppliedStep = { op: "+" | "-"; word: string };

export type PlayInput = {
  start: Float32Array;
  goal: Float32Array;
  startWord: string;
  goalWord: string;
  moves: readonly Move[];
  vectorFor: VectorFor;
  banned: readonly string[];
  maxMoves: number;
};

export type CommitResult =
  | { ok: true; moves: Move[]; result: ReplaySuccess }
  | { ok: false; error: string };

export function formatPercent(similarity: number): string {
  const shown = similarity * 100;
  if (Math.abs(shown - Math.round(shown)) < 0.05) return String(Math.round(shown));
  return shown.toFixed(1);
}

/**
 * Meter value. 0 is the puzzle's starting similarity, 1 is the goal vector.
 * A win is drawn as a completed trip even when the landing vector is not the goal itself.
 */
export function progressTowardGoal(input: {
  similarity: number;
  startSimilarity: number;
  won: boolean;
}): number {
  if (input.won) return 1;
  const span = 1 - input.startSimilarity;
  if (!(span > 1e-6)) return 0;
  const raw = (input.similarity - input.startSimilarity) / span;
  if (!Number.isFinite(raw)) return 0;
  return Math.min(1, Math.max(0, raw));
}

/** Public game address. The share sheet attaches this so the link sits in the message. */
export const WORD_ELATE_URL = "https://wordelate.com/";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** "Nov 20th" for a YYYY-MM-DD day. Anything else comes back unchanged. */
export function shareDate(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  const month = MONTHS[Number(match?.[2]) - 1];
  const date = Number(match?.[3]);
  if (!match || !month || !(date >= 1 && date <= 31)) return day;
  return `${month} ${ordinal(date)}`;
}

/**
 * The share message. A win leads with the day and the points, then says how it went.
 * An unfinished game leads with the puzzle and how far along it is. The equation closes it out.
 */
export function shareText(input: {
  /** The calendar day this puzzle belongs to, as YYYY-MM-DD. */
  day: string;
  start: string;
  goal: string;
  movesUsed: number;
  similarity: number;
  equation: string;
  won: boolean;
  points: number;
  par: number | null;
  streak: number;
  practice: boolean;
}): string {
  const title = `Wordelate ${shareDate(input.day)}${input.practice ? " (practice)" : ""}`;
  const moves = `${input.movesUsed} ${input.movesUsed === 1 ? "move" : "moves"}`;
  const lines: string[] = [];
  if (input.won) {
    lines.push(`${title}: ${input.points} ${input.points === 1 ? "point" : "points"}!`);
    const par = input.par ? ` (par ${input.par})` : "";
    const streak = !input.practice && input.streak >= 2 ? ` ${input.streak} day streak.` : "";
    lines.push(`I got from ${input.start} to ${input.goal} in ${moves}${par}.${streak}`);
  } else {
    lines.push(`${title}: ${input.start}→${input.goal}`);
    lines.push(`${formatPercent(input.similarity)}% of the way there in ${input.movesUsed}/${MAX_MOVES} moves.`);
  }
  const equation = input.equation.trim();
  if (equation.length > 0) lines.push(equation);
  return lines.join("\n");
}

/** Clipboard text. The share sheet sends the same words and attaches the link itself. */
export function shareMessage(text: string): string {
  return `${text}\n\n${WORD_ELATE_URL}`;
}

/** Rich paste: the same words with "Wordelate" as a link, plus the graph when a picture is available. */
export function shareHtml(text: string, imageSrc: string | null): string {
  const link = `<a href="${escapeHtml(WORD_ELATE_URL)}">Wordelate</a>`;
  const lines = escapeHtml(text).replace(/^Wordelate/, link).replaceAll("\n", "<br>");
  if (!imageSrc) return `<p>${lines}</p>`;
  return `<p>${lines}</p><img src="${escapeHtml(imageSrc)}" alt="Graph">`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Hide a label this close to the start word or any single operand. Not shown. */
export const LABEL_NEAR_DUPLICATE_CUTOFF = 0.7;

/** At or above this similarity to the goal, show three labels instead of one. Not shown. */
export const LABEL_WARM_SIMILARITY = 0.45;

/**
 * Win only after at least one applied move, when the primary "You are here"
 * word is the goal, an accepted alternate, or an inflection of either
 * (airplanes counts as airplane). Similarity is displayed on the meter and
 * never grants a win. Zero applied moves is never a win.
 */
export function countsAsWin(input: {
  similarity: number;
  hereWord: string | null;
  goalWord: string;
  movesUsed: number;
  acceptedWords?: readonly string[];
}): boolean {
  if (input.movesUsed < 1) return false;
  const here = input.hereWord?.trim().toLowerCase() ?? "";
  if (here.length === 0) return false;
  const goal = input.goalWord.trim().toLowerCase();
  if (isVariant(here, goal)) return true;
  const accepted = input.acceptedWords ?? [];
  return accepted.some((word) => isVariant(here, word));
}

/**
 * With no operands left on the equation, the position is the start word's vector.
 * Report that word even if a neighbor would otherwise win the scan.
 */
export function hereAtPosition(input: {
  startWord: string;
  equationWords: readonly string[];
  nearest: string | null;
}): string | null {
  if (input.equationWords.length === 0) {
    const start = input.startWord.trim();
    return start.length > 0 ? start : null;
  }
  return input.nearest;
}

/**
 * Once the position counts as a win, the goal is "You are here" even if
 * another vocab word is slightly closer. Callers keep a fresh start as the
 * start word instead of using this substitution.
 */
export function hereLabel(won: boolean, goal: string, nearest: string | null): string | null {
  if (won) return goal;
  return nearest;
}

export function appliedSteps(moves: readonly Move[]): AppliedStep[] {
  const stack: AppliedStep[] = [];
  for (const move of moves) {
    if (move.op === "undo") {
      stack.pop();
      continue;
    }
    const word = move.word?.trim().toLowerCase() ?? "";
    if ((move.op === "+" || move.op === "-") && word.length > 0) {
      stack.push({ op: move.op, word });
    }
  }
  return stack;
}

export function formatEquation(start: string, steps: readonly AppliedStep[]): string {
  let text = start;
  for (const step of steps) {
    const sign = step.op === "+" ? "+" : "−";
    text += ` ${sign} ${step.word}`;
  }
  return text;
}

export function describeMoveError(error: string): string {
  switch (error) {
    case "Unknown word":
      return "That word isn’t in the vocabulary.";
    case "Banned operand":
      return "You can’t use the start word, the goal, or an obvious variant.";
    case "Word already used":
      return "That word is already in the equation.";
    case "Move limit exceeded":
      return "You’ve used all 16 moves.";
    case "Nothing to undo":
      return "Nothing to undo.";
    case "Missing word":
      return "Type a word first.";
    default:
      return error;
  }
}

function normalizeMove(move: Move): Move {
  if (move.op === "undo") return { op: "undo" };
  return { op: move.op, word: (move.word ?? "").trim().toLowerCase() };
}

/** Validate one more move with replay(), which also enforces undo and bans. */
export function commitMove(input: PlayInput, move: Move): CommitResult {
  const next = normalizeMove(move);
  if (next.op !== "undo" && (next.word === undefined || next.word.length === 0)) {
    return { ok: false, error: "Missing word" };
  }
  const moves = [...input.moves, next];
  const result = replay({ ...input, moves });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, moves, result };
}

export function playMoves(input: PlayInput) {
  return replay(input);
}
