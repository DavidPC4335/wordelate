import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { FRIEND_DAYS } from "../lib/account.js";
import type { AccountProfile, FriendDay, FriendView } from "../lib/account.js";
import { accountApi } from "../lib/account-api.js";
import { deleteAccount, logout, logoutEverywhere, updateProfile, useAccount } from "../lib/account-store.js";
import { shiftDay } from "../lib/standings.js";
import { calendarDay, readScores } from "../lib/storage.js";
import { Avatar, AppLink, GoogleButton } from "./account-bits.js";
import { PictureToggle } from "./profile-controls.js";
import { SyncControl } from "./account-popover.js";
import { CheckIcon, CopyIcon, FlameIcon, LinkIcon, ShareIcon, StarIcon, UsersIcon } from "./icons.js";

/** The page frame: the wordmark and a way back to the game. */
export function PageFrame({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <div class="page">
      <header class="page-top">
        <AppLink to="/" class="page-brand">
          <img class="brand-logo" src="/brand/wordmark.png" alt="Wordelate" />
        </AppLink>
        <AppLink to="/" class="btn btn-small btn-ghost">
          Back to the game
        </AppLink>
      </header>
      <main class="page-body">
        <h1 class="page-title">{title}</h1>
        {children}
      </main>
      <footer class="page-foot">
        <a href="/home" class="text-button">
          About Wordelate
        </a>
        <AppLink to="/privacy-policy" class="text-button">
          Privacy policy
        </AppLink>
      </footer>
    </div>
  );
}

function weekday(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
}

function WeekStrip({ days, scores }: { days: string[]; scores: Map<string, FriendDay> }) {
  return (
    <ol class="week" aria-label="Last seven days">
      {days.map((day) => {
        const hit = scores.get(day);
        return (
          <li key={day} class={hit ? "week-day week-hit" : "week-day"} title={hit ? `${hit.score} points in ${hit.moves} moves` : "No score"}>
            <span class="week-name">{weekday(day)}</span>
            <span class="week-score">{hit ? hit.score : "–"}</span>
          </li>
        );
      })}
    </ol>
  );
}

function FriendRow({ friend, days, onRemove }: { friend: FriendView; days: string[]; onRemove: () => void }) {
  const [sure, setSure] = useState(false);
  const byDay = useMemo(() => new Map(friend.recent.map((entry) => [entry.day, entry])), [friend.recent]);
  return (
    <li class="friend">
      <div class="friend-head">
        <Avatar name={friend.name} picture={friend.picture} size={38} />
        <strong class="friend-name">{friend.name}</strong>
        <span class="chip chip-points">
          <StarIcon size={14} />
          {friend.stats.totalPoints}
        </span>
        <span class={friend.stats.streak > 0 ? "chip chip-streak" : "chip chip-off"}>
          <FlameIcon size={14} />
          {friend.stats.streak}
        </span>
      </div>
      <WeekStrip days={days} scores={byDay} />
      <div class="friend-foot">
        <span>{friend.stats.wins} {friend.stats.wins === 1 ? "win" : "wins"} · best streak {friend.stats.bestStreak}</span>
        {sure ? (
          <span class="friend-sure">
            <button type="button" class="text-button text-danger" onClick={onRemove}>
              Remove friend
            </button>
            <button type="button" class="text-button" onClick={() => setSure(false)}>
              Keep
            </button>
          </span>
        ) : (
          <button type="button" class="text-button" onClick={() => setSure(true)}>
            Remove
          </button>
        )}
      </div>
    </li>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function InviteCard({ path, onReset }: { path: string; onReset: () => Promise<string | null> }) {
  const link = `${window.location.origin}${path}`;
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const canShare = typeof navigator.share === "function";
  return (
    <section class="card" aria-labelledby="invite-title">
      <h2 class="card-title" id="invite-title">
        <LinkIcon size={20} /> Your private friend link
      </h2>
      <p class="card-text">Anyone you send this to can add you as a friend and see your scores. Only share it with people you trust.</p>
      <input class="invite-link" readOnly value={link} aria-label="Your private friend link" onFocus={(event) => event.currentTarget.select()} />
      <div class="card-actions">
        <button
          type="button"
          class="btn btn-small"
          onClick={async () => {
            const ok = await copyText(link);
            setCopied(ok);
            setError(ok ? null : "Could not copy. Select the link and copy it.");
            if (ok) window.setTimeout(() => setCopied(false), 1800);
          }}
        >
          {copied ? <CheckIcon size={18} /> : <CopyIcon size={18} />}
          <span>{copied ? "Copied" : "Copy link"}</span>
        </button>
        {canShare ? (
          <button
            type="button"
            class="btn btn-small btn-ghost"
            onClick={() => {
              void navigator.share({ title: "Wordelate", text: "Be my friend on Wordelate.", url: link }).catch(() => undefined);
            }}
          >
            <ShareIcon size={18} />
            <span>Share</span>
          </button>
        ) : null}
        {confirming ? (
          <span class="friend-sure">
            <button
              type="button"
              class="text-button text-danger"
              onClick={async () => {
                setError(await onReset());
                setConfirming(false);
              }}
            >
              Make a new link
            </button>
            <button type="button" class="text-button" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </span>
        ) : (
          <button type="button" class="text-button" onClick={() => setConfirming(true)}>
            Reset link
          </button>
        )}
      </div>
      {confirming ? <p class="card-note">The old link stops working. Friends you already have stay.</p> : null}
      {error ? <p class="card-note sync-error" role="alert">{error}</p> : null}
    </section>
  );
}

function ProfileCard({ profile, since }: { profile: AccountProfile; since: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(profile.username);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <section class="card card-profile" aria-labelledby="profile-title">
      <Avatar name={profile.username} picture={profile.picture} size={64} />
      <div class="profile-text">
        {editing ? (
          <form
            class="profile-edit"
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              const message = await updateProfile({ username: draft });
              setBusy(false);
              setError(message);
              if (!message) setEditing(false);
            }}
          >
            <label class="cheer-label" for="username-field">Username</label>
            <div class="cheer-row">
              <input
                id="username-field"
                class="cheer-input"
                maxLength={24}
                autoComplete="nickname"
                spellcheck={false}
                value={draft}
                disabled={busy}
                onInput={(event) => setDraft(event.currentTarget.value)}
              />
              <button type="submit" class="btn btn-small" disabled={busy || draft.trim().length === 0}>
                {busy ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                class="text-button"
                onClick={() => {
                  setEditing(false);
                  setError(null);
                  setDraft(profile.username);
                }}
              >
                Cancel
              </button>
            </div>
            {error ? (
              <p class="card-note sync-error" role="alert">{error}</p>
            ) : (
              <p class="card-note">Friends and the leaderboard see this. Letters and numbers, up to 24.</p>
            )}
          </form>
        ) : (
          <>
            <h2 class="profile-name" id="profile-title">{profile.username}</h2>
            <p class="profile-email">{profile.email}</p>
            <p class="profile-since">Playing since {since}</p>
            <button
              type="button"
              class="text-button profile-change"
              onClick={() => {
                setDraft(profile.username);
                setEditing(true);
              }}
            >
              Change username
            </button>
          </>
        )}
        {profile.picture ? <PictureToggle /> : null}
      </div>
    </section>
  );
}

function DangerZone() {
  const [step, setStep] = useState<"idle" | "confirm">("idle");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <section class="card" aria-labelledby="session-title">
      <h2 class="card-title" id="session-title">Sign out and data</h2>
      <div class="card-actions">
        <button type="button" class="btn btn-small btn-ghost" onClick={() => void logout()}>
          Log out
        </button>
        <button type="button" class="btn btn-small btn-ghost" onClick={() => void logoutEverywhere()}>
          Log out everywhere
        </button>
      </div>
      <p class="card-note">Scores stay on this device when you log out. “Everywhere” also signs out your other phones and browsers.</p>
      {step === "idle" ? (
        <button type="button" class="text-button text-danger" onClick={() => setStep("confirm")}>
          Delete my account
        </button>
      ) : (
        <form
          class="danger-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setFailed(!(await deleteAccount()));
            setBusy(false);
          }}
        >
          <p class="card-text">
            This erases your account, its saved scores and your friend connections. Scores on this device are not touched. Type <strong>delete</strong> to confirm.
          </p>
          <div class="card-actions">
            <input class="danger-input" value={typed} onInput={(event) => setTyped(event.currentTarget.value)} autocomplete="off" aria-label="Type delete to confirm" />
            <button type="submit" class="btn btn-small btn-danger" disabled={busy || typed.trim().toLowerCase() !== "delete"}>
              Delete account
            </button>
            <button type="button" class="text-button" onClick={() => { setStep("idle"); setTyped(""); }}>
              Cancel
            </button>
          </div>
          {failed ? <p class="card-note sync-error" role="alert">Could not delete the account. Try again.</p> : null}
        </form>
      )}
    </section>
  );
}

export function AccountPage() {
  const state = useAccount();
  const [friends, setFriends] = useState<FriendView[] | null>(null);
  const [friendError, setFriendError] = useState<string | null>(null);
  const [invitePath, setInvitePath] = useState<string | null>(null);
  const account = state.account;

  const today = calendarDay(new Date());
  const days = useMemo(() => Array.from({ length: FRIEND_DAYS }, (_, i) => shiftDay(today, i - (FRIEND_DAYS - 1))), [today]);

  const loadFriends = () => {
    void accountApi.friends().then((reply) => {
      if (reply.ok) {
        setFriends(reply.value.friends);
        setFriendError(null);
      } else {
        setFriendError(reply.error);
      }
    });
  };

  // Friends are read when the page opens and again after each sync.
  useEffect(() => {
    if (account) loadFriends();
  }, [account?.profile.id, state.sync.at]);

  const mine = useMemo(() => {
    const best = new Map<string, FriendDay>();
    for (const entry of readScores()) {
      const held = best.get(entry.day);
      if (!held || entry.score > held.score) best.set(entry.day, { day: entry.day, score: entry.score, moves: entry.moves });
    }
    return best;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.localVersion, state.sync.at]);

  if (state.status === "loading") {
    return (
      <PageFrame title="Account">
        <p class="card-text" aria-busy="true">Loading your account…</p>
      </PageFrame>
    );
  }

  if (!account || !state.stats) {
    return (
      <PageFrame title="Account">
        <section class="card">
          <h2 class="card-title">Log in to save your scores</h2>
          <p class="card-text">Your points and streak follow you to any device, and you can compare with friends.</p>
          <GoogleButton next="/account" />
        </section>
      </PageFrame>
    );
  }

  const { profile } = account;
  const stats = state.stats;
  const link = invitePath ?? account.invitePath;
  const since = new Date(profile.memberSince).toLocaleDateString("en-US", { month: "long", year: "numeric" });

  return (
    <PageFrame title="Account">
      <ProfileCard profile={profile} since={since} />

      <section class="stat-grid" aria-label="Your stats">
        <div class="stat stat-points"><StarIcon size={20} /><strong>{stats.totalPoints}</strong><span>points</span></div>
        <div class="stat stat-wins"><CheckIcon size={20} /><strong>{stats.wins}</strong><span>{stats.wins === 1 ? "win" : "wins"}</span></div>
        <div class="stat stat-streak"><FlameIcon size={20} /><strong>{stats.streak}</strong><span>day streak</span></div>
        <div class="stat stat-best"><FlameIcon size={20} /><strong>{stats.bestStreak}</strong><span>best streak</span></div>
      </section>

      <section class="card" aria-labelledby="sync-title">
        <h2 class="card-title" id="sync-title">Sync</h2>
        <p class="card-text">New wins are saved to your account as soon as you finish a game. Scores from this device are added the first time you log in, and your account’s scores come back to it.</p>
        <SyncControl />
      </section>

      <InviteCard
        path={link}
        onReset={async () => {
          const reply = await accountApi.resetInvite();
          if (!reply.ok) return reply.error;
          setInvitePath(reply.value.invitePath);
          return null;
        }}
      />

      <section class="card" aria-labelledby="friends-title">
        <h2 class="card-title" id="friends-title">
          <UsersIcon size={20} /> Friends
        </h2>
        {friendError ? <p class="card-note sync-error" role="alert">{friendError}</p> : null}
        <ul class="friend-list">
          <li class="friend friend-you">
            <div class="friend-head">
              <Avatar name={profile.username} picture={profile.picture} size={38} />
              <strong class="friend-name">You</strong>
              <span class="chip chip-points"><StarIcon size={14} />{stats.totalPoints}</span>
              <span class={stats.streak > 0 ? "chip chip-streak" : "chip chip-off"}><FlameIcon size={14} />{stats.streak}</span>
            </div>
            <WeekStrip days={days} scores={mine} />
          </li>
          {(friends ?? []).map((friend) => (
            <FriendRow
              key={friend.id}
              friend={friend}
              days={days}
              onRemove={() => {
                void accountApi.unfriend(friend.id).then(loadFriends);
              }}
            />
          ))}
        </ul>
        {friends && friends.length === 0 ? <p class="card-text">No friends yet. Send your private link to someone and their scores will show up here.</p> : null}
      </section>

      <DangerZone />
    </PageFrame>
  );
}
