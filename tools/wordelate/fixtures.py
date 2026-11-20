"""Fixed numeric and stem fixtures shared with the future TypeScript tests.

Quantized q values use JavaScript Math.round (halfway cases toward +infinity),
not Python bankers rounding. float16 scales are IEEE binary16.
"""

from __future__ import annotations

import json
from pathlib import Path

FIXTURE_PATH = Path(__file__).resolve().parents[1] / "fixtures" / "math_mirror.json"


def load() -> dict:
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
