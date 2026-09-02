-- Round 20 — typed workout resistance.
--
-- Until now every recorded set was kilograms, because kilograms were the only
-- thing this schema could express. A Triceps Pushdown performed with a black
-- band, three deep, was stored as "3 kg" — the COUNT of bands written into the
-- weight column. This migration gives the modality somewhere true to live.
--
-- PURELY ADDITIVE, AND IT REWRITES NOTHING.
--
-- One new table and three new nullable columns. No existing column is altered
-- or dropped, no existing row is updated, and nothing is back-filled. That last
-- point is deliberate and load-bearing: the user has told us their old
-- "3 kg × 12" Triceps rows were really "black band ×3", but those rows are what
-- the old system genuinely recorded, and silently rewriting them would replace
-- one wrong history with a guessed one. Historical correction is explicitly out
-- of scope for Round 20; legacy rows stay exactly as written and are READ
-- through their own frozen load mode.

-- ------------------------------------------------------------------
-- The account's canonical setting, per exercise
-- ------------------------------------------------------------------
--
-- One current truth per canonical exercise id, so every Foundation appearance
-- of that exercise — Tuesday, Friday, an Extra copied from either — agrees. It
-- is a SETTING, not history: changing it affects future Starts only, and the
-- workout snapshot is what governs anything already begun.
CREATE TABLE IF NOT EXISTS exercise_input_types (
  -- Stable Google account key, taken from the authenticated session. Never from
  -- a request body, query string or header.
  google_sub  TEXT NOT NULL,

  -- The canonical exercise id, e.g. 'triceps-pushdown'.
  exercise_id TEXT NOT NULL,

  -- A closed allowlist, enforced by the database as well as the application, so
  -- neither a future bug nor a direct write can introduce a modality the app
  -- cannot render or compare.
  input_type  TEXT NOT NULL
    CHECK (input_type IN ('weight_kg', 'resistance_band', 'bodyweight')),

  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,

  -- One setting per account per exercise. Changing it replaces; it never
  -- accumulates, and one account's setting can never be another's.
  PRIMARY KEY (google_sub, exercise_id)
);

CREATE INDEX IF NOT EXISTS idx_exercise_input_types_account
  ON exercise_input_types (google_sub, exercise_id);

-- ------------------------------------------------------------------
-- The frozen modality, and the band result
-- ------------------------------------------------------------------
--
-- NULL in `input_type_snapshot` means "written before Round 20". Such a row is
-- read through `load_mode_snapshot`, which is a fact recorded at the time:
-- 'none' meant no load, 'kg'/'kg_each' meant kilograms. That inference happens
-- on READ and never writes anything back.
--
-- Frozen alongside the existing snapshot columns for the same reason they are:
-- a workout must keep reading the way it was performed even after the exercise
-- is reconfigured.
ALTER TABLE workout_sets ADD COLUMN input_type_snapshot TEXT;

-- The band actually used, recorded only for a completed resistance_band set.
-- `actual_band_count` is a COUNT OF BANDS. It is never a weight, is never
-- compared with a kilogram figure, and is never converted into one.
ALTER TABLE workout_sets ADD COLUMN actual_band_label TEXT;
ALTER TABLE workout_sets ADD COLUMN actual_band_count INTEGER;
