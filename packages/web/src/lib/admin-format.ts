/** Small text helpers the admin page and the playtest "save as question" panel share. */

export function wordId(word: string): string {
  return word.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** New questions take their id from the two words, so nobody has to type one. */
export function autoId(start: string, goal: string): string {
  const left = wordId(start);
  const right = wordId(goal);
  if (!left || !right) return "";
  return `${left}-${right}`;
}

/** That id, or the same id with -2, -3 … when another day already uses it. */
export function freeId(base: string, taken: ReadonlySet<string>): string {
  if (!base || !taken.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const next = `${base}-${n}`;
    if (!taken.has(next)) return next;
  }
  return `${base}-${Date.now()}`;
}

/** "Nov 22" for a day key such as 2026-11-22. */
export function shortDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, date ?? 1)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** The day after a day key, in the same format. */
export function nextDayKey(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  const moved = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (date ?? 1) + 1));
  return moved.toISOString().slice(0, 10);
}

/** Two or three lowercase words, or null when the text is not that. */
export function parseAccepted(text: string): string[] | null {
  const words = text
    .split(/[,\s]+/)
    .map((word) => word.trim().toLowerCase())
    .filter((word) => word.length > 0);
  if (words.length < 2 || words.length > 3) return null;
  if (words.some((word) => !/^[a-z]+$/.test(word))) return null;
  return [...new Set(words)].length === words.length ? words : null;
}
