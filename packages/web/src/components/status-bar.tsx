export function StatusBar({
  movesUsed,
  maxMoves,
  par,
}: {
  movesUsed: number;
  maxMoves: number;
  par: number | null;
}) {
  return (
    <p class="status">
      <span>
        {movesUsed} of {maxMoves} moves
      </span>
      {par != null && par > 0 ? <span>Par {par}</span> : null}
    </p>
  );
}
