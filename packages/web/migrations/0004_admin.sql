-- Who may use /admin, other than the hard-coded superadmin. Emails are stored lowercase.
CREATE TABLE admins (
  email      TEXT PRIMARY KEY CHECK (length(email) BETWEEN 6 AND 320),
  added_by   TEXT NOT NULL CHECK (length(added_by) BETWEEN 6 AND 320),
  created_at INTEGER NOT NULL
);

-- One row per change an admin makes. The detail is a short note, never a secret.
CREATE TABLE admin_audit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          INTEGER NOT NULL,
  actor_id    TEXT NOT NULL CHECK (length(actor_id) = 36),
  actor_email TEXT NOT NULL CHECK (length(actor_email) BETWEEN 6 AND 320),
  action      TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 40),
  detail      TEXT NOT NULL CHECK (length(detail) <= 2000)
);

CREATE INDEX admin_audit_at ON admin_audit (at);

-- The question stack. Position 0 is the first scheduled day, then one day each.
-- A row is written rarely and read on every game load.
CREATE TABLE questions (
  position    INTEGER PRIMARY KEY CHECK (position >= 0),
  puzzle_json TEXT NOT NULL CHECK (length(puzzle_json) BETWEEN 2 AND 8000),
  updated_at  INTEGER NOT NULL,
  updated_by  TEXT NOT NULL CHECK (length(updated_by) BETWEEN 1 AND 320)
);

-- Bumped on every edit so a worker can keep the stack in memory until it changes.
CREATE TABLE schedule_meta (
  id       INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL CHECK (revision >= 0)
);

-- When set, this exact list of looks is the account's unlocks.
ALTER TABLE users ADD COLUMN unlocks_json TEXT CHECK (unlocks_json IS NULL OR length(unlocks_json) <= 500);
