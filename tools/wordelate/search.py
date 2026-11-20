"""Beam search over quantized vectors.

Position starts at the START embedding. Each move adds or subtracts an operand.
The beam keeps the `beamWidth` partial equations with the highest cosine to GOAL.
A solution needs length >= minSolutionLength, cosine >= minSolvableSimilarity,
and depth <= beamDepth. Fewest moves wins, then highest cosine.
"""

from __future__ import annotations

import numpy as np

from wordelate.mathutil import replay_cosine
from wordelate.stemmer import is_banned_operand


def _pool_mask(
    pool_indices: np.ndarray,
    words: list[str],
    start: str,
    goal: str,
    irregular_index: dict[str, set[str]],
) -> np.ndarray:
    extras: set[str] = set()
    extras.update(irregular_index.get(start, ()))
    extras.update(irregular_index.get(goal, ()))
    banned = np.zeros(pool_indices.shape[0], dtype=bool)
    for pos, index in enumerate(pool_indices.tolist()):
        word = words[index]
        if is_banned_operand(word, start, goal, extras):
            banned[pos] = True
    return banned


def beam_search(
    vectors: np.ndarray,
    words: list[str],
    start_index: int,
    goal_index: int,
    pool_indices: np.ndarray,
    irregular_index: dict[str, set[str]],
    beam_width: int,
    max_depth: int,
    min_similarity: float,
    min_length: int,
) -> dict | None:
    """Return the best path, or None.

    `vectors` are reconstructed (dequantized) float32 rows.
    `moves` in the result are (sign, word_index) with sign +1 or -1.
    """
    if start_index == goal_index:
        return None
    pool_indices = np.asarray(pool_indices, dtype=np.int64)
    if pool_indices.size == 0:
        return None
    pool_mat = np.asarray(vectors[pool_indices], dtype=np.float32)
    goal_vec = np.asarray(vectors[goal_index], dtype=np.float32)
    goal_norm = float(np.linalg.norm(goal_vec.astype(np.float64)))
    if goal_norm == 0.0:
        return None
    pool_norm2 = np.einsum("pd,pd->p", pool_mat, pool_mat).astype(np.float64)
    op_goal = pool_mat.astype(np.float64) @ goal_vec.astype(np.float64)
    index_to_pool = {int(word_i): pos for pos, word_i in enumerate(pool_indices.tolist())}
    static_banned = _pool_mask(pool_indices, words, words[start_index], words[goal_index], irregular_index)

    start_vec = np.asarray(vectors[start_index], dtype=np.float32)
    beam: list[dict] = [
        {
            "pos": start_vec.copy(),
            "pos_norm2": float(np.dot(start_vec.astype(np.float64), start_vec.astype(np.float64))),
            "pos_goal": float(np.dot(start_vec.astype(np.float64), goal_vec.astype(np.float64))),
            "used": {int(start_index), int(goal_index)},
            "moves": [],
        }
    ]

    best: dict | None = None
    for depth in range(1, max_depth + 1):
        batch = len(beam)
        if batch == 0:
            break
        pos = np.stack([state["pos"] for state in beam]).astype(np.float64)
        pos_norm2 = np.array([state["pos_norm2"] for state in beam], dtype=np.float64)
        pos_goal = np.array([state["pos_goal"] for state in beam], dtype=np.float64)
        dots = pos @ pool_mat.astype(np.float64).T
        cos_plus = (pos_goal[:, None] + op_goal[None, :]) / (
            np.sqrt(np.maximum(pos_norm2[:, None] + pool_norm2[None, :] + 2.0 * dots, 1e-12))
            * goal_norm
        )
        cos_minus = (pos_goal[:, None] - op_goal[None, :]) / (
            np.sqrt(np.maximum(pos_norm2[:, None] + pool_norm2[None, :] - 2.0 * dots, 1e-12))
            * goal_norm
        )
        illegal = np.broadcast_to(static_banned, cos_plus.shape).copy()
        for row, state in enumerate(beam):
            for used in state["used"]:
                pool_pos = index_to_pool.get(used)
                if pool_pos is not None:
                    illegal[row, pool_pos] = True
        cos_plus = np.where(illegal, -np.inf, cos_plus)
        cos_minus = np.where(illegal, -np.inf, cos_minus)
        cos_plus = np.nan_to_num(cos_plus, nan=-np.inf, posinf=1.0, neginf=-np.inf)
        cos_minus = np.nan_to_num(cos_minus, nan=-np.inf, posinf=1.0, neginf=-np.inf)
        flat = np.concatenate([cos_plus.ravel(), cos_minus.ravel()])
        finite = np.isfinite(flat)
        if not np.any(finite):
            break
        width = min(beam_width, int(np.count_nonzero(finite)))
        # argpartition the finite scores. Replace -inf so they sort last.
        pick_from = np.where(finite, flat, -np.inf)
        if width >= pick_from.size:
            chosen = np.argsort(-pick_from)[:width]
        else:
            part = np.argpartition(-pick_from, width - 1)[:width]
            chosen = part[np.argsort(-pick_from[part])]
        span = cos_plus.size
        children: list[dict] = []
        for flat_index in chosen.tolist():
            if not np.isfinite(pick_from[flat_index]):
                continue
            if flat_index < span:
                sign = 1
                local = flat_index
            else:
                sign = -1
                local = flat_index - span
            parent = local // pool_mat.shape[0]
            pool_pos = local % pool_mat.shape[0]
            word_index = int(pool_indices[pool_pos])
            parent_state = beam[parent]
            new_pos = parent_state["pos"] + np.float32(sign) * pool_mat[pool_pos]
            new_pos64 = new_pos.astype(np.float64)
            children.append(
                {
                    "pos": new_pos,
                    "pos_norm2": float(np.dot(new_pos64, new_pos64)),
                    "pos_goal": float(np.dot(new_pos64, goal_vec.astype(np.float64))),
                    "used": parent_state["used"] | {word_index},
                    "moves": parent_state["moves"] + [(sign, word_index)],
                    "rank_cosine": float(pick_from[flat_index]),
                }
            )
        if not children:
            break
        beam = children
        if depth < min_length:
            continue
        scored: list[tuple[float, dict]] = []
        for state in beam:
            exact = replay_cosine(vectors, start_index, goal_index, state["moves"])
            state["exact_cosine"] = exact
            scored.append((exact, state))
        scored.sort(key=lambda item: item[0], reverse=True)
        top_cosine, top_state = scored[0]
        if top_cosine + 1e-8 >= min_similarity:
            best = {
                "par": depth,
                "best_cosine": float(top_cosine),
                "moves": list(top_state["moves"]),
            }
            # Fewer moves beats any deeper path.
            break
    return best
