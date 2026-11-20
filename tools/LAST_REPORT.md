# Vocab build

Real model: yes
Model: `conceptnet-numberbatch-en-19.08`
Vocab size: 38135
Dims: 300
Quantizer shipped: symmetric-per-vector-int8 (id 1)
Content hash: `80e72d68bf62f3bde639f6cebe9f823a7d1ecbbc408bafa63d2458d5e7475166`

## Ship gate (per-vector int8)

Result: FAIL

Per-vector int8 does not pass the ship gate. The pack is still per-vector int8. This result is a fail.
p95 absolute cosine error 0.001260 (limit 0.01)
top-1 disagreement 12.6000% (252 / 2000, limit 1%)
float32 top-1 still inside quantized top-5: 100.0000%
median float-space gap on disagreements: 1.192e-07
Those argmax mismatches are float32 ties: the float32 top-1 is inside the quantized top-5 on every measured query. The formal gate still fails because the winning index differs.
self-misses 0 (limit 0)
mean / max absolute cosine error 0.000507 / 0.004144

## Global-scale int8 (measured, not shipped)

Result: FAIL
p95 0.002904, top-1 disagreement 12.8500%, self-misses 0

## Files

Nearest pack: 11865042 bytes

| shard | words | bytes |
| --- | ---: | ---: |
| a | 2495 | 774429 |
| b | 2229 | 690185 |
| c | 3668 | 1139822 |
| d | 2241 | 695652 |
| e | 1585 | 492373 |
| f | 1610 | 498888 |
| g | 1269 | 392815 |
| h | 1472 | 455849 |
| i | 1479 | 460814 |
| j | 473 | 146042 |
| k | 506 | 156223 |
| l | 1331 | 411613 |
| m | 2271 | 704157 |
| n | 855 | 264658 |
| o | 887 | 275050 |
| p | 2763 | 857905 |
| q | 159 | 49280 |
| r | 2175 | 674989 |
| s | 4145 | 1285482 |
| t | 1841 | 570356 |
| u | 704 | 219084 |
| v | 619 | 191680 |
| w | 1046 | 323826 |
| x | 46 | 14122 |
| y | 169 | 52068 |
| z | 97 | 29895 |

## Dropped words

Lowercase a-z tokens only. Phrases, underscores, digits, and punctuation are dropped. A vector is kept only when the all-lowercase key itself exists in the model.

Blocklist removals (46): shit, fuck, fucking, hell, damn, ass, bitch, dick, fucked, porn, rape, bullshit, crap, asshole, pussy, cock, piss, cum, shitty, tits
Not a-z (1389): it's, don't, i'm, 1, 2, 3, you're, that's, can't, 4, 5, i've, didn't, he's, 6, 7, there's, doesn't, 8, they're
Lowercase key missing from the model (430): didnt, doesnt, isnt, covid, wasnt, mourinho, wordpress, bjp, distributions, selfies, liga, comcast, pinterest, aap, neymar, vols, btc, htc, routledge, spacex

Query plan: `{"sum_queries": 2000, "cosine_sample": 200, "self_queries": 500, "neighbor_words": 20, "scaled": false}`

Full numbers: `data/reports/quantization.json`.
