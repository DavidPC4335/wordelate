/**
 * One-step stemmer for start/goal variants.
 *
 * Strips a single suffix: s, es, ed, ing, er, est, ly.
 * ies/ied become y. A doubled consonant before ed/ing is collapsed
 * (stopped -> stop). The result is kept only when it is at least 3 letters.
 * A matching suffix that would be shorter than that is left in place, and a
 * shorter overlapping suffix is not tried.
 */

const MIN_STEM = 3;

/** Suffixes that may be concatenated onto a surface form. */
const APPEND_SUFFIXES = ["ing", "est", "es", "ed", "er", "ly", "s"] as const;

const PLAIN_SUFFIXES = ["est", "ly", "es", "er", "s"] as const;

function isConsonant(c: string): boolean {
  return c.length === 1 && c >= "a" && c <= "z" && !"aeiou".includes(c);
}

function replaceTail(word: string, cut: number, tail: string): string {
  const next = word.slice(0, -cut) + tail;
  return next.length >= MIN_STEM ? next : word;
}

function stripPlain(word: string, cut: number): string {
  if (word.length - cut >= MIN_STEM) return word.slice(0, -cut);
  return word;
}

function stripEdIng(word: string, suffixLength: number): string {
  const baseEnd = word.length - suffixLength;
  if (baseEnd >= 2) {
    const last = word.charAt(baseEnd - 1);
    const prev = word.charAt(baseEnd - 2);
    if (last === prev && isConsonant(last)) {
      const undoubled = word.slice(0, baseEnd - 1);
      if (undoubled.length >= MIN_STEM) return undoubled;
    }
  }
  return stripPlain(word, suffixLength);
}

export function stem(word: string): string {
  const w = word.toLowerCase();
  if (w.endsWith("ies")) return replaceTail(w, 3, "y");
  if (w.endsWith("ied")) return replaceTail(w, 3, "y");
  if (w.endsWith("ing")) return stripEdIng(w, 3);
  if (w.endsWith("ed")) return stripEdIng(w, 2);
  for (const suffix of PLAIN_SUFFIXES) {
    if (w.endsWith(suffix)) return stripPlain(w, suffix.length);
  }
  return w;
}

function differsBySuffix(a: string, b: string): boolean {
  if (a.length === b.length) return false;
  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  if (!longer.startsWith(shorter)) return false;
  const extra = longer.slice(shorter.length);
  return (APPEND_SUFFIXES as readonly string[]).includes(extra);
}

/** True when `word` is `anchor` or an obvious inflection of it. */
export function isVariant(word: string, anchor: string): boolean {
  const w = word.toLowerCase();
  const a = anchor.toLowerCase();
  if (w.length === 0 || a.length === 0) return false;
  if (w === a) return true;
  if (stem(w) === stem(a)) return true;
  return differsBySuffix(w, a);
}

export function isBannedOperand(
  word: string,
  start: string,
  goal: string,
  banned: readonly string[],
): boolean {
  const w = word.toLowerCase();
  if (isVariant(w, start) || isVariant(w, goal)) return true;
  for (const entry of banned) {
    if (entry.toLowerCase() === w) return true;
  }
  return false;
}
