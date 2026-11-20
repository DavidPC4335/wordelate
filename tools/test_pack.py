"""Little-endian WLV1 / WLN1 round trip."""

from __future__ import annotations

import numpy as np

from wordelate.pack import (
    pack_bytes,
    pack_f16_bytes,
    read_matrix,
    read_pack,
    read_shard,
    shard_bytes,
    write_vocab_files,
    assert_shards_match_pack,
)


def test_nearest_pack_header_and_roundtrip(tmp_path):
    words = ["ab"]
    scales = np.array([1.0], dtype="<f2")
    q = np.array([[1, -1]], dtype=np.int8)
    blob = pack_bytes(words, scales, q)
    assert blob[:4] == b"WLN1"
    # version 1, count 1, dims 2, quantizer 1, scale 1.0 (0x3C00), q = 1, -1, len 2, "ab"
    expected = bytes(
        [
            0x57, 0x4C, 0x4E, 0x31,
            0x01, 0x00,
            0x01, 0x00, 0x00, 0x00,
            0x02, 0x00,
            0x01, 0x00,
            0x00, 0x3C,
            0x01, 0xFF,
            0x02, 0x61, 0x62,
        ]
    )
    assert blob == expected
    got_words, got_q, got_scales = read_pack(blob)
    assert got_words == ["ab"]
    assert got_q.tolist() == [[1, -1]]
    assert got_scales.view(np.uint16).tolist() == [0x3C00]


def test_shard_is_sorted_and_matches_pack(tmp_path):
    words = ["bee", "ant", "cat"]
    scales = np.array([1.0, 0.5, 0.25], dtype=np.float32).astype("<f2")
    q = np.array(
        [
            [1, 2, 3],
            [4, 5, 6],
            [-1, -2, 7],
        ],
        dtype=np.int8,
    )
    directory = tmp_path / "vocab"
    write_vocab_files(directory, words, scales, q)
    assert_shards_match_pack(directory)
    shard_words, shard_q, _scales = read_shard(directory / "a.bin")
    assert shard_words == ["ant"]
    assert shard_q.tolist() == [[4, 5, 6]]
    empty_words, empty_q, _empty_scales = read_shard(directory / "z.bin")
    assert empty_words == []
    assert empty_q.shape == (0, 3)
    pack_words, _pack_q, _pack_scales = read_pack(directory / "nearest.i8")
    assert pack_words == ["ant", "bee", "cat"]


def test_float16_pack_roundtrip():
    words = ["bee", "ant"]
    matrix = np.array([[0.5, -0.25, 0.125], [1.0, -2.0, 0.5]], dtype=np.float32)
    blob = pack_f16_bytes(words, matrix)
    assert blob[:4] == b"WLN1"
    assert blob[12:14] == b"\x02\x00"
    got_words, got = read_matrix(blob)
    assert got_words == ["ant", "bee"]
    stored = matrix.astype(np.float16).astype(np.float32)
    assert np.array_equal(got[0], stored[1])
    assert np.array_equal(got[1], stored[0])


def test_shard_record_layout():
    scales = np.array([1.0], dtype="<f2")
    q = np.array([[1, -1]], dtype=np.int8)
    blob = shard_bytes(["ab"], scales, q)
    expected = bytes(
        [
            0x57, 0x4C, 0x56, 0x31,
            0x01, 0x00,
            0x01, 0x00, 0x00, 0x00,
            0x02, 0x00,
            0x01, 0x00,
            0x02, 0x61, 0x62,
            0x00, 0x3C,
            0x01, 0xFF,
        ]
    )
    assert blob == expected
