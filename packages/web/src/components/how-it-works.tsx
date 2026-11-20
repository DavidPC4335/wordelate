export function HowItWorks() {
  return (
    <details class="how">
      <summary>How it works</summary>
      <p>
        Adding and subtracting word vectors moves you in meaning space. The bar starts at zero,
        where the puzzle begins, and fills as you close the gap to the goal. Landing on the goal
        fills the bar and draws the path onto the target. The large word on the latest point is
        the nearest meaning, not a grammatical neighbor of a word you already used.
      </p>
      <p class="how-credit">
        Word vectors are derived from ConceptNet Numberbatch 19.08 by the ConceptNet team, used
        under CC BY-SA 4.0.
      </p>
    </details>
  );
}
