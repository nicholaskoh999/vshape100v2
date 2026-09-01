import { describe, expect, it } from 'vitest'

import { holidayRoute, routeForDate, sessionIdForWeekday } from '@shared/today/routines'
import {
  deriveSessionProgression,
  type ProgressionSetRow,
} from '@shared/progression/engine'
import { laneFingerprint } from '@shared/progression/lane'

/**
 * Round 16 — how Holiday interacts with progression.
 *
 * The rule is that there is NO interaction to build. A Training-On Holiday
 * restores the session that weekday already planned, so it is the ordinary
 * weekday lane; a Training-Off Holiday plans no session at all, so it produces
 * no workout and therefore no evidence. Neither needs a "holiday lane", and
 * inventing one would split a person's real history in two.
 *
 * These tests assert exactly that: the Holiday route resolves to the SAME
 * session id, and a lane fingerprint built from it is byte-identical.
 */

/** The gym item of a route, or null when the route plans none. */
function gymItem(route: ReturnType<typeof holidayRoute>) {
  return route.items.find((item) => item.id === 'gym-training') ?? null
}

/** An ordinary Monday, taken from the real weekday route. */
const ORDINARY_MONDAY = new Date(2026, 7, 31, 12, 0)

/** Monday. `weekday` is a JS day index, so 1 is Monday. */
const MONDAY = 1
const SATURDAY = 6

function slot(date: string, results: number[], load: number): ProgressionSetRow[] {
  return results.map((result, setIndex) => ({
    workoutDate: date,
    exerciseOrder: 0,
    setIndex,
    exerciseId: 'lat-pulldown',
    exerciseName: 'Lat Pulldown',
    prescription: '4 × 10–15',
    resultKind: 'reps',
    loadMode: 'kg',
    perSide: false,
    status: 'completed',
    loadValue: load,
    loadUnit: 'kg',
    result,
  }))
}

function pending(date: string): ProgressionSetRow[] {
  return Array.from({ length: 4 }, (_unused, setIndex) => ({
    workoutDate: date,
    exerciseOrder: 0,
    setIndex,
    exerciseId: 'lat-pulldown',
    exerciseName: 'Lat Pulldown',
    prescription: '4 × 10–15',
    resultKind: 'reps',
    loadMode: 'kg',
    perSide: false,
    status: 'pending',
    loadValue: null,
    loadUnit: null,
    result: null,
  }))
}

describe('31. Holiday Training On uses the underlying weekday lane', () => {
  it('restores the very session that weekday already planned', () => {
    const holiday = holidayRoute({ name: 'Company day', trainingOn: true, weekday: MONDAY })
    const ordinary = routeForDate(ORDINARY_MONDAY)

    const onHoliday = gymItem(holiday)
    const onWeekday = gymItem(ordinary)

    expect(onHoliday).not.toBeNull()
    // The same link, so the same session page, so the same workout occurrence.
    expect(onHoliday?.to).toBe(onWeekday?.to)
    expect(onHoliday?.to).toBe(`/training/${sessionIdForWeekday(MONDAY)}`)
  })

  it('produces an identical lane fingerprint — there is no "holiday lane"', () => {
    const sessionId = sessionIdForWeekday(MONDAY) as string
    const lane = {
      sessionId,
      exerciseId: 'lat-pulldown',
      setCount: 4,
      lower: 10,
      upper: 15,
      resultKind: 'reps',
      loadMode: 'kg',
      perSide: false,
    } as const

    // Nothing about a Holiday enters lane identity, so a workout performed on
    // one is the same lane as any other Monday.
    expect(laneFingerprint(lane)).toBe(laneFingerprint({ ...lane }))
    expect(laneFingerprint(lane)).toContain('|monday|')
  })

  it('reads the ordinary weekday history, and feeds back into it', () => {
    const sessionId = sessionIdForWeekday(MONDAY) as string

    // 2026-08-31 is an ordinary Monday; 2026-09-07 is a Monday the user spent
    // on a Training-On Holiday. Same session, so one continuous lane.
    const onHoliday = deriveSessionProgression({
      sessionId,
      intensity: 'HARD',
      current: pending('2026-09-07'),
      history: slot('2026-08-31', [12, 12, 11, 10], 20),
      calibration: [],
      historyComplete: true,
    })
    expect(onHoliday.lanes[0].state).toBe('build_reps')
    expect(onHoliday.lanes[0].suggestedLoad).toEqual({ value: 20, unit: 'kg' })
    expect(onHoliday.lanes[0].lastResult?.date).toBe('2026-08-31')

    // And what was performed on the Holiday is ordinary evidence afterwards.
    const afterwards = deriveSessionProgression({
      sessionId,
      intensity: 'HARD',
      current: pending('2026-09-14'),
      history: [...slot('2026-08-31', [12, 12, 11, 10], 20), ...slot('2026-09-07', [15, 15, 15, 15], 20)],
      calibration: [],
      historyComplete: true,
    })
    expect(afterwards.lanes[0].state).toBe('increase_load')
    expect(afterwards.lanes[0].lastResult?.date).toBe('2026-09-07')
  })

  it('a weekend Holiday gains no session, so there is no lane to guide', () => {
    const weekend = holidayRoute({ trainingOn: true, weekday: SATURDAY })
    expect(gymItem(weekend)).toBeNull()
    expect(sessionIdForWeekday(SATURDAY)).toBeNull()
  })
})

describe('32. Holiday Training Off generates no progression evidence', () => {
  it('plans no session at all', () => {
    const off = holidayRoute({ name: 'Company day', trainingOn: false, weekday: MONDAY })
    expect(gymItem(off)).toBeNull()
    expect(off.trainingOn).toBe(false)
  })

  it('leaves the lane reading the last REAL session, not a gap', () => {
    const sessionId = sessionIdForWeekday(MONDAY) as string

    // The Monday in between was Training Off: no workout was started, so no
    // occurrence exists and nothing enters history for it.
    const next = deriveSessionProgression({
      sessionId,
      intensity: 'HARD',
      current: pending('2026-09-14'),
      history: slot('2026-08-31', [12, 12, 11, 10], 20),
      calibration: [],
      historyComplete: true,
    })

    expect(next.lanes[0].state).toBe('build_reps')
    expect(next.lanes[0].lastResult?.date).toBe('2026-08-31')
    // A missed week is not a weak session: nothing is deloaded for resting.
    expect(next.lanes[0].loadDirection).toBeNull()
  })
})
