import { useEffect, useState } from "preact/hooks";
import { WORD_ELATE_URL, shareHtml, shareMessage } from "../lib/game.js";
import { CheckIcon, CopyIcon, ShareIcon } from "./icons.js";
import { Modal } from "./modal.js";
import type { GraphShot } from "./path-view.js";

function canSystemShare(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

function aborted(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** Text first, plus the graph when the browser can hold both. Falls back step by step to plain text. */
async function copyToClipboard(text: string, image: GraphShot | null): Promise<void> {
  const clipboard = navigator.clipboard;
  if (!clipboard) throw new Error("Clipboard unavailable");
  const message = shareMessage(text);
  if (typeof ClipboardItem === "undefined" || !clipboard.write) {
    await clipboard.writeText(message);
    return;
  }
  const plain = new Blob([message], { type: "text/plain" });
  const html = new Blob([shareHtml(text, image?.dataUrl ?? null)], { type: "text/html" });
  const attempts: Record<string, Blob>[] = [{ "text/plain": plain, "text/html": html }];
  if (image) {
    attempts.unshift({ "text/plain": plain, "text/html": html, "image/png": image.png });
    attempts.push({ "text/plain": plain, "image/png": image.png });
  }
  for (const parts of attempts) {
    try {
      await clipboard.write([new ClipboardItem(parts)]);
      return;
    } catch {
      // Try the next, simpler item.
    }
  }
  await clipboard.writeText(message);
}

/** The system share sheet: the words, the graph when the device accepts a file, and the game link. */
async function shareWithSystem(text: string, image: GraphShot | null): Promise<void> {
  const data: ShareData = { title: "Wordelate", text, url: WORD_ELATE_URL };
  if (image) {
    const file = new File([image.png], "wordelate.png", { type: "image/png" });
    const withFile: ShareData = { ...data, files: [file] };
    if (typeof navigator.canShare !== "function" || navigator.canShare(withFile)) {
      try {
        await navigator.share(withFile);
        return;
      } catch (error) {
        if (aborted(error)) throw error;
      }
    }
  }
  await navigator.share(data);
}

/** The first word of the message is the game's name. It links to the game. */
function Message({ text }: { text: string }) {
  return (
    <p class="share-text">
      {text.split("\n").map((line, index) => (
        <span class="share-line" key={index}>
          {index === 0 && line.startsWith("Wordelate") ? (
            <>
              <a href={WORD_ELATE_URL} target="_blank" rel="noopener noreferrer">
                Wordelate
              </a>
              {line.slice("Wordelate".length)}
            </>
          ) : (
            line
          )}
        </span>
      ))}
    </p>
  );
}

export function ShareDialog({
  open,
  text,
  capture,
  onClose,
}: {
  open: boolean;
  text: string;
  capture: () => GraphShot | null;
  onClose: () => void;
}) {
  const [includeGraph, setIncludeGraph] = useState(true);
  const [shot, setShot] = useState<GraphShot | null>(null);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setNote(null);
    setIncludeGraph(true);
    try {
      setShot(capture());
    } catch {
      setShot(null);
    }
    // The graph is taken once each time the menu opens.
  }, [open]);

  const image = includeGraph ? shot : null;

  async function copy() {
    if (busy) return;
    setBusy(true);
    try {
      await copyToClipboard(text, image);
      setNote({ text: "Copied! Paste it anywhere.", ok: true });
    } catch {
      setNote({ text: "Could not copy. Select the message and copy it by hand.", ok: false });
    }
    setBusy(false);
  }

  async function share() {
    if (busy) return;
    setBusy(true);
    try {
      await shareWithSystem(text, image);
      setNote({ text: "Shared!", ok: true });
    } catch (error) {
      if (!aborted(error)) setNote({ text: "Could not open sharing. Try Copy instead.", ok: false });
    }
    setBusy(false);
  }

  return (
    <Modal open={open} onClose={onClose} label="Share your result">
      <div class="share-panel">
        <h2 class="panel-title">
          <ShareIcon size={26} />
          Share
        </h2>

        <div class="share-preview">
          <Message text={text} />
          {image ? <img class="share-graph" src={image.dataUrl} alt="Your graph" /> : null}
        </div>

        <label class="switch-row">
          <span class="switch-text">
            Include graph
            <small>{shot ? "A picture of your path" : "Not available right now"}</small>
          </span>
          <input
            type="checkbox"
            role="switch"
            class="switch"
            checked={includeGraph && shot != null}
            disabled={shot == null}
            onChange={(event) => setIncludeGraph(event.currentTarget.checked)}
          />
        </label>

        <div class="share-actions">
          <button type="button" class="btn btn-go" disabled={busy} onClick={() => void copy()}>
            {note?.ok && note.text.startsWith("Copied") ? <CheckIcon size={18} /> : <CopyIcon size={18} />}
            Copy
          </button>
          {canSystemShare() ? (
            <button type="button" class="btn" disabled={busy} onClick={() => void share()}>
              <ShareIcon size={18} />
              Share with…
            </button>
          ) : null}
        </div>
        <p class={note && !note.ok ? "share-status share-status-bad" : "share-status"} role="status" aria-live="polite">
          {note?.text ?? ""}
        </p>
      </div>
    </Modal>
  );
}
