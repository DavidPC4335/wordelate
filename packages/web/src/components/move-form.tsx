import { useState } from "preact/hooks";

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
  const held = locked || busy;

  function submit(raw: string, button: MoveOp) {
    if (held) return;
    const { op, word } = parseSignedEntry(raw, button);
    const resolved = word.length === 0 ? word : resolveWord(word);
    const ok = op === "add" ? onAdd(resolved) : onSubtract(resolved);
    if (!ok) return;
    setValue("");
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
      <div class="entry-head">
        <label class="word-label" for="word">
          Word
        </label>
        <button type="button" class="undo" disabled={held || !canUndo} onClick={onUndo}>
          Undo
        </button>
      </div>
      <div class="entry">
        <input
          id="word"
          class="word-input"
          value={value}
          disabled={locked}
          autoCapitalize="none"
          autoComplete="off"
          autoCorrect="off"
          spellcheck={false}
          enterkeyhint="done"
          placeholder="a vocabulary word"
          onInput={(event) => setValue(event.currentTarget.value)}
        />
        <button type="submit" class="op" aria-label="Add" disabled={held}>
          +
        </button>
        <button
          type="button"
          class="op"
          aria-label="Subtract"
          disabled={held}
          onClick={() => submit(value, "subtract")}
        >
          −
        </button>
      </div>
      {error ? (
        <p class="move-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
