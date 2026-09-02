import { describe, expect, it } from 'vitest'

import type { Env } from '../auth/config'
import { createD1SessionStore } from '../auth/d1Stores'
import { createSession } from '../auth/session'
import { handleWorkoutRequest } from '../workouts/routes'
import { createFakeD1, type SeedProgramme } from './fakeD1'
import { startBody } from './programmeFixture'

/**
 * Round 22 — a started workout is frozen, and a programme edit cannot reach it.
 *
 * This is the round's most important promise and the one that is easiest to
 * break by accident: the whole point of moving the programme into account state
 * is that it changes what FUTURE Starts freeze, and nothing else. A rename, a
 * reorder, a new prescription or an archive must leave every workout already
 * begun exactly as it was performed.
 *
 * ANTI-VACUITY. Each case captures the stored rows BEFORE the edit and compares
 * the whole snapshot afterwards, field by field, rather than spot-checking one
 * value that might happen not to have moved.
 */

const ORIGIN = 'https://vshapev2.nkmwei.de'
const DATE = '2026-09-07'
const SUB = 'sub-1'

const BEFORE: SeedProgramme = {
  revision: 1,
  exercises: [
    { exerciseId: 'lat-pulldown', name: 'Lat Pulldown' },
    { exerciseId: 'face-pull', name: 'Face Pull' },
  ],
  sessions: {
    monday: [
      { exerciseId: 'lat-pulldown', setCount: 2, targetMin: 10, targetMax: 15, equipment: 'BAND 20kg' },
      { exerciseId: 'face-pull', setCount: 1, targetMin: 15, targetMax: 20 },
    ],
    tuesday: [{ exerciseId: 'lat-pulldown', setCount: 2, targetMin: 10, targetMax: 15 }],
    wednesday: [{ exerciseId: 'lat-pulldown', setCount: 2, targetMin: 10, targetMax: 15 }],
    thursday: [{ exerciseId: 'lat-pulldown', setCount: 2, targetMin: 10, targetMax: 15 }],
    friday: [{ exerciseId: 'lat-pulldown', setCount: 2, targetMin: 10, targetMax: 15 }],
  },
}

/** The same programme after a rename, a reorder and a new prescription. */
const AFTER: SeedProgramme = {
  revision: 2,
  exercises: [
    { exerciseId: 'lat-pulldown', name: 'Band Lat Pulldown' },
    { exerciseId: 'face-pull', name: 'Face Pull (rope)' },
  ],
  sessions: {
    ...BEFORE.sessions,
    monday: [
      // Reordered, renamed, re-prescribed and re-equipped.
      { exerciseId: 'face-pull', setCount: 4, targetMin: 5, targetMax: 8 },
      { exerciseId: 'lat-pulldown', setCount: 9, targetMin: 1, targetMax: 3, equipment: 'BAND 99kg' },
    ],
  },
}

function makeEnv(db: D1Database): Env {
  return { DB: db, ASSETS: {} as Fetcher, APP_ORIGIN: ORIGIN }
}

async function call(
  db: D1Database,
  path: string,
  options: { token: string; method?: string; body?: unknown },
) {
  const headers: Record<string, string> = {
    Cookie: `vshape_session=${options.token}`,
    Origin: ORIGIN,
  }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await handleWorkoutRequest(
    new Request(`${ORIGIN}/api/workouts/${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
    makeEnv(db),
  )
  if (!response) throw new Error('handler did not claim the request')
  return { response, body: (await response.json()) as Record<string, unknown> }
}

async function seeded() {
  const fake = createFakeD1()
  fake.seedProgramme(SUB, BEFORE)
  const { token } = await createSession(createD1SessionStore(fake.db), {
    googleSub: SUB,
    email: 'a@example.com',
    trusted: true,
  })
  return { fake, token }
}

/** Every stored fact about the workout, as a comparable snapshot. */
function snapshot(fake: ReturnType<typeof createFakeD1>) {
  return {
    occurrences: [...fake.occurrences.values()].map((row) => ({ ...row })),
    sets: [...fake.workoutSets.values()]
      .map((row) => ({ ...row }))
      .sort((a, b) => a.exercise_order - b.exercise_order || a.set_index - b.set_index),
  }
}

/* ------------------------------------------------------------------ */
/* O. Start, then edit the programme                                   */
/* ------------------------------------------------------------------ */

describe('O. a scheduled workout, then a programme edit', () => {
  it('leaves the stored occurrence and every set factually unchanged', async () => {
    const { fake, token } = await seeded()

    const started = await call(fake.db, `${DATE}/monday/start`, {
      token,
      method: 'POST',
      body: startBody(BEFORE.revision),
    })
    expect(started.response.status).toBe(201)

    const before = snapshot(fake)
    expect(before.sets).toHaveLength(3)
    expect(before.sets[0].exercise_name_snapshot).toBe('Lat Pulldown')
    expect(before.sets[0].prescription_snapshot).toBe('2 × 10–15')

    // The programme moves on: rename, reorder, new prescription, new equipment.
    fake.seedProgramme(SUB, AFTER)

    const after = snapshot(fake)
    expect(after).toEqual(before)

    // And the API read agrees — no "helpful" current-name substitution.
    const read = await call(fake.db, `${DATE}/monday`, { token })
    const sets = read.body.sets as { exerciseName: string; prescription: string }[]
    expect(sets[0].exerciseName).toBe('Lat Pulldown')
    expect(sets[0].prescription).toBe('2 × 10–15')
    expect(sets.some((set) => set.exerciseName === 'Band Lat Pulldown')).toBe(false)
    expect((read.body.occurrence as { focus: string }).focus).toBe(
      'Back Width + Biceps',
    )
  })

  it('freezes the ORDER the programme had at Start, not the one it has now', async () => {
    const { fake, token } = await seeded()
    await call(fake.db, `${DATE}/monday/start`, {
      token,
      method: 'POST',
      body: startBody(BEFORE.revision),
    })

    fake.seedProgramme(SUB, AFTER)

    const read = await call(fake.db, `${DATE}/monday`, { token })
    const sets = read.body.sets as { exerciseId: string; exerciseOrder: number }[]
    // Lat Pulldown was first at Start; it is second in the programme now.
    expect(sets.filter((s) => s.exerciseOrder === 0)[0].exerciseId).toBe('lat-pulldown')
    expect(sets.filter((s) => s.exerciseOrder === 1)[0].exerciseId).toBe('face-pull')
  })

  it('survives an ARCHIVE of an exercise the workout already contains', async () => {
    const { fake, token } = await seeded()
    await call(fake.db, `${DATE}/monday/start`, {
      token,
      method: 'POST',
      body: startBody(BEFORE.revision),
    })
    const before = snapshot(fake)

    fake.seedProgramme(SUB, {
      revision: 3,
      exercises: [
        { exerciseId: 'lat-pulldown', name: 'Lat Pulldown', archived: true },
        { exerciseId: 'face-pull', name: 'Face Pull' },
      ],
      sessions: {
        ...BEFORE.sessions,
        monday: [{ exerciseId: 'face-pull', setCount: 1, targetMin: 15, targetMax: 20 }],
      },
    })

    expect(snapshot(fake)).toEqual(before)
    const read = await call(fake.db, `${DATE}/monday`, { token })
    const sets = read.body.sets as { exerciseName: string }[]
    expect(sets.some((set) => set.exerciseName === 'Lat Pulldown')).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/* N. A current Start freezes the CURRENT programme                    */
/* ------------------------------------------------------------------ */

describe('N. a Start on the current revision freezes exactly that programme', () => {
  it('takes the id, name, order, prescription and equipment from the programme', async () => {
    const { fake, token } = await seeded()
    fake.seedProgramme(SUB, AFTER)

    await call(fake.db, `${DATE}/monday/start`, {
      token,
      method: 'POST',
      body: startBody(AFTER.revision),
    })

    const sets = snapshot(fake).sets
    // Face Pull is first in AFTER, with 4 sets; Lat Pulldown second with 9.
    expect(sets.filter((s) => s.exercise_order === 0)).toHaveLength(4)
    expect(sets[0].exercise_id_snapshot).toBe('face-pull')
    expect(sets[0].exercise_name_snapshot).toBe('Face Pull (rope)')
    expect(sets[0].prescription_snapshot).toBe('4 × 5–8')

    const lat = sets.filter((s) => s.exercise_order === 1)
    expect(lat).toHaveLength(9)
    expect(lat[0].exercise_name_snapshot).toBe('Band Lat Pulldown')
    expect(lat[0].prescription_snapshot).toBe('9 × 1–3')
    expect(lat[0].equipment_snapshot).toBe('BAND 99kg')
  })
})

/* ------------------------------------------------------------------ */
/* P. An Extra on a stale revision                                     */
/* ------------------------------------------------------------------ */

describe('P/Q. an Extra and the programme revision', () => {
  it('refuses a stale Extra Start, creating nothing', async () => {
    const { fake, token } = await seeded()
    fake.seedProgramme(SUB, AFTER)

    const { response, body } = await call(fake.db, `${DATE}/extra/start`, {
      token,
      method: 'POST',
      body: startBody(BEFORE.revision, 'monday'),
    })

    expect(response.status).toBe(409)
    expect(body.error).toBe('programme_conflict')
    expect(fake.occurrences.size).toBe(0)
    expect(fake.workoutSets.size).toBe(0)
  })

  it('freezes the current source template, and a later edit does not reach it', async () => {
    const { fake, token } = await seeded()

    const started = await call(fake.db, `${DATE}/extra/start`, {
      token,
      method: 'POST',
      body: startBody(BEFORE.revision, 'monday'),
    })
    expect(started.response.status).toBe(201)
    const before = snapshot(fake)

    fake.seedProgramme(SUB, AFTER)
    expect(snapshot(fake)).toEqual(before)

    const read = await call(fake.db, `${DATE}/extra`, { token })
    const occurrence = read.body.occurrence as { kind: string; sourceSessionId: string }
    expect(occurrence.kind).toBe('extra')
    expect(occurrence.sourceSessionId).toBe('monday')
    const sets = read.body.sets as { exerciseName: string; prescription: string }[]
    expect(sets[0].exerciseName).toBe('Lat Pulldown')
    expect(sets[0].prescription).toBe('2 × 10–15')
  })
})

/* ------------------------------------------------------------------ */
/* S. History keeps the name it was performed under                    */
/* ------------------------------------------------------------------ */

describe('S. recorded history is not relabelled by a rename', () => {
  it('reports the old name in history after the exercise is renamed', async () => {
    const { fake, token } = await seeded()
    await call(fake.db, `${DATE}/monday/start`, {
      token,
      method: 'POST',
      body: startBody(BEFORE.revision),
    })
    await call(fake.db, `${DATE}/monday/sets/0/0`, {
      token,
      method: 'PUT',
      body: { action: 'complete', result: 12, load: { value: 20, unit: 'kg' } },
    })

    fake.seedProgramme(SUB, AFTER)

    const read = await call(fake.db, `${DATE}/monday`, { token })
    const sets = read.body.sets as { exerciseName: string; status: string }[]
    const completed = sets.find((set) => set.status === 'completed')
    expect(completed?.exerciseName).toBe('Lat Pulldown')

    // The stored row itself, not just the read model.
    const stored = [...fake.workoutSets.values()].find(
      (row) => row.status === 'completed',
    )
    expect(stored?.exercise_name_snapshot).toBe('Lat Pulldown')
    expect(stored?.prescription_snapshot).toBe('2 × 10–15')
  })
})

/* ------------------------------------------------------------------ */
/* L. Cross-account isolation, at the route                            */
/* ------------------------------------------------------------------ */

describe('L. one account cannot see or use another account’s programme', () => {
  it('builds each account’s Start from its OWN programme', async () => {
    const fake = createFakeD1()
    fake.seedProgramme('sub-a', BEFORE)
    fake.seedProgramme('sub-b', {
      revision: 1,
      exercises: [{ exerciseId: 'plank', name: 'Plank' }],
      sessions: {
        monday: [
          { exerciseId: 'plank', setCount: 1, targetMin: 30, targetMax: 60, resultKind: 'seconds' },
        ],
        tuesday: [{ exerciseId: 'plank', setCount: 1, targetMin: 30, targetMax: 60 }],
        wednesday: [{ exerciseId: 'plank', setCount: 1, targetMin: 30, targetMax: 60 }],
        thursday: [{ exerciseId: 'plank', setCount: 1, targetMin: 30, targetMax: 60 }],
        friday: [{ exerciseId: 'plank', setCount: 1, targetMin: 30, targetMax: 60 }],
      },
    })
    const store = createD1SessionStore(fake.db)
    const a = (
      await createSession(store, { googleSub: 'sub-a', email: 'a@example.com', trusted: true })
    ).token
    const b = (
      await createSession(store, { googleSub: 'sub-b', email: 'b@example.com', trusted: true })
    ).token

    await call(fake.db, `${DATE}/monday/start`, { token: a, method: 'POST', body: startBody(1) })
    await call(fake.db, `${DATE}/monday/start`, { token: b, method: 'POST', body: startBody(1) })

    const rows = [...fake.workoutSets.values()]
    const aIds = new Set(
      rows.filter((r) => r.google_sub === 'sub-a').map((r) => r.exercise_id_snapshot),
    )
    const bIds = new Set(
      rows.filter((r) => r.google_sub === 'sub-b').map((r) => r.exercise_id_snapshot),
    )
    expect(aIds).toEqual(new Set(['lat-pulldown', 'face-pull']))
    expect(bIds).toEqual(new Set(['plank']))
  })
})
