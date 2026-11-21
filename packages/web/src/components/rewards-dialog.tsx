import { COSMETICS, isEarned, unlockProgress } from "../lib/rewards.js";
import type { CosmeticId, RewardStats } from "../lib/rewards.js";
import type { ScoreEntry } from "../lib/storage.js";
import { CheckIcon, FlameIcon, LockIcon, StarIcon, TrophyIcon } from "./icons.js";
import { LookSwatch } from "./look-swatch.js";
import { Modal } from "./modal.js";

function puzzleLabel(id: string): string {
  const parts = id.split("-");
  const start = parts[0];
  const goal = parts[1];
  if (parts.length === 2 && start && goal && /^[a-z]+$/.test(start) && /^[a-z]+$/.test(goal)) {
    return `${start} → ${goal}`;
  }
  return id;
}

export function RewardsDialog({
  open,
  onClose,
  stats,
  streak,
  scores,
  unlocked,
  equipped,
  onEquip,
}: {
  open: boolean;
  onClose: () => void;
  stats: RewardStats;
  streak: number;
  scores: readonly ScoreEntry[];
  unlocked: readonly CosmeticId[];
  equipped: CosmeticId;
  onEquip: (id: CosmeticId) => void;
}) {
  const recent = [...scores].reverse();
  return (
    <Modal open={open} onClose={onClose} label="Rewards" variant="wide">
      <div class="panel">
        <h2 class="panel-title">
          <TrophyIcon size={26} />
          Your rewards
        </h2>

        <ul class="stat-row">
          <li class="stat">
            <StarIcon size={22} />
            <span class="stat-num">{stats.totalPoints}</span>
            <span class="stat-label">points</span>
          </li>
          <li class="stat stat-flame">
            <FlameIcon size={22} />
            <span class="stat-num">{streak}</span>
            <span class="stat-label">day streak</span>
          </li>
          <li class="stat">
            <TrophyIcon size={22} />
            <span class="stat-num">{scores.length}</span>
            <span class="stat-label">{scores.length === 1 ? "win" : "wins"}</span>
          </li>
        </ul>

        <h3 class="panel-sub">Graph looks</h3>
        <p class="panel-note">Earn new looks for the graph with points and daily streaks.</p>
        <ul class="looks">
          {COSMETICS.map((item) => {
            const owned = unlocked.includes(item.id) || isEarned(item, stats);
            const progress = unlockProgress(item, stats);
            const active = equipped === item.id;
            return (
              <li class={active ? "look look-active" : owned ? "look" : "look look-locked"} key={item.id}>
                <div class="look-pic">
                  <LookSwatch cosmetic={item} locked={!owned} />
                  {!owned ? (
                    <span class="look-lock" aria-hidden="true">
                      <LockIcon size={22} />
                    </span>
                  ) : null}
                </div>
                <div class="look-info">
                  <p class="look-name">{item.name}</p>
                  <p class="look-blurb">{owned ? item.blurb : progress.goal}</p>
                  {!owned ? (
                    <>
                      <div
                        class="bar"
                        role="progressbar"
                        aria-label={`${item.name}: ${progress.goal}`}
                        aria-valuemin={0}
                        aria-valuemax={progress.target}
                        aria-valuenow={progress.current}
                      >
                        <div class="bar-fill" style={{ width: `${Math.round(progress.ratio * 100)}%` }} />
                      </div>
                      <p class="look-progress">
                        {progress.label} · {progress.remaining}
                      </p>
                    </>
                  ) : active ? (
                    <p class="look-state">
                      <CheckIcon size={16} /> Equipped
                    </p>
                  ) : (
                    <button type="button" class="btn btn-small" onClick={() => onEquip(item.id)}>
                      Equip
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        <h3 class="panel-sub">Recent wins</h3>
        {recent.length === 0 ? (
          <p class="panel-note">No wins yet. Solve a puzzle to start your history.</p>
        ) : (
          <ol class="wins">
            {recent.map((entry, index) => (
              <li class="win-row" key={`${entry.day}:${entry.puzzleId}:${index}`}>
                <span class="win-puzzle">{puzzleLabel(entry.puzzleId)}</span>
                <span class="win-moves">{entry.moves} {entry.moves === 1 ? "move" : "moves"}</span>
                <span class="win-pts">
                  <StarIcon size={13} />
                  {entry.score}
                </span>
              </li>
            ))}
          </ol>
        )}

      </div>
    </Modal>
  );
}
