-- Round 04 — Today completion persistence.
--
-- Deliberately minimal: which Today occurrences a signed-in account has
-- ticked, and nothing else. No routine definitions, no calendar, no workout
-- logs, no weight, no achievements, and no generic users table — identity is
-- the google_sub already carried by auth_sessions.

CREATE TABLE IF NOT EXISTS today_completions (
  -- Stable Google account key, taken from the authenticated session. Never
  -- from a request body or query string. Email is not authoritative.
  google_sub     TEXT NOT NULL,
  -- The accepted Today occurrence identity: '<YYYY-MM-DD>:<item id>'.
  -- Previous-day spillover and the current day are different occurrences and
  -- therefore different rows.
  occurrence_key TEXT NOT NULL,
  -- The date half of occurrence_key, derived server-side from the key itself
  -- so the two can never disagree. Indexed for the day-range read.
  anchor_day     TEXT NOT NULL,
  completed_at   INTEGER NOT NULL,
  -- One row per account per occurrence: completing twice is a no-op, not a
  -- duplicate, and one account's completion can never be another's.
  PRIMARY KEY (google_sub, occurrence_key)
);

CREATE INDEX IF NOT EXISTS idx_today_completions_day
  ON today_completions (google_sub, anchor_day);
