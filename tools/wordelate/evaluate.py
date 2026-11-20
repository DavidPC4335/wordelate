"""Quantization error against float32, for the ship-gate report."""

from __future__ import annotations

import numpy as np

from wordelate.mathutil import P95_ABS_COSINE_ERROR, SELF_MISS_LIMIT, TOP1_DISAGREEMENT_RATE, l2normalize_rows

CURATED_NEIGHBORS = (
    "king",
    "queen",
    "man",
    "woman",
    "water",
    "ocean",
    "dog",
    "cat",
    "city",
    "music",
    "happy",
    "sad",
    "war",
    "peace",
    "computer",
    "bread",
    "river",
    "money",
    "love",
    "time",
    "car",
    "house",
    "book",
    "school",
    "food",
    "sun",
    "moon",
    "tree",
    "bird",
)


def query_plan(vocab_size: int, real_model: bool) -> dict:
    if real_model and vocab_size >= 1000:
        return {
            "sum_queries": 2000,
            "cosine_sample": min(200, vocab_size),
            "self_queries": min(500, vocab_size),
            "neighbor_words": min(20, vocab_size),
            "scaled": False,
        }
    plan = {
        "sum_queries": min(200, vocab_size),
        "cosine_sample": min(40, max(1, vocab_size)),
        "self_queries": min(100, vocab_size),
        "neighbor_words": min(20, vocab_size),
        "scaled": True,
        "reason": (
            "Sample counts were scaled down from 2000 sum-queries, 200 cosine "
            "targets, and 500 self-queries because this is not a full real vocab."
        ),
    }
    return plan


def _normalized_sums(matrix_unit: np.ndarray, indices: np.ndarray, counts: np.ndarray) -> np.ndarray:
    """L2-normalized sums of 1..4 rows. `indices` is (Q, 4), `counts` is (Q,)."""
    acc = np.zeros((indices.shape[0], matrix_unit.shape[1]), dtype=np.float64)
    for slot in range(indices.shape[1]):
        mask = counts > slot
        acc[mask] += matrix_unit[indices[mask, slot]]
    norms = np.linalg.norm(acc, axis=1, keepdims=True)
    norms = np.maximum(norms, 1e-12)
    return (acc / norms).astype(np.float32)


def _make_queries(vocab_size: int, plan: dict, rng: np.random.Generator) -> dict:
    q = int(plan["sum_queries"])
    k = int(plan["cosine_sample"])
    counts = rng.integers(1, 5, size=q)
    indices = rng.integers(0, vocab_size, size=(q, 4))
    sample = rng.integers(0, vocab_size, size=(q, k))
    self_idx = rng.choice(vocab_size, size=min(int(plan["self_queries"]), vocab_size), replace=False)
    return {"counts": counts, "indices": indices, "sample": sample, "self_idx": self_idx}


def _cosine_error(query_a, query_b, rows_a, rows_b, sample: np.ndarray) -> dict:
    chunks = []
    for start in range(0, query_a.shape[0], 32):
        stop = start + 32
        picked = sample[start:stop]
        ca = np.einsum("sd,skd->sk", query_a[start:stop], rows_a[picked])
        cb = np.einsum("sd,skd->sk", query_b[start:stop], rows_b[picked])
        chunks.append(np.abs(ca - cb).ravel())
    err = np.concatenate(chunks) if chunks else np.zeros(1, dtype=np.float64)
    return {
        "mean": float(err.mean()),
        "p95": float(np.percentile(err, 95)),
        "max": float(err.max()),
        "count": int(err.size),
    }


def _top1(query_f, query_q, rows_f, rows_q) -> dict:
    disagree = 0
    in_top5 = 0
    gaps: list[float] = []
    total = int(query_f.shape[0])
    k = 5 if rows_q.shape[0] >= 5 else rows_q.shape[0]
    for start in range(0, total, 32):
        stop = start + 32
        scores_f = query_f[start:stop] @ rows_f.T
        scores_q = query_q[start:stop] @ rows_q.T
        arg_f = np.argmax(scores_f, axis=1)
        arg_q = np.argmax(scores_q, axis=1)
        mismatch = arg_f != arg_q
        disagree += int(np.sum(mismatch))
        if np.any(mismatch):
            rows = np.arange(len(arg_f))[mismatch]
            gaps.extend(
                (scores_f[rows, arg_f[rows]] - scores_f[rows, arg_q[rows]]).astype(float).tolist()
            )
        if k <= 1:
            part = arg_q.reshape(-1, 1)
        else:
            part = np.argpartition(-scores_q, k - 1, axis=1)[:, :k]
        for row, target in enumerate(arg_f.tolist()):
            if target in part[row]:
                in_top5 += 1
    gap_arr = np.asarray(gaps, dtype=np.float64) if gaps else np.zeros(0)
    return {
        "top1_disagreement_count": disagree,
        "top1_disagreement_rate": disagree / total if total else 0.0,
        "float32_top1_in_quantized_top5_count": in_top5,
        "float32_top1_in_quantized_top5_rate": in_top5 / total if total else 0.0,
        "queries": total,
        "disagreement_float_gap_median": float(np.median(gap_arr)) if gap_arr.size else 0.0,
    }


def _self_misses(rows_q: np.ndarray, self_idx: np.ndarray, words: list[str]) -> dict:
    misses: list[str] = []
    for start in range(0, len(self_idx), 32):
        sel = self_idx[start : start + 32]
        sims = rows_q[sel] @ rows_q.T
        self_scores = sims[np.arange(len(sel)), sel]
        best = sims.max(axis=1)
        for word_i, self_score, best_score in zip(sel.tolist(), self_scores.tolist(), best.tolist()):
            if best_score > self_score + 1e-5:
                misses.append(words[word_i])
    return {"self_miss_count": len(misses), "self_misses": misses}


def _neighbor_sample(
    words: list[str],
    rows_f: np.ndarray,
    rows_q: np.ndarray,
    rng: np.random.Generator,
    how_many: int,
) -> list[dict]:
    if how_many <= 0 or len(words) < 2:
        return []
    index = {word: i for i, word in enumerate(words)}
    chosen: list[int] = []
    for word in CURATED_NEIGHBORS:
        if word in index and index[word] not in chosen:
            chosen.append(index[word])
        if len(chosen) >= how_many:
            break
    if len(chosen) < how_many:
        rest = [i for i in range(len(words)) if i not in set(chosen)]
        take = min(how_many - len(chosen), len(rest))
        if take:
            chosen.extend(int(i) for i in rng.choice(rest, size=take, replace=False))
    k = 5 if len(words) > 5 else len(words) - 1
    samples = []
    for word_i in chosen:
        def nearest(rows: np.ndarray) -> list[str]:
            sims = rows @ rows[word_i]
            sims = sims.copy()
            sims[word_i] = -np.inf
            if k == rows.shape[0]:
                order = np.argsort(-sims)
            else:
                part = np.argpartition(-sims, k)[:k]
                order = part[np.argsort(-sims[part])]
            return [words[int(j)] for j in order]

        samples.append(
            {
                "word": words[word_i],
                "float32": nearest(rows_f),
                "quantized": nearest(rows_q),
            }
        )
    return samples


def _gate(cosine_error: dict, top1: dict, self_stats: dict) -> dict:
    p95 = float(cosine_error["p95"])
    rate = float(top1["top1_disagreement_rate"])
    misses = int(self_stats["self_miss_count"])
    p95_ok = p95 <= P95_ABS_COSINE_ERROR
    top1_ok = rate <= TOP1_DISAGREEMENT_RATE
    self_ok = misses <= SELF_MISS_LIMIT
    return {
        "p95_abs_cosine_error": p95,
        "p95_limit": P95_ABS_COSINE_ERROR,
        "p95_ok": p95_ok,
        "top1_disagreement_rate": rate,
        "top1_limit": TOP1_DISAGREEMENT_RATE,
        "top1_ok": top1_ok,
        "self_misses": misses,
        "self_limit": SELF_MISS_LIMIT,
        "self_ok": self_ok,
        "passed": bool(p95_ok and top1_ok and self_ok),
    }


def evaluate_quantizer(
    name: str,
    float_unit: np.ndarray,
    dequant: np.ndarray,
    words: list[str],
    queries: dict,
    rng: np.random.Generator,
    neighbor_words: int,
) -> dict:
    rows_f = np.asarray(float_unit, dtype=np.float32)
    rows_q = l2normalize_rows(np.asarray(dequant, dtype=np.float32))
    q_f = _normalized_sums(rows_f, queries["indices"], queries["counts"])
    q_q = _normalized_sums(dequant.astype(np.float32), queries["indices"], queries["counts"])
    # The quantized sum is normalized inside _normalized_sums. Compare cosines
    # against unit rows so the score is cosine, not a raw dot of unnormalized rows.
    print(f"  {name}: cosine error on sum queries", flush=True)
    cosine_error = _cosine_error(q_f, q_q, rows_f, rows_q, queries["sample"])
    print(f"  {name}: top-1 disagreement", flush=True)
    top1 = _top1(q_f, q_q, rows_f, rows_q)
    self_stats = _self_misses(rows_q, queries["self_idx"], words)
    return {
        "name": name,
        "cosine_error": cosine_error,
        "top1": top1,
        "self": self_stats,
        "neighbors": _neighbor_sample(words, rows_f, rows_q, rng, neighbor_words),
        "ship_gate": _gate(cosine_error, top1, self_stats),
    }


def measure_both(
    float_unit: np.ndarray,
    per_vector_dequant: np.ndarray,
    global_dequant: np.ndarray,
    words: list[str],
    real_model: bool,
    seed: int = 20261119,
) -> dict:
    plan = query_plan(len(words), real_model)
    rng = np.random.default_rng(seed)
    queries = _make_queries(len(words), plan, rng)
    per_vector = evaluate_quantizer(
        "symmetric-per-vector-int8",
        float_unit,
        per_vector_dequant,
        words,
        queries,
        rng,
        int(plan["neighbor_words"]),
    )
    global_stats = evaluate_quantizer(
        "global-scale-int8",
        float_unit,
        global_dequant,
        words,
        queries,
        rng,
        int(plan["neighbor_words"]),
    )
    return {
        "seed": seed,
        "query_plan": plan,
        "per_vector_int8": per_vector,
        "global_int8": global_stats,
        "ship_gate_passed": bool(per_vector["ship_gate"]["passed"]),
        "chosen_quantizer": "symmetric-per-vector-int8",
    }
