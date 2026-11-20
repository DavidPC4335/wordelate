#!/usr/bin/env python3
"""Write puzzles/load.sql from puzzles/schedule.json.

Runs `wrangler d1 execute --local` only when wrangler is on PATH and a Worker
config names a D1 database. Never deploys and never passes --remote.

Usage:
  python tools/load_schedule.py
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from wordelate.config import load_config
from wordelate.paths import LOAD_SQL_PATH, ROOT, SCHEDULE_PATH
from wordelate.schedule import load_schedule, save_schedule, schedule_to_sql


def _strip_jsonc(text: str) -> str:
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
    kept = []
    for line in text.splitlines():
        in_string = False
        escaped = False
        buf = []
        for char in line:
            if escaped:
                buf.append(char)
                escaped = False
                continue
            if char == "\\":
                buf.append(char)
                escaped = True
                continue
            if char == '"':
                in_string = not in_string
                buf.append(char)
                continue
            if char == "/" and not in_string and buf and buf[-1] == "/":
                buf.pop()
                break
            buf.append(char)
        kept.append("".join(buf))
    return "\n".join(kept)


def find_d1_database() -> str | None:
    """Return a database_name from a wrangler config, if one exists."""
    candidates = [
        ROOT / "wrangler.jsonc",
        ROOT / "wrangler.json",
        ROOT / "wrangler.toml",
        ROOT / "packages" / "worker" / "wrangler.jsonc",
        ROOT / "packages" / "worker" / "wrangler.json",
        ROOT / "packages" / "worker" / "wrangler.toml",
    ]
    for path in candidates:
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8")
        if path.suffix == ".toml":
            match = re.search(r'database_name\s*=\s*"([^"]+)"', text)
            if match:
                return match.group(1)
            continue
        try:
            data = json.loads(_strip_jsonc(text))
        except json.JSONDecodeError:
            continue
        name = _database_name(data)
        if name:
            return name
    return None


def _database_name(node) -> str | None:
    if isinstance(node, dict):
        d1 = node.get("d1_databases")
        if isinstance(d1, list):
            for item in d1:
                if isinstance(item, dict) and item.get("database_name"):
                    return str(item["database_name"])
        for value in node.values():
            found = _database_name(value)
            if found:
                return found
    elif isinstance(node, list):
        for value in node:
            found = _database_name(value)
            if found:
                return found
    return None


def write_sql(schedule: dict, timezone: str) -> Path:
    LOAD_SQL_PATH.parent.mkdir(parents=True, exist_ok=True)
    LOAD_SQL_PATH.write_text(schedule_to_sql(schedule, timezone), encoding="utf-8")
    return LOAD_SQL_PATH


def maybe_execute(sql_path: Path, database: str | None) -> bool:
    wrangler = shutil.which("wrangler")
    if wrangler is None or database is None:
        print("wrangler or a D1 database_name was not found. Wrote SQL only.")
        print("When both exist:")
        print(f"  wrangler d1 execute <database-name> --local --file {sql_path}")
        return False
    command = [wrangler, "d1", "execute", database, "--local", "--file", str(sql_path)]
    print("Running:", " ".join(command), flush=True)
    completed = subprocess.run(command, cwd=ROOT, check=False)
    if completed.returncode != 0:
        print(f"wrangler d1 execute failed ({completed.returncode}). SQL is at {sql_path}.")
        return False
    print("Local D1 execute finished. This did not deploy.")
    return True


def main() -> None:
    cfg = load_config()
    if not SCHEDULE_PATH.is_file():
        save_schedule(SCHEDULE_PATH, {"puzzles": []})
    schedule = load_schedule(SCHEDULE_PATH)
    sql_path = write_sql(schedule, cfg["timezone"])
    print(f"Wrote {sql_path} ({len(schedule['puzzles'])} puzzles).")
    database = find_d1_database()
    maybe_execute(sql_path, database)


if __name__ == "__main__":
    main()
