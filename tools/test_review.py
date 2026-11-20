"""Schedule approval, including the bias-seen requirement."""

from __future__ import annotations

import json

import pytest

from wordelate.schedule import next_free_date, schedule_to_sql


def _candidate_file(path, rows):
    path.write_text(
        json.dumps(
            {
                "vocab_hash": "abc123",
                "fixture": True,
                "candidates": rows,
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def _row(identifier, start, goal, bias=False):
    return {
        "id": identifier,
        "start": start,
        "goal": goal,
        "direct_cosine": 0.2,
        "par": 2,
        "best_cosine": 0.7,
        "threshold": 0.67,
        "easy": False,
        "solution": ["-aaa", "+bbb"],
        "equation": f"{start} - aaa + bbb -> {goal}",
        "banned": [start, goal],
        "bias_review": bias,
        "bias_tags": [{"word": start, "categories": ["gender"]}] if bias else [],
        "status": "pending",
    }


def test_approve_unflagged_uses_next_free_date(tmp_path):
    import review_puzzles

    candidates = tmp_path / "candidates.json"
    schedule = tmp_path / "schedule.json"
    _candidate_file(candidates, [_row("c01", "river", "stone")])
    schedule.write_text('{"puzzles": []}\n', encoding="utf-8")
    entry = review_puzzles.approve(
        "c01",
        seen_bias=False,
        date="2026-11-20",
        candidates_path=candidates,
        schedule_path=schedule,
    )
    assert entry["puzzle_date"] == "2026-11-20"
    assert entry["max_moves"] == 16
    assert entry["bias_flagged"] is False
    assert entry["bias_seen"] is False
    saved = json.loads(schedule.read_text(encoding="utf-8"))
    assert saved["puzzles"][0]["solution"] == ["-aaa", "+bbb"]
    assert json.loads(candidates.read_text(encoding="utf-8"))["candidates"][0]["status"] == "approved"


def test_flagged_approve_requires_seen_bias(tmp_path):
    import review_puzzles

    candidates = tmp_path / "candidates.json"
    schedule = tmp_path / "schedule.json"
    _candidate_file(candidates, [_row("c01", "king", "queen", bias=True)])
    schedule.write_text('{"puzzles": []}\n', encoding="utf-8")
    with pytest.raises(SystemExit, match="seen-bias"):
        review_puzzles.approve(
            "c01",
            seen_bias=False,
            candidates_path=candidates,
            schedule_path=schedule,
        )
    assert json.loads(schedule.read_text(encoding="utf-8"))["puzzles"] == []
    entry = review_puzzles.approve(
        "c01",
        seen_bias=True,
        date="2026-12-01",
        candidates_path=candidates,
        schedule_path=schedule,
    )
    assert entry["bias_seen"] is True
    assert entry["bias_categories"] == ["gender"]


def test_approve_all_skips_flagged(tmp_path):
    import review_puzzles

    candidates = tmp_path / "candidates.json"
    schedule = tmp_path / "schedule.json"
    _candidate_file(
        candidates,
        [
            _row("c01", "king", "queen", bias=True),
            _row("c02", "river", "stone"),
        ],
    )
    schedule.write_text('{"puzzles": []}\n', encoding="utf-8")
    notes = review_puzzles.approve_all(candidates_path=candidates, schedule_path=schedule)
    assert any("skipped c01" in note for note in notes)
    saved = json.loads(schedule.read_text(encoding="utf-8"))
    assert [row["candidate_id"] for row in saved["puzzles"]] == ["c02"]
    assert saved["puzzles"][0]["puzzle_date"]


def test_next_free_date_skips_taken_days():
    schedule = {"puzzles": [{"puzzle_date": "2026-11-19"}, {"puzzle_date": "2026-11-20"}]}
    from datetime import date

    assert next_free_date(schedule, "America/New_York", today=date(2026, 11, 19)) == "2026-11-21"


def test_sql_is_idempotent_and_quotes():
    sql = schedule_to_sql(
        {
            "puzzles": [
                {
                    "puzzle_date": "2026-11-20",
                    "start_word": "river",
                    "goal_word": "stone",
                    "threshold": 0.67,
                    "par": 2,
                    "max_moves": 16,
                    "banned": ["rivers"],
                    "solution": ["-water", "+rock"],
                    "vocab_hash": "abc",
                    "created_at": "2026-11-19T20:00:00-05:00",
                }
            ]
        },
        "America/New_York",
    )
    assert "ON CONFLICT(puzzle_date) DO UPDATE" in sql
    assert "'2026-11-20'" in sql
    assert "wrangler d1 execute" in sql
