import { useEffect, useMemo, useState } from "preact/hooks";
import { adminApi } from "../lib/account-api.js";
import type { AdminOverview } from "../lib/admin.js";
import { autoId, freeId, nextDayKey, parseAccepted, shortDay } from "../lib/admin-format.js";
import type { AppliedStep } from "../lib/game.js";
import type { Puzzle } from "../lib/puzzles.js";

type Loaded = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: AdminOverview };

/**
 * After an admin wins a playtest: save the pair and the moves that solved it as a real question.
 * The picker chooses the day. Whatever is on that day, and after it, moves back one day.
 */
export function SaveQuestion({
  start,
  goal,
  steps,
  threshold,
  suggested,
}: {
  start: string;
  goal: string;
  steps: readonly AppliedStep[];
  /** 0 to 1. */
  threshold: number;
  /** Words near where the solution landed, offered as the accepted words. */
  suggested: readonly string[];
}) {
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  const [accepted, setAccepted] = useState(suggested.join(", "));
  const [choice, setChoice] = useState<string>("end");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void adminApi.load().then((reply) => {
      if (cancelled) return;
      if (reply.ok) setLoaded({ status: "ready", data: reply.value });
      else setLoaded({ status: "error", message: reply.error });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const data = loaded.status === "ready" ? loaded.data : null;
  const upcoming = useMemo(() => (data ? data.questions.filter((slot) => !slot.locked) : []), [data]);
  const endDay = useMemo(() => {
    if (!data) return "";
    const last = data.questions.at(-1);
    return last ? nextDayKey(last.day) : "";
  }, [data]);

  const taken = useMemo(() => new Set((data?.questions ?? []).map((slot) => slot.puzzle.id)), [data]);
  const id = freeId(autoId(start, goal), taken);
  const picked = choice === "end" ? null : upcoming.find((slot) => String(slot.position) === choice) ?? null;
  const position = picked ? picked.position : (data?.questions.length ?? 0);
  const day = picked ? picked.day : endDay;

  async function save() {
    if (!data) return;
    const words = parseAccepted(accepted);
    if (!words) {
      setError("Add two or three accepted words, each a single word of letters, separated by commas.");
      return;
    }
    if (steps.length === 0 || !id) {
      setError("There is no solution to save yet.");
      return;
    }
    const puzzle: Puzzle = {
      id,
      start,
      goal,
      par: steps.length,
      solution: steps.map((step) => ({ op: step.op, word: step.word })),
      solutionSimilarity: threshold,
      here: goal,
      accepted: words,
    };
    setBusy(true);
    setError(null);
    const reply = await adminApi.insertQuestion(position, puzzle);
    setBusy(false);
    if (!reply.ok) {
      setError(reply.error);
      return;
    }
    const moved = data.questions.length - position;
    setDone(
      moved > 0
        ? `Saved for ${shortDay(day)}. ${moved} later ${moved === 1 ? "question moved" : "questions moved"} back a day.`
        : `Saved for ${shortDay(day)}.`,
    );
  }

  if (loaded.status === "loading") {
    return (
      <section class="save-q" aria-label="Save as a question">
        <p class="field-hint">Loading the schedule…</p>
      </section>
    );
  }
  if (loaded.status === "error") {
    return (
      <section class="save-q" aria-label="Save as a question">
        <p class="move-error" role="alert">
          {loaded.message}
        </p>
      </section>
    );
  }

  return (
    <section class="save-q" aria-label="Save as a question">
      <h3 class="save-q-title">Save as a question</h3>
      {done ? (
        <p class="save-q-done" role="status">
          {done}
        </p>
      ) : (
        <>
          <p class="field-hint">
            {start} → {goal} in {steps.length} {steps.length === 1 ? "step" : "steps"}, with a {Math.round(threshold * 10000) / 100}%
            threshold. The id will be <strong>{id}</strong>.
          </p>
          <label class="field">
            <span class="field-label">Accepted words</span>
            <input
              class="field-input"
              value={accepted}
              placeholder="word, word"
              autoCapitalize="none"
              autoComplete="off"
              spellcheck={false}
              onInput={(event) => setAccepted(event.currentTarget.value)}
            />
            <span class="field-hint">Two or three other words that also count as a win, separated by commas.</span>
          </label>
          <label class="field">
            <span class="field-label">Day</span>
            <select class="field-input" value={choice} onChange={(event) => setChoice(event.currentTarget.value)}>
              {upcoming.map((slot) => (
                <option key={slot.position} value={String(slot.position)}>
                  {shortDay(slot.day)} · {slot.puzzle.start} → {slot.puzzle.goal}
                </option>
              ))}
              <option value="end">End of the list · {endDay ? shortDay(endDay) : "new day"}</option>
            </select>
            <span class="field-hint">
              {picked
                ? `This takes ${shortDay(picked.day)}. ${picked.puzzle.start} → ${picked.puzzle.goal} and every question after it move back a day. Today and earlier days never change.`
                : "Added at the end. Nothing else moves."}
            </span>
          </label>
          {error ? (
            <p class="move-error" role="alert">
              {error}
            </p>
          ) : null}
          <button type="button" class="btn btn-small" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save question"}
          </button>
        </>
      )}
    </section>
  );
}
