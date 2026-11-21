import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { loginUrl } from "../lib/account-api.js";
import { navigate } from "../lib/route.js";
import { GoogleIcon } from "./icons.js";

/** A Google profile picture, or the first letter of the name. The picture never sends a referrer. */
export function Avatar({ name, picture, size = 40 }: { name: string; picture: string | null; size?: number }) {
  const letter = Array.from(name.trim())[0]?.toUpperCase() ?? "?";
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [picture]);
  return (
    <span class="avatar" style={{ "--size": `${size}px` }} aria-hidden="true">
      {picture && !broken ? (
        <img src={picture} alt="" referrerpolicy="no-referrer" loading="lazy" decoding="async" onError={() => setBroken(true)} />
      ) : (
        <span>{letter}</span>
      )}
    </span>
  );
}

export function GoogleButton({ next, label = "Log in with Google" }: { next?: string; label?: string }) {
  return (
    <a class="google-btn" href={loginUrl(next)}>
      <GoogleIcon size={20} />
      <span>{label}</span>
    </a>
  );
}

/** A link inside the app that does not reload the page. */
export function AppLink({ to, class: className, children }: { to: string; class?: string; children: ComponentChildren }) {
  return (
    <a
      class={className}
      href={to}
      onClick={(event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
