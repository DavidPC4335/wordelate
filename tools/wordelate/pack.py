"""Little-endian WLV1 letter shards and WLN1 nearest pack.

Letter shard (quantizer 1 only):
  magic char[4] = "WLV1"
  uint16 version = 1
  uint32 count
  uint16 dims
  uint16 quantizer = 1
  repeated: uint8 wordLen, utf-8 word, float16 scale, int8 q[dims]
  Words are sorted inside the shard.

Nearest pack header (little-endian ``<4sHIHH``, 14 bytes):
  magic "WLN1"
  uint16 version = 1
  uint32 count
  uint16 dims
  uint16 quantizer

Quantizer 1, symmetric per-vector int8:
  float16 scales[count]
  int8 matrix[count * dims] row-major
  then words: uint8 len, utf-8 bytes

Quantizer 2, IEEE binary16 rows (no scale table):
  float16 matrix[count * dims] row-major
  then words: uint8 len, utf-8 bytes

Overall word order is alphabetical.
"""

from __future__ import annotations

import hashlib
import struct
from pathlib import Path

import numpy as np

MAGIC_SHARD = b"WLV1"
MAGIC_PACK = b"WLN1"
VERSION = 1
VERSION_DISPLAY = 2
QUANT_INT8 = 1
QUANT_F16 = 2
HEADER = struct.Struct("<4sHIHH")


def _sort_rows(
    words: list[str],
    scales_f16: np.ndarray,
    q: np.ndarray,
) -> tuple[list[str], np.ndarray, np.ndarray]:
    order = sorted(range(len(words)), key=lambda i: words[i])
    sorted_words = [words[i] for i in order]
    idx = np.asarray(order, dtype=np.int64)
    return sorted_words, np.asarray(scales_f16)[idx], np.asarray(q)[idx]


def _check_word(word: str) -> bytes:
    if not word or len(word) > 255:
        raise ValueError(f"word length out of range: {word!r}")
    raw = word.encode("utf-8")
    if len(raw) > 255:
        raise ValueError(f"utf-8 length out of range: {word!r}")
    return raw


def pack_f16_bytes(words: list[str], matrix: np.ndarray) -> bytes:
    """Alphabetical WLN1 quantizer-2 pack of float32 rows stored as float16."""
    arr = np.asarray(matrix, dtype=np.float32)
    if arr.ndim != 2:
        raise ValueError(f"expected a matrix, got shape {arr.shape}")
    if len(words) != arr.shape[0]:
        raise ValueError("word count does not match rows")
    order = sorted(range(len(words)), key=lambda i: words[i])
    sorted_words = [words[i] for i in order]
    stored = np.ascontiguousarray(arr[np.asarray(order, dtype=np.int64)].astype("<f2"))
    count, dims = stored.shape
    out = bytearray()
    out += HEADER.pack(MAGIC_PACK, VERSION, count, dims, QUANT_F16)
    out += stored.tobytes()
    for word in sorted_words:
        raw = _check_word(word)
        out += struct.pack("<B", len(raw))
        out += raw
    return bytes(out)


def pack_bytes(
    words: list[str],
    scales_f16: np.ndarray,
    q: np.ndarray,
    display: np.ndarray | None = None,
) -> bytes:
    """Alphabetical int8 pack.

    ``display`` is a 0/1 flag per input row, aligned with ``words`` before
    sorting. When it is present the pack is version 2 and those flags sit
    immediately after the 14-byte header. Version 1 packs have no flag table.
    """
    order = sorted(range(len(words)), key=lambda i: words[i])
    idx = np.asarray(order, dtype=np.int64)
    words = [words[i] for i in order]
    scales_f16 = np.asarray(scales_f16)[idx]
    q = np.asarray(q)[idx]
    count, dims = q.shape
    if scales_f16.shape[0] != count:
        raise ValueError("scale count does not match rows")
    version = VERSION
    flags: np.ndarray | None = None
    if display is not None:
        flags = np.asarray(display, dtype=np.uint8)[idx]
        if flags.shape != (count,):
            raise ValueError("display flag count does not match rows")
        version = VERSION_DISPLAY
    quantizer = 1
    out = bytearray()
    out += HEADER.pack(MAGIC_PACK, version, count, dims, quantizer)
    if flags is not None:
        out += flags.tobytes()
    out += np.asarray(scales_f16, dtype="<f2").tobytes()
    out += np.asarray(q, dtype=np.int8).reshape(-1).tobytes()
    for word in words:
        raw = _check_word(word)
        out += struct.pack("<B", len(raw))
        out += raw
    return bytes(out)


def shard_bytes(words: list[str], scales_f16: np.ndarray, q: np.ndarray) -> bytes:
    words, scales_f16, q = _sort_rows(words, scales_f16, q)
    count, dims = (0, int(q.shape[1]) if q.ndim == 2 else 0) if len(words) == 0 else q.shape
    if len(words) == 0:
        # Caller passes dims via q shape even when empty: q is (0, dims).
        if q.ndim != 2:
            raise ValueError("empty shard needs q shaped (0, dims)")
        count, dims = q.shape
    quantizer = 1
    out = bytearray()
    out += HEADER.pack(MAGIC_SHARD, VERSION, count, dims, quantizer)
    scales = np.asarray(scales_f16, dtype="<f2")
    matrix = np.asarray(q, dtype=np.int8)
    for i, word in enumerate(words):
        raw = _check_word(word)
        out += struct.pack("<B", len(raw))
        out += raw
        out += scales[i].tobytes()
        out += matrix[i].tobytes()
    return bytes(out)


def _unpack_header(blob: bytes, magic: bytes) -> tuple[int, int, int, int]:
    if len(blob) < HEADER.size:
        raise ValueError("truncated header")
    got_magic, version, count, dims, quantizer = HEADER.unpack_from(blob, 0)
    if got_magic != magic:
        raise ValueError(f"bad magic {got_magic!r}, expected {magic!r}")
    if version not in (VERSION, VERSION_DISPLAY):
        raise ValueError(f"unsupported version {version}")
    return version, int(count), int(dims), int(quantizer)


def _read_header(blob: bytes, magic: bytes) -> tuple[int, int, int, int]:
    version, count, dims, quantizer = _unpack_header(blob, magic)
    if quantizer != QUANT_INT8:
        raise ValueError(f"unsupported quantizer {quantizer}")
    return version, count, dims, quantizer


def _read_words(blob: bytes, cursor: int, count: int) -> list[str]:
    words: list[str] = []
    for _ in range(count):
        if cursor >= len(blob):
            raise ValueError("truncated word table")
        length = blob[cursor]
        cursor += 1
        raw = blob[cursor : cursor + length]
        if len(raw) != length:
            raise ValueError("truncated word")
        cursor += length
        words.append(raw.decode("utf-8"))
    if cursor != len(blob):
        raise ValueError(f"trailing bytes in nearest pack: {len(blob) - cursor}")
    return words


def _int8_payload_offset(version: int, count: int) -> int:
    offset = HEADER.size
    if version == VERSION_DISPLAY:
        offset += count
    return offset


def read_display_flags(path: Path | bytes) -> np.ndarray:
    """1 for rows that may be shown as a label. Version 1 packs mark every row."""
    blob = path if isinstance(path, (bytes, bytearray)) else Path(path).read_bytes()
    version, count, _dims, quantizer = _unpack_header(blob, MAGIC_PACK)
    if quantizer != QUANT_INT8:
        raise ValueError(f"unsupported quantizer {quantizer}")
    if version == VERSION:
        return np.ones(count, dtype=np.uint8)
    if len(blob) < HEADER.size + count:
        raise ValueError("truncated display flags")
    return np.frombuffer(blob, dtype=np.uint8, count=count, offset=HEADER.size).copy()


def read_pack(path: Path | bytes) -> tuple[list[str], np.ndarray, np.ndarray]:
    blob = path if isinstance(path, (bytes, bytearray)) else Path(path).read_bytes()
    version, count, dims, quantizer = _unpack_header(blob, MAGIC_PACK)
    if quantizer != QUANT_INT8:
        raise ValueError(f"unsupported quantizer {quantizer}")
    offset = _int8_payload_offset(version, count)
    scale_bytes = count * 2
    matrix_bytes = count * dims
    end_scales = offset + scale_bytes
    end_matrix = end_scales + matrix_bytes
    if len(blob) < end_matrix:
        raise ValueError("truncated nearest pack")
    scales = np.frombuffer(blob, dtype="<f2", count=count, offset=offset).copy()
    matrix = np.frombuffer(blob, dtype=np.int8, count=count * dims, offset=end_scales).copy()
    matrix = matrix.reshape(count, dims)
    words = _read_words(blob, end_matrix, count)
    return words, matrix, scales


def read_matrix(path: Path | bytes) -> tuple[list[str], np.ndarray]:
    """Decode a nearest pack to words and float32 rows.

    Quantizer 1 is dequantized symmetric int8. Quantizer 2 is float16
    expanded back to float32.
    """
    blob = path if isinstance(path, (bytes, bytearray)) else Path(path).read_bytes()
    _version, count, dims, quantizer = _unpack_header(blob, MAGIC_PACK)
    offset = HEADER.size
    if quantizer == QUANT_INT8:
        words, matrix, scales = read_pack(blob)
        from wordelate.quantize import dequantize

        return words, dequantize(matrix, scales)
    if quantizer != QUANT_F16:
        raise ValueError(f"unsupported quantizer {quantizer}")
    matrix_bytes = count * dims * 2
    end_matrix = offset + matrix_bytes
    if len(blob) < end_matrix:
        raise ValueError("truncated nearest pack")
    matrix = np.frombuffer(blob, dtype="<f2", count=count * dims, offset=offset).reshape(count, dims)
    matrix = np.array(matrix, dtype=np.float32, copy=True)
    return _read_words(blob, end_matrix, count), matrix


def read_shard(path: Path | bytes) -> tuple[list[str], np.ndarray, np.ndarray]:
    blob = path if isinstance(path, (bytes, bytearray)) else Path(path).read_bytes()
    _version, count, dims, _quantizer = _read_header(blob, MAGIC_SHARD)
    words: list[str] = []
    scales = np.empty(count, dtype="<f2")
    matrix = np.empty((count, dims), dtype=np.int8)
    cursor = HEADER.size
    for i in range(count):
        if cursor >= len(blob):
            raise ValueError("truncated shard")
        length = blob[cursor]
        cursor += 1
        raw = blob[cursor : cursor + length]
        if len(raw) != length:
            raise ValueError("truncated shard word")
        cursor += length
        scale_end = cursor + 2
        q_end = scale_end + dims
        if q_end > len(blob):
            raise ValueError("truncated shard record")
        scales[i] = np.frombuffer(blob, dtype="<f2", count=1, offset=cursor)[0]
        matrix[i] = np.frombuffer(blob, dtype=np.int8, count=dims, offset=scale_end)
        cursor = q_end
        words.append(raw.decode("utf-8"))
    if cursor != len(blob):
        raise ValueError(f"trailing bytes in shard: {len(blob) - cursor}")
    return words, matrix, scales


def sha256_bytes(blob: bytes) -> str:
    return hashlib.sha256(blob).hexdigest()


def content_hash(blob: bytes) -> str:
    return sha256_bytes(blob)


def write_vocab_files(
    directory: Path,
    words: list[str],
    scales_f16: np.ndarray,
    q: np.ndarray,
    display: np.ndarray | None = None,
) -> dict[str, bytes]:
    """Write a.bin..z.bin and nearest.i8. Returns filename -> bytes."""
    order = sorted(range(len(words)), key=lambda i: words[i])
    idx = np.asarray(order, dtype=np.int64)
    words = [words[i] for i in order]
    scales_f16 = np.asarray(scales_f16)[idx]
    q = np.asarray(q)[idx]
    if display is not None:
        display = np.asarray(display, dtype=np.uint8)[idx]
    directory.mkdir(parents=True, exist_ok=True)
    files: dict[str, bytes] = {}
    dims = int(q.shape[1])
    by_letter: dict[str, list[int]] = {chr(ord("a") + i): [] for i in range(26)}
    for index, word in enumerate(words):
        if not word or word[0] < "a" or word[0] > "z":
            raise ValueError(f"word is not an a-z token: {word!r}")
        by_letter[word[0]].append(index)
    for letter, indices in by_letter.items():
        if indices:
            idx = np.asarray(indices, dtype=np.int64)
            blob = shard_bytes(
                [words[i] for i in indices],
                scales_f16[idx],
                q[idx],
            )
        else:
            blob = shard_bytes([], np.empty(0, dtype="<f2"), np.empty((0, dims), dtype=np.int8))
        files[f"{letter}.bin"] = blob
        (directory / f"{letter}.bin").write_bytes(blob)
    nearest = pack_bytes(words, scales_f16, q, display)
    files["nearest.i8"] = nearest
    (directory / "nearest.i8").write_bytes(nearest)
    return files


def assert_shards_match_pack(directory: Path) -> None:
    """Fail if any shard row disagrees with the nearest pack."""
    pack_words, pack_q, pack_scales = read_pack(directory / "nearest.i8")
    seen: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    for letter in (chr(ord("a") + i) for i in range(26)):
        words, matrix, scales = read_shard(directory / f"{letter}.bin")
        if words != sorted(words):
            raise RuntimeError(f"shard {letter} is not sorted")
        for i, word in enumerate(words):
            if not word or word[0] != letter:
                raise RuntimeError(f"{word!r} filed under shard {letter}")
            seen[word] = (matrix[i], scales[i])
    if sorted(seen) != pack_words:
        raise RuntimeError("shard word set does not match nearest pack order")
    for i, word in enumerate(pack_words):
        q_row, scale = seen[word]
        if not np.array_equal(q_row, pack_q[i]):
            raise RuntimeError(f"quantized row mismatch for {word}")
        if np.asarray(scale).view(np.uint16) != np.asarray(pack_scales[i]).view(np.uint16):
            raise RuntimeError(f"scale mismatch for {word}")
