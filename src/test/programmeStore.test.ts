import { beforeEach, describe, expect, it } from 'vitest'


import migration0001 from '../../migrations/0001_auth.sql?raw'
import migration0002 from '../../migrations/0002_today_completions.sql?raw'
import migration0003 from '../../migrations/0003_exercise_media.sql?raw'
import migration0004 from '../../migrations/0004_workout_logs.sql?raw'
import migration0005 from '../../migrations/0005_holiday_overrides.sql?raw'
import migration0006 from '../../migrations/0006_company_holidays.sql?raw'
import migration0007 from '../../migrations/0007_notification_push.sql?raw'
import migration0008 from '../../migrations/0008_progress_upgrade.sql?raw'
import migration0009 from '../../migrations/0009_training_progression.sql?raw'
import migration0010 from '../../migrations/0010_flexible_training.sql?raw'
import migration0011 from '../../migrations/0011_account_settings.sql?raw'
import migration0012 from '../../migrations/0012_training_flex.sql?raw'
import migration0013 from '../../migrations/0013_workout_input_types.sql?raw'
import migration0014 from '../../migrations/0014_workout_recovery_and_corrections.sql?raw'
import migration0015 from '../../migrations/0015_programme_builder.sql?raw'

import { createSqliteD1, type SqliteD1 } from './sqliteD1'
import { createD1ProgrammeStore, type ProgrammeD1 } from '../../worker/programme/d1Store'
import {
  createCustomExercise,
  resolveProgramme,
  saveProgramme,
  type ProgrammeStore,
} from '../../worker/programme/programme'
import { foundationProgramme } from '@shared/programme/foundation'
import {
  FALLBACK_REVISION,
  formatPrescription,
  isCustomExerciseId,
  type Programme,
} from '@shared/programme/programme'

/**
 * Round 22 Phase B — the programme store, against REAL SQLite.
 *
 * The accepted migration chain plus 0015 is executed, and the real store
 * statements run against it. That matters here more than anywhere else in the
 * round: the atomicity and concurrency guarantees are made IN SQL — a
 * compare-and-swap in the first statement of a batch and a write-token guard
 * on every statement after it — so a fake that pattern-matched those
 * statements would only be asserting that the fake understood them.
 *
 * ANTI-VACUITY. Several tests below deliberately drive the store through the
 * losing path and assert the database is untouched, rather than only asserting
 * the happy path returns the right object.
 */

/** The whole accepted migration chain, 0001 through 0015. */
const CHAIN = [
  migration0001, migration0002, migration0003, migration0004, migration0005,
  migration0006, migration0007, migration0008, migration0009, migration0010,
  migration0011, migration0012, migration0013, migration0014, migration0015,
]

const A = 'account-a'
const B = 'account-b'

let sqlite: SqliteD1
let store: ProgrammeStore

beforeEach(() => {
  sqlite = createSqliteD1(CHAIN)
  store = createD1ProgrammeStore(sqlite.db as unknown as ProgrammeD1)
})

function count(table: string, googleSub?: string): number {
  const sql = googleSub
    ? `SELECT COUNT(*) AS n FROM ${table} WHERE google_sub = ?`
    : `SELECT COUNT(*) AS n FROM ${table}`
  const row = googleSub
    ? (sqlite.raw.prepare(sql).get(googleSub) as { n: number })
    : (sqlite.raw.prepare(sql).get() as { n: number })
  return row.n
}

/** A whole-programme save built from the current resolved programme. */
async function edit(
  googleSub: string,
  expectedRevision: number,
  mutate: (p: Programme) => void,
  token = `tok-${Math.random()}`,
) {
  const current = await resolveProgramme(store, googleSub)
  mutate(current)
  return saveProgramme(
    store,
    googleSub,
    { exercises: current.exercises, sessions: current.sessions },
    expectedRevision,
    1000,
    token,
  )
}

/* ------------------------------------------------------------------ */
/* A. Fallback read                                                    */
/* ------------------------------------------------------------------ */

describe('A. an account with no programme rows resolves the Foundation seed', () => {
  it('resolves exactly the accepted Foundation programme', async () => {
    const resolved = await resolveProgramme(store, A)
    expect(resolved).toEqual(foundationProgramme())
  })

  it('reports the deterministic fallback revision', async () => {
    expect((await resolveProgramme(store, A)).revision).toBe(FALLBACK_REVISION)
    // Deterministic: reading again does not advance it.
    expect((await resolveProgramme(store, A)).revision).toBe(FALLBACK_REVISION)
  })

  it('WRITES NOTHING — no revision row, no exercises, no slots', async () => {
    await resolveProgramme(store, A)
    await resolveProgramme(store, A)
    await resolveProgramme(store, A)
    expect(count('programme_revisions')).toBe(0)
    expect(count('programme_exercises')).toBe(0)
    expect(count('programme_slots')).toBe(0)
  })
})

/* ------------------------------------------------------------------ */
/* B. First edit materialises                                          */
/* ------------------------------------------------------------------ */

describe('B. the first edit materialises the account programme', () => {
  it('writes the whole programme and applies the edit, at revision 1', async () => {
    const outcome = await edit(A, FALLBACK_REVISION, (p) => {
      p.exercises.find((e) => e.exerciseId === 'lat-pulldown')!.name = 'Band Lat Pulldown'
    })

    expect(outcome.ok).toBe(true)
    expect(outcome.ok && outcome.programme.revision).toBe(1)

    expect(count('programme_revisions', A)).toBe(1)
    // 15 canonical Foundation exercises, and every weekday slot.
    expect(count('programme_exercises', A)).toBe(foundationProgramme().exercises.length)
    const seededSlots = Object.values(foundationProgramme().sessions).reduce(
      (n, slots) => n + slots.length,
      0,
    )
    expect(count('programme_slots', A)).toBe(seededSlots)

    const reread = await resolveProgramme(store, A)
    expect(reread.revision).toBe(1)
    expect(reread.exercises.find((e) => e.exerciseId === 'lat-pulldown')?.name).toBe(
      'Band Lat Pulldown',
    )
  })

  it('leaves every other account on the fallback', async () => {
    await edit(A, FALLBACK_REVISION, (p) => {
      p.exercises[0].name = 'Renamed By A'
    })
    const b = await resolveProgramme(store, B)
    expect(b).toEqual(foundationProgramme())
    expect(count('programme_revisions', B)).toBe(0)
  })

  it('preserves the seeded prescriptions through a materialising round trip', async () => {
    await edit(A, FALLBACK_REVISION, (p) => {
      p.exercises[0].name = 'Renamed'
    })
    const reread = await resolveProgramme(store, A)
    const seed = foundationProgramme()
    for (const sessionId of ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as const) {
      expect(reread.sessions[sessionId].map(formatPrescription)).toEqual(
        seed.sessions[sessionId].map(formatPrescription),
      )
      expect(reread.sessions[sessionId].map((s) => s.exerciseId)).toEqual(
        seed.sessions[sessionId].map((s) => s.exerciseId),
      )
    }
  })
})

/* ------------------------------------------------------------------ */
/* C. First-edit concurrency                                           */
/* ------------------------------------------------------------------ */

describe('C. two writers from the fallback — exactly one may materialise', () => {
  it('one succeeds, one gets a controlled conflict, and no mixed programme exists', async () => {
    // Both authors read the same unpersisted programme at revision 0.
    const first = await resolveProgramme(store, A)
    const second = await resolveProgramme(store, A)
    expect(first.revision).toBe(FALLBACK_REVISION)
    expect(second.revision).toBe(FALLBACK_REVISION)

    first.exercises.find((e) => e.exerciseId === 'lat-pulldown')!.name = 'Writer One'
    second.exercises.find((e) => e.exerciseId === 'face-pull')!.name = 'Writer Two'

    const [a, b] = await Promise.all([
      saveProgramme(store, A, first, FALLBACK_REVISION, 1000, 'token-one'),
      saveProgramme(store, A, second, FALLBACK_REVISION, 1001, 'token-two'),
    ])

    const outcomes = [a, b]
    expect(outcomes.filter((o) => o.ok)).toHaveLength(1)
    expect(outcomes.filter((o) => !o.ok && o.reason === 'conflict')).toHaveLength(1)

    // Exactly one materialisation, at revision 1.
    expect(count('programme_revisions', A)).toBe(1)
    const stored = await resolveProgramme(store, A)
    expect(stored.revision).toBe(1)

    // And the stored programme is ONE of the two, never a blend of both.
    const lat = stored.exercises.find((e) => e.exerciseId === 'lat-pulldown')!.name
    const face = stored.exercises.find((e) => e.exerciseId === 'face-pull')!.name
    const winnerIsOne = lat === 'Writer One' && face === 'Face Pull'
    const winnerIsTwo = lat === 'Lat Pulldown' && face === 'Writer Two'
    expect(winnerIsOne || winnerIsTwo).toBe(true)

    // No duplicate materialisation: exactly one row per exercise.
    expect(count('programme_exercises', A)).toBe(foundationProgramme().exercises.length)
  })

  it('the loser wrote nothing at all — proved by row counts, not by its return value', async () => {
    await edit(A, FALLBACK_REVISION, (p) => {
      p.exercises[0].name = 'Established'
    })
    const exercisesAfterFirst = count('programme_exercises', A)
    const slotsAfterFirst = count('programme_slots', A)

    // A second writer still holding revision 0 — the classic stale first edit.
    const stale = await resolveProgramme(store, A)
    stale.exercises[0].name = 'Should Never Land'
    const outcome = await saveProgramme(store, A, stale, FALLBACK_REVISION, 2000, 'tok-stale')

    expect(outcome.ok).toBe(false)
    expect(!outcome.ok && outcome.reason).toBe('conflict')
    expect(count('programme_exercises', A)).toBe(exercisesAfterFirst)
    expect(count('programme_slots', A)).toBe(slotsAfterFirst)
    const stored = await resolveProgramme(store, A)
    expect(stored.revision).toBe(1)
    expect(stored.exercises.find((e) => e.exerciseId === 'lat-pulldown')?.name).toBe(
      'Established',
    )
  })
})

/* ------------------------------------------------------------------ */
/* K. Ordinary stale write                                             */
/* ------------------------------------------------------------------ */

describe('K. two tabs at the same persisted revision', () => {
  beforeEach(async () => {
    await edit(A, FALLBACK_REVISION, (p) => {
      p.exercises[0].name = 'Baseline'
    })
  })

  it('the second writer is refused and changes nothing', async () => {
    const tabOne = await resolveProgramme(store, A)
    const tabTwo = await resolveProgramme(store, A)
    expect(tabOne.revision).toBe(1)
    expect(tabTwo.revision).toBe(1)

    tabOne.exercises.find((e) => e.exerciseId === 'face-pull')!.name = 'Tab One Wins'
    const win = await saveProgramme(store, A, tabOne, 1, 3000, 'tok-1')
    expect(win.ok).toBe(true)

    tabTwo.exercises.find((e) => e.exerciseId === 'face-pull')!.name = 'Tab Two Loses'
    const lose = await saveProgramme(store, A, tabTwo, 1, 3001, 'tok-2')
    expect(lose.ok).toBe(false)
    expect(!lose.ok && lose.reason).toBe('conflict')

    const stored = await resolveProgramme(store, A)
    expect(stored.revision).toBe(2)
    expect(stored.exercises.find((e) => e.exerciseId === 'face-pull')?.name).toBe(
      'Tab One Wins',
    )
  })

  it('hands the loser the current truth so the editor can offer to reload it', async () => {
    const stale = await resolveProgramme(store, A)
    await edit(A, 1, (p) => {
      p.exercises.find((e) => e.exerciseId === 'plank')!.name = 'Moved On'
    })

    stale.exercises[0].name = 'Stale'
    const outcome = await saveProgramme(store, A, stale, 1, 4000, 'tok-stale')
    expect(outcome.ok).toBe(false)
    if (!outcome.ok && outcome.reason === 'conflict') {
      expect(outcome.programme.revision).toBe(2)
      expect(outcome.programme.exercises.find((e) => e.exerciseId === 'plank')?.name).toBe(
        'Moved On',
      )
    }
  })

  it('ANTI-VACUITY: the same save at the CURRENT revision does land', async () => {
    // The previous tests only prove a refusal. This proves the refusal was
    // caused by the revision and not by the payload being unwritable.
    const tab = await resolveProgramme(store, A)
    tab.exercises.find((e) => e.exerciseId === 'face-pull')!.name = 'Accepted'
    const outcome = await saveProgramme(store, A, tab, tab.revision, 5000, 'tok-fresh')
    expect(outcome.ok).toBe(true)
    expect(
      (await resolveProgramme(store, A)).exercises.find((e) => e.exerciseId === 'face-pull')
        ?.name,
    ).toBe('Accepted')
  })
})

/* ------------------------------------------------------------------ */
/* Atomic multi-part save                                              */
/* ------------------------------------------------------------------ */

describe('atomic multi-part save', () => {
  beforeEach(async () => {
    await edit(A, FALLBACK_REVISION, (p) => {
      p.exercises[0].name = 'Baseline'
    })
  })

  it('applies a rename, weekday changes, prescription edits and a reorder as one write', async () => {
    const outcome = await edit(A, 1, (p) => {
      p.exercises.find((e) => e.exerciseId === 'lat-pulldown')!.name = 'Band Lat Pulldown'
      // Monday prescription
      const monday = p.sessions.monday.find((s) => s.exerciseId === 'lat-pulldown')!
      monday.setCount = 3
      monday.targetMin = 8
      monday.targetMax = 12
      // Reorder Wednesday: put Face Pull first
      const wed = p.sessions.wednesday
      const face = wed.findIndex((s) => s.exerciseId === 'face-pull')
      const [moved] = wed.splice(face, 1)
      wed.unshift(moved)
      // Remove from Thursday, add to Friday
      p.sessions.thursday = p.sessions.thursday.filter((s) => s.exerciseId !== 'lat-pulldown')
      p.sessions.friday.push({
        exerciseId: 'lat-pulldown',
        position: 99,
        setCount: 2,
        resultKind: 'reps',
        targetMin: 12,
        targetMax: 15,
        perSide: false,
        equipment: null,
      })
    })
    expect(outcome.ok).toBe(true)

    const stored = await resolveProgramme(store, A)
    expect(stored.exercises.find((e) => e.exerciseId === 'lat-pulldown')?.name).toBe(
      'Band Lat Pulldown',
    )
    expect(
      formatPrescription(stored.sessions.monday.find((s) => s.exerciseId === 'lat-pulldown')!),
    ).toBe('3 × 8–12')
    expect(stored.sessions.wednesday.map((s) => s.exerciseId)[0]).toBe('face-pull')
    expect(stored.sessions.wednesday.map((s) => s.position)).toEqual([1, 2, 3, 4, 5])
    expect(stored.sessions.thursday.some((s) => s.exerciseId === 'lat-pulldown')).toBe(false)
    expect(stored.sessions.thursday.map((s) => s.position)).toEqual([1, 2, 3, 4])
    expect(stored.sessions.friday.some((s) => s.exerciseId === 'lat-pulldown')).toBe(true)
  })

  it('ROLLS BACK completely when one statement in the batch fails', async () => {
    const before = await resolveProgramme(store, A)
    const beforeExercises = count('programme_exercises', A)
    const beforeSlots = count('programme_slots', A)

    // A name long enough to violate the CHECK in migration 0015. Validation
    // would normally refuse this first, so the store is driven directly —
    // the point is to prove the DATABASE also refuses, and that a mid-batch
    // failure leaves nothing behind.
    await expect(
      store.write(A, {
        expectedRevision: 1,
        nextRevision: 2,
        writeToken: 'tok-bad',
        now: 6000,
        exercises: [
          ...before.exercises,
          { exerciseId: 'too-long', name: 'x'.repeat(200), archived: false, custom: false },
        ],
        sessions: before.sessions,
      }),
    ).rejects.toThrow()

    expect(count('programme_exercises', A)).toBe(beforeExercises)
    expect(count('programme_slots', A)).toBe(beforeSlots)
    const after = await resolveProgramme(store, A)
    expect(after.revision).toBe(1)
    expect(after.exercises.map((e) => e.name)).toEqual(before.exercises.map((e) => e.name))
  })
})

/* ------------------------------------------------------------------ */
/* L. Cross-account isolation                                          */
/* ------------------------------------------------------------------ */

describe('L. cross-account isolation', () => {
  it("account A's edits are invisible to account B", async () => {
    await edit(A, FALLBACK_REVISION, (p) => {
      p.exercises.find((e) => e.exerciseId === 'lat-pulldown')!.name = 'A Only'
      p.sessions.monday = p.sessions.monday.filter((s) => s.exerciseId !== 'hammer-curl')
    })

    const b = await resolveProgramme(store, B)
    expect(b).toEqual(foundationProgramme())
    expect(b.exercises.find((e) => e.exerciseId === 'lat-pulldown')?.name).toBe('Lat Pulldown')
    expect(b.sessions.monday.some((s) => s.exerciseId === 'hammer-curl')).toBe(true)
  })

  it('a write for B never disturbs A', async () => {
    await edit(A, FALLBACK_REVISION, (p) => {
      p.exercises[0].name = 'A Name'
    })
    await edit(B, FALLBACK_REVISION, (p) => {
      p.exercises[0].name = 'B Name'
    })

    const a = await resolveProgramme(store, A)
    const b = await resolveProgramme(store, B)
    expect(a.exercises[0].name).not.toBe(b.exercises[0].name)
    expect(count('programme_exercises', A)).toBe(count('programme_exercises', B))
    expect(a.revision).toBe(1)
    expect(b.revision).toBe(1)
  })
})

/* ------------------------------------------------------------------ */
/* H. Custom exercise                                                  */
/* ------------------------------------------------------------------ */

describe('H. custom exercise creation', () => {
  it('mints a server-side id and stores the required input type atomically', async () => {
    const outcome = await createCustomExercise(
      store,
      A,
      { name: 'Cable Crossover', inputType: 'resistance_band' },
      FALLBACK_REVISION,
      7000,
      'tok-custom',
    )

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    expect(isCustomExerciseId(outcome.exerciseId)).toBe(true)
    expect(outcome.exerciseId).toMatch(/^custom-[0-9a-f]{16}$/)

    const stored = await resolveProgramme(store, A)
    const created = stored.exercises.find((e) => e.exerciseId === outcome.exerciseId)
    expect(created?.name).toBe('Cable Crossover')
    expect(created?.custom).toBe(true)
    expect(created?.archived).toBe(false)

    // The input type landed in the SAME transaction, in its canonical table.
    const row = sqlite.raw
      .prepare('SELECT input_type FROM exercise_input_types WHERE google_sub = ? AND exercise_id = ?')
      .get(A, outcome.exerciseId) as { input_type: string } | undefined
    expect(row?.input_type).toBe('resistance_band')

    // Created with no weekday usage — a normal state, not a broken one.
    for (const slots of Object.values(stored.sessions)) {
      expect(slots.some((s) => s.exerciseId === outcome.exerciseId)).toBe(false)
    }
  })

  it('leaves NO orphan exercise when the write loses the compare-and-swap', async () => {
    await edit(A, FALLBACK_REVISION, (p) => {
      p.exercises[0].name = 'Established'
    })

    // Create against the now-stale fallback revision.
    const outcome = await createCustomExercise(
      store,
      A,
      { name: 'Never Lands', inputType: 'weight_kg' },
      FALLBACK_REVISION,
      8000,
      'tok-lost',
    )
    expect(outcome.ok).toBe(false)
    expect(!outcome.ok && outcome.reason).toBe('conflict')

    const stored = await resolveProgramme(store, A)
    expect(stored.exercises.some((e) => e.name === 'Never Lands')).toBe(false)
    // And no input-type row was left behind for an exercise that does not exist.
    const orphans = sqlite.raw
      .prepare(
        `SELECT COUNT(*) AS n FROM exercise_input_types
          WHERE google_sub = ?
            AND exercise_id NOT IN (SELECT exercise_id FROM programme_exercises WHERE google_sub = ?)`,
      )
      .get(A, A) as { n: number }
    expect(orphans.n).toBe(0)
  })

  it('never collides with a Foundation exercise id', async () => {
    const seedIds = new Set(foundationProgramme().exercises.map((e) => e.exerciseId))
    for (let i = 0; i < 25; i++) {
      const outcome = await createCustomExercise(
        store,
        `acct-${i}`,
        { name: `Custom ${i}`, inputType: 'bodyweight' },
        FALLBACK_REVISION,
        9000 + i,
        `tok-${i}`,
      )
      expect(outcome.ok).toBe(true)
      if (outcome.ok) expect(seedIds.has(outcome.exerciseId)).toBe(false)
    }
  })
})

/* ------------------------------------------------------------------ */
/* I / J. Archive and restore                                          */
/* ------------------------------------------------------------------ */

describe('I/J. archive and restore', () => {
  beforeEach(async () => {
    await edit(A, FALLBACK_REVISION, (p) => {
      p.exercises[0].name = 'Baseline'
    })
  })

  it('archiving removes the exercise from every future weekday, atomically', async () => {
    const outcome = await edit(A, 1, (p) => {
      p.exercises.find((e) => e.exerciseId === 'lat-pulldown')!.archived = true
      for (const sessionId of ['monday', 'wednesday', 'thursday'] as const) {
        p.sessions[sessionId] = p.sessions[sessionId].filter(
          (s) => s.exerciseId !== 'lat-pulldown',
        )
      }
    })
    expect(outcome.ok).toBe(true)

    const stored = await resolveProgramme(store, A)
    // Identity, name and library presence all survive.
    const archived = stored.exercises.find((e) => e.exerciseId === 'lat-pulldown')
    expect(archived).toBeDefined()
    expect(archived?.archived).toBe(true)
    // But no weekday holds it any more.
    for (const slots of Object.values(stored.sessions)) {
      expect(slots.some((s) => s.exerciseId === 'lat-pulldown')).toBe(false)
    }
    // And the weekdays it left are still contiguous and non-empty.
    for (const slots of Object.values(stored.sessions)) {
      expect(slots.length).toBeGreaterThan(0)
      expect(slots.map((s) => s.position)).toEqual(slots.map((_, i) => i + 1))
    }
  })

  it('REFUSES an archive that would leave a weekday empty', async () => {
    // Reduce Monday to a single exercise, then try to archive that one.
    await edit(A, 1, (p) => {
      p.sessions.monday = p.sessions.monday.filter((s) => s.exerciseId === 'lat-pulldown')
      for (const sessionId of ['wednesday', 'thursday'] as const) {
        p.sessions[sessionId] = p.sessions[sessionId].filter(
          (s) => s.exerciseId !== 'lat-pulldown',
        )
      }
    })

    const before = await resolveProgramme(store, A)
    expect(before.sessions.monday).toHaveLength(1)

    const outcome = await edit(A, before.revision, (p) => {
      p.exercises.find((e) => e.exerciseId === 'lat-pulldown')!.archived = true
      p.sessions.monday = []
    })

    expect(outcome.ok).toBe(false)
    expect(!outcome.ok && outcome.reason).toBe('invalid')
    if (!outcome.ok && outcome.reason === 'invalid') {
      expect(outcome.issues).toContainEqual({ code: 'session_empty', sessionId: 'monday' })
    }
    // Nothing moved.
    const after = await resolveProgramme(store, A)
    expect(after.revision).toBe(before.revision)
    expect(after.sessions.monday).toHaveLength(1)
    expect(after.exercises.find((e) => e.exerciseId === 'lat-pulldown')?.archived).toBe(false)
  })

  it('refuses an archived exercise left sitting in a weekday', async () => {
    const outcome = await edit(A, 1, (p) => {
      p.exercises.find((e) => e.exerciseId === 'lat-pulldown')!.archived = true
      // deliberately does NOT remove the slots
    })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok && outcome.reason === 'invalid') {
      expect(outcome.issues).toContainEqual({
        code: 'slot_exercise_archived',
        sessionId: 'monday',
        exerciseId: 'lat-pulldown',
      })
    }
  })

  it('restoring makes it available again without recreating its old placements', async () => {
    await edit(A, 1, (p) => {
      p.exercises.find((e) => e.exerciseId === 'lat-pulldown')!.archived = true
      for (const sessionId of ['monday', 'wednesday', 'thursday'] as const) {
        p.sessions[sessionId] = p.sessions[sessionId].filter(
          (s) => s.exerciseId !== 'lat-pulldown',
        )
      }
    })

    const archived = await resolveProgramme(store, A)
    const restore = await edit(A, archived.revision, (p) => {
      p.exercises.find((e) => e.exerciseId === 'lat-pulldown')!.archived = false
    })
    expect(restore.ok).toBe(true)

    const stored = await resolveProgramme(store, A)
    expect(stored.exercises.find((e) => e.exerciseId === 'lat-pulldown')?.archived).toBe(false)
    // Available, but placed nowhere: the user chooses the weekdays again.
    for (const slots of Object.values(stored.sessions)) {
      expect(slots.some((s) => s.exerciseId === 'lat-pulldown')).toBe(false)
    }
  })
})

/* ------------------------------------------------------------------ */
/* D / E / F / G. Editing semantics                                    */
/* ------------------------------------------------------------------ */

describe('D-G. editing semantics', () => {
  beforeEach(async () => {
    await edit(A, FALLBACK_REVISION, (p) => {
      p.exercises[0].name = 'Baseline'
    })
  })

  it('D. a rename changes the name and nothing else about identity', async () => {
    const before = await resolveProgramme(store, A)
    const beforeWeekdays = Object.fromEntries(
      Object.entries(before.sessions).map(([k, v]) => [k, v.map((s) => s.exerciseId)]),
    )

    await edit(A, before.revision, (p) => {
      p.exercises.find((e) => e.exerciseId === 'lat-pulldown')!.name = 'Band Lat Pulldown'
    })

    const after = await resolveProgramme(store, A)
    expect(after.exercises.find((e) => e.exerciseId === 'lat-pulldown')?.name).toBe(
      'Band Lat Pulldown',
    )
    // The id is untouched everywhere it appears.
    expect(
      Object.fromEntries(
        Object.entries(after.sessions).map(([k, v]) => [k, v.map((s) => s.exerciseId)]),
      ),
    ).toEqual(beforeWeekdays)
  })

  it('E. editing Monday leaves Wednesday alone', async () => {
    const before = await resolveProgramme(store, A)
    const wednesdayBefore = formatPrescription(
      before.sessions.wednesday.find((s) => s.exerciseId === 'lat-pulldown')!,
    )
    expect(wednesdayBefore).toBe('2 × 15–20')

    await edit(A, before.revision, (p) => {
      const monday = p.sessions.monday.find((s) => s.exerciseId === 'lat-pulldown')!
      monday.setCount = 5
      monday.targetMin = 6
      monday.targetMax = 8
    })

    const after = await resolveProgramme(store, A)
    expect(
      formatPrescription(after.sessions.monday.find((s) => s.exerciseId === 'lat-pulldown')!),
    ).toBe('5 × 6–8')
    expect(
      formatPrescription(after.sessions.wednesday.find((s) => s.exerciseId === 'lat-pulldown')!),
    ).toBe('2 × 15–20')
  })

  it('F. removing from Thursday and adding to Friday changes exactly that', async () => {
    const before = await resolveProgramme(store, A)
    await edit(A, before.revision, (p) => {
      p.sessions.thursday = p.sessions.thursday.filter(
        (s) => s.exerciseId !== 'seated-band-row',
      )
      p.sessions.friday.push({
        exerciseId: 'seated-band-row',
        position: 99,
        setCount: 3,
        resultKind: 'reps',
        targetMin: 12,
        targetMax: 15,
        perSide: false,
        equipment: null,
      })
    })

    const after = await resolveProgramme(store, A)
    expect(after.sessions.thursday.some((s) => s.exerciseId === 'seated-band-row')).toBe(false)
    expect(after.sessions.thursday.map((s) => s.position)).toEqual([1, 2, 3, 4])
    const friday = after.sessions.friday.find((s) => s.exerciseId === 'seated-band-row')
    expect(friday).toBeDefined()
    expect(formatPrescription(friday!)).toBe('3 × 12–15')
    expect(after.sessions.friday.map((s) => s.position)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('G. a reorder is persisted contiguously', async () => {
    const before = await resolveProgramme(store, A)
    await edit(A, before.revision, (p) => {
      const wed = p.sessions.wednesday
      const face = wed.findIndex((s) => s.exerciseId === 'face-pull')
      const [moved] = wed.splice(face, 1)
      wed.unshift(moved)
    })

    const after = await resolveProgramme(store, A)
    expect(after.sessions.wednesday.map((s) => s.exerciseId)).toEqual([
      'face-pull',
      'lat-pulldown',
      'rear-delt-fly',
      'dead-bug',
      'plank',
    ])
    expect(after.sessions.wednesday.map((s) => s.position)).toEqual([1, 2, 3, 4, 5])

    // The database's own UNIQUE (google_sub, session_id, position) agrees.
    const dupes = sqlite.raw
      .prepare(
        `SELECT COUNT(*) AS n FROM (
           SELECT session_id, position, COUNT(*) AS c FROM programme_slots
            WHERE google_sub = ? GROUP BY session_id, position HAVING c > 1)`,
      )
      .get(A) as { n: number }
    expect(dupes.n).toBe(0)
  })
})
