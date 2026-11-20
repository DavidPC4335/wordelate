"""Vector math mirrored against packages/game-math.

JavaScript Math.round ties toward +infinity. Python round() and numpy.round
tie toward even, so quantization uses floor(x + 0.5) instead.
"""

from __future__ import annotations

import math

import numpy as np

# Ship gate from the plan. Per-vector int8 is what the binary files store.
P95_ABS_COSINE_ERROR = 0.01
TOP1_DISAGREEMENT_RATE = 0.01
SELF_MISS_LIMIT = 0


def js_round(values: np.ndarray) -> np.ndarray:
    """Math.round: nearest integer, halfway cases toward +infinity."""
    arr = np.asarray(values, dtype=np.float64)
    return np.floor(arr + 0.5)


def l2normalize(vector: np.ndarray) -> np.ndarray:
    arr = np.asarray(vector, dtype=np.float64)
    norm = float(np.linalg.norm(arr))
    if norm == 0.0:
        return np.asarray(vector, dtype=np.float32).copy()
    out = (np.asarray(vector, dtype=np.float64) / norm).astype(np.float32)
    return out


def l2normalize_rows(matrix: np.ndarray) -> np.ndarray:
    arr = np.asarray(matrix, dtype=np.float32)
    norms = np.linalg.norm(arr, axis=1, keepdims=True)
    norms = np.maximum(norms, 1e-12)
    return (arr / norms).astype(np.float32)


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    """Cosine in float64, matching JS number promotion from Float32Array."""
    aa = np.asarray(a, dtype=np.float64).reshape(-1)
    bb = np.asarray(b, dtype=np.float64).reshape(-1)
    if aa.shape != bb.shape:
        raise ValueError(f"cosine length mismatch: {aa.shape[0]} vs {bb.shape[0]}")
    dot = float(np.dot(aa, bb))
    norm_a = float(np.dot(aa, aa))
    norm_b = float(np.dot(bb, bb))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (math.sqrt(norm_a) * math.sqrt(norm_b))


def apply_op(position: np.ndarray, vector: np.ndarray, op: str) -> np.ndarray:
    if op not in ("+", "-"):
        raise ValueError(f"op must be + or -, got {op!r}")
    pos = np.asarray(position, dtype=np.float32).reshape(-1)
    vec = np.asarray(vector, dtype=np.float32).reshape(-1)
    if pos.shape != vec.shape:
        raise ValueError(f"applyOp length mismatch: {pos.shape[0]} vs {vec.shape[0]}")
    sign = np.float32(1.0 if op == "+" else -1.0)
    return pos + sign * vec


def round_threshold(best_cosine: float, slack: float) -> float:
    """threshold = round(best_cosine - slack, 2), half away from zero / +inf for positives.

    Uses Decimal half-up so 0.525 becomes 0.53, matching Math.round on the cent value.
    """
    from decimal import Decimal, ROUND_HALF_UP

    value = Decimal(f"{best_cosine - slack:.10f}")
    quantized = value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return float(quantized)


def replay_cosine(
    vectors: np.ndarray,
    start: int,
    goal: int,
    moves: list[tuple[int, int]],
) -> float:
    """Replay signed operand adds on float32, then cosine in float64."""
    pos = np.asarray(vectors[start], dtype=np.float32).copy()
    for sign, index in moves:
        op = "+" if sign > 0 else "-"
        pos = apply_op(pos, vectors[index], op)
    return cosine(pos, vectors[goal])
