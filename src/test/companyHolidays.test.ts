import { describe, expect, it } from 'vitest'

import migration from '../../migrations/0006_company_holidays.sql?raw'

import {
  COMPANY_HOLIDAYS,
  COMPANY_HOLIDAY_COUNT,
  companyHolidayDateOf,
  companyHolidayId,
  isCompanyHolidayId,
} from '@shared/companyHolidays'
import { parseHolidayInput, rangeCanTrain, trainingAppliesOn } from '@shared/holiday'
import { isLocalDate, weekdayOf } from '@shared/localDate'

/**
 * Round 13 — the approved company calendar.
 *
 * Two things are defended here. First, that the list IS the approved list:
 * exactly the 30 dates, with their exact names, and none of the public
 * holidays that were deliberately left out. Second, that the migration seeds
 * exactly this list — the SQL is parsed and compared, so the seed and the
 * source cannot drift apart without a test failing.
 */

const APPROVED_2026: [string, string][] = [
  ['2026-01-01', "New Year's Day"],
  ['2026-02-17', 'Chinese New Year'],
  ['2026-02-18', 'Chinese New Year Holiday'],
  ['2026-03-20', 'Hari Raya Aidilfitri Holiday'],
  ['2026-03-21', 'Hari Raya Aidilfitri'],
  ['2026-03-22', 'Hari Raya Aidilfitri Holiday'],
  ['2026-03-23', 'Hari Raya Aidilfitri Holiday'],
  ['2026-05-01', 'Labour Day'],
  ['2026-05-27', 'Hari Raya Haji'],
  ['2026-06-01', "Agong's Birthday"],
  ['2026-08-31', 'Merdeka Day'],
  ['2026-09-16', 'Malaysia Day'],
  ['2026-11-08', 'Deepavali'],
  ['2026-11-09', 'Deepavali Holiday'],
  ['2026-12-11', "Sultan of Selangor's Birthday"],
  ['2026-12-25', 'Christmas Day'],
]

const APPROVED_2027: [string, string][] = [
  ['2027-01-01', "New Year's Day"],
  ['2027-02-06', 'Chinese New Year'],
  ['2027-02-07', 'Chinese New Year Holiday'],
  ['2027-02-08', 'Chinese New Year Holiday'],
  ['2027-03-10', 'Hari Raya Aidilfitri'],
  ['2027-03-11', 'Hari Raya Aidilfitri Holiday'],
  ['2027-05-01', 'Labour Day'],
  ['2027-05-17', 'Hari Raya Haji'],
  ['2027-06-07', "Agong's Birthday"],
  ['2027-08-31', 'Merdeka Day'],
  ['2027-09-16', 'Malaysia Day'],
  ['2027-10-28', 'Deepavali'],
  ['2027-12-11', "Sultan of Selangor's Birthday"],
  ['2027-12-25', 'Christmas Day'],
]

/** Public holidays that are deliberately NOT on the approved company list. */
const EXCLUDED = [
  'Thaipusam',
  'Nuzul Al-Quran',
  'Wesak',
  'Awal Muharram',
  'Maulidur Rasul',
]

function migrationSql(): string {
  return migration
}

/** The (date, name) pairs the migration actually seeds. */
function seededRows(): [string, string][] {
  const sql = migrationSql()
  const values = sql.split('VALUES')[1] ?? ''
  const rows: [string, string][] = []
  const pattern = /\('(\d{4}-\d{2}-\d{2})',\s*'((?:[^']|'')*)'\)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(values)) !== null) {
    // SQL escapes a quote by doubling it.
    rows.push([match[1], match[2].replace(/''/g, "'")])
  }
  return rows
}

/* ------------------------------------------------------------------ */
/* 1. The approved list                                                */
/* ------------------------------------------------------------------ */

describe('1. the approved company calendar', () => {
  it('holds exactly the 30 approved dates', () => {
    expect(COMPANY_HOLIDAYS).toHaveLength(30)
    expect(COMPANY_HOLIDAY_COUNT).toBe(30)
  })

  it('matches every approved 2026 date and name', () => {
    const actual = COMPANY_HOLIDAYS.filter((row) => row.date.startsWith('2026')).map(
      (row): [string, string] => [row.date, row.name],
    )
    expect(actual).toEqual(APPROVED_2026)
  })

  it('matches every approved 2027 date and name', () => {
    const actual = COMPANY_HOLIDAYS.filter((row) => row.date.startsWith('2027')).map(
      (row): [string, string] => [row.date, row.name],
    )
    expect(actual).toEqual(APPROVED_2027)
  })

  it('excludes public holidays that were not approved', () => {
    const names = COMPANY_HOLIDAYS.map((row) => row.name).join(' | ')
    for (const excluded of EXCLUDED) {
      expect(names, excluded).not.toContain(excluded)
    }
  })

  it('carries only real, ordered, unique local dates', () => {
    const dates = COMPANY_HOLIDAYS.map((row) => row.date)
    for (const date of dates) expect(isLocalDate(date), date).toBe(true)
    expect(new Set(dates).size).toBe(dates.length)
    expect([...dates].sort()).toEqual(dates)
  })

  it('names every date', () => {
    for (const row of COMPANY_HOLIDAYS) {
      expect(row.name.length, row.date).toBeGreaterThan(0)
    }
  })
})

/* ------------------------------------------------------------------ */
/* 2. The migration seeds exactly that                                 */
/* ------------------------------------------------------------------ */

describe('2. migration 0006', () => {
  it('seeds exactly the approved list, in order', () => {
    expect(seededRows()).toEqual(
      COMPANY_HOLIDAYS.map((row): [string, string] => [row.date, row.name]),
    )
  })

  it('seeds globally, with no account identity anywhere', () => {
    const sql = migrationSql()
    // A company date belongs to the company, not to one signed-in person.
    expect(sql).not.toMatch(/google_sub\s*,\s*holiday_date\s*,\s*name/)
    expect(sql).not.toMatch(/[0-9]{15,}/)
    // The seed statement itself names only the two global columns.
    expect(sql).toMatch(/INSERT OR IGNORE INTO company_holidays \(holiday_date, name\)/)
  })

  it('is additive: it drops and rewrites nothing', () => {
    const sql = migrationSql()
    for (const banned of [/DROP\s+TABLE/i, /DELETE\s+FROM/i, /UPDATE\s+/i, /TRUNCATE/i]) {
      expect(sql, String(banned)).not.toMatch(banned)
    }
  })

  it('creates the account-scoped preference store keyed by account and date', () => {
    const sql = migrationSql()
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS company_holiday_preferences/)
    expect(sql).toMatch(/PRIMARY KEY \(google_sub, holiday_date\)/)
    // Absence of a row must be a valid state meaning Training Off.
    expect(sql).toMatch(/training_on INTEGER NOT NULL DEFAULT 0/)
  })

  it('gives existing custom Holidays safe defaults', () => {
    const sql = migrationSql()
    // Every existing row stays valid and keeps exactly its old meaning:
    // unnamed, Training Off.
    expect(sql).toMatch(/ALTER TABLE holiday_overrides ADD COLUMN name TEXT NOT NULL DEFAULT ''/)
    expect(sql).toMatch(
      /ALTER TABLE holiday_overrides ADD COLUMN training_on INTEGER NOT NULL DEFAULT 0/,
    )
  })

  it('seeds with a statement that cannot duplicate or overwrite a date', () => {
    // Precision matters here: the migration as a whole is additive and is
    // applied ONCE by the ledger - its ALTER TABLE statements would error if
    // replayed. It is the seed statement alone that is idempotent.
    expect(migrationSql()).toMatch(/INSERT OR IGNORE/)
    expect(migrationSql()).toMatch(/applied ONCE, by the migration ledger/)
  })
})

/* ------------------------------------------------------------------ */
/* 3. Company identity                                                 */
/* ------------------------------------------------------------------ */

describe('3. company identity', () => {
  it('derives a stable id from the date', () => {
    expect(companyHolidayId('2026-08-31')).toBe('company:2026-08-31')
    expect(companyHolidayDateOf('company:2026-08-31')).toBe('2026-08-31')
    expect(isCompanyHolidayId('company:2026-08-31')).toBe(true)
  })

  it('does not mistake a custom id for a company one', () => {
    const uuid = '3f1b2c4d-0000-4000-8000-000000000000'
    expect(isCompanyHolidayId(uuid)).toBe(false)
    expect(companyHolidayDateOf(uuid)).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* 4. Weekend Holidays never train                                     */
/* ------------------------------------------------------------------ */

describe('4. the weekend rule', () => {
  it('finds no trainable day in a Saturday/Sunday-only range', () => {
    // 2026-09-12 is a Saturday, 2026-09-13 a Sunday.
    expect(rangeCanTrain('2026-09-12', '2026-09-13')).toBe(false)
    expect(rangeCanTrain('2026-09-12', '2026-09-12')).toBe(false)
  })

  it('finds one as soon as the range touches a weekday', () => {
    expect(rangeCanTrain('2026-09-12', '2026-09-14')).toBe(true)
    expect(rangeCanTrain('2026-09-14', '2026-09-14')).toBe(true)
  })

  it('refuses to store Training On for a weekend-only Holiday', () => {
    const parsed = parseHolidayInput({
      startDate: '2026-09-12',
      endDate: '2026-09-13',
      trainingOn: true,
    })
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.field).toBe('training')
  })

  it('accepts Training Off for a weekend-only Holiday', () => {
    const parsed = parseHolidayInput({
      startDate: '2026-09-12',
      endDate: '2026-09-13',
      trainingOn: false,
    })
    expect(parsed.ok).toBe(true)
  })

  it('keeps a weekend date exempt even inside a Training-On range', () => {
    // Fail-safe: re-derived per date rather than trusted from the record, so
    // corrupted or forged data cannot make a Saturday a training day.
    const record = { trainingOn: true }
    expect(trainingAppliesOn('2026-09-14', record)).toBe(true) // Monday
    expect(trainingAppliesOn('2026-09-12', record)).toBe(false) // Saturday
    expect(trainingAppliesOn('2026-09-13', record)).toBe(false) // Sunday
  })

  it('applies to no date at all when training is off', () => {
    for (const date of ['2026-09-12', '2026-09-14']) {
      expect(trainingAppliesOn(date, { trainingOn: false }), date).toBe(false)
    }
  })

  it('agrees with the calendar about which days are weekdays', () => {
    for (const row of COMPANY_HOLIDAYS) {
      const weekday = weekdayOf(row.date)
      const trainable = weekday !== null && weekday >= 1 && weekday <= 5
      expect(rangeCanTrain(row.date, row.date), row.date).toBe(trainable)
    }
  })
})
