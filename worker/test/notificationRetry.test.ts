import { describe, expect, it, vi } from 'vitest'

import { createD1PushStore } from '../notifications/d1Store'
import { MAX_DELIVERY_ATTEMPTS } from '../notifications/notifications'
import { runScheduledSweep, type ScheduleTruth } from '../notifications/scheduler'
import type { PushOutcome, VapidConfig } from '../push/webPush'
import { createFakeD1 } from './fakeD1'

/**
 * Round 14 correction 1 — a refused reminder may be retried; a delivered one
 * may not.
 *
 * The original claim was `INSERT OR IGNORE`. That made "at most one buzz"
 * true, but it also made the claim permanent: a push service returning 503
 * left a row behind that no later invocation could ever get past, so the
 * reminder was lost for good.
 *
 * The fix is to make the claim a state machine rather than a flag, and to be
 * precise about what a failure PROVED:
 *
 *   sent       accepted. Never again.
 *   retryable  the service explicitly refused it, so it definitely was not
 *              delivered. Safe to claim again.
 *   rejected   permanently refused. Terminal.
 *   ambiguous  no answer at all. Terminal ON PURPOSE — it may already have
 *              been delivered, and one moment must not buzz twice.
 *
 * These run against the real D1 statements through the fake, so the mutual
 * exclusion under test is the actual conditional write.
 */

const VAPID: VapidConfig = {
  publicKey: 'B'.repeat(86),
  privateKey: 'p'.repeat(43),
  subject: 'mailto:reminders@example.com',
}

/** Monday 2026-09-14, 20:30 UTC — the accepted gym slot. */
const GYM_MINUTE = Date.UTC(2026, 8, 14, 20, 30, 0)

const TRUTH: ScheduleTruth = {
  async holidaysFor() {
    return new Map()
  },
  async completionsFor() {
    return new Set()
  },
  async workoutFinished() {
    return false
  },
}

async function seedDevice(db: D1Database, id = 'sub-a', endpointHash = 'a'.repeat(64)) {
  const store = createD1PushStore(db)
  await store.upsertByEndpoint({
    id,
    googleSub: 'google-a',
    endpoint: `https://push.example/send/${id}`,
    endpointHash,
    p256dh: 'BPublicKeyMaterial',
    auth: 'AuthSecret',
    timezone: 'UTC',
    createdAt: 1,
    updatedAt: 1,
  })
  return store
}

/** A send whose outcome can be changed between invocations. */
function programmable(outcomes: PushOutcome[]) {
  const sent: string[] = []
  let index = 0
  const send = vi.fn(async (target: { endpoint: string }) => {
    sent.push(target.endpoint)
    const outcome = outcomes[Math.min(index, outcomes.length - 1)]
    index += 1
    return outcome
  })
  return { sent, send: send as never }
}

async function sweepOnce(
  db: D1Database,
  send: never,
  scheduledTime = GYM_MINUTE,
) {
  return runScheduledSweep({
    scheduledTime,
    store: createD1PushStore(db),
    truth: TRUTH,
    vapid: VAPID,
    send,
  })
}

function claimRow(fake: ReturnType<typeof createFakeD1>, id = 'sub-a') {
  const minute = Math.floor(GYM_MINUTE / 60_000)
  return fake.notificationDeliveries.get(`${id} ${minute}`)
}

/* ------------------------------------------------------------------ */
/* A. Concurrency still holds                                          */
/* ------------------------------------------------------------------ */

describe('A. overlapping invocations', () => {
  it('lets at most one of two concurrent sweeps send', async () => {
    const fake = createFakeD1()
    await seedDevice(fake.db)
    const { sent, send } = programmable([{ status: 'sent' }])

    await Promise.all([sweepOnce(fake.db, send), sweepOnce(fake.db, send)])

    // The conditional write is the mutual exclusion; the loser never sends.
    expect(sent).toHaveLength(1)
    expect(claimRow(fake)?.status).toBe('sent')
    expect(claimRow(fake)?.attempts).toBe(1)
  })

  it('lets at most one of many concurrent sweeps send', async () => {
    const fake = createFakeD1()
    await seedDevice(fake.db)
    const { sent, send } = programmable([{ status: 'sent' }])

    await Promise.all(Array.from({ length: 6 }, () => sweepOnce(fake.db, send)))

    expect(sent).toHaveLength(1)
  })
})

/* ------------------------------------------------------------------ */
/* B. A delivered reminder is never repeated                           */
/* ------------------------------------------------------------------ */

describe('B. once accepted, never again', () => {
  it('does not send a second time when the minute is retried', async () => {
    const fake = createFakeD1()
    await seedDevice(fake.db)
    const { sent, send } = programmable([{ status: 'sent' }])

    await sweepOnce(fake.db, send)
    await sweepOnce(fake.db, send)
    await sweepOnce(fake.db, send)

    expect(sent).toHaveLength(1)
    expect(claimRow(fake)?.status).toBe('sent')
  })
})

/* ------------------------------------------------------------------ */
/* C. A refused reminder CAN be retried                                */
/* ------------------------------------------------------------------ */

describe('C. a service refusal is recoverable', () => {
  it('sends again on a later invocation of the SAME trigger minute', async () => {
    const fake = createFakeD1()
    await seedDevice(fake.db)
    // First the service is unavailable; then it recovers.
    const { sent, send } = programmable([
      { status: 'retryable', httpStatus: 503 },
      { status: 'sent' },
    ])

    const first = await sweepOnce(fake.db, send)
    expect(first.sent).toBe(0)
    expect(first.retryable).toBe(1)
    expect(claimRow(fake)?.status).toBe('retryable')

    // This is the behaviour the original INSERT OR IGNORE made impossible.
    const second = await sweepOnce(fake.db, send)
    expect(second.sent).toBe(1)
    expect(sent).toHaveLength(2)
    expect(claimRow(fake)?.status).toBe('sent')
    expect(claimRow(fake)?.attempts).toBe(2)
  })

  it('stops retrying once the attempt budget is spent', async () => {
    const fake = createFakeD1()
    await seedDevice(fake.db)
    const { sent, send } = programmable([{ status: 'retryable', httpStatus: 503 }])

    // Far more invocations than the budget allows.
    for (let i = 0; i < MAX_DELIVERY_ATTEMPTS + 4; i += 1) {
      await sweepOnce(fake.db, send)
    }

    // An exact-time reminder is worth a few attempts, not an unbounded stream.
    expect(sent).toHaveLength(MAX_DELIVERY_ATTEMPTS)
    expect(claimRow(fake)?.attempts).toBe(MAX_DELIVERY_ATTEMPTS)
  })

  it('does not resurrect a DIFFERENT minute that already succeeded', async () => {
    const fake = createFakeD1()
    await seedDevice(fake.db)
    const { sent, send } = programmable([{ status: 'sent' }])

    await sweepOnce(fake.db, send, GYM_MINUTE)
    // 21:30 is Shower + rest: a separate occurrence with its own claim.
    await sweepOnce(fake.db, send, Date.UTC(2026, 8, 14, 21, 30, 0))
    await sweepOnce(fake.db, send, GYM_MINUTE)

    expect(sent).toHaveLength(2)
  })
})

/* ------------------------------------------------------------------ */
/* D. An ambiguous outcome is never retried                            */
/* ------------------------------------------------------------------ */

describe('D. ambiguity never becomes a duplicate', () => {
  it('does not retry after a network failure that may have been delivered', async () => {
    const fake = createFakeD1()
    await seedDevice(fake.db)
    const { sent, send } = programmable([{ status: 'ambiguous' }, { status: 'sent' }])

    await sweepOnce(fake.db, send)
    expect(claimRow(fake)?.status).toBe('ambiguous')

    await sweepOnce(fake.db, send)
    await sweepOnce(fake.db, send)

    // The push may already have arrived. One missed reminder beats two.
    expect(sent).toHaveLength(1)
  })

  it('does not retry a permanent rejection either', async () => {
    const fake = createFakeD1()
    await seedDevice(fake.db)
    const { sent, send } = programmable([{ status: 'rejected', httpStatus: 400 }])

    await sweepOnce(fake.db, send)
    await sweepOnce(fake.db, send)

    // Identical request, identical refusal: retrying is pure noise.
    expect(sent).toHaveLength(1)
    expect(claimRow(fake)?.status).toBe('rejected')
  })
})

/* ------------------------------------------------------------------ */
/* E. Retries are themselves mutually exclusive                        */
/* ------------------------------------------------------------------ */

describe('E. two retries cannot both claim', () => {
  it('lets only one of two concurrent retries send', async () => {
    const fake = createFakeD1()
    await seedDevice(fake.db)
    const first = programmable([{ status: 'retryable', httpStatus: 503 }])
    await sweepOnce(fake.db, first.send)
    expect(claimRow(fake)?.status).toBe('retryable')

    // Two invocations now race for the SAME reclaimable occurrence.
    const retry = programmable([{ status: 'sent' }])
    await Promise.all([sweepOnce(fake.db, retry.send), sweepOnce(fake.db, retry.send)])

    expect(retry.sent).toHaveLength(1)
    expect(claimRow(fake)?.attempts).toBe(2)
  })

  it('never lets a retry run while another attempt is in flight', async () => {
    const fake = createFakeD1()
    await seedDevice(fake.db)

    // A send that parks, so the first claim is still 'claimed' when the
    // second sweep arrives.
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const sent: string[] = []
    const slow = vi.fn(async (target: { endpoint: string }) => {
      sent.push(target.endpoint)
      await gate
      return { status: 'retryable', httpStatus: 503 } as PushOutcome
    })

    const inFlight = sweepOnce(fake.db, slow as never)
    await Promise.resolve()
    // While 'claimed', nothing else may take it.
    await sweepOnce(fake.db, slow as never)
    release()
    await inFlight

    expect(sent).toHaveLength(1)
  })
})

/* ------------------------------------------------------------------ */
/* F. Expiry still retires exactly one device                          */
/* ------------------------------------------------------------------ */

describe('F. a gone subscription', () => {
  it('retires only that device, and never retries it', async () => {
    const fake = createFakeD1()
    await seedDevice(fake.db, 'sub-gone', 'a'.repeat(64))
    await seedDevice(fake.db, 'sub-fine', 'b'.repeat(64))

    const sent: string[] = []
    const send = vi.fn(async (target: { endpoint: string }) => {
      sent.push(target.endpoint)
      return target.endpoint.includes('sub-gone')
        ? ({ status: 'expired', httpStatus: 410 } as PushOutcome)
        : ({ status: 'sent' } as PushOutcome)
    })

    const result = await sweepOnce(fake.db, send as never)

    expect(result.retired).toBe(1)
    expect(result.sent).toBe(1)
    // The healthy device is untouched.
    const remaining = [...fake.pushSubscriptions.values()].map((row) => row.id)
    expect(remaining).toEqual(['sub-fine'])
    // And the retired one is terminal, not reclaimable.
    expect(claimRow(fake, 'sub-gone')?.status).toBe('rejected')
  })

  it('treats 404 the same as 410', async () => {
    const fake = createFakeD1()
    await seedDevice(fake.db)
    const { send } = programmable([{ status: 'expired', httpStatus: 404 }])

    const result = await sweepOnce(fake.db, send)

    expect(result.retired).toBe(1)
    expect(fake.pushSubscriptions.size).toBe(0)
  })

  it('leaves other devices independently retryable', async () => {
    const fake = createFakeD1()
    await seedDevice(fake.db, 'sub-a', 'a'.repeat(64))
    await seedDevice(fake.db, 'sub-b', 'b'.repeat(64))

    const send = vi.fn(async (target: { endpoint: string }) =>
      target.endpoint.includes('sub-a')
        ? ({ status: 'retryable', httpStatus: 503 } as PushOutcome)
        : ({ status: 'sent' } as PushOutcome),
    )
    await sweepOnce(fake.db, send as never)

    // One refused, one delivered: each occurrence carries its own state.
    expect(claimRow(fake, 'sub-a')?.status).toBe('retryable')
    expect(claimRow(fake, 'sub-b')?.status).toBe('sent')
  })
})
