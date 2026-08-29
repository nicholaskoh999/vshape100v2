import { describe, expect, it } from 'vitest'

import { buildAgenda, itemSpan, minutesOfDay } from '@/features/today/model/engine'
import { formatRouteMinute, timeLabelFor } from '@/features/today/model/format'
import { groupByStatus, sortEntries } from '@/features/today/model/ordering'
import { routeForDate } from '@/features/today/model/routines'
import type { TodayEntry, TodayStatus } from '@/features/today/model/types'

/**
 * Engine tests. Every one of them injects an explicit `now` — the engine
 * never reads the system clock, so these are deterministic regardless of when
 * or where they run.
 */

// Real calendar anchors used throughout.
const MONDAY = [2026, 8, 7] as const // 2026-09-07
const TUESDAY = [2026, 8, 8] as const
const SATURDAY = [2026, 8, 12] as const
const SUNDAY = [2026, 8, 13] as const

function at([y, m, d]: readonly [number, number, number], hours: number, minutes = 0) {
  return new Date(y, m, d, hours, minutes)
}

function statusOf(now: Date, id: string, completed?: Set<string>): TodayStatus | undefined {
  return find(now, id, completed)?.status
}

function find(now: Date, id: string, completed?: Set<string>): TodayEntry | undefined {
  return buildAgenda(now, completed).entries.find(
    (entry) => entry.item.id === id && !entry.spillover,
  )
}

function idsWithStatus(now: Date, status: TodayStatus, completed?: Set<string>) {
  return buildAgenda(now, completed)
    .entries.filter((entry) => entry.status === status)
    .map((entry) => entry.key)
}

function keyFor(now: Date, id: string) {
  const entry = find(now, id)
  if (!entry) throw new Error(`no entry ${id}`)
  return entry.key
}

describe('1. before the first weekday item', () => {
  it('has nothing NOW and points at Wake up', () => {
    const now = at(MONDAY, 6, 0)
    const groups = groupByStatus(buildAgenda(now).entries)
    expect(groups.NOW).toHaveLength(0)
    expect(groups.NEXT.map((entry) => entry.item.id)).toEqual(['wake-up'])
    expect(groups.LATE).toHaveLength(0)
  })

  it('treats the whole day as still ahead', () => {
    const agenda = buildAgenda(at(MONDAY, 6, 0))
    const ahead = agenda.entries.filter(
      (entry) => entry.status === 'NEXT' || entry.status === 'LATER',
    )
    expect(ahead).toHaveLength(agenda.entries.length)
  })
})

describe('2. exact start boundary', () => {
  it('turns Gym training NOW at exactly 20:30', () => {
    expect(statusOf(at(MONDAY, 20, 30), 'gym-training')).toBe('NOW')
  })

  it('is still NEXT one minute before', () => {
    expect(statusOf(at(MONDAY, 20, 29), 'gym-training')).toBe('NEXT')
    expect(statusOf(at(MONDAY, 20, 29), 'dinner-netflix')).toBe('NOW')
  })

  it('turns Work NOW at exactly 08:00', () => {
    expect(statusOf(at(MONDAY, 8, 0), 'work')).toBe('NOW')
  })
})

describe('3. during an active item', () => {
  it('keeps Gym training NOW mid-interval', () => {
    expect(statusOf(at(MONDAY, 20, 45), 'gym-training')).toBe('NOW')
  })

  it('holds a moment until the next thing in the route starts', () => {
    // 07:30 Wake up has no duration of its own; it holds until Work at 08:00.
    expect(statusOf(at(MONDAY, 7, 45), 'wake-up')).toBe('NOW')
    expect(statusOf(at(MONDAY, 8, 0), 'wake-up')).toBe('LATE')
  })
})

describe('4. exact end boundary', () => {
  it('hands NOW to the next item at exactly 21:30', () => {
    const now = at(MONDAY, 21, 30)
    expect(statusOf(now, 'gym-training')).toBe('LATE')
    expect(statusOf(now, 'shower-rest')).toBe('NOW')
  })

  it('does not mark the ended item complete', () => {
    expect(find(at(MONDAY, 21, 30), 'gym-training')?.completed).toBe(false)
  })
})

describe('5. future NEXT selection', () => {
  it('picks the closest upcoming unfinished item', () => {
    expect(groupByStatus(buildAgenda(at(MONDAY, 19, 0)).entries).NEXT[0].item.id).toBe(
      'gym-training',
    )
  })

  it('skips a completed item when choosing NEXT', () => {
    const now = at(MONDAY, 19, 0)
    const completed = new Set([keyFor(now, 'gym-training')])
    expect(groupByStatus(buildAgenda(now, completed).entries).NEXT[0].item.id).toBe(
      'shower-rest',
    )
  })

  it('has exactly one NEXT', () => {
    expect(idsWithStatus(at(MONDAY, 19, 0), 'NEXT')).toHaveLength(1)
  })
})

describe('6. remaining future items are LATER', () => {
  it('lists every other upcoming item behind NEXT', () => {
    const groups = groupByStatus(buildAgenda(at(MONDAY, 19, 0)).entries)
    expect(groups.NEXT[0].item.id).toBe('gym-training')
    expect(groups.LATER.map((entry) => entry.item.id)).toEqual([
      'shower-rest',
      'reading',
      'evening-netflix',
      'ready-to-sleep',
    ])
  })
})

describe('7. overdue unfinished work is LATE', () => {
  it('marks a passed, untouched item LATE', () => {
    expect(statusOf(at(MONDAY, 22, 0), 'gym-training')).toBe('LATE')
  })

  it('keeps LATE ahead of NEXT and LATER in display order', () => {
    const entries = sortEntries(buildAgenda(at(MONDAY, 22, 0)).entries)
    const late = entries.findIndex((entry) => entry.status === 'LATE')
    const next = entries.findIndex((entry) => entry.status === 'NEXT')
    const later = entries.findIndex((entry) => entry.status === 'LATER')
    expect(late).toBeLessThan(next)
    expect(late).toBeLessThan(later)
  })
})

describe('8. time never completes a task', () => {
  it('never produces DONE EARLIER from the clock alone', () => {
    for (let hour = 0; hour < 24; hour += 1) {
      for (const minute of [0, 29, 30, 31, 59]) {
        const agenda = buildAgenda(at(MONDAY, hour, minute))
        expect(agenda.entries.some((entry) => entry.status === 'DONE_EARLIER')).toBe(false)
        expect(agenda.entries.some((entry) => entry.completed)).toBe(false)
      }
    }
  })

  it('leaves an item that ran its full course unfinished and LATE', () => {
    const entry = find(at(MONDAY, 23, 0), 'gym-training')
    expect(entry?.completed).toBe(false)
    expect(entry?.status).toBe('LATE')
  })
})

describe('9. manual completion', () => {
  it('marks only the completed occurrence DONE EARLIER', () => {
    const now = at(MONDAY, 20, 45)
    const completed = new Set([keyFor(now, 'gym-training')])
    expect(statusOf(now, 'gym-training', completed)).toBe('DONE_EARLIER')
    expect(statusOf(now, 'reading', completed)).toBe('LATER')
  })

  it('can complete an item before its time and drops it to the bottom', () => {
    const now = at(MONDAY, 9, 0)
    const completed = new Set([keyFor(now, 'gym-training')])
    const entries = sortEntries(buildAgenda(now, completed).entries)
    expect(entries[entries.length - 1].item.id).toBe('gym-training')
    expect(entries[entries.length - 1].status).toBe('DONE_EARLIER')
  })

  it('completes a LATE item', () => {
    const now = at(MONDAY, 22, 0)
    const completed = new Set([keyFor(now, 'gym-training')])
    expect(statusOf(now, 'gym-training', completed)).toBe('DONE_EARLIER')
  })
})

describe('10. undo restores the computed time state', () => {
  it.each([
    [at(MONDAY, 20, 45), 'NOW'],
    [at(MONDAY, 22, 0), 'LATE'],
    [at(MONDAY, 19, 0), 'NEXT'],
    [at(MONDAY, 6, 0), 'LATER'],
  ])('restores %s to its clock-derived status', (now, expected) => {
    const key = keyFor(now as Date, 'gym-training')
    expect(statusOf(now as Date, 'gym-training', new Set([key]))).toBe('DONE_EARLIER')
    expect(statusOf(now as Date, 'gym-training', new Set())).toBe(expected)
  })
})

describe('11. multiple overdue items', () => {
  it('keeps every untouched past item LATE', () => {
    const now = at(MONDAY, 23, 0)
    const late = buildAgenda(now)
      .entries.filter((entry) => entry.status === 'LATE')
      .map((entry) => entry.item.id)
    expect(late).toEqual([
      'wake-up',
      'work',
      'back-home',
      'cook-dinner',
      'dinner-netflix',
      'gym-training',
      'shower-rest',
      'reading',
    ])
  })

  it('orders LATE oldest first', () => {
    const late = groupByStatus(buildAgenda(at(MONDAY, 23, 0)).entries).LATE
    const starts = late.map((entry) => entry.start)
    expect([...starts].sort((a, b) => a - b)).toEqual(starts)
  })

  it('shrinks the LATE list as items are completed, without touching the rest', () => {
    const now = at(MONDAY, 23, 0)
    const completed = new Set([keyFor(now, 'gym-training'), keyFor(now, 'reading')])
    const late = buildAgenda(now, completed)
      .entries.filter((entry) => entry.status === 'LATE')
      .map((entry) => entry.item.id)
    expect(late).not.toContain('gym-training')
    expect(late).not.toContain('reading')
    expect(late).toContain('work')
  })
})

describe('12. the 23:30–00:30 cross-midnight interval', () => {
  it('is not truncated at midnight', () => {
    const route = routeForDate(at(MONDAY, 12, 0))
    const sleep = route.items.find((item) => item.id === 'ready-to-sleep')!
    expect(itemSpan(sleep, route.items)).toEqual({ start: 23 * 60 + 30, end: 24 * 60 + 30 })
    expect(timeLabelFor(sleep)).toBe('23:30 – 00:30')
  })

  it('is flagged as crossing midnight', () => {
    expect(find(at(MONDAY, 23, 40), 'ready-to-sleep')?.crossesMidnight).toBe(true)
  })

  it('is NOW at 23:40 on the same evening', () => {
    expect(statusOf(at(MONDAY, 23, 40), 'ready-to-sleep')).toBe('NOW')
  })
})

describe('13. previous-day spillover after midnight', () => {
  it("carries Monday's sleep block into Tuesday 00:15 as NOW", () => {
    const agenda = buildAgenda(at(TUESDAY, 0, 15))
    const spilled = agenda.entries.filter((entry) => entry.spillover)
    expect(spilled.map((entry) => entry.item.id)).toEqual(['ready-to-sleep'])
    expect(spilled[0].status).toBe('NOW')
    expect(spilled[0].anchorDay).toBe('2026-09-07')
    expect(spilled[0].key).toBe('2026-09-07:ready-to-sleep')
  })

  it('keeps the spillover distinct from the same item on the new day', () => {
    const agenda = buildAgenda(at(TUESDAY, 0, 15))
    const sleeps = agenda.entries.filter((entry) => entry.item.id === 'ready-to-sleep')
    expect(sleeps).toHaveLength(2)
    expect(new Set(sleeps.map((entry) => entry.key)).size).toBe(2)
  })

  it('completing the spillover leaves tonight untouched', () => {
    const now = at(TUESDAY, 0, 15)
    const completed = new Set(['2026-09-07:ready-to-sleep'])
    const agenda = buildAgenda(now, completed)
    const [yesterday, today] = agenda.entries.filter(
      (entry) => entry.item.id === 'ready-to-sleep',
    )
    expect(yesterday.status).toBe('DONE_EARLIER')
    expect(today.status).not.toBe('DONE_EARLIER')
  })

  it('only spills items that actually reach past midnight', () => {
    const agenda = buildAgenda(at(TUESDAY, 0, 15))
    expect(agenda.entries.filter((entry) => entry.spillover)).toHaveLength(1)
  })

  it('leaves an unfinished spillover visible as LATE once it has ended', () => {
    const spilled = buildAgenda(at(TUESDAY, 2, 0)).entries.filter((entry) => entry.spillover)
    expect(spilled).toHaveLength(1)
    expect(spilled[0].status).toBe('LATE')
  })
})

describe('14. transition across calendar midnight', () => {
  it("moves from Monday's evening to Tuesday's day without losing the block", () => {
    const before = buildAgenda(at(MONDAY, 23, 59))
    const beforeNow = before.entries.filter((entry) => entry.status === 'NOW')
    expect(beforeNow.map((entry) => entry.key)).toEqual(['2026-09-07:ready-to-sleep'])
    expect(before.day).toBe('2026-09-07')

    const after = buildAgenda(at(TUESDAY, 0, 0))
    const afterNow = after.entries.filter((entry) => entry.status === 'NOW')
    expect(afterNow.map((entry) => entry.key)).toEqual(['2026-09-07:ready-to-sleep'])
    expect(after.day).toBe('2026-09-08')
  })

  it('normalises spillover minutes relative to the new day', () => {
    const spilled = buildAgenda(at(TUESDAY, 0, 10)).entries.find((entry) => entry.spillover)!
    expect(spilled.start).toBe(-30)
    expect(spilled.end).toBe(30)
    // The label still reads in the routine's own terms.
    expect(spilled.timeLabel).toBe('23:30 – 00:30')
  })

  it('ends the spillover at exactly 00:30', () => {
    expect(
      buildAgenda(at(TUESDAY, 0, 30)).entries.find((entry) => entry.spillover)!.status,
    ).toBe('LATE')
  })
})

describe('15. Saturday Chill route', () => {
  it('uses the chill route with no gym', () => {
    const agenda = buildAgenda(at(SATURDAY, 12, 0))
    expect(agenda.route.id).toBe('saturday')
    expect(agenda.route.label).toBe('Chill route')
    expect(agenda.entries.some((entry) => entry.item.id === 'gym-training')).toBe(false)
  })

  it('still runs work 08:00–17:00', () => {
    expect(statusOf(at(SATURDAY, 12, 0), 'work')).toBe('NOW')
    expect(timeLabelFor(routeForDate(at(SATURDAY, 12, 0)).items[1])).toBe('08:00 – 17:00')
  })

  it('hands the evening to the flexible chill window when work ends', () => {
    expect(statusOf(at(SATURDAY, 17, 0), 'chill')).toBe('NOW')
    expect(statusOf(at(SATURDAY, 16, 59), 'chill')).toBe('NEXT')
  })
})

describe('16. Saturday 01:00–03:00 spillover', () => {
  it('belongs to Saturday even though it lands on Sunday', () => {
    const entry = find(at(SATURDAY, 22, 0), 'ready-to-sleep')!
    expect(entry.start).toBe(25 * 60)
    expect(entry.end).toBe(27 * 60)
    expect(entry.timeLabel).toBe('01:00 – 03:00')
    // The chill window is still current at 22:00, so the sleep block is the
    // closest upcoming item.
    expect(entry.status).toBe('NEXT')
  })

  it('is NOW on Sunday at 01:30 as a Saturday occurrence', () => {
    const agenda = buildAgenda(at(SUNDAY, 1, 30))
    const sleep = agenda.entries.find((entry) => entry.item.id === 'ready-to-sleep')!
    expect(sleep.spillover).toBe(true)
    expect(sleep.routeId).toBe('saturday')
    expect(sleep.anchorDay).toBe('2026-09-12')
    expect(sleep.status).toBe('NOW')
    expect(agenda.day).toBe('2026-09-13')
  })

  it("also carries Saturday's chill window across midnight", () => {
    const chill = buildAgenda(at(SUNDAY, 0, 30)).entries.find(
      (entry) => entry.item.id === 'chill' && entry.spillover,
    )!
    expect(chill.status).toBe('NOW')
    expect(chill.routeId).toBe('saturday')
  })
})

describe('17. Sunday Recovery route', () => {
  it('uses the recovery route with no gym and no work', () => {
    const agenda = buildAgenda(at(SUNDAY, 10, 0))
    expect(agenda.route.id).toBe('sunday')
    expect(agenda.route.label).toBe('Recovery route')
    for (const id of ['gym-training', 'work']) {
      expect(agenda.entries.some((entry) => entry.item.id === id && !entry.spillover)).toBe(
        false,
      )
    }
  })

  it('carries natural wake, the progress check, the room reset and free time', () => {
    const ids = buildAgenda(at(SUNDAY, 10, 0))
      .entries.filter((entry) => !entry.spillover)
      .map((entry) => entry.item.id)
    expect(ids).toEqual(['natural-wake', 'weekly-progress', 'room-reset', 'free-time'])
  })

  it('puts the room reset in the evening', () => {
    expect(statusOf(at(SUNDAY, 10, 0), 'room-reset')).toBe('LATER')
    expect(statusOf(at(SUNDAY, 19, 0), 'room-reset')).toBe('NOW')
  })
})

describe('18. flexible / window items', () => {
  it('never renders a clock range', () => {
    const agenda = buildAgenda(at(SUNDAY, 10, 0))
    for (const entry of agenda.entries.filter((item) => item.flexible)) {
      expect(entry.timeLabel).not.toMatch(/\d{2}:\d{2}/)
    }
    expect(find(at(SUNDAY, 10, 0), 'room-reset')?.timeLabel).toBe('Evening · 1 hour')
    expect(find(at(SUNDAY, 10, 0), 'natural-wake')?.timeLabel).toBe('No alarm')
  })

  it('marks every Sunday item flexible and no weekday interval flexible', () => {
    const sunday = buildAgenda(at(SUNDAY, 10, 0)).entries.filter((entry) => !entry.spillover)
    expect(sunday.every((entry) => entry.flexible)).toBe(true)
    expect(find(at(MONDAY, 10, 0), 'gym-training')?.flexible).toBe(false)
  })

  it('runs through the same NOW / LATE lifecycle as a fixed item', () => {
    expect(statusOf(at(SUNDAY, 5, 0), 'natural-wake')).toBe('NEXT')
    expect(statusOf(at(SUNDAY, 9, 0), 'natural-wake')).toBe('NOW')
    expect(statusOf(at(SUNDAY, 13, 0), 'natural-wake')).toBe('LATE')
    const completed = new Set([keyFor(at(SUNDAY, 13, 0), 'natural-wake')])
    expect(statusOf(at(SUNDAY, 13, 0), 'natural-wake', completed)).toBe('DONE_EARLIER')
  })

  it('lets overlapping windows both be current', () => {
    const nowIds = idsWithStatus(at(SUNDAY, 19, 0), 'NOW')
    expect(nowIds).toEqual(['2026-09-13:room-reset', '2026-09-13:free-time'])
  })
})

describe('19. deterministic injected clock', () => {
  it('returns the same agenda for the same instant', () => {
    const first = buildAgenda(at(MONDAY, 20, 45))
    const second = buildAgenda(at(MONDAY, 20, 45))
    expect(first.entries.map((entry) => [entry.key, entry.status])).toEqual(
      second.entries.map((entry) => [entry.key, entry.status]),
    )
  })

  it('ignores seconds — boundaries are minute-aligned', () => {
    expect(minutesOfDay(new Date(2026, 8, 7, 20, 30, 59))).toBe(20 * 60 + 30)
    expect(statusOf(new Date(2026, 8, 7, 20, 29, 59), 'gym-training')).toBe('NEXT')
    expect(statusOf(new Date(2026, 8, 7, 20, 30, 1), 'gym-training')).toBe('NOW')
  })

  it('formats route minutes past 24:00 by wrapping', () => {
    expect(formatRouteMinute(25 * 60)).toBe('01:00')
    expect(formatRouteMinute(24 * 60 + 30)).toBe('00:30')
    expect(formatRouteMinute(-30)).toBe('23:30')
  })
})

describe('20. stable ordering', () => {
  it('only moves the completed item', () => {
    const now = at(MONDAY, 20, 45)
    const before = sortEntries(buildAgenda(now).entries).map((entry) => entry.key)
    const completed = new Set([keyFor(now, 'reading')])
    const after = sortEntries(buildAgenda(now, completed).entries).map((entry) => entry.key)
    expect(after.filter((key) => !key.endsWith(':reading'))).toEqual(
      before.filter((key) => !key.endsWith(':reading')),
    )
    expect(after[after.length - 1]).toBe(`${now.getFullYear()}-09-07:reading`)
  })

  it('restores the original order after undo', () => {
    const now = at(MONDAY, 20, 45)
    const before = sortEntries(buildAgenda(now).entries).map((entry) => entry.key)
    const completed = new Set([keyFor(now, 'reading')])
    sortEntries(buildAgenda(now, completed).entries)
    const undone = sortEntries(buildAgenda(now, new Set()).entries).map((entry) => entry.key)
    expect(undone).toEqual(before)
  })

  it('keeps a total order as the clock advances', () => {
    for (const hour of [7, 8, 12, 17, 18, 20, 21, 22, 23]) {
      const entries = sortEntries(buildAgenda(at(MONDAY, hour, 30)).entries)
      expect(new Set(entries.map((entry) => entry.key)).size).toBe(entries.length)
      for (let i = 1; i < entries.length; i += 1) {
        const rank = ['NOW', 'LATE', 'NEXT', 'LATER', 'DONE_EARLIER']
        expect(rank.indexOf(entries[i - 1].status)).toBeLessThanOrEqual(
          rank.indexOf(entries[i].status),
        )
      }
    }
  })

  it('keeps every entry in exactly one group', () => {
    const agenda = buildAgenda(at(MONDAY, 21, 30))
    const groups = groupByStatus(agenda.entries)
    const total = Object.values(groups).reduce((sum, group) => sum + group.length, 0)
    expect(total).toBe(agenda.entries.length)
  })
})
