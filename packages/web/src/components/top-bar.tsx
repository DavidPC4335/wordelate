import { useEffect, useRef, useState } from "preact/hooks";
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
  onPlayTest?: (start: string, goal: string) => string | null;
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
        {onAdmin && onPlayTest ? <AdminMenu onPlayTest={onPlayTest} onOpen={onAdmin} /> : null}
        <AccountButton />
      </div>
    </header>
  );
}

/** Admin tools in the header. Hidden unless the server says this account is an admin. */
function AdminMenu({
  onPlayTest,
  onOpen,
}: {
  onPlayTest: (start: string, goal: string) => string | null;
  onOpen: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState("");
  const [goal, setGoal] = useState("");
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (box.current && event.target instanceof Node && !box.current.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div class="admin-wrap" ref={box}>
      <button
        type="button"
        class="admin-link"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        Admin
      </button>
      {open ? (
        <div class="popover admin-pop" role="dialog" aria-label="Admin">
          <form
            class="admin-menu"
            onSubmit={(event) => {
              event.preventDefault();
              const message = onPlayTest(start, goal);
              setError(message);
              if (message === null) {
                setStart("");
                setGoal("");
                setOpen(false);
              }
            }}
          >
            <h3 class="pop-title">Playtest</h3>
            <p class="pop-text">Try any two words. Nothing is saved, and it stays off the board.</p>
            <label class="field">
              <span class="field-label">Start</span>
              <input
                class="field-input"
                value={start}
                autoCapitalize="none"
                autoComplete="off"
                spellcheck={false}
                placeholder="paris"
                onInput={(event) => setStart(event.currentTarget.value)}
              />
            </label>
            <label class="field">
              <span class="field-label">Goal</span>
              <input
                class="field-input"
                value={goal}
                autoCapitalize="none"
                autoComplete="off"
                spellcheck={false}
                placeholder="sushi"
                onInput={(event) => setGoal(event.currentTarget.value)}
              />
            </label>
            <button type="submit" class="btn btn-small btn-go" disabled={start.trim() === "" || goal.trim() === ""}>
              Play
            </button>
            {error ? (
              <p class="move-error" role="alert">
                {error}
              </p>
            ) : null}
          </form>
          <button
            type="button"
            class="btn btn-small btn-ghost"
            onClick={() => {
              setOpen(false);
              onOpen();
            }}
          >
            Open admin menu
          </button>
        </div>
      ) : null}
    </div>
  );
}
