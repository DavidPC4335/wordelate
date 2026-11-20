import { useRef, useState } from "preact/hooks";

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
  suggestions,
  error,
  locked,
  busy,
  canUndo,
  onQuery,
  onAdd,
  onSubtract,
  onUndo,
}: {
  suggestions: readonly string[];
  error: string | null;
  locked: boolean;
  busy: boolean;
  canUndo: boolean;
  onQuery: (value: string) => void;
  onAdd: (word: string) => boolean;
  onSubtract: (word: string) => boolean;
  onUndo: () => void;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const held = locked || busy;

  function update(next: string) {
    setValue(next);
    onQuery(parseSignedEntry(next, "add").word);
  }

  function submit(raw: string, button: MoveOp) {
    if (held) return;
    const { op, word } = parseSignedEntry(raw, button);
    const ok = op === "add" ? onAdd(word) : onSubtract(word);
    if (!ok) return;
    setValue("");
    onQuery("");
  }

  function choose(word: string) {
    update(word);
    inputRef.current?.focus();
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
          ref={inputRef}
          class="word-input"
          value={value}
          disabled={locked}
          autoCapitalize="none"
          autoComplete="off"
          autoCorrect="off"
          spellcheck={false}
          enterkeyhint="done"
          placeholder="a vocabulary word"
          aria-autocomplete="list"
          aria-controls="suggestions"
          aria-expanded={suggestions.length > 0 && !locked}
          onInput={(event) => update(event.currentTarget.value)}
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
      {suggestions.length > 0 && !locked ? (
        <ul class="suggestions" id="suggestions" role="listbox" aria-label="Suggestions">
          {suggestions.map((word) => (
            <li key={word} role="presentation">
              <button type="button" class="suggestion" role="option" onClick={() => choose(word)}>
                {word}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p class="move-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
