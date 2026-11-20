import { useState } from "preact/hooks";
import { countsAsWin, formatEquation, formatPercent } from "../lib/game.js";
import type { Puzzle } from "../lib/puzzles.js";

export function Admin({
  open,
  puzzles,
  currentId,
  onSelect,
  onReset,
  onReveal,
  onHide,
  onPlay,
}: {
  open: boolean;
  puzzles: readonly Puzzle[];
  currentId: string;
  onSelect: (id: string) => void;
  onReset: () => void;
  onReveal: () => void;
  onHide: () => void;
  /** Returns an error message, or null when the pair starts. */
  onPlay: (start: string, goal: string) => string | null;
}) {
  const [start, setStart] = useState("");
  const [goal, setGoal] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!open) return null;

  function play(event: Event) {
    event.preventDefault();
    const message = onPlay(start, goal);
    setError(message);
    if (message === null) {
      setStart("");
      setGoal("");
    }
  }

  return (
    <div id="admin-panel" class="admin-panel">
      <form class="custom-play" onSubmit={play}>
        <label>
          Start
          <input
            value={start}
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            spellcheck={false}
            onInput={(event) => setStart(event.currentTarget.value)}
          />
        </label>
        <label>
          Goal
          <input
            value={goal}
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            spellcheck={false}
            onInput={(event) => setGoal(event.currentTarget.value)}
          />
        </label>
        <button type="submit" class="text-button text-button-strong">
          Play
        </button>
        {error ? <p class="move-error">{error}</p> : null}
      </form>
      <div class="admin-actions">
        <button type="button" class="text-button" onClick={onReset}>
          Reset puzzle
        </button>
        <button type="button" class="text-button" onClick={onReveal}>
          Reveal solution
        </button>
        <button type="button" class="text-button" onClick={onHide}>
          Hide solution
        </button>
      </div>
      <ol class="puzzle-list">
        {puzzles.map((puzzle) => {
          const wins = countsAsWin({
            similarity: puzzle.solutionSimilarity,
            hereWord: puzzle.here,
            goalWord: puzzle.goal,
            movesUsed: puzzle.solution.length,
            acceptedWords: puzzle.accepted,
          });
          const current = puzzle.id === currentId;
          return (
            <li key={puzzle.id}>
              <button
                type="button"
                class={current ? "puzzle current" : "puzzle"}
                onClick={() => onSelect(puzzle.id)}
              >
                <span class="puzzle-pair">
                  {puzzle.start} → {puzzle.goal}
                </span>
                <span class="puzzle-eq">{formatEquation(puzzle.start, puzzle.solution)}</span>
                <span class="puzzle-meta">
                  <span>
                    {formatPercent(puzzle.solutionSimilarity)}% · lands on {puzzle.here}
                  </span>
                  <span class={wins ? "badge badge-win" : "badge"}>{wins ? "Win" : "Short"}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
