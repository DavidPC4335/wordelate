import { useEffect, useRef } from "preact/hooks";
import type { AppliedStep } from "../lib/game.js";

/** The player's sum as chips: green to add, pink to take away. Scrolls to the newest. */
export function Equation({
  start,
  steps,
  hint = "Add or subtract a word to begin",
}: {
  start: string;
  steps: readonly AppliedStep[];
  /** Shown when there are no steps yet. Null hides it. */
  hint?: string | null;
}) {
  const ref = useRef<HTMLOListElement>(null);
  const count = steps.length;

  useEffect(() => {
    const list = ref.current;
    if (list) list.scrollLeft = list.scrollWidth;
  }, [count]);

  return (
    <ol class="equation" ref={ref} aria-label="Your equation">
      <li class="chip chip-start">{start}</li>
      {steps.map((step, index) => (
        <li
          class={step.op === "+" ? "chip chip-add" : "chip chip-sub"}
          key={`${step.op}${step.word}${index}`}
        >
          <span class="chip-op" aria-label={step.op === "+" ? "plus" : "minus"}>
            {step.op === "+" ? "+" : "−"}
          </span>
          {step.word}
        </li>
      ))}
      {count === 0 && hint ? <li class="chip chip-hint">{hint}</li> : null}
    </ol>
  );
}
