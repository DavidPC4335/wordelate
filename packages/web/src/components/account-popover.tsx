import { useEffect, useRef, useState } from "preact/hooks";
import { isLinked, logout, syncAccount, useAccount } from "../lib/account-store.js";
import { ago, navigate } from "../lib/route.js";
import { Avatar, AppLink, GoogleButton } from "./account-bits.js";
import { StarIcon, FlameIcon, SyncIcon, UserIcon } from "./icons.js";

/**
 * Scores save to the account on their own. The button only appears when this device holds a lot
 * of scores that have not been merged yet, or when the last try failed.
 */
export function SyncControl() {
  const account = useAccount();
  const busy = account.sync.phase === "syncing";
  const failed = account.sync.phase === "error";
  const linked = isLinked(account.account);
  let status: string;
  if (busy) status = "Saving…";
  else if (failed) status = account.sync.message ?? "Could not save. Try again.";
  else if (account.needsConfirm) {
    status = `This device has ${account.localCount} scores to add to your account.`;
  } else if (account.sync.at !== null && linked) status = `Saved to your account ${ago(account.sync.at)}`;
  else status = "Your scores save to your account automatically.";
  const showButton = account.needsConfirm || failed;
  return (
    <div class="sync">
      {showButton ? (
        <button type="button" class="btn btn-small" disabled={busy} onClick={() => void syncAccount()}>
          <SyncIcon size={18} class={busy ? "spin" : undefined} />
          <span>{failed ? "Try again" : "Sync local data with account"}</span>
        </button>
      ) : null}
      <p class={failed ? "sync-note sync-error" : "sync-note"} role="status">
        {status}
        {account.sync.phase === "done" && account.sync.message ? ` ${account.sync.message}` : ""}
      </p>
    </div>
  );
}

/** The small account menu in the header. Admin tools appear only when the server says this account is an admin. */
export function AccountButton({
  onPlayTest,
  onAdmin,
}: {
  onPlayTest?: (start: string, goal: string, threshold: number) => string | null;
  onAdmin?: () => void;
}) {
  const account = useAccount();
  const [open, setOpen] = useState(false);
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

  const [start, setStart] = useState("");
  const [goal, setGoal] = useState("");
  const [threshold, setThreshold] = useState("75");
  const [playError, setPlayError] = useState<string | null>(null);
  const profile = account.account?.profile ?? null;
  const stats = account.stats;
  const staff = Boolean(onPlayTest && onAdmin);
  return (
    <div class="account-wrap" ref={box}>
      <button
        type="button"
        class={profile ? "icon-btn account-btn account-btn-in" : "icon-btn account-btn"}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={profile ? `Account for ${profile.username}` : account.status === "loading" ? "Account" : "Log in"}
        title={profile ? profile.username : account.status === "loading" ? "Account" : "Log in"}
        onClick={() => setOpen((value) => !value)}
      >
        {profile ? <Avatar name={profile.username} picture={profile.picture} size={34} /> : <UserIcon size={20} />}
      </button>
      {open ? (
        <div class="popover" role="dialog" aria-label="Account">
          {profile && stats ? (
            <>
              <div class="pop-who">
                <Avatar name={profile.username} picture={profile.picture} size={44} />
                <div class="pop-who-text">
                  <strong>{profile.username}</strong>
                  <span>{profile.email}</span>
                </div>
              </div>
              <div class="pop-stats">
                <span class="pop-stat pop-stat-points">
                  <StarIcon size={16} />
                  {stats.totalPoints}
                </span>
                <span class="pop-stat pop-stat-streak">
                  <FlameIcon size={16} />
                  {stats.streak}
                </span>
                <span class="pop-stat-label">{stats.wins} {stats.wins === 1 ? "win" : "wins"}</span>
              </div>
              <SyncControl />
              {staff && onPlayTest ? (
                <form
                  class="admin-menu"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const message = onPlayTest(start, goal, Number(threshold));
                    setPlayError(message);
                    if (message === null) {
                      setStart("");
                      setGoal("");
                      setThreshold("75");
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
                  <label class="field">
                    <span class="field-label">Threshold</span>
                    <input
                      class="field-input"
                      inputMode="decimal"
                      value={threshold}
                      onInput={(event) => setThreshold(event.currentTarget.value)}
                    />
                    <span class="field-hint">A win at this closeness, as a percent. 75 is the usual bar.</span>
                  </label>
                  <button type="submit" class="btn btn-small btn-go" disabled={start.trim() === "" || goal.trim() === ""}>
                    Play
                  </button>
                  {playError ? (
                    <p class="move-error" role="alert">
                      {playError}
                    </p>
                  ) : null}
                </form>
              ) : null}
              <div class="pop-actions">
                {staff && onAdmin ? (
                  <button
                    type="button"
                    class="btn btn-small"
                    onClick={() => {
                      setOpen(false);
                      onAdmin();
                    }}
                  >
                    Admin
                  </button>
                ) : null}
                <button
                  type="button"
                  class="btn btn-small btn-ghost"
                  onClick={() => {
                    setOpen(false);
                    navigate("/account");
                  }}
                >
                  Account and friends
                </button>
                <button type="button" class="text-button" onClick={() => void logout().then(() => setOpen(false))}>
                  Log out
                </button>
              </div>
            </>
          ) : account.status === "loading" ? (
            <p class="pop-text">Checking your account…</p>
          ) : (
            <>
              <h3 class="pop-title">Save your scores</h3>
              <p class="pop-text">Log in to keep your points and streak on every device and compare scores with friends.</p>
              <GoogleButton />
            </>
          )}
          <div class="pop-legal-row">
            <a href="/home" class="pop-legal">About</a>
            <AppLink to="/privacy-policy" class="pop-legal">
              Privacy policy
            </AppLink>
          </div>
        </div>
      ) : null}
    </div>
  );
}
