import { describe, expect, it } from 'vitest'

import { foundationProgramme } from '@shared/programme/foundation'
import {
  FALLBACK_REVISION,
  FOUNDATION_SESSION_META,
  PROGRAMME_SESSION_IDS,
  compactPositions,
  formatPrescription,
  orderedSlots,
  validateProgramme,
  type ProgrammeSessionId,
} from '@shared/programme/programme'
import { parsePrescriptionShape, parsePrescriptionTarget } from '@shared/progression/prescription'
import { trainingSessions } from '@/features/training/sessions'

/**
 * Round 22 Phase A — the shared Foundation seed IS the accepted programme.
 *
 * Round 22 moves the programme from a hardcoded React array into structured
 * shared data the Worker can also read. That move is only safe if it changes
 * nothing about what the programme SAYS, so this suite pins the seed against
 * the accepted array character for character, and against the accepted
 * prescription parser semantically.
 *
 * The static array is still present at this point in the round; it is compared
 * against here precisely so its removal later cannot quietly change content.
 */

describe('1. the seed reproduces the accepted Foundation programme exactly', () => {
  it('has the same five sessions, with the same day, focus and intensity', () => {
    expect(PROGRAMME_SESSION_IDS).toEqual([
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
    ])

    for (const sessionId of PROGRAMME_SESSION_IDS) {
      const accepted = trainingSessions.find((s) => s.id === sessionId)
      expect(accepted, `accepted session ${sessionId}`).toBeDefined()
      const meta = FOUNDATION_SESSION_META[sessionId]
      expect(meta.day).toBe(accepted?.day)
      expect(meta.focus).toBe(accepted?.focus)
      expect(meta.intensity).toBe(accepted?.intensity)
    }
  })

  it('renders every slot to the exact prescription string the accepted array carried', () => {
    const programme = foundationProgramme()

    for (const sessionId of PROGRAMME_SESSION_IDS) {
      const accepted = trainingSessions.find((s) => s.id === sessionId)
      const slots = orderedSlots(programme.sessions[sessionId])

      expect(slots.length, `${sessionId} exercise count`).toBe(
        accepted?.exercises.length,
      )

      slots.forEach((slot, index) => {
        const expected = accepted?.exercises[index]
        expect(slot.exerciseId, `${sessionId}[${index}] id`).toBe(expected?.id)
        // The whole point: structured data renders back to the accepted text.
        expect(formatPrescription(slot), `${sessionId}[${index}] prescription`).toBe(
          expected?.sets,
        )
        expect(slot.equipment, `${sessionId}[${index}] equipment`).toBe(
          expected?.equipment ?? null,
        )
      })
    }
  })

  it('names every exercise the way the accepted array named it', () => {
    const programme = foundationProgramme()
    const byId = new Map(programme.exercises.map((e) => [e.exerciseId, e]))

    for (const session of trainingSessions) {
      for (const exercise of session.exercises) {
        expect(byId.get(exercise.id)?.name, exercise.id).toBe(exercise.name)
      }
    }
    // Every canonical exercise in the library is used by at least one weekday,
    // and every used exercise is in the library.
    const used = new Set(
      trainingSessions.flatMap((s) => s.exercises.map((e) => e.id)),
    )
    expect([...byId.keys()].sort()).toEqual([...used].sort())
  })

  it('marks every Foundation exercise as active and not custom', () => {
    for (const exercise of foundationProgramme().exercises) {
      expect(exercise.archived).toBe(false)
      expect(exercise.custom).toBe(false)
    }
  })

  it('reports the fallback revision', () => {
    expect(foundationProgramme().revision).toBe(FALLBACK_REVISION)
  })

  it('returns a fresh object each call, so a caller cannot poison the seed', () => {
    const a = foundationProgramme()
    a.sessions.monday[0].setCount = 99
    a.exercises[0].name = 'Mutated'
    const b = foundationProgramme()
    expect(b.sessions.monday[0].setCount).toBe(4)
    expect(b.exercises[0].name).toBe('Lat Pulldown')
  })
})

/* ------------------------------------------------------------------ */

describe('2. structured -> prescription -> accepted parser round trip', () => {
  it('every seeded slot parses back to the shape it was built from', () => {
    const programme = foundationProgramme()

    for (const sessionId of PROGRAMME_SESSION_IDS) {
      for (const slot of programme.sessions[sessionId]) {
        const text = formatPrescription(slot)
        const shape = parsePrescriptionShape(text)
        expect(shape, `${sessionId}/${slot.exerciseId} -> "${text}"`).not.toBeNull()
        expect(shape?.setCount).toBe(slot.setCount)
        expect(shape?.resultKind).toBe(slot.resultKind)
        expect(shape?.perSide).toBe(slot.perSide)

        // And the progression reading agrees about the authored bounds, so a
        // programme-authored prescription can drive a Round 16 lane.
        const target = parsePrescriptionTarget(text)
        expect(target, `${sessionId}/${slot.exerciseId} target`).not.toBeNull()
        expect(target?.lower).toBe(slot.targetMin)
        expect(target?.upper).toBe(slot.targetMax)
      }
    }
  })

  it.each([
    [{ setCount: 4, resultKind: 'reps', targetMin: 10, targetMax: 15, perSide: false }, '4 × 10–15'],
    [{ setCount: 3, resultKind: 'reps', targetMin: 12, targetMax: 12, perSide: false }, '3 × 12'],
    [{ setCount: 3, resultKind: 'reps', targetMin: 10, targetMax: 10, perSide: true }, '3 × 10 / side'],
    [{ setCount: 3, resultKind: 'seconds', targetMin: 30, targetMax: 60, perSide: false }, '3 × 30–60s'],
    [{ setCount: 3, resultKind: 'seconds', targetMin: 45, targetMax: 45, perSide: false }, '3 × 45s'],
  ] as const)('formats %j as %s', (slot, expected) => {
    expect(formatPrescription(slot)).toBe(expected)
    expect(parsePrescriptionShape(expected)).not.toBeNull()
  })

  it('round-trips across the whole validated space, not just the seed', () => {
    // Exhaustive over the interesting axes rather than a handful of fixtures:
    // if any combination the validator accepts formats into something the
    // accepted parser refuses, the two grammars have diverged.
    for (const setCount of [1, 2, 7, 20]) {
      for (const resultKind of ['reps', 'seconds'] as const) {
        for (const perSide of [false, true]) {
          for (const [targetMin, targetMax] of [
            [1, 1],
            [8, 12],
            [30, 60],
            [999, 1000],
          ]) {
            const slot = { setCount, resultKind, perSide, targetMin, targetMax }
            const text = formatPrescription(slot)
            const shape = parsePrescriptionShape(text)
            expect(shape, `"${text}"`).not.toBeNull()
            expect(shape?.setCount).toBe(setCount)
            expect(shape?.resultKind).toBe(resultKind)
            expect(shape?.perSide).toBe(perSide)
            const target = parsePrescriptionTarget(text)
            expect(target?.lower, `"${text}" lower`).toBe(targetMin)
            expect(target?.upper, `"${text}" upper`).toBe(targetMax)
          }
        }
      }
    }
  })

  it('uses the authored punctuation, not lookalike characters', () => {
    const text = formatPrescription({
      setCount: 4,
      resultKind: 'reps',
      targetMin: 10,
      targetMax: 15,
      perSide: false,
    })
    // U+00D7 multiplication sign and U+2013 en dash, as the grammar authored
    // them. An ASCII 'x' or '-' would render almost identically and refuse.
    expect(text).toContain('×')
    expect(text).toContain('–')
    expect(text).not.toContain('x')
  })
})

/* ------------------------------------------------------------------ */

describe('3. the seed satisfies every stored-programme rule', () => {
  it('validates clean', () => {
    expect(validateProgramme(foundationProgramme())).toEqual([])
  })

  it('gives every weekday contiguous 1..n positions', () => {
    const programme = foundationProgramme()
    for (const sessionId of PROGRAMME_SESSION_IDS) {
      const positions = programme.sessions[sessionId].map((s) => s.position)
      expect(positions).toEqual(positions.map((_, i) => i + 1))
    }
  })

  it('never repeats one exercise inside a single weekday', () => {
    const programme = foundationProgramme()
    for (const sessionId of PROGRAMME_SESSION_IDS) {
      const ids = programme.sessions[sessionId].map((s) => s.exerciseId)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('does reuse one exercise across weekdays — the case Round 22 exists for', () => {
    const programme = foundationProgramme()
    const weekdaysFor = (id: string) =>
      PROGRAMME_SESSION_IDS.filter((s) =>
        programme.sessions[s].some((slot) => slot.exerciseId === id),
      )

    expect(weekdaysFor('lat-pulldown')).toEqual(['monday', 'wednesday', 'thursday'])

    // And those appearances are prescribed differently, under one identity.
    const monday = programme.sessions.monday.find((s) => s.exerciseId === 'lat-pulldown')
    const wednesday = programme.sessions.wednesday.find(
      (s) => s.exerciseId === 'lat-pulldown',
    )
    expect(formatPrescription(monday!)).toBe('4 × 10–15')
    expect(formatPrescription(wednesday!)).toBe('2 × 15–20')
  })
})

/* ------------------------------------------------------------------ */

describe('4. validation refuses what must never be stored', () => {
  function withSession(_sessionId: ProgrammeSessionId, mutate: (p: ReturnType<typeof foundationProgramme>) => void) {
    const programme = foundationProgramme()
    mutate(programme)
    return validateProgramme(programme)
  }

  it('refuses an empty weekday', () => {
    const issues = withSession('monday', (p) => {
      p.sessions.monday = []
    })
    expect(issues).toContainEqual({ code: 'session_empty', sessionId: 'monday' })
  })

  it('refuses the same exercise twice in one weekday', () => {
    const issues = withSession('monday', (p) => {
      p.sessions.monday = compactPositions([
        ...p.sessions.monday,
        { ...p.sessions.monday[0], position: 99 },
      ])
    })
    expect(issues).toContainEqual({
      code: 'slot_duplicate',
      sessionId: 'monday',
      exerciseId: 'lat-pulldown',
    })
  })

  it('refuses gapped or duplicated positions', () => {
    const issues = withSession('monday', (p) => {
      p.sessions.monday[1] = { ...p.sessions.monday[1], position: 9 }
    })
    expect(issues).toContainEqual({ code: 'slot_position_invalid', sessionId: 'monday' })
  })

  it('refuses a slot pointing at an exercise the library does not have', () => {
    const issues = withSession('monday', (p) => {
      p.sessions.monday[0] = { ...p.sessions.monday[0], exerciseId: 'ghost-exercise' }
    })
    expect(issues).toContainEqual({
      code: 'slot_exercise_unknown',
      sessionId: 'monday',
      exerciseId: 'ghost-exercise',
    })
  })

  it('refuses a slot holding an ARCHIVED exercise', () => {
    const issues = withSession('monday', (p) => {
      const lat = p.exercises.find((e) => e.exerciseId === 'lat-pulldown')!
      lat.archived = true
    })
    expect(issues).toContainEqual({
      code: 'slot_exercise_archived',
      sessionId: 'monday',
      exerciseId: 'lat-pulldown',
    })
  })

  it('refuses a set count outside the accepted workout limits', () => {
    for (const bad of [0, -1, 21, 1.5]) {
      const issues = withSession('monday', (p) => {
        p.sessions.monday[0] = { ...p.sessions.monday[0], setCount: bad }
      })
      expect(issues, `setCount ${bad}`).toContainEqual({
        code: 'slot_set_count_invalid',
        sessionId: 'monday',
        exerciseId: 'lat-pulldown',
      })
    }
  })

  it('refuses a descending or non-positive target', () => {
    for (const [min, max] of [
      [15, 10],
      [0, 10],
      [-1, 5],
    ]) {
      const issues = withSession('monday', (p) => {
        p.sessions.monday[0] = { ...p.sessions.monday[0], targetMin: min, targetMax: max }
      })
      expect(issues, `${min}-${max}`).toContainEqual({
        code: 'slot_target_invalid',
        sessionId: 'monday',
        exerciseId: 'lat-pulldown',
      })
    }
  })

  it('refuses equipment text past the accepted snapshot bound', () => {
    const issues = withSession('monday', (p) => {
      p.sessions.monday[0] = { ...p.sessions.monday[0], equipment: 'x'.repeat(81) }
    })
    expect(issues).toContainEqual({
      code: 'slot_equipment_invalid',
      sessionId: 'monday',
      exerciseId: 'lat-pulldown',
    })
  })

  it('refuses an unnamed or over-long exercise name', () => {
    for (const bad of ['', '   ', 'x'.repeat(81)]) {
      const programme = foundationProgramme()
      programme.exercises[0].name = bad
      expect(validateProgramme(programme), JSON.stringify(bad)).toContainEqual({
        code: 'exercise_name_invalid',
        exerciseId: 'lat-pulldown',
      })
    }
  })

  it('refuses a duplicated exercise identity in the library', () => {
    const programme = foundationProgramme()
    programme.exercises.push({ ...programme.exercises[0] })
    expect(validateProgramme(programme)).toContainEqual({
      code: 'exercise_duplicate',
      exerciseId: 'lat-pulldown',
    })
  })
})

/* ------------------------------------------------------------------ */

describe('5. position compaction', () => {
  it('renumbers 1..n from array order', () => {
    const slots = foundationProgramme().sessions.monday
    const reordered = compactPositions([slots[2], slots[0], slots[1], slots[3], slots[4]])
    expect(reordered.map((s) => s.position)).toEqual([1, 2, 3, 4, 5])
    expect(reordered[0].exerciseId).toBe('face-pull')
    expect(validateProgramme({ ...foundationProgramme(), sessions: { ...foundationProgramme().sessions, monday: reordered } })).toEqual([])
  })

  it('compacts the gap left by a removal', () => {
    const slots = foundationProgramme().sessions.monday
    const removed = compactPositions(slots.filter((s) => s.exerciseId !== 'face-pull'))
    expect(removed.map((s) => s.position)).toEqual([1, 2, 3, 4])
    expect(removed.map((s) => s.exerciseId)).toEqual([
      'lat-pulldown',
      'one-arm-db-row',
      'preacher-curl',
      'hammer-curl',
    ])
  })

  it('does not mutate the array it was handed', () => {
    const slots = foundationProgramme().sessions.monday
    const before = slots.map((s) => s.exerciseId)
    orderedSlots(slots)
    compactPositions(slots)
    expect(slots.map((s) => s.exerciseId)).toEqual(before)
  })
})
