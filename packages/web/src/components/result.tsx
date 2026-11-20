import { useEffect, useState } from "preact/hooks";
import { ArrowIcon, ShareIcon } from "./icons.js";

/**
 * What sits under the move box. While playing it holds a careful Give up.
 * After a win it offers the next puzzle. After a loss it offers another try.
 */
export function Result({
  won,
  gaveUp,
  revealed,
  outOfMoves,
  solution,
  hasNext,
  onGiveUp,
  onNext,
  onRetry,
  onShare,
  shareNote,
}: {
  won: boolean;
  gaveUp: boolean;
  revealed: boolean;
  outOfMoves: boolean;
  solution: string | null;
  hasNext: boolean;
  onGiveUp: () => void;
  onNext: () => void;
  onRetry: () => void;
  onShare: () => void;
  shareNote: string | null;
}) {
  const [sure, setSure] = useState(false);
  const finished = won || gaveUp || outOfMoves;
  const showSolution = gaveUp || revealed || (outOfMoves && !won);

  useEffect(() => {
    if (finished) setSure(false);
  }, [finished]);

  return (
    <section class="result" aria-live="polite">
      {!won && outOfMoves && !gaveUp ? <p class="result-note">Out of moves. So close!</p> : null}
      {gaveUp && !won ? <p class="result-note">No worries. Here is one way to do it.</p> : null}
      {showSolution && solution ? (
        <p class="solution">
          <span class="solution-label">One solution</span>
          {solution}
        </p>
      ) : null}
      {showSolution && !solution ? <p class="solution">No known solution for this pair.</p> : null}

      <div class="result-actions">
        {finished ? (
          <>
            {won ? (
              <button type="button" class="btn btn-go" onClick={onNext} disabled={!hasNext}>
                Next puzzle
                <ArrowIcon size={20} />
              </button>
            ) : (
              <button type="button" class="btn btn-go" onClick={onRetry}>
                Try again
              </button>
            )}
            {won ? null : hasNext ? (
              <button type="button" class="btn btn-ghost" onClick={onNext}>
                Skip to next
              </button>
            ) : null}
            <button type="button" class="btn btn-ghost" onClick={onShare}>
              <ShareIcon size={18} />
              Share
            </button>
          </>
        ) : sure ? (
          <>
            <span class="confirm-text">Show the answer?</span>
            <button
              type="button"
              class="btn btn-small btn-danger"
              onClick={() => {
                setSure(false);
                onGiveUp();
              }}
            >
              Yes, show me
            </button>
            <button type="button" class="btn btn-small btn-ghost" onClick={() => setSure(false)}>
              Keep going
            </button>
          </>
        ) : (
          <>
            <button type="button" class="text-button" onClick={() => setSure(true)}>
              Give up
            </button>
            <button type="button" class="text-button" onClick={onShare}>
              Share
            </button>
          </>
        )}
      </div>
      {shareNote ? <p class="share-note">{shareNote}</p> : null}
    </section>
  );
}
