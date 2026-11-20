# Puzzle candidates

Real `word2vec-google-news-300` candidates for a human to judge difficulty.
Nothing here is on the schedule until you approve it.

Vocab hash: `39a823e0ad023be8d5283b97608fe66ea61865de0bb19351fe39478e974d0a3e`
Vocab size: 34558
Count: 15

Approve with `python tools/review_puzzles.py approve <id>`.
Bias-flagged rows also need `--seen-bias`. `approve-all` skips them.

## c01. flew + actress + comedian -> actor

- par 2, threshold 0.69, direct cosine 0.0702, final cosine 0.7173
- easy: no
- bias: actor (occupation)
- solution: +actress +comedian
- banned sample: actor, actors, flew

## c02. shorter + seventh + fifth -> sixth

- par 2, threshold 0.87, direct cosine 0.1545, final cosine 0.8972
- easy: yes
- bias: none
- solution: +seventh +fifth
- banned sample: short, shorter, shortest, shortly, shorts, sixth

## c03. trophy + argued + say -> argue

- par 2, threshold 0.71, direct cosine 0.0715, final cosine 0.7410
- easy: no
- bias: none
- solution: +argued +say
- banned sample: argue, argues, trophies, trophy

## c04. catches + than + more -> less

- par 2, threshold 0.68, direct cosine 0.0524, final cosine 0.7131
- easy: no
- bias: none
- solution: +than +more
- banned sample: catch, catcher, catches, catching, les, less, lesser

## c05. cookie + ages + teenagers -> adults

- par 2, threshold 0.67, direct cosine 0.0983, final cosine 0.7019
- easy: no
- bias: none
- solution: +ages +teenagers
- banned sample: adult, adults, cookie, cookies

## c06. tan + chicago + missouri -> illinois

- par 2, threshold 0.64, direct cosine 0.1345, final cosine 0.6688
- easy: no
- bias: none
- solution: +chicago +missouri
- banned sample: illinois, tan, tanned, tanning

## c07. mild + beings + animals -> humans

- par 2, threshold 0.62, direct cosine 0.1615, final cosine 0.6544
- easy: no
- bias: none
- solution: +beings +animals
- banned sample: human, humanly, humans, mild, milder, mildly

## c08. approach + dollar + euro -> currency

- par 2, threshold 0.62, direct cosine 0.0618, final cosine 0.6537
- easy: no
- bias: none
- solution: +dollar +euro
- banned sample: approach, approached, approaches, approaching, currencies, currency

## c09. hero + susan + thompson -> douglas

- par 2, threshold 0.61, direct cosine 0.0621, final cosine 0.6444
- easy: no
- bias: none
- solution: +susan +thompson
- banned sample: douglas, hero, heroes, heros

## c10. frames + article + twitter -> blog

- par 2, threshold 0.61, direct cosine 0.0677, final cosine 0.6405
- easy: no
- bias: none
- solution: +article +twitter
- banned sample: blog, blogged, blogging, blogs, frame, framed, frames, framing

## c11. markets + none + various -> other

- par 2, threshold 0.60, direct cosine 0.0652, final cosine 0.6277
- easy: no
- bias: none
- solution: +none +various
- banned sample: market, marketed, marketer, marketing, markets, oth, other, others

## c12. channel + britain + gordon -> westminster

- par 2, threshold 0.60, direct cosine 0.1132, final cosine 0.6255
- easy: no
- bias: none
- solution: +britain +gordon
- banned sample: channel, channeled, channeling, channels, westminster

## c13. compounds + democratic + religious -> secular

- par 2, threshold 0.59, direct cosine 0.0681, final cosine 0.6159
- easy: no
- bias: none
- solution: +democratic +religious
- banned sample: compound, compounded, compounding, compounds, secular

## c14. allied + grab + caught -> catch

- par 2, threshold 0.58, direct cosine 0.0654, final cosine 0.6078
- easy: no
- bias: none
- solution: +grab +caught
- banned sample: alli, allied, allies, ally, catch, catcher, catches, catching

## c15. checking + personnel + employees -> staff

- par 2, threshold 0.56, direct cosine 0.1002, final cosine 0.5860
- easy: no
- bias: none
- solution: +personnel +employees
- banned sample: check, checked, checker, checking, checks, staff, staffed, staffer, staffing, staffs
