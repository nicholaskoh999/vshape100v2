import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Env } from '../auth/config'
import worker from '../index'
import { createD1PushStore } from '../notifications/d1Store'
import { MAX_DELIVERY_ATTEMPTS } from '../notifications/notifications'
import {
  RETRY_BACKOFF_MS,
  runScheduledDelivery,
  type ScheduleTruth,
} from '../notifications/scheduler'
import { createD1ScheduleTruth } from '../notifications/truth'
import { createFakeD1 } from './fakeD1'

/**
 * Round 14 correction 2, blocker 1 — the retry has to be DRIVEN by production.
 *
 * Correction 1 made a refused occurrence reclaimable. That was necessary and
 * not sufficient: reclaimable only matters if something actually claims it
 * again, and nothing did. The sweep ran once per cron minute, so a 503 at
 * 20:30 meant the 20:30 reminder was never delivered — the row was merely
 * eligible for a retry that would never come, because the next cron minute is
 * 20:31 and carries a different scheduledTime.
 *
 * So the driver is real, bounded, and lives INSIDE the same invocation. It
 * re-runs the sweep against the ORIGINAL scheduledTime, which is what keeps a
 * retry a retry of the 20:30 reminder rather than a fresh 20:31 one.
 *
 * Nothing here assumes Cloudflare replays a scheduled event. That is not
 * something the platform documents as a delivery guarantee, so it is not
 * something a reminder is allowed to depend on.
 *
 * These tests drive the ACTUAL exported `scheduled` handler and the actual
 * production driver. No test here plays the part of an external scheduler by
 * calling `runScheduledSweep` itself.
 */

/** Monday 2026-09-14, 20:30 UTC — the accepted gym slot. */
const GYM_MINUTE = Date.UTC(2026, 8, 14, 20, 30, 0)

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

/** Real key material, so the real encryption and signing paths actually run. */
async function realKeys() {
  const ecdh = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair
  const p256dh = base64url(
    new Uint8Array((await crypto.subtle.exportKey('raw', ecdh.publicKey)) as ArrayBuffer),
  )
  const auth = base64url(crypto.getRandomValues(new Uint8Array(16)))

  const ecdsa = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  const vapidPublic = base64url(
    new Uint8Array((await crypto.subtle.exportKey('raw', ecdsa.publicKey)) as ArrayBuffer),
  )
  const vapidPrivate = ((await crypto.subtle.exportKey('jwk', ecdsa.privateKey)) as JsonWebKey)
    .d as string

  return { p256dh, auth, vapidPublic, vapidPrivate }
}

let keys: Awaited<ReturnType<typeof realKeys>>

beforeEach(async () => {
  keys = await realKeys()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** A device subscribed in UTC, so the 20:30 slot really is 20:30 for it. */
async function seedDevice(db: D1Database, id: string) {
  await createD1PushStore(db).upsertByEndpoint({
    id,
    googleSub: 'google-' + id,
    endpoint: 'https://push.example/send/' + id,
    endpointHash: id.padEnd(64, '0'),
    p256dh: keys.p256dh,
    auth: keys.auth,
    timezone: 'UTC',
    createdAt: 1,
    updatedAt: 1,
  })
  return 'https://push.example/send/' + id
}

function vapid() {
  return {
    publicKey: keys.vapidPublic,
    privateKey: keys.vapidPrivate,
    subject: 'mailto:reminders@example.com',
  }
}

function env(db: D1Database): Env {
  return {
    DB: db,
    VAPID_PUBLIC_KEY: keys.vapidPublic,
    VAPID_PRIVATE_KEY: keys.vapidPrivate,
    VAPID_SUBJECT: 'mailto:reminders@example.com',
  } as unknown as Env
}

/**
 * A push service whose answer per endpoint can change between attempts.
 *
 * Stubbed at `fetch`, so everything above it — encryption, VAPID signing,
 * outcome classification, claiming, the driver — is the real code.
 */
function pushService(script: Record<string, number[]>) {
  const calls: string[] = []
  const seen: Record<string, number> = {}

  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input)
    calls.push(url)
    const statuses = script[url] ?? [201]
    const index = seen[url] ?? 0
    seen[url] = index + 1
    const status = statuses[Math.min(index, statuses.length - 1)]
    // 0 stands for "no answer at all": a network error, not a status.
    if (status === 0) throw new TypeError('network failure')
    return new Response(null, { status })
  })

  vi.stubGlobal('fetch', fetcher)
  return { calls, fetcher }
}

/** How many attempts were made against one device. */
const attemptsOn = (calls: string[], endpoint: string) =>
  calls.filter((url) => url === endpoint).length

/**
 * Run the REAL exported scheduled handler for the gym minute, letting its own
 * backoff waits elapse on a fake clock so the test does not sit through them.
 */
async function runRealHandler(db: D1Database) {
  // Only setTimeout is faked. The real event loop must keep turning, because
  // the encryption and signing under test are genuine crypto operations that
  // complete off the microtask queue.
  vi.useFakeTimers({ toFake: ['setTimeout'] })

  let finished = false
  const running = worker
    .scheduled(
      { scheduledTime: GYM_MINUTE, cron: '* * * * *', noRetry: () => {} } as ScheduledController,
      env(db),
    )
    .finally(() => {
      finished = true
    })

  // The backoff timer is not scheduled until the attempt before it has
  // finished, so the clock has to be pumped repeatedly rather than jumped
  // once: each turn lets real work land, then moves the fake clock past any
  // backoff that work has just scheduled. The bound is only a safety net —
  // a driver that never settles is a failure, not something to hang on.
  for (let pump = 0; pump < 2_000 && !finished; pump += 1) {
    await new Promise((resolve) => setImmediate(resolve))
    await vi.advanceTimersByTimeAsync(1_000)
  }

  await running
  vi.useRealTimers()
  expect(finished).toBe(true)
}

/** The production driver, with only its waiting replaced. */
async function runDriver(db: D1Database, truth?: ScheduleTruth) {
  return runScheduledDelivery({
    scheduledTime: GYM_MINUTE,
    store: createD1PushStore(db),
    truth: truth ?? createD1ScheduleTruth(db),
    vapid: vapid(),
    sleep: async () => {},
  })
}

/* ------------------------------------------------------------------ */
/* A. The headline case, through the real handler                      */
/* ------------------------------------------------------------------ */

describe('A. a refused reminder is retried inside the same invocation', () => {
  it('503 then success: the scheduled minute is delivered, not lost', async () => {
    const { db } = createFakeD1()
    const endpoint = await seedDevice(db, 'device-a')
    const service = pushService({ [endpoint]: [503, 201] })

    await runRealHandler(db)

    // Two attempts, both for THIS minute, and the second one landed.
    expect(attemptsOn(service.calls, endpoint)).toBe(2)
    expect(service.fetcher).toHaveBeenCalledTimes(2)
  })

  it('retries against the ORIGINAL scheduledTime, not a later minute', async () => {
    const { db, notificationDeliveries } = createFakeD1()
    const endpoint = await seedDevice(db, 'device-a')
    pushService({ [endpoint]: [503, 201] })

    await runRealHandler(db)

    const minutes = [...notificationDeliveries.values()].map((row) => row.trigger_minute)
    // One occurrence, one trigger minute: the retry is a retry of 20:30, not a
    // new 20:31 reminder wearing its clothes.
    expect(new Set(minutes).size).toBe(1)
    expect(minutes[0]).toBe(Math.floor(GYM_MINUTE / 60_000))
  })

  it('records the occurrence as sent once it finally lands', async () => {
    const { db, notificationDeliveries } = createFakeD1()
    const endpoint = await seedDevice(db, 'device-a')
    pushService({ [endpoint]: [503, 201] })

    await runRealHandler(db)

    const rows = [...notificationDeliveries.values()]
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('sent')
    expect(rows[0].attempts).toBe(2)
  })

  it('a later invocation does not send it again', async () => {
    const { db } = createFakeD1()
    const endpoint = await seedDevice(db, 'device-a')
    const service = pushService({ [endpoint]: [503, 201] })

    await runRealHandler(db)
    await runRealHandler(db)

    // 'sent' is terminal. A second invocation finds nothing left to claim.
    expect(attemptsOn(service.calls, endpoint)).toBe(2)
  })
})

/* ------------------------------------------------------------------ */
/* B. What must NOT be retried                                         */
/* ------------------------------------------------------------------ */

describe('B. only a proven refusal is retried', () => {
  it('a first-attempt success is sent exactly once', async () => {
    const { db } = createFakeD1()
    const endpoint = await seedDevice(db, 'device-a')
    const service = pushService({ [endpoint]: [201] })

    await runRealHandler(db)

    // The driver must not turn one delivered reminder into two buzzes.
    expect(attemptsOn(service.calls, endpoint)).toBe(1)
  })

  it('an ambiguous send is never retried', async () => {
    const { db, notificationDeliveries } = createFakeD1()
    const endpoint = await seedDevice(db, 'device-a')
    const service = pushService({ [endpoint]: [0] })

    await runRealHandler(db)

    // No answer came back, so it MAY have been delivered. Retrying could buzz
    // the same moment twice, and a duplicate is the worse failure here.
    expect(attemptsOn(service.calls, endpoint)).toBe(1)
    expect([...notificationDeliveries.values()][0].status).toBe('ambiguous')
  })

  it('a permanently rejected send is never retried', async () => {
    const { db, notificationDeliveries } = createFakeD1()
    const endpoint = await seedDevice(db, 'device-a')
    const service = pushService({ [endpoint]: [400] })

    await runRealHandler(db)

    // Repeating an identical request the service already refused cannot help.
    expect(attemptsOn(service.calls, endpoint)).toBe(1)
    expect([...notificationDeliveries.values()][0].status).toBe('rejected')
  })

  it('the attempt budget stops a service that keeps refusing', async () => {
    const { db, notificationDeliveries } = createFakeD1()
    const endpoint = await seedDevice(db, 'device-a')
    const service = pushService({ [endpoint]: [503] })

    await runRealHandler(db)

    // Bounded on purpose: an invocation must end, and a ten-minute push TTL
    // means a reminder chased far past its minute is stale anyway.
    expect(attemptsOn(service.calls, endpoint)).toBe(MAX_DELIVERY_ATTEMPTS)
    expect(service.calls).toHaveLength(MAX_DELIVERY_ATTEMPTS)
    expect([...notificationDeliveries.values()][0].attempts).toBe(MAX_DELIVERY_ATTEMPTS)
  }, 30_000)

  it('takes one backoff fewer than it makes attempts', () => {
    // There is no point waiting after the last attempt.
    expect(RETRY_BACKOFF_MS).toHaveLength(MAX_DELIVERY_ATTEMPTS - 1)
    // And the whole budget fits inside one cron minute.
    expect(RETRY_BACKOFF_MS.reduce((a, b) => a + b, 0)).toBeLessThan(60_000)
  })
})

/* ------------------------------------------------------------------ */
/* C. Several devices, one invocation                                  */
/* ------------------------------------------------------------------ */

describe('C. devices do not interfere with each other', () => {
  it('a device that succeeded stays deduped while another retries', async () => {
    const { db } = createFakeD1()
    const good = await seedDevice(db, 'device-a')
    const flaky = await seedDevice(db, 'device-b')
    const service = pushService({ [good]: [201], [flaky]: [503, 503, 201] })

    await runRealHandler(db)

    // The retry pass re-examines every subscription, but the delivered one is
    // claimed 'sent' and cannot be claimed again. Exactly one buzz.
    expect(attemptsOn(service.calls, good)).toBe(1)
    expect(attemptsOn(service.calls, flaky)).toBe(MAX_DELIVERY_ATTEMPTS)
  }, 30_000)

  it('a 410 retires only that device', async () => {
    const { db, pushSubscriptions } = createFakeD1()
    const gone = await seedDevice(db, 'device-a')
    const alive = await seedDevice(db, 'device-b')
    pushService({ [gone]: [410], [alive]: [201] })

    await runRealHandler(db)

    expect([...pushSubscriptions.values()].map((row) => row.endpoint)).toEqual([alive])
  })

  it('a 404 retires only that device', async () => {
    const { db, pushSubscriptions } = createFakeD1()
    const gone = await seedDevice(db, 'device-a')
    const alive = await seedDevice(db, 'device-b')
    pushService({ [gone]: [404], [alive]: [201] })

    await runRealHandler(db)

    expect([...pushSubscriptions.values()].map((row) => row.endpoint)).toEqual([alive])
  })

  it('one refusing device does not stop the others being delivered', async () => {
    const { db } = createFakeD1()
    const stuck = await seedDevice(db, 'device-a')
    const fine = await seedDevice(db, 'device-b')
    const service = pushService({ [stuck]: [503], [fine]: [201] })

    await runRealHandler(db)

    expect(attemptsOn(service.calls, fine)).toBe(1)
    expect(attemptsOn(service.calls, stuck)).toBe(MAX_DELIVERY_ATTEMPTS)
  }, 30_000)
})

/* ------------------------------------------------------------------ */
/* D. The driver itself                                                */
/* ------------------------------------------------------------------ */

describe('D. the production driver', () => {
  it('reports every attempt it made and what was left unresolved', async () => {
    const { db } = createFakeD1()
    const endpoint = await seedDevice(db, 'device-a')
    pushService({ [endpoint]: [503, 201] })

    const run = await runDriver(db)

    expect(run.attempts).toHaveLength(2)
    expect(run.sent).toBe(1)
    expect(run.unresolved).toBe(0)
  })

  it('stops as soon as nothing is left refused, without waiting again', async () => {
    const { db } = createFakeD1()
    const endpoint = await seedDevice(db, 'device-a')
    pushService({ [endpoint]: [201] })

    const sleep = vi.fn(async () => {})
    const run = await runScheduledDelivery({
      scheduledTime: GYM_MINUTE,
      store: createD1PushStore(db),
      truth: createD1ScheduleTruth(db),
      vapid: vapid(),
      sleep,
    })

    expect(run.attempts).toHaveLength(1)
    // No backoff is paid by a run that had nothing to retry.
    expect(sleep).not.toHaveBeenCalled()
  })

  it('backs off between attempts, in the published order', async () => {
    const { db } = createFakeD1()
    const endpoint = await seedDevice(db, 'device-a')
    pushService({ [endpoint]: [503] })

    const waits: number[] = []
    await runScheduledDelivery({
      scheduledTime: GYM_MINUTE,
      store: createD1PushStore(db),
      truth: createD1ScheduleTruth(db),
      vapid: vapid(),
      sleep: async (ms) => {
        waits.push(ms)
      },
    })

    expect(waits).toEqual([...RETRY_BACKOFF_MS])
  })

  it('reports what is still refused when the budget runs out', async () => {
    const { db } = createFakeD1()
    const endpoint = await seedDevice(db, 'device-a')
    pushService({ [endpoint]: [503] })

    const run = await runDriver(db)

    expect(run.attempts).toHaveLength(MAX_DELIVERY_ATTEMPTS)
    expect(run.sent).toBe(0)
    // Honest about the miss rather than reporting a success it did not have.
    expect(run.unresolved).toBe(1)
  })

  it('sends nothing, and retries nothing, when the truth cannot be read', async () => {
    const { db } = createFakeD1()
    const endpoint = await seedDevice(db, 'device-a')
    const service = pushService({ [endpoint]: [201] })

    // Fail-closed: an unreadable holiday record must not become "no holiday".
    const blind: ScheduleTruth = {
      async holidaysFor() {
        return null
      },
      async completionsFor() {
        return null
      },
      async workoutFinished() {
        return null
      },
      // Round 19.2: no day was flexed, so nothing is suppressed here.
      async flexResolved() {
        return false
      },
    }

    const run = await runDriver(db, blind)

    expect(service.calls).toHaveLength(0)
    expect(run.sent).toBe(0)
    expect(run.unresolved).toBe(0)
  })
})
