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
}: {
  open: boolean;
  puzzles: readonly Puzzle[];
  currentId: string;
  onSelect: (id: string) => void;
  onReset: () => void;
  onReveal: () => void;
  onHide: () => void;
}) {
  if (!open) return null;
  return (
    <div id="admin-panel" class="admin-panel">
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
