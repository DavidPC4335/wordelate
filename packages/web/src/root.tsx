import { useEffect, useState } from "preact/hooks";
import { App } from "./app.js";
import { AccountPage } from "./components/account-page.js";
import { AdminPage } from "./components/admin-page.js";
import { AdminTopPage } from "./components/admin-top-page.js";
import { FriendPage } from "./components/friend-page.js";
import { PrivacyPage } from "./components/privacy-page.js";
import { loadAccount } from "./lib/account-store.js";
import { useRoute } from "./lib/route.js";

const NOTICES: Record<string, string> = {
  failed: "That login did not work. Please try again.",
  cancelled: "Login cancelled.",
  busy: "Too many tries. Please wait a little and try again.",
  unavailable: "Login is not available right now.",
};

/** Google sends the person home with ?login=… when something went wrong. Show it once, then tidy the address. */
function useLoginNotice(): [string | null, () => void] {
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("login");
    if (code === null) return;
    setNotice(NOTICES[code] ?? null);
    params.delete("login");
    const rest = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (rest ? `?${rest}` : ""));
  }, []);
  return [notice, () => setNotice(null)];
}

export function Root() {
  const route = useRoute();
  const [notice, dismiss] = useLoginNotice();

  useEffect(() => {
    void loadAccount();
  }, []);

  return (
    <>
      {route.name === "account" ? (
        <AccountPage />
      ) : route.name === "admin" ? (
        <AdminPage />
      ) : route.name === "admin-top" ? (
        <AdminTopPage />
      ) : route.name === "privacy" ? (
        <PrivacyPage />
      ) : route.name === "friend" ? (
        <FriendPage token={route.token} />
      ) : (
        <App />
      )}
      {notice ? (
        <div class="toast" role="alert">
          <span>{notice}</span>
          <button type="button" class="text-button" onClick={dismiss}>
            Dismiss
          </button>
        </div>
      ) : null}
    </>
  );
}
