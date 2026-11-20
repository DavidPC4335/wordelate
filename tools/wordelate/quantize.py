"""Symmetric int8 quantization.

Per vector: scale = max(|x|) / 127, q = clamp(round(x / scale), -127, 127).
-128 is unused so the range stays symmetric. The stored scale is float16.
Global scale uses one max(|x|) for the whole matrix. It is measured, not shipped.
"""

from __future__ import annotations

import numpy as np

from wordelate.mathutil import js_round


def _as_float32(matrix: np.ndarray) -> np.ndarray:
    arr = np.asarray(matrix, dtype=np.float32)
    if arr.ndim == 1:
        arr = arr.reshape(1, -1)
    if arr.ndim != 2:
        raise ValueError(f"expected a vector or matrix, got shape {arr.shape}")
    return arr


def quantize_with_scales(matrix: np.ndarray, scales: np.ndarray) -> np.ndarray:
    """Quantize rows with the given per-row scales. Zero scales yield zeros."""
    arr = _as_float32(matrix)
    scale = np.asarray(scales, dtype=np.float64).reshape(-1)
    if scale.shape[0] != arr.shape[0]:
        raise ValueError("scale count does not match rows")
    q = np.zeros(arr.shape, dtype=np.int16)
    live = scale > 0
    if np.any(live):
        ratios = arr[live].astype(np.float64) / scale[live, None]
        rounded = js_round(ratios)
        q[live] = np.clip(rounded, -127, 127).astype(np.int16)
    return q.astype(np.int8)


def per_vector_scales(matrix: np.ndarray) -> np.ndarray:
    arr = _as_float32(matrix)
    max_abs = np.max(np.abs(arr), axis=1).astype(np.float64)
    return (max_abs / 127.0).astype(np.float64)


def quantize_per_vector(matrix: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Return (int8 q, float64 scales) for symmetric per-vector int8."""
    scales = per_vector_scales(matrix)
    q = quantize_with_scales(matrix, scales)
    return q, scales


def quantize_global(matrix: np.ndarray) -> tuple[np.ndarray, float]:
    """One scale for the whole matrix: max(|x|) / 127."""
    arr = _as_float32(matrix)
    max_abs = float(np.max(np.abs(arr))) if arr.size else 0.0
    scale = max_abs / 127.0
    scales = np.full(arr.shape[0], scale, dtype=np.float64)
    q = quantize_with_scales(arr, scales)
    return q, scale


def scales_to_f16(scales: np.ndarray) -> np.ndarray:
    """Little-endian IEEE binary16 scales."""
    return np.asarray(scales, dtype=np.float64).astype("<f2")


def dequantize(q: np.ndarray, scales_f16: np.ndarray) -> np.ndarray:
    """Reconstruct float32(q) * float32(float16 scale)."""
    quant = np.asarray(q, dtype=np.int8)
    if quant.ndim == 1:
        quant = quant.reshape(1, -1)
    scales = np.asarray(scales_f16, dtype="<f2").astype(np.float32).reshape(-1)
    if scales.shape[0] != quant.shape[0]:
        raise ValueError("dequantize scale count does not match rows")
    return quant.astype(np.float32) * scales[:, None]


def quantize_matrix_per_vector(matrix: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """L2-normalized float32 in, plus int8 and float16 scales out.

    `matrix` must already be L2-normalized. Returns (q, scales_f16, dequant).
    """
    q, scales = quantize_per_vector(matrix)
    scales_f16 = scales_to_f16(scales)
    return q, scales_f16, dequantize(q, scales_f16)
