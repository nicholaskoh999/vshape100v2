-- Round 13 — Company Holiday calendar and optional training.
--
-- Three additive changes. Nothing existing is dropped, renamed or rewritten,
-- and no row of any other table is touched.
--
-- 1. company_holidays — the approved company calendar, seeded GLOBALLY. One
--    row per approved date for everyone, never one copy per account. No
--    google_sub appears here, so a future account sees the same calendar the
--    moment it signs in, with nothing to backfill.
--
-- 2. company_holiday_preferences — the per-account Training On/Off choice for
--    a company date. Absence means Training Off, so the default costs no rows
--    and a fresh account is already correct without being written to.
--
-- 3. holiday_overrides gains a name and its own training preference, so a
--    user-created Holiday can carry the same truth a company one does.

CREATE TABLE IF NOT EXISTS company_holidays (
  -- Company holidays are single dates, so the date IS the identity.
  holiday_date TEXT PRIMARY KEY
    CHECK (holiday_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  name TEXT NOT NULL CHECK (length(name) > 0)
);

-- Idempotent: re-running the migration cannot duplicate or overwrite a date.
INSERT OR IGNORE INTO company_holidays (holiday_date, name) VALUES
  ('2026-01-01', 'New Year''s Day'),
  ('2026-02-17', 'Chinese New Year'),
  ('2026-02-18', 'Chinese New Year Holiday'),
  ('2026-03-20', 'Hari Raya Aidilfitri Holiday'),
  ('2026-03-21', 'Hari Raya Aidilfitri'),
  ('2026-03-22', 'Hari Raya Aidilfitri Holiday'),
  ('2026-03-23', 'Hari Raya Aidilfitri Holiday'),
  ('2026-05-01', 'Labour Day'),
  ('2026-05-27', 'Hari Raya Haji'),
  ('2026-06-01', 'Agong''s Birthday'),
  ('2026-08-31', 'Merdeka Day'),
  ('2026-09-16', 'Malaysia Day'),
  ('2026-11-08', 'Deepavali'),
  ('2026-11-09', 'Deepavali Holiday'),
  ('2026-12-11', 'Sultan of Selangor''s Birthday'),
  ('2026-12-25', 'Christmas Day'),
  ('2027-01-01', 'New Year''s Day'),
  ('2027-02-06', 'Chinese New Year'),
  ('2027-02-07', 'Chinese New Year Holiday'),
  ('2027-02-08', 'Chinese New Year Holiday'),
  ('2027-03-10', 'Hari Raya Aidilfitri'),
  ('2027-03-11', 'Hari Raya Aidilfitri Holiday'),
  ('2027-05-01', 'Labour Day'),
  ('2027-05-17', 'Hari Raya Haji'),
  ('2027-06-07', 'Agong''s Birthday'),
  ('2027-08-31', 'Merdeka Day'),
  ('2027-09-16', 'Malaysia Day'),
  ('2027-10-28', 'Deepavali'),
  ('2027-12-11', 'Sultan of Selangor''s Birthday'),
  ('2027-12-25', 'Christmas Day');

CREATE TABLE IF NOT EXISTS company_holiday_preferences (
  google_sub TEXT NOT NULL,
  holiday_date TEXT NOT NULL
    CHECK (holiday_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  -- 0 = Training Off, 1 = Training On. An absent row also means Off.
  training_on INTEGER NOT NULL DEFAULT 0 CHECK (training_on IN (0, 1)),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (google_sub, holiday_date)
);

-- A user-created Holiday carries a name and its own training preference. The
-- defaults keep every existing row valid and unchanged in meaning: no name,
-- Training Off — exactly the behaviour those rows already had.
ALTER TABLE holiday_overrides ADD COLUMN name TEXT NOT NULL DEFAULT '';
ALTER TABLE holiday_overrides ADD COLUMN training_on INTEGER NOT NULL DEFAULT 0;
