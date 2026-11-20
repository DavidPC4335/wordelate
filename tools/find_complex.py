#!/usr/bin/env python3
"""Search for 3- and 4-step puzzles whose filtered label is the goal.

Prints candidates. Does not write puzzles.json.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from wordelate.config import load_config
from wordelate.labels import rank_labels
from wordelate.mathutil import cosine
from wordelate.pack import read_display_flags, read_pack
from wordelate.paths import VOCAB_ROOT
from wordelate.quantize import dequantize
from wordelate.stemmer import is_variant

POOL = [
    "man", "woman", "boy", "girl", "child", "baby", "adult", "father", "mother",
    "son", "daughter", "brother", "sister", "uncle", "aunt", "prince", "princess",
    "husband", "wife", "king", "queen", "royal", "crown", "palace", "parent",
    "dog", "cat", "puppy", "kitten", "animal", "pet", "wolf", "horse", "bird",
    "fish", "cow", "mouse", "lion", "bark", "meow",
    "water", "sand", "ocean", "beach", "desert", "dry", "wet", "rain", "snow",
    "ice", "hot", "cold", "sun", "moon", "day", "night", "summer", "winter",
    "car", "road", "boat", "sky", "air", "fly", "drive", "plane", "train", "ship",
    "doctor", "hospital", "school", "teacher", "student", "book", "nurse",
    "paris", "france", "rome", "italy", "london", "england", "japan", "china",
    "tokyo", "city", "capital",
    "food", "bread", "milk", "cheese", "grape", "wine", "fruit",
    "tree", "wood", "flower", "leaf", "seed", "garden",
    "hand", "foot", "finger", "toe", "arm", "leg",
    "big", "small", "young", "old", "strong", "weak",
    "happy", "sad", "good", "bad", "love", "war",
    "house", "home", "castle", "mountain", "forest", "river", "island",
    "music", "song", "art", "money", "work", "play", "game",
    "fire", "earth", "stone", "metal", "gold", "silver",
    "red", "blue", "green", "white", "black",
    "fast", "slow", "high", "low", "long", "short",
]

TARGETS = [
    ("boy", "queen"),
    ("girl", "king"),
    ("child", "queen"),
    ("puppy", "kitten"),
    ("kitten", "puppy"),
    ("cat", "puppy"),
    ("dog", "kitten"),
    ("wolf", "kitten"),
    ("paris", "tokyo"),
    ("london", "rome"),
    ("france", "tokyo"),
    ("ocean", "desert"),
    ("ocean", "camel"),
    ("beach", "desert"),
    ("winter", "beach"),
    ("summer", "snow"),
    ("snow", "beach"),
    ("car", "airplane"),
    ("car", "boat"),
    ("car", "submarine"),
    ("doctor", "teacher"),
    ("fish", "bird"),
    ("bird", "fish"),
    ("water", "desert"),
    ("day", "moon"),
    ("seed", "flower"),
    ("cow", "cheese"),
    ("bread", "wine"),
    ("hand", "toe"),
    ("prince", "mother"),
    ("son", "grandmother"),
    ("mouse", "elephant"),
    ("ant", "whale"),
    ("walk", "swim"),
    ("castle", "president"),
    ("king", "mother"),
]

# Story equations to try even if the pool search misses them.
HAND = [
    ("boy", "queen", [(-1, "child"), (1, "king"), (-1, "man"), (1, "woman")]),
    ("girl", "king", [(-1, "child"), (1, "queen"), (-1, "woman"), (1, "man")]),
    ("child", "queen", [(1, "king"), (-1, "man"), (1, "woman")]),
    ("puppy", "kitten", [(-1, "dog"), (1, "cat")]),
    ("kitten", "puppy", [(-1, "cat"), (1, "dog")]),
    ("cat", "puppy", [(-1, "meow"), (1, "bark"), (1, "baby")]),
    ("cat", "puppy", [(-1, "cat"), (1, "dog"), (1, "baby")]),
    ("dog", "kitten", [(-1, "bark"), (1, "meow"), (1, "baby")]),
    ("dog", "kitten", [(1, "baby"), (-1, "dog"), (1, "cat")]),
    ("wolf", "kitten", [(-1, "dog"), (1, "cat"), (1, "baby")]),
    ("paris", "tokyo", [(-1, "france"), (1, "japan")]),
    ("paris", "beijing", [(-1, "france"), (1, "china")]),
    ("london", "rome", [(-1, "england"), (1, "italy")]),
    ("france", "tokyo", [(-1, "paris"), (1, "japan"), (1, "city")]),
    ("ocean", "desert", [(-1, "water"), (1, "sand")]),
    ("ocean", "desert", [(-1, "water"), (1, "sand"), (-1, "wet"), (1, "dry")]),
    ("ocean", "camel", [(-1, "water"), (1, "sand"), (1, "animal")]),
    ("beach", "desert", [(-1, "water"), (1, "dry")]),
    ("beach", "desert", [(-1, "ocean"), (1, "sand")]),
    ("winter", "beach", [(-1, "cold"), (1, "hot"), (-1, "snow"), (1, "sand")]),
    ("winter", "beach", [(-1, "snow"), (1, "sand"), (-1, "cold"), (1, "sun")]),
    ("summer", "snow", [(-1, "hot"), (1, "cold"), (1, "winter")]),
    ("snow", "beach", [(-1, "cold"), (1, "hot"), (-1, "winter"), (1, "sand")]),
    ("car", "airplane", [(-1, "road"), (1, "sky")]),
    ("car", "airplane", [(-1, "road"), (1, "air"), (1, "fly")]),
    ("car", "boat", [(-1, "road"), (1, "water")]),
    ("car", "submarine", [(-1, "road"), (1, "water"), (-1, "sky"), (1, "ocean")]),
    ("doctor", "teacher", [(-1, "hospital"), (1, "school")]),
    ("fish", "bird", [(-1, "water"), (1, "air")]),
    ("fish", "bird", [(-1, "swim"), (1, "fly")]),
    ("fish", "bird", [(-1, "ocean"), (1, "sky")]),
    ("bird", "fish", [(-1, "sky"), (1, "water")]),
    ("bird", "fish", [(-1, "air"), (1, "water")]),
    ("water", "desert", [(-1, "wet"), (1, "dry"), (-1, "rain"), (1, "sand")]),
    ("day", "moon", [(-1, "sun"), (1, "night")]),
    ("seed", "flower", [(1, "water"), (1, "sun"), (-1, "earth")]),
    ("seed", "flower", [(1, "garden"), (-1, "earth")]),
    ("cow", "cheese", [(1, "milk"), (-1, "animal")]),
    ("bread", "wine", [(-1, "flour"), (1, "grape")]),
    ("hand", "toe", [(-1, "finger"), (1, "foot")]),
    ("hand", "toe", [(-1, "arm"), (1, "leg"), (-1, "finger"), (1, "foot")]),
    ("prince", "mother", [(-1, "boy"), (1, "woman"), (-1, "royal"), (1, "parent")]),
    ("prince", "mother", [(-1, "king"), (1, "parent"), (-1, "man"), (1, "woman")]),
    ("king", "mother", [(-1, "man"), (1, "woman"), (-1, "royal"), (1, "parent")]),
    ("king", "mother", [(-1, "crown"), (1, "child"), (-1, "man"), (1, "woman")]),
    ("mouse", "elephant", [(-1, "small"), (1, "big"), (1, "animal")]),
    ("summer", "ski", [(-1, "hot"), (1, "cold"), (1, "snow")]),
    ("cat", "horse", [(-1, "small"), (1, "big"), (-1, "pet"), (1, "animal")]),
    ("dog", "lion", [(-1, "pet"), (1, "wild"), (1, "cat")]),
    ("boy", "princess", [(-1, "man"), (1, "woman"), (1, "royal")]),
    ("girl", "prince", [(-1, "woman"), (1, "man"), (1, "royal")]),
    ("puppy", "queen", [(-1, "dog"), (1, "king"), (-1, "man"), (1, "woman")]),
    ("kitten", "princess", [(-1, "cat"), (1, "prince"), (-1, "man"), (1, "woman")]),
    ("paris", "sushi", [(-1, "france"), (1, "japan"), (1, "food")]),
    ("italy", "sushi", [(-1, "rome"), (1, "japan"), (1, "food")]),
    ("rome", "tokyo", [(-1, "italy"), (1, "japan")]),
    ("berlin", "paris", [(-1, "germany"), (1, "france")]),
    ("spain", "tokyo", [(-1, "madrid"), (1, "japan")]),
    ("uncle", "niece", [(-1, "man"), (1, "woman"), (-1, "brother"), (1, "daughter")]),
    ("father", "daughter", [(-1, "man"), (1, "woman"), (-1, "parent"), (1, "child")]),
    ("father", "daughter", [(-1, "man"), (1, "girl")]),
    ("brother", "aunt", [(-1, "boy"), (1, "woman"), (-1, "child"), (1, "parent")]),
    ("day", "winter", [(-1, "sun"), (1, "cold"), (1, "snow")]),
    ("night", "summer", [(-1, "moon"), (1, "sun"), (1, "hot")]),
    ("car", "sail", [(-1, "road"), (1, "water"), (-1, "engine"), (1, "wind")]),
    ("doctor", "queen", [(-1, "hospital"), (1, "palace"), (-1, "man"), (1, "woman")]),
    ("tree", "bird", [(-1, "wood"), (1, "sky"), (1, "animal")]),
    ("seed", "tree", [(1, "time"), (1, "water"), (-1, "small")]),
    ("river", "ice", [(-1, "water"), (1, "cold"), (1, "winter")]),
    ("ocean", "island", [(-1, "water"), (1, "land")]),
    ("mountain", "island", [(-1, "land"), (1, "ocean"), (-1, "high")]),
    ("house", "castle", [(1, "king"), (-1, "man"), (1, "stone")]),
    ("house", "palace", [(1, "king"), (-1, "home"), (1, "royal")]),
    ("happy", "tears", [(-1, "joy"), (1, "sad"), (1, "cry")]),
    ("walk", "fly", [(-1, "foot"), (1, "wing")]),
    ("walk", "swim", [(-1, "land"), (1, "water")]),
    ("big", "tiny", [(-1, "large"), (1, "small")]),
    ("strong", "weak", [(-1, "power"), (1, "soft")]),
    ("sun", "moon", [(-1, "day"), (1, "night")]),
    ("sun", "snow", [(-1, "hot"), (1, "cold"), (1, "winter")]),
    ("fire", "ice", [(-1, "hot"), (1, "cold"), (1, "water")]),
    ("gold", "silver", [(-1, "yellow"), (1, "white")]),
    ("king", "princess", [(-1, "man"), (1, "woman"), (-1, "adult"), (1, "child")]),
    ("king", "girl", [(-1, "man"), (1, "woman"), (-1, "adult"), (1, "child")]),
    ("queen", "boy", [(-1, "woman"), (1, "man"), (-1, "adult"), (1, "child")]),
    ("man", "princess", [(-1, "adult"), (1, "child"), (-1, "king"), (1, "queen")]),
    ("woman", "prince", [(-1, "adult"), (1, "child"), (1, "king"), (-1, "queen")]),
    ("cat", "wolf", [(-1, "pet"), (1, "wild"), (1, "dog")]),
    ("dog", "lion", [(1, "cat"), (-1, "pet"), (1, "wild")]),
    ("puppy", "lion", [(-1, "baby"), (-1, "dog"), (1, "cat"), (1, "wild")]),
    ("kitten", "wolf", [(-1, "baby"), (-1, "cat"), (1, "dog"), (1, "wild")]),
]


def load():
    cfg = load_config()
    current = json.loads((VOCAB_ROOT / "current.json").read_text(encoding="utf-8"))
    directory = VOCAB_ROOT / current["hash"]
    words, matrix, scales = read_pack(directory / "nearest.i8")
    display = read_display_flags(directory / "nearest.i8")
    rows = dequantize(matrix, scales).astype(np.float64)
    index = {word: i for i, word in enumerate(words)}
    return cfg, words, rows, display, index


def equation(start: str, moves: list[tuple[int, str]]) -> str:
    parts = [start]
    for sign, word in moves:
        parts.append(("+ " if sign > 0 else "- ") + word)
    return " ".join(parts)


def position_of(rows, index, start: str, moves: list[tuple[int, str]]) -> np.ndarray:
    position = rows[index[start]].copy()
    for sign, word in moves:
        position += sign * rows[index[word]]
    return position


def labels_for(words, rows, display, index, position, start, moves, goal, cutoff, warm):
    anchors = [(start, rows[index[start]])]
    for _sign, word in moves:
        anchors.append((word, rows[index[word]]))
    similarity = float(cosine(position, rows[index[goal]]))
    labels = rank_labels(words, rows, display, position, anchors, goal, cutoff, similarity, warm)
    return similarity, [word for word, _score in labels]


def subset_moves(moves: list[tuple[int, str]], mask: int) -> list[tuple[int, str]]:
    return [step for bit, step in enumerate(moves) if mask & (1 << bit)]


def necessary(words, rows, display, index, start, goal, moves, cutoff, warm) -> bool:
    """Every proper subset must miss the goal label and stay under 0.75."""
    n = len(moves)
    if n < 3:
        return False
    full = (1 << n) - 1
    for mask in range(full):
        part = subset_moves(moves, mask)
        if not part:
            continue
        position = position_of(rows, index, start, part)
        similarity, shown = labels_for(
            words, rows, display, index, position, start, part, goal, cutoff, warm
        )
        if shown and shown[0] == goal:
            return False
        if similarity >= 0.75:
            return False
    return True


def legal(index, start: str, goal: str, moves: list[tuple[int, str]]) -> bool:
    if len(moves) < 3:
        return False
    seen = {start, goal}
    for _sign, word in moves:
        if word not in index or word in seen:
            return False
        if is_variant(word, start) or is_variant(word, goal):
            return False
        for previous in seen:
            if is_variant(word, previous):
                return False
        seen.add(word)
    # Opposite pair on the same word cannot happen because words are unique.
    return True


def search_pool(words, rows, display, index, pool_words, targets, cutoff, warm):
    pool = [word for word in pool_words if word in index]
    pool_idx = np.array([index[word] for word in pool], dtype=np.int64)
    vecs = rows[pool_idx]
    gram = vecs @ vecs.T
    row_sq = np.einsum("ij,ij->i", vecs, vecs)
    print(f"pool {len(pool)}", flush=True)
    found = []
    for start, goal in targets:
        if start not in index or goal not in index:
            print(f"missing {start}->{goal}", flush=True)
            continue
        start_vec = rows[index[start]]
        goal_vec = rows[index[goal]]
        goal_norm = float(np.linalg.norm(goal_vec))
        start_sq = float(np.dot(start_vec, start_vec))
        dot_sg = float(np.dot(start_vec, goal_vec))
        dot_g = vecs @ goal_vec
        dot_s = vecs @ start_vec
        banned = {start, goal}
        keep_i = np.array(
            [
                i
                for i, word in enumerate(pool)
                if word not in banned and not is_variant(word, start) and not is_variant(word, goal)
            ],
            dtype=np.int64,
        )
        hits = []
        p = len(pool)
        for signs in ((-1, 1, 1), (1, -1, 1), (1, 1, -1), (-1, -1, 1), (-1, 1, -1), (1, -1, -1)):
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
            cos = num / (np.sqrt(np.maximum(sq, 1e-12)) * goal_norm)
            # Distinct operands, and only the allowed pool slots on axis 0 so we
            # can slice the cube down before picking.
            allow = np.zeros(p, dtype=bool)
            allow[keep_i] = True
            cos = cos[allow]
            allowed_words = [pool[i] for i in keep_i.tolist()]
            flat = cos.reshape(-1)
            # Top of this sign pattern.
            k = min(25, flat.size)
            pick = np.argpartition(-flat, k - 1)[:k]
            n2 = p
            n0 = len(allowed_words)
            for slot in pick.tolist():
                score = float(flat[slot])
                if score < 0.62:
                    continue
                i0 = slot // (n2 * n2)
                rem = slot % (n2 * n2)
                j = rem // n2
                k3 = rem % n2
                words3 = (allowed_words[i0], pool[j], pool[k3])
                if len(set(words3)) < 3:
                    continue
                moves = [(s1, words3[0]), (s2, words3[1]), (s3, words3[2])]
                if not legal(index, start, goal, moves):
                    continue
                hits.append((score, moves))
        hits.sort(key=lambda item: item[0], reverse=True)
        # Unique move multisets.
        seen = set()
        checked = 0
        for score, moves in hits:
            key = tuple(sorted((sign, word) for sign, word in moves))
            if key in seen:
                continue
            seen.add(key)
            checked += 1
            if checked > 12:
                break
            position = position_of(rows, index, start, moves)
            similarity, shown = labels_for(
                words, rows, display, index, position, start, moves, goal, cutoff, warm
            )
            primary = shown[0] if shown else None
            if primary != goal:
                continue
            if not necessary(words, rows, display, index, start, goal, moves, cutoff, warm):
                print(f"  padded {equation(start, moves)} -> {goal} {similarity:.3f} {shown}", flush=True)
                continue
            print(f"OK {equation(start, moves)} -> {goal} {similarity:.3f} {shown}", flush=True)
            found.append((start, goal, moves, similarity, shown))
            break
        else:
            print(f"-- {start} -> {goal} no 3-step label hit (best raw {hits[0][0]:.3f})" if hits else f"-- {start} -> {goal} none", flush=True)
    return found


def try_hand(words, rows, display, index, cutoff, warm):
    print("hand equations", flush=True)
    found = []
    for start, goal, moves in HAND:
        if not legal(index, start, goal, moves):
            missing = [w for w in [start, goal, *(word for _s, word in moves)] if w not in index]
            if missing:
                print(f"skip {start}->{goal} missing {missing}", flush=True)
            else:
                print(f"skip {equation(start, moves)} illegal", flush=True)
            continue
        position = position_of(rows, index, start, moves)
        similarity, shown = labels_for(
            words, rows, display, index, position, start, moves, goal, cutoff, warm
        )
        primary = shown[0] if shown else None
        mark = "OK" if primary == goal else "  "
        print(f"{mark} {equation(start, moves)} -> {goal} {similarity:.3f} {shown}", flush=True)
        if primary == goal:
            needed = necessary(words, rows, display, index, start, goal, moves, cutoff, warm)
            print(f"   necessary={needed}", flush=True)
            if needed:
                found.append((start, goal, moves, similarity, shown))
    return found


def main() -> None:
    cfg, words, rows, display, index = load()
    cutoff = float(cfg["labelNearDuplicateCutoff"])
    warm = float(cfg["labelWarmSimilarity"])
    try_hand(words, rows, display, index, cutoff, warm)
    print("--- search ---", flush=True)
    search_pool(words, rows, display, index, POOL, TARGETS, cutoff, warm)


if __name__ == "__main__":
    main()
