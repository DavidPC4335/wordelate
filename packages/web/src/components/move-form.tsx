import { useEffect, useRef, useState } from "preact/hooks";
import { MinusIcon, PlusIcon, UndoIcon } from "./icons.js";

export type MoveOp = "add" | "subtract";

/** A leading "+" adds. A leading "-" or "−" subtracts. The sign is stripped. With no sign, the button decides. */
export function parseSignedEntry(raw: string, button: MoveOp): { op: MoveOp; word: string } {
  const trimmed = raw.trim();
  if (trimmed.startsWith("+")) return { op: "add", word: trimmed.slice(1).trim() };
  if (trimmed.startsWith("-") || trimmed.startsWith("−")) {
    return { op: "subtract", word: trimmed.slice(1).trim() };
  }
  return { op: button, word: trimmed };
}

function leadingSign(raw: string): "" | "+" | "-" | "−" {
  const trimmed = raw.trim();
  if (trimmed.startsWith("+")) return "+";
  if (trimmed.startsWith("−")) return "−";
  if (trimmed.startsWith("-")) return "-";
  return "";
}

export type PreparedEntry =
  | { action: "submit"; op: MoveOp; word: string }
  | { action: "correct"; value: string; from: string; to: string };

/**
 * A spelling fix is shown and held for another submit. An exact word, or a
 * change of case only, goes through on the first press.
 */
export function prepareEntry(raw: string, button: MoveOp, resolve: (word: string) => string): PreparedEntry {
  const { op, word } = parseSignedEntry(raw, button);
  if (word.length === 0) return { action: "submit", op, word };
  const resolved = resolve(word);
  if (resolved.length === 0 || resolved.toLowerCase() === word.toLowerCase()) {
    return { action: "submit", op, word: resolved.length === 0 ? word : resolved };
  }
  const sign = leadingSign(raw);
  return { action: "correct", value: sign ? `${sign}${resolved}` : resolved, from: word, to: resolved };
}

export function MoveForm({
  error,
  locked,
  busy,
  canUndo,
  resolveWord,
  onAdd,
  onSubtract,
  onUndo,
}: {
  error: string | null;
  locked: boolean;
  busy: boolean;
  canUndo: boolean;
  resolveWord: (word: string) => string;
  onAdd: (word: string) => boolean;
  onSubtract: (word: string) => boolean;
  onUndo: () => void;
}) {
  const [value, setValue] = useState("");
  const [shake, setShake] = useState(0);
  const [fix, setFix] = useState<{ from: string; to: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  // The corrected text we just wrote. An input event from that write must not hide the note.
  const shown = useRef<string | null>(null);
  const row = useRef<HTMLDivElement>(null);
  const held = locked || busy;

  // A rejected word wiggles the row once, so the error is noticed even on a small screen.
  useEffect(() => {
    if (shake === 0) return;
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || typeof row.current?.animate !== "function") return;
    row.current.animate(
      [
        { transform: "translateX(0)" },
        { transform: "translateX(-7px)" },
        { transform: "translateX(6px)" },
        { transform: "translateX(-4px)" },
        { transform: "translateX(0)" },
      ],
      { duration: 340, easing: "ease-out" },
    );
  }, [shake]);

  function submit(raw: string, button: MoveOp) {
    if (held) return;
    const live = input.current?.value ?? raw;
    const prepared = prepareEntry(live, button, resolveWord);
    if (prepared.action === "correct") {
      shown.current = prepared.value;
      setValue(prepared.value);
      setFix({ from: prepared.from, to: prepared.to });
      input.current?.focus();
      return;
    }
    shown.current = null;
    setFix(null);
    const ok = prepared.op === "add" ? onAdd(prepared.word) : onSubtract(prepared.word);
    if (!ok) {
      setShake((n) => n + 1);
      return;
    }
    setValue("");
    input.current?.focus();
  }

  return (
    <form
      class="move-form"
      aria-busy={busy}
      onSubmit={(event) => {
        event.preventDefault();
        submit(value, "add");
      }}
    >
      <label class="sr-only" for="word">
        Word to add or subtract
      </label>
      <div class="entry" ref={row}>
        <input
          id="word"
          ref={input}
          class="word-input"
          value={value}
          disabled={locked}
          autoCapitalize="none"
          autoComplete="off"
          autoCorrect="off"
          spellcheck={false}
          enterkeyhint="done"
          placeholder={locked ? "Round over" : "Type a word"}
          aria-invalid={error ? true : undefined}
          aria-describedby={[fix ? "move-fix" : null, error ? "move-error" : null].filter(Boolean).join(" ") || undefined}
          onInput={(event) => {
            const next = event.currentTarget.value;
            setValue(next);
            if (shown.current !== null && next === shown.current) return;
            shown.current = null;
            setFix(null);
          }}
        />
        <button type="submit" class="op op-add" aria-label="Add this word" disabled={held}>
          <PlusIcon size={26} />
        </button>
        <button
          type="button"
          class="op op-sub"
          aria-label="Subtract this word"
          disabled={held}
          onClick={() => submit(value, "subtract")}
        >
          <MinusIcon size={26} />
        </button>
        <button
          type="button"
          class="op op-undo"
          aria-label="Undo last move"
          title="Undo (counts as a move)"
          disabled={held || !canUndo}
          onClick={onUndo}
        >
          <UndoIcon size={22} />
        </button>
      </div>
      {fix ? (
        <p class="move-fix" id="move-fix" role="status">
          <span class="move-fix-from">{fix.from}</span>
          <span aria-hidden="true">→</span>
          <span class="move-fix-to">{fix.to}</span>
        </p>
      ) : null}
      {error ? (
        <p class="move-error" id="move-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
