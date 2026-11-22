import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { adminApi } from "../lib/account-api.js";
import type { AdminOverview, QuestionSlot } from "../lib/admin.js";
import type { Puzzle } from "../lib/puzzles.js";
import { COSMETICS } from "../lib/rewards.js";
import type { CosmeticId } from "../lib/rewards.js";
import { scoreForMoves } from "../lib/storage.js";
import type { ScoreEntry } from "../lib/storage.js";
import { adoptAccountScores, adoptUnlocks } from "../lib/account-store.js";
import { autoId, shortDay } from "../lib/admin-format.js";
import { GoogleButton } from "./account-bits.js";
import { PageFrame } from "./account-page.js";

type Draft = {
  position: number | null;
  id: string;
  start: string;
  goal: string;
  similarity: string;
  accepted: string;
  steps: { op: "+" | "-"; word: string }[];
};

const EMPTY: Draft = {
  position: null,
  id: "",
  start: "",
  goal: "",
  similarity: "75",
  accepted: "",
  steps: [
    { op: "-", word: "" },
    { op: "+", word: "" },
  ],
};

const PAGE_SIZE = 7;

function percentText(similarity: number): string {
  return String(Math.round(similarity * 10000) / 100);
}

function Field({ label, hint, children }: { label: string; hint: string; children: ComponentChildren }) {
  return (
    <label class="field">
      <span class="field-label">{label}</span>
      {children}
      <span class="field-hint">{hint}</span>
    </label>
  );
}

function draftFrom(slot: QuestionSlot): Draft {
  return {
    position: slot.position,
    id: slot.puzzle.id,
    start: slot.puzzle.start,
    goal: slot.puzzle.goal,
    similarity: percentText(slot.puzzle.solutionSimilarity),
    accepted: slot.puzzle.accepted.join(", "),
    steps: slot.puzzle.solution.map((step) => ({ op: step.op, word: step.word })),
  };
}

function puzzleFromDraft(draft: Draft): Puzzle | null {
  const percent = Number(draft.similarity);
  const accepted = draft.accepted.split(",").map((word) => word.trim().toLowerCase()).filter((word) => word.length > 0);
  const steps = draft.steps
    .filter((step) => step.word.trim().length > 0)
    .map((step) => ({ op: step.op, word: step.word.trim().toLowerCase() }));
  const id = draft.position === null ? autoId(draft.start, draft.goal) : draft.id.trim().toLowerCase();
  const start = draft.start.trim().toLowerCase();
  const goal = draft.goal.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) return null;
  if (!/^[a-z]+$/.test(start) || !/^[a-z]+$/.test(goal)) return null;
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) return null;
  if (accepted.length < 2 || accepted.length > 3 || accepted.some((word) => !/^[a-z]+$/.test(word))) return null;
  if (steps.length === 0 || steps.some((step) => !/^[a-z]+$/.test(step.word))) return null;
  return {
    id,
    start,
    goal,
    par: steps.length,
    solution: steps,
    solutionSimilarity: Math.round(percent * 100) / 10000,
    here: goal,
    accepted,
  };
}

export function AdminPage() {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "in" | "out" | "denied">("loading");
  const [showLocked, setShowLocked] = useState(false);
  const [page, setPage] = useState(0);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [scores, setScores] = useState<ScoreEntry[]>([]);
  const [scoreDraft, setScoreDraft] = useState({ day: "", puzzleId: "", moves: "3" });
  const [unlocks, setUnlocks] = useState<CosmeticId[]>([]);

  function apply(next: AdminOverview) {
    setData(next);
    setScores(next.scores);
    setUnlocks(next.unlocks.includes("classic") ? next.unlocks : ["classic", ...next.unlocks]);
    setStatus("in");
    setError(null);
  }

  useEffect(() => {
    const before = document.title;
    document.title = "Admin — Wordelate";
    void adminApi.load().then((reply) => {
      if (reply.ok) apply(reply.value);
      else if (reply.status === 401) setStatus("out");
      else if (reply.status === 404) setStatus("denied");
      else setError(reply.error);
    });
    return () => {
      document.title = before;
    };
  }, []);

  const upcoming = (data?.questions.length ?? 0) - 1 - (data?.todayIndex ?? 0);

  async function saveQuestion() {
    const puzzle = puzzleFromDraft(draft);
    if (!puzzle) {
      setError("Use single words, a similarity from 0 to 100, 2 or 3 accepted words, and at least one step.");
      return;
    }
    setBusy(true);
    const reply = await adminApi.saveQuestion(draft.position, puzzle);
    setBusy(false);
    if (!reply.ok) {
      setError(reply.error);
      return;
    }
    apply(reply.value);
    if (draft.position === null) {
      const upcomingCount = reply.value.questions.filter((slot) => !slot.locked).length;
      setShowLocked(false);
      setPage(Math.max(0, Math.ceil(upcomingCount / PAGE_SIZE) - 1));
    }
    setDraft(EMPTY);
  }

  if (status === "loading" && !data) {
    return (
      <PageFrame title="Admin">
        <p class="card-text">Checking your account…</p>
      </PageFrame>
    );
  }
  if (status === "out") {
    return (
      <PageFrame title="Admin">
        <section class="card">
          <h2 class="card-title">Log in to continue</h2>
          <p class="card-text">Admin tools are only available to an account that has been given access.</p>
          <GoogleButton next="/admin" label="Log in with Google" />
        </section>
      </PageFrame>
    );
  }
  if (status === "denied" || !data) {
    return (
      <PageFrame title="Admin">
        <section class="card">
          <h2 class="card-title">This page is not available</h2>
          <p class="card-text">This account does not have admin access.</p>
        </section>
      </PageFrame>
    );
  }

  const pool = data.questions.filter((slot) => (showLocked ? slot.locked : !slot.locked));
  const pageCount = Math.max(1, Math.ceil(pool.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const slice = pool.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const rangeStart = slice[0];
  const rangeEnd = slice[slice.length - 1];
  const shownId = draft.position === null ? autoId(draft.start, draft.goal) : draft.id;

  return (
    <PageFrame title="Admin">
      {error ? (
        <p class="card-note sync-error" role="alert">
          {error}
        </p>
      ) : null}
      <p class="card-text">
        Signed in as {data.email}.{" "}
        {upcoming < 14 ? `Only ${Math.max(0, upcoming)} days of questions are left after today.` : `${upcoming} upcoming days are ready.`}
      </p>

      <section class="card" aria-labelledby="questions-title">
        <h2 class="card-title" id="questions-title">{showLocked ? "Locked days" : "Upcoming questions"}</h2>
        <p class="card-text">
          {showLocked
            ? "These days have already started, so their questions stay as they are."
            : "Each question is one day, in order. Pick a day to change it, or add a new one at the end. Today cannot be changed."}
        </p>
        <div class="admin-pager">
          <button type="button" class="btn btn-small btn-ghost" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
            Previous
          </button>
          <span>
            {rangeStart && rangeEnd ? `${shortDay(rangeStart.day)} – ${shortDay(rangeEnd.day)}` : "None"}
            <span class="admin-page-count"> {safePage + 1} / {pageCount}</span>
          </span>
          <button
            type="button"
            class="btn btn-small btn-ghost"
            disabled={safePage >= pageCount - 1}
            onClick={() => setPage(safePage + 1)}
          >
            Next
          </button>
        </div>
        <button
          type="button"
          class="text-button"
          onClick={() => {
            setShowLocked((value) => !value);
            setPage(0);
          }}
        >
          {showLocked ? "Back to upcoming questions" : "Show locked days"}
        </button>
        {slice.length === 0 ? <p class="card-note">Nothing in this list.</p> : null}
        <ul class="admin-stack">
          {slice.map((slot) => (
            <li key={slot.position}>
              <button
                type="button"
                class={draft.position === slot.position ? "admin-slot admin-slot-on" : "admin-slot"}
                disabled={slot.locked}
                aria-current={draft.position === slot.position ? "true" : undefined}
                onClick={() => {
                  setDraft(draftFrom(slot));
                  setError(null);
                }}
              >
                <span class="admin-day">{shortDay(slot.day)}</span>
                <span class="admin-pair">
                  {slot.puzzle.start} → {slot.puzzle.goal}
                </span>
                {slot.locked ? <span class="admin-lock">Locked</span> : null}
              </button>
            </li>
          ))}
        </ul>
        <h3 class="panel-sub">{draft.position === null ? "Add a question" : `Edit ${data.questions[draft.position]?.day ?? "that day"}`}</h3>
        <p class="field-hint admin-id">
          {shownId
            ? draft.position === null
              ? `Id ${shownId}, made from the two words.`
              : `Id ${shownId}. It stays the same if you change the words.`
            : "The id is created from the start and goal words."}
        </p>
        <div class="admin-form">
          <Field label="Start" hint="The word the player begins on.">
            <input class="field-input" value={draft.start} autoCapitalize="none" spellcheck={false} onInput={(event) => setDraft({ ...draft, start: event.currentTarget.value })} />
          </Field>
          <Field label="Goal" hint="The word they are trying to reach. The sample solution is treated as landing on this word.">
            <input class="field-input" value={draft.goal} autoCapitalize="none" spellcheck={false} onInput={(event) => setDraft({ ...draft, goal: event.currentTarget.value })} />
          </Field>
          <Field label="Threshold" hint="How close that landing has to be, as a percent. 75% is the usual bar for a win.">
            <input
              class="field-input"
              inputMode="decimal"
              value={draft.similarity}
              onInput={(event) => setDraft({ ...draft, similarity: event.currentTarget.value })}
            />
          </Field>
          <Field label="Accepted words" hint="Two or three other words that also count as a win, separated by commas.">
            <input
              class="field-input"
              value={draft.accepted}
              placeholder="word, word"
              autoCapitalize="none"
              spellcheck={false}
              onInput={(event) => setDraft({ ...draft, accepted: event.currentTarget.value })}
            />
          </Field>
        </div>
        <p class="field-hint">Sample solution. Each step adds or subtracts one word. The number of steps is the par.</p>
        <ol class="admin-steps">
          {draft.steps.map((step, index) => (
            <li key={index}>
              <select
                value={step.op}
                onChange={(event) => {
                  const steps = draft.steps.slice();
                  const current = steps[index];
                  if (!current) return;
                  steps[index] = { op: event.currentTarget.value === "-" ? "-" : "+", word: current.word };
                  setDraft({ ...draft, steps });
                }}
              >
                <option value="+">add</option>
                <option value="-">subtract</option>
              </select>
              <input
                class="field-input"
                value={step.word}
                placeholder="word"
                onInput={(event) => {
                  const steps = draft.steps.slice();
                  const current = steps[index];
                  if (!current) return;
                  steps[index] = { op: current.op, word: event.currentTarget.value };
                  setDraft({ ...draft, steps });
                }}
              />
              <button
                type="button"
                class="text-button"
                onClick={() => setDraft({ ...draft, steps: draft.steps.filter((_, stepIndex) => stepIndex !== index) })}
              >
                Remove
              </button>
            </li>
          ))}
        </ol>
        <div class="card-actions">
          <button type="button" class="text-button" onClick={() => setDraft({ ...draft, steps: [...draft.steps, { op: "+", word: "" }] })}>
            Add step
          </button>
          <button type="button" class="btn btn-small" disabled={busy} onClick={() => void saveQuestion()}>
            {draft.position === null ? "Add question" : "Save question"}
          </button>
          {draft.position !== null ? (
            <button type="button" class="text-button" onClick={() => setDraft(EMPTY)}>
              Cancel
            </button>
          ) : null}
        </div>
      </section>

      <section class="card" aria-labelledby="mine-title">
        <h2 class="card-title" id="mine-title">Your account</h2>
        <p class="card-text">These replace the scores and looks saved on your account, and on this browser. Another admin editing the questions does not affect this.</p>
        <ul class="admin-scores">
          {scores.map((entry, index) => (
            <li key={`${entry.day}-${entry.puzzleId}-${index}`}>
              <span>
                {entry.day} · {entry.puzzleId} · {entry.moves} {entry.moves === 1 ? "move" : "moves"} · {entry.score}
              </span>
              <button type="button" class="text-button" onClick={() => setScores(scores.filter((_, scoreIndex) => scoreIndex !== index))}>
                Remove
              </button>
            </li>
          ))}
        </ul>
        <form
          class="cheer-row"
          onSubmit={(event) => {
            event.preventDefault();
            const moves = Number(scoreDraft.moves);
            if (!Number.isInteger(moves) || moves < 1 || moves > 16) {
              setError("Moves must be from 1 to 16.");
              return;
            }
            setScores([...scores, { day: scoreDraft.day, puzzleId: scoreDraft.puzzleId.trim().toLowerCase(), moves, score: scoreForMoves(moves) }]);
            setScoreDraft({ day: "", puzzleId: "", moves: "3" });
          }}
        >
          <input class="cheer-input" type="date" value={scoreDraft.day} onInput={(event) => setScoreDraft({ ...scoreDraft, day: event.currentTarget.value })} />
          <input class="cheer-input" placeholder="puzzle id" value={scoreDraft.puzzleId} onInput={(event) => setScoreDraft({ ...scoreDraft, puzzleId: event.currentTarget.value })} />
          <input class="cheer-input" inputMode="numeric" value={scoreDraft.moves} onInput={(event) => setScoreDraft({ ...scoreDraft, moves: event.currentTarget.value })} />
          <button type="submit" class="btn btn-small">Add score</button>
        </form>
        <ul class="admin-looks">
          {COSMETICS.map((look) => (
            <li key={look.id}>
              <label class="check">
                <input
                  type="checkbox"
                  checked={unlocks.includes(look.id)}
                  disabled={look.id === "classic"}
                  onChange={(event) => {
                    const on = event.currentTarget.checked;
                    setUnlocks(on ? [...unlocks, look.id] : unlocks.filter((id) => id !== look.id));
                  }}
                />
                <span>{look.name}</span>
              </label>
            </li>
          ))}
        </ul>
        <p class="card-note">Saving looks replaces the ones you earned. New looks will not unlock on their own after that.</p>
        <button
          type="button"
          class="btn btn-small"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void adminApi.saveAccount({ scores, unlocks }).then((reply) => {
              setBusy(false);
              if (!reply.ok) {
                setError(reply.error);
                return;
              }
              apply(reply.value);
              adoptAccountScores(reply.value.scores);
              adoptUnlocks(reply.value.unlocks);
            });
          }}
        >
          Save scores and looks
        </button>
      </section>

      <section class="card" aria-labelledby="audit-title">
        <h2 class="card-title" id="audit-title">Recent changes</h2>
        {data.audit.length === 0 ? <p class="card-note">No changes yet.</p> : null}
        <ul class="admin-audit">
          {data.audit.map((entry, index) => (
            <li key={`${entry.at}-${index}`}>
              <time dateTime={new Date(entry.at).toISOString()}>{new Date(entry.at).toLocaleString()}</time>
              <span>
                {entry.actorEmail} · {entry.action} · {entry.detail}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section class="card" aria-labelledby="admins-title">
        <h2 class="card-title" id="admins-title">Admins</h2>
        <p class="card-text">
          {data.role === "super"
            ? "Add the Google email of someone who should edit upcoming questions and their own account. The superadmin stays on the list."
            : "These accounts can edit upcoming questions. Only the superadmin can change the list."}
        </p>
        <ul class="admin-people">
          {data.admins.map((person) => (
            <li key={person.email}>
              <span>
                {person.email}
                {person.super ? " · superadmin" : person.addedBy ? ` · added by ${person.addedBy}` : ""}
              </span>
              {data.role === "super" && !person.super ? (
                <button
                  type="button"
                  class="text-button text-danger"
                  onClick={() => {
                    setBusy(true);
                    void adminApi.removeAdmin(person.email).then((reply) => {
                      setBusy(false);
                      if (reply.ok) apply(reply.value);
                      else setError(reply.error);
                    });
                  }}
                >
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {data.role === "super" ? (
          <form
            class="admin-add"
            onSubmit={(event) => {
              event.preventDefault();
              setBusy(true);
              void adminApi.addAdmin(email).then((reply) => {
                setBusy(false);
                if (reply.ok) {
                  setEmail("");
                  apply(reply.value);
                } else setError(reply.error);
              });
            }}
          >
            <Field label="Email" hint="They get access the next time they are signed in with this address.">
              <input
                class="field-input"
                type="email"
                value={email}
                placeholder="name@example.com"
                autoComplete="off"
                onInput={(event) => setEmail(event.currentTarget.value)}
              />
            </Field>
            <button type="submit" class="btn btn-small" disabled={busy || email.trim().length === 0}>
              Add admin
            </button>
          </form>
        ) : null}
      </section>
    </PageFrame>
  );
}
