import { useEffect, useState } from "preact/hooks";
import { ShareIcon } from "./icons.js";

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
  onGiveUp,
  onRetry,
  onShare,
}: {
  won: boolean;
  gaveUp: boolean;
  revealed: boolean;
  outOfMoves: boolean;
  solution: string | null;
  onGiveUp: () => void;
  onRetry: () => void;
  onShare: () => void;
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
            {won ? null : (
              <button type="button" class="btn btn-go" onClick={onRetry}>
                Try again
              </button>
            )}
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
    </section>
  );
}
