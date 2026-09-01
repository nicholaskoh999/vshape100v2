-- Round 19.2 — Today Training Flex.
--
-- Records that a signed-in account explicitly resolved ONE local day as
-- something other than its scheduled Foundation strength session.
--
-- PURELY ADDITIVE. It creates one new table and touches nothing that already
-- exists: no column is added, altered or dropped, no row is written, moved or
-- back-filled, and no existing table is read by this migration. Every prior
-- round's data remains exactly as it was and continues to be readable by the
-- code that owns it.
--
-- WHAT THIS TABLE IS NOT.
--
-- It is not training evidence. A row here is a DECISION about a day, never a
-- result: there is deliberately no session, no exercise, no set, no load, no
-- reps and no duration, because a schema that could express those would invite
-- code that reads them as a workout. Strength history lives in
-- workout_occurrences / workout_sets / workout_calibration and this table has
-- no relationship to them — no foreign key, no shared identity, nothing to
-- join on beyond the account itself.
--
-- It is also not a schedule. There is no future intent here: one row describes
-- one day that the user has already decided about.

CREATE TABLE IF NOT EXISTS training_flex (
  -- Stable Google account key, taken from the authenticated session. Never from
  -- a request body, query string or header.
  google_sub TEXT NOT NULL,

  -- The local calendar date the decision applies to. Shape is constrained here
  -- so a malformed date cannot be stored at all; the application separately
  -- refuses dates that are not plausibly "today" for some timezone, which SQL
  -- cannot judge.
  local_date TEXT NOT NULL
    CHECK (local_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),

  -- The choice, as a closed allowlist. An unknown kind is rejected by the
  -- database as well as by the application, so neither a future bug nor a
  -- direct write can introduce an activity nobody agreed to.
  kind TEXT NOT NULL CHECK (kind IN ('recovery', 'fitness_boxing_2')),

  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  -- One decision per account per day. Choosing again replaces; it never
  -- accumulates, and one account's choice can never be another's.
  PRIMARY KEY (google_sub, local_date)
);

-- The read Today and the Calendar both make: this account, over a date range.
CREATE INDEX IF NOT EXISTS idx_training_flex_account_date
  ON training_flex (google_sub, local_date);
