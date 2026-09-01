-- Round 18 — account settings, starting with the Foundation start date.
--
-- ONE ADDITIVE TABLE. Nothing existing is touched.
--
-- WHY THIS EXISTS.
--
-- Day 1 of Foundation was a source constant. Changing it meant editing code and
-- redeploying, which makes a per-person calendar fact a developer task. It is
-- now an account-scoped setting the user owns and can change from Settings.
--
-- WHY A SETTINGS TABLE RATHER THAN A COLUMN SOMEWHERE.
--
-- There is deliberately no accounts table (0001 says so), so there is nowhere
-- to hang a column. A dedicated table keyed by the account is the same shape
-- every other per-account table in this schema uses, and it gives later
-- settings somewhere to live without another migration per preference.
--
-- WHY THE DATE IS NULLABLE, AND WHY NOTHING IS BACK-FILLED.
--
-- A row is written only when the user actually chooses a date. An account with
-- no row, or a row whose date is NULL, has not expressed a preference — and the
-- application answers that with the legacy start date every existing account
-- has always been counted from. Seeding every account with today's date would
-- silently renumber history for people who never asked for it, so this file
-- inserts nothing at all.
--
-- The first production Fresh Start is a separate, explicitly authorised
-- release-stage action. It is NOT this migration, and this migration deletes
-- nothing.
--
-- IDENTITY. The account key is the `google_sub` carried by auth_sessions, taken
-- from the authenticated session server-side and never from a request, exactly
-- as every table since 0002.

CREATE TABLE IF NOT EXISTS account_settings (
  -- Stable Google account key, from the authenticated session only.
  google_sub TEXT PRIMARY KEY,

  -- The user's chosen Foundation Day 1, as a LOCAL calendar date. NULL means
  -- "not chosen", which reads as the legacy default rather than as a date.
  --
  -- The GLOB only proves the SHAPE. A shape-valid but impossible date such as
  -- 2026-02-30 is rejected by the shared validator before it ever reaches this
  -- statement, because SQLite cannot express "is a real calendar date".
  foundation_start_date TEXT
    CHECK (
      foundation_start_date IS NULL
      OR foundation_start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    ),

  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
