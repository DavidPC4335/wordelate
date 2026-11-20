/** Shared board math. The Worker and the page both use these rules. */

export const BOARD_DAYS = 7;
export const ANONYMOUS = "Anonymous";
export const TOP_SIZE = 5;

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export type BoardStep = { op: "+" | "-"; word: string };

export type BoardAnswer = {
  puzzleId: string;
  start: string;
  goal: string;
  steps: BoardStep[];
};

export type BoardEntry = {
  rank: number;
  name: string;
  score: number;
  moves: number;
  puzzle: string;
  answer: string;
  /** Share of today's players with a strictly lower score, as a whole percent. */
  betterThan: number;
  /** Marker position on the bell, 1–99, with ties sharing the middle of their band. */
  place: number;
};

export type BoardStanding = {
  score: number;
  rank: number;
  total: number;
  betterThan: number;
  place: number;
  nameEligible: boolean;
  named: boolean;
  displayName: string;
};

export type BoardSnapshot = {
  day: string;
  total: number;
  top: BoardEntry[];
  you: BoardStanding | null;
  /** Set on a score post. Null when the board was only loaded. */
  submitted: { score: number; counted: boolean } | null;
};

export function isDayKey(day: string): boolean {
  const match = DAY_RE.exec(day);
  const yearText = match?.[1];
  const monthText = match?.[2];
  const dateText = match?.[3];
  if (!yearText || !monthText || !dateText) return false;
  const year = Number(yearText);
  const month = Number(monthText);
  const date = Number(dateText);
  if (month < 1 || month > 12 || date < 1 || date > 31) return false;
  const utc = new Date(Date.UTC(year, month - 1, date));
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === date;
}

export function shiftDay(day: string, delta: number): string {
  const match = DAY_RE.exec(day);
  const yearText = match?.[1];
  const monthText = match?.[2];
  const dateText = match?.[3];
  if (!yearText || !monthText || !dateText) return day;
  const utc = new Date(Date.UTC(Number(yearText), Number(monthText) - 1, Number(dateText) + delta));
  const year = String(utc.getUTCFullYear()).padStart(4, "0");
  const month = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const date = String(utc.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${date}`;
}

/** First day still kept. Today and the six days before it. */
export function retentionStart(today: string): string {
  return shiftDay(today, -(BOARD_DAYS - 1));
}

export function dayInWindow(day: string, today: string): boolean {
  return isDayKey(day) && isDayKey(today) && day >= retentionStart(today) && day <= today;
}

/** Players strictly below this score, out of everyone who scored today. */
export function betterThanPercent(below: number, total: number): number {
  if (total <= 0 || below <= 0) return 0;
  return Math.floor((below * 100) / total);
}

/** Where a score sits on the bell, including the middle of a tie. */
export function curvePlace(below: number, tied: number, total: number): number {
  if (total <= 0) return 50;
  const raw = ((below + tied / 2) / total) * 100;
  return Math.min(99, Math.max(1, Math.round(raw)));
}

export function belowCount(buckets: readonly { score: number; n: number }[], score: number): number {
  let below = 0;
  for (const bucket of buckets) {
    if (bucket.score < score) below += bucket.n;
  }
  return below;
}

/**
 * Inverse of the standard normal CDF. Used only to place a marker on a bell.
 * The percent itself stays the counted share, not this curve.
 */
export function normalZ(p: number): number {
  if (p <= 0) return -3.2;
  if (p >= 1) return 3.2;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const plow = 0.02425;
  const phigh = 1 - plow;
  const poly = (coeff: readonly number[], x: number): number => {
    let y = 0;
    for (const term of coeff) y = y * x + term;
    return y;
  };
  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return poly(c, q) / (poly(d, q) * q + 1);
  }
  if (p > phigh) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -poly(c, q) / (poly(d, q) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return (poly(a, r) * q) / (poly(b, r) * r + 1);
}

const NAME_RE = /^[A-Za-z0-9]+(?:[ .'-][A-Za-z0-9]+)*$/;

/** A public name, or null when the text cannot be shown. */
export function cleanName(raw: string): string | null {
  const collapsed = raw.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (collapsed.length < 1 || collapsed.length > 24) return null;
  if (!NAME_RE.test(collapsed)) return null;
  return collapsed;
}

export function formatBoardAnswer(answer: BoardAnswer): string {
  let text = answer.start;
  for (const step of answer.steps) {
    text += step.op === "+" ? " + " : " − ";
    text += step.word;
  }
  return text;
}

export function formatPuzzle(answer: BoardAnswer): string {
  return `${answer.start} → ${answer.goal}`;
}

export function parseAnswer(raw: string): BoardAnswer | null {
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object") return null;
    const record = data as { puzzleId?: unknown; start?: unknown; goal?: unknown; steps?: unknown };
    if (typeof record.puzzleId !== "string" || typeof record.start !== "string" || typeof record.goal !== "string") {
      return null;
    }
    if (!Array.isArray(record.steps) || record.steps.length < 1 || record.steps.length > 16) return null;
    const steps: BoardStep[] = [];
    for (const step of record.steps) {
      if (!step || typeof step !== "object") return null;
      const op = (step as { op?: unknown }).op;
      const word = (step as { word?: unknown }).word;
      if ((op !== "+" && op !== "-") || typeof word !== "string" || !/^[a-z]{1,32}$/.test(word)) return null;
      steps.push({ op, word });
    }
    return { puzzleId: record.puzzleId, start: record.start, goal: record.goal, steps };
  } catch {
    return null;
  }
}
