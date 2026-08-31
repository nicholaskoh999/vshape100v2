import { describe, expect, it } from 'vitest'

import {
  formatWeight,
  formatWeightChange,
  fromWeightTenths,
  parseBodyWeightInput,
  summariseBodyWeight,
  toWeightTenths,
  todayIn,
  MAX_WEIGHT_TENTHS,
} from '../../shared/bodyWeight'
import { rangeWindow } from '../progress/bodyWeight'

/**
 * Round 15 — the body weight contract.
 *
 * Two things here are easy to get wrong in ways that never announce
 * themselves.
 *
 * The first is precision. 0.1 has no exact binary representation, so a weight
 * stored as a float reads back as 78.40000000000001 and a difference of two
 * such values renders as -0.09999999999999432. Storing tenths as an integer
 * makes every value and every difference exact, and these tests hold that.
 *
 * The second is the date. "Is this date in the future?" answered against the
 * SERVER's UTC date rejects a perfectly valid local Today for several hours
 * either side of midnight — 08:00 in Kuala Lumpur is still yesterday in UTC.
 * The answer has to come from the user's own zone.
 */

/* ------------------------------------------------------------------ */
/* 1. Precision                                                        */
/* ------------------------------------------------------------------ */

describe('1. tenths of a kilogram', () => {
  it('accepts a whole number of kilograms', () => {
    expect(toWeightTenths(78)).toBe(780)
    expect(toWeightTenths(100)).toBe(1000)
  })

  it('accepts one decimal place', () => {
    expect(toWeightTenths(78.4)).toBe(784)
    expect(toWeightTenths(78.1)).toBe(781)
    // Every tenth, because 0.3 and 0.7 are the classic float offenders.
    for (let tenth = 0; tenth <= 9; tenth += 1) {
      expect(toWeightTenths(Number(`78.${tenth}`))).toBe(780 + tenth)
    }
  })

  it('refuses more than one decimal place rather than rounding it', () => {
    // 78.45 must not silently become 78.5 — the value read back would not be
    // the value typed, and nobody would be told.
    expect(toWeightTenths(78.45)).toBeNull()
    expect(toWeightTenths(78.44)).toBeNull()
    expect(toWeightTenths(0.01)).toBeNull()
  })

  it('refuses zero and negative weights', () => {
    expect(toWeightTenths(0)).toBeNull()
    expect(toWeightTenths(-1)).toBeNull()
    expect(toWeightTenths(-78.4)).toBeNull()
  })

  it('refuses anything that is not a finite number', () => {
    for (const bad of [NaN, Infinity, -Infinity, '78.4', null, undefined, {}, []]) {
      expect(toWeightTenths(bad), String(bad)).toBeNull()
    }
  })

  it('refuses values outside the technical safety bound', () => {
    expect(toWeightTenths(1000)).toBe(MAX_WEIGHT_TENTHS)
    expect(toWeightTenths(1000.1)).toBeNull()
    expect(toWeightTenths(50_000)).toBeNull()
  })

  it('round-trips exactly', () => {
    for (const tenths of [1, 780, 784, 1000, 9999]) {
      expect(toWeightTenths(fromWeightTenths(tenths))).toBe(tenths)
    }
  })

  it('formats with one decimal place, always', () => {
    expect(formatWeight(784)).toBe('78.4')
    // 78.0, not 78: the precision shown is the precision stored.
    expect(formatWeight(780)).toBe('78.0')
    expect(formatWeight(5)).toBe('0.5')
  })

  it('formats a change with an explicit sign', () => {
    expect(formatWeightChange(4)).toBe('+0.4')
    expect(formatWeightChange(-12)).toBe('-1.2')
    // Exactly zero is a real answer and reads as neither gain nor loss.
    expect(formatWeightChange(0)).toBe('0.0')
  })

  it('subtracts without float error', () => {
    // The whole reason for integer tenths: 78.4 - 78.5 as floats is
    // -0.09999999999999432.
    const change = 784 - 785
    expect(change).toBe(-1)
    expect(formatWeightChange(change)).toBe('-0.1')
  })
})

/* ------------------------------------------------------------------ */
/* 2. The user's own calendar                                          */
/* ------------------------------------------------------------------ */

describe('2. local dates, not UTC dates', () => {
  it('derives today in the requested zone', () => {
    // 2026-09-14T20:00Z is already the 15th in Kuala Lumpur (UTC+8).
    const instant = new Date('2026-09-14T20:00:00Z')
    expect(todayIn('Asia/Kuala_Lumpur', instant)).toBe('2026-09-15')
    expect(todayIn('UTC', instant)).toBe('2026-09-14')
    // And still the 14th in New York.
    expect(todayIn('America/New_York', instant)).toBe('2026-09-14')
  })

  it('accepts a local Today that UTC has not reached yet', () => {
    // 08:00 in Kuala Lumpur on the 15th is 00:00 UTC on the 15th... so use
    // 07:00 local, which is 23:00 UTC on the 14th: local Today is the 15th
    // while UTC still says the 14th.
    const instant = new Date('2026-09-14T23:00:00Z')
    const parsed = parseBodyWeightInput(
      { localDate: '2026-09-15', weightKg: 78.4, timezone: 'Asia/Kuala_Lumpur' },
      instant,
    )
    // Comparing against the UTC date would have called this the future.
    expect(parsed).toEqual({ ok: true, value: { localDate: '2026-09-15', weightTenths: 784 } })
  })

  it('accepts a local Today that UTC has already passed', () => {
    // 20:00 UTC on the 14th is still 16:00 on the 14th in New York.
    const instant = new Date('2026-09-14T20:00:00Z')
    const parsed = parseBodyWeightInput(
      { localDate: '2026-09-14', weightKg: 80, timezone: 'America/New_York' },
      instant,
    )
    expect(parsed.ok).toBe(true)
  })

  it('backfills a past date', () => {
    const parsed = parseBodyWeightInput(
      { localDate: '2026-01-02', weightKg: 81.2, timezone: 'Asia/Kuala_Lumpur' },
      new Date('2026-09-14T12:00:00Z'),
    )
    expect(parsed).toEqual({ ok: true, value: { localDate: '2026-01-02', weightTenths: 812 } })
  })

  it('refuses a future local date', () => {
    const parsed = parseBodyWeightInput(
      { localDate: '2026-09-16', weightKg: 78.4, timezone: 'Asia/Kuala_Lumpur' },
      new Date('2026-09-14T12:00:00Z'),
    )
    // Its own failure category: a measurement that has not happened is not the
    // same problem as a malformed date.
    expect(parsed).toEqual({ ok: false, field: 'future' })
  })

  it('refuses a malformed or impossible date', () => {
    const now = new Date('2026-09-14T12:00:00Z')
    for (const bad of ['2026-9-1', '14/09/2026', '2026-02-30', '2026-13-01', '', 20260914, null]) {
      const parsed = parseBodyWeightInput(
        { localDate: bad, weightKg: 78.4, timezone: 'UTC' },
        now,
      )
      expect(parsed, String(bad)).toEqual({ ok: false, field: 'date' })
    }
  })

  it('refuses an invalid or missing timezone', () => {
    const now = new Date('2026-09-14T12:00:00Z')
    for (const bad of ['Mars/Olympus', '+08:00', 'GMT+8', '', null, undefined, 8]) {
      const parsed = parseBodyWeightInput(
        { localDate: '2026-09-14', weightKg: 78.4, timezone: bad },
        now,
      )
      // Without a usable zone there is no way to know whether the date is in
      // the future, so the write is refused rather than defaulted to UTC.
      expect(parsed, String(bad)).toEqual({ ok: false, field: 'timezone' })
    }
  })

  it('accepts real IANA zones', () => {
    const now = new Date('2026-09-14T12:00:00Z')
    for (const zone of ['UTC', 'Asia/Kuala_Lumpur', 'America/New_York', 'Europe/London']) {
      const parsed = parseBodyWeightInput(
        { localDate: '2026-09-13', weightKg: 78.4, timezone: zone },
        now,
      )
      expect(parsed.ok, zone).toBe(true)
    }
  })

  it('refuses a body that is not an object', () => {
    const now = new Date('2026-09-14T12:00:00Z')
    for (const bad of [null, 'weight', 42, [], undefined]) {
      expect(parseBodyWeightInput(bad, now)).toEqual({ ok: false, field: 'body' })
    }
  })

  it('never takes an account from the payload', () => {
    const parsed = parseBodyWeightInput(
      {
        localDate: '2026-09-13',
        weightKg: 78.4,
        timezone: 'UTC',
        googleSub: 'someone-else',
        email: 'someone@example.com',
      },
      new Date('2026-09-14T12:00:00Z'),
    )
    // The parsed value carries the date and the weight, and nothing else. An
    // identity in the payload is simply not part of the contract.
    expect(parsed.ok && Object.keys(parsed.value)).toEqual(['localDate', 'weightTenths'])
  })
})

/* ------------------------------------------------------------------ */
/* 3. Windows                                                          */
/* ------------------------------------------------------------------ */

describe('3. 30D / 90D / All', () => {
  it('counts today as day one of the window', () => {
    // 30 days INCLUDING today ends 29 days back, not 30.
    expect(rangeWindow('30d', '2026-09-30')).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(rangeWindow('90d', '2026-09-30')).toEqual({ from: '2026-07-03', to: '2026-09-30' })
  })

  it('crosses a month and a year boundary correctly', () => {
    expect(rangeWindow('30d', '2027-01-15')).toEqual({ from: '2026-12-17', to: '2027-01-15' })
  })

  it('has no lower bound for All', () => {
    expect(rangeWindow('all', '2026-09-30')).toBeNull()
  })

  it('refuses to build a window from a non-date', () => {
    expect(rangeWindow('30d', 'not-a-date')).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* 4. What can honestly be said                                        */
/* ------------------------------------------------------------------ */

describe('4. summaries', () => {
  const point = (date: string, tenths: number) => ({ date, tenths })

  it('says nothing at all with no measurements', () => {
    expect(summariseBodyWeight([])).toEqual({
      latest: null,
      previous: null,
      first: null,
      changeFromPrevious: null,
      changeFromFirst: null,
      count: 0,
    })
  })

  it('reports the one measurement and refuses to compare it', () => {
    const summary = summariseBodyWeight([point('2026-09-01', 784)])

    expect(summary.latest).toEqual(point('2026-09-01', 784))
    expect(summary.first).toEqual(point('2026-09-01', 784))
    // Null, not 0. "No change" would claim a comparison that cannot be made.
    expect(summary.previous).toBeNull()
    expect(summary.changeFromPrevious).toBeNull()
    expect(summary.changeFromFirst).toBeNull()
    expect(summary.count).toBe(1)
  })

  it('computes change from the previous measurement', () => {
    const summary = summariseBodyWeight([
      point('2026-09-01', 800),
      point('2026-09-10', 790),
      point('2026-09-20', 784),
    ])

    expect(summary.latest?.tenths).toBe(784)
    expect(summary.previous?.tenths).toBe(790)
    // Exact: -0.6 kg, with no float residue.
    expect(summary.changeFromPrevious).toBe(-6)
  })

  it('computes change since the first measurement', () => {
    const summary = summariseBodyWeight([
      point('2026-09-01', 800),
      point('2026-09-10', 790),
      point('2026-09-20', 784),
    ])
    expect(summary.first?.tenths).toBe(800)
    expect(summary.changeFromFirst).toBe(-16)
  })

  it('reports a gain as a positive change', () => {
    const summary = summariseBodyWeight([point('2026-09-01', 780), point('2026-09-10', 795)])
    expect(summary.changeFromPrevious).toBe(15)
    expect(formatWeightChange(summary.changeFromPrevious as number)).toBe('+1.5')
  })

  it('reports an unchanged weight as exactly zero, not as unknown', () => {
    const summary = summariseBodyWeight([point('2026-09-01', 784), point('2026-09-10', 784)])
    // Two measurements that agree IS a comparison, and its answer is 0.0.
    expect(summary.changeFromPrevious).toBe(0)
  })

  it('does not care what order the measurements arrive in', () => {
    const jumbled = summariseBodyWeight([
      point('2026-09-20', 784),
      point('2026-09-01', 800),
      point('2026-09-10', 790),
    ])
    expect(jumbled.latest?.date).toBe('2026-09-20')
    expect(jumbled.first?.date).toBe('2026-09-01')
    expect(jumbled.previous?.date).toBe('2026-09-10')
  })

  it('never invents a measurement for a missing day', () => {
    const summary = summariseBodyWeight([point('2026-09-01', 800), point('2026-09-20', 784)])
    // Nineteen days apart, two points. Nothing filled the gap, and nothing
    // treated the missing days as zero.
    expect(summary.count).toBe(2)
  })
})
