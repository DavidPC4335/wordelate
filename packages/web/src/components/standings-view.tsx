import { useId, useState } from "preact/hooks";
import { normalZ } from "../lib/standings.js";
import type { BoardSnapshot } from "../lib/standings.js";

function bellPath(): string {
  const width = 320;
  const height = 108;
  const pad = 8;
  const minZ = -3;
  const maxZ = 3;
  let d = "";
  for (let i = 0; i <= 60; i++) {
    const z = minZ + ((maxZ - minZ) * i) / 60;
    const x = pad + ((z - minZ) / (maxZ - minZ)) * (width - pad * 2);
    const density = Math.exp(-0.5 * z * z);
    const y = height - 16 - density * 78;
    d += `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return d;
}

const BELL = bellPath();

function markerX(betterThan: number): number {
  const p = Math.min(0.995, Math.max(0.005, betterThan / 100));
  const z = Math.min(3, Math.max(-3, normalZ(p)));
  return 8 + ((z + 3) / 6) * 304;
}

export function ScoreCurve({ betterThan, place }: { betterThan: number; place: number }) {
  const x = markerX(place);
  return (
    <svg class="curve" viewBox="0 0 320 108" role="img" aria-label={`Better than ${betterThan} percent of today's players`}>
      <path d={`${BELL} L312 92 L8 92 Z`} class="curve-fill" />
      <path d={BELL} class="curve-line" />
      <line x1={x} y1="18" x2={x} y2="92" class="curve-mark" />
      <circle cx={x} cy="28" r="7" class="curve-dot" />
    </svg>
  );
}

export function StandingsView({
  snapshot,
  state,
  onName,
}: {
  snapshot: BoardSnapshot | null;
  state: "loading" | "ready" | "off" | "error";
  onName?: (name: string) => Promise<string | null>;
}) {
  if (state === "off") return null;
  if (state === "loading") return <p class="board-note">Checking today's board…</p>;
  if (state === "error" || !snapshot) return <p class="board-note">Today's board is unavailable.</p>;
  return (
    <section class="board" aria-label="Today's board">
      <StandingYou snapshot={snapshot} onName={onName} />
      <StandingList snapshot={snapshot} />
    </section>
  );
}

function StandingYou({
  snapshot,
  onName,
}: {
  snapshot: BoardSnapshot;
  onName?: (name: string) => Promise<string | null>;
}) {
  const you = snapshot.you;
  if (!you) {
    return <p class="board-note">{snapshot.total === 0 ? "No scores yet today." : "Finish a puzzle to join today's board."}</p>;
  }
  if (you.total <= 1) {
    return (
      <div class="board-you">
        <p class="board-percent">You're the first score today.</p>
        <NameRow you={you} onName={onName} />
      </div>
    );
  }
  const held = snapshot.submitted && !snapshot.submitted.counted;
  return (
    <div class="board-you">
      <ScoreCurve betterThan={you.betterThan} place={you.place} />
      <p class="board-percent">Better than {you.betterThan}% of today's players</p>
      {held ? <p class="board-note">Your best today is still {you.score}.</p> : null}
      <NameRow you={you} onName={onName} />
    </div>
  );
}

function NameRow({
  you,
  onName,
}: {
  you: NonNullable<BoardSnapshot["you"]>;
  onName?: (name: string) => Promise<string | null>;
}) {
  const fieldId = useId();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  if (you.named) return <p class="board-note">You're on the board as {you.displayName}.</p>;
  if (!you.nameEligible || !onName) return null;
  return (
    <form
      class="board-name"
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) return;
        setPending(true);
        setError(null);
        void onName(draft).then((message) => {
          setPending(false);
          setError(message);
        });
      }}
    >
      <label class="board-name-label" for={fieldId}>
        You're in the top 5. Add your name?
      </label>
      <div class="board-name-row">
        <input
          id={fieldId}
          class="board-name-input"
          maxLength={24}
          autoComplete="nickname"
          spellcheck={false}
          value={draft}
          disabled={pending}
          onInput={(event) => setDraft(event.currentTarget.value)}
        />
        <button type="submit" class="btn btn-go btn-small" disabled={pending || draft.trim().length === 0}>
          Save
        </button>
      </div>
      {error ? <p class="board-name-error">{error}</p> : null}
    </form>
  );
}

function StandingList({ snapshot }: { snapshot: BoardSnapshot }) {
  if (snapshot.top.length === 0) return null;
  return (
    <ol class="board-list">
      {snapshot.top.map((entry) => (
        <li class="board-row" key={`${entry.rank}-${entry.name}-${entry.answer}`}>
          <span class="board-rank">{entry.rank}</span>
          <span class="board-main">
            <span class="board-who">
              <strong>{entry.name}</strong>
              <span>{entry.score}</span>
            </span>
            <span class="board-puzzle">{entry.puzzle}</span>
            <span class="board-answer">{entry.answer}</span>
            <span class="board-beat">Better than {entry.betterThan}% of today's players</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
