"""Beam search finds a planted two-move solution and rejects a one-move path."""

from __future__ import annotations

import numpy as np

from wordelate.mathutil import replay_cosine
from wordelate.search import beam_search


def _unit(vector: np.ndarray) -> np.ndarray:
    return (vector / np.linalg.norm(vector)).astype(np.float32)


def _planted():
    rng = np.random.default_rng(1)
    start = _unit(rng.normal(size=16))
    orthogonal = rng.normal(size=16)
    orthogonal = orthogonal - start * float(np.dot(orthogonal, start))
    orthogonal = _unit(orthogonal)
    target = 0.18
    goal = _unit(target * start + np.sqrt(1 - target * target) * orthogonal)
    third = rng.normal(size=16)
    third = third - start * float(np.dot(third, start)) - goal * float(np.dot(third, goal))
    operand_x = _unit(third)
    operand_y = _unit(8.0 * goal - start + operand_x)
    noise = _unit(rng.normal(size=16))
    words = ["start", "goal", "xop", "yop", "noise"]
    vectors = np.stack([start, goal, operand_x, operand_y, noise]).astype(np.float32)
    return words, vectors


def test_beam_finds_length_at_least_two():
    words, vectors = _planted()
    found = beam_search(
        vectors,
        words,
        0,
        1,
        np.arange(5),
        {},
        beam_width=8,
        max_depth=4,
        min_similarity=0.55,
        min_length=2,
    )
    assert found is not None
    assert found["par"] >= 2
    assert found["par"] <= 4
    exact = replay_cosine(vectors, 0, 1, found["moves"])
    assert exact >= 0.55
    direct = float(
        np.dot(vectors[0], vectors[1])
        / (np.linalg.norm(vectors[0]) * np.linalg.norm(vectors[1]))
    )
    assert 0.05 <= direct <= 0.30


def test_config_locked_numbers():
    from wordelate.config import load_config

    cfg = load_config()
    assert cfg["timezone"] == "America/New_York"
    assert cfg["vocabSize"] == 40000
    assert cfg["maxMoves"] == 16
    assert cfg["similarityBand"] == [0.05, 0.30]
    assert cfg["beamWidth"] == 64
    assert cfg["beamDepth"] == 4
    assert cfg["operandPoolSize"] == 8000
    assert cfg["minSolvableSimilarity"] == 0.55
    assert cfg["minThreshold"] == 0.50
    assert cfg["thresholdSlack"] == 0.03
