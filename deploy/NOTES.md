# Wordelate demo deploy

Public URL: https://wordelate.pages.dev

- Account id: `794832d16bf5ae1ad8ce655e04ecfe89` (Davidpc4335@gmail.com's Account)
- Project name: `wordelate` (Pages project id `d89f32d4-fb72-4645-a140-9057ab899607`)
- Deployment id: `7f349f4f-786c-46e4-84a0-b9833df9646a`
- Deployment URL: https://7f349f4f.wordelate.pages.dev
- Method: Cloudflare Pages Direct Upload of `packages/web/dist` (5 files, including `vocab/nearest.i8`, 10,718,459 bytes)

## Custom domain

Zone `wordelate.com` exists (`f694d05f96133ecfbe65ff579f334ba6`) and currently has no DNS records. It was not attached. Adding the domain would create DNS records, and this deploy was asked not to change that zone's DNS. The pages.dev URL is the public address.

## Verified

- `GET https://wordelate.pages.dev/` returns `200` `text/html` (`<!doctype html>`, 440 bytes).
- The built JS fetches `/vocab/nearest.i8`. `GET https://wordelate.pages.dev/vocab/nearest.i8` returns `200` `application/octet-stream`, 10,718,459 bytes, first bytes `WLN1`.
- `/assets/index-ve3Z7pDo.js` and `/puzzles.json` return 200 with the uploaded sizes.
- `GET /play/not-a-real-route` returns `index.html` (Pages serves `index.html` for unknown paths).

No blocker for the public URL.
