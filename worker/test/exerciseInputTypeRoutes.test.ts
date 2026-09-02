import { describe, expect, it } from 'vitest'

import type { Env } from '../auth/config'
import { createD1SessionStore } from '../auth/d1Stores'
import { createSession } from '../auth/session'
import { handleExerciseInputTypeRequest } from '../exerciseInput/routes'
import { createFakeD1 } from './fakeD1'

/**
 * Round 20 — the exercise input type API.
 *
 * The real handler, the real D1 mapping layer and the real rules run together
 * against the in-memory D1 stand-in.
 *
 * This is the surface where the user tells the app what its own data means, so
 * the things that matter most are the refusals: an identity is never taken from
 * a request, an unknown modality is never coerced into a known one, and an
 * exercise nobody has answered for reads as UNANSWERED rather than as
 * kilograms.
 */

const ORIGIN = 'https://vshapev2.nkmwei.de'
const BASE = `${ORIGIN}/api/exercise-input-types`
const EXERCISE = 'triceps-pushdown'

function makeEnv(db: D1Database): Env {
  return { DB: db, ASSETS: {} as Fetcher, APP_ORIGIN: ORIGIN }
}

async function seedToken(db: D1Database, googleSub: string, email: string) {
  const session = await createSession(createD1SessionStore(db), {
    googleSub,
    email,
    trusted: true,
  })
  return session.token
}

type ReqOptions = {
  token?: string
  method?: string
  origin?: string
  /** Omit for the collection; pass a slug for an item. */
  id?: string
  body?: unknown
  rawBody?: string
}

function request({ token, method = 'GET', origin, id, body, rawBody }: ReqOptions): Request {
  const url = id === undefined ? BASE : `${BASE}/${id}`
  const headers: Record<string, string> = {}
  if (token) headers.Cookie = `vshape_session=${token}`
  if (origin) headers.Origin = origin
  const payload = rawBody ?? (body === undefined ? undefined : JSON.stringify(body))
  if (payload !== undefined) headers['Content-Type'] = 'application/json'
  return new Request(url, { method, headers, body: payload })
}

async function call(db: D1Database, options: ReqOptions) {
  const response = await handleExerciseInputTypeRequest(request(options), makeEnv(db))
  if (!response) throw new Error('handler did not claim the request')
  return { response, body: (await response.json()) as Record<string, unknown> }
}

/** Save one setting the ordinary way, so tests share the real write path. */
async function save(db: D1Database, token: string, id: string, inputType: unknown) {
  return call(db, { token, method: 'PUT', id, origin: ORIGIN, body: { inputType } })
}

/* ------------------------------------------------------------------ */
/* Authentication and identity                                         */
/* ------------------------------------------------------------------ */

describe('authentication and identity', () => {
  it('rejects an unauthenticated list', async () => {
    const { db } = createFakeD1()
    const { response, body } = await call(db, {})
    expect(response.status).toBe(401)
    expect(body.error).toBe('unauthenticated')
  })

  it('rejects an unauthenticated read and write', async () => {
    const { db } = createFakeD1()
    expect((await call(db, { id: EXERCISE })).response.status).toBe(401)
    expect(
      (await call(db, { id: EXERCISE, method: 'PUT', body: { inputType: 'weight_kg' } }))
        .response.status,
    ).toBe(401)
  })

  it('scopes every setting to the session’s account, never to a supplied one', async () => {
    const { db } = createFakeD1()
    const alice = await seedToken(db, 'sub-alice', 'alice@example.com')
    const bob = await seedToken(db, 'sub-bob', 'bob@example.com')

    await save(db, alice, EXERCISE, 'resistance_band')

    // Bob asks about the same exercise and gets his own answer: none.
    const bobRead = await call(db, { token: bob, id: EXERCISE })
    expect(bobRead.body.inputType).toBeNull()

    // And a body that tries to name an account changes nothing about whose
    // setting is written — the identity comes from the session cookie alone.
    await call(db, {
      token: bob,
      method: 'PUT',
      id: EXERCISE,
      origin: ORIGIN,
      body: { inputType: 'bodyweight', googleSub: 'sub-alice' },
    })

    const aliceRead = await call(db, { token: alice, id: EXERCISE })
    expect(aliceRead.body.state).toBe('readable')
    expect((aliceRead.body.inputType as Record<string, unknown>).inputType).toBe(
      'resistance_band',
    )
  })

  it('never echoes an account identifier back', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-alice', 'alice@example.com')
    const { body } = await save(db, token, EXERCISE, 'resistance_band')

    expect(JSON.stringify(body)).not.toContain('sub-alice')
    expect(JSON.stringify(body)).not.toContain('alice@example.com')
  })
})

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

describe('reading', () => {
  it('answers an unconfigured exercise with null, not a 404 and not a default', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-alice', 'alice@example.com')

    const { response, body } = await call(db, { token, id: EXERCISE })
    // The exercise exists; its modality has simply never been stated. Reading
    // this as "kilograms" is the assumption the whole round removes.
    expect(response.status).toBe(200)
    expect(body).toEqual({ exerciseId: EXERCISE, state: 'absent', inputType: null })
  })

  it('lists only what this account has configured', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-alice', 'alice@example.com')
    const other = await seedToken(db, 'sub-bob', 'bob@example.com')

    await save(db, token, EXERCISE, 'resistance_band')
    await save(db, other, 'lat-pulldown', 'weight_kg')

    const { body } = await call(db, { token })
    expect(body.inputTypes).toEqual([
      { exerciseId: EXERCISE, inputType: 'resistance_band', updatedAt: expect.any(Number) },
    ])
  })

  it('reports a stored value it cannot name, rather than hiding it or guessing', async () => {
    const fake = createFakeD1()
    const token = await seedToken(fake.db, 'sub-alice', 'alice@example.com')
    await save(fake.db, token, EXERCISE, 'resistance_band')

    // Corrupt the stored row, which the CHECK constraint would normally
    // prevent — the reader must not assume the shape of data it did not write.
    for (const row of fake.inputTypes.values()) row.input_type = 'elastic_vibes'

    // Not kilograms, and not silently gone either. The collection NAMES it, so
    // the Library can say the setting could not be read instead of showing it
    // as an exercise nobody has answered for.
    const list = await call(fake.db, { token })
    expect(list.body.inputTypes).toEqual([])
    expect(list.body.unreadable).toEqual([EXERCISE])

    // And the item read names the state rather than answering null — which
    // would mean "never answered", a different fact from "answered,
    // unreadably". Correction 2 made this a 200 with a known state instead of
    // a 500, because it is a REPAIRABLE state of persisted data and not a
    // failure of the request: answering 500 left the editor unable to offer
    // the replacement the Library had just told the user to make.
    const item = await call(fake.db, { token, id: EXERCISE })
    expect(item.response.status).toBe(200)
    expect(item.body).toEqual({ exerciseId: EXERCISE, state: 'unreadable', inputType: null })
  })

  it('reports nothing as unreadable when every stored row is fine', async () => {
    // NON-VACUITY for the report above.
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-alice', 'alice@example.com')
    await save(db, token, EXERCISE, 'resistance_band')

    const { body } = await call(db, { token })
    expect(body.unreadable).toEqual([])
    expect(body.inputTypes).toHaveLength(1)
  })
})

/* ------------------------------------------------------------------ */
/* Writing                                                             */
/* ------------------------------------------------------------------ */

describe('writing', () => {
  it('saves each of the three input types', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-alice', 'alice@example.com')

    for (const inputType of ['weight_kg', 'resistance_band', 'bodyweight']) {
      const { response, body } = await save(db, token, EXERCISE, inputType)
      expect(response.status).toBe(200)
      expect((body.inputType as Record<string, unknown>).inputType).toBe(inputType)
    }
  })

  it('replaces rather than accumulates: one current answer per exercise', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-alice', 'alice@example.com')

    await save(db, token, EXERCISE, 'weight_kg')
    await save(db, token, EXERCISE, 'resistance_band')

    const { body } = await call(db, { token })
    expect(body.inputTypes).toHaveLength(1)
    expect((body.inputTypes as Record<string, unknown>[])[0].inputType).toBe('resistance_band')
  })

  it('refuses an input type outside the vocabulary, never coercing it', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-alice', 'alice@example.com')

    for (const bad of ['elastic_vibes', 'KG', '', 42, null, ['weight_kg']]) {
      const { response, body } = await save(db, token, EXERCISE, bad)
      expect(response.status, String(bad)).toBe(400)
      expect(body).toEqual({ error: 'invalid_input_type', field: 'inputType' })
    }

    // Nothing was stored by any of them.
    expect((await call(db, { token })).body.inputTypes).toEqual([])
  })

  it('reports a malformed envelope as such, before it reports a missing field', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-alice', 'alice@example.com')

    const array = await call(db, {
      token, method: 'PUT', id: EXERCISE, origin: ORIGIN, body: ['weight_kg'],
    })
    expect(array.body).toEqual({ error: 'invalid_input_type', field: 'body' })

    const notJson = await call(db, {
      token, method: 'PUT', id: EXERCISE, origin: ORIGIN, rawBody: 'not json',
    })
    expect(notJson.response.status).toBe(400)
    expect(notJson.body.error).toBe('invalid_json')
  })

  it('accepts a well-formed write, so the refusals above are about the VALUE', async () => {
    // NON-VACUITY for the whole group.
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-alice', 'alice@example.com')

    const { response } = await save(db, token, EXERCISE, 'resistance_band')
    expect(response.status).toBe(200)
    expect((await call(db, { token })).body.inputTypes).toHaveLength(1)
  })
})

/* ------------------------------------------------------------------ */
/* Same-origin, methods and failures                                   */
/* ------------------------------------------------------------------ */

describe('the request envelope', () => {
  it('refuses a cross-origin write', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-alice', 'alice@example.com')

    const { response, body } = await call(db, {
      token,
      method: 'PUT',
      id: EXERCISE,
      origin: 'https://evil.example',
      body: { inputType: 'resistance_band' },
    })
    expect(response.status).toBe(403)
    expect(body.error).toBe('forbidden')
    // And it changed nothing.
    expect((await call(db, { token })).body.inputTypes).toEqual([])
  })

  it('allows a cross-origin READ, matching the rest of the app', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-alice', 'alice@example.com')

    const { response } = await call(db, {
      token, id: EXERCISE, origin: 'https://evil.example',
    })
    expect(response.status).toBe(200)
  })

  it('refuses the methods it does not implement', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-alice', 'alice@example.com')

    // There is deliberately no DELETE: "unset" is not a state the user can be
    // returned to halfway through a programme.
    for (const method of ['DELETE', 'POST', 'PATCH']) {
      const { response } = await call(db, { token, method, id: EXERCISE, origin: ORIGIN })
      expect(response.status, method).toBe(405)
    }
    for (const method of ['PUT', 'DELETE', 'POST']) {
      const { response } = await call(db, { token, method, origin: ORIGIN })
      expect(response.status, `collection ${method}`).toBe(405)
    }
  })

  it('refuses a malformed exercise identity', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-alice', 'alice@example.com')

    expect((await call(db, { token, id: '%E0%A4%A' })).response.status).toBe(400)
    expect((await call(db, { token, id: 'Not A Slug!' })).response.status).toBe(400)
    // Nothing is nested under an exercise, so a deeper path does not exist.
    expect((await call(db, { token, id: 'triceps-pushdown/sub' })).response.status).toBe(404)
  })

  it('reports a storage failure as a controlled error, leaking nothing', async () => {
    const fake = createFakeD1()
    const token = await seedToken(fake.db, 'sub-alice', 'alice@example.com')
    fake.breakInputTypes(new Error('D1 unavailable at 10.0.0.1'))

    const { response, body } = await call(fake.db, { token })
    expect(response.status).toBe(500)
    expect(body).toEqual({ error: 'server_error' })
    expect(JSON.stringify(body)).not.toContain('10.0.0.1')
  })
})
