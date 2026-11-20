export function Here({
  words,
  pending,
  won,
}: {
  words: readonly string[];
  pending: boolean;
  won: boolean;
}) {
  const label = pending ? "…" : (words[0] ?? "—");
  const nearby = pending ? [] : words.slice(1);
  return (
    <p class={won ? "here here-won" : "here"} role="status">
      <span class="here-label">You are here</span>
      <span class="here-word">{label}</span>
      {nearby.length > 0 ? <span class="here-more">{nearby.join("  ·  ")}</span> : null}
      {won ? <span class="here-correct">Correct</span> : null}
    </p>
  );
}
