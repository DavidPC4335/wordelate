"""Editable blocklist, bias lexicon, and irregular variant groups."""

from __future__ import annotations

import re
from pathlib import Path

_SPLIT = re.compile(r"[\s/]+")


def _body_lines(path: Path) -> list[str]:
    lines: list[str] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            continue
        # Drop a trailing inline comment.
        body = stripped.split("#", 1)[0].strip().lower()
        if body:
            lines.append(body)
    return lines


def load_blocklist(path: Path) -> set[str]:
    words: set[str] = set()
    for line in _body_lines(path):
        for token in line.split():
            if token.isascii() and token.isalpha():
                words.add(token)
    return words


def load_bias(path: Path) -> dict[str, list[str]]:
    """word -> categories. A word may be listed on more than one row."""
    acc: dict[str, list[str]] = {}
    for line in _body_lines(path):
        parts = line.split("\t") if "\t" in line else line.split()
        if len(parts) < 2:
            continue
        word, category = parts[0].strip().lower(), parts[1].strip().lower()
        if not word:
            continue
        bucket = acc.setdefault(word, [])
        if category not in bucket:
            bucket.append(category)
    return acc


def load_irregulars(path: Path) -> dict[str, set[str]]:
    """Map every word to the full group it belongs to, including itself."""
    groups: list[set[str]] = []
    for line in _body_lines(path):
        parts = [part for part in _SPLIT.split(line) if part]
        if len(parts) >= 2:
            groups.append(set(parts))
    index: dict[str, set[str]] = {}
    for group in groups:
        for word in group:
            index.setdefault(word, set()).update(group)
    return index


def bias_hits(words: list[str], lexicon: dict[str, list[str]]) -> list[dict]:
    hits: list[dict] = []
    seen: set[str] = set()
    for word in words:
        if word in seen or word not in lexicon:
            continue
        seen.add(word)
        hits.append({"word": word, "categories": list(lexicon[word])})
    return hits
