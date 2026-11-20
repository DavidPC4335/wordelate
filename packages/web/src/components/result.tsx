export function Result({
  won,
  gaveUp,
  revealed,
  outOfMoves,
  solution,
  onGiveUp,
  onShare,
  shareNote,
}: {
  won: boolean;
  gaveUp: boolean;
  revealed: boolean;
  outOfMoves: boolean;
  solution: string | null;
  onGiveUp: () => void;
  onShare: () => void;
  shareNote: string | null;
}) {
  const showSolution = gaveUp || revealed;
  return (
    <section class="result" aria-live="polite">
      {!won && outOfMoves ? <p class="result-note">No moves left.</p> : null}
      {gaveUp && !won ? <p class="result-note">Given up.</p> : null}
      {showSolution && solution ? <p class="solution">Known solution: {solution}</p> : null}
      {showSolution && !solution ? <p class="solution">No known solution for this pair.</p> : null}
      <div class="result-actions">
        {!won && !gaveUp ? (
          <button type="button" class="text-button" onClick={onGiveUp}>
            Give up
          </button>
        ) : null}
        <button type="button" class="text-button text-button-strong" onClick={onShare}>
          Share
        </button>
      </div>
      {shareNote ? <p class="share-note">{shareNote}</p> : null}
    </section>
  );
}
