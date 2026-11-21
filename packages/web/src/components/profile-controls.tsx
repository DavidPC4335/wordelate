import { useState } from "preact/hooks";
import { updateProfile, useAccount } from "../lib/account-store.js";

/**
 * "Show my profile picture on the leaderboard". Only the link to the picture is ever kept,
 * never the image. Hidden here also hides it from friends.
 */
export function PictureToggle({ onChanged }: { onChanged?: () => void }) {
  const account = useAccount();
  const profile = account.account?.profile ?? null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!profile || !profile.picture) return null;
  return (
    <div class="picture-toggle">
      <label class="check">
        <input
          type="checkbox"
          checked={profile.showPicture}
          disabled={busy}
          onChange={async (event) => {
            const next = event.currentTarget.checked;
            setBusy(true);
            const message = await updateProfile({ showPicture: next });
            setBusy(false);
            setError(message);
            if (!message) onChanged?.();
          }}
        />
        <span>Show my profile picture on the leaderboard</span>
      </label>
      {error ? <p class="card-note sync-error" role="alert">{error}</p> : null}
    </div>
  );
}
