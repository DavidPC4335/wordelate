import { useEffect, useState } from "preact/hooks";
import { totalScore } from "../lib/storage.js";
import type { ScoreEntry } from "../lib/storage.js";

function puzzleLabel(id: string): string {
  const parts = id.split("-");
  const start = parts[0];
  const goal = parts[1];
  if (parts.length === 2 && start && goal && /^[a-z]+$/.test(start) && /^[a-z]+$/.test(goal)) {
    return `${start} → ${goal}`;
  }
  return id;
}

export function Scores({ entries }: { entries: readonly ScoreEntry[] }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const listed = [...entries].reverse();
  const total = totalScore(entries);

  return (
    <div class="scores">
      <button
        type="button"
        class="admin-toggle"
        aria-expanded={open}
        aria-controls="scores-panel"
        onClick={() => setOpen((value) => !value)}
      >
        Scores
      </button>
      {open ? (
        <div id="scores-panel" class="scores-panel" role="region" aria-label="Past scores">
          {listed.length === 0 ? <p class="scores-empty">No scores yet</p> : null}
          {listed.length > 0 ? (
            <div class="scores-scroll">
              <div class="scores-columns">
                <span>Puzzle</span>
                <span>Moves</span>
                <span>Points</span>
              </div>
              <ol class="scores-list">
                {listed.map((entry, index) => (
                  <li key={`${entry.day}:${entry.puzzleId}:${index}`} class="scores-row">
                    <span class="scores-puzzle">{puzzleLabel(entry.puzzleId)}</span>
                    <span class="scores-moves">{entry.moves}</span>
                    <span class="scores-points">{entry.score}</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
          <p class="scores-total">
            <span>Total</span>
            <span>{total}</span>
          </p>
        </div>
      ) : null}
    </div>
  );
}
