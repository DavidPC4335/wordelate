export function StatusBar({
  movesUsed,
  maxMoves,
  par,
}: {
  movesUsed: number;
  maxMoves: number;
  par: number;
}) {
  return (
    <p class="status">
      <span>
        {movesUsed} of {maxMoves} moves
      </span>
      <span>Par {par}</span>
    </p>
  );
}
