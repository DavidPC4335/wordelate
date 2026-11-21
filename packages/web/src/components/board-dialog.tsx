import { useEffect, useState } from "preact/hooks";
import { loadBoard, submitName } from "../lib/board-api.js";
import { dayParts } from "../lib/standings.js";
import type { BoardSnapshot } from "../lib/standings.js";
import type { Puzzle } from "../lib/puzzles.js";
import { ArrowIcon, TrophyIcon } from "./icons.js";
import { Modal } from "./modal.js";
import { StandingsView } from "./standings-view.js";

export type BoardDay = { day: string; puzzle: Puzzle };

export function BoardDialog({
  open,
  onClose,
  today,
  days,
  playingDay,
  onPlay,
}: {
  open: boolean;
  onClose: () => void;
  today: string;
  days: readonly BoardDay[];
  playingDay: string;
  onPlay: (day: string) => void;
}) {
  const [selected, setSelected] = useState(playingDay);
  const [snapshot, setSnapshot] = useState<BoardSnapshot | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (open) setSelected(playingDay);
  }, [open, playingDay]);

  useEffect(() => {
    if (!open) return;
    let cancel = false;
    setState("loading");
    void loadBoard(selected).then((next) => {
      if (cancel) return;
      setSnapshot(next);
      setState(next ? "ready" : "error");
    });
    return () => {
      cancel = true;
    };
  }, [open, selected, attempt]);

  const current = days.find((item) => item.day === selected) ?? null;
  const isToday = selected === today;
  const parts = dayParts(selected, today);

  return (
    <Modal open={open} onClose={onClose} label="Daily board">
      <div class="panel board-panel">
        <h2 class="panel-title">
          <TrophyIcon size={28} />
          Leaderboard
        </h2>
        <p class="board-sub">Top scores from the last week. Pick a day to see how it went.</p>

        <div class="day-strip" role="tablist" aria-label="Days on the board">
          {days.map((item) => {
            const label = dayParts(item.day, today);
            const on = item.day === selected;
            return (
              <button
                key={item.day}
                type="button"
                class={on ? "day-pill day-pill-on" : "day-pill"}
                role="tab"
                aria-selected={on}
                aria-label={label.long}
                onClick={() => setSelected(item.day)}
              >
                <span class="day-pill-top">{label.top}</span>
                <span class="day-pill-num">{label.num}</span>
              </button>
            );
          })}
        </div>

        {current ? (
          <div class={isToday ? "board-day" : "board-day board-day-past"}>
            <div class="board-day-text">
              <span class="board-day-label">{isToday ? "Today's puzzle" : parts.long}</span>
              <span class="board-day-pair">
                <span class="pair-chip pair-start">{current.puzzle.start}</span>
                <ArrowIcon size={16} />
                <span class="pair-chip pair-goal">{current.puzzle.goal}</span>
              </span>
            </div>
            {selected !== playingDay ? (
              <button type="button" class="btn btn-go btn-small" onClick={() => onPlay(selected)}>
                {isToday ? "Back to today" : "Play this day"}
              </button>
            ) : (
              <span class="tag tag-now">Playing now</span>
            )}
          </div>
        ) : null}
        {!isToday ? <p class="board-practice">Practice only. Playing a past day never changes its board.</p> : null}

        <StandingsView
          snapshot={snapshot}
          state={state}
          today={isToday}
          onRefresh={() => {
            void loadBoard().then((fresh) => {
              if (fresh) setSnapshot(fresh);
            });
          }}
          onRetry={() => setAttempt((count) => count + 1)}
          onName={
            isToday
              ? async (name) => {
                  const result = await submitName(name);
                  if (result.snapshot) {
                    setSnapshot(result.snapshot);
                    setState("ready");
                  }
                  return result.error;
                }
              : undefined
          }
        />
      </div>
    </Modal>
  );
}
