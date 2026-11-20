"""Repository paths owned by the offline tooling."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TOOLS = ROOT / "tools"
DATA = ROOT / "data"
PUZZLES = ROOT / "puzzles"
CONFIG_PATH = ROOT / "config" / "game.json"
BLOCKLIST_PATH = TOOLS / "blocklist.txt"
BIAS_PATH = TOOLS / "bias_lexicon.tsv"
IRREGULAR_PATH = TOOLS / "irregular_variants.txt"
SCHEDULE_PATH = PUZZLES / "schedule.json"
LOAD_SQL_PATH = PUZZLES / "load.sql"
CANDIDATES_PATH = DATA / "candidates.json"
CANDIDATES_MD_PATH = TOOLS / "CANDIDATES.md"
LAST_REPORT_PATH = TOOLS / "LAST_REPORT.md"
REPORT_PATH = DATA / "reports" / "quantization.json"
VOCAB_ROOT = DATA / "vocab"
FIXTURES = TOOLS / "fixtures"
