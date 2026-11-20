import { formatPercent } from "../lib/game.js";

export function Meter({ progress, won }: { progress: number; won: boolean }) {
  const percent = formatPercent(progress);
  const fill = Math.min(100, Math.max(0, progress * 100));

  return (
    <div class={won ? "meter meter-won" : "meter"}>
      <div class="meter-readout">
        <span class="meter-value">{percent}%</span>
        <span class="meter-caption">toward the goal</span>
      </div>
      <div
        class="meter-track"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Number(percent)}
        aria-valuetext={`${percent}% toward the goal`}
      >
        <div class="meter-fill" style={{ width: `${fill}%` }} />
      </div>
    </div>
  );
}
