import { useEffect, useId, useRef, useState } from "preact/hooks";
import { ANONYMOUS, TOP_SIZE, bellPoint, curveMarker } from "../lib/standings.js";
import type { BoardEntry, BoardSnapshot } from "../lib/standings.js";
import { ArrowIcon, CheckIcon, StarIcon, TrophyIcon } from "./icons.js";

type You = NonNullable<BoardSnapshot["you"]>;
type NameHandler = (name: string) => Promise<string | null>;

const CURVE_FLOOR = 92;

function bellPath(): string {
  let d = "";
  for (let i = 0; i <= 60; i++) {
    const { x, y } = bellPoint(-3 + (6 * i) / 60);
    d += `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return d;
}

const BELL = bellPath();

/** The part of the bell to the left of the marker: the players you beat. */
function beatPath(markerX: number, markerY: number): string {
  let d = "";
  for (let i = 0; i <= 60; i++) {
    const { x, y } = bellPoint(-3 + (6 * i) / 60);
    if (x > markerX) break;
    d += `${d ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  const mx = markerX.toFixed(1);
  return `${d} L${mx} ${markerY.toFixed(1)} L${mx} ${CURVE_FLOOR} L8 ${CURVE_FLOOR} Z`;
}

export function ScoreCurve({ betterThan, today = true }: { betterThan: number; today?: boolean }) {
  const { x, y } = curveMarker(betterThan);
  const whose = today ? "today's" : "that day's";
  return (
    <svg class="curve" viewBox="0 0 320 108" role="img" aria-label={`Better than ${betterThan} percent of ${whose} players`}>
      <path d={`${BELL} L312 ${CURVE_FLOOR} L8 ${CURVE_FLOOR} Z`} class="curve-fill" />
      <path d={beatPath(x, y)} class="curve-beat" />
      <path d={BELL} class="curve-line" />
      <line x1="8" y1={CURVE_FLOOR} x2="312" y2={CURVE_FLOOR} class="curve-floor" />
      <line x1={x} y1={y} x2={x} y2={CURVE_FLOOR} class="curve-mark" />
      <circle cx={x} cy={y} r="7" class="curve-ring" />
      <circle cx={x} cy={y} r="7" class="curve-dot" />
    </svg>
  );
}

export function StandingsView({
  snapshot,
  state,
  onName,
  today = true,
  onRetry,
}: {
  snapshot: BoardSnapshot | null;
  state: "loading" | "ready" | "off" | "error";
  onName?: NameHandler;
  /** False for a past day: the wording changes and no name can be added. */
  today?: boolean;
  onRetry?: () => void;
}) {
  if (state === "off") return null;
  if (state === "loading") return <BoardSkeleton />;
  if (state === "error" || !snapshot) return <BoardError onRetry={onRetry} />;
  return (
    <section class="board" aria-label={today ? "Today's board" : "Board for that day"}>
      {snapshot.total === 0 ? (
        <BoardEmpty today={today} />
      ) : (
        <>
          <YourStanding snapshot={snapshot} onName={onName} today={today} />
          <TopList snapshot={snapshot} />
        </>
      )}
    </section>
  );
}

function BoardSkeleton() {
  return (
    <div class="board-skel" role="status" aria-label="Loading the board">
      <div class="skel skel-curve" />
      <div class="skel skel-line" />
      {[0, 1, 2].map((index) => (
        <div class="skel skel-row" key={index} />
      ))}
    </div>
  );
}

function BoardError({ onRetry }: { onRetry?: () => void }) {
  return (
    <div class="board-empty board-empty-error" role="alert">
      <span class="board-empty-icon" aria-hidden="true">
        <TrophyIcon size={34} />
      </span>
      <p class="board-empty-title">The board did not load</p>
      <p class="board-empty-sub">Check your connection and give it another go.</p>
      {onRetry ? (
        <button type="button" class="btn btn-small" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

function BoardEmpty({ today }: { today: boolean }) {
  return (
    <div class="board-empty">
      <span class="board-empty-icon" aria-hidden="true">
        <TrophyIcon size={34} />
      </span>
      <p class="board-empty-title">{today ? "No scores yet today" : "Nobody scored this day"}</p>
      <p class="board-empty-sub">
        {today ? "Solve the puzzle and take the first spot on the board." : "Nothing was posted on this day."}
      </p>
    </div>
  );
}

function YourStanding({
  snapshot,
  onName,
  today,
}: {
  snapshot: BoardSnapshot;
  onName?: NameHandler;
  today: boolean;
}) {
  const you = snapshot.you;
  if (!you) {
    return (
      <p class="board-hint">
        {today ? "Solve today's puzzle to join the board." : "You did not post a score on this day."}
      </p>
    );
  }
  const onBoard = you.rank <= TOP_SIZE;
  return (
    <>
      {onBoard ? <Cheer you={you} today={today} onName={onName} /> : null}
      {you.total > 1 ? <StandCard you={you} held={Boolean(snapshot.submitted && !snapshot.submitted.counted)} today={today} /> : null}
    </>
  );
}

function StandCard({ you, held, today }: { you: You; held: boolean; today: boolean }) {
  const whose = today ? "today's" : "that day's";
  return (
    <div class="board-stand">
      <div class="stand-head">
        <div class="stand-score">
          <span class="stand-label">{today ? "Your score" : "Your score that day"}</span>
          <strong>
            <StarIcon size={20} />
            {you.score}
          </strong>
        </div>
        <div class="stand-rank">
          <span class="stand-label">Rank</span>
          <strong>
            #{you.rank}
            <small> of {you.total}</small>
          </strong>
        </div>
      </div>
      <ScoreCurve betterThan={you.betterThan} today={today} />
      <div class="curve-scale" aria-hidden="true">
        <span>Lower scores</span>
        <span>Higher scores</span>
      </div>
      <p class="board-percent">
        Better than {you.betterThan}% of {whose} players
      </p>
      {held ? <p class="board-note">Your best {today ? "today" : "that day"} is still {you.score}.</p> : null}
    </div>
  );
}

const SPARKS = [
  { x: "9%", y: "16%", d: "0s", s: 18 },
  { x: "86%", y: "12%", d: "0.5s", s: 22 },
  { x: "4%", y: "58%", d: "1.1s", s: 14 },
  { x: "93%", y: "54%", d: "0.8s", s: 16 },
  { x: "22%", y: "6%", d: "1.5s", s: 12 },
  { x: "74%", y: "84%", d: "0.3s", s: 14 },
];

function medalClass(rank: number): string {
  return rank <= 3 ? `medal medal-${rank}` : "medal";
}

function Cheer({ you, today, onName }: { you: You; today: boolean; onName?: NameHandler }) {
  const fieldId = useId();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const askName = you.nameEligible && !you.named && onName != null;
  const card = useRef<HTMLElement>(null);
  // The board arrives after the dialog opens. Bring the name prompt into view so it is not missed.
  useEffect(() => {
    if (!askName) return;
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => {
      card.current?.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [askName]);
  const when = today ? "today" : "that day";
  const title = you.rank === 1 ? "You're #1 on the leaderboard!" : "You made the leaderboard!";
  const standing =
    you.total <= 1
      ? `You're the first score ${when}.`
      : `#${you.rank} of ${you.total} players ${when}.`;
  return (
    <section ref={card} class={askName ? "board-cheer board-cheer-ask" : "board-cheer"} aria-label="You made the leaderboard">
      {SPARKS.map((spark) => (
        <span
          class="cheer-spark"
          aria-hidden="true"
          key={`${spark.x}-${spark.y}`}
          style={{ "--x": spark.x, "--y": spark.y, "--d": spark.d }}
        >
          <StarIcon size={spark.s} />
        </span>
      ))}
      <span class={`${medalClass(you.rank)} medal-lg`} aria-hidden="true">
        {you.rank}
      </span>
      <h3 class="cheer-title">{title}</h3>
      <p class="cheer-sub">
        {standing} Score {you.score}.
      </p>
      {askName ? (
        <form
          class="cheer-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (pending || !onName) return;
            setPending(true);
            setError(null);
            void onName(draft).then((message) => {
              setPending(false);
              setError(message);
            });
          }}
        >
          <label class="cheer-label" for={fieldId}>
            Put your name on the board
          </label>
          <div class="cheer-row">
            <input
              id={fieldId}
              class="cheer-input"
              placeholder="Your name"
              maxLength={24}
              autoComplete="nickname"
              spellcheck={false}
              value={draft}
              disabled={pending}
              onInput={(event) => setDraft(event.currentTarget.value)}
            />
            <button type="submit" class="btn btn-go cheer-btn" disabled={pending || draft.trim().length === 0}>
              {pending ? "Saving…" : "Add my name"}
            </button>
          </div>
          <p class="cheer-hint">
            Everyone can see it. Letters and numbers, up to 24. Skip it and you stay {ANONYMOUS}.
          </p>
          {error ? (
            <p class="cheer-error" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      ) : you.named ? (
        <p class="cheer-named">
          <CheckIcon size={16} />
          <span>
            On the board as <strong>{you.displayName}</strong>
          </span>
        </p>
      ) : null}
    </section>
  );
}

function TopList({ snapshot }: { snapshot: BoardSnapshot }) {
  if (snapshot.top.length === 0) return null;
  const mine = snapshot.you && snapshot.you.rank <= TOP_SIZE ? snapshot.you.rank : null;
  return (
    <div class="board-top">
      <div class="board-top-head">
        <h3 class="board-top-title">
          <TrophyIcon size={18} />
          Top scores
        </h3>
        <span class="board-count">
          {snapshot.total} {snapshot.total === 1 ? "player" : "players"}
        </span>
      </div>
      <ol class="board-list">
        {snapshot.top.map((entry, index) => (
          <Row entry={entry} index={index} mine={entry.rank === mine} key={`${entry.rank}-${entry.name}-${entry.answer}`} />
        ))}
      </ol>
    </div>
  );
}

function Row({ entry, index, mine }: { entry: BoardEntry; index: number; mine: boolean }) {
  const classes = ["board-row", entry.rank === 1 ? "board-row-1" : "", mine ? "board-row-you" : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <li class={classes} style={{ "--i": index }}>
      <span class={medalClass(entry.rank)}>{entry.rank}</span>
      <span class="board-main">
        <span class="board-who">
          <span class={entry.name === ANONYMOUS ? "board-who-name board-anon" : "board-who-name"}>
            {entry.name}
            {mine ? <span class="board-you-tag">You</span> : null}
          </span>
          <span class="board-score" aria-label={`${entry.score} points`}>
            <StarIcon size={14} />
            {entry.score}
          </span>
        </span>
        <span class="board-path" aria-label={entry.answer}>
          <span class="mini mini-start">{entry.start}</span>
          {entry.steps.map((step, stepIndex) => (
            <span class={step.op === "+" ? "mini mini-add" : "mini mini-sub"} key={stepIndex}>
              {step.op === "+" ? "+" : "−"} {step.word}
            </span>
          ))}
          <span class="mini-arrow" aria-hidden="true">
            <ArrowIcon size={14} />
          </span>
          <span class="mini mini-goal">{entry.goal}</span>
        </span>
        <span class="board-meta">
          {entry.moves} {entry.moves === 1 ? "move" : "moves"} · ahead of {entry.betterThan}% of players
        </span>
      </span>
    </li>
  );
}
