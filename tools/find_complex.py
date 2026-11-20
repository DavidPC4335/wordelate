#!/usr/bin/env python3
"""Find 3- and 4-step puzzles where the goal is the label only at the end."""

from __future__ import annotations

import json
import sys
from itertools import product
from pathlib import Path

import numpy as np
from wordfreq import top_n_list, zipf_frequency

sys.path.insert(0, str(Path(__file__).resolve().parent))

from wordelate.config import load_config
from wordelate.mathutil import cosine
from wordelate.pack import read_display_flags, read_pack
from wordelate.paths import VOCAB_ROOT
from wordelate.quantize import dequantize
from wordelate.stemmer import APPEND_SUFFIXES, is_variant, stem

STOP = {
    "the", "and", "that", "have", "for", "not", "with", "you", "this", "but",
    "his", "from", "they", "say", "her", "she", "will", "one", "all", "would",
    "there", "their", "what", "out", "about", "who", "get", "which", "when",
    "make", "can", "like", "time", "just", "him", "know", "take", "people",
    "into", "year", "your", "some", "could", "them", "see", "other", "than",
    "then", "now", "look", "only", "come", "its", "over", "think", "also",
    "back", "after", "use", "two", "how", "our", "work", "first", "well",
    "way", "even", "new", "want", "because", "any", "these", "give", "day",
    "most", "us", "were", "been", "has", "had", "was", "are", "were", "did",
    "does", "doing", "been", "being", "very", "more", "much", "many", "such",
    "own", "same", "too", "may", "might", "must", "shall", "should", "here",
    "where", "why", "while", "during", "before", "again", "still", "off",
    "down", "under", "between", "both", "each", "few", "those", "through",
    "without", "another", "something", "nothing", "everything", "someone",
    "anyone", "really", "going", "went", "got", "made", "said", "says",
}

TARGETS = [
    "sushi", "tokyo", "beijing", "rome", "beach", "desert", "snow", "airplane",
    "boat", "submarine", "bird", "teacher", "queen", "king", "princess", "prince",
    "puppy", "kitten", "lion", "wolf", "mother", "daughter", "son", "niece",
    "winter", "summer", "flower", "tree", "cheese", "wine", "toe", "ice",
    "elephant", "castle", "palace", "moon", "island", "nurse", "song", "silver",
]

STARTS = [
    "paris", "rome", "italy", "london", "madrid", "berlin", "france", "winter",
    "summer", "sun", "snow", "ocean", "beach", "car", "fish", "bird", "doctor",
    "boy", "girl", "child", "cat", "dog", "wolf", "kitten", "puppy", "king",
    "queen", "father", "mother", "prince", "uncle", "day", "night", "seed",
    "cow", "bread", "hand", "fire", "mouse", "house", "tree", "river", "walk",
    "gold", "soldier", "book", "happy", "puppy",
]


def load():
    cfg = load_config()
    current = json.loads((VOCAB_ROOT / "current.json").read_text(encoding="utf-8"))
    directory = VOCAB_ROOT / current["hash"]
    words, matrix, scales = read_pack(directory / "nearest.i8")
    display = read_display_flags(directory / "nearest.i8")
    rows = dequantize(matrix, scales).astype(np.float64)
    norms = np.linalg.norm(rows, axis=1)
    norms = np.maximum(norms, 1e-12)
    unit = rows / norms[:, None]
    index = {word: i for i, word in enumerate(words)}
    stems = [stem(word) for word in words]
    by_stem: dict[str, list[int]] = {}
    for i, key in enumerate(stems):
        by_stem.setdefault(key, []).append(i)
    return cfg, words, rows, unit, display.astype(bool), index, by_stem


def variant_indexes(words, index, by_stem, anchor: str) -> set[int]:
    found = set(by_stem.get(stem(anchor), ()))
    exact = index.get(anchor)
    if exact is not None:
        found.add(exact)
    for suffix in APPEND_SUFFIXES:
        longer = anchor + suffix
        hit = index.get(longer)
        if hit is not None:
            found.add(hit)
    for suffix in APPEND_SUFFIXES:
        if anchor.endswith(suffix) and len(anchor) - len(suffix) >= 3:
            shorter = anchor[: -len(suffix)]
            hit = index.get(shorter)
            if hit is not None and is_variant(anchor, shorter):
                found.add(hit)
    return found


def primary_labels(words, unit, display, index, by_stem, position, anchors, goal, cutoff, count):
    pos_norm = float(np.linalg.norm(position))
    if pos_norm == 0.0:
        return []
    scores = unit @ (position / pos_norm)
    anchor_rows = unit[[index[word] for word in anchors if word in index]]
    nearest = anchor_rows @ unit.T
    nearest = nearest.max(axis=0) if nearest.size else np.full(len(words), -1.0)
    banned = set()
    for anchor in anchors:
        banned.update(variant_indexes(words, index, by_stem, anchor))
    goal_i = index[goal]
    allowed = display & (nearest <= cutoff)
    allowed[goal_i] = True
    if banned:
        allowed[np.fromiter(banned, dtype=np.int64, count=len(banned))] = False
    scores = np.where(allowed, scores, -np.inf)
    k = min(count, int(np.isfinite(scores).sum()))
    if k <= 0:
        return []
    pick = np.argpartition(-scores, k - 1)[:k]
    pick = pick[np.argsort(-scores[pick])]
    return [(words[i], float(scores[i])) for i in pick.tolist()]


def apply_moves(rows, index, start, moves):
    position = rows[index[start]].copy()
    for sign, word in moves:
        position += sign * rows[index[word]]
    return position


def subsets(moves):
    n = len(moves)
    full = (1 << n) - 1
    for mask in range(1, full):
        yield [step for bit, step in enumerate(moves) if mask & (1 << bit)]


def minimal_win(words, rows, unit, display, index, by_stem, start, goal, moves, cutoff, warm):
    """Smallest subset (len>=3) whose primary label is the goal, if every smaller one misses."""
    winning = []

    def check(part):
        position = apply_moves(rows, index, start, part)
        similarity = float(cosine(position, rows[index[goal]]))
        anchors = [start, *[word for _sign, word in part]]
        count = 3 if similarity >= warm else 1
        labels = primary_labels(
            words, unit, display, index, by_stem, position, anchors, goal, cutoff, count
        )
        shown = [word for word, _score in labels]
        return similarity, shown

    # Walk subset sizes from small to large so the first hit is minimal.
    ordered = sorted(subsets(moves), key=len)
    # Include the full move list.
    ordered.append(list(moves))
    seen = set()
    for part in ordered:
        key = tuple(sorted(part))
        if key in seen:
            continue
        seen.add(key)
        similarity, shown = check(part)
        if shown and shown[0] == goal and similarity < 0.75:
            # Confirm nothing smaller already won. Because we go by size, any earlier
            # win would have been returned. Similarity >= 0.75 also wins the game
            # even with a different label, so reject those smaller positions.
            return part, similarity, shown
        if similarity >= 0.75 and part != list(moves):
            # A shorter position already clears the hidden line.
            if len(part) < len(moves):
                return None
    return None


def content_pool(index, display_words, extra, limit=110):
    pool = []
    for word in top_n_list("en", 4000):
        if word in STOP or len(word) < 3:
            continue
        if word not in index or word not in display_words:
            continue
        if zipf_frequency(word, "en") < 3.6:
            continue
        pool.append(word)
        if len(pool) >= limit:
            break
    for word in extra:
        if word in index and word not in pool and word not in STOP:
            pool.append(word)
    return pool


def search_length(rows, index, start, goal, pool, steps, floor):
    pool = [word for word in pool if word not in (start, goal) and not is_variant(word, start) and not is_variant(word, goal)]
    # Drop operands that are variants of each other later, per tuple.
    if len(pool) < steps:
        return []
    vecs = np.stack([rows[index[word]] for word in pool]).astype(np.float32)
    start_vec = rows[index[start]].astype(np.float32)
    goal_vec = rows[index[goal]].astype(np.float32)
    goal_norm = float(np.linalg.norm(goal_vec))
    dot_g = vecs @ goal_vec
    dot_s = vecs @ start_vec
    row_sq = np.einsum("ij,ij->i", vecs, vecs)
    gram = vecs @ vecs.T
    start_sq = float(np.dot(start_vec, start_vec))
    dot_sg = float(np.dot(start_vec, goal_vec))
    p = len(pool)
    best: list[tuple[float, list[tuple[int, str]]]] = []

    def consider(score, moves):
        if score < floor:
            return
        used = [word for _sign, word in moves]
        if len(set(used)) < len(used):
            return
        if any(is_variant(a, b) for a, b in product(used, repeat=2) if a != b):
            return
        # Each operand should sit near the start or the goal, so the step is readable.
        for word in used:
            vec = rows[index[word]]
            if max(cosine(vec, rows[index[start]]), cosine(vec, rows[index[goal]])) < 0.18:
                return
        best.append((score, moves))

    if steps == 3:
        for signs in product((-1, 1), repeat=3):
            s1, s2, s3 = signs
            sq = (
                start_sq
                + row_sq[:, None, None]
                + row_sq[None, :, None]
                + row_sq[None, None, :]
                + 2 * s1 * dot_s[:, None, None]
                + 2 * s2 * dot_s[None, :, None]
                + 2 * s3 * dot_s[None, None, :]
                + 2 * s1 * s2 * gram[:, :, None]
                + 2 * s1 * s3 * gram[:, None, :]
                + 2 * s2 * s3 * gram[None, :, :]
            )
            num = (
                dot_sg
                + s1 * dot_g[:, None, None]
                + s2 * dot_g[None, :, None]
                + s3 * dot_g[None, None, :]
            )
            cos = num / (np.sqrt(np.maximum(sq, 1e-8)) * goal_norm)
            flat = cos.reshape(-1)
            k = min(12, flat.size - 1)
            pick = np.argpartition(-flat, k)[: k + 1]
            n = p
            for slot in pick.tolist():
                i = slot // (n * n)
                rem = slot % (n * n)
                j = rem // n
                m = rem % n
                if len({i, j, m}) < 3:
                    continue
                consider(
                    float(flat[slot]),
                    [(s1, pool[i]), (s2, pool[j]), (s3, pool[m])],
                )
    else:
        for signs in product((-1, 1), repeat=4):
            s1, s2, s3, s4 = signs
            local: list[tuple[float, tuple[int, int, int, int]]] = []
            for i in range(p):
                base = start_vec + s1 * vecs[i]
                base_sq = float(np.dot(base, base))
                base_g = float(np.dot(base, goal_vec))
                base_dots = vecs @ base
                sq = (
                    base_sq
                    + row_sq[:, None, None]
                    + row_sq[None, :, None]
                    + row_sq[None, None, :]
                    + 2 * s2 * base_dots[:, None, None]
                    + 2 * s3 * base_dots[None, :, None]
                    + 2 * s4 * base_dots[None, None, :]
                    + 2 * s2 * s3 * gram[:, :, None]
                    + 2 * s2 * s4 * gram[:, None, :]
                    + 2 * s3 * s4 * gram[None, :, :]
                )
                num = (
                    base_g
                    + s2 * dot_g[:, None, None]
                    + s3 * dot_g[None, :, None]
                    + s4 * dot_g[None, None, :]
                )
                cos = num / (np.sqrt(np.maximum(sq, 1e-8)) * goal_norm)
                flat = np.asarray(cos, dtype=np.float32).reshape(-1)
                kth = min(3, flat.size - 1)
                pick = np.argpartition(-flat, kth)[: kth + 1]
                for slot in pick.tolist():
                    score = float(flat[slot])
                    if score < floor:
                        continue
                    j = slot // (p * p)
                    rem = slot % (p * p)
                    k = rem // p
                    m = rem % p
                    local.append((score, (i, j, k, m)))
            local.sort(reverse=True)
            for score, (i, j, k, m) in local[:8]:
                if len({i, j, k, m}) < 4:
                    continue
                consider(
                    score,
                    [(s1, pool[i]), (s2, pool[j]), (s3, pool[k]), (s4, pool[m])],
                )
    best.sort(key=lambda item: item[0], reverse=True)
    uniq = []
    seen = set()
    for score, moves in best:
        key = tuple(sorted(moves))
        if key in seen:
            continue
        seen.add(key)
        uniq.append((score, moves))
        if len(uniq) >= 8:
            break
    return uniq


def readable_order(rows, index, start, goal, moves):
    negatives = [(sign, word) for sign, word in moves if sign < 0]
    positives = [(sign, word) for sign, word in moves if sign > 0]
    negatives.sort(key=lambda item: cosine(rows[index[item[1]]], rows[index[start]]), reverse=True)
    positives.sort(key=lambda item: cosine(rows[index[item[1]]], rows[index[goal]]), reverse=True)
    return negatives + positives


def equation(start, moves, goal):
    parts = [start]
    for sign, word in moves:
        parts.append(("+ " if sign > 0 else "- ") + word)
    return " ".join(parts) + f" -> {goal}"


def main() -> None:
    cfg, words, rows, unit, display, index, by_stem = load()
    cutoff = float(cfg["labelNearDuplicateCutoff"])
    warm = float(cfg["labelWarmSimilarity"])
    display_words = {word for word, flag in zip(words, display) if flag}
    extras = [
        "sushi", "tokyo", "beijing", "japan", "china", "france", "italy", "rome",
        "paris", "london", "england", "spain", "madrid", "germany", "berlin",
        "food", "rice", "fish", "sand", "snow", "beach", "desert", "airplane",
        "boat", "submarine", "queen", "king", "princess", "puppy", "kitten",
        "lion", "wolf", "mother", "daughter", "cheese", "wine", "castle",
        "palace", "moon", "island", "nurse", "flower", "elephant", "teacher",
        "hospital", "school", "baby", "royal", "crown", "meow", "bark",
    ]
    pool = content_pool(index, display_words, extras, 100)
    print(f"pool {len(pool)}", flush=True)
    pairs = []
    for start in STARTS:
        for goal in TARGETS:
            if start == goal or start not in index or goal not in index:
                continue
            if is_variant(start, goal):
                continue
            direct = float(cosine(rows[index[start]], rows[index[goal]]))
            # Skip pairs that are already neighbors. Those are one-step puzzles.
            if direct >= 0.55 or direct < 0.12:
                continue
            pairs.append((direct, start, goal))
    pairs.sort(key=lambda item: abs(item[0] - 0.32))
    # Spread across goals so one goal does not eat the whole search.
    chosen = []
    per_goal: dict[str, int] = {}
    for direct, start, goal in pairs:
        if per_goal.get(goal, 0) >= 2:
            continue
        per_goal[goal] = per_goal.get(goal, 0) + 1
        chosen.append((start, goal))
        if len(chosen) >= 36:
            break
    print(f"pairs {len(chosen)}", flush=True)
    kept = []
    for start, goal in chosen:
        found = None
        for steps in (3,):
            if steps == 4 and found:
                break
            floor = 0.50 if steps == 3 else 0.52
            # 4-step uses a shorter pool so the cube stays cheap.
            use_pool = pool if steps == 3 else pool[:70]
            candidates = search_length(rows, index, start, goal, use_pool, steps, floor)
            for _score, moves in candidates:
                hit = minimal_win(
                    words, rows, unit, display, index, by_stem, start, goal, moves, cutoff, warm
                )
                if not hit:
                    continue
                part, similarity, shown = hit
                if len(part) < 3:
                    continue
                ordered = readable_order(rows, index, start, goal, part)
                print(
                    f"OK {equation(start, ordered, goal)} {similarity:.3f} {shown}",
                    flush=True,
                )
                kept.append((start, goal, ordered, similarity, shown))
                found = True
                break
        if not found:
            print(f"-- {start} -> {goal}", flush=True)
    print(f"kept {len(kept)}", flush=True)


if __name__ == "__main__":
    main()
