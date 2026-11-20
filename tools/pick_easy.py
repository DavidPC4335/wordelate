#!/usr/bin/env python3
"""Find easy puzzles whose filtered label is the goal on the shipped pack."""

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
from wordelate.paths import ROOT, VOCAB_ROOT
from wordelate.quantize import dequantize

# Curated analogies. Each is (start, goal, moves as (sign, word)).
CANDIDATES = [
    ("king", "queen", [(-1, "man"), (1, "woman")]),
    ("uncle", "aunt", [(-1, "man"), (1, "woman")]),
    ("brother", "sister", [(-1, "boy"), (1, "girl")]),
    ("prince", "princess", [(-1, "man"), (1, "woman")]),
    ("father", "mother", [(-1, "man"), (1, "woman")]),
    ("boy", "girl", [(-1, "man"), (1, "woman")]),
    ("man", "woman", [(-1, "king"), (1, "queen")]),
    ("dog", "puppy", [(1, "baby")]),
    ("cat", "kitten", [(1, "baby")]),
    ("good", "bad", [(-1, "better"), (1, "worse")]),
    ("strong", "weak", [(-1, "stronger"), (1, "weaker")]),
    ("big", "small", [(-1, "bigger"), (1, "smaller")]),
    ("walk", "swim", [(-1, "walking"), (1, "swimming")]),
    ("paris", "rome", [(-1, "france"), (1, "italy")]),
    ("france", "italy", [(-1, "paris"), (1, "rome")]),
    ("hand", "foot", [(-1, "finger"), (1, "toe")]),
    ("day", "night", [(-1, "sun"), (1, "moon")]),
    ("happy", "sad", [(-1, "happiness"), (1, "sadness")]),
    ("cat", "dog", [(-1, "meow"), (1, "bark")]),
    ("car", "boat", [(-1, "road"), (1, "water")]),
    ("doctor", "nurse", [(-1, "man"), (1, "woman")]),
    ("actor", "actress", [(-1, "man"), (1, "woman")]),
    ("husband", "wife", [(-1, "man"), (1, "woman")]),
    ("son", "daughter", [(-1, "boy"), (1, "girl")]),
    ("he", "she", [(-1, "man"), (1, "woman")]),
    ("king", "princess", [(-1, "man"), (1, "girl")]),
    ("tree", "flower", [(-1, "wood"), (1, "petal")]),
    ("bird", "fish", [(-1, "sky"), (1, "water")]),
    ("summer", "winter", [(-1, "hot"), (1, "cold")]),
    ("up", "down", [(-1, "high"), (1, "low")]),
]


def main() -> None:
    cfg = load_config()
    current = json.loads((VOCAB_ROOT / "current.json").read_text(encoding="utf-8"))
    directory = VOCAB_ROOT / current["hash"]
    words, matrix, scales = read_pack(directory / "nearest.i8")
    display = read_display_flags(directory / "nearest.i8")
    rows = dequantize(matrix, scales)
    index = {word: i for i, word in enumerate(words)}
    cutoff = float(cfg["labelNearDuplicateCutoff"])
    warm = float(cfg["labelWarmSimilarity"])
    kept = []
    for start, goal, moves in CANDIDATES:
        missing = [word for word in [start, goal, *(w for _s, w in moves)] if word not in index]
        if missing:
            print(f"skip {start}->{goal} missing {missing}")
            continue
        position = rows[index[start]].astype(np.float64).copy()
        for sign, word in moves:
            position += sign * rows[index[word]]
        goal_vec = rows[index[goal]]
        similarity = float(cosine(position, goal_vec))
        anchors = [(start, rows[index[start]])]
        for _sign, word in moves:
            anchors.append((word, rows[index[word]]))
        labels = rank_labels(
            words, rows, display, position, anchors, goal, cutoff, similarity, warm
        )
        primary = labels[0][0] if labels else None
        shown = [word for word, _score in labels]
        ok = primary == goal
        mark = "OK" if ok else "  "
        print(f"{mark} {start} -> {goal} sim {similarity:.3f} labels {shown}")
        if ok:
            kept.append(
                {
                    "id": f"{start}-{goal}",
                    "start": start,
                    "goal": goal,
                    "par": len(moves),
                    "solution": [{"op": "+" if sign > 0 else "-", "word": word} for sign, word in moves],
                    "solutionSimilarity": round(similarity, 4),
                    "here": goal,
                }
            )
    out = ROOT / "packages" / "web" / "public" / "puzzles.json"
    chosen = kept[:10]
    if len(chosen) < 10:
        print(f"only {len(chosen)} puzzles land on the goal")
    else:
        out.write_text(json.dumps(chosen, indent=2) + "\n", encoding="utf-8")
        print(f"wrote {len(chosen)} puzzles to {out}")


if __name__ == "__main__":
    main()
