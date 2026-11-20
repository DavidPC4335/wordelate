import { StarIcon } from "./icons.js";

/**
 * One pip per move in the cap. Used pips fill, the pip at par wears a star,
 * and the points still on the table sit on the right.
 */
export function StatusBar({
  movesUsed,
  maxMoves,
  par,
  worth,
}: {
  movesUsed: number;
  maxMoves: number;
  par: number | null;
  /** Points a win on the very next move would bank. */
  worth: number;
}) {
  return (
    <div class="status">
      <div class="pips" role="img" aria-label={`${movesUsed} of ${maxMoves} moves used`}>
        {Array.from({ length: maxMoves }, (_, index) => {
          const used = index < movesUsed;
          const atPar = par != null && par > 0 && index === par - 1;
          const cls = used ? "pip pip-used" : "pip";
          return (
            <span class={atPar ? `${cls} pip-par` : cls} key={index}>
              {atPar ? <StarIcon size={9} /> : null}
            </span>
          );
        })}
      </div>
      <p class="status-text">
        <span>
          {movesUsed}/{maxMoves} moves
        </span>
        {par != null && par > 0 ? <span class="status-par">Par {par}</span> : null}
        <span class="status-worth">
          <StarIcon size={13} />
          {worth}
        </span>
      </p>
    </div>
  );
}
