# Wordelate

Wordelate is a daily word-vector puzzle. Everyone shares a start word and a goal word. Each move adds or subtracts another word. A meter shows the cosine similarity of where you are to the goal. Undo counts as a move. Sixteen moves is the cap.

The embeddings are word2vec Google News, 300 dimensions, L2-normalized, stored as symmetric per-vector int8. The browser does the move math. The Worker does the exact nearest-word scan over those int8 rows. Vectorize, KV, and R2 are not part of the design.

## Local development

pnpm is not installed in this environment. Dependencies were installed with **npm 11.6.2**. The repo is still a workspace either tool can join: `pnpm-workspace.yaml` lists `packages/*`, and the root `package.json` `workspaces` field lists the same glob.

```bash
npm install
npm test
```

`npm test` runs `@wordelate/game-math` only. It does not fail when `packages/worker` or `packages/web` are absent. With pnpm installed, the same tests are `pnpm --filter @wordelate/game-math test`.

`@wordelate/game-math` is pure TypeScript. It has no DOM and no Cloudflare imports. Its tests are Vitest. Typecheck that package with:

```bash
npm run typecheck --workspace=@wordelate/game-math
```

The frontend (`packages/web`) is Vite + Preact. The API (`packages/worker`) is a Cloudflare Worker. Those packages are separate from this math library. Shared rules — stemming, banned operands, replay, cosine, int8 quantize/dequantize — live in `@wordelate/game-math` so the page and the Worker call the same functions.

Do not download the word2vec model to run these tests. Vocabulary build is offline and reads a local gensim cache. That cache is gitignored.

## Layout

```
word-math-game/
  config/game.json          timezone, vocab size, move cap, puzzle cutoffs
  packages/game-math/       shared TypeScript (this package)
  packages/web/             Vite + Preact app
  packages/worker/          Worker API, D1, nearest-word scan
  tools/                    offline vocab build, puzzle generator, review, loader
  puzzles/schedule.json     approved puzzles only
  data/                     gitignored shards, pack, and reports
```

`config/game.json` is the one copy of the numbers. The Worker imports it. The Python tools read it. `game-math` does not load the file; callers pass `maxMoves` and the threshold in.

`tsconfig.base.json` is strict, with `lib` set to ES2022 and no DOM types. The Vite app should add the DOM lib when it extends that file.

## Config

| Field | Role |
| --- | --- |
| `timezone` | Puzzle dates. `America/New_York`. Midnight Eastern is the reset. The browser does not pick the date. |
| `vocabSize` | 40,000 words. |
| `maxMoves` | Player cap, 16. Undo counts. Generator par is a separate, smaller number. |
| `similarityBand` | Direct start–goal cosine must sit in this range, or the pair is dropped. |
| `minSolvableSimilarity` | A path is a solution only at or above this cosine. |
| `thresholdSlack` | Published threshold is the best cosine minus this slack. |
| `minThreshold` | Pairs whose threshold would fall below this are dropped. |
| `beamWidth`, `beamDepth` | Offline beam search. Depth caps par, not the player. |
| `operandPoolSize` | How many top vocab words the generator may use as operands. |
| `nicknameMaxLength` | Optional nickname, 24 characters. Blank displays as `Player` plus the last four hex digits of the id. |
| `rateLimit` | Nearest-word and score limits per minute, by player id and by IP. |

## Adding a puzzle

Puzzle generation stays on a machine you run. A request never loads gensim and never builds a puzzle.

1. Build the vocab from the local word2vec Google News cache, the top `vocabSize` English words, and the blocklist. The build writes quantized shards and the nearest-word pack under `data/` (gitignored).
2. Generate candidate start/goal pairs with the cutoffs in `config/game.json`. Search uses the same quantized bytes the game serves. Each kept candidate has a par solution, a threshold, and a banned-operand list.
3. Review the candidates. Approve, reject, or skip. An approval appends a dated row to `puzzles/schedule.json`. Bias-flagged rows need an explicit approve. Nothing is auto-approved.
4. Load the schedule into D1. The loader writes the solution column; the public "today" query does not return it.

The offline scripts for those steps live under `tools/` (`build_vocab.py`, `generate_puzzles.py`, `review_puzzles.py`, `load_schedule.py`).

## Deployment

Hosting is one Cloudflare Worker plus D1, on Workers Paid, because the nearest-word scan does not fit in the free plan's CPU limit. Static assets serve the Vite app and the vocab pack. Vectorize, KV, and R2 are unused.

The intended custom domain is wordelate.com. There is no deployment yet, and this repo does not publish a live URL.
