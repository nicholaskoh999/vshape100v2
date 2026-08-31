-- Round 15 — Progress Upgrade.
--
-- ONE additive table. Nothing existing is dropped, renamed or rebuilt, and no
-- row of any other table is touched.
--
-- Personal Bests and exercise performance trends are deliberately NOT stored
-- here. They are DERIVED at read time from workout_sets, which is already the
-- historical truth of what was performed. A stored "current PB" would be a
-- second copy of a fact that can be recomputed exactly, and the moment a set
-- is corrected the copy becomes a lie. So this migration adds body weight and
-- nothing else.
--
-- Identity follows the convention every round since 0002 has used: the account
-- key is the `google_sub` carried by auth_sessions, taken from the
-- authenticated session server-side and never from a request. There is no
-- accounts table to point a foreign key at (0001 deliberately has none), so the
-- account key is a plain column and the composite primary key carries the
-- per-account invariant.

CREATE TABLE IF NOT EXISTS body_weight_entries (
  -- Stable Google account key, from the authenticated session only.
  google_sub TEXT NOT NULL,

  -- The user's LOCAL calendar date as YYYY-MM-DD, exactly as 0004 stores a
  -- workout date. A weight belongs to the day the person stepped on the scale
  -- on THEIR calendar; deriving it from UTC would file an evening measurement
  -- under tomorrow for anyone east of UTC.
  local_date TEXT NOT NULL
    CHECK (local_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),

  -- Weight in TENTHS OF A KILOGRAM, as an integer. 78.4 kg is stored as 784.
  --
  -- Integer tenths rather than a REAL because 0.1 has no exact binary
  -- representation: a stored 78.4 can read back as 78.40000000000001, and a
  -- difference of two such values can render as -0.09999999999999432. The
  -- displayed precision is one decimal place, so tenths ARE the natural unit
  -- and every difference stays exact.
  --
  -- The bound is a technical safety rail, not a health judgement: it exists so
  -- a malformed payload cannot store a nonsense number, and it is deliberately
  -- far wider than any real human weight.
  weight_tenths_kg INTEGER NOT NULL
    CHECK (weight_tenths_kg > 0 AND weight_tenths_kg <= 10000),

  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  -- ONE account × ONE local date = ONE entry. Saving the same date again
  -- updates that entry; it can never become a second row, so a day can never
  -- hold two contradictory weights.
  PRIMARY KEY (google_sub, local_date)
);

-- Every read is "this account's measurements, newest or oldest first", and the
-- range reads (30D / 90D) scan a contiguous slice of dates. The primary key
-- already orders by (google_sub, local_date), which serves both, so no second
-- index is created for its own sake.
