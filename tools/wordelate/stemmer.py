"""One-step stemmer. Kept in lockstep with packages/game-math/src/stem.ts.

Strips a single suffix: s, es, ed, ing, er, est, ly.
ies/ied become y. A doubled consonant before ed/ing is collapsed
(stopped -> stop). The result is kept only when it is at least 3 letters.
A matching suffix that would be shorter than that is left in place, and a
shorter overlapping suffix is not tried.

Raw prefixes are not banned. A one-letter prefix would ban half the dictionary,
so "apple" is legal when the anchor is "a", and "catalog" is legal when the
anchor is "cat".
"""

from __future__ import annotations

MIN_STEM = 3

# Suffixes that may be concatenated onto a surface form.
APPEND_SUFFIXES = ("ing", "est", "es", "ed", "er", "ly", "s")

# Tried only after ies/ied/ing/ed, longest-first where it matters.
PLAIN_SUFFIXES = ("est", "ly", "es", "er", "s")


def _is_consonant(char: str) -> bool:
    return len(char) == 1 and "a" <= char <= "z" and char not in "aeiou"


def _replace_tail(word: str, cut: int, tail: str) -> str:
    nxt = word[:-cut] + tail
    return nxt if len(nxt) >= MIN_STEM else word


def _strip_plain(word: str, cut: int) -> str:
    if len(word) - cut >= MIN_STEM:
        return word[:-cut]
    return word


def _strip_ed_ing(word: str, suffix_length: int) -> str:
    base_end = len(word) - suffix_length
    if base_end >= 2:
        last = word[base_end - 1]
        prev = word[base_end - 2]
        if last == prev and _is_consonant(last):
            undoubled = word[: base_end - 1]
            if len(undoubled) >= MIN_STEM:
                return undoubled
    return _strip_plain(word, suffix_length)


def stem(word: str) -> str:
    w = word.lower()
    if w.endswith("ies"):
        return _replace_tail(w, 3, "y")
    if w.endswith("ied"):
        return _replace_tail(w, 3, "y")
    if w.endswith("ing"):
        return _strip_ed_ing(w, 3)
    if w.endswith("ed"):
        return _strip_ed_ing(w, 2)
    for suffix in PLAIN_SUFFIXES:
        if w.endswith(suffix):
            return _strip_plain(w, len(suffix))
    return w


def differs_by_suffix(a: str, b: str) -> bool:
    """True when one surface form is the other plus one listed suffix.

    This is not a raw prefix check. The leftover must be exactly s, es, ed,
    ing, er, est, or ly.
    """
    if len(a) == len(b):
        return False
    if len(a) < len(b):
        shorter, longer = a, b
    else:
        shorter, longer = b, a
    if not longer.startswith(shorter):
        return False
    extra = longer[len(shorter) :]
    return extra in APPEND_SUFFIXES


def is_variant(word: str, anchor: str) -> bool:
    """True when `word` is `anchor` or an obvious inflection of it."""
    w = word.lower()
    a = anchor.lower()
    if not w or not a:
        return False
    if w == a:
        return True
    if stem(w) == stem(a):
        return True
    return differs_by_suffix(w, a)


def is_banned_operand(
    word: str,
    start: str,
    goal: str,
    banned: list[str] | tuple[str, ...] | set[str],
) -> bool:
    """Mirror of game-math isBannedOperand."""
    w = word.lower()
    if is_variant(w, start) or is_variant(w, goal):
        return True
    for entry in banned:
        if entry.lower() == w:
            return True
    return False


def banned_surface_forms(
    vocab: list[str],
    start: str,
    goal: str,
    irregular_index: dict[str, set[str]],
) -> list[str]:
    """Full reject list for a pair: exact, stem, suffix, and irregulars."""
    extras: set[str] = set()
    for anchor in (start, goal):
        extras.update(irregular_index.get(anchor, ()))
    banned: list[str] = []
    seen: set[str] = set()
    for word in vocab:
        if is_banned_operand(word, start, goal, extras) and word not in seen:
            banned.append(word)
            seen.add(word)
    for extra in sorted(extras):
        if extra not in seen and is_banned_operand(extra, start, goal, extras):
            banned.append(extra)
            seen.add(extra)
    return banned
