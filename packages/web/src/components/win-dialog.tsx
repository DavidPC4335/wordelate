import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { cosmeticFor, ratingFor } from "../lib/rewards.js";
import type { Cosmetic, CosmeticId, UnlockProgress } from "../lib/rewards.js";
import { ArrowIcon, FlameIcon, ShareIcon, StarIcon } from "./icons.js";
import { LookSwatch } from "./look-swatch.js";
import { Modal } from "./modal.js";

export type WinReport = {
  start: string;
  goal: string;
  moves: number;
  par: number | null;
  earned: number;
  totalPoints: number;
  streak: number;
  /** Looks this win unlocked. They are equipped already. */
  fresh: CosmeticId[];
  next: { cosmetic: Cosmetic; progress: UnlockProgress } | null;
};

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Counts up to `target` so a score lands with a little drumroll. */
function useCountUp(target: number, run: boolean): number {
  const [value, setValue] = useState(run && !prefersReducedMotion() ? 0 : target);
  useEffect(() => {
    if (!run || prefersReducedMotion()) {
      setValue(target);
      return;
    }
    let frame = 0;
    const began = performance.now();
    const length = 900;
    const tick = (now: number) => {
      const t = Math.min(1, (now - began) / length);
      setValue(Math.round(target * (1 - (1 - t) ** 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, run]);
  return value;
}

export function WinDialog({
  open,
  report,
  hasNext,
  shareNote,
  board,
  onNext,
  onShare,
  onClose,
}: {
  open: boolean;
  report: WinReport | null;
  hasNext: boolean;
  shareNote: string | null;
  board: ComponentChildren;
  onNext: () => void;
  onShare: () => void;
  onClose: () => void;
}) {
  const shown = useCountUp(report?.earned ?? 0, open);
  return (
    <Modal open={open && report != null} onClose={onClose} label="You solved it" hideClose>
      {report ? (
        <WinBody
          report={report}
          shown={shown}
          hasNext={hasNext}
          shareNote={shareNote}
          board={board}
          onNext={onNext}
          onShare={onShare}
          onClose={onClose}
        />
      ) : null}
    </Modal>
  );
}

function WinBody({
  report,
  shown,
  hasNext,
  shareNote,
  board,
  onNext,
  onShare,
  onClose,
}: {
  report: WinReport;
  shown: number;
  hasNext: boolean;
  shareNote: string | null;
  board: ComponentChildren;
  onNext: () => void;
  onShare: () => void;
  onClose: () => void;
}) {
  const rating = ratingFor(report.moves, report.par);
  const unlocked = report.fresh.map((id) => cosmeticFor(id));
  return (
    <div class="win">
      <div class="win-stars" role="img" aria-label={`${rating.stars} out of 3 stars`}>
        {[1, 2, 3].map((n) => (
          <span class={n <= rating.stars ? "win-star win-star-on" : "win-star"} style={{ ["--i"]: n }} key={n}>
            <StarIcon size={52} />
          </span>
        ))}
      </div>
      <h2 class="win-title">{rating.title}</h2>
      <p class="win-sub">
        <strong>{report.start}</strong> <ArrowIcon size={16} /> <strong>{report.goal}</strong> in{" "}
        {report.moves} {report.moves === 1 ? "move" : "moves"}
        {report.par ? ` (par ${report.par})` : ""}
      </p>

      <p class="win-points" aria-label={`${report.earned} points earned`}>
        <StarIcon size={30} />
        <span>+{shown}</span>
      </p>

      {board}

      <ul class="win-stats">
        <li>
          <span class="win-stat-num">{report.totalPoints}</span>
          <span class="win-stat-label">total points</span>
        </li>
        <li>
          <span class="win-stat-num win-flame">
            <FlameIcon size={22} />
            {report.streak}
          </span>
          <span class="win-stat-label">day streak</span>
        </li>
      </ul>

      {unlocked.length > 0 ? (
        <div class="win-unlock" role="status">
          <p class="win-unlock-head">New graph look unlocked!</p>
          {unlocked.map((item) => (
            <div class="win-unlock-card" key={item.id}>
              <LookSwatch cosmetic={item} />
              <div>
                <p class="win-unlock-name">{item.name}</p>
                <p class="win-unlock-note">Equipped. Switch any time in Rewards.</p>
              </div>
            </div>
          ))}
        </div>
      ) : report.next ? (
        <div class="win-next">
          <p class="win-next-head">
            Next look: <strong>{report.next.cosmetic.name}</strong>
          </p>
          <div class="bar" role="progressbar" aria-valuemin={0} aria-valuemax={report.next.progress.target} aria-valuenow={report.next.progress.current} aria-label={report.next.progress.goal}>
            <div class="bar-fill" style={{ width: `${Math.round(report.next.progress.ratio * 100)}%` }} />
          </div>
          <p class="win-next-note">
            {report.next.progress.goal}. {report.next.progress.remaining}.
          </p>
        </div>
      ) : (
        <p class="win-next-note win-all">Every graph look is yours. Nice work.</p>
      )}

      <div class="win-actions">
        <button type="button" class="btn btn-go" onClick={onNext} disabled={!hasNext}>
          Next puzzle
          <ArrowIcon size={20} />
        </button>
        <button type="button" class="btn btn-ghost" onClick={onShare}>
          <ShareIcon size={18} />
          Share
        </button>
        <button type="button" class="text-button" onClick={onClose}>
          Look at the graph
        </button>
      </div>
      {shareNote ? <p class="share-note">{shareNote}</p> : null}
    </div>
  );
}
