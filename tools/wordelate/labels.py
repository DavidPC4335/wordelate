"""Label filters shared by puzzle checks. Mirrors packages/web/src/lib/labels.ts."""

from __future__ import annotations

import numpy as np

from wordelate.mathutil import cosine
from wordelate.stemmer import is_variant


def label_count(goal_similarity: float, warm_similarity: float) -> int:
    return 3 if goal_similarity >= warm_similarity else 1


def label_rejected(
    word: str,
    goal_word: str,
    anchors: list[str],
    display: bool,
    nearest_anchor_cosine: float,
    cutoff: float,
) -> bool:
    goal = goal_word.lower()
    if any(is_variant(word, anchor) for anchor in anchors):
        return True
    if not display and word != goal:
        return True
    if word != goal and nearest_anchor_cosine > cutoff:
        return True
    return False


def rank_labels(
    words: list[str],
    rows: np.ndarray,
    display: np.ndarray,
    position: np.ndarray,
    anchors: list[tuple[str, np.ndarray]],
    goal_word: str,
    cutoff: float,
    goal_similarity: float,
    warm_similarity: float,
) -> list[tuple[str, float]]:
    """Return up to three (word, cosine) labels, best first."""
    anchor_words = [word for word, _vector in anchors]
    anchor_rows = [vector for _word, vector in anchors]
    ranked: list[tuple[str, float]] = []
    goal = goal_word.lower()
    for index, word in enumerate(words):
        row = rows[index]
        nearest = max((float(cosine(row, vector)) for vector in anchor_rows), default=-1.0)
        if label_rejected(word, goal, anchor_words, bool(display[index]), nearest, cutoff):
            continue
        score = float(cosine(position, row))
        ranked.append((word, score))
    ranked.sort(key=lambda item: item[1], reverse=True)
    return ranked[: label_count(goal_similarity, warm_similarity)]
