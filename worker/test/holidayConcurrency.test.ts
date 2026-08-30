import { describe, expect, it } from 'vitest'

import { createD1HolidayStore } from '../holiday/d1Store'
import { createHoliday, updateHoliday, type HolidayStore } from '../holiday/holiday'
import { createFakeD1 } from './fakeD1'

/**
 * Round 11 correction — non-overlap survives concurrency.
 *
 * The invariant is that one account's Holiday ranges never overlap. A SELECT
 * followed by an INSERT cannot enforce that: two requests can both read "no
 * conflict" and then both write. These drive exactly that window and assert
 * the conditional writes close it.
 *
 * Adjacent ranges must still be allowed, so the protection has to be
 * overlap-specific rather than a blanket lock.
 */

const ACCOUNT = 'google-sub-a'

function makeStore(): { store: HolidayStore; db: ReturnType<typeof createFakeD1> } {
  const db = createFakeD1()
  return { store: createD1HolidayStore(db.db), db }
}

/** Let both callers reach persistence before either commits. */
async function flushMicrotasks(times = 30) {
  for (let i = 0; i < times; i += 1) await Promise.resolve()
}

function ranges(db: ReturnType<typeof createFakeD1>) {
  return [...db.holidays.values()]
    .map((row) => `${row.start_date}..${row.end_date}`)
    .sort()
}

/** Do any two stored ranges of this account intersect? */
function hasOverlap(db: ReturnType<typeof createFakeD1>): boolean {
  const rows = [...db.holidays.values()]
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const a = rows[i]
      const b = rows[j]
      if (a.google_sub !== b.google_sub) continue
      if (a.start_date <= b.end_date && b.start_date <= a.end_date) return true
    }
  }
  return false
}

/* ------------------------------------------------------------------ */
/* 1. Concurrent overlapping creates                                   */
/* ------------------------------------------------------------------ */

describe('concurrent creates', () => {
  it('lets exactly one of two overlapping creates win', async () => {
    const { store, db } = makeStore()

    const release = db.holdHolidayWrites()
    const first = createHoliday(
      store,
      ACCOUNT,
      { startDate: '2026-09-10', endDate: '2026-09-14' },
      1_000,
      'holiday-first',
    )
    const second = createHoliday(
      store,
      ACCOUNT,
      { startDate: '2026-09-12', endDate: '2026-09-18' },
      2_000,
      'holiday-second',
    )

    await flushMicrotasks()
    // The premise: neither could have seen the other, because nothing is
    // stored yet and both are already parked in persistence.
    expect(db.holidays.size).toBe(0)

    release()
    const [a, b] = await Promise.all([first, second])

    // Exactly one succeeded.
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1)
    const loser = a.ok ? b : a
    expect(loser.ok).toBe(false)
    if (!loser.ok) expect(loser.reason).toBe('conflict')

    // And the database holds one range, not two overlapping ones.
    expect(db.holidays.size).toBe(1)
    expect(hasOverlap(db)).toBe(false)
  })

  it('reports the winning range on the loser’s conflict', async () => {
    const { store, db } = makeStore()

    const release = db.holdHolidayWrites()
    const first = createHoliday(
      store,
      ACCOUNT,
      { startDate: '2026-09-10', endDate: '2026-09-14' },
      1_000,
      'holiday-first',
    )
    const second = createHoliday(
      store,
      ACCOUNT,
      { startDate: '2026-09-12', endDate: '2026-09-18' },
      2_000,
      'holiday-second',
    )
    await flushMicrotasks()
    release()
    const [, b] = await Promise.all([first, second])

    // The second arrived later, so it is the one refused.
    expect(b.ok).toBe(false)
    if (!b.ok && b.reason === 'conflict') {
      expect(b.conflict).toMatchObject({ startDate: '2026-09-10', endDate: '2026-09-14' })
    }
    expect(ranges(db)).toEqual(['2026-09-10..2026-09-14'])
  })

  it('refuses a create identical to one racing it', async () => {
    const { store, db } = makeStore()

    const release = db.holdHolidayWrites()
    const first = createHoliday(store, ACCOUNT, { startDate: '2026-09-10', endDate: '2026-09-10' }, 1, 'a')
    const second = createHoliday(store, ACCOUNT, { startDate: '2026-09-10', endDate: '2026-09-10' }, 2, 'b')
    await flushMicrotasks()
    release()
    const [a, b] = await Promise.all([first, second])

    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1)
    expect(db.holidays.size).toBe(1)
  })

  it('does not block two accounts writing the same dates at once', async () => {
    const { store, db } = makeStore()

    const release = db.holdHolidayWrites()
    const mine = createHoliday(store, 'sub-a', { startDate: '2026-09-10', endDate: '2026-09-14' }, 1, 'a')
    const theirs = createHoliday(store, 'sub-b', { startDate: '2026-09-10', endDate: '2026-09-14' }, 2, 'b')
    await flushMicrotasks()
    release()
    const [a, b] = await Promise.all([mine, theirs])

    // Non-overlap is per account, so this is not a conflict at all.
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    expect(db.holidays.size).toBe(2)
  })
})

/* ------------------------------------------------------------------ */
/* 2. Concurrent adjacent creates                                      */
/* ------------------------------------------------------------------ */

describe('concurrent adjacent creates', () => {
  it('lets both succeed, so the guard is overlap-specific not a lock', async () => {
    const { store, db } = makeStore()

    const release = db.holdHolidayWrites()
    // 09-05 ends the day before 09-06 begins: adjacent, not overlapping.
    const before = createHoliday(store, ACCOUNT, { startDate: '2026-09-01', endDate: '2026-09-05' }, 1, 'a')
    const after = createHoliday(store, ACCOUNT, { startDate: '2026-09-06', endDate: '2026-09-10' }, 2, 'b')

    await flushMicrotasks()
    expect(db.holidays.size).toBe(0)

    release()
    const [a, b] = await Promise.all([before, after])

    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    expect(db.holidays.size).toBe(2)
    expect(hasOverlap(db)).toBe(false)
    expect(ranges(db)).toEqual(['2026-09-01..2026-09-05', '2026-09-06..2026-09-10'])
  })
})

/* ------------------------------------------------------------------ */
/* 3. Concurrent updates                                               */
/* ------------------------------------------------------------------ */

describe('concurrent updates', () => {
  /** Two valid, non-overlapping ranges to race edits against. */
  async function seeded() {
    const made = makeStore()
    await createHoliday(
      made.store,
      ACCOUNT,
      { startDate: '2026-09-01', endDate: '2026-09-05' },
      1,
      'left',
    )
    await createHoliday(
      made.store,
      ACCOUNT,
      { startDate: '2026-09-20', endDate: '2026-09-24' },
      2,
      'right',
    )
    return made
  }

  it('never lets two edits land in an overlapping final state', async () => {
    const { store, db } = await seeded()

    // Each edit is legal against the state both callers can see:
    //   left  → 01..12  (clears right's current 20..24)
    //   right → 10..24  (clears left's current 01..05)
    // Together they would overlap across 10..12.
    const release = db.holdHolidayWrites()
    const growLeft = updateHoliday(store, ACCOUNT, 'left', {
      startDate: '2026-09-01',
      endDate: '2026-09-12',
    })
    const growRight = updateHoliday(store, ACCOUNT, 'right', {
      startDate: '2026-09-10',
      endDate: '2026-09-24',
    })

    await flushMicrotasks()
    // Neither has committed, so each still sees the other's original range.
    expect(ranges(db)).toEqual(['2026-09-01..2026-09-05', '2026-09-20..2026-09-24'])

    release()
    const [left, right] = await Promise.all([growLeft, growRight])

    // Exactly one edit is allowed to land.
    expect([left.ok, right.ok].filter(Boolean)).toHaveLength(1)
    const loser = left.ok ? right : left
    if (!loser.ok) expect(loser.reason).toBe('conflict')

    // The stored ranges do not overlap, whichever won.
    expect(hasOverlap(db)).toBe(false)
    expect(db.holidays.size).toBe(2)
  })

  it('leaves the losing record exactly as it was', async () => {
    const { store, db } = await seeded()

    const release = db.holdHolidayWrites()
    const growLeft = updateHoliday(store, ACCOUNT, 'left', {
      startDate: '2026-09-01',
      endDate: '2026-09-12',
    })
    const growRight = updateHoliday(store, ACCOUNT, 'right', {
      startDate: '2026-09-10',
      endDate: '2026-09-24',
    })
    await flushMicrotasks()
    release()
    const [left, right] = await Promise.all([growLeft, growRight])

    const stored = new Map(
      [...db.holidays.values()].map((row) => [row.id, `${row.start_date}..${row.end_date}`]),
    )
    // The refused edit changed nothing — no partial write, no merge.
    expect(stored.get('left')).toBe(left.ok ? '2026-09-01..2026-09-12' : '2026-09-01..2026-09-05')
    expect(stored.get('right')).toBe(
      right.ok ? '2026-09-10..2026-09-24' : '2026-09-20..2026-09-24',
    )
  })

  it('still allows an edit that only touches its own record', async () => {
    const { store, db } = await seeded()

    const release = db.holdHolidayWrites()
    // Shortening one and extending the other, staying clear of each other.
    const shrinkLeft = updateHoliday(store, ACCOUNT, 'left', {
      startDate: '2026-09-01',
      endDate: '2026-09-03',
    })
    const shrinkRight = updateHoliday(store, ACCOUNT, 'right', {
      startDate: '2026-09-22',
      endDate: '2026-09-24',
    })
    await flushMicrotasks()
    release()
    const [a, b] = await Promise.all([shrinkLeft, shrinkRight])

    // Neither conflicts, so both land.
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    expect(ranges(db)).toEqual(['2026-09-01..2026-09-03', '2026-09-22..2026-09-24'])
  })

  it('does not let a create slip in beside a racing edit', async () => {
    const { store, db } = await seeded()

    const release = db.holdHolidayWrites()
    const grow = updateHoliday(store, ACCOUNT, 'left', {
      startDate: '2026-09-01',
      endDate: '2026-09-12',
    })
    const insert = createHoliday(
      store,
      ACCOUNT,
      { startDate: '2026-09-08', endDate: '2026-09-15' },
      9,
      'new',
    )
    await flushMicrotasks()
    release()
    const [edit, made] = await Promise.all([grow, insert])

    expect([edit.ok, made.ok].filter(Boolean)).toHaveLength(1)
    expect(hasOverlap(db)).toBe(false)
  })
})
