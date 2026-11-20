import { useRef, useState } from "preact/hooks";

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
    onQuery(next);
  }

  function submit(word: string, op: "add" | "subtract") {
    if (held) return;
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
