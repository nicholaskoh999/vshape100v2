-- Round 08 — set-by-set workout logging.
--
-- TWO IDENTITY LAYERS, DELIBERATELY SEPARATE.
--
-- 0003 files exercise media under the canonical exercise slug alone, so Lat
-- Pulldown has ONE shared media record across Monday, Wednesday and Thursday.
-- Workout logging is the opposite: Monday's Lat Pulldown and Wednesday's are
-- different work, with different prescriptions and different actual results.
--
-- So a logged set is keyed by the workout occurrence — (account, local workout
-- date, session) — PLUS the exercise's position in that session. A canonical
-- slug never enters a key. Repeating an exercise across days, or twice within
-- one day, therefore cannot collide.
--
-- Identity follows the convention 0002 established and 0003 kept: the account
-- key is the `google_sub` carried by auth_sessions, taken from the
-- authenticated session server-side and never from a request. There is no
-- accounts table to point a foreign key at (0001 deliberately has none), so the
-- account key is a plain column and the composite primary key carries the
-- per-account invariant.
--
-- HISTORICAL TRUTH. The `_snapshot` columns are copies taken when the workout
-- was started, not references to today's source. sessions.ts may later change a
-- prescription, an equipment string or an exercise name; a workout logged
-- before that change must keep reading the way it was actually performed. The
-- API only ever INSERTs these columns (ON CONFLICT DO NOTHING) — it never
-- updates them — so a later Start on the same occurrence returns the original
-- snapshot instead of rewriting history.
--
-- No binary media is stored here. No progression, calibration or suggested
-- load is stored or computed: those are later rounds.

CREATE TABLE IF NOT EXISTS workout_occurrences (
  -- Stable Google account key, from the authenticated session only.
  google_sub   TEXT NOT NULL,
  -- The user's LOCAL workout date as YYYY-MM-DD. Not a UTC date: deriving it
  -- from UTC would move the workout across midnight for most of the world.
  workout_date TEXT NOT NULL
    CHECK (workout_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  -- Training session slug, e.g. 'monday'.
  session_id   TEXT NOT NULL CHECK (length(session_id) > 0),

  -- Historical copies of the session header, frozen at Start.
  session_day_snapshot       TEXT NOT NULL CHECK (length(session_day_snapshot) > 0),
  session_focus_snapshot     TEXT NOT NULL CHECK (length(session_focus_snapshot) > 0),
  session_intensity_snapshot TEXT NOT NULL CHECK (length(session_intensity_snapshot) > 0),

  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  -- One workout per account per local date per session. A second Start is the
  -- same workout, never a duplicate occurrence.
  PRIMARY KEY (google_sub, workout_date, session_id)
);

CREATE TABLE IF NOT EXISTS workout_sets (
  google_sub   TEXT NOT NULL,
  workout_date TEXT NOT NULL,
  session_id   TEXT NOT NULL,

  -- Position within the session, 0-based. This is what keeps repeated
  -- canonical exercises apart: two Lat Pulldown entries in one session would
  -- occupy different orders, and different days are different occurrences.
  exercise_order INTEGER NOT NULL CHECK (exercise_order >= 0 AND exercise_order < 24),
  -- Position within the exercise, 0-based.
  set_index      INTEGER NOT NULL CHECK (set_index >= 0 AND set_index < 20),

  -- Historical copies, frozen at Start. `exercise_id_snapshot` records which
  -- canonical exercise this was; it is deliberately NOT part of the key.
  exercise_id_snapshot   TEXT NOT NULL CHECK (length(exercise_id_snapshot) > 0),
  exercise_name_snapshot TEXT NOT NULL CHECK (length(exercise_name_snapshot) > 0),
  prescription_snapshot  TEXT NOT NULL CHECK (length(prescription_snapshot) > 0),
  -- Null when the session listed no equipment for this exercise.
  equipment_snapshot     TEXT,
  -- What a completed set records here: repetitions, or a hold in seconds.
  result_kind_snapshot   TEXT NOT NULL CHECK (result_kind_snapshot IN ('reps', 'seconds')),
  -- Whether load applies, and in which sense. 'kg_each' is PER DUMBBELL:
  -- 10kg each is two 10kg dumbbells, never 10kg combined.
  load_mode_snapshot     TEXT NOT NULL CHECK (load_mode_snapshot IN ('none', 'kg', 'kg_each')),
  -- 1 when the prescription is per side, e.g. "3 × 10 / side".
  per_side_snapshot      INTEGER NOT NULL CHECK (per_side_snapshot IN (0, 1)),

  -- Live logging state. A set starts pending and is resolved either way.
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'skipped')),
  actual_load_value REAL
    CHECK (actual_load_value IS NULL OR (actual_load_value >= 0 AND actual_load_value <= 1000)),
  actual_load_unit TEXT
    CHECK (actual_load_unit IS NULL OR actual_load_unit IN ('kg', 'kg_each')),
  -- Reps or seconds. Positive: a set of zero reps was not completed.
  actual_result INTEGER
    CHECK (actual_result IS NULL OR (actual_result > 0 AND actual_result <= 10000)),
  updated_at INTEGER NOT NULL,

  -- A completed set carries a real result; a pending or skipped one carries
  -- none. This is the constraint that stops "skipped" from quietly reading as
  -- a completed working set.
  CHECK (
    (status = 'completed' AND actual_result IS NOT NULL)
    OR (status <> 'completed' AND actual_result IS NULL)
  ),
  -- A load value and its unit travel together or not at all, so a stored
  -- number can never lose the meaning of "each".
  CHECK ((actual_load_value IS NULL) = (actual_load_unit IS NULL)),
  -- Load is only recorded where it applies.
  CHECK (load_mode_snapshot <> 'none' OR actual_load_value IS NULL),

  PRIMARY KEY (google_sub, workout_date, session_id, exercise_order, set_index),

  FOREIGN KEY (google_sub, workout_date, session_id)
    REFERENCES workout_occurrences (google_sub, workout_date, session_id)
    ON DELETE CASCADE
);

-- The workout read is "every set of this occurrence, in performance order".
CREATE INDEX IF NOT EXISTS idx_workout_sets_occurrence
  ON workout_sets (google_sub, workout_date, session_id, exercise_order, set_index);
