import { useMemo, useState } from "preact/hooks";
import { countsAsWin, formatEquation, formatPercent } from "../lib/game.js";
import type { Puzzle } from "../lib/puzzles.js";
import { ArrowIcon, CheckIcon, GearIcon, LockIcon, SearchIcon } from "./icons.js";
import { Modal } from "./modal.js";

export function Admin({
  open,
  onClose,
  puzzles,
  currentId,
  solvedIds,
  revealed,
  onSelect,
  onReset,
  onReveal,
  onHide,
  onPlay,
  lockedLooks,
  onUnlockLooks,
}: {
  open: boolean;
  onClose: () => void;
  puzzles: readonly Puzzle[];
  currentId: string;
  solvedIds: ReadonlySet<string>;
  revealed: boolean;
  onSelect: (id: string) => void;
  onReset: () => void;
  onReveal: () => void;
  onHide: () => void;
  /** Returns an error message, or null when the pair starts. */
  onPlay: (start: string, goal: string) => string | null;
  /** How many graph looks are still locked. */
  lockedLooks: number;
  onUnlockLooks: () => void;
}) {
  const [start, setStart] = useState("");
  const [goal, setGoal] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const current = puzzles.find((puzzle) => puzzle.id === currentId) ?? null;
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return puzzles;
    return puzzles.filter((puzzle) => `${puzzle.start} ${puzzle.goal}`.includes(needle));
  }, [puzzles, query]);

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
    <Modal open={open} onClose={onClose} label="Admin" variant="wide">
      <div class="panel admin">
        <h2 class="panel-title">
          <GearIcon size={26} />
          Admin
        </h2>
        <p class="panel-note">Tools for testing. Progress here is saved in this browser only.</p>

        <section class="admin-section" aria-labelledby="admin-custom">
          <h3 class="panel-sub" id="admin-custom">
            Play any pair
          </h3>
          <form class="custom-play" onSubmit={play}>
            <label class="field">
              <span class="field-label">Start word</span>
              <input
                class="field-input"
                value={start}
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect="off"
                spellcheck={false}
                placeholder="paris"
                onInput={(event) => setStart(event.currentTarget.value)}
              />
            </label>
            <ArrowIcon class="custom-arrow" size={20} />
            <label class="field">
              <span class="field-label">Goal word</span>
              <input
                class="field-input"
                value={goal}
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect="off"
                spellcheck={false}
                placeholder="sushi"
                onInput={(event) => setGoal(event.currentTarget.value)}
              />
            </label>
            <button type="submit" class="btn btn-go custom-submit" disabled={start.trim() === "" || goal.trim() === ""}>
              Play
            </button>
          </form>
          {error ? (
            <p class="move-error" role="alert">
              {error}
            </p>
          ) : null}
        </section>

        <section class="admin-section" aria-labelledby="admin-current">
          <h3 class="panel-sub" id="admin-current">
            This puzzle
          </h3>
          {current ? (
            <p class="admin-current">
              <strong>
                {current.start} <ArrowIcon size={14} /> {current.goal}
              </strong>
              <span>{formatEquation(current.start, current.solution)}</span>
            </p>
          ) : (
            <p class="admin-current">
              <span>A custom pair is in play.</span>
            </p>
          )}
          <div class="admin-actions">
            <button type="button" class="btn btn-small btn-ghost" onClick={onReset}>
              Reset puzzle
            </button>
            <button
              type="button"
              class="btn btn-small btn-ghost"
              onClick={revealed ? onHide : onReveal}
              aria-pressed={revealed}
            >
              {revealed ? "Hide solution" : "Reveal solution"}
            </button>
          </div>
        </section>

        <section class="admin-section" aria-labelledby="admin-looks">
          <h3 class="panel-sub" id="admin-looks">
            Graph looks
          </h3>
          <p class="panel-note">
            {lockedLooks === 0
              ? "Every look is unlocked. Pick one in your rewards."
              : `${lockedLooks} ${lockedLooks === 1 ? "look is" : "looks are"} still locked. Unlock them all to preview them.`}
          </p>
          <div class="admin-actions">
            <button type="button" class="btn btn-small" onClick={onUnlockLooks} disabled={lockedLooks === 0}>
              <LockIcon size={16} />
              Unlock all looks
            </button>
          </div>
        </section>

        <section class="admin-section admin-list-section" aria-labelledby="admin-all">
          <div class="admin-list-head">
            <h3 class="panel-sub" id="admin-all">
              All puzzles <span class="count">{shown.length === puzzles.length ? puzzles.length : `${shown.length} of ${puzzles.length}`}</span>
            </h3>
            <label class="search">
              <SearchIcon size={16} />
              <span class="sr-only">Filter puzzles</span>
              <input
                type="search"
                value={query}
                placeholder="Filter by word"
                autoComplete="off"
                spellcheck={false}
                onInput={(event) => setQuery(event.currentTarget.value)}
              />
            </label>
          </div>
          {shown.length === 0 ? <p class="panel-note">No puzzle matches “{query}”.</p> : null}
          <ol class="puzzle-list">
            {shown.map((puzzle) => {
              const wins = countsAsWin({
                similarity: puzzle.solutionSimilarity,
                hereWord: puzzle.here,
                goalWord: puzzle.goal,
                movesUsed: puzzle.solution.length,
                acceptedWords: puzzle.accepted,
              });
              const isCurrent = puzzle.id === currentId;
              const solved = solvedIds.has(puzzle.id);
              return (
                <li key={puzzle.id}>
                  <button
                    type="button"
                    class={isCurrent ? "puzzle current" : "puzzle"}
                    aria-current={isCurrent ? "true" : undefined}
                    onClick={() => onSelect(puzzle.id)}
                  >
                    <span class="puzzle-head">
                      <span class="puzzle-pair">
                        {puzzle.start} <ArrowIcon size={14} /> {puzzle.goal}
                      </span>
                      <span class="puzzle-tags">
                        {isCurrent ? <span class="tag tag-now">Playing</span> : null}
                        {solved ? (
                          <span class="tag tag-solved">
                            <CheckIcon size={12} /> Solved
                          </span>
                        ) : null}
                        <span class={wins ? "tag tag-win" : "tag tag-short"}>{wins ? "Win" : "Short"}</span>
                      </span>
                    </span>
                    <span class="puzzle-eq">{formatEquation(puzzle.start, puzzle.solution)}</span>
                    <span class="puzzle-meta">
                      {formatPercent(puzzle.solutionSimilarity)}% · lands on {puzzle.here}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      </div>
    </Modal>
  );
}
