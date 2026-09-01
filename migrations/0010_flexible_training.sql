-- Round 17 — Extra Workout.
--
-- TWO ADDITIVE COLUMNS. NOTHING IS REWRITTEN.
--
-- An Extra Workout is a voluntary additional workout on the current local day,
-- copied from one of the Foundation Monday–Friday sessions. It is real
-- recorded training, and it is NOT the scheduled obligation for that date.
-- Keeping those two apart is the whole of this migration.
--
-- WHY THE SESSION SLUG IS NOT ENOUGH ON ITS OWN.
--
-- 0004 keys an occurrence by (account, local workout date, session). An Extra
-- occupies the reserved session slug `extra`, so an Extra built from Monday is
-- (account, date, 'extra') while the real scheduled Monday workout on the same
-- date is (account, date, 'monday'). They cannot collide, and they can coexist
-- — which is exactly the product invariant.
--
-- But a slug is an identity, not evidence. Anything deriving SCHEDULED truth —
-- streaks, achievements, the Round 16 progression lanes, the reminder sweep —
-- would then be relying on recognising a magic string, and a future session
-- named badly would quietly change what those surfaces believe. So provenance
-- is persisted explicitly and filtered on explicitly. Defence in depth: the
-- slug keeps the rows apart, `kind` is what the queries actually assert.
--
-- `kind` IS SERVER-DERIVED. It is computed from the routed session id inside
-- the Worker and is not a field of any accepted request body. A client cannot
-- declare a workout scheduled, and cannot declare one extra: it can only
-- address one identity or the other.
--
-- EXISTING HISTORY READS AS SCHEDULED, WITHOUT A BACKFILL.
--
-- `DEFAULT 'scheduled'` on a NOT NULL column is applied by SQLite to every row
-- already in the table, so the accepted 0001–0009 history becomes scheduled
-- truth the moment this runs. There is no UPDATE here, no DELETE, no table
-- recreation and no rewrite of any workout snapshot: the historical columns
-- 0004 froze at Start are not touched by this file at all.
--
-- Note on CHECK. SQLite's ALTER TABLE ADD COLUMN cannot attach a CHECK
-- constraint, and recreating `workout_occurrences` to add one would mean
-- copying every user's workout history — a destructive rewrite to buy a
-- constraint. The vocabulary is enforced where it is decided instead: the
-- Worker derives `kind` from the route, and the read path re-checks the stored
-- value and falls back to 'scheduled' rather than casting an unknown one.

-- Why this workout exists: 'scheduled' (the Foundation obligation for the
-- date) or 'extra' (a voluntary additional workout). Existing rows are
-- scheduled, which is what they have always been.
ALTER TABLE workout_occurrences
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'scheduled';

-- Which Foundation session an Extra was copied FROM, e.g. 'monday'. This is
-- provenance for display and for history — never identity. It is NULL for a
-- scheduled workout, which is its own source, and NULL for every existing row.
--
-- Deliberately not a foreign key: the training week is client-side accepted
-- data with no table to point at, exactly as `session_id` has been since 0004.
ALTER TABLE workout_occurrences
  ADD COLUMN source_session_id TEXT;

-- The scheduled-only reads added by this round ask "this account's scheduled
-- occurrences of one session, before a date" — progression history, and the
-- streak evidence behind it. Leading with the account keeps it usable by the
-- existing account-scoped reads too.
CREATE INDEX IF NOT EXISTS idx_workout_occurrences_kind
  ON workout_occurrences (google_sub, kind, session_id, workout_date);
