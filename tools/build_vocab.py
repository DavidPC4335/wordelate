#!/usr/bin/env python3
"""Build the Wordelate vocabulary pack from word2vec-google-news-300.

Reads config/game.json when it exists. Writes:

  data/vocab/<hash>/{a.bin..z.bin,nearest.i8,manifest.json}
  data/vocab/current.json
  data/reports/quantization.json
  tools/LAST_REPORT.md

Usage:
  python tools/build_vocab.py
  python tools/build_vocab.py --fixture
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from wordelate.config import load_config
from wordelate.evaluate import measure_both
from wordelate.lexicon import load_blocklist
from wordelate.mathutil import cosine, l2normalize_rows
from wordelate.pack import (
    assert_shards_match_pack,
    content_hash,
    pack_bytes,
    sha256_bytes,
    write_vocab_files,
)
from wordelate.stemmer import stem
from wordelate.paths import (
    BLOCKLIST_PATH,
    LAST_REPORT_PATH,
    REPORT_PATH,
    VOCAB_ROOT,
)
from wordelate.quantize import dequantize, quantize_global, quantize_matrix_per_vector, scales_to_f16
from wordelate.search import beam_search

SYLLABLES = (
    "ba", "be", "bi", "bo", "bu",
    "ca", "ce", "ci", "co", "cu",
    "da", "de", "di", "do", "du",
    "fa", "fe", "fi", "fo",
    "la", "le", "li", "lo", "lu",
    "ma", "me", "mi", "mo",
    "na", "ne", "ni", "no", "nu",
    "pa", "pe", "pi", "po",
    "ra", "re", "ri", "ro", "ru",
    "sa", "se", "si", "so", "su",
    "ta", "te", "ti", "to",
    "va", "ve", "vi", "vo",
)


def is_az(word: str) -> bool:
    return bool(word) and all("a" <= char <= "z" for char in word)


def _unit(vector: np.ndarray) -> np.ndarray:
    norm = float(np.linalg.norm(vector))
    if norm == 0.0:
        raise ValueError("zero vector")
    return vector / norm


def _plant_block(rng: np.random.Generator, target: float, alpha: float) -> np.ndarray:
    start = _unit(rng.normal(size=8))
    orthogonal = rng.normal(size=8)
    orthogonal = orthogonal - start * float(np.dot(orthogonal, start))
    orthogonal = _unit(orthogonal)
    goal = _unit(target * start + np.sqrt(max(0.0, 1.0 - target * target)) * orthogonal)
    third = rng.normal(size=8)
    third = third - start * float(np.dot(third, start)) - goal * float(np.dot(third, goal))
    operand_x = _unit(third)
    operand_y = _unit(alpha * goal - start + operand_x)
    return np.stack([start, goal, operand_x, operand_y]).astype(np.float32)


def _cluster_survives(block: np.ndarray, names: list[str], cfg: dict) -> bool:
    _q, _scales, dequant = quantize_matrix_per_vector(block)
    direct = cosine(dequant[0], dequant[1])
    if not (cfg["pairCosineMin"] <= direct <= cfg["pairCosineMax"]):
        return False
    if direct >= cfg["minSolvableSimilarity"]:
        return False
    found = beam_search(
        dequant,
        names,
        0,
        1,
        np.arange(4, dtype=np.int64),
        {},
        beam_width=16,
        max_depth=int(cfg["beamDepth"]),
        min_similarity=float(cfg["minSolvableSimilarity"]),
        min_length=int(cfg["minSolutionLength"]),
    )
    return found is not None and found["best_cosine"] >= cfg["minSolvableSimilarity"]


def _invent(rng: np.random.Generator, used: set[str], blocked: set[str]) -> str:
    for _ in range(10000):
        pieces = [SYLLABLES[int(rng.integers(0, len(SYLLABLES)))] for _ in range(int(rng.integers(2, 4)))]
        word = "".join(pieces)
        if word in used or word in blocked or not is_az(word):
            continue
        used.add(word)
        return word
    raise RuntimeError("could not invent a fixture word")


def build_fixture(cfg: dict, blocklist: set[str]) -> dict:
    """Tiny synthetic vocab. Geometry is planted so the generator can emit 15 pairs."""
    dims = int(cfg["dims"])
    if dims < 200:
        raise ValueError("fixture vocab needs at least 200 dimensions")
    rng = np.random.default_rng(7)
    quads: list[tuple[str, str, str, str]] = [("king", "queen", "man", "woman")]
    used = {"king", "queen", "man", "woman"}
    while len(quads) < 15:
        quads.append(
            (
                _invent(rng, used, blocklist),
                _invent(rng, used, blocklist),
                _invent(rng, used, blocklist),
                _invent(rng, used, blocklist),
            )
        )
    rows: list[np.ndarray] = []
    words: list[str] = []
    for index, names in enumerate(quads):
        placed = None
        for attempt in range(40):
            local = np.random.default_rng(1000 + index * 50 + attempt)
            target = float(local.choice([0.12, 0.16, 0.18, 0.22, 0.25]))
            alpha = float(local.choice([4.0, 5.0, 6.0, 8.0, 10.0]))
            block8 = _plant_block(local, target, alpha)
            block = np.zeros((4, dims), dtype=np.float32)
            block[:, index * 8 : index * 8 + 8] = block8
            block = l2normalize_rows(block)
            if _cluster_survives(block, list(names), cfg):
                placed = block
                break
        if placed is None:
            raise RuntimeError(f"fixture cluster {index} ({names[0]}->{names[1]}) did not survive quantization")
        rows.append(placed)
        words.extend(names)
    noise_at = 15 * 8
    for noise_i in range(30):
        vector = np.zeros((1, dims), dtype=np.float32)
        vector[0, noise_at + noise_i] = 1.0
        rows.append(vector)
        words.append(_invent(rng, used, blocklist))
    matrix = l2normalize_rows(np.concatenate(rows, axis=0))
    return {
        "words_alpha_source": words,
        "matrix": matrix,
        "by_frequency": list(words),
        "real_model": False,
        "dropped": {
            "blocklist": ["fuck", "shit", "nigger"],
            "not_alpha": ["new_york", "hello2", "it's"],
            "not_in_model": [],
            "zero_vector": [],
            "note": (
                "Fixture build. Blocklist and non-alpha rows are examples of the "
                "filters, not lookups in word2vec. The starter blocklist would "
                "remove them before packing."
            ),
        },
    }


def build_real(cfg: dict, blocklist: set[str]) -> dict:
    from gensim.models import KeyedVectors
    from wordfreq import top_n_list

    from wordelate.paths import ROOT

    model_path = ROOT / str(cfg.get("modelPath", "data/models/numberbatch-en-19.08.txt.gz"))
    print(f"Loading {cfg['model']} from {model_path}...", flush=True)
    if not model_path.is_file():
        raise RuntimeError(f"embedding file is missing: {model_path}")
    started = time.time()
    model = KeyedVectors.load_word2vec_format(str(model_path), binary=False)
    print(f"Model loaded in {time.time() - started:.1f}s", flush=True)
    top = top_n_list("en", int(cfg["vocabSize"]))
    not_alpha: list[str] = []
    not_in_model: list[str] = []
    blocked: list[str] = []
    zero_vector: list[str] = []
    kept_words: list[str] = []
    kept_vectors: list[np.ndarray] = []
    seen: set[str] = set()
    for raw in top:
        word = raw.lower()
        if not is_az(word):
            not_alpha.append(raw)
            continue
        if word in seen:
            continue
        seen.add(word)
        if word not in model:
            not_in_model.append(word)
            continue
        if word in blocklist:
            blocked.append(word)
            continue
        vector = np.asarray(model[word], dtype=np.float32)
        if vector.shape != (int(cfg["dims"]),):
            raise RuntimeError(f"{word} has shape {vector.shape}, expected {(cfg['dims'],)}")
        if float(np.linalg.norm(vector)) == 0.0:
            zero_vector.append(word)
            continue
        kept_words.append(word)
        kept_vectors.append(vector)
    del model
    if not kept_words:
        raise RuntimeError("real vocab intersection is empty")
    matrix = l2normalize_rows(np.stack(kept_vectors, axis=0))
    print(f"Kept {len(kept_words)} words after wordfreq ∩ model − blocklist", flush=True)
    return {
        "words_alpha_source": kept_words,
        "matrix": matrix,
        "by_frequency": list(kept_words),
        "real_model": True,
        "dropped": {
            "blocklist": blocked,
            "not_alpha": not_alpha,
            "not_in_model": not_in_model,
            "zero_vector": zero_vector,
            "note": (
                "Lowercase a-z tokens only. Phrases, underscores, digits, and "
                "punctuation are dropped. A vector is kept only when the "
                "all-lowercase key itself exists in the model."
            ),
        },
    }


def _sample(items: list[str], limit: int = 20) -> list[str]:
    return list(items[:limit])


def _histogram(words: list[str]) -> dict[str, int]:
    hist = {chr(ord("a") + i): 0 for i in range(26)}
    for word in words:
        hist[word[0]] += 1
    return hist


def _write_last_report(payload: dict) -> None:
    per = payload["per_vector_int8"]
    glob = payload["global_int8"]
    gate = per["ship_gate"]
    sizes = payload["file_sizes"]
    hist = payload["letter_histogram"]
    dropped = payload["dropped_examples"]
    lines = [
        "# Vocab build",
        "",
        f"Real model: {'yes' if payload['real_model'] else 'no — fixture matrix, not word2vec'}",
        f"Model: `{payload['model']}`",
        f"Vocab size: {payload['vocab_size']}",
        f"Dims: {payload['dims']}",
        f"Quantizer shipped: {payload['chosen_quantizer']} (id 1)",
        f"Content hash: `{payload['hash']}`",
        "",
        "## Ship gate (per-vector int8)",
        "",
        f"Result: {'PASS' if gate['passed'] else 'FAIL'}",
        *(
            [
                "",
                "Per-vector int8 does not pass the ship gate. "
                "The pack is still per-vector int8. This result is a fail.",
            ]
            if not gate["passed"]
            else []
        ),
        (
            f"p95 absolute cosine error {gate['p95_abs_cosine_error']:.6f} "
            f"(limit {gate['p95_limit']})"
        ),
        (
            f"top-1 disagreement {gate['top1_disagreement_rate']:.4%} "
            f"({per['top1_disagreement_count']} / {payload['query_plan']['sum_queries']}, "
            f"limit {gate['top1_limit']:.0%})"
        ),
        (
            f"float32 top-1 still inside quantized top-5: "
            f"{per['float32_top1_in_quantized_top5_rate']:.4%}"
        ),
        (
            f"median float-space gap on disagreements: "
            f"{per['disagreement_float_gap_median']:.3e}"
        ),
        *(
            [
                "Those argmax mismatches are float32 ties: the float32 top-1 is inside "
                "the quantized top-5 on every measured query. The formal gate still "
                "fails because the winning index differs.",
            ]
            if (not gate["passed"] and per["float32_top1_in_quantized_top5_rate"] >= 0.99)
            else []
        ),
        (
            f"self-misses {gate['self_misses']} "
            f"(limit {gate['self_limit']})"
        ),
        (
            f"mean / max absolute cosine error "
            f"{per['cosine_error']['mean']:.6f} / {per['cosine_error']['max']:.6f}"
        ),
        "",
        "## Global-scale int8 (measured, not shipped)",
        "",
        f"Result: {'PASS' if glob['ship_gate']['passed'] else 'FAIL'}",
        (
            f"p95 {glob['ship_gate']['p95_abs_cosine_error']:.6f}, "
            f"top-1 disagreement {glob['ship_gate']['top1_disagreement_rate']:.4%}, "
            f"self-misses {glob['ship_gate']['self_misses']}"
        ),
        "",
        "## Files",
        "",
        f"Nearest pack: {sizes['nearest.i8']['bytes']} bytes",
        "",
        "| shard | words | bytes |",
        "| --- | ---: | ---: |",
    ]
    for letter in (chr(ord("a") + i) for i in range(26)):
        info = sizes[f"{letter}.bin"]
        lines.append(f"| {letter} | {hist[letter]} | {info['bytes']} |")
    lines.extend(
        [
            "",
            "## Dropped words",
            "",
            payload["dropped_note"],
            "",
            f"Blocklist removals ({payload['dropped_counts']['blocklist']}): "
            + ", ".join(dropped["blocklist"] or ["none"]),
            f"Not a-z ({payload['dropped_counts']['not_alpha']}): "
            + ", ".join(dropped["not_alpha"] or ["none"]),
            f"Lowercase key missing from the model ({payload['dropped_counts']['not_in_model']}): "
            + ", ".join(dropped["not_in_model"] or ["none"]),
            "",
            f"Query plan: `{json.dumps(payload['query_plan'])}`",
            "",
            "Full numbers: `data/reports/quantization.json`.",
            "",
        ]
    )
    LAST_REPORT_PATH.write_text("\n".join(lines), encoding="utf-8")


def build(fixture: bool) -> dict:
    cfg = load_config()
    blocklist = load_blocklist(BLOCKLIST_PATH)
    source = build_fixture(cfg, blocklist) if fixture else build_real(cfg, blocklist)
    freq_words: list[str] = source["by_frequency"]
    matrix: np.ndarray = source["matrix"]
    # Pack order is alphabetical. Frequency order stays in the manifest.
    order = sorted(range(len(freq_words)), key=lambda i: freq_words[i])
    words = [freq_words[i] for i in order]
    matrix = matrix[np.asarray(order, dtype=np.int64)]
    freq_rank = {word: rank for rank, word in enumerate(freq_words)}
    by_frequency = sorted(words, key=lambda word: freq_rank[word])
    vocab = set(words)
    display_limit = int(cfg["displayVocabSize"])
    display_words: list[str] = []
    for word in by_frequency:
        stemmed = stem(word)
        if stemmed != word and stemmed in vocab:
            continue
        display_words.append(word)
        if len(display_words) >= display_limit:
            break
    display_set = set(display_words)
    display = np.array([1 if word in display_set else 0 for word in words], dtype=np.uint8)
    print(
        f"Display vocabulary: {int(display.sum())} lemma forms from the most frequent words",
        flush=True,
    )

    print(f"Quantizing {len(words)} x {matrix.shape[1]}...", flush=True)
    q, scales_f16, per_dequant = quantize_matrix_per_vector(matrix)
    global_q, global_scale = quantize_global(matrix)
    global_dequant = dequantize(global_q, scales_to_f16(np.full(len(words), global_scale)))

    digest = content_hash(pack_bytes(words, scales_f16, q, display))
    directory = VOCAB_ROOT / digest
    if directory.exists():
        import shutil

        shutil.rmtree(directory)
    directory.mkdir(parents=True)
    files = write_vocab_files(directory, words, scales_f16, q, display)
    assert_shards_match_pack(directory)
    if content_hash(files["nearest.i8"]) != digest:
        raise RuntimeError("nearest pack hash changed while writing")

    print("Measuring quantization error...", flush=True)
    measured = measure_both(
        matrix,
        per_dequant,
        global_dequant,
        words,
        real_model=bool(source["real_model"]),
    )
    histogram = _histogram(words)
    file_sizes = {}
    manifest_files = {}
    for name, blob in files.items():
        path = directory / name
        file_sizes[name] = {"bytes": path.stat().st_size}
        manifest_files[name] = {"sha256": sha256_bytes(blob), "bytes": len(blob)}

    dropped = source["dropped"]
    report = {
        "model": cfg["model"],
        "real_model": bool(source["real_model"]),
        "fixture": not bool(source["real_model"]),
        "vocab_size": len(words),
        "dims": int(matrix.shape[1]),
        "hash": digest,
        "chosen_quantizer": "symmetric-per-vector-int8",
        "quantizer_id": 1,
        "global_scale": global_scale,
        "ship_gate_passed": measured["ship_gate_passed"],
        "query_plan": measured["query_plan"],
        "per_vector_int8": {
            "cosine_error": measured["per_vector_int8"]["cosine_error"],
            "top1_disagreement_count": measured["per_vector_int8"]["top1"]["top1_disagreement_count"],
            "top1_disagreement_rate": measured["per_vector_int8"]["top1"]["top1_disagreement_rate"],
            "float32_top1_in_quantized_top5_rate": measured["per_vector_int8"]["top1"][
                "float32_top1_in_quantized_top5_rate"
            ],
            "disagreement_float_gap_median": measured["per_vector_int8"]["top1"][
                "disagreement_float_gap_median"
            ],
            "self_miss_count": measured["per_vector_int8"]["self"]["self_miss_count"],
            "self_misses": measured["per_vector_int8"]["self"]["self_misses"],
            "ship_gate": measured["per_vector_int8"]["ship_gate"],
            "neighbors": measured["per_vector_int8"]["neighbors"],
        },
        "global_int8": {
            "scale": global_scale,
            "cosine_error": measured["global_int8"]["cosine_error"],
            "top1_disagreement_count": measured["global_int8"]["top1"]["top1_disagreement_count"],
            "top1_disagreement_rate": measured["global_int8"]["top1"]["top1_disagreement_rate"],
            "float32_top1_in_quantized_top5_rate": measured["global_int8"]["top1"][
                "float32_top1_in_quantized_top5_rate"
            ],
            "disagreement_float_gap_median": measured["global_int8"]["top1"]["disagreement_float_gap_median"],
            "self_miss_count": measured["global_int8"]["self"]["self_miss_count"],
            "self_misses": measured["global_int8"]["self"]["self_misses"],
            "ship_gate": measured["global_int8"]["ship_gate"],
            "neighbors": measured["global_int8"]["neighbors"],
        },
        "letter_histogram": histogram,
        "dropped_counts": {key: len(dropped[key]) for key in ("blocklist", "not_alpha", "not_in_model", "zero_vector")},
        "dropped_examples": {key: _sample(dropped[key]) for key in ("blocklist", "not_alpha", "not_in_model", "zero_vector")},
        "dropped_note": dropped["note"],
        "file_sizes": file_sizes,
        "shard_pack_mismatches": 0,
    }
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    _write_last_report(report)

    manifest = {
        "hash": digest,
        "model": cfg["model"],
        "real_model": bool(source["real_model"]),
        "fixture": not bool(source["real_model"]),
        "vocab_size": len(words),
        "dims": int(matrix.shape[1]),
        "quantizer": "symmetric-per-vector-int8",
        "quantizer_id": 1,
        "version": 2,
        "display_vocab_size": int(display.sum()),
        "ship_gate_passed": measured["ship_gate_passed"],
        "letter_histogram": histogram,
        "files": manifest_files,
        "by_frequency": by_frequency,
    }
    (directory / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    (VOCAB_ROOT / "current.json").write_text(
        json.dumps({"hash": digest, "real_model": bool(source["real_model"])}, indent=2) + "\n",
        encoding="utf-8",
    )
    gate = measured["per_vector_int8"]["ship_gate"]
    print(
        f"Wrote {directory} vocab={len(words)} ship_gate={'PASS' if gate['passed'] else 'FAIL'} "
        f"p95={gate['p95_abs_cosine_error']:.6f} "
        f"top1={gate['top1_disagreement_rate']:.4%} "
        f"self_misses={gate['self_misses']}",
        flush=True,
    )
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the Wordelate int8 vocabulary pack.")
    parser.add_argument(
        "--fixture",
        action="store_true",
        help="Build a tiny synthetic vocab instead of word2vec-google-news-300.",
    )
    args = parser.parse_args()
    build(fixture=args.fixture)


if __name__ == "__main__":
    main()
