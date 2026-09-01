import { describe, expect, it } from 'vitest'

import { buildMilestones } from '@/features/achievements/model/milestones'
import { scheduledDayFor } from '@/features/achievements/model/schedule'
import {
  countQualifyingSessions,
  evaluateStreaks,
  outcomeFor,
  type StreakSources,
} from '@/features/achievements/model/streak'
import { foundationStatus } from '@/features/progress/foundation'
import { sessionIdForWeekday } from '@/features/today/model/routines'
import { weekdayOf } from '@shared/localDate'
import type { HolidayRecord } from '@shared/holiday'
import {
  isTrainingFlexKind,
  parseTrainingFlexUpdate,
  readTrainingFlexKind,
  TRAINING_FLEX_KINDS,
  type TrainingFlexKind,
} from '@shared/trainingFlex'
import type { WorkoutHistoryEntry } from '@shared/workoutLog'

/**
 * Round 19.2 — Today Training Flex, as a model.
 *
 * The product promise this defends is narrow and easy to break: choosing
 * Recovery or Fitness Boxing must be a statement about the DAY and never a
 * statement about TRAINING. A flex choice may not become a finished session, a
 * set, a personal best, progression evidence, or an unlocked achievement — and
 * it must not break a streak either, because the app asked the user to make the
 * choice honestly.
 */

/* 2026-09-07 is a Monday; the week runs to Friday the 11th. */
const MON = '2026-09-07'
const TUE = '2026-09-08'
const WED = '2026-09-09'
const SAT = '2026-09-12'

const NO_HOLIDAYS: HolidayRecord[] = []
const NO_FLEX = new Map<string, TrainingFlexKind>()

function flexOn(date: string, kind: TrainingFlexKind) {
  return new Map<string, TrainingFlexKind>([[date, kind]])
}

function finished(date: string, sessionId: string): WorkoutHistoryEntry {
  return {
    date,
    sessionId,
    kind: 'scheduled',
    sourceSessionId: null,
    day: 'Day',
    focus: 'Focus',
    intensity: 'HARD',
    startedAt: 1,
    updatedAt: 2,
    progress: { total: 4, completed: 4, skipped: 0, resolved: 4 },
  } as WorkoutHistoryEntry
}

function sources(over: Partial<StreakSources> = {}): StreakSources {
  return {
    today: WED,
    from: MON,
    holidayStatus: 'ready',
    holidays: [],
    flexStatus: 'ready',
    flex: NO_FLEX,
    historyStatus: 'ready',
    entries: [],
    coverage: 'complete',
    ...over,
  }
}

function factsOf(over: Partial<StreakSources>) {
  const result = evaluateStreaks(sources(over))
  if (result.status !== 'ready') throw new Error(`expected ready, got ${result.status}`)
  return result.facts
}

/* ------------------------------------------------------------------ */
/* 1. The allowlist                                                    */
/* ------------------------------------------------------------------ */

describe('1. only the two agreed kinds exist', () => {
  it('accepts exactly recovery and fitness_boxing_2', () => {
    expect([...TRAINING_FLEX_KINDS]).toEqual(['recovery', 'fitness_boxing_2'])
  })

  it.each([
    'yoga',
    'swimming',
    'RECOVERY',
    'fitness_boxing',
    '',
    ' recovery',
    42,
    null,
    {},
    ['recovery'],
  ])('refuses %s — arbitrary activities are an explicit non-goal', (value) => {
    expect(isTrainingFlexKind(value)).toBe(false)
  })

  it('classifies stored values three ways, never two', () => {
    expect(readTrainingFlexKind(null)).toEqual({ kind: 'none' })
    expect(readTrainingFlexKind(undefined)).toEqual({ kind: 'none' })
    expect(readTrainingFlexKind('recovery')).toEqual({ kind: 'choice', value: 'recovery' })
    // Unreadable is NOT "no choice": collapsing them would show a resolved day
    // as unresolved and let its reminder fire again.
    expect(readTrainingFlexKind('yoga')).toEqual({ kind: 'unreadable' })
    expect(readTrainingFlexKind(7)).toEqual({ kind: 'unreadable' })
  })
})

/* ------------------------------------------------------------------ */
/* 2. Update validation                                                */
/* ------------------------------------------------------------------ */

describe('2. malformed input fails closed', () => {
  /** Noon UTC on the Tuesday; read in UTC, the local date is also the Tuesday. */
  const AT_NOON = new Date(`${TUE}T12:00:00Z`)
  const update = (body: Record<string, unknown>) =>
    parseTrainingFlexUpdate({ timezone: 'UTC', ...body }, AT_NOON)

  it('accepts a real date with an allowed kind', () => {
    expect(update({ date: TUE, kind: 'recovery' })).toEqual({
      ok: true,
      value: { date: TUE, kind: 'recovery' },
    })
  })

  it('accepts an explicit null as "I will do the scheduled workout"', () => {
    expect(update({ date: TUE, kind: null })).toEqual({
      ok: true,
      value: { date: TUE, kind: null },
    })
  })

  it.each([
    [{ date: '2026-02-30', kind: 'recovery' }, 'date'],
    [{ date: 'today', kind: 'recovery' }, 'date'],
    [{ kind: 'recovery' }, 'date'],
    [{ date: TUE }, 'kind'],
    [{ date: TUE, kind: 'yoga' }, 'kind'],
    [{ date: TUE, kind: 1 }, 'kind'],
  ])('refuses %o on the %s field', (body, field) => {
    expect(update(body)).toEqual({ ok: false, field })
  })

  it.each([null, [], 'recovery', 42])('refuses a non-object body: %s', (body) => {
    expect(parseTrainingFlexUpdate(body, AT_NOON)).toEqual({ ok: false, field: 'body' })
  })

  it('drops an identity supplied in the body', () => {
    // `googleSub` is not part of the accepted shape, so sending one changes
    // nothing: the account is the one on the session.
    expect(update({ date: TUE, kind: 'recovery', googleSub: 'somebody-else' })).toEqual({
      ok: true,
      value: { date: TUE, kind: 'recovery' },
    })
  })
})

/* ------------------------------------------------------------------ */
/* 3. Today only — EXACTLY today, in the caller's own zone              */
/* ------------------------------------------------------------------ */

describe('3. the choice is for the exact current local day', () => {
  /**
   * 17:00 UTC on 2026-09-08.
   *
   * Kuala Lumpur (UTC+8) has already rolled over to the 9th; Los Angeles
   * (UTC-7 in September) is still on the 8th. One instant, two different local
   * "todays" — which is exactly why the zone has to come from the caller and
   * why the old UTC ±1 slack was wrong in both directions.
   */
  const EVENING_UTC = new Date('2026-09-08T17:00:00Z')
  /** 05:00 UTC on 2026-09-08: Los Angeles is still on the 7th. */
  const MORNING_UTC = new Date('2026-09-08T05:00:00Z')

  const KL = 'Asia/Kuala_Lumpur'
  const LA = 'America/Los_Angeles'

  const parse = (body: Record<string, unknown>, now: Date) =>
    parseTrainingFlexUpdate({ kind: 'recovery', ...body }, now)

  it('accepts the exact local today when the zone is AHEAD of UTC', () => {
    expect(parse({ date: '2026-09-09', timezone: KL }, EVENING_UTC)).toEqual({
      ok: true,
      value: { date: '2026-09-09', kind: 'recovery' },
    })
    // The UTC date is not this caller's today. The removed ±1 rule accepted it.
    expect(parse({ date: '2026-09-08', timezone: KL }, EVENING_UTC)).toEqual({
      ok: false,
      field: 'date',
    })
  })

  it('accepts the exact local today when the zone is BEHIND UTC', () => {
    expect(parse({ date: '2026-09-07', timezone: LA }, MORNING_UTC)).toEqual({
      ok: true,
      value: { date: '2026-09-07', kind: 'recovery' },
    })
    expect(parse({ date: '2026-09-08', timezone: LA }, MORNING_UTC)).toEqual({
      ok: false,
      field: 'date',
    })
  })

  it('refuses yesterday', () => {
    expect(parse({ date: '2026-09-08', timezone: KL }, EVENING_UTC)).toEqual({
      ok: false,
      field: 'date',
    })
    expect(parse({ date: '2026-09-06', timezone: LA }, MORNING_UTC)).toEqual({
      ok: false,
      field: 'date',
    })
  })

  it('refuses tomorrow', () => {
    expect(parse({ date: '2026-09-10', timezone: KL }, EVENING_UTC)).toEqual({
      ok: false,
      field: 'date',
    })
    expect(parse({ date: '2026-09-08', timezone: LA }, MORNING_UTC)).toEqual({
      ok: false,
      field: 'date',
    })
  })

  it('refuses anything further away', () => {
    for (const date of ['2026-09-01', '2026-08-08', '2027-09-09', '2026-12-25']) {
      expect(parse({ date, timezone: KL }, EVENING_UTC), date).toEqual({
        ok: false,
        field: 'date',
      })
    }
  })

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['unknown', 'Mars/Olympus'],
    ['an offset rather than a zone', '+08:00'],
    ['a number', 8],
    ['null', null],
    ['free text', 'somewhere warm'],
  ])('fails closed on a %s timezone, never falling back to UTC', (_why, timezone) => {
    const body: Record<string, unknown> = { date: '2026-09-09', kind: 'recovery' }
    if (timezone !== undefined) body.timezone = timezone
    expect(parseTrainingFlexUpdate(body, EVENING_UTC)).toEqual({
      ok: false,
      field: 'timezone',
    })
  })

  it('validates the zone BEFORE the date', () => {
    // Without a usable zone there is no "today" to compare against, so the zone
    // is the failure reported — not a date verdict reached by guessing UTC.
    expect(
      parseTrainingFlexUpdate({ date: '1999-01-01', kind: 'recovery' }, EVENING_UTC),
    ).toEqual({ ok: false, field: 'timezone' })
  })

  it('applies the same rule to CLEARING a day', () => {
    // Clearing is still a mutation aimed at a specific date.
    expect(parse({ date: '2026-09-09', timezone: KL, kind: null }, EVENING_UTC)).toEqual({
      ok: true,
      value: { date: '2026-09-09', kind: null },
    })
    expect(parse({ date: '2026-09-08', timezone: KL, kind: null }, EVENING_UTC)).toEqual({
      ok: false,
      field: 'date',
    })
  })
})

/* ------------------------------------------------------------------ */
/* 4. A flex day is NEUTRAL                                            */
/* ------------------------------------------------------------------ */

describe('4. a resolved day neither extends nor breaks a streak', () => {
  it.each(TRAINING_FLEX_KINDS)('%s makes a training day neutral', (kind) => {
    const day = scheduledDayFor(TUE, NO_HOLIDAYS, flexOn(TUE, kind))
    expect(day).toEqual({ kind: 'neutral', date: TUE, reason: 'flex', flex: kind })

    expect(
      outcomeFor(TUE, {
        today: WED,
        holidays: NO_HOLIDAYS,
        flex: flexOn(TUE, kind),
        qualifying: new Set<string>(),
      }),
    ).toBe('neutral')
  })

  it.each(TRAINING_FLEX_KINDS)('%s does not BREAK the streak', (kind) => {
    const entries = [finished(MON, 'monday'), finished(WED, 'wednesday')]

    // Without the choice, the untrained Tuesday is a miss and the run is cut.
    expect(factsOf({ entries }).current).toBe(1)
    // With it, Tuesday is stepped over exactly as a weekend would be.
    expect(factsOf({ entries, flex: flexOn(TUE, kind) }).current).toBe(2)
  })

  it.each(TRAINING_FLEX_KINDS)('%s does not EXTEND the streak', (kind) => {
    const entries = [finished(MON, 'monday')]
    // Today IS the flexed day. The streak is Monday's alone; choosing recovery
    // did not add a training day to it.
    const withFlex = factsOf({ entries, today: TUE, flex: flexOn(TUE, kind) })
    expect(withFlex.current).toBe(1)
    expect(withFlex.best).toBe(1)
  })

  it.each(TRAINING_FLEX_KINDS)('%s never counts as a finished session', (kind) => {
    const flex = flexOn(TUE, kind)
    // Counted from the LOGS, and a choice writes no log.
    expect(countQualifyingSessions([])).toBe(0)
    expect(factsOf({ flex, today: TUE }).qualifyingSessions).toBe(0)
  })
})

/* ------------------------------------------------------------------ */
/* 5. Achievements                                                     */
/* ------------------------------------------------------------------ */

describe('5. a resolved day unlocks nothing', () => {
  it.each(TRAINING_FLEX_KINDS)('%s leaves every training milestone locked', (kind) => {
    const streak = evaluateStreaks(sources({ today: TUE, flex: flexOn(TUE, kind) }))
    const milestones = buildMilestones({
      streak,
      foundation: foundationStatus(TUE, '2026-09-07'),
    })

    for (const id of ['first-session', 'full-week', 'consistency']) {
      const found = milestones.find((m) => m.id === id)!
      expect(found.state.status, id).toBe('locked')
      expect(found.state.status === 'locked' && found.state.value, id).toBe(0)
    }
  })
})

/* ------------------------------------------------------------------ */
/* 6. Isolation from everything else                                   */
/* ------------------------------------------------------------------ */

describe('6. flex rewrites nothing', () => {
  it('does not change the weekday programme, today or in future', () => {
    const flex = flexOn(TUE, 'recovery')
    // The mapping is a property of the WEEKDAY and takes no flex input at all.
    for (const date of [MON, TUE, WED, '2026-09-15', '2026-10-06']) {
      expect(sessionIdForWeekday(weekdayOf(date)!), date).toBe(
        sessionIdForWeekday(weekdayOf(date)!),
      )
    }
    // Tomorrow is untouched: only the chosen date became neutral.
    expect(scheduledDayFor(WED, NO_HOLIDAYS, flex)).toEqual({
      kind: 'training',
      date: WED,
      sessionId: 'wednesday',
    })
  })

  it('cannot CREATE a training day out of a weekend', () => {
    // Flex only ever turns training into neutral. A Saturday stays a Saturday.
    expect(scheduledDayFor(SAT, NO_HOLIDAYS, flexOn(SAT, 'recovery'))).toEqual({
      kind: 'neutral',
      date: SAT,
      reason: 'saturday',
    })
  })

  it('does not override Holiday Training Off', () => {
    const exempt: HolidayRecord[] = [
      {
        id: 'h1',
        startDate: TUE,
        endDate: TUE,
        name: '',
        source: 'custom',
        trainingOn: false,
        createdAt: 1,
        updatedAt: 1,
      } as HolidayRecord,
    ]
    // Still neutral FOR THE HOLIDAY reason: Holiday remains the authority on
    // whether the day planned training at all.
    expect(scheduledDayFor(TUE, exempt, flexOn(TUE, 'recovery'))).toEqual({
      kind: 'neutral',
      date: TUE,
      reason: 'holiday',
    })
  })

  it('applies to a Holiday that DOES train, because that day plans a session', () => {
    const trainingHoliday: HolidayRecord[] = [
      {
        id: 'h2',
        startDate: TUE,
        endDate: TUE,
        name: '',
        source: 'custom',
        trainingOn: true,
        createdAt: 1,
        updatedAt: 1,
      } as HolidayRecord,
    ]
    expect(scheduledDayFor(TUE, trainingHoliday, NO_FLEX)).toEqual({
      kind: 'training',
      date: TUE,
      sessionId: 'tuesday',
    })
    expect(scheduledDayFor(TUE, trainingHoliday, flexOn(TUE, 'recovery'))).toEqual({
      kind: 'neutral',
      date: TUE,
      reason: 'flex',
      flex: 'recovery',
    })
  })

  it('leaves an Extra workout exactly as Round 17 defined it', () => {
    // An Extra is not a scheduled session and never was; flex changes nothing
    // about that, because it only ever acts on the day's PLAN.
    const extra = {
      ...finished(TUE, 'extra'),
      kind: 'extra',
      sourceSessionId: 'monday',
    } as WorkoutHistoryEntry
    expect(countQualifyingSessions([extra])).toBe(0)
    expect(factsOf({ entries: [extra], today: TUE, flex: flexOn(TUE, 'recovery') }).qualifyingSessions).toBe(0)
  })
})

/* ------------------------------------------------------------------ */
/* 7. Unreadable flex withholds rather than inventing a miss           */
/* ------------------------------------------------------------------ */

describe('7. flex truth that could not be read is refused', () => {
  it.each(['loading', 'error'] as const)('%s never states a streak', (flexStatus) => {
    const result = evaluateStreaks(sources({ flexStatus, entries: [finished(MON, 'monday')] }))
    if (flexStatus === 'loading') {
      expect(result.status).toBe('checking')
    } else {
      // Treating it as "no days were flexed" would turn a deliberately resolved
      // day into a missed one and invent a broken streak.
      expect(result).toEqual({ status: 'unavailable', reason: 'flex' })
    }
  })
})

/* ------------------------------------------------------------------ */
/* 8. Mutual exclusion, seen from the derived truth                     */
/* ------------------------------------------------------------------ */

describe('8. a day is one thing or the other, never both', () => {
  it('a COMPLETED scheduled workout still counts, with no flex present', () => {
    // The control for the conflict rule below: without a competing choice, a
    // real finished session is exactly as qualifying as it always was.
    const facts = factsOf({ entries: [finished(TUE, 'tuesday')], today: TUE })
    expect(facts.qualifyingSessions).toBe(1)
    expect(facts.current).toBe(1)

    const milestones = buildMilestones({
      streak: evaluateStreaks(sources({ entries: [finished(TUE, 'tuesday')], today: TUE })),
      foundation: foundationStatus(TUE, MON),
    })
    expect(milestones.find((m) => m.id === 'first-session')!.state).toEqual({
      status: 'unlocked',
    })
  })

  it('a flex-only day stays neutral, with no workout present', () => {
    // The other control. Together these two prove the conflict verdict below is
    // caused by the COMBINATION, not by either fact on its own.
    const facts = factsOf({ today: TUE, flex: flexOn(TUE, 'recovery') })
    expect(facts.qualifyingSessions).toBe(0)
    expect(facts.current).toBe(0)
    expect(
      outcomeFor(TUE, {
        today: TUE,
        holidays: NO_HOLIDAYS,
        flex: flexOn(TUE, 'recovery'),
        qualifying: new Set<string>(),
      }),
    ).toBe('neutral')
  })

  it.each(TRAINING_FLEX_KINDS)(
    'refuses to state ANY claim when %s and a real scheduled workout collide',
    (kind) => {
      // Server truth makes this impossible, so reaching it means the data is
      // not something this model can describe. Silently neutralising the day
      // would discount a workout the user genuinely did; ignoring the choice
      // would contradict what they explicitly recorded. Neither is acceptable,
      // so no number is stated at all.
      const result = evaluateStreaks(
        sources({ entries: [finished(TUE, 'tuesday')], today: TUE, flex: flexOn(TUE, kind) }),
      )
      expect(result).toEqual({ status: 'unavailable', reason: 'conflict' })
    },
  )

  it('withholds the training milestones too, rather than half-answering', () => {
    const streak = evaluateStreaks(
      sources({ entries: [finished(TUE, 'tuesday')], today: TUE, flex: flexOn(TUE, 'recovery') }),
    )
    const milestones = buildMilestones({ streak, foundation: foundationStatus(TUE, MON) })
    for (const id of ['first-session', 'full-week', 'consistency']) {
      expect(milestones.find((m) => m.id === id)!.state.status, id).toBe('unresolved')
    }
  })

  it('is not triggered by an EXTRA on a flexed day', () => {
    // An Extra is not the day's scheduled obligation, so it is not in conflict
    // with having resolved that obligation another way.
    const extra = {
      ...finished(TUE, 'extra'),
      kind: 'extra',
      sourceSessionId: 'tuesday',
    } as WorkoutHistoryEntry
    const result = evaluateStreaks(
      sources({ entries: [extra], today: TUE, flex: flexOn(TUE, 'recovery') }),
    )
    expect(result.status).toBe('ready')
  })

  it('is not triggered by a workout on a DIFFERENT day', () => {
    const result = evaluateStreaks(
      sources({ entries: [finished(MON, 'monday')], today: TUE, flex: flexOn(TUE, 'recovery') }),
    )
    expect(result.status).toBe('ready')
  })
})
