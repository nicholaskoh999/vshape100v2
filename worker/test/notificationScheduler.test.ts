import { describe, expect, it, vi } from 'vitest'

import { holidayDaysOf } from '../../shared/today/holidayDays'
import type { HolidayRecord } from '../../shared/holiday'
import type { HolidayDays } from '../../shared/today/engine'
import {
  MAX_SWEEP_SUBSCRIPTIONS,
  type PushStore,
  type PushSubscriptionRow,
} from '../notifications/notifications'
import {
  dueForSubscription,
  runScheduledSweep,
  type ScheduleTruth,
} from '../notifications/scheduler'
import type { PushOutcome, VapidConfig } from '../push/webPush'

/**
 * Round 14 — the scheduled reminder sweep.
 *
 * The sweep is a delivery layer. It owns no clock: every time below comes from
 * the accepted routine in shared/today, which is why these tests name items
 * ("Work", "Gym training") rather than restating times as truth.
 *
 * Two behaviours are defended hardest, because both would hurt a real person:
 * a reminder must never fire for something already done or exempt, and a
 * failed read must never be mistaken for "nothing due".
 *
 * 2026-09-14 is a Monday, 2026-09-19 a Saturday, 2026-09-20 a Sunday.
 */

const VAPID: VapidConfig = {
  publicKey: 'B'.repeat(86),
  privateKey: 'p'.repeat(43),
  subject: 'mailto:reminders@example.com',
}

/** An instant that reads as the given UTC wall clock. */
function at(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): number {
  return Date.UTC(year, month - 1, day, hour, minute, 0)
}

function subscription(over: Partial<PushSubscriptionRow> = {}): PushSubscriptionRow {
  return {
    id: 'sub-a',
    googleSub: 'google-a',
    endpoint: 'https://push.example/send/a',
    endpointHash: 'a'.repeat(64),
    p256dh: 'BPublicKeyMaterial',
    auth: 'AuthSecret',
    timezone: 'UTC',
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }
}

function holiday(
  startDate: string,
  endDate = startDate,
  over: Partial<HolidayRecord> = {},
): HolidayRecord {
  return {
    id: `h-${startDate}`,
    startDate,
    endDate,
    name: over.name ?? 'Company Holiday',
    source: over.source ?? 'company',
    trainingOn: over.trainingOn ?? false,
    createdAt: 0,
    updatedAt: 0,
  }
}

/** Truth that answers everything, with overridable pieces. */
function truthOf(
  over: {
    holidays?: readonly HolidayRecord[] | null
    completed?: readonly string[] | null
    workoutFinished?: boolean | null
  } = {},
): ScheduleTruth {
  return {
    async holidaysFor(_sub, from, to): Promise<HolidayDays | null> {
      if (over.holidays === null) return null
      return holidayDaysOf(over.holidays ?? [], { from, to })
    },
    async completionsFor() {
      if (over.completed === null) return null
      return new Set(over.completed ?? [])
    },
    async workoutFinished() {
      if (over.workoutFinished === undefined) return false
      return over.workoutFinished
    },
  }
}

/** An in-memory store that records what the sweep did. */
function storeOf(rows: PushSubscriptionRow[]) {
  const claims = new Set<string>()
  /** The claim rows, as the delivery table would hold them. */
  const records = new Map<string, { attempts: number; status: string }>()
  const marks: { id: string; minute: number; status: string }[] = []
  const removed: string[] = []
  const pruned: number[] = []
  let subscriptions = [...rows]

  const store: PushStore = {
    async upsertByEndpoint() {},
    async findByEndpointHash() {
      return null
    },
    async removeOwned() {
      return false
    },
    async removeById(id) {
      removed.push(id)
      subscriptions = subscriptions.filter((row) => row.id !== id)
      return true
    },
    async listAll() {
      return subscriptions
    },
    async claimDelivery(subscriptionId, _googleSub, triggerMinute, _now, maxAttempts) {
      const key = `${subscriptionId}|${triggerMinute}`
      const existing = records.get(key)

      if (!existing) {
        claims.add(key)
        records.set(key, { attempts: 1, status: 'claimed' })
        return true
      }

      // The same rule the SQL enforces: only an occurrence the push service
      // explicitly refused may be claimed again, and only within the bound.
      if (existing.status !== 'retryable' || existing.attempts >= maxAttempts) return false

      records.set(key, { attempts: existing.attempts + 1, status: 'claimed' })
      return true
    },
    async markDelivery(subscriptionId, triggerMinute, status) {
      marks.push({ id: subscriptionId, minute: triggerMinute, status })
      const key = `${subscriptionId}|${triggerMinute}`
      const existing = records.get(key)
      if (existing) records.set(key, { ...existing, status })
    },
    async pruneDeliveries(beforeMinute) {
      pruned.push(beforeMinute)
    },
  }

  return { store, claims, records, marks, removed, pruned }
}

type SentPush = { endpoint: string; payload: Record<string, unknown> }

/** A send that records what would have gone out. */
function recorder(outcome: PushOutcome = { status: 'sent' }) {
  const sent: SentPush[] = []
  const send = vi.fn(async (target: { endpoint: string }, payload: string) => {
    sent.push({ endpoint: target.endpoint, payload: JSON.parse(payload) })
    return outcome
  })
  return { sent, send: send as never }
}

/** Run one minute and report what was delivered. */
async function sweep(
  scheduledTime: number,
  options: {
    rows?: PushSubscriptionRow[]
    truth?: ScheduleTruth
    vapid?: VapidConfig | null
    outcome?: PushOutcome
  } = {},
) {
  const rows = options.rows ?? [subscription()]
  const bag = storeOf(rows)
  const { sent, send } = recorder(options.outcome)
  const result = await runScheduledSweep({
    scheduledTime,
    store: bag.store,
    truth: options.truth ?? truthOf(),
    vapid: options.vapid === undefined ? VAPID : options.vapid,
    send,
  })
  return { ...bag, sent, result }
}

/* ------------------------------------------------------------------ */
/* 1. Ordinary weekday times                                           */
/* ------------------------------------------------------------------ */

describe('1. the accepted weekday times', () => {
  it('sends Wake up at its accepted time', async () => {
    const { sent } = await sweep(at(2026, 9, 14, 7, 30))
    expect(sent).toHaveLength(1)
    expect(sent[0].payload.title).toBe('Wake up')
  })

  it('sends Work at its accepted time', async () => {
    const { sent } = await sweep(at(2026, 9, 14, 8, 0))
    expect(sent[0].payload.title).toBe('Work')
  })

  it('sends Gym training at its accepted time, linked to the session', async () => {
    const { sent } = await sweep(at(2026, 9, 14, 20, 30))
    expect(sent[0].payload.title).toBe('Gym training')
    // The link comes from the routine's own item, not from a second mapping.
    expect(sent[0].payload.to).toBe('/training/monday')
  })

  it('sends nothing on a minute where nothing starts', async () => {
    const { sent, result } = await sweep(at(2026, 9, 14, 9, 17))
    expect(sent).toHaveLength(0)
    expect(result.sent).toBe(0)
  })

  it('never notifies a flexible window', async () => {
    // Sunday is entirely windows: natural wake, weekly progress, room reset,
    // free time. Their bounds are ordering conventions, not accepted times.
    for (const [hour, minute] of [
      [6, 0],
      [12, 0],
      [17, 0],
      [22, 0],
    ]) {
      const { sent } = await sweep(at(2026, 9, 20, hour, minute))
      expect(sent, `${hour}:${minute}`).toHaveLength(0)
    }
  })

  it('still sends Saturday exact items', async () => {
    const { sent } = await sweep(at(2026, 9, 19, 7, 30))
    expect(sent[0].payload.title).toBe('Wake up')
  })
})

/* ------------------------------------------------------------------ */
/* 2. Cross-midnight                                                   */
/* ------------------------------------------------------------------ */

describe('2. cross-midnight occurrences', () => {
  it('sends Saturday Ready to sleep at 01:00 on Sunday', async () => {
    // The block belongs to Saturday's route even though it lands on Sunday.
    const { sent } = await sweep(at(2026, 9, 20, 1, 0))
    expect(sent).toHaveLength(1)
    expect(sent[0].payload.title).toBe('Ready to sleep')
  })

  it('uses the anchor day, not the calendar day, for its identity', async () => {
    // Completing it is recorded against SATURDAY, and that must suppress the
    // reminder that fires on Sunday morning.
    const { sent } = await sweep(at(2026, 9, 20, 1, 0), {
      truth: truthOf({ completed: ['2026-09-19:ready-to-sleep'] }),
    })
    expect(sent).toHaveLength(0)
  })

  it('is not suppressed by a completion keyed to the wrong day', async () => {
    const { sent } = await sweep(at(2026, 9, 20, 1, 0), {
      truth: truthOf({ completed: ['2026-09-20:ready-to-sleep'] }),
    })
    expect(sent).toHaveLength(1)
  })

  it('is suppressed when the day it lands on is a Holiday', async () => {
    // Round 13 truth: a Holiday suppresses previous-day spillover. The
    // reminder must obey the same rule rather than deciding it separately.
    const { sent } = await sweep(at(2026, 9, 20, 1, 0), {
      truth: truthOf({ holidays: [holiday('2026-09-20')] }),
    })
    expect(sent).toHaveLength(0)
  })
})

/* ------------------------------------------------------------------ */
/* 3. Same-minute coalescing                                           */
/* ------------------------------------------------------------------ */

describe('3. two items, one minute', () => {
  it('sends ONE notification for 17:30, naming both', async () => {
    const { sent } = await sweep(at(2026, 9, 14, 17, 30))

    // Back home and Cook dinner + shower both start at 17:30. One event, one
    // interruption.
    expect(sent).toHaveLength(1)
    expect(sent[0].payload.body).toBe('Back home · Cook dinner + shower')
    expect(sent[0].payload.title).toBe('Up now')
    // No single destination is right for two items, so it opens Today.
    expect(sent[0].payload.to).toBe('/today')
  })

  it('names only what is left when one is already done', async () => {
    const { sent } = await sweep(at(2026, 9, 14, 17, 30), {
      truth: truthOf({ completed: ['2026-09-14:back-home'] }),
    })

    expect(sent).toHaveLength(1)
    expect(sent[0].payload.body).toBe('Cook dinner + shower')
    // Down to one item, so it inherits that item's own title.
    expect(sent[0].payload.title).toBe('Cook dinner + shower')
  })

  it('sends nothing when both are already done', async () => {
    const { sent } = await sweep(at(2026, 9, 14, 17, 30), {
      truth: truthOf({
        completed: ['2026-09-14:back-home', '2026-09-14:cook-dinner'],
      }),
    })
    expect(sent).toHaveLength(0)
  })
})

/* ------------------------------------------------------------------ */
/* 4. Completion and workout truth                                     */
/* ------------------------------------------------------------------ */

describe('4. already done', () => {
  it('does not remind about a completed occurrence', async () => {
    const { sent } = await sweep(at(2026, 9, 14, 8, 0), {
      truth: truthOf({ completed: ['2026-09-14:work'] }),
    })
    expect(sent).toHaveLength(0)
  })

  it('does not remind about a workout already finished early', async () => {
    // No routine tick, but the training itself is genuinely done.
    const { sent } = await sweep(at(2026, 9, 14, 20, 30), {
      truth: truthOf({ workoutFinished: true }),
    })
    expect(sent).toHaveLength(0)
  })

  it('still reminds when the workout is only in progress', async () => {
    const { sent } = await sweep(at(2026, 9, 14, 20, 30), {
      truth: truthOf({ workoutFinished: false }),
    })
    expect(sent).toHaveLength(1)
    expect(sent[0].payload.title).toBe('Gym training')
  })

  it('sends nothing when workout truth cannot be read', async () => {
    const { sent, result } = await sweep(at(2026, 9, 14, 20, 30), {
      truth: truthOf({ workoutFinished: null }),
    })
    // Fail closed: an unreadable workout could be a finished one.
    expect(sent).toHaveLength(0)
    expect(result.withheld).toBe(1)
  })

  it('sends nothing when completion truth cannot be read', async () => {
    const { sent, result } = await sweep(at(2026, 9, 14, 8, 0), {
      truth: truthOf({ completed: null }),
    })
    expect(sent).toHaveLength(0)
    expect(result.withheld).toBe(1)
  })

  it('sends nothing when a truth read throws', async () => {
    const exploding: ScheduleTruth = {
      async holidaysFor() {
        throw new Error('D1 unavailable')
      },
      async completionsFor() {
        return new Set()
      },
      async workoutFinished() {
        return false
      },
    }
    const { sent, result } = await sweep(at(2026, 9, 14, 8, 0), { truth: exploding })
    expect(sent).toHaveLength(0)
    expect(result.withheld).toBe(1)
  })
})

/* ------------------------------------------------------------------ */
/* 5. Holiday                                                          */
/* ------------------------------------------------------------------ */

describe('5. Holiday', () => {
  const merdeka = (trainingOn: boolean) => [
    holiday('2026-09-14', '2026-09-14', { name: 'Merdeka Day', trainingOn }),
  ]

  it('sends no Work reminder on a Training-Off weekday Holiday', async () => {
    const { sent } = await sweep(at(2026, 9, 14, 8, 0), {
      truth: truthOf({ holidays: merdeka(false) }),
    })
    expect(sent).toHaveLength(0)
  })

  it('sends no Back home reminder either', async () => {
    const { sent } = await sweep(at(2026, 9, 14, 17, 30), {
      truth: truthOf({ holidays: merdeka(false) }),
    })
    expect(sent).toHaveLength(0)
  })

  it('sends no Gym reminder on a Training-Off Holiday', async () => {
    const { sent } = await sweep(at(2026, 9, 14, 20, 30), {
      truth: truthOf({ holidays: merdeka(false) }),
    })
    // The workout may exist in D1; Training Off still removes the obligation.
    expect(sent).toHaveLength(0)
  })

  it('sends exactly the Gym reminder on a Training-On weekday Holiday', async () => {
    const { sent } = await sweep(at(2026, 9, 14, 20, 30), {
      truth: truthOf({ holidays: merdeka(true) }),
    })
    expect(sent).toHaveLength(1)
    expect(sent[0].payload.title).toBe('Gym training')
    expect(sent[0].payload.to).toBe('/training/monday')
  })

  it('does not bring Work or Back home back with Training On', async () => {
    for (const [hour, minute] of [
      [8, 0],
      [17, 30],
    ]) {
      const { sent } = await sweep(at(2026, 9, 14, hour, minute), {
        truth: truthOf({ holidays: merdeka(true) }),
      })
      expect(sent, `${hour}:${minute}`).toHaveLength(0)
    }
  })

  it('never notifies the Holiday recovery items', async () => {
    for (const [hour, minute] of [
      [6, 0],
      [12, 0],
      [17, 0],
    ]) {
      const { sent } = await sweep(at(2026, 9, 14, hour, minute), {
        truth: truthOf({ holidays: merdeka(false) }),
      })
      expect(sent, `${hour}:${minute}`).toHaveLength(0)
    }
  })

  it('sends no Gym reminder for a weekend Holiday, however it was stored', async () => {
    // Saturday: no underlying session exists to restore, so Training On is
    // meaningless and nothing is invented.
    const { sent } = await sweep(at(2026, 9, 19, 20, 30), {
      truth: truthOf({
        holidays: [holiday('2026-09-19', '2026-09-19', { trainingOn: true })],
      }),
    })
    expect(sent).toHaveLength(0)
  })

  it('sends nothing when Holiday truth cannot be read', async () => {
    const { sent, result } = await sweep(at(2026, 9, 14, 8, 0), {
      truth: truthOf({ holidays: null }),
    })
    // An unknown day might be an exempt one.
    expect(sent).toHaveLength(0)
    expect(result.withheld).toBe(1)
  })
})

/* ------------------------------------------------------------------ */
/* 6. Timezone                                                         */
/* ------------------------------------------------------------------ */

describe('6. each device on its own clock', () => {
  it('fires at the device local minute, not at UTC', async () => {
    // 12:30 UTC is 20:30 in Kuala Lumpur (UTC+8): gym time there.
    const { sent } = await sweep(at(2026, 9, 14, 12, 30), {
      rows: [subscription({ timezone: 'Asia/Kuala_Lumpur' })],
    })
    expect(sent).toHaveLength(1)
    expect(sent[0].payload.title).toBe('Gym training')
  })

  it('does not fire that device at the UTC time of day', async () => {
    const { sent } = await sweep(at(2026, 9, 14, 20, 30), {
      rows: [subscription({ timezone: 'Asia/Kuala_Lumpur' })],
    })
    // 20:30 UTC is 04:30 there; nothing starts then.
    expect(sent).toHaveLength(0)
  })

  it('evaluates two devices in different zones independently', async () => {
    const { sent } = await sweep(at(2026, 9, 14, 12, 30), {
      rows: [
        subscription({ id: 'sub-kl', timezone: 'Asia/Kuala_Lumpur' }),
        subscription({
          id: 'sub-utc',
          endpoint: 'https://push.example/send/b',
          endpointHash: 'b'.repeat(64),
          timezone: 'UTC',
        }),
      ],
    })

    // Only the Kuala Lumpur device is at 20:30.
    expect(sent).toHaveLength(1)
    expect(sent[0].endpoint).toBe('https://push.example/send/a')
  })

  it('never sends to a device with an unusable timezone', async () => {
    const { sent, result } = await sweep(at(2026, 9, 14, 8, 0), {
      rows: [subscription({ timezone: 'Mars/Olympus' })],
    })
    expect(sent).toHaveLength(0)
    expect(result.withheld).toBe(1)
  })

  it('reports it directly through dueForSubscription too', async () => {
    const due = await dueForSubscription(
      subscription({ timezone: 'not a zone' }),
      at(2026, 9, 14, 8, 0),
      truthOf(),
    )
    expect(due).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* 7. Cron identity and dedupe                                         */
/* ------------------------------------------------------------------ */

describe('7. one buzz per device per minute', () => {
  it('uses the scheduled minute, not the execution clock', async () => {
    const scheduledTime = at(2026, 9, 14, 20, 30)
    const bag = storeOf([subscription()])
    const { sent, send } = recorder()

    // Executed 20 seconds late, as Cloudflare sometimes does. It is still the
    // 20:30 event, and 20:30 is what must be evaluated and claimed.
    await runScheduledSweep({
      scheduledTime,
      now: scheduledTime + 20_000,
      store: bag.store,
      truth: truthOf(),
      vapid: VAPID,
      send,
    })

    expect(sent).toHaveLength(1)
    expect(sent[0].payload.title).toBe('Gym training')
    expect([...bag.claims][0]).toBe(`sub-a|${Math.floor(scheduledTime / 60_000)}`)
  })

  it('does not send twice when the same minute is retried', async () => {
    const scheduledTime = at(2026, 9, 14, 20, 30)
    const bag = storeOf([subscription()])
    const { sent, send } = recorder()

    const run = () =>
      runScheduledSweep({
        scheduledTime,
        store: bag.store,
        truth: truthOf(),
        vapid: VAPID,
        send,
      })

    await run()
    await run()

    // The claim is the mutual exclusion; the retry finds it taken.
    expect(sent).toHaveLength(1)
  })

  it('does not send twice when two invocations overlap', async () => {
    const scheduledTime = at(2026, 9, 14, 20, 30)
    const bag = storeOf([subscription()])
    const { sent, send } = recorder()

    await Promise.all([
      runScheduledSweep({
        scheduledTime,
        store: bag.store,
        truth: truthOf(),
        vapid: VAPID,
        send,
      }),
      runScheduledSweep({
        scheduledTime,
        store: bag.store,
        truth: truthOf(),
        vapid: VAPID,
        send,
      }),
    ])

    expect(sent).toHaveLength(1)
  })

  it('still sends at the NEXT eligible minute', async () => {
    const bag = storeOf([subscription()])
    const { sent, send } = recorder()

    for (const time of [at(2026, 9, 14, 20, 30), at(2026, 9, 14, 21, 30)]) {
      await runScheduledSweep({
        scheduledTime: time,
        store: bag.store,
        truth: truthOf(),
        vapid: VAPID,
        send,
      })
    }

    // A claim covers one minute, not the device.
    expect(sent.map((push) => push.payload.title)).toEqual(['Gym training', 'Shower + rest'])
  })

  it('prunes old claims without keeping any history', async () => {
    const { pruned } = await sweep(at(2026, 9, 14, 20, 30))
    expect(pruned).toHaveLength(1)
    expect(pruned[0]).toBeLessThan(Math.floor(at(2026, 9, 14, 20, 30) / 60_000))
  })
})

/* ------------------------------------------------------------------ */
/* 8. Delivery outcomes                                                */
/* ------------------------------------------------------------------ */

describe('8. what happens after sending', () => {
  it('retires only the subscription the push service says is gone', async () => {
    const rows = [
      subscription({ id: 'sub-gone' }),
      subscription({
        id: 'sub-fine',
        endpoint: 'https://push.example/send/b',
        endpointHash: 'b'.repeat(64),
      }),
    ]
    const bag = storeOf(rows)
    const send = vi.fn(async (target: { endpoint: string }) =>
      target.endpoint.endsWith('/a')
        ? ({ status: 'expired', httpStatus: 410 } as PushOutcome)
        : ({ status: 'sent' } as PushOutcome),
    )

    const result = await runScheduledSweep({
      scheduledTime: at(2026, 9, 14, 20, 30),
      store: bag.store,
      truth: truthOf(),
      vapid: VAPID,
      send: send as never,
    })

    expect(bag.removed).toEqual(['sub-gone'])
    expect(result.retired).toBe(1)
    expect(result.sent).toBe(1)
  })

  it('keeps a subscription after a refusal the service can retry', async () => {
    const { removed, result } = await sweep(at(2026, 9, 14, 20, 30), {
      outcome: { status: 'retryable', httpStatus: 503 },
    })
    expect(removed).toEqual([])
    expect(result.sent).toBe(0)
  })

  it('lets one device fail without disturbing another', async () => {
    const rows = [
      subscription({ id: 'sub-bad' }),
      subscription({
        id: 'sub-good',
        endpoint: 'https://push.example/send/b',
        endpointHash: 'b'.repeat(64),
      }),
    ]
    const bag = storeOf(rows)
    const send = vi.fn(async (target: { endpoint: string }) => {
      if (target.endpoint.endsWith('/a')) throw new Error('boom')
      return { status: 'sent' } as PushOutcome
    })

    const result = await runScheduledSweep({
      scheduledTime: at(2026, 9, 14, 20, 30),
      store: bag.store,
      truth: truthOf(),
      vapid: VAPID,
      send: send as never,
    })

    expect(result.sent).toBe(1)
    expect(bag.removed).toEqual([])
  })

  it('records the outcome without building a history', async () => {
    const { marks } = await sweep(at(2026, 9, 14, 20, 30))
    expect(marks).toEqual([
      { id: 'sub-a', minute: Math.floor(at(2026, 9, 14, 20, 30) / 60_000), status: 'sent' },
    ])
  })
})

/* ------------------------------------------------------------------ */
/* 9. Configuration                                                    */
/* ------------------------------------------------------------------ */

describe('9. missing configuration', () => {
  it('sends nothing at all without VAPID, and says why', async () => {
    const { sent, result } = await sweep(at(2026, 9, 14, 20, 30), { vapid: null })
    expect(sent).toHaveLength(0)
    expect(result.reason).toBe('not_configured')
    // It did not even look, so nothing was claimed.
    expect(result.examined).toBe(0)
  })

  it('bounds how many devices one sweep will consider', () => {
    expect(MAX_SWEEP_SUBSCRIPTIONS).toBeGreaterThan(0)
    expect(MAX_SWEEP_SUBSCRIPTIONS).toBeLessThanOrEqual(1000)
  })
})
