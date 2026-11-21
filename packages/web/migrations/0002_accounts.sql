-- Google accounts. A person is found by Google's stable "sub", never by email.
CREATE TABLE users (
  id            TEXT PRIMARY KEY CHECK (length(id) = 36),
  google_sub    TEXT NOT NULL UNIQUE CHECK (length(google_sub) BETWEEN 1 AND 255),
  email         TEXT NOT NULL CHECK (length(email) BETWEEN 3 AND 320),
  full_name     TEXT NOT NULL CHECK (length(full_name) <= 200),
  display_name  TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 100),
  picture       TEXT CHECK (picture IS NULL OR length(picture) <= 512),
  invite_gen    INTEGER NOT NULL DEFAULT 1 CHECK (invite_gen >= 1),
  -- Worked out from the scores on every sync, so a friend list needs no extra queries.
  total_points  INTEGER NOT NULL DEFAULT 0,
  wins          INTEGER NOT NULL DEFAULT 0,
  streak        INTEGER NOT NULL DEFAULT 0,
  streak_day    TEXT,
  best_streak   INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER NOT NULL
);

-- Only a hash of each login token is kept, so a copy of the database cannot be used to sign in.
CREATE TABLE sessions (
  token_hash   TEXT PRIMARY KEY CHECK (length(token_hash) = 64),
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE INDEX sessions_user ON sessions (user_id, created_at);
CREATE INDEX sessions_expiry ON sessions (expires_at);

-- One best result per puzzle per day for each account.
CREATE TABLE account_scores (
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day        TEXT NOT NULL,
  puzzle_id  TEXT NOT NULL,
  score      INTEGER NOT NULL CHECK (score >= 0 AND score <= 160 AND score % 10 = 0),
  moves      INTEGER NOT NULL CHECK (moves >= 1 AND moves <= 16),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, day, puzzle_id)
);

-- Friends see each other. The smaller id is always user_a, so a pair is stored once.
CREATE TABLE friendships (
  user_a     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  user_b     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_a, user_b),
  CHECK (user_a < user_b)
);

CREATE INDEX friendships_b ON friendships (user_b);
