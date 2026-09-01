-- Round 16 — training progression.
--
-- ONE additive table. Nothing existing is dropped, renamed, rebuilt or
-- back-filled, and no row of any other table is touched. Workout history stays
-- exactly what it was: the immutable record of what was performed.
--
-- WHAT IS *NOT* STORED HERE, AND WHY.
--
-- There is no "current recommended load" column and no "current progression
-- state" column, because both are DERIVED — exactly the reasoning 0008 applied
-- to Personal Bests. The recommendation is a function of workout_sets, which is
-- already the truth of what was done. A stored copy becomes a lie the moment a
-- set is corrected or undone, and it would be a lie in the one direction the
-- user cannot see: the screen would still show a suggestion built on a session
-- they have since taken back.
--
-- WHAT *IS* STORED, AND WHY IT HAS TO BE.
--
-- Starting-load calibration is not derivable. When a loaded lane has no
-- comparable history, the app asks the person how their first working set
-- actually felt — Too Light / Good / Too Heavy — and, where they choose to,
-- what load they moved to instead. Those are the person's own words about their
-- own session. Nothing in workout_sets records them, and they must survive a
-- reload or a resume later the same evening, so they are persisted here and
-- nowhere else.
--
-- The chosen load is a number the USER typed. This app never manufactures one:
-- V2 models no authoritative equipment ladder, so guidance says "one available
-- step" and the person names the rung.
--
-- SCOPE. The key is (account, local workout date, session, exercise position) —
-- one calibration per exercise slot per workout occurrence, mirroring how 0004
-- files a set. That is what makes leakage structurally impossible rather than
-- merely unlikely:
--
--   * another account cannot be reached: google_sub is in the key
--   * Monday cannot leak into Wednesday: session_id is in the key
--   * one evening cannot leak into the next: workout_date is in the key
--   * a repeated exercise cannot leak across its own slots: exercise_order is
--
-- FINGERPRINT + OBSERVED LOAD. Two guards make a stale row fail closed rather
-- than mislead. `lane_fingerprint` pins the lane semantics the judgement was
-- given under (session, exercise, prescribed sets, authored range, result kind,
-- load mode, per side); a changed prescription produces a different fingerprint
-- and therefore inherits nothing. `observed_load_*` pins the first completed
-- working set's load the judgement was ABOUT; if that set is later undone or
-- corrected to a different weight, the judgement no longer describes anything
-- real and is ignored. Neither guard is enforced by SQL — they are read-time
-- checks — but storing them is what makes those checks possible at all.
--
-- Identity follows the convention every round since 0002 has used: the account
-- key is the `google_sub` carried by auth_sessions, taken from the
-- authenticated session server-side and never from a request. There is no
-- accounts table to point a foreign key at (0001 deliberately has none), so the
-- account key is a plain column and the composite primary key carries the
-- per-account invariant.

CREATE TABLE IF NOT EXISTS workout_calibration (
  -- Stable Google account key, from the authenticated session only.
  google_sub   TEXT NOT NULL,
  -- The user's LOCAL workout date, exactly as 0004 stores one.
  workout_date TEXT NOT NULL
    CHECK (workout_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  -- Training session slug, e.g. 'monday'.
  session_id   TEXT NOT NULL CHECK (length(session_id) > 0),
  -- Position within that session, 0-based. The same bound 0004 uses, so a
  -- calibration can only name a slot a workout could actually have.
  exercise_order INTEGER NOT NULL
    CHECK (exercise_order >= 0 AND exercise_order < 24),

  -- The lane semantics this judgement was given under. Compared on read; a
  -- mismatch means the prescription changed and the row is ignored.
  lane_fingerprint TEXT NOT NULL CHECK (length(lane_fingerprint) > 0),

  -- What the person said about that first completed working set.
  feedback TEXT NOT NULL CHECK (feedback IN ('too_light', 'good', 'too_heavy')),

  -- The load that first completed working set actually recorded, as it stood
  -- when the judgement was made. Not a suggestion: a copy of workout truth,
  -- kept only so the judgement can be checked against it later.
  observed_load_value REAL NOT NULL
    CHECK (observed_load_value >= 0 AND observed_load_value <= 1000),
  observed_load_unit TEXT NOT NULL CHECK (observed_load_unit IN ('kg', 'kg_each')),

  -- A real load the USER chose after judging the first set, or NULL when they
  -- named none. Never computed by this application.
  chosen_load_value REAL
    CHECK (chosen_load_value IS NULL
           OR (chosen_load_value >= 0 AND chosen_load_value <= 1000)),
  chosen_load_unit TEXT
    CHECK (chosen_load_unit IS NULL OR chosen_load_unit IN ('kg', 'kg_each')),

  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  -- A load value and its unit travel together or not at all, so a stored
  -- number can never lose the meaning of "each". 'kg_each' is PER DUMBBELL.
  CHECK ((chosen_load_value IS NULL) = (chosen_load_unit IS NULL)),

  -- ONE calibration per exercise slot per workout occurrence. Judging the same
  -- set again updates that row; it can never become a second, contradictory
  -- answer for the same slot.
  PRIMARY KEY (google_sub, workout_date, session_id, exercise_order),

  -- Calibration belongs to a workout that exists. The parent is the occurrence
  -- primary key 0004 declares, so this cannot describe a session that was never
  -- started, and it goes when the workout does.
  FOREIGN KEY (google_sub, workout_date, session_id)
    REFERENCES workout_occurrences (google_sub, workout_date, session_id)
    ON DELETE CASCADE
);

-- Every read is "the calibration rows of ONE occurrence", which the primary
-- key already orders by (google_sub, workout_date, session_id, exercise_order).
-- No second index is created for its own sake.
