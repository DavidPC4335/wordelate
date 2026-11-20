-- Wordelate puzzle schedule.
-- Idempotent on puzzle_date. Does not deploy.
--
-- Local:
--   wrangler d1 execute <database-name> --local --file puzzles/load.sql
-- Remote (explicit; this script never runs --remote by itself):
--   wrangler d1 execute <database-name> --remote --file puzzles/load.sql
-- Timezone for puzzle_date: America/New_York

-- No approved puzzles yet. puzzles/schedule.json is empty.
