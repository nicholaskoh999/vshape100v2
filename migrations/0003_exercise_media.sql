-- Round 07 — canonical exercise media.
--
-- ONE EXERCISE IDENTITY = ONE SHARED MEDIA RECORD.
--
-- Lat Pulldown appears on Monday, Wednesday and Thursday. All three
-- occurrences resolve to the *same* row here, because the row is filed under
-- the exercise slug alone — never under a session. Editing Lat Pulldown media
-- once therefore updates every place that uses exercise_id = 'lat-pulldown'.
--
-- Session prescription (sets / reps / resistance / equipment) is unrelated to
-- this table and stays where it is: the days may keep different prescriptions
-- while sharing one media record.
--
-- Identity follows the convention 0002 established: the account key is the
-- `google_sub` carried by auth_sessions, taken from the authenticated session
-- server-side and never from a request. There is no accounts table to point a
-- foreign key at (0001 deliberately has none), so — exactly as
-- today_completions does — the account key is stored as a plain column and
-- the composite primary key carries the per-account invariant.
--
-- No binary media is stored here. The row holds a URL to media served
-- elsewhere, plus the alt text that describes it.

CREATE TABLE IF NOT EXISTS exercise_media (
  -- Stable Google account key, from the authenticated session only.
  google_sub  TEXT NOT NULL,
  -- Stable exercise slug, e.g. 'lat-pulldown'. Session-independent by design.
  exercise_id TEXT NOT NULL,
  -- Accepted Round 06 media contract: 'gif' or 'image'.
  media_type  TEXT NOT NULL CHECK (media_type IN ('gif', 'image')),
  -- Absolute http(s) URL of the media file. Never a data:, blob: or
  -- javascript: URL — the API rejects those before a write reaches here.
  media_url   TEXT NOT NULL CHECK (length(media_url) > 0),
  -- What the media shows, for anyone who cannot see it. Never decorative,
  -- so a stored record always carries useful text.
  media_alt   TEXT NOT NULL CHECK (length(trim(media_alt)) > 0),
  updated_at  INTEGER NOT NULL,
  -- The canonical invariant: one row per account per exercise identity.
  -- A second save for the same exercise replaces the record, it never adds
  -- a per-session duplicate.
  PRIMARY KEY (google_sub, exercise_id)
);

-- The library read is "everything this account has set", newest edit first.
CREATE INDEX IF NOT EXISTS idx_exercise_media_account
  ON exercise_media (google_sub, updated_at);
