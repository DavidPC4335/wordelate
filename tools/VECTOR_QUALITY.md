# Vector quality

Float32 rows were reloaded from the cached gensim `word2vec-google-news-300` model (3,000,000 vectors; all 34,558 pack words were present). Queries are the report's plan: seed `20261119`, 2,000 normalized sums of 1–4 random rows, 200 cosine targets, 500 self-checks. Scores below are single-threaded so the argmax does not move with BLAS reduction order. The published int8 gate (254 / 2000) is the same cosine sample; its p95 matches this run exactly. The 9-query gap versus 263 / 2000 is float32 argmax jitter on 1-ulp ties.

Shipped file: `data/vocab/5de0cb324bccae909aefd4af52ca3bc7cc79c30d024dbb28e3d460f6fcee8fe3/nearest.i8`, also copied to `packages/web/public/vocab/nearest.i8`. The previous int8 directory is still on disk.

## Choice

IEEE binary16 rows (WLN1 quantizer 2). No second matrix and no vocabulary cut.

Compared on these queries:

| transport | p95 abs cosine error | top-1 disagreement | self-misses |
| --- | ---: | ---: | ---: |
| per-vector int8, strict argmax | 0.001098 | 13.15% (263 / 2000) | 0 |
| per-vector int8, tie-break | 0.001098 | 12.60% (252 / 2000) | 0 |
| per-vector int16, strict argmax | 0.0000042 | 12.75% (255 / 2000) | 0 |
| float16, strict argmax | 0.0000319 | 11.75% (235 / 2000) | 0 |
| float16, tie-break (shipped) | 0.0000319 | 10.00% (200 / 2000) | 0 |

The int16 line is from the same query draw with default BLAS threading (disagreement 255 / 2000). Its cosine error is lower than float16, and its top-1 rate is not. Once score error is well under 1e-4, the remaining mismatches are float32 top-two gaps at about one ulp (median gap on the int8 mismatches is 1.8e-7). A wider index tie-break on int8 (band 1e-3) reached 11.2% and then got worse as the band started pulling in unrelated earlier words. Float16 plus a 3e-5 band is the lowest disagreement that still leaves the ten puzzle gaps (all at least 0.011) untouched.

The browser rule, in `nearestWord`: if the best cosine and the runner-up differ by less than 3e-5, take the earliest word whose cosine is within 3e-5 of the best. Otherwise take the strict maximum. Words are stored alphabetically, so earliest is the lowest index, which is what NumPy `argmax` does on an exact tie.

## Before / after

| | before (published int8) | after (float16 + tie-break) |
| --- | --- | --- |
| file | 10,718,459 bytes | 21,016,743 bytes |
| dtype | symmetric per-vector int8, float16 scale | IEEE binary16 |
| p95 absolute cosine error | 0.001098 | 0.0000319 |
| top-1 disagreement vs float32 | 12.7% (254 / 2000) | 10.0% (200 / 2000) |
| self-misses | 0 | 0 |

Paired int8 remeasure on this machine: 13.15% (263 / 2000), same p95 0.001098, self-misses 0. Float16 strict argmax, without the tie-break, is 11.75% (235 / 2000).

## Ten puzzles

Nearest word excludes the start word and the operands. Every goal is still the nearest word.

| equation | int8 nearest | int8 goal cosine | float16 nearest | float16 goal cosine |
| --- | --- | ---: | --- | ---: |
| king − man + woman | queen | 0.7120 | queen | 0.7118 |
| uncle − man + woman | aunt | 0.8022 | aunt | 0.8022 |
| brother − boy + girl | sister | 0.8175 | sister | 0.8177 |
| prince − man + woman | princess | 0.7040 | princess | 0.7041 |
| dog + baby | puppy | 0.8269 | puppy | 0.8263 |
| cat + baby | kitten | 0.7867 | kitten | 0.7864 |
| good − better + worse | bad | 0.7330 | bad | 0.7338 |
| strong − stronger + weaker | weak | 0.7575 | weak | 0.7583 |
| walk − walking + swimming | swim | 0.8264 | swim | 0.8260 |
| big − bigger + smaller | small | 0.6875 | small | 0.6878 |

Add and subtract are unchanged. Some goal cosines move by about 0.001 because the stored rows are closer to the unit float32 vectors than the int8 reconstruction was.

## Tokens that were stealing neighbors

On the float32 vectors, `paris − france + italy` landed on **lohan** (cosine 0.507), then madrid 0.482, heidi 0.480, florence 0.468. `paris − man + woman` landed on heidi, hilton, alexandra, jennifer, jolie. Those names are in the wordfreq top list and in the Google News model, and they were the nearest words.

Dropping 4,806 tokens that are neither in the ENABLE1 English word list nor in a country/city gazetteer (puzzle words kept; rome, madrid, tokyo, france, italy kept) removes lohan. `paris − france + italy` then lands on **madrid** (0.482), with rome third at 0.461. Germany → berlin and Japan → tokyo stay correct. The ten puzzles still hit their goals. Top-1 disagreement on the reduced list stays about 12.7% (254 / 2000 strict float16), so the cut does not beat float16 on the fidelity metric and was not shipped. The full 34,558-word list is unchanged.
