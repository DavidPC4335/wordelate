import { useEffect, useState } from "preact/hooks";
import { adminApi } from "../lib/account-api.js";
import { TOP_WINDOWS } from "../lib/admin.js";
import type { TopPlayer, TopPlayersView, TopWindow } from "../lib/admin.js";
import { shortDay } from "../lib/admin-format.js";
import { canvasToPng, cardFileName, drawCard, loadPicture, ordinal, saveBlob, windowLabel } from "../lib/top-card.js";
import { AppLink, GoogleButton } from "./account-bits.js";
import { PageFrame } from "./account-page.js";

type Card = { player: TopPlayer; png: Blob; url: string };

/** Several downloads in a row. A short pause keeps the browser from dropping some. */
async function saveAll(view: TopPlayersView, cards: readonly Card[]): Promise<void> {
  for (const card of cards) {
    saveBlob(card.png, cardFileName(view, card.player));
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
}

async function makeCards(view: TopPlayersView): Promise<Card[]> {
  const pictures = await Promise.all(view.players.map((player) => loadPicture(player.picture)));
  const cards: Card[] = [];
  for (const [index, player] of view.players.entries()) {
    const canvas = await drawCard(view, player, pictures[index] ?? null);
    const png = await canvasToPng(canvas);
    cards.push({ player, png, url: URL.createObjectURL(png) });
  }
  return cards;
}

export function AdminTopPage() {
  const [days, setDays] = useState<TopWindow>(7);
  const [view, setView] = useState<TopPlayersView | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [status, setStatus] = useState<"loading" | "in" | "out" | "denied">("loading");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const before = document.title;
    document.title = "Top players — Wordelate";
    return () => {
      document.title = before;
    };
  }, []);

  useEffect(() => {
    let live = true;
    setStatus((current) => (current === "in" ? current : "loading"));
    setView(null);
    setError(null);
    void adminApi.topPlayers(days).then(async (reply) => {
      if (!live) return;
      if (!reply.ok) {
        if (reply.status === 401) setStatus("out");
        else if (reply.status === 404) setStatus("denied");
        else {
          setStatus("in");
          setError(reply.error);
        }
        return;
      }
      setStatus("in");
      setView(reply.value);
      try {
        const made = await makeCards(reply.value);
        if (live) setCards(made);
        else for (const card of made) URL.revokeObjectURL(card.url);
      } catch {
        if (live) setError("The cards could not be drawn in this browser.");
      }
    });
    return () => {
      live = false;
    };
  }, [days]);

  // Let go of the old images when new ones arrive or the page closes.
  useEffect(
    () => () => {
      for (const card of cards) URL.revokeObjectURL(card.url);
    },
    [cards],
  );

  if (status === "loading") {
    return (
      <PageFrame title="Top players">
        <p class="card-text">Checking your account…</p>
      </PageFrame>
    );
  }
  if (status === "out") {
    return (
      <PageFrame title="Top players">
        <section class="card">
          <h2 class="card-title">Log in to continue</h2>
          <p class="card-text">This page is only available to an account that has admin access.</p>
          <GoogleButton next="/admin/top" label="Log in with Google" />
        </section>
      </PageFrame>
    );
  }
  if (status === "denied") {
    return (
      <PageFrame title="Top players">
        <section class="card">
          <h2 class="card-title">This page is not available</h2>
          <p class="card-text">This account does not have admin access.</p>
        </section>
      </PageFrame>
    );
  }

  const ready = view !== null && cards.length === view.players.length && cards.every((card, index) => card.player === view.players[index]);

  return (
    <PageFrame title="Top players">
      <AppLink to="/admin" class="text-button">
        ← Back to admin
      </AppLink>
      <section class="card" aria-labelledby="top-title">
        <h2 class="card-title" id="top-title">
          {windowLabel(days)}
        </h2>
        <p class="card-text">
          Signed-in players with the most points from the daily board. Each card shows the player's best day and the solution they posted.
        </p>
        <div class="top-windows" role="radiogroup" aria-label="Time window">
          {TOP_WINDOWS.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={option === days}
              class={option === days ? "day-pill day-pill-on" : "day-pill"}
              onClick={() => setDays(option)}
            >
              <span class="day-pill-num">{option}</span>
              <span class="day-pill-top">days</span>
            </button>
          ))}
        </div>
        {view ? (
          <p class="card-note">
            {shortDay(view.from)} – {shortDay(view.to)} · {view.players.length === 0 ? "nobody yet" : `top ${view.players.length}`}
          </p>
        ) : null}
        {error ? (
          <p class="card-note sync-error" role="alert">
            {error}
          </p>
        ) : null}
        {view && view.players.length > 0 ? (
          <button type="button" class="btn btn-small" disabled={!ready || saving} onClick={() => {
            setSaving(true);
            void saveAll(view, cards).finally(() => setSaving(false));
          }}>
            {saving ? "Saving…" : `Download all ${view.players.length} cards`}
          </button>
        ) : null}
      </section>

      {!view && !error ? <p class="card-text">Loading the rankings…</p> : null}
      {view && view.players.length === 0 ? <p class="card-text">No signed-in player has a score in this window yet.</p> : null}
      {view && view.players.length > 0 && !ready && !error ? <p class="card-text">Drawing the cards…</p> : null}

      {view && ready ? (
        <ol class="top-cards">
          {cards.map((card) => (
            <li key={card.player.place} class="top-card">
              <img
                src={card.url}
                width={1080}
                height={1350}
                alt={`${ordinal(card.player.place)} place: ${card.player.name}, ${card.player.totalPoints} points`}
              />
              <button type="button" class="btn btn-small btn-ghost" onClick={() => saveBlob(card.png, cardFileName(view, card.player))}>
                Download PNG
              </button>
            </li>
          ))}
        </ol>
      ) : null}
    </PageFrame>
  );
}
