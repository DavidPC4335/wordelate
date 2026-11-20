#!/usr/bin/env python3
"""Search the quantized pack for puzzle candidates.

Reads data/vocab/current.json and the nearest pack. Writes data/candidates.json
and tools/CANDIDATES.md. Does not approve anything into the schedule.

Usage:
  python tools/generate_puzzles.py
  python tools/generate_puzzles.py --count 15
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from wordelate.config import load_config
from wordelate.lexicon import bias_hits, load_bias, load_irregulars
from wordelate.mathutil import replay_cosine, round_threshold
from wordelate.pack import read_matrix
from wordelate.paths import (
    BIAS_PATH,
    CANDIDATES_MD_PATH,
    CANDIDATES_PATH,
    IRREGULAR_PATH,
    VOCAB_ROOT,
)
from wordelate.search import beam_search
from wordelate.stemmer import banned_surface_forms


def load_pack():
    pointer = json.loads((VOCAB_ROOT / "current.json").read_text(encoding="utf-8"))
    directory = VOCAB_ROOT / pointer["hash"]
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    words, vectors = read_matrix(directory / "nearest.i8")
    return manifest, words, vectors


def _solution_strings(words: list[str], moves: list[tuple[int, int]]) -> list[str]:
    out = []
    for sign, index in moves:
        out.append(("+" if sign > 0 else "-") + words[index])
    return out


def _equation(start: str, goal: str, solution: list[str]) -> str:
    parts = [start]
    for step in solution:
        parts.append("- " + step[1:] if step.startswith("-") else "+ " + step[1:])
    return " ".join(parts) + f" -> {goal}"


def _try_orientation(
    vectors,
    words,
    pool_indices,
    irregulars,
    cfg,
    bias,
    start_index: int,
    goal_index: int,
    direct: float,
) -> dict | None:
    found = beam_search(
        vectors,
        words,
        start_index,
        goal_index,
        pool_indices,
        irregulars,
        beam_width=int(cfg["beamWidth"]),
        max_depth=int(cfg["beamDepth"]),
        min_similarity=float(cfg["minSolvableSimilarity"]),
        min_length=int(cfg["minSolutionLength"]),
    )
    if found is None:
        return None
    exact = replay_cosine(vectors, start_index, goal_index, found["moves"])
    if exact + 1e-6 < float(cfg["minSolvableSimilarity"]):
        return None
    if found["par"] < int(cfg["minSolutionLength"]) or found["par"] > int(cfg["beamDepth"]):
        return None
    threshold = round_threshold(exact, float(cfg["thresholdSlack"]))
    if threshold < float(cfg["minThreshold"]):
        return None
    start = words[start_index]
    goal = words[goal_index]
    operands = [words[index] for _sign, index in found["moves"]]
    hits = bias_hits([start, goal, *operands], bias)
    solution = _solution_strings(words, found["moves"])
    easy = found["par"] == int(cfg["easyPar"]) and exact >= float(cfg["easyMinCosine"])
    return {
        "start": start,
        "goal": goal,
        "direct_cosine": round(float(direct), 6),
        "par": int(found["par"]),
        "best_cosine": round(float(exact), 6),
        "threshold": threshold,
        "easy": bool(easy),
        "solution": solution,
        "equation": _equation(start, goal, solution),
        "banned": banned_surface_forms(words, start, goal, irregulars),
        "bias_review": bool(hits),
        "bias_tags": hits,
        "status": "pending",
    }


def _better(candidate: dict, other: dict) -> bool:
    """True when candidate beats other: fewer moves, then higher cosine."""
    return (candidate["par"], -candidate["best_cosine"]) < (other["par"], -other["best_cosine"])


def _in_band(direct: float, cfg: dict) -> bool:
    if direct < cfg["pairCosineMin"] or direct > cfg["pairCosineMax"]:
        return False
    if direct >= cfg["minSolvableSimilarity"]:
        return False
    return True


def _search_pair(vectors, words, pool_indices, irregulars, cfg, bias, unit, left: int, right: int) -> dict | None:
    direct = float(np.dot(unit[left], unit[right]))
    if not _in_band(direct, cfg):
        return None
    start_a = int(pool_indices[left])
    start_b = int(pool_indices[right])
    best = None
    for start, goal in ((start_a, start_b), (start_b, start_a)):
        candidate = _try_orientation(
            vectors, words, pool_indices, irregulars, cfg, bias, start, goal, direct
        )
        if candidate is None:
            continue
        if best is None or _better(candidate, best):
            best = candidate
    return best


def _select(raw: list[dict], count: int) -> list[dict]:
    """Prefer a bias-flagged row, then diverse endpoints."""
    ordered = sorted(raw, key=lambda row: (not row["bias_review"], row["par"], -row["best_cosine"]))
    chosen: list[dict] = []
    used: set[str] = set()
    for row in ordered:
        if row["start"] in used or row["goal"] in used:
            continue
        chosen.append(row)
        used.add(row["start"])
        used.add(row["goal"])
        if len(chosen) >= count:
            break
    for index, row in enumerate(chosen, start=1):
        row["id"] = f"c{index:02d}"
    return chosen


def _enumerate_small(unit, cfg) -> list[tuple[int, int]]:
    cosine_matrix = unit @ unit.T
    pairs = []
    size = unit.shape[0]
    for left in range(size):
        for right in range(left + 1, size):
            direct = float(cosine_matrix[left, right])
            if _in_band(direct, cfg):
                pairs.append((left, right))
    return pairs


def _render_markdown(payload: dict) -> str:
    lines = ["# Puzzle candidates", ""]
    if payload["fixture"]:
        lines.extend(
            [
                "**These are fixture candidates, not real puzzles.**",
                "The Google News embeddings were not used. Vectors are a tiny synthetic",
                "matrix so the generator, bias flags, and review CLI can be exercised.",
                "Do not judge Wordelate difficulty from this file.",
                "",
            ]
        )
    else:
        lines.extend(
            [
                "Real `word2vec-google-news-300` candidates for a human to judge difficulty.",
                "Nothing here is on the schedule until you approve it.",
                "",
            ]
        )
    lines.append(f"Vocab hash: `{payload['vocab_hash']}`")
    lines.append(f"Vocab size: {payload['vocab_size']}")
    lines.append(f"Count: {len(payload['candidates'])}")
    lines.append("")
    lines.append("Approve with `python tools/review_puzzles.py approve <id>`.")
    lines.append("Bias-flagged rows also need `--seen-bias`. `approve-all` skips them.")
    lines.append("")
    for row in payload["candidates"]:
        tags = ", ".join(
            f"{hit['word']} ({'/'.join(hit['categories'])})" for hit in row["bias_tags"]
        ) or "none"
        banned = ", ".join(row["banned"][:12])
        if len(row["banned"]) > 12:
            banned += f", … ({len(row['banned'])} total)"
        lines.extend(
            [
                f"## {row['id']}. {row['equation']}",
                "",
                f"- par {row['par']}, threshold {row['threshold']:.2f}, "
                f"direct cosine {row['direct_cosine']:.4f}, final cosine {row['best_cosine']:.4f}",
                f"- easy: {'yes' if row['easy'] else 'no'}",
                f"- bias: {tags}",
                f"- solution: {' '.join(row['solution'])}",
                f"- banned sample: {banned or 'none'}",
                "",
            ]
        )
    return "\n".join(lines)


def generate(count: int, seed: int, max_attempts: int) -> dict:
    cfg = load_config()
    manifest, words, vectors = load_pack()
    bias = load_bias(BIAS_PATH)
    irregulars = load_irregulars(IRREGULAR_PATH)
    index = {word: i for i, word in enumerate(words)}
    frequency = [word for word in manifest.get("by_frequency", words) if word in index]
    if not frequency:
        frequency = list(words)
    pool_words = frequency[: int(cfg["operandPoolSize"])]
    pool_indices = np.asarray([index[word] for word in pool_words], dtype=np.int64)
    pool_vecs = vectors[pool_indices].astype(np.float32)
    norms = np.linalg.norm(pool_vecs, axis=1, keepdims=True)
    unit = pool_vecs / np.maximum(norms, 1e-12)

    raw: list[dict] = []
    seen_pairs: set[tuple[str, str]] = set()
    used_endpoints: set[str] = set()
    attempts = 0

    def ready() -> bool:
        return len(raw) >= count and any(row["bias_review"] for row in raw)

    def consider(left: int, right: int) -> None:
        nonlocal attempts
        direct = float(np.dot(unit[left], unit[right]))
        if not _in_band(direct, cfg):
            return
        left_word = pool_words[left]
        right_word = pool_words[right]
        if left_word in used_endpoints or right_word in used_endpoints:
            return
        attempts += 1
        candidate = _search_pair(
            vectors, words, pool_indices, irregulars, cfg, bias, unit, left, right
        )
        if candidate is None:
            return
        if candidate["start"] in used_endpoints or candidate["goal"] in used_endpoints:
            return
        key = tuple(sorted((candidate["start"], candidate["goal"])))
        if key in seen_pairs:
            return
        seen_pairs.add(key)
        used_endpoints.add(candidate["start"])
        used_endpoints.add(candidate["goal"])
        raw.append(candidate)
        print(
            f"  candidate {len(raw)}: {candidate['equation']} "
            f"par={candidate['par']} cos={candidate['best_cosine']:.3f} "
            f"bias={candidate['bias_review']}",
            flush=True,
        )

    print(f"Searching a pool of {len(pool_words)} words for {count} puzzles...", flush=True)
    if len(pool_words) <= 400:
        pairs = _enumerate_small(unit, cfg)
        print(f"Small pool: {len(pairs)} pairs inside the cosine band.", flush=True)
        for left, right in pairs:
            consider(left, right)
    else:
        rng = np.random.default_rng(seed)
        bias_positions = [pos for pos, word in enumerate(pool_words) if word in bias]
        rng.shuffle(bias_positions)
        # A short bias-targeted pass so the review flag is visible, then general pairs.
        bias_budget = min(40, max_attempts)
        for bias_pos in bias_positions:
            if attempts >= bias_budget or any(row["bias_review"] for row in raw):
                break
            partners = rng.choice(len(pool_words), size=min(8, len(pool_words) - 1), replace=False)
            for partner in partners.tolist():
                if partner == bias_pos or attempts >= bias_budget:
                    continue
                if any(row["bias_review"] for row in raw):
                    break
                consider(int(min(bias_pos, partner)), int(max(bias_pos, partner)))
        samples = 0
        sample_budget = max_attempts * 30
        while not ready() and attempts < max_attempts and samples < sample_budget:
            samples += 1
            left = int(rng.integers(0, len(pool_words)))
            right = int(rng.integers(0, len(pool_words)))
            if left == right:
                continue
            consider(min(left, right), max(left, right))

    chosen = _select(raw, count)
    payload = {
        "real_model": bool(manifest.get("real_model", False)),
        "fixture": bool(manifest.get("fixture", not manifest.get("real_model", False))),
        "vocab_hash": manifest["hash"],
        "vocab_size": len(words),
        "generated_at": datetime.now(ZoneInfo(cfg["timezone"])).isoformat(timespec="seconds"),
        "attempts": attempts,
        "solutions_found": len(raw),
        "candidates": chosen,
    }
    CANDIDATES_PATH.parent.mkdir(parents=True, exist_ok=True)
    CANDIDATES_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    CANDIDATES_MD_PATH.write_text(_render_markdown(payload), encoding="utf-8")
    flagged = sum(1 for row in chosen if row["bias_review"])
    print(
        f"Wrote {len(chosen)} candidates ({flagged} bias-flagged) to {CANDIDATES_PATH}",
        flush=True,
    )
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate Wordelate puzzle candidates.")
    parser.add_argument("--count", type=int, default=15)
    parser.add_argument("--seed", type=int, default=20261119)
    parser.add_argument("--max-attempts", type=int, default=240)
    args = parser.parse_args()
    generate(args.count, args.seed, args.max_attempts)


if __name__ == "__main__":
    main()
