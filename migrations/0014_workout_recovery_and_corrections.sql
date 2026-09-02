-- Round 21 — undoing a Start that should never have happened, and correcting a
-- set that recorded the wrong thing.
--
-- PURELY ADDITIVE, AND IT REWRITES NOTHING.
--
-- One new column, one new table, one index. No existing column is altered or
-- dropped, no existing row is updated, and nothing is back-filled. In
-- particular the user's real Triceps Pushdown rows — recorded as "3 kg × 12"
-- when they were three black bands — are NOT corrected here. Round 21 builds
-- the audited path by which the user corrects them deliberately; it does not
-- guess on their behalf, and a migration is exactly the wrong place to try.

-- ------------------------------------------------------------------
-- Was this workout ever actually touched?
-- ------------------------------------------------------------------
--
-- Cancel Start may only remove an occurrence that should never have existed.
-- "Never existed" has to mean NEVER RESOLVED, not merely "looks pending right
-- now" — a workout that was completed and then undone is a workout the user
-- genuinely worked in, and it must not become disposable just because the sets
-- were put back.
--
-- Status alone cannot tell those apart, so the fact is recorded durably the
-- first time any set is resolved. NULL means no set has ever been completed,
-- skipped or undone in this occurrence.
--
-- NULLABLE ON PURPOSE, and not back-filled: every occurrence that already
-- exists gets NULL. That is deliberate and safe, because the cancel guard also
-- refuses on the set-level facts — a pre-Round-21 workout carrying completed
-- sets, recorded evidence, or a set whose updated_at has moved away from the
-- occurrence's started_at is still refused. This column makes the distinction
-- exact for everything started from Round 21 onwards; the set-level conditions
-- cover what came before.
ALTER TABLE workout_occurrences ADD COLUMN touched_at INTEGER;

-- ------------------------------------------------------------------
-- The correction audit
-- ------------------------------------------------------------------
--
-- Round 20 deliberately refused to silently reinterpret old history. Round 21
-- lets the user say "that set was actually a black band, three deep" — and the
-- price of allowing a historical rewrite at all is that every one of them is
-- recorded, permanently, with what it was before and what it became.
--
-- INSERT-ONLY. No application route updates or deletes a row here. The only
-- way an audit row disappears is with the workout it describes.
--
-- One row per correction EVENT, not per set: correcting the same set twice
-- appends a second row whose BEFORE is the first one's AFTER, so the whole
-- chain back to the original recording stays readable.
CREATE TABLE IF NOT EXISTS workout_set_corrections (
  -- Server-minted per event. The primary key, so an event cannot be recorded
  -- twice.
  correction_id TEXT NOT NULL,

  -- Identity of the corrected set. Always from the authenticated session, and
  -- never from a request body.
  google_sub     TEXT NOT NULL,
  workout_date   TEXT NOT NULL,
  session_id     TEXT NOT NULL,
  exercise_order INTEGER NOT NULL,
  set_index      INTEGER NOT NULL,

  corrected_at   INTEGER NOT NULL,

  -- BEFORE: exactly what was stored, read in the same transaction that
  -- replaced it. `before_input_type` is NULL for a legacy row that never
  -- carried one — which is the shape of the very history this exists to fix.
  before_input_type TEXT,
  before_load_mode  TEXT NOT NULL,
  before_load_value REAL,
  before_load_unit  TEXT,
  before_band_label TEXT,
  before_band_count INTEGER,
  before_result     INTEGER,

  -- AFTER: what the user asserted the set really was. The modality is always
  -- known here, because a correction must state one.
  after_input_type TEXT NOT NULL
    CHECK (after_input_type IN ('weight_kg', 'resistance_band', 'bodyweight')),
  after_load_mode  TEXT NOT NULL
    CHECK (after_load_mode IN ('none', 'kg', 'kg_each')),
  after_load_value REAL,
  after_load_unit  TEXT,
  after_band_label TEXT,
  after_band_count INTEGER,
  after_result     INTEGER NOT NULL,

  PRIMARY KEY (correction_id),

  -- The audit belongs to the workout it describes. If an authorised Fresh
  -- Start removes that workout, this goes with it rather than surviving as an
  -- orphan record of training that no longer exists.
  FOREIGN KEY (google_sub, workout_date, session_id)
    REFERENCES workout_occurrences (google_sub, workout_date, session_id)
    ON DELETE CASCADE
);

-- Reading one set's correction history, newest first, without scanning.
CREATE INDEX IF NOT EXISTS idx_workout_set_corrections_set
  ON workout_set_corrections
     (google_sub, workout_date, session_id, exercise_order, set_index, corrected_at);
