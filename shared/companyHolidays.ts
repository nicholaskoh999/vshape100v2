/**
 * The approved COMPANY holiday calendar.
 *
 * This list is the product's own truth, not a public-holiday feed. Nothing
 * fetches it from the internet and nothing infers extra dates: holidays that
 * are public in Malaysia or Selangor but absent from the approved company
 * list — Thaipusam, Nuzul Al-Quran, Wesak, Awal Muharram, Maulidur Rasul —
 * are deliberately NOT here.
 *
 * It lives in `shared/` because two very different things must agree on it:
 * the migration that seeds `company_holidays` globally, and the tests that
 * assert the seed is exactly this. A test parses the migration and compares it
 * to this array, so the two cannot drift apart.
 *
 * Company holidays are global. They are seeded once for everyone, never per
 * account, and no `google_sub` appears in the data or the migration.
 */

export type CompanyHoliday = {
  /** Inclusive local date, `YYYY-MM-DD`. Company holidays are single days. */
  date: string
  /** Human-readable name, exactly as approved. */
  name: string
}

/**
 * The 30 approved dates, oldest first.
 *
 * Consecutive dates (the Hari Raya and Chinese New Year runs) stay SEPARATE
 * records with their own names rather than being merged into a range: each
 * approved date has its own approved name, and merging would lose it.
 */
export const COMPANY_HOLIDAYS: readonly CompanyHoliday[] = [
  // 2026
  { date: '2026-01-01', name: "New Year's Day" },
  { date: '2026-02-17', name: 'Chinese New Year' },
  { date: '2026-02-18', name: 'Chinese New Year Holiday' },
  { date: '2026-03-20', name: 'Hari Raya Aidilfitri Holiday' },
  { date: '2026-03-21', name: 'Hari Raya Aidilfitri' },
  { date: '2026-03-22', name: 'Hari Raya Aidilfitri Holiday' },
  { date: '2026-03-23', name: 'Hari Raya Aidilfitri Holiday' },
  { date: '2026-05-01', name: 'Labour Day' },
  { date: '2026-05-27', name: 'Hari Raya Haji' },
  { date: '2026-06-01', name: "Agong's Birthday" },
  { date: '2026-08-31', name: 'Merdeka Day' },
  { date: '2026-09-16', name: 'Malaysia Day' },
  { date: '2026-11-08', name: 'Deepavali' },
  { date: '2026-11-09', name: 'Deepavali Holiday' },
  { date: '2026-12-11', name: "Sultan of Selangor's Birthday" },
  { date: '2026-12-25', name: 'Christmas Day' },
  // 2027
  { date: '2027-01-01', name: "New Year's Day" },
  { date: '2027-02-06', name: 'Chinese New Year' },
  { date: '2027-02-07', name: 'Chinese New Year Holiday' },
  { date: '2027-02-08', name: 'Chinese New Year Holiday' },
  { date: '2027-03-10', name: 'Hari Raya Aidilfitri' },
  { date: '2027-03-11', name: 'Hari Raya Aidilfitri Holiday' },
  { date: '2027-05-01', name: 'Labour Day' },
  { date: '2027-05-17', name: 'Hari Raya Haji' },
  { date: '2027-06-07', name: "Agong's Birthday" },
  { date: '2027-08-31', name: 'Merdeka Day' },
  { date: '2027-09-16', name: 'Malaysia Day' },
  { date: '2027-10-28', name: 'Deepavali' },
  { date: '2027-12-11', name: "Sultan of Selangor's Birthday" },
  { date: '2027-12-25', name: 'Christmas Day' },
]

/** How many dates the approved calendar contains. */
export const COMPANY_HOLIDAY_COUNT = COMPANY_HOLIDAYS.length

/**
 * The id a company holiday carries in the unified read model.
 *
 * Derived from the date rather than generated, so it is stable across reads,
 * accounts and deployments — a training preference keyed to it cannot be
 * orphaned by a re-seed.
 */
export const COMPANY_ID_PREFIX = 'company:'

export function companyHolidayId(date: string): string {
  return `${COMPANY_ID_PREFIX}${date}`
}

/** The date a company id refers to, or null when the id is not a company one. */
export function companyHolidayDateOf(id: string): string | null {
  if (!id.startsWith(COMPANY_ID_PREFIX)) return null
  return id.slice(COMPANY_ID_PREFIX.length)
}

/** Is this id a company holiday's? */
export function isCompanyHolidayId(id: string): boolean {
  return id.startsWith(COMPANY_ID_PREFIX)
}
