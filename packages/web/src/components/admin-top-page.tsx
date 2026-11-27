import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { adminApi } from "../lib/account-api.js";
import { TOP_WINDOWS } from "../lib/admin.js";
import type { TopPlayer, TopPlayersView, TopWindow } from "../lib/admin.js";
import { shortDay } from "../lib/admin-format.js";
import { canvasToPng, cardFileName, drawCard, loadPicture, ordinal, saveBlob, windowLabel, withoutHidden } from "../lib/top-card.js";
import { AppLink, GoogleButton } from "./account-bits.js";
import { PageFrame } from "./account-page.js";

type Card = { player: TopPlayer; png: Blob; url: string };
type Drawn = { shown: TopPlayersView; cards: Card[] };

/** Several downloads in a row. A short pause keeps the browser from dropping some. */
async function saveAll(view: TopPlayersView, cards: readonly Card[]): Promise<void> {
  for (const card of cards) {
    saveBlob(card.png, cardFileName(view, card.player));
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
}

export function AdminTopPage() {
  const [days, setDays] = useState<TopWindow>(7);
  const [view, setView] = useState<TopPlayersView | null>(null);
  /** Original places of the players left out of the cards. */
  const [hidden, setHidden] = useState<ReadonlySet<number>>(new Set());
  const [drawn, setDrawn] = useState<Drawn | null>(null);
  const [status, setStatus] = useState<"loading" | "in" | "out" | "denied">("loading");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** Pictures load once per link, so hiding someone does not fetch them all again. */
  const pictures = useRef(new Map<string, Promise<HTMLImageElement | null>>());

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
    setHidden(new Set());
    setError(null);
    void adminApi.topPlayers(days).then((reply) => {
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
    });
    return () => {
      live = false;
    };
  }, [days]);

  const shown = useMemo(() => (view ? withoutHidden(view, hidden) : null), [view, hidden]);

  // Draw the cards again whenever the list changes, since every place number is on the image.
  useEffect(() => {
    if (!shown) return;
    let live = true;
    const picture = (url: string | null) => {
      if (!url) return Promise.resolve(null);
      let pending = pictures.current.get(url);
      if (!pending) {
        pending = loadPicture(url);
        pictures.current.set(url, pending);
      }
      return pending;
    };
    void (async () => {
      const cards: Card[] = [];
      try {
        const images = await Promise.all(shown.players.map((player) => picture(player.picture)));
        for (const [index, player] of shown.players.entries()) {
          const png = await canvasToPng(await drawCard(shown, player, images[index] ?? null));
          cards.push({ player, png, url: URL.createObjectURL(png) });
          if (!live) break;
        }
      } catch {
        if (live) setError("The cards could not be drawn in this browser.");
      }
      if (live) setDrawn({ shown, cards });
      else for (const card of cards) URL.revokeObjectURL(card.url);
    })();
    return () => {
      live = false;
    };
  }, [shown]);

  // Let go of the old images when new ones arrive or the page closes.
  useEffect(
    () => () => {
      for (const card of drawn?.cards ?? []) URL.revokeObjectURL(card.url);
    },
    [drawn],
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

  const ready = shown !== null && drawn?.shown === shown && drawn.cards.length === shown.players.length;
  const cards = ready ? drawn.cards : [];

  function toggle(place: number) {
    const next = new Set(hidden);
    if (next.has(place)) next.delete(place);
    else next.add(place);
    setHidden(next);
  }

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
        {view && view.players.length > 0 ? (
          <>
            <ul class="top-picks" aria-label="Players on the cards">
              {view.players.map((player) => (
                <li key={player.place}>
                  <label class="check">
                    <input type="checkbox" checked={!hidden.has(player.place)} onChange={() => toggle(player.place)} />
                    <span>
                      {player.name} · {player.totalPoints} points
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <p class="card-note">
              Untick a player to leave them off the cards. The players below move up a place. This only changes this page and resets when you reload it.
            </p>
          </>
        ) : null}
        {error ? (
          <p class="card-note sync-error" role="alert">
            {error}
          </p>
        ) : null}
        {shown && shown.players.length > 0 ? (
          <button
            type="button"
            class="btn btn-small"
            disabled={!ready || saving}
            onClick={() => {
              setSaving(true);
              void saveAll(shown, cards).finally(() => setSaving(false));
            }}
          >
            {saving ? "Saving…" : `Download all ${shown.players.length} ${shown.players.length === 1 ? "card" : "cards"}`}
          </button>
        ) : null}
      </section>

      {!view && !error ? <p class="card-text">Loading the rankings…</p> : null}
      {view && view.players.length === 0 ? <p class="card-text">No signed-in player has a score in this window yet.</p> : null}
      {view && view.players.length > 0 && shown?.players.length === 0 ? <p class="card-text">Every player is left out. Tick one to show their card.</p> : null}
      {shown && shown.players.length > 0 && !ready && !error ? <p class="card-text">Drawing the cards…</p> : null}

      {shown && ready ? (
        <ol class="top-cards">
          {cards.map((card, index) => {
            const original = view?.players.filter((player) => !hidden.has(player.place))[index]?.place;
            return (
              <li key={original ?? card.player.place} class="top-card">
                <img
                  src={card.url}
                  width={1080}
                  height={1350}
                  alt={`${ordinal(card.player.place)} place: ${card.player.name}, ${card.player.totalPoints} points`}
                />
                <div class="card-actions">
                  <button type="button" class="btn btn-small btn-ghost" onClick={() => saveBlob(card.png, cardFileName(shown, card.player))}>
                    Download PNG
                  </button>
                  {original !== undefined ? (
                    <button type="button" class="text-button" onClick={() => toggle(original)}>
                      Remove from list
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}
    </PageFrame>
  );
}
