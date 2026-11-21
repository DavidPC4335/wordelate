import { useEffect, useState } from "preact/hooks";
import { accountApi } from "../lib/account-api.js";
import { useAccount } from "../lib/account-store.js";
import { navigate } from "../lib/route.js";
import { Avatar, AppLink, GoogleButton } from "./account-bits.js";
import { PageFrame } from "./account-page.js";

type Preview = { name: string; picture: string | null; self: boolean; friends: boolean };

type Look = { kind: "loading" } | { kind: "ready"; preview: Preview } | { kind: "bad"; error: string };

/** What a private friend link opens. The link's name is only shown after the person logs in. */
export function FriendPage({ token }: { token: string }) {
  const state = useAccount();
  const [look, setLook] = useState<Look>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signedIn = state.status === "in";

  useEffect(() => {
    if (!signedIn) return;
    if (!token) {
      setLook({ kind: "bad", error: "That link does not work. Ask for a new one." });
      return;
    }
    let cancel = false;
    setLook({ kind: "loading" });
    void accountApi.preview(token).then((reply) => {
      if (cancel) return;
      setLook(reply.ok ? { kind: "ready", preview: reply.value } : { kind: "bad", error: reply.error });
    });
    return () => {
      cancel = true;
    };
  }, [signedIn, token]);

  if (state.status === "loading") {
    return (
      <PageFrame title="Friend link">
        <p class="card-text" aria-busy="true">One moment…</p>
      </PageFrame>
    );
  }

  if (!signedIn) {
    return (
      <PageFrame title="You were invited">
        <section class="card">
          <h2 class="card-title">Add a friend on Wordelate</h2>
          <p class="card-text">Someone sent you a private link. Log in with Google to add them and see each other’s scores.</p>
          <GoogleButton next={token ? `/friend/${token}` : "/"} />
        </section>
      </PageFrame>
    );
  }

  if (look.kind === "loading") {
    return (
      <PageFrame title="Friend link">
        <p class="card-text" aria-busy="true">Checking the link…</p>
      </PageFrame>
    );
  }

  if (look.kind === "bad") {
    return (
      <PageFrame title="Friend link">
        <section class="card">
          <h2 class="card-title">This link does not work</h2>
          <p class="card-text">{look.error}</p>
          <AppLink to="/account" class="btn btn-small btn-ghost">Go to your account</AppLink>
        </section>
      </PageFrame>
    );
  }

  const { preview } = look;
  if (preview.self) {
    return (
      <PageFrame title="Friend link">
        <section class="card">
          <h2 class="card-title">This is your own link</h2>
          <p class="card-text">Send it to a friend instead. You can copy it from your account page.</p>
          <AppLink to="/account" class="btn btn-small">Open my account</AppLink>
        </section>
      </PageFrame>
    );
  }

  return (
    <PageFrame title="Friend link">
      <section class="card card-profile">
        <Avatar name={preview.name} picture={preview.picture} size={64} />
        <div class="profile-text">
          <h2 class="profile-name">{preview.name}</h2>
          <p class="profile-since">{preview.friends ? "You are already friends." : "shared a private friend link with you."}</p>
        </div>
      </section>
      {preview.friends ? (
        <AppLink to="/account" class="btn btn-small">See your friends</AppLink>
      ) : (
        <section class="card">
          <p class="card-text">You will both see each other’s points, streak and scores from the last week. Either of you can remove the other later.</p>
          <div class="card-actions">
            <button
              type="button"
              class="btn btn-go"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const reply = await accountApi.accept(token);
                setBusy(false);
                if (reply.ok) navigate("/account");
                else setError(reply.error);
              }}
            >
              Add {preview.name}
            </button>
            <AppLink to="/" class="text-button">Not now</AppLink>
          </div>
          {error ? <p class="card-note sync-error" role="alert">{error}</p> : null}
        </section>
      )}
    </PageFrame>
  );
}
