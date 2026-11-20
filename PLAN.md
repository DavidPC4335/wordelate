# Wordelate plan (Phase 0)

Written 2026-11-19. Cost decision revised the same day after a second read of the Vectorize pricing and query pages. This is a plan only. No application code, scaffolding, package installs, or model download.

Limits and prices below were read that day from the Cloudflare docs pages linked next to each number. A docs-search call on the revision pass returned no text; the billing formula and the query API were taken from the fetched pages, not from the earlier draft.

## Workspace

`/home/david/word-math-game` has no application source. The only file present is `.cursor/settings.json`. There is no `package.json`, Worker config, Python tooling, or data directory.

## Product choices already fixed

- Embeddings: `word2vec-google-news-300` through `gensim.downloader`. No other model and no embedding API.
- Hosting: one Cloudflare Worker with [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/). Pages can host the same files, and its file cap is the same 25 MiB, but new apps should be Workers plus static assets. Pages is not the plan.
- D1 holds puzzles and scores. Vectorize, KV, and R2 are not part of the design. The embedding pack fits in one static asset, so R2 is unnecessary (no R2 pricing is quoted).
- The browser does vector math, similarity, move checks, win detection, and UI state. The Worker serves vectors (as static files), the daily puzzle, nearest-word lookup, and leaderboards.
- Vocabulary build and puzzle generation are offline Python. Nothing in a request loads gensim or builds a puzzle.

Game rules are unchanged: shared daily START and GOAL, one `+word` or `−word` per move, warm/cold cosine to GOAL, "You are here" is the nearest vocab word excluding START and every operand already used, win at the puzzle threshold, fewer moves is better, undo counts as a move, give-up shows a known solution, par is the offline best move count.

---

## 1. Nearest-word approach

**Decision: exact brute-force scan of the int8 pack inside the Worker.** Workers Paid is the plan that scan requires. Vectorize is not used. The reasoning and the bill are in "Decision" below.

The scan is one dot product per row over 40,000 int8 vectors of 300 dimensions, using a single `Int8Array` loaded lazily from a static asset and kept for the life of the isolate. Free-plan CPU is 10 ms, which cannot finish that scan. Paid CPU can, inside the default 30 second limit, with memory to spare. More isolates absorb more traffic; nothing is resized by hand.

### Limits that decide it

Fetched 2026-11-19.

| Limit | Free | Paid | Source |
| --- | --- | --- | --- |
| Worker CPU per HTTP request | 10 ms | 5 min cap, default 30 s (`limits.cpu_ms` default 30000, max 300000) | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) |
| Worker memory per isolate | 128 MB | 128 MB | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) |
| Worker script size | 64 MiB uncompressed (no gzip cap) | 64 MiB uncompressed | same |
| Worker startup (global scope) | 1 s | 1 s | same |
| Static asset file size | 25 MiB | 25 MiB | same, and [Pages limits](https://developers.cloudflare.com/pages/platform/limits/) for a Pages asset |
| Static asset file count | 20,000 per Worker version | 100,000 | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) |
| Pages file count | 20,000 | 100,000 (Pro, Business, Enterprise) | [Pages limits](https://developers.cloudflare.com/pages/platform/limits/) |
| Worker requests | 100,000 / day | 10 million / month included, then $0.30 / million. Paid plan minimum $5 / month | [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) |
| Paid CPU allotment | — | 30 million CPU-ms / month included, then $0.02 / million ms | same |

Vectorize, same fetch, from [limits](https://developers.cloudflare.com/vectorize/platform/limits/), [pricing](https://developers.cloudflare.com/vectorize/platform/pricing/), and [create indexes](https://developers.cloudflare.com/vectorize/best-practices/create-indexes/):

- Dimensions: maximum 1536, precision 32-bit float32 only. 300-d fits. int8 and float16 do not; an index would store float32.
- Metrics: `cosine`, `euclidean`, and `dot-product`. Cosine is the right setting for these unit vectors. For L2-normalized vectors, cosine order and dot-product order match.
- Vectors per index: 20,000,000. A 50k vocab fits the count cap.
- Metadata: 10 KiB per vector. Word ids are capped at 64 bytes. Ordinary English words fit in the id, so metadata is unnecessary.
- `topK`: 50 with values or metadata, 100 without.
- Indexes: 100 on Free. Paid default 50,000, first 50,000 included, then $0.10 per index per month.
- Namespaces: 1,000 Free / 50,000 Paid.
- Stored dimensions included: 5 million on Free; 10 million on Paid, then $0.05 per 100 million. See the decision section for the queried-dimension formula, which was re-read from the pricing page on this revision.
- Query options on the client API are `topK`, `returnValues`, and `returnMetadata`. There is no exact-search flag. Details under Decision.

40,000 × 300 = 12,000,000 stored dimensions.

- Free included storage is 5,000,000 dimensions, about 16,600 vectors at 300-d. A 30–50k index is outside the free allocation.
- Paid includes 10,000,000 stored dimensions. A 40,000-vector index is 2,000,000 over, about $0.001 / month at $0.05 per 100 million. That price is not why Vectorize is out. It is out because it cannot return the int8 argmax. See Decision.

D1, from [limits](https://developers.cloudflare.com/d1/platform/limits/) and [pricing](https://developers.cloudflare.com/d1/platform/pricing/). Rows per table are unlimited apart from storage. This game stores thousands of rows, so row count is irrelevant.

| | Free | Paid |
| --- | --- | --- |
| Database size | 500 MB | 10 GB |
| Account storage | 5 GB | 1 TB in the limits table (a footnote was attached; its text was not in the fetch). Paid pricing includes the first 5 GB, then $0.75 / GB-month |
| Databases | 10 | 1,000,000 cap; first 100,000 included, then $0.10 each |
| Rows read | 5 million / day | 25 billion / month included, then $0.001 / million |
| Rows written | 100,000 / day | 50 million / month included, then $1.00 / million |
| Queries per Worker invocation | 50 | 1,000 |
| Max row / string / blob | 2 MB | 2 MB |

One puzzle-and-scores database stays inside the free D1 quotas easily. D1 is not why the design uses Workers Paid. The scan's CPU time is.

### What the scan costs

Use N = 40,000 and D = 300. One nearest lookup is N dot products: **12,000,000 multiply-adds**, plus one scale multiply per row if the quantizer is per-vector int8. The matrix is **12,000,000 bytes (11.44 MiB)** of int8, plus 40,000 float16 scales (80,000 bytes). Word strings are a few hundred kilobytes.

Memory: an `Int8Array` plus scales and a string table is about 13 MB. The isolate limit is 128 MB on both plans, so the matrix fits. A `number[][]` does not: JavaScript numbers are float64, and 40,000 × 300 × 8 bytes is already 96 MB before object overhead. The implementation must scan typed arrays.

CPU, optimistic bound, not a Workers benchmark: 12e6 multiply-adds at an unrealistically fast 1e9 per second is **12 ms of pure arithmetic**. That is already over the free plan's **10 ms**, before dequantizing, skipping banned rows, and writing JSON. A realistic JavaScript loop is slower than that bound. The free plan does not fit, even before a cold load.

Paid default CPU is 30 seconds, and the cap can be raised to 5 minutes. A scan that lands anywhere from a few milliseconds in WASM to a couple of hundred milliseconds in plain TypeScript is still far under 30 seconds. Phase 3 should time the plain TypeScript scan first. Add a WASM kernel only if warm p95 on `wrangler dev` is over about 150 ms. Do not block the design on WASM.

Cold start: do not parse the matrix in global scope. Startup must finish in 1 second, and a 12 MB parse there risks deploy failure (`Script startup exceeded CPU time limit`, error 10021). Lazy-load on the first nearest or score request via the assets binding, then keep the read-only arrays in module scope for that isolate. The asset fetch itself is waiting, which does not count as CPU; the copy into the typed array does, and it is small next to 30 seconds. Module scope is only for this immutable table, not for per-request state.

The pack is a static asset, not part of the Worker script. 11.44 MiB is under the 25 MiB asset cap and under the 64 MiB script cap, but bundling it would slow startup for every request path, including puzzle and leaderboard. Leave it as a file. Vocabulary size is 40,000, so this is the pack the Worker ships.

### Decision

Three filters, in order. A design that fails an earlier filter is out, even if it looks cheaper.

**1. Functionality.** "You are here" is the true nearest of the 40,000 int8 rows the client uses. The Worker scans those rows.

Vectorize does not qualify. Checked 2026-11-19:

- Stored precision is 32-bit float32 only ([Vectorize limits](https://developers.cloudflare.com/vectorize/platform/limits/)). An index cannot hold the int8 rows. A float32 argmax can disagree with the int8 argmax.
- The query API has no exact-scan flag. Options are `topK`, `returnValues`, and `returnMetadata` ([client API](https://developers.cloudflare.com/vectorize/reference/client-api/)).
- High precision is `returnValues: true`. The query page says this uses the original vector values "allowing the computation of exact match scores and increasing the accuracy of the results." Approximate scoring is the default, and those scores "will be an approximation." Exact scores on the matches an approximate search already returned is not a promise that the match is the nearest of all 40,000 rows ([query vectors](https://developers.cloudflare.com/vectorize/best-practices/query-vectors/)).

Vectorize is dropped. KV and R2 stay unused. The int8 pack is a static asset under the 25 MiB file cap.

**2. Cost.** Prices re-read 2026-11-19 from [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) and [Vectorize pricing](https://developers.cloudflare.com/vectorize/platform/pricing/).

Workers Paid is a **$5 / month** minimum. It includes **10 million requests / month**, then **$0.30 / million**, and **30 million CPU-ms / month**, then **$0.02 / million ms**. "Requests to static assets are free and unlimited." Subrequests are not billed as requests. Free CPU is **10 ms / invocation**, so the scan cannot run on Free. The $5 is in the bill because the scan needs Paid, and because a traffic spike has to keep being served (filter 3). It is not a goal of its own.

Vectorize queried dimensions, quoted from that pricing page: 10,000 stored vectors, 100 queries, 384 dimensions, total **3.878 million**, written as `(10000 + 100) * 384`. The dollar formula on the same page is `((queried vectors + stored vectors) * dimensions * ($0.01 / 1,000,000)) + (stored vectors * dimensions * ($0.05 / 100,000,000))`. "Queried vectors" in that formula is the query count. So:

**queried dimensions = (query count + stored vector count) × dimensions**

That is not "dimensions of the query vector alone," and it is not "query count × stored count × dimensions." Paid includes the first **50 million** queried dimensions / month, then **$0.01 / million**, and the first **10 million** stored dimensions, then **$0.05 / 100 million**. The dollar formula above does not subtract those allotments; the bill below does, using the included amounts in the pricing table.

One game is one player finishing one puzzle. The meter calls nearest once per move event. The main case is **8** nearest calls (real moves plus some undos, under the cap). The cap case is **16**, the player maximum, every game. Other API calls are puzzle, score, and leaderboard: **3** requests, a few milliseconds, ignored in the CPU total because they do not move it. Shard and script downloads are static assets and cost $0. D1 for this many score rows stays inside the paid included reads and writes. Scan CPU on Workers has not been measured. The two figures below are planning assumptions, not benchmarks: **50 ms** for a tight typed-array loop, **150 ms** for a slow one. Phase 3 replaces them with a measurement. The arithmetic floor of 12 ms at 1e9 multiply-adds per second is not used as a price, because a JavaScript loop will not hit it.

Hobby, **10,000 games / month**. Even the heavy case, 16 × 150 ms, is 24,000,000 CPU-ms, under the 30,000,000 included. Requests at 19 per game are 190,000, under 10,000,000. Static assets $0. Vectorize $0 because it is not in the design.

**Hobby bill: $5.00 / month.** That is the Paid subscription. Usage charges are $0 inside the included requests and CPU.

Spike, **1,000,000 games / month**. CPU overage is `(games × nearest calls × scan ms − 30,000,000) / 1,000,000 × $0.02`. Request overage is `(games × API calls − 10,000,000) / 1,000,000 × $0.30`.

| Case | CPU | Requests | Subscription | Total |
| --- | --- | --- | --- | --- |
| 8 calls, 50 ms | $7.40 | $0.30 | $5.00 | **$12.70** |
| 8 calls, 150 ms | $23.40 | $0.30 | $5.00 | **$28.70** |
| 16 calls, 50 ms | $15.40 | $2.70 | $5.00 | **$23.10** |
| 16 calls, 150 ms | $47.40 | $2.70 | $5.00 | **$55.10** |

The floor is $5 until CPU passes 30,000,000 ms. At 8 × 50 ms (400 ms/game) that is 75,000 games. At 8 × 150 ms (1,200 ms/game) it is 25,000 games. Request overage starts later, around 909,000 games at 11 requests each. After that, marginal cost per extra game, CPU plus the request overage, is about **$0.000011** at 50 ms and 8 calls (about $1.13 per 100,000 games) and about **$0.000027** at 150 ms and 8 calls (about $2.73 per 100,000 games).

Vectorize, same 8 calls per game, priced only to show it is not a cheaper intact option. 40,000 × 300 = 12,000,000 stored dimensions. Paid includes 10,000,000, so storage overage is 2,000,000 × $0.05 / 100,000,000 = **$0.001 / month**. Hobby query count 80,000: queried dimensions `(80,000 + 40,000) × 300 = 36,000,000`, under 50,000,000 included, so **$0**. At 1,000,000 games the query count is 8,000,000: `(8,000,000 + 40,000) × 300 = 2,412,000,000` dimensions, minus 50,000,000 included, times $0.01 / million = **$23.62**. Each nearest call is still an inbound Worker request, so add the same $5 and the same $0.30 request overage: about **$28.92**, before any Worker CPU on that path (not measured; waiting on the binding is not CPU). That sits next to the exact scan's $12.70 (50 ms) or $28.70 (150 ms). A slow scan ties Vectorize on dollars. A fast scan beats it. Neither price matters, because Vectorize already failed filter 1.

Running the same int8 scan in the browser would zero the Worker CPU line and leave a spike near the $5 floor, since static assets are free. It would also make every phone download the full 11.44 MiB pack instead of the letter shards in section 2. Hobby traffic is $5 either way. The shard transport stays, and the server keeps the nearest lookup.

**3. Autoscale.** [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) say Workers scale automatically across the network and there is no general limit on requests per second. A spike is more isolates, each with its own lazy-loaded copy of the pack. No capacity number to raise, no larger machine, no redeploy. The free plan's 100,000 requests/day does stop serving (error 1027), which is why the spike case is Paid.

The per-player nearest limit in section 6 stays. It is abuse protection. A game of at most 16 moves fits under it. Do not set a Workers spending limit. The pricing page says that limit blocks new invocations and can interrupt every Worker on the account. An email billing alert is the right alarm; the same page says to configure one when you want mail without blocking usage. Leave the per-request CPU default at 30 seconds so one request cannot run to the 5 minute cap. That cap bounds a single call. It does not turn players away when the month gets busy.

**Chosen design:** the Worker scans the int8 pack. Workers Paid is required for that scan and for unattended growth. At 10,000 games the bill is the $5 floor. At 1,000,000 games with 8 nearest calls, the charge above that floor is $7.70 if a scan takes 50 ms and $23.70 if it takes 150 ms. The platform adds isolates by itself. Vectorize is not the cheaper intact option.

---

## 2. Vector transport format and sharding

### Sizes for 40,000 words × 300 dims

Raw matrix only, no headers and no word strings:

| dtype | Bytes | MiB (÷ 1024²) | One 25 MiB static file? |
| --- | --- | --- | --- |
| float32 | 48,000,000 | 45.78 | No |
| float16 | 24,000,000 | 22.89 | Yes, with about 2 MiB of headroom |
| int8 | 12,000,000 | 11.44 | Yes |

Per-vector float16 scales add 40,000 × 2 = 80,000 bytes (0.08 MiB). Length-prefixed words at roughly 8 bytes average add about 0.3 MiB.

Vocabulary size is **40,000**. The other rows are only a file-size check, not an open choice:

| Words | float32 | float16 | int8 |
| --- | --- | --- | --- |
| 30,000 | 34.33 MiB | 17.17 MiB | 8.58 MiB |
| 40,000 | 45.78 MiB | 22.89 MiB | 11.44 MiB |
| 50,000 | 57.22 MiB | 28.61 MiB | 14.31 MiB |

At 40,000 words the int8 pack is one static file (11.44 MiB). float16 at the same size is 22.89 MiB and still one file, which is the fallback if int8 misses the ship gate.

### Quantization

Default: **symmetric per-vector int8**.

- L2-normalize the float32 vector first.
- `scale = max(|x_i|) / 127`.
- Store `round(x_i / scale)` clamped to [−127, 127], and the float16 scale. Leave −128 unused so the range is symmetric.
- Reconstruct as `float32(q) * scale`.

Also compute a **global scale** variant in the same report (one scale for the whole matrix). Unit vectors have a similar magnitude, but a few peaky dimensions can crush the rest to zero under a global scale. The Phase 1 checkpoint picks one variant and writes that name into the manifest. The game ships one.

The client, the nearest scan, and score verification all dequantize these bytes. They do not keep a parallel float32 copy.

### What the preprocessing script must print

Run both candidate quantizers. Queries should look like real positions: L2-normalized sums of 1 to 4 random vocab vectors, not only single words.

- 2,000 sum-queries. For each, cosine against 200 random vocab words in float32 and in dequantized values. Report mean, p95, and max of `|cosine_f32 − cosine_q|`.
- Top-1 nearest-neighbor disagreement on those 2,000 queries (float32 argmax vs quantized argmax), plus how often the float32 top-1 is still inside the quantized top-5.
- 500 single-word queries: the word itself should be its own nearest neighbor. Report the miss count.
- A fixed sample of 20 words with their 5 nearest neighbors in float32 and in quantized space, printed so a human can see whether neighbors are still synonyms.

**Ship gate:** p95 absolute cosine error ≤ 0.01, and top-1 disagreement ≤ 1% on the sum queries, and zero self-misses on the 500 single-word queries. If per-vector int8 fails and global int8 fails, ship float16 instead. At 40,000 words, float16 still fits in one asset (22.89 MiB). Prefer to pass the int8 gate.

### Shards

Prefer static files. Workers Static Assets are cached at the edge ([static assets](https://developers.cloudflare.com/workers/static-assets/)). A Worker in front of every embedding fetch adds a request and a CPU bill for bytes the CDN can serve directly. No doc limit found here argues for proxying them.

**Scheme: one shard per first letter, `a`–`z`.** The vocab is lowercase `a`–`z` only, so 26 shards. A heavy letter is still small: 15% of 40k is 6,000 words × about 310 bytes ≈ 1.9 MiB, far under 25 MiB. Two-letter prefixes would be about 676 tiny files, more requests, and worse cache use, without staying under any cap we would otherwise hit (26 files is nowhere near 20,000).

On each puzzle load the browser fetches the shards for START and GOAL. Each new operand fetches its letter shard if that letter is not already in memory. Shards are immutable and content-addressed:

- `/vocab/<content-hash>/a.bin` … `z.bin`
- `/vocab/<content-hash>/nearest.i8` (the worker's scan pack)
- `/vocab/<content-hash>/manifest.json` (counts, quantizer name, dims, per-file sha256)
- `/vocab/current.json` is a tiny pointer `{ "hash": "…" }` with a short cache lifetime. Hashed files use a long `Cache-Control` via `_headers`.

The puzzle JSON includes `vocabVersion` equal to that hash, so an open tab stays on one vocab.

Letter-shard record, little-endian, words sorted:

- header: magic, format version, count, dims = 300, quantizer id
- records: `u8` length, UTF-8 word, `f16` scale, `i8[300]`

The nearest pack is columnar so the scan is sequential:

- `u32` count, `u16` dims
- `f16` scales[count]
- `i8` matrix[count × 300], row-major, same row order
- length-prefixed words in that same order

The build writes shards and the pack from one in-memory array. A check in the preprocessing report compares a sample of shard rows to pack rows and fails the build on any mismatch.

How the nearest service gets the matrix: **Workers Static Assets, read through the assets binding, cached in the isolate.** Not bundled into the script (startup time, and puzzle requests should not carry it). Not R2 (the file is under 25 MiB and should be a versioned site asset). Not Vectorize (section 1).

### Vocab pipeline (offline)

1. Load `word2vec-google-news-300` from the local gensim cache. The file is a multi-gigabyte download. Gitignore it. Do not commit it.
2. Keep tokens that are entirely `a`–`z` after lowercasing. Drop phrases, underscores, digits, and punctuation. If several casings exist, keep the vector only when the all-lowercase key itself exists. Do not average casings.
3. Intersect with the `wordfreq` top 40,000 English words (`vocabSize` in `config/game.json`).
4. Remove any word on the editable blocklist `tools/blocklist.txt`.
5. L2-normalize, quantize, write shards, pack, manifest, and the stats report (vocab size, letter histogram, quantizer errors, sample neighbors).

---

## 3. Frontend framework

**Vite + Preact + TypeScript.**

Preact is a few kilobytes and is enough for one mobile screen (equation, meter, nearest word, undo, give up, leaderboard) without a React-sized tree. Vite talks to the Cloudflare Vite plugin, so `wrangler dev` serves the page and the API together.

Put shared math in `packages/game-math`, imported by `packages/web` and `packages/worker`:

- dequantize int8
- add and subtract a word vector
- cosine of two reconstructed vectors (divide by both norms; quantized vectors are not exactly unit length)
- replay a move log, including undo
- stem / variant check and "word used twice" check
- win test against the puzzle threshold

Python keeps a tested mirror of dequant, cosine, and the stem rule for offline generation. Fixture files shared by `pytest` and the TypeScript tests lock them together. Score verification imports `game-math`; it does not reimplement the arithmetic.

---

## 4. Repository structure and data flow

```
word-math-game/
  PLAN.md
  package.json                 pnpm workspace
  packages/game-math/          shared TypeScript
  packages/worker/             Worker API, wrangler.jsonc, D1 migrations
  packages/web/                Vite + Preact SPA
  config/game.json             America/New_York, 40,000 words, maxMoves 16, thresholds, paths
  tools/
    blocklist.txt
    bias_lexicon.tsv           word, category
    irregular_variants.txt
    build_vocab.py
    generate_puzzles.py
    review_puzzles.py
    load_schedule.py
    fixtures/                  shared numeric fixtures
  puzzles/schedule.json        approved puzzles only
  data/                        gitignored build output (shards, pack, reports)
```

`wrangler.jsonc` uses compatibility date `2026-11-19`, `observability.enabled` and `observability.traces.enabled`, an assets directory for the built SPA plus `data/vocab`, `not_found_handling: single-page-application`, and `run_worker_first: ["/api/*"]`. D1 binding and a rate-limit binding live there. Dev and production are Wrangler environments with separate D1 databases. `config/game.json` is imported by the Worker and read by Python so the numbers stay in one place.

Data flow:

1. **Raw model.** `build_vocab.py` reads the gensim cache plus `wordfreq`, the blocklist, and `config/game.json`.
2. **Vocab artifacts.** It writes `data/vocab/<hash>/` shards, `nearest.i8`, `manifest.json`, and `data/reports/quantization.json`.
3. **Candidates.** `generate_puzzles.py` reads the quantized pack (the same bytes the game will serve), searches pairs, and writes `data/candidates.json` with par solutions, thresholds, banned lists, and bias flags.
4. **Review.** `review_puzzles.py` shows candidates. Approval appends to `puzzles/schedule.json`.
5. **D1.** `load_schedule.py` upserts the schedule into the target database (local or remote). The solution column is written here and is not part of the public today query.
6. **Serve.** Deploy uploads the SPA, the hashed vocab files, and the Worker. `GET /api/puzzle/today` reads D1. The browser pulls letter shards as static files. `POST /api/nearest` and `POST /api/score` load `nearest.i8` from assets and use `game-math`.

No step in that loop runs inside a request except the last one, and the request never generates a puzzle or touches gensim.

---

## 5. D1 schema

Dates are `YYYY-MM-DD` in the configured timezone. The Worker computes "today" in that zone. The browser does not pick the puzzle date.

```sql
CREATE TABLE puzzles (
  puzzle_date   TEXT PRIMARY KEY,
  start_word    TEXT NOT NULL,
  goal_word     TEXT NOT NULL,
  threshold     REAL NOT NULL,
  par           INTEGER NOT NULL,
  max_moves     INTEGER NOT NULL,
  banned_json   TEXT NOT NULL,   -- irregulars plus stemmer output, for the client
  solution_json TEXT NOT NULL,   -- known par solution; never selected by /today
  vocab_hash    TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE runs (
  puzzle_date TEXT NOT NULL,
  player_id   TEXT NOT NULL,     -- uuid from the browser
  started_at  TEXT NOT NULL,     -- server time of first seen request
  PRIMARY KEY (puzzle_date, player_id)
);

CREATE TABLE scores (
  puzzle_date    TEXT NOT NULL,
  player_id      TEXT NOT NULL,
  nickname       TEXT,           -- null if they skipped it
  moves          INTEGER NOT NULL,
  similarity     REAL NOT NULL,  -- server-computed
  elapsed_ms     INTEGER NOT NULL,
  move_list_json TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  PRIMARY KEY (puzzle_date, player_id)
);

CREATE INDEX scores_rank ON scores (puzzle_date, moves, similarity DESC, elapsed_ms);
```

`GET /api/puzzle/today` selects every puzzle column except `solution_json`.

`runs` exists so the time tie-break is server time. The first request that carries a player id inserts `started_at` with `ON CONFLICT DO NOTHING`. Elapsed time at score submit is `now - started_at`. A reload does not reset the clock. The client-supplied duration is ignored.

Scores: one row per player per puzzle. `INSERT … ON CONFLICT DO NOTHING`. If the row already exists, return it and do not update. First verified submission wins.

Player id: `crypto.randomUUID()` stored in `localStorage`. Nickname is optional, up to 24 characters, stored on the score row. Empty nickname displays as `Player` plus the last 4 hex digits of the id.

v1 accepts many localStorage ids from one person. That is an accepted limit. There is no account system in this plan.

`max_moves` is **16** on every row loaded from the schedule. That is the player cap, including undos. Generator par stays at most 4 and is a different number. A later puzzle may store a lower cap; the config default the loader writes is 16.

`banned_json` is the precomputed list (stemmer output for START and GOAL, plus irregulars). The public payload includes it so the client can reject a move without a round trip. It is not the solution.

---

## 6. API sketch

All dates use `America/New_York`, the timezone in `config/game.json`. Responses are JSON. `maxMoves` in the today payload is **16**.

**`GET /api/puzzle/today?playerId=`**

Returns `{ date, timezone, start, goal, threshold, par, maxMoves, banned, vocabVersion, stemRule }`. No solution. If `playerId` is present, ensure a `runs` row. Missing or bad id still returns the puzzle; the clock starts when a valid id arrives.

**`GET /api/puzzle/:date/solution?reveal=win|giveup`**

- Past date: always return `{ date, solution }` where solution is the stored move list, for example `["-water", "+sand"]`.
- Future date: 404.
- Today: return the solution only when `reveal` is `win` or `giveup`. This check is unauthenticated and honor-system, as specified. It exists so a normal today fetch does not include the answer.

**`POST /api/nearest`**

Body: `{ date, moves: Move[] }`. `Move` is `{ "op": "+" | "-" | "undo", "word"?: string }`. Undo has no word.

The Worker loads START from the pack, replays the log with `game-math`, then scans. It does not trust a client-supplied vector. Response: `{ word, similarityToGoal, similarityToWord }`. `word` is the best row that is not START and not an operand still on the equation. GOAL may surface as "You are here"; the rules forbid it as an operand, not as a label. Similarity to GOAL uses the same cosine the meter uses.

Rate limit with the [Workers Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) (GA; docs page updated 2026-11-12): 30 requests per 60 seconds, key `playerId`, separate limiter 60 per 60 seconds keyed by `CF-Connecting-IP`. The binding is per location and approximate. It stops a scan loop. A finished game is at most 16 nearest calls, so a person playing inside the rules stays under it. Over the limit: HTTP 429. This is not a capacity cap. Traffic growth is absorbed by more isolates, not by tightening this number.

**`POST /api/score`**

Body: `{ date, playerId, nickname?, moves }`. Replay the full log server-side. Check, in order: vocab membership, not START / GOAL / banned variant, each surface word at most once, net moves within `maxMoves`, event count (undos included) is the move total, cosine at the end `>= threshold`. On success insert the score. On conflict return 409 and the original row. Similarity and elapsed time in the response are the server values.

**`GET /api/leaderboard/today`** and **`GET /api/leaderboard/:date`**

Top 50 for that date: `ORDER BY moves ASC, similarity DESC, elapsed_ms ASC`. Fields: rank, nickname or fallback, moves, similarity, elapsed_ms. No move lists.

`config/game.json` holds the locked settings and the tunable ones: `timezone` `America/New_York`, `vocabSize` 40000, `maxMoves` 16, thresholds from section 7, shard path template, rate-limit numbers. Wrangler environments supply the D1 database id and the environment name only. Secrets are not required for v1.

---

## 7. Puzzle generation policy

Offline only. Search and the final accept check both use the **quantized** vectors, so a published par line still reaches the threshold in the browser.

**Pair filter.** Sample START and GOAL from the top 8,000 words (configurable) inside the vocab. Keep the pair only when their direct cosine is in **[0.05, 0.30]**. Below 0.05 the analogy is usually noise. At or above 0.30 they are already close, and a low threshold would make the puzzle trivial. Also drop the pair if direct cosine is already `>=` the minimum solvable similarity below.

**Search.** Beam search, width 64, depth at most 4. Operands come from those top 8,000 words, excluding START, GOAL, their variants, and words already used on that path. Each step keeps the 64 partial equations with the highest cosine to GOAL. A finished path is a solution when its cosine is at least **0.55** (`minSolvableSimilarity`) and its length is at least 2. Beam depth caps **par**, not the player. The player cap is `maxMoves` 16, and undo events count toward it.

**Best path.** Fewest moves, then highest final cosine. That move count is **par**. Discard the pair if the search finds nothing.

**Threshold.** `threshold = round(best_cosine - 0.03, 2)`, and discard the pair if that value would fall below 0.50. The slack (0.03) means the known solution still clears the meter after quantization noise that passed the ship gate. Par is reachable because we recompute this cosine on the shipped bytes. It is not trivial because direct cosine is capped at 0.30, one-move solutions are discarded, and the player still has to find the operands.

**Easy flag, still reviewable.** If par is 2 and `best_cosine >= 0.80`, mark `easy: true` in the candidate file so the reviewer can skip it. Do not auto-drop it.

These cutoffs are starting points, stored in `config/game.json`. Phase 2's 10–20 candidates are how we learn whether 0.55 and 0.03 feel right. Change the config and regenerate; do not hardcode a second copy.

**Banned operands.** Runtime and generator share one rule, covered by fixtures:

- Reject the exact START and GOAL tokens.
- Reject a token whose simple stem equals the stem of START or of GOAL. Suffixes: `s`, `es`, `ed`, `ing`, `er`, `est`, `ly`, plus `ies`/`ied` back to `y`, and a doubled consonant before `ed`/`ing` (`stopped` / `stop`).
- Reject when one of {operand, START} or {operand, GOAL} is the other plus one of those suffixes. Do not ban on raw prefix alone. A one-letter prefix would ban half the dictionary.
- Union with `tools/irregular_variants.txt` pairs (`mouse`/`mice`, and anything we add).
- The full list for that pair is stored in `banned_json` and enforced again at score time. Each surface form once. Two inflections of some third word are allowed; the rule targets START and GOAL variants only.

**Bias.** `tools/bias_lexicon.tsv` tags words for gender, race, nationality, religion, and occupation. If START, GOAL, or any solution operand is tagged, the candidate gets `bias_review` and the matched category. The CLI prints the equation and the tags. Nothing is auto-approved. A bulk-approve command skips flagged rows. A flagged row enters the schedule only through an explicit approve that records that the bias flag was seen. Untagged rows also require an explicit approve; the flag changes the command, not the fact of review.

**Review CLI.** `review_puzzles.py` lists candidates one screen at a time: equation, par, threshold, direct cosine, final cosine, banned sample, bias tags, easy flag. Commands: approve, reject, skip. Approve writes `puzzles/schedule.json` with a date assigned from the next free day in the configured timezone, or a date the reviewer types. The loader is idempotent on `puzzle_date`.

---

## 8. Build order

### Phase 1 — Preprocessing

Vocab pipeline, letter histogram, both quantizer reports, the 20-word neighbor sample, shard/pack consistency check.

**Done:** `data/reports/quantization.json` exists for a real gensim run at 40,000 words, the ship gate passes for the chosen quantizer, and a person can read the neighbor sample and recognize the vocabulary. Checkpoint before any puzzle or Worker work. If the gate fails, stop and switch quantizer. float16 at this vocab size still fits in one asset. Do not proceed on a report that misses the gate.

### Phase 2 — Puzzle tooling

Generator, bias lexicon, review CLI, schedule file.

**Done:** the CLI can show 10–20 candidates, each with a par solution that reaches its threshold on the quantized vectors, and approving one appends a dated row to `puzzles/schedule.json`. At least one candidate in the batch should be bias-flagged, so the review path is visible. Checkpoint for threshold tuning before any UI.

### Phase 3 — Worker and D1

Shared `game-math`. Endpoints for puzzle, solution, nearest, score, leaderboard. Migrations. Rate limit. The nearest handler is the int8 scan from section 1, not Vectorize. Tests: replay matches a Python fixture, today payload has no solution, past solution works, today solution needs `reveal`, first score wins and a second is 409, undo increases the move count and a 17th event is rejected when `maxMoves` is 16, banned variant is rejected, leaderboard order is moves then similarity then time, nearest excludes START and current operands. Time a warm scan of the 40,000-row pack and record the milliseconds so the section 1 cost range can be replaced with a measurement.

**Done:** `wrangler dev` answers those cases against local D1 and the Phase 1 pack, tests green, and the scan time is written down.

### Phase 4 — Frontend

Mobile-first single page: START → GOAL, move entry, equation, warm/cold meter, "You are here", undo, move count versus par and max, give up, result, leaderboard. `localStorage` player id and optional nickname. Shards fetched per letter and cached in memory.

**Done:** a full game can be played through `wrangler dev` against a loaded puzzle, including undo, a win that posts a score, a give-up that reveals the solution, and a leaderboard that shows that score. Reload keeps the same player id and does not reset the server clock.

### Phase 5 — Deploy

Production Worker, remote D1, schedule loaded, vocab assets on the deployment, README.

**Done:** the production URL serves today's puzzle, static shards return with the hashed path, and a score from a phone-sized browser lands on the production leaderboard. README covers local dev, deploy, adding puzzles (generate, review, load), and cost from section 1: the bill is the $5 / month Workers Paid subscription at hobby traffic (10,000 games), because the scan does not fit in 10 ms and the free daily request cap does not absorb a spike. At 1,000,000 games the extra charge is CPU-ms past 30,000,000, using the Phase 3 measurement in place of the 50 ms / 150 ms assumptions. Configure an email billing alert ([Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), "configure an email alert"). Do not set a Workers spending limit. That control blocks new invocations and can interrupt every Worker on the account, which would reject real players when traffic grows. The platform adds isolates on its own.

---

## 9. Decisions

Locked:

1. **Daily reset timezone: `America/New_York`.** One zone for every player. The puzzle date flips at midnight Eastern. The browser does not choose the date.
2. **Vocabulary size: 40,000.** `vocabSize` in `config/game.json`. The int8 pack is 11.44 MiB, one static asset.
3. **Max moves: 16.** This is the player cap, and undo counts toward it. `maxMoves` in config, `max_moves` on each puzzle row, and `maxMoves` on `GET /api/puzzle/today`. Generator par is still at most 4.
4. **Nicknames: optional.** Blank shows `Player` plus the last four hex digits of the id.
5. **Hosting: the exact int8 scan on Workers Paid.** Paid is in the plan because 10 ms cannot run the scan and because a spike has to keep being served without a manual upgrade. It is the cost floor of that design, not a target. See section 1. Vectorize, KV, and R2 are unused.

Not blockers. The build does not wait on these:

- **Threshold numbers.** Section 7 stands for Phase 1 and Phase 2 (cosine band 0.05–0.30, beam depth 4, minimum solution cosine 0.55, threshold 0.03 below the best path and at least 0.50, discard par of 1). At the Phase 2 checkpoint, keep those numbers or edit `config/game.json` and regenerate.
- **"You are here" list.** Top-1 unless that checkpoint says otherwise. Top-3 gives away nearby words once the meter is warm.
- **Share text.** A plain line the result screen can copy: `Wordelate YYYY-MM-DD · 4/16 · par 3`. The `16` is the player cap. No emoji grid in v1.

---

## 10. Working principles

The browser and the Worker dequantize the same bytes and call the same `game-math` functions. Offline search accepts a puzzle only after that same quantized cosine clears the threshold. The server rebuilds the position from the move list on nearest and on score.

Keep the serving path small: static shards, one D1 database, one Worker, one int8 scan. Vectorize, KV, and R2 are unused. Puzzle generation and the gensim model stay on a machine you run, never on the request.
