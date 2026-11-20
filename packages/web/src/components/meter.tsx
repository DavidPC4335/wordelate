import { useEffect, useRef, useState } from "preact/hooks";
import { formatPercent } from "../lib/game.js";
import { heatColor, heatLabel } from "../lib/rewards.js";

type Change = { id: number; points: number };

/**
 * How close you are. The fill shifts from blue to red as you warm up and turns
 * green on a win. Each move pops a "+8" or "-5" so progress is felt, not just read.
 * Mount it with a key per puzzle so a fresh board never shows a stale change.
 */
export function Meter({ progress, won }: { progress: number; won: boolean }) {
  const percent = formatPercent(progress);
  const fill = Math.min(100, Math.max(0, progress * 100));
  const previous = useRef(progress);
  const counter = useRef(0);
  const [change, setChange] = useState<Change | null>(null);

  useEffect(() => {
    const points = Math.round((progress - previous.current) * 100);
    previous.current = progress;
    if (points === 0) return;
    counter.current += 1;
    setChange({ id: counter.current, points });
  }, [progress]);

  const label = heatLabel(progress, won);
  const color = won ? "var(--add)" : heatColor(progress);

  return (
    <div class={won ? "meter meter-won" : "meter"} style={{ ["--heat"]: color }}>
      <div class="meter-readout">
        <span class="meter-label" aria-live="polite">
          {label}
        </span>
        <span class="meter-value">
          {percent}%
          {change ? (
            <span
              key={change.id}
              class={change.points > 0 ? "meter-change meter-up" : "meter-change meter-down"}
              aria-hidden="true"
            >
              {change.points > 0 ? `+${change.points}` : `−${Math.abs(change.points)}`}
            </span>
          ) : null}
        </span>
      </div>
      <div
        class="meter-track"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Number(percent)}
        aria-valuetext={`${percent}% toward the goal, ${label}`}
      >
        <div class="meter-fill" style={{ width: `${fill}%` }} />
      </div>
    </div>
  );
}
