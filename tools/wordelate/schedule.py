"""Approved-schedule file and the D1 load SQL."""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo


def empty_schedule() -> dict:
    return {"puzzles": []}


def load_schedule(path: Path) -> dict:
    if not path.is_file():
        return empty_schedule()
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, list):
        return {"puzzles": data}
    if not isinstance(data, dict) or not isinstance(data.get("puzzles"), list):
        raise ValueError(f"{path} must be {{\"puzzles\": [...]}}")
    return data


def save_schedule(path: Path, schedule: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(schedule, indent=2) + "\n", encoding="utf-8")


def _parse_date(value: str):
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError as exc:
        raise ValueError(f"date must be YYYY-MM-DD, got {value!r}") from exc


def used_dates(schedule: dict) -> set[str]:
    return {row["puzzle_date"] for row in schedule["puzzles"]}


def next_free_date(schedule: dict, timezone: str, today=None) -> str:
    tz = ZoneInfo(timezone)
    day = today or datetime.now(tz).date()
    taken = used_dates(schedule)
    while day.isoformat() in taken:
        day += timedelta(days=1)
    return day.isoformat()


def sql_quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def schedule_to_sql(schedule: dict, timezone: str) -> str:
    """Idempotent upserts. Safe to run more than once for the same puzzle_date."""
    lines = [
        "-- Wordelate puzzle schedule.",
        "-- Idempotent on puzzle_date. Does not deploy.",
        "--",
        "-- Local:",
        "--   wrangler d1 execute <database-name> --local --file puzzles/load.sql",
        "-- Remote (explicit; this script never runs --remote by itself):",
        "--   wrangler d1 execute <database-name> --remote --file puzzles/load.sql",
        f"-- Timezone for puzzle_date: {timezone}",
        "",
    ]
    puzzles = schedule.get("puzzles", [])
    if not puzzles:
        lines.append("-- No approved puzzles yet. puzzles/schedule.json is empty.")
        lines.append("")
        return "\n".join(lines)
    for row in puzzles:
        banned = row.get("banned", row.get("banned_json", []))
        solution = row.get("solution", row.get("solution_json", []))
        if isinstance(banned, str):
            banned_json = banned
        else:
            banned_json = json.dumps(banned, separators=(",", ":"), ensure_ascii=True)
        if isinstance(solution, str):
            solution_json = solution
        else:
            solution_json = json.dumps(solution, separators=(",", ":"), ensure_ascii=True)
        created = row.get("created_at") or datetime.now(ZoneInfo(timezone)).isoformat(timespec="seconds")
        lines.append(
            "INSERT INTO puzzles (\n"
            "  puzzle_date, start_word, goal_word, threshold, par, max_moves,\n"
            "  banned_json, solution_json, vocab_hash, created_at\n"
            ") VALUES (\n"
            f"  {sql_quote(row['puzzle_date'])}, {sql_quote(row['start_word'])}, "
            f"{sql_quote(row['goal_word'])}, {float(row['threshold'])}, {int(row['par'])}, "
            f"{int(row['max_moves'])},\n"
            f"  {sql_quote(banned_json)}, {sql_quote(solution_json)}, "
            f"{sql_quote(row['vocab_hash'])}, {sql_quote(created)}\n"
            ")\n"
            "ON CONFLICT(puzzle_date) DO UPDATE SET\n"
            "  start_word = excluded.start_word,\n"
            "  goal_word = excluded.goal_word,\n"
            "  threshold = excluded.threshold,\n"
            "  par = excluded.par,\n"
            "  max_moves = excluded.max_moves,\n"
            "  banned_json = excluded.banned_json,\n"
            "  solution_json = excluded.solution_json,\n"
            "  vocab_hash = excluded.vocab_hash,\n"
            "  created_at = excluded.created_at;"
        )
        lines.append("")
    return "\n".join(lines)
