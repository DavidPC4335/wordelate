"""Mirror of stem, cosine, and int8 dequant on fixed fixtures."""

from __future__ import annotations

import math

import numpy as np

from wordelate.fixtures import load
from wordelate.lexicon import load_irregulars
from wordelate.mathutil import apply_op, cosine, js_round, round_threshold
from wordelate.paths import IRREGULAR_PATH
from wordelate.quantize import dequantize, quantize_per_vector, scales_to_f16
from wordelate.stemmer import is_banned_operand, stem


def test_stem_fixtures():
    for case in load()["stem_cases"]:
        assert stem(case["word"]) == case["stem"], case


def test_stopped_stems_to_stop():
    assert stem("stopped") == "stop"


def test_deserts_banned_when_goal_is_desert():
    assert is_banned_operand("deserts", "water", "desert", [])
    assert stem("deserts") == stem("desert") == "desert"


def test_one_letter_prefix_does_not_ban():
    data = load()
    for case in data["ban_cases"]:
        got = is_banned_operand(case["operand"], case["start"], case["goal"], [])
        assert got is case["banned"], case


def test_irregular_mouse_mice():
    groups = load_irregulars(IRREGULAR_PATH)
    assert "mice" in groups["mouse"]
    assert is_banned_operand("mice", "mouse", "cheese", groups["mouse"])
    assert not is_banned_operand("mousepad", "mouse", "cheese", groups["mouse"])


def test_js_round_matches_math_round_half_toward_positive():
    values = np.array([0.5, 1.5, 64.5, -0.5, -63.5, 95.25, -95.5])
    got = js_round(values)
    # Math.round halfway ties toward +infinity.
    assert got.tolist() == [1, 2, 65, 0, -63, 95, -95]


def test_quantize_fixtures_use_js_rounding():
    for case in load()["quantize_cases"]:
        vector = np.array(case["vector"], dtype=np.float32)
        q, scales = quantize_per_vector(vector)
        assert scales.shape == (1,)
        assert q.reshape(-1).tolist() == case["q"], case["name"]
        stored = scales_to_f16(scales)
        rebuilt = dequantize(q, stored)
        promoted = stored.astype(np.float32)[0]
        expect = np.clip(js_round(vector.astype(np.float64) / float(scales[0])), -127, 127)
        assert q.reshape(-1).astype(int).tolist() == expect.astype(int).tolist()
        assert np.allclose(rebuilt.reshape(-1), q.reshape(-1).astype(np.float32) * promoted)


def test_unit_vector_scale_is_max_abs_over_127():
    vector = np.array([0.6, 0.0, 0.0, 0.8], dtype=np.float32)
    _q, scales = quantize_per_vector(vector)
    max_abs = float(np.max(np.abs(vector.astype(np.float64))))
    assert math.isclose(float(scales[0]), max_abs / 127.0, rel_tol=0, abs_tol=1e-12)


def test_dequant_uses_float16_scale():
    vector = np.array([0.6, 0.0, 0.0, 0.8], dtype=np.float32)
    q, scales = quantize_per_vector(vector)
    stored = scales_to_f16(scales)
    # IEEE binary16 is not the full float64 scale. Reconstruction must use the stored bits.
    assert stored.dtype == np.dtype("<f2") or stored.dtype == np.float16
    rebuilt = dequantize(q, stored)[0]
    manual = q.reshape(-1).astype(np.float32) * np.float32(stored[0])
    assert np.array_equal(rebuilt, manual)


def test_cosine_fixtures():
    for case in load()["cosine_cases"]:
        got = cosine(np.array(case["a"], dtype=np.float32), np.array(case["b"], dtype=np.float32))
        assert math.isclose(got, case["cosine"], rel_tol=0, abs_tol=1e-12), case


def test_cosine_orthogonal_and_identical():
    assert cosine(np.array([1.0, 0.0]), np.array([0.0, 1.0])) == 0.0
    same = cosine(np.array([0.3, -0.4, 0.5]), np.array([0.3, -0.4, 0.5]))
    assert math.isclose(same, 1.0, rel_tol=0, abs_tol=1e-12)


def test_apply_op_then_cosine():
    position = np.array([1.0, 0.0, 0.0], dtype=np.float32)
    vector = np.array([0.0, 1.0, 0.0], dtype=np.float32)
    moved = apply_op(position, vector, "+")
    assert moved.dtype == np.float32
    assert cosine(moved, np.array([1.0, 1.0, 0.0])) == cosine(
        np.array([1.0, 1.0, 0.0]), np.array([1.0, 1.0, 0.0])
    )


def test_threshold_rounds_half_up():
    assert round_threshold(0.80, 0.03) == 0.77
    assert round_threshold(0.555, 0.03) == 0.53
    assert round_threshold(0.55, 0.03) == 0.52
