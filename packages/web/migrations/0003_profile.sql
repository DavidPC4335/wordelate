-- A person can choose their own username, and decide whether their Google picture link
-- may appear on the leaderboard. Only the link is ever kept, never the image.
ALTER TABLE users ADD COLUMN username_set INTEGER NOT NULL DEFAULT 0 CHECK (username_set IN (0, 1));
ALTER TABLE users ADD COLUMN show_picture INTEGER NOT NULL DEFAULT 1 CHECK (show_picture IN (0, 1));

-- A leaderboard entry made while signed in remembers whose it is, so a later change of
-- picture or an account deletion can reach it. The picture is a link, nothing more.
ALTER TABLE scores ADD COLUMN user_id TEXT CHECK (user_id IS NULL OR length(user_id) = 36);
ALTER TABLE scores ADD COLUMN picture TEXT CHECK (picture IS NULL OR length(picture) <= 512);

CREATE INDEX scores_user ON scores (user_id) WHERE user_id IS NOT NULL;
