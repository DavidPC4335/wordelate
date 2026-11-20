-- One best score per player per Eastern calendar day. Older days are deleted.
CREATE TABLE scores (
  day          TEXT NOT NULL,
  player_id    TEXT NOT NULL CHECK (length(player_id) = 36),
  puzzle_id    TEXT NOT NULL,
  score        INTEGER NOT NULL CHECK (score >= 0 AND score <= 160 AND score % 10 = 0),
  moves        INTEGER NOT NULL CHECK (moves >= 1 AND moves <= 16),
  answer_json  TEXT NOT NULL CHECK (length(answer_json) BETWEEN 2 AND 1500),
  name         TEXT CHECK (name IS NULL OR (length(name) BETWEEN 1 AND 24)),
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (day, player_id)
);

CREATE INDEX scores_rank ON scores (day, score DESC, created_at ASC);

-- Counts per score so a board read does not scan every player.
CREATE TABLE buckets (
  day   TEXT NOT NULL,
  score INTEGER NOT NULL,
  n     INTEGER NOT NULL CHECK (n >= 0),
  PRIMARY KEY (day, score)
);

-- Sliding windows for session, score, and name posts.
CREATE TABLE hits (
  bucket     TEXT PRIMARY KEY,
  n          INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX hits_expiry ON hits (expires_at);
