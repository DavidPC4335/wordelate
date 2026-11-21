import { AccountButton } from "./account-popover.js";
import { ArrowIcon, BoardIcon, FlameIcon, HelpIcon, StarIcon } from "./icons.js";

/** The question. Always in the header so the player never loses track of the goal. */
function Question({ start, goal }: { start: string; goal: string }) {
  return (
    <h2 class="question" aria-label={`Get from ${start} to ${goal}`}>
      <span class="q-word q-start">{start}</span>
      <ArrowIcon class="q-arrow" size={22} />
      <span class="q-word q-goal">{goal}</span>
    </h2>
  );
}

export function TopBar({
  start,
  goal,
  streak,
  points,
  onRewards,
  onBoard,
  onHelp,
  onPlayTest,
  onAdmin,
}: {
  start: string | null;
  goal: string | null;
  streak: number;
  points: number;
  onRewards: () => void;
  onBoard: () => void;
  onHelp: () => void;
  /** Present only for an account the server says is an admin. Starts a pair without saving a score. */
  onPlayTest?: (start: string, goal: string, threshold: number) => string | null;
  /** Present only for an account the server says is an admin. Opens the admin page. */
  onAdmin?: () => void;
}) {
  return (
    <header class="topbar">
      <h1 class="brand">
        <img class="brand-logo" src="/brand/wordmark.png" alt="Wordelate" />
      </h1>
      {start && goal ? <Question start={start} goal={goal} /> : <span class="question-gap" />}
      <div class="tools">
        <button
          type="button"
          class={streak > 0 ? "pill pill-streak" : "pill pill-streak pill-off"}
          onClick={onRewards}
          aria-label={`Day streak ${streak}. Open rewards`}
        >
          <FlameIcon size={18} />
          <span>{streak}</span>
        </button>
        <button
          type="button"
          class="pill pill-points"
          onClick={onRewards}
          aria-label={`${points} points. Open rewards`}
        >
          <StarIcon size={18} />
          <span>{points}</span>
        </button>
        <button type="button" class="icon-btn" onClick={onBoard} aria-label="Today's board" title="Today's board">
          <BoardIcon size={20} />
        </button>
        <button type="button" class="icon-btn" onClick={onHelp} aria-label="How to play" title="How to play">
          <HelpIcon size={20} />
        </button>
        <AccountButton onPlayTest={onPlayTest} onAdmin={onAdmin} />
      </div>
    </header>
  );
}
