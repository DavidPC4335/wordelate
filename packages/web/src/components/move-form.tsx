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
  const input = useRef<HTMLInputElement>(null);
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
    const { op, word } = parseSignedEntry(raw, button);
    const resolved = word.length === 0 ? word : resolveWord(word);
    const ok = op === "add" ? onAdd(resolved) : onSubtract(resolved);
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
          aria-describedby={error ? "move-error" : undefined}
          onInput={(event) => setValue(event.currentTarget.value)}
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
      {error ? (
        <p class="move-error" id="move-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
