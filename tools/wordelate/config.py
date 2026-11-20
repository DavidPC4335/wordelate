"""Read config/game.json when it exists. Otherwise use the locked defaults."""

from __future__ import annotations

import json
from pathlib import Path

from wordelate.paths import CONFIG_PATH

# Locked numbers from PLAN.md / the product decisions. config/game.json overlays these.
DEFAULTS: dict = {
    "timezone": "America/New_York",
    "vocabSize": 40000,
    "maxMoves": 16,
    "similarityBand": [0.05, 0.30],
    "minSolvableSimilarity": 0.55,
    "thresholdSlack": 0.03,
    "minThreshold": 0.50,
    "beamWidth": 64,
    "beamDepth": 4,
    "operandPoolSize": 8000,
    "minSolutionLength": 2,
    "easyPar": 2,
    "easyMinCosine": 0.80,
    "dims": 300,
    "model": "conceptnet-numberbatch-en-19.08",
    "modelPath": "data/models/numberbatch-en-19.08.txt.gz",
    "displayVocabSize": 12000,
    "labelNearDuplicateCutoff": 0.7,
    "labelWarmSimilarity": 0.45,
    "winSimilarity": 0.75,
    "quantizerId": 1,
    "nicknameMaxLength": 24,
}


def load_config(path: Path | None = None) -> dict:
    """Return the game config. Missing file falls back to the locked defaults."""
    cfg = dict(DEFAULTS)
    config_path = Path(path) if path is not None else CONFIG_PATH
    if config_path.is_file():
        loaded = json.loads(config_path.read_text(encoding="utf-8"))
        if not isinstance(loaded, dict):
            raise ValueError(f"{config_path} must be a JSON object")
        cfg.update(loaded)
        cfg["configPath"] = str(config_path)
    else:
        cfg["configPath"] = None
    band = cfg.get("similarityBand", DEFAULTS["similarityBand"])
    if not isinstance(band, (list, tuple)) or len(band) != 2:
        raise ValueError("similarityBand must be [min, max]")
    cfg["similarityBand"] = [float(band[0]), float(band[1])]
    cfg["pairCosineMin"] = float(band[0])
    cfg["pairCosineMax"] = float(band[1])
    cfg["vocabSize"] = int(cfg["vocabSize"])
    cfg["maxMoves"] = int(cfg["maxMoves"])
    cfg["beamWidth"] = int(cfg["beamWidth"])
    cfg["beamDepth"] = int(cfg["beamDepth"])
    cfg["operandPoolSize"] = int(cfg["operandPoolSize"])
    cfg["minSolutionLength"] = int(cfg.get("minSolutionLength", 2))
    cfg["easyPar"] = int(cfg.get("easyPar", 2))
    cfg["easyMinCosine"] = float(cfg.get("easyMinCosine", 0.80))
    cfg["dims"] = int(cfg.get("dims", 300))
    cfg["minSolvableSimilarity"] = float(cfg["minSolvableSimilarity"])
    cfg["thresholdSlack"] = float(cfg["thresholdSlack"])
    cfg["minThreshold"] = float(cfg["minThreshold"])
    cfg["quantizerId"] = int(cfg.get("quantizerId", 1))
    cfg["displayVocabSize"] = int(cfg.get("displayVocabSize", 12000))
    cfg["labelNearDuplicateCutoff"] = float(cfg.get("labelNearDuplicateCutoff", 0.7))
    cfg["labelWarmSimilarity"] = float(cfg.get("labelWarmSimilarity", 0.45))
    cfg["winSimilarity"] = float(cfg.get("winSimilarity", 0.75))
    return cfg
