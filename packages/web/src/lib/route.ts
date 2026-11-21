import { useEffect, useState } from "preact/hooks";

export type Route = { name: "game" } | { name: "account" } | { name: "privacy" } | { name: "admin" } | { name: "friend"; token: string };

const FRIEND_PATH = /^\/friend\/([0-9a-f-]{36}\.[A-Za-z0-9_-]{22})$/;

export function parseRoute(pathname: string): Route {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (path === "/account") return { name: "account" };
  if (path === "/admin") return { name: "admin" };
  if (path === "/privacy-policy") return { name: "privacy" };
  const friend = FRIEND_PATH.exec(path);
  if (friend?.[1]) return { name: "friend", token: friend[1] };
  // An odd friend link still gets the friend page, which explains that it does not work.
  if (path.startsWith("/friend/")) return { name: "friend", token: "" };
  return { name: "game" };
}

const CHANGED = "wordelate:route";

export function navigate(path: string): void {
  if (window.location.pathname + window.location.search === path) return;
  window.history.pushState(null, "", path);
  window.dispatchEvent(new Event(CHANGED));
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.pathname));
  useEffect(() => {
    const read = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener("popstate", read);
    window.addEventListener(CHANGED, read);
    return () => {
      window.removeEventListener("popstate", read);
      window.removeEventListener(CHANGED, read);
    };
  }, []);
  return route;
}

/** "just now", "5 minutes ago", "yesterday"… for the sync status line. */
export function ago(then: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}
