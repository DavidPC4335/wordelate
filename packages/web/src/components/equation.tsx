import type { AppliedStep } from "../lib/game.js";

export function Equation({ start, steps }: { start: string; steps: readonly AppliedStep[] }) {
  return (
    <p class="equation">
      <span class="eq-word">{start}</span>
      {steps.map((step, index) => (
        <span class="eq-step" key={`${step.op}${step.word}${index}`}>
          <span class="eq-op">{step.op === "+" ? "+" : "−"}</span>
          <span class="eq-word">{step.word}</span>
        </span>
      ))}
    </p>
  );
}
