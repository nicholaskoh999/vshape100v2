-- Round 11 — Holiday Mode overrides.
--
-- HOLIDAY IS EXEMPT, NOT MISSED.
--
-- A row here says: on these local calendar dates the normal routine's pressure
-- is suspended. It does not mark anything failed, completed or skipped, it
-- creates no completion rows, and it does not touch Foundation — the day
-- number keeps advancing by real calendar date whether or not the day is a
-- Holiday. Nothing about the training plan is stored or altered here.
--
-- ONLY TWO MODES. Home is the absence of a row; Holiday is the presence of
-- one. There is no Work Trip, Sick, Busy or custom type, which is why a record
-- carries no label or kind column: a stored range simply IS Holiday. Adding a
-- mode later is a schema change made deliberately, not an accident of design.
--
-- Identity follows the convention 0002 established and 0003/0004 kept: the
-- account key is the `google_sub` carried by auth_sessions, taken from the
-- authenticated session server-side and never from a request. There is no
-- accounts table to point a foreign key at (0001 deliberately has none), so
-- the account key is a plain column and it is part of the primary key.
--
-- DATES ARE LOCAL CALENDAR TEXT. `YYYY-MM-DD`, zero-padded, so ordinary string
-- comparison is exact date ordering and a range test is just <= / >=. No
-- instant, no timezone, no UTC midnight — storing an instant would move the
-- user's chosen day for anyone not on UTC.
--
-- NON-OVERLAP is the whole range rule, and it is enforced in the API rather
-- than here: SQLite has no exclusion constraint, and inventing one with
-- triggers would be more machinery than the rule deserves. The index below
-- makes the overlap lookup a range scan.

CREATE TABLE IF NOT EXISTS holiday_overrides (
  -- Server-generated identifier, unique within the account.
  id           TEXT NOT NULL CHECK (length(id) > 0),
  -- Stable Google account key, from the authenticated session only.
  google_sub   TEXT NOT NULL,

  -- Inclusive local start date.
  start_date   TEXT NOT NULL
    CHECK (start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  -- Inclusive local end date. Equal to start_date for a single-day Holiday.
  end_date     TEXT NOT NULL
    CHECK (end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),

  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,

  -- A range runs forwards. Rejected rather than silently swapped, because
  -- swapping would store dates the user did not choose.
  CHECK (start_date <= end_date),

  -- One row per id per account. The account key is part of the key, so a
  -- record can only ever be read or written under its own account.
  PRIMARY KEY (google_sub, id)
);

-- The calendar read is "every Holiday of this account intersecting a span",
-- and the overlap check is the same shape.
CREATE INDEX IF NOT EXISTS idx_holiday_overrides_account_range
  ON holiday_overrides (google_sub, start_date, end_date);
