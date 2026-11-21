import { useEffect, useState } from "preact/hooks";
import { adminApi } from "../lib/account-api.js";
import type { AdminOverview, QuestionSlot } from "../lib/admin.js";
import type { Puzzle } from "../lib/puzzles.js";
import { COSMETICS } from "../lib/rewards.js";
import type { CosmeticId } from "../lib/rewards.js";
import { scoreForMoves } from "../lib/storage.js";
import type { ScoreEntry } from "../lib/storage.js";
import { adoptAccountScores, adoptUnlocks } from "../lib/account-store.js";
import { GoogleButton } from "./account-bits.js";
import { PageFrame } from "./account-page.js";

type Draft = {
  position: number | null;
  id: string;
  start: string;
  goal: string;
  here: string;
  similarity: string;
  accepted: string;
  steps: { op: "+" | "-"; word: string }[];
};

const EMPTY: Draft = {
  position: null,
  id: "",
  start: "",
  goal: "",
  here: "",
  similarity: "",
  accepted: "",
  steps: [
    { op: "-", word: "" },
    { op: "+", word: "" },
  ],
};

function draftFrom(slot: QuestionSlot): Draft {
  return {
    position: slot.position,
    id: slot.puzzle.id,
    start: slot.puzzle.start,
    goal: slot.puzzle.goal,
    here: slot.puzzle.here,
    similarity: String(slot.puzzle.solutionSimilarity),
    accepted: slot.puzzle.accepted.join(", "),
    steps: slot.puzzle.solution.map((step) => ({ op: step.op, word: step.word })),
  };
}

function puzzleFromDraft(draft: Draft): Puzzle | null {
  const similarity = Number(draft.similarity);
  const accepted = draft.accepted.split(",").map((word) => word.trim().toLowerCase()).filter((word) => word.length > 0);
  const steps = draft.steps.filter((step) => step.word.trim().length > 0).map((step) => ({ op: step.op, word: step.word.trim().toLowerCase() }));
  if (!Number.isFinite(similarity) || steps.length === 0) return null;
  return {
    id: draft.id.trim().toLowerCase(),
    start: draft.start.trim().toLowerCase(),
    goal: draft.goal.trim().toLowerCase(),
    par: steps.length,
    solution: steps,
    solutionSimilarity: similarity,
    here: draft.here.trim().toLowerCase(),
    accepted,
  };
}

export function AdminPage() {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "in" | "out" | "denied">("loading");
  const [showLocked, setShowLocked] = useState(false);
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
      setError("Fill in the id, both words, the landing word, a similarity and at least one step.");
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

  const visible = data.questions.filter((slot) => showLocked || !slot.locked);

  return (
    <PageFrame title="Admin">
      {error ? (
        <p class="card-note sync-error" role="alert">
          {error}
        </p>
      ) : null}
      <p class="card-text">
        Signed in as {data.email}. {data.role === "super" ? "You can also add and remove admins." : "You can edit upcoming questions and your own account."}{" "}
        {upcoming < 14 ? `Only ${Math.max(0, upcoming)} days of questions are left after today.` : `${upcoming} upcoming days are ready.`}
      </p>

      <section class="card" aria-labelledby="admins-title">
        <h2 class="card-title" id="admins-title">Admins</h2>
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
            class="cheer-row"
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
            <input
              class="cheer-input"
              type="email"
              value={email}
              placeholder="name@example.com"
              autoComplete="off"
              onInput={(event) => setEmail(event.currentTarget.value)}
            />
            <button type="submit" class="btn btn-small" disabled={busy || email.trim().length === 0}>
              Add admin
            </button>
          </form>
        ) : (
          <p class="card-note">Only the superadmin can change this list.</p>
        )}
      </section>

      <section class="card" aria-labelledby="questions-title">
        <h2 class="card-title" id="questions-title">Questions</h2>
        <p class="card-text">
          The list is a stack: the first question was the first day, and each one after it is the next day. Today and every earlier day are locked. A new question is added at the end.
        </p>
        <label class="check">
          <input type="checkbox" checked={showLocked} onChange={(event) => setShowLocked(event.currentTarget.checked)} />
          <span>Show locked days</span>
        </label>
        <ul class="admin-stack">
          {visible.map((slot) => (
            <li key={slot.position}>
              <button
                type="button"
                class="text-button"
                disabled={slot.locked}
                onClick={() => {
                  setDraft(draftFrom(slot));
                  setError(null);
                }}
              >
                <span class={slot.locked ? "admin-day admin-day-locked" : "admin-day"}>{slot.day}</span>
                {slot.puzzle.start} → {slot.puzzle.goal}
                {slot.locked ? " · locked" : ""}
              </button>
            </li>
          ))}
        </ul>
        <h3 class="panel-sub">{draft.position === null ? "Add a question" : `Edit ${data.questions[draft.position]?.day ?? "that day"}`}</h3>
        <div class="admin-form">
          <label class="field">Id<input class="field-input" value={draft.id} onInput={(event) => setDraft({ ...draft, id: event.currentTarget.value })} /></label>
          <label class="field">Start<input class="field-input" value={draft.start} onInput={(event) => setDraft({ ...draft, start: event.currentTarget.value })} /></label>
          <label class="field">Goal<input class="field-input" value={draft.goal} onInput={(event) => setDraft({ ...draft, goal: event.currentTarget.value })} /></label>
          <label class="field">Lands on<input class="field-input" value={draft.here} onInput={(event) => setDraft({ ...draft, here: event.currentTarget.value })} /></label>
          <label class="field">Similarity<input class="field-input" value={draft.similarity} onInput={(event) => setDraft({ ...draft, similarity: event.currentTarget.value })} /></label>
          <label class="field">Accepted words<input class="field-input" value={draft.accepted} placeholder="word, word" onInput={(event) => setDraft({ ...draft, accepted: event.currentTarget.value })} /></label>
        </div>
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
    </PageFrame>
  );
}
