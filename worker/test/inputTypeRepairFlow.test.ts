import { describe, expect, it } from 'vitest'

import type { Env } from '../auth/config'
import { createD1SessionStore } from '../auth/d1Stores'
import { createSession } from '../auth/session'
import { handleExerciseInputTypeRequest } from '../exerciseInput/routes'
import { handleWorkoutRequest } from '../workouts/routes'
import { createFakeD1 } from './fakeD1'

/**
 * Round 20 Correction 2 — the whole repair, end to end, through the real APIs.
 *
 * The user's route out of a corrupt setting, with no UI in the way:
 *
 *   1. a stored setting exists that this build cannot read
 *   2. Start REFUSES, writing nothing
 *   3. the item read reports `unreadable` — a 200 with a known state, so the
 *      client can offer a replacement rather than a dead end
 *   4. the user picks the right type; the ordinary upsert replaces the row
 *   5. the item read is `readable` again
 *   6. the next Start SUCCEEDS and freezes what they chose
 *
 * Step 6 is the one that matters. A repair the app accepts but that leaves the
 * workout still refused would be a worse dead end than the first.
 */

const ORIGIN = 'https://vshapev2.nkmwei.de'
const DATE = '2026-09-01'
const SESSION = 'monday'
const EXERCISE = 'lat-pulldown'

const START_BODY = {
  day: 'Monday',
  focus: 'Back Width + Biceps',
  intensity: 'HARD',
  exercises: [
    {
      exerciseId: EXERCISE,
      name: 'Lat Pulldown',
      prescription: '4 × 10–15',
      equipment: 'BAND 20kg',
      resultKind: 'reps',
      // The client asks for kilograms, as its plan resolver always has. The
      // server is the authority on what actually gets frozen.
      loadMode: 'kg',
      perSide: false,
      setCount: 4,
    },
  ],
}

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

/** Read the stored setting through the real API. */
async function readSetting(db: D1Database, token: string) {
  const response = await handleExerciseInputTypeRequest(
    new Request(`${ORIGIN}/api/exercise-input-types/${EXERCISE}`, {
      headers: { Cookie: `vshape_session=${token}` },
    }),
    makeEnv(db),
  )
  if (!response) throw new Error('handler did not claim the request')
  return { response, body: (await response.json()) as Record<string, unknown> }
}

/** Replace the stored setting through the real API, as the card does. */
async function saveSetting(db: D1Database, token: string, inputType: string) {
  const response = await handleExerciseInputTypeRequest(
    new Request(`${ORIGIN}/api/exercise-input-types/${EXERCISE}`, {
      method: 'PUT',
      headers: {
        Cookie: `vshape_session=${token}`,
        Origin: ORIGIN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ inputType }),
    }),
    makeEnv(db),
  )
  if (!response) throw new Error('handler did not claim the request')
  return { response, body: (await response.json()) as Record<string, unknown> }
}

/** Start the workout through the real API. */
async function start(db: D1Database, token: string) {
  const response = await handleWorkoutRequest(
    new Request(`${ORIGIN}/api/workouts/${DATE}/${SESSION}/start`, {
      method: 'POST',
      headers: {
        Cookie: `vshape_session=${token}`,
        Origin: ORIGIN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(START_BODY),
    }),
    makeEnv(db),
  )
  if (!response) throw new Error('handler did not claim the request')
  return { response, body: (await response.json()) as Record<string, unknown> }
}

function corrupt(fake: ReturnType<typeof createFakeD1>, googleSub: string, value: string) {
  fake.inputTypes.set([googleSub, EXERCISE].join('\u0000'), {
    google_sub: googleSub,
    exercise_id: EXERCISE,
    input_type: value,
    created_at: 1,
    updated_at: 1,
  })
}

describe('repairing an unreadable setting, end to end', () => {
  it('walks the whole route from refused workout to frozen band snapshot', async () => {
    const fake = createFakeD1()
    const token = await seedToken(fake.db, 'sub-a', 'a@example.com')
    corrupt(fake, 'sub-a', 'elastic_vibes')

    // 2. The workout is refused, and nothing at all is written.
    const refused = await start(fake.db, token)
    expect(refused.response.status).toBe(500)
    expect(refused.body).toEqual({ error: 'input_type_unreadable' })
    expect(fake.occurrences.size).toBe(0)
    expect(fake.workoutSets.size).toBe(0)

    // 3. The item read reports a KNOWN state, not a failure. This is what lets
    //    the editor offer a replacement instead of disabling everything.
    const before = await readSetting(fake.db, token)
    expect(before.response.status).toBe(200)
    expect(before.body).toEqual({
      exerciseId: EXERCISE,
      state: 'unreadable',
      inputType: null,
    })

    // 4. The user chooses. The ordinary upsert replaces the corrupt row.
    const saved = await saveSetting(fake.db, token, 'resistance_band')
    expect(saved.response.status).toBe(200)
    expect(fake.inputTypes.size).toBe(1)

    // 5. It reads back as an ordinary readable setting.
    const after = await readSetting(fake.db, token)
    expect(after.response.status).toBe(200)
    expect(after.body.state).toBe('readable')
    expect((after.body.inputType as Record<string, unknown>).inputType).toBe('resistance_band')

    // 6. And the next Start SUCCEEDS, freezing what the user chose — with the
    //    load mode forced to agree, despite the request asking for kilograms.
    const started = await start(fake.db, token)
    expect(started.response.status).toBe(201)
    expect(fake.occurrences.size).toBe(1)

    const sets = [...fake.workoutSets.values()]
    expect(sets).toHaveLength(4)
    expect(sets.every((row) => row.input_type_snapshot === 'resistance_band')).toBe(true)
    expect(sets.every((row) => row.load_mode_snapshot === 'none')).toBe(true)
  })

  it('keeps the collection read honest at every step', async () => {
    const fake = createFakeD1()
    const token = await seedToken(fake.db, 'sub-a', 'a@example.com')
    corrupt(fake, 'sub-a', 'elastic_vibes')

    async function list() {
      const response = await handleExerciseInputTypeRequest(
        new Request(`${ORIGIN}/api/exercise-input-types`, {
          headers: { Cookie: `vshape_session=${token}` },
        }),
        makeEnv(fake.db),
      )
      return (await response!.json()) as Record<string, unknown>
    }

    // Named as unreadable, so the Library can say so.
    expect(await list()).toEqual({ inputTypes: [], unreadable: [EXERCISE] })

    await saveSetting(fake.db, token, 'bodyweight')

    // And no longer named, because it is no longer unreadable.
    const after = await list()
    expect(after.unreadable).toEqual([])
    expect(after.inputTypes).toHaveLength(1)
  })

  it('repairs to any of the three types, not only to bands', async () => {
    for (const chosen of ['weight_kg', 'resistance_band', 'bodyweight']) {
      const fake = createFakeD1()
      const token = await seedToken(fake.db, 'sub-a', 'a@example.com')
      corrupt(fake, 'sub-a', 'elastic_vibes')

      await saveSetting(fake.db, token, chosen)
      const started = await start(fake.db, token)

      expect(started.response.status, chosen).toBe(201)
      expect(
        [...fake.workoutSets.values()].every((row) => row.input_type_snapshot === chosen),
        chosen,
      ).toBe(true)
    }
  })

  it('does not repair the row merely by reading it', async () => {
    const fake = createFakeD1()
    const token = await seedToken(fake.db, 'sub-a', 'a@example.com')
    corrupt(fake, 'sub-a', 'elastic_vibes')

    await readSetting(fake.db, token)
    await start(fake.db, token)

    // Untouched. The app does not know what the user meant, and a silent
    // repair would replace their real answer with a guess.
    expect(fake.inputTypes.size).toBe(1)
    expect([...fake.inputTypes.values()][0].input_type).toBe('elastic_vibes')
  })

  it('does not touch another account’s workout or setting', async () => {
    const fake = createFakeD1()
    const alice = await seedToken(fake.db, 'sub-a', 'a@example.com')
    const bob = await seedToken(fake.db, 'sub-b', 'b@example.com')
    corrupt(fake, 'sub-a', 'elastic_vibes')
    corrupt(fake, 'sub-b', 'weight_kg')

    await saveSetting(fake.db, alice, 'resistance_band')

    // Bob's setting is his own, and Alice's repair did not reach it.
    const bobRead = await readSetting(fake.db, bob)
    expect(bobRead.body.state).toBe('readable')
    expect((bobRead.body.inputType as Record<string, unknown>).inputType).toBe('weight_kg')
    expect(fake.inputTypes.size).toBe(2)
  })
})
