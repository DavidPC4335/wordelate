#!/usr/bin/env python3
"""Review puzzle candidates and append approvals to puzzles/schedule.json.

Nothing is auto-approved. approve-all skips bias-flagged rows. A flagged row
enters the schedule only with an explicit approve that records the flag was seen.

Usage:
  python tools/review_puzzles.py list
  python tools/review_puzzles.py show c01
  python tools/review_puzzles.py approve c01 [--date YYYY-MM-DD] [--seen-bias]
  python tools/review_puzzles.py reject c01
  python tools/review_puzzles.py skip c01
  python tools/review_puzzles.py approve-all
  python tools/review_puzzles.py review
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent))

from wordelate.config import load_config
from wordelate.paths import CANDIDATES_PATH, SCHEDULE_PATH
from wordelate.schedule import load_schedule, next_free_date, save_schedule


def load_candidates(path: Path) -> dict:
    if not path.is_file():
        raise SystemExit(f"No candidates at {path}. Run tools/generate_puzzles.py first.")
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not isinstance(data.get("candidates"), list):
        raise SystemExit(f"{path} is not a candidate file")
    return data


def save_candidates(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def find_candidate(data: dict, identifier: str) -> dict:
    for row in data["candidates"]:
        if row["id"] == identifier:
            return row
    raise SystemExit(f"No candidate {identifier}")


def format_candidate(row: dict) -> str:
    tags = ", ".join(
        f"{hit['word']} ({'/'.join(hit['categories'])})" for hit in row.get("bias_tags", [])
    ) or "none"
    banned = row.get("banned", [])
    sample = ", ".join(banned[:12])
    if len(banned) > 12:
        sample += f", … ({len(banned)} total)"
    lines = [
        f"{row['id']}  {row.get('equation', row['start'] + ' -> ' + row['goal'])}",
        f"  par {row['par']}   threshold {row['threshold']:.2f}   "
        f"direct {row['direct_cosine']:.4f}   final {row['best_cosine']:.4f}",
        f"  easy: {'yes' if row.get('easy') else 'no'}   status: {row.get('status', 'pending')}",
        f"  bias: {tags}",
        f"  solution: {' '.join(row['solution'])}",
        f"  banned sample: {sample or 'none'}",
    ]
    return "\n".join(lines)


def _categories(row: dict) -> list[str]:
    found: list[str] = []
    for hit in row.get("bias_tags", []):
        for category in hit["categories"]:
            if category not in found:
                found.append(category)
    return found


def approve(
    identifier: str,
    *,
    seen_bias: bool = False,
    date: str | None = None,
    candidates_path: Path = CANDIDATES_PATH,
    schedule_path: Path = SCHEDULE_PATH,
) -> dict:
    cfg = load_config()
    data = load_candidates(candidates_path)
    row = find_candidate(data, identifier)
    status = row.get("status", "pending")
    if status == "approved":
        raise SystemExit(f"{identifier} is already approved")
    if status == "rejected":
        raise SystemExit(f"{identifier} was rejected")
    if row.get("bias_review") and not seen_bias:
        tags = ", ".join(_categories(row)) or "flagged"
        raise SystemExit(
            f"{identifier} is bias-flagged ({tags}). "
            "Re-run with --seen-bias to record that you reviewed the flag. "
            "Flagged rows are never auto-approved."
        )
    schedule = load_schedule(schedule_path)
    puzzle_date = date or next_free_date(schedule, cfg["timezone"])
    if puzzle_date in {item["puzzle_date"] for item in schedule["puzzles"]}:
        raise SystemExit(f"{puzzle_date} is already on the schedule")
    # Validate the override by parsing it through the same helper.
    if date is not None:
        from wordelate.schedule import _parse_date

        _parse_date(date)
    entry = {
        "puzzle_date": puzzle_date,
        "start_word": row["start"],
        "goal_word": row["goal"],
        "threshold": row["threshold"],
        "par": row["par"],
        "max_moves": int(cfg["maxMoves"]),
        "banned": row["banned"],
        "solution": row["solution"],
        "vocab_hash": data["vocab_hash"],
        "easy": bool(row.get("easy", False)),
        "bias_flagged": bool(row.get("bias_review", False)),
        "bias_categories": _categories(row),
        "bias_seen": bool(row.get("bias_review", False) and seen_bias),
        "candidate_id": row["id"],
        "direct_cosine": row["direct_cosine"],
        "best_cosine": row["best_cosine"],
        "created_at": datetime.now(ZoneInfo(cfg["timezone"])).isoformat(timespec="seconds"),
    }
    schedule["puzzles"].append(entry)
    save_schedule(schedule_path, schedule)
    row["status"] = "approved"
    row["puzzle_date"] = puzzle_date
    if row.get("bias_review"):
        row["bias_seen"] = True
    save_candidates(candidates_path, data)
    return entry


def set_status(
    identifier: str,
    status: str,
    *,
    candidates_path: Path = CANDIDATES_PATH,
) -> dict:
    data = load_candidates(candidates_path)
    row = find_candidate(data, identifier)
    if row.get("status") == "approved":
        raise SystemExit(f"{identifier} is already approved")
    row["status"] = status
    save_candidates(candidates_path, data)
    return row


def approve_all(
    *,
    candidates_path: Path = CANDIDATES_PATH,
    schedule_path: Path = SCHEDULE_PATH,
) -> list[str]:
    """Approve every pending unflagged candidate. Skip bias-flagged rows."""
    data = load_candidates(candidates_path)
    notes: list[str] = []
    for row in data["candidates"]:
        status = row.get("status", "pending")
        if status not in ("pending", "skipped"):
            continue
        if row.get("bias_review"):
            notes.append(f"skipped {row['id']} (bias-flagged)")
            continue
        entry = approve(row["id"], seen_bias=False, candidates_path=candidates_path, schedule_path=schedule_path)
        notes.append(f"approved {row['id']} as {entry['puzzle_date']}")
    return notes


def cmd_list(data: dict, show_all: bool) -> None:
    rows = data["candidates"]
    if not show_all:
        rows = [row for row in rows if row.get("status", "pending") in ("pending", "skipped")]
    if not rows:
        print("No candidates to show.")
        return
    for row in rows:
        print(format_candidate(row))
        print()


def cmd_review(data: dict, candidates_path: Path, schedule_path: Path) -> None:
    if not sys.stdin.isatty():
        raise SystemExit("review is interactive. Use list / approve / reject / skip.")
    pending = [row for row in data["candidates"] if row.get("status", "pending") in ("pending", "skipped")]
    for row in pending:
        print(format_candidate(row))
        while True:
            try:
                choice = input("[a]pprove [r]eject [s]kip [q]uit: ").strip().lower()
            except EOFError:
                return
            if choice in ("q", "quit"):
                return
            if choice in ("s", "skip"):
                set_status(row["id"], "skipped", candidates_path=candidates_path)
                break
            if choice in ("r", "reject"):
                set_status(row["id"], "rejected", candidates_path=candidates_path)
                break
            if choice in ("a", "approve"):
                seen = False
                if row.get("bias_review"):
                    confirm = input("Bias-flagged. Type SEEN to approve: ").strip()
                    if confirm != "SEEN":
                        print("Not approved.")
                        continue
                    seen = True
                typed = input("Date YYYY-MM-DD (blank = next free day): ").strip()
                entry = approve(
                    row["id"],
                    seen_bias=seen,
                    date=typed or None,
                    candidates_path=candidates_path,
                    schedule_path=schedule_path,
                )
                print(f"Approved as {entry['puzzle_date']}")
                break
            print("Use a, r, s, or q.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Review Wordelate puzzle candidates.")
    sub = parser.add_subparsers(dest="command", required=True)

    list_cmd = sub.add_parser("list", help="Show pending candidates.")
    list_cmd.add_argument("--all", action="store_true")

    show_cmd = sub.add_parser("show", help="Show one candidate.")
    show_cmd.add_argument("id")

    approve_cmd = sub.add_parser("approve", help="Append one candidate to the schedule.")
    approve_cmd.add_argument("id")
    approve_cmd.add_argument("--date", help="YYYY-MM-DD. Default: next free day in America/New_York.")
    approve_cmd.add_argument(
        "--seen-bias",
        action="store_true",
        help="Record that a bias flag was reviewed. Required for flagged rows.",
    )

    reject_cmd = sub.add_parser("reject", help="Reject a candidate.")
    reject_cmd.add_argument("id")

    skip_cmd = sub.add_parser("skip", help="Defer a candidate.")
    skip_cmd.add_argument("id")

    sub.add_parser("approve-all", help="Approve every unflagged pending candidate. Skips bias flags.")
    sub.add_parser("review", help="Interactive one-at-a-time review.")

    args = parser.parse_args()
    if args.command == "list":
        cmd_list(load_candidates(CANDIDATES_PATH), args.all)
        return
    if args.command == "show":
        print(format_candidate(find_candidate(load_candidates(CANDIDATES_PATH), args.id)))
        return
    if args.command == "approve":
        entry = approve(args.id, seen_bias=args.seen_bias, date=args.date)
        print(f"Approved {args.id} as {entry['puzzle_date']}")
        return
    if args.command == "reject":
        set_status(args.id, "rejected")
        print(f"Rejected {args.id}")
        return
    if args.command == "skip":
        set_status(args.id, "skipped")
        print(f"Skipped {args.id}")
        return
    if args.command == "approve-all":
        notes = approve_all()
        print("\n".join(notes) if notes else "Nothing to approve.")
        return
    if args.command == "review":
        cmd_review(load_candidates(CANDIDATES_PATH), CANDIDATES_PATH, SCHEDULE_PATH)
        return
    raise SystemExit(f"unknown command {args.command}")


if __name__ == "__main__":
    main()
