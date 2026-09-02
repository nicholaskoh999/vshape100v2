-- Round 22 — the Programme Builder.
--
-- WHAT THIS ADDS
--
-- Three new tables and nothing else:
--
--   programme_revisions  one row per account: the optimistic-concurrency token
--                        that also records that this account has a programme
--                        of its own at all
--   programme_exercises  the account's canonical exercise master — stable id,
--                        editable display name, archived flag, custom flag
--   programme_slots      one row per (weekday, exercise): the structured
--                        prescription for that appearance
--
-- No existing table is altered. No existing column is added, widened, renamed
-- or dropped. No index on an existing table is touched.
--
-- WHY IT IS ADDITIVE, AND WHY IT BACK-FILLS NOTHING
--
-- Until Round 22 the Foundation programme was a hardcoded array in the React
-- app. It is now structured data in shared/programme/foundation.ts, readable by
-- the Worker as well. That seed remains the FALLBACK: an account with no rows
-- in these three tables resolves to exactly the accepted Mon-Fri programme, at
-- revision 0, and READING it writes nothing.
--
-- So this migration deliberately materialises NO ACCOUNT. It creates empty
-- tables. Every existing account keeps resolving to the same programme it had
-- yesterday, from code, until the day its owner makes a first real edit — and
-- that edit materialises the account's own rows and applies the change in one
-- transaction.
--
-- Materialising here instead would have been worse in two ways: it would write
-- rows for accounts that never asked for them, and it would freeze today's seed
-- for accounts that would rather keep tracking it.
--
-- WHAT THIS MIGRATION DOES NOT DO
--
-- It does not touch workout history. Not one UPDATE, DELETE or ALTER against
-- workout_occurrences, workout_sets, workout_set_corrections or
-- workout_calibration appears below, and none is implied. A started workout is
-- an immutable snapshot; the programme is what FUTURE Starts will freeze, and
-- the two never reach across at each other.
--
-- It does not rewrite Progress, personal bests or progression history. It does
-- not manufacture workout rows or correction audit events. It does not alter
-- account_settings, so the Foundation Start Date is untouched.
--
-- It does not duplicate media or input types. exercise_media and
-- exercise_input_types remain keyed by (google_sub, exercise_id) and remain the
-- canonical truth for those two things. The programme references an exercise by
-- the same id, so a rename cannot orphan either.

-- ------------------------------------------------------------------
-- The account's programme revision
-- ------------------------------------------------------------------
--
-- One row per account, and its EXISTENCE is meaningful: no row means "this
-- account has never edited its programme, resolve the shared Foundation seed at
-- revision 0".
--
-- `revision` is the optimistic-concurrency token. Every authoritative programme
-- response carries it, and every write states the revision its author read. A
-- write whose stated revision is not the stored one changes nothing and is
-- refused, so a stale tab cannot overwrite an edit it never saw.
--
-- `write_token` is how a multi-statement write proves, INSIDE one batch, that it
-- is the writer that won the compare-and-swap. The first statement of a write
-- sets it to a value only that writer knows; every dependent statement is
-- guarded on it. A writer that lost the CAS never has its token stored, so all
-- of its dependent statements match nothing and the batch commits as a no-op
-- rather than as half an edit.
CREATE TABLE IF NOT EXISTS programme_revisions (
  -- Stable Google account key, taken from the authenticated session. Never from
  -- a request body, query string or client-controlled header.
  google_sub  TEXT NOT NULL,

  -- Monotonic. Starts at 1 when the account first materialises; the shared
  -- fallback reports 0, which no stored row may ever hold.
  revision    INTEGER NOT NULL CHECK (revision >= 1),

  -- Opaque per-write value. Not a secret and not identity; only a within-batch
  -- marker for "the write that owns this revision".
  write_token TEXT NOT NULL CHECK (length(write_token) > 0),

  updated_at  INTEGER NOT NULL,

  PRIMARY KEY (google_sub)
);

-- ------------------------------------------------------------------
-- The account's canonical exercise master
-- ------------------------------------------------------------------
--
-- The identity/display split that the whole round rests on:
--
--   exercise_id  PERMANENT. Keys media, input type, personal bests and every
--                historical workout_sets row ever written. A rename never
--                touches it.
--   name         EDITABLE. What the user calls it today. Renaming
--                'lat-pulldown' to "Band Lat Pulldown" rewrites exactly this
--                one column and nothing else in the database.
--
-- `archived` is a lifecycle flag, not a delete. Round 22 has no destructive
-- exercise deletion: an archived exercise keeps its id, its media, its input
-- type, its history and its personal bests, and only loses its place in future
-- weekday slots.
--
-- `is_custom` distinguishes an exercise the user created from a Foundation one.
-- Custom ids are server-minted and prefixed, so this is derivable — it is stored
-- anyway so a query does not have to parse an id to know what it is looking at.
CREATE TABLE IF NOT EXISTS programme_exercises (
  google_sub  TEXT NOT NULL,

  -- Same slug grammar and bound as every other exercise id in the system.
  exercise_id TEXT NOT NULL CHECK (length(exercise_id) > 0 AND length(exercise_id) <= 64),

  -- Bounded by the accepted snapshot limit, so a programme can never author a
  -- name a workout snapshot would refuse to store.
  name        TEXT NOT NULL CHECK (length(name) > 0 AND length(name) <= 80),

  archived    INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  is_custom   INTEGER NOT NULL DEFAULT 0 CHECK (is_custom IN (0, 1)),

  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,

  -- One row per exercise per account. Cross-account isolation is structural:
  -- every read and write is keyed by the authenticated google_sub.
  PRIMARY KEY (google_sub, exercise_id)
);

-- ------------------------------------------------------------------
-- One appearance of an exercise on one weekday
-- ------------------------------------------------------------------
--
-- This is where "the same exercise, trained differently on different days"
-- lives. Monday's Lat Pulldown and Wednesday's Lat Pulldown are two rows here
-- with one exercise_id between them — not two exercises, which is what would
-- have split their media, their input type and their personal best.
--
-- The prescription is STRUCTURED, never free text. The rendered string
-- ("4 x 10-15") is derived at read time by the shared formatter, which is
-- proved against the accepted prescription parser. Storing the text instead
-- would have let a programme author something the logger cannot read.
--
-- session_id is restricted to the five fixed Foundation weekdays by a database
-- CHECK as well as by the application. Round 22 edits programme CONTENT; it
-- does not redesign the weekly obligation model, and no route may introduce a
-- sixth session or a weekend one.
CREATE TABLE IF NOT EXISTS programme_slots (
  google_sub  TEXT NOT NULL,

  session_id  TEXT NOT NULL
    CHECK (session_id IN ('monday', 'tuesday', 'wednesday', 'thursday', 'friday')),

  exercise_id TEXT NOT NULL CHECK (length(exercise_id) > 0 AND length(exercise_id) <= 64),

  -- 1-based and contiguous within the weekday. The application compacts on
  -- every write; the UNIQUE below stops two slots claiming one step even if a
  -- future bug forgets to.
  position    INTEGER NOT NULL CHECK (position >= 1 AND position <= 24),

  -- Bounded by the accepted per-exercise limit.
  set_count   INTEGER NOT NULL CHECK (set_count >= 1 AND set_count <= 20),

  result_kind TEXT NOT NULL CHECK (result_kind IN ('reps', 'seconds')),

  -- The authored target range. A single target stores min = max, which is a
  -- real authored target and not a degenerate range.
  target_min  INTEGER NOT NULL CHECK (target_min >= 1 AND target_min <= 10000),
  target_max  INTEGER NOT NULL CHECK (target_max >= 1 AND target_max <= 10000),

  per_side    INTEGER NOT NULL DEFAULT 0 CHECK (per_side IN (0, 1)),

  -- Optional display text, bounded by the accepted snapshot limit.
  equipment   TEXT CHECK (equipment IS NULL OR (length(equipment) > 0 AND length(equipment) <= 80)),

  -- A descending range names no target anyone authored.
  CHECK (target_min <= target_max),

  -- One appearance of one exercise per weekday. This is the "at most once per
  -- weekday" rule, enforced by the database rather than only by validation.
  PRIMARY KEY (google_sub, session_id, exercise_id),

  -- And no two exercises may claim the same step within one weekday.
  UNIQUE (google_sub, session_id, position)
);

-- Reading a weekday in stored order is the hot path: the Training page, the
-- Extra chooser and every server-authoritative Start do it.
CREATE INDEX IF NOT EXISTS programme_slots_by_session
  ON programme_slots (google_sub, session_id, position);
