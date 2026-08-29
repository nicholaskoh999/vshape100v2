import { describe, expect, it } from 'vitest'

import {
  completeOccurrence,
  isCalendarDay,
  listCompletions,
  MAX_OCCURRENCE_KEY_LENGTH,
  parseDayRange,
  parseOccurrenceKey,
  undoOccurrence,
} from '../today/completions'
import { createMemoryCompletionStore } from './memoryStores'

const SUB_A = 'google-sub-a'
const SUB_B = 'google-sub-b'
const KEY = '2026-09-07:gym-training'
const OCCURRENCE = { occurrenceKey: KEY, anchorDay: '2026-09-07' }
const RANGE = { from: '2026-09-06', to: '2026-09-07' }

describe('occurrence key validation', () => {
  it('accepts the accepted <YYYY-MM-DD>:<item id> shape', () => {
    expect(parseOccurrenceKey('2026-09-07:gym-training')).toEqual({
      occurrenceKey: '2026-09-07:gym-training',
      anchorDay: '2026-09-07',
    })
    expect(parseOccurrenceKey('2026-09-07:work')).toEqual({
      occurrenceKey: '2026-09-07:work',
      anchorDay: '2026-09-07',
    })
    expect(parseOccurrenceKey('2026-12-31:ready-to-sleep')?.anchorDay).toBe('2026-12-31')
  })

  it('derives the anchor day from the key itself', () => {
    // Nothing else may supply it, so a row can never disagree with its key.
    expect(parseOccurrenceKey('2026-02-29:work')).toBeNull() // 2026 is not a leap year
    expect(parseOccurrenceKey('2028-02-29:work')?.anchorDay).toBe('2028-02-29')
  })

  it.each([
    ['missing', undefined],
    ['null', null],
    ['empty', ''],
    ['no date', 'gym-training'],
    ['no item', '2026-09-07:'],
    ['no separator', '2026-09-07gym'],
    ['impossible month', '2026-13-01:work'],
    ['impossible day', '2026-02-30:work'],
    ['loose date', '2026-9-7:work'],
    ['uppercase item', '2026-09-07:Gym'],
    ['underscore item', '2026-09-07:gym_training'],
    ['leading hyphen', '2026-09-07:-gym'],
    ['trailing hyphen', '2026-09-07:gym-'],
    ['path traversal', '2026-09-07:../../etc/passwd'],
    ['sql-ish', "2026-09-07:a'; DROP TABLE today_completions;--"],
    ['whitespace', '2026-09-07: work'],
    ['newline', '2026-09-07:work\n'],
    ['second colon', '2026-09-07:work:extra'],
  ])('rejects %s', (_name, value) => {
    expect(parseOccurrenceKey(value)).toBeNull()
  })

  it('rejects an over-long key', () => {
    const long = `2026-09-07:${'a'.repeat(MAX_OCCURRENCE_KEY_LENGTH)}`
    expect(long.length).toBeGreaterThan(MAX_OCCURRENCE_KEY_LENGTH)
    expect(parseOccurrenceKey(long)).toBeNull()
  })

  it('validates calendar days', () => {
    expect(isCalendarDay('2026-09-07')).toBe(true)
    expect(isCalendarDay('2026-02-30')).toBe(false)
    expect(isCalendarDay('not-a-day')).toBe(false)
  })
})

describe('day range validation', () => {
  it('accepts an ordered range', () => {
    expect(parseDayRange('2026-09-06', '2026-09-07')).toEqual({
      from: '2026-09-06',
      to: '2026-09-07',
    })
    expect(parseDayRange('2026-09-07', '2026-09-07')).not.toBeNull()
  })

  it.each([
    ['missing from', null, '2026-09-07'],
    ['missing to', '2026-09-07', null],
    ['reversed', '2026-09-08', '2026-09-07'],
    ['invalid from', 'yesterday', '2026-09-07'],
    ['invalid to', '2026-09-07', 'tomorrow'],
    ['impossible day', '2026-02-30', '2026-03-01'],
    ['too wide', '2026-01-01', '2026-12-31'],
  ])('rejects %s', (_name, from, to) => {
    expect(parseDayRange(from, to)).toBeNull()
  })
})

describe('completion store rules', () => {
  it('1. complete inserts one occurrence for that account', async () => {
    const { store, rows } = createMemoryCompletionStore()
    await completeOccurrence(store, SUB_A, OCCURRENCE, 1_000)

    expect(rows.size).toBe(1)
    expect([...rows.values()][0]).toEqual({
      googleSub: SUB_A,
      occurrenceKey: KEY,
      anchorDay: '2026-09-07',
      completedAt: 1_000,
    })
  })

  it('2. completing the same occurrence twice is idempotent', async () => {
    const { store, rows } = createMemoryCompletionStore()
    await completeOccurrence(store, SUB_A, OCCURRENCE, 1_000)
    await completeOccurrence(store, SUB_A, OCCURRENCE, 9_999)
    await completeOccurrence(store, SUB_A, OCCURRENCE, 12_345)

    expect(rows.size).toBe(1)
    // The first completion time is kept, not moved by a repeat click.
    expect([...rows.values()][0].completedAt).toBe(1_000)
  })

  it('3. the same key for a different account is a separate row', async () => {
    const { store, rows } = createMemoryCompletionStore()
    await completeOccurrence(store, SUB_A, OCCURRENCE, 1_000)
    await completeOccurrence(store, SUB_B, OCCURRENCE, 2_000)

    expect(rows.size).toBe(2)
    expect(await listCompletions(store, SUB_A, RANGE)).toHaveLength(1)
    expect(await listCompletions(store, SUB_B, RANGE)).toHaveLength(1)

    // Undoing one account's completion leaves the other untouched.
    await undoOccurrence(store, SUB_A, OCCURRENCE)
    expect(await listCompletions(store, SUB_A, RANGE)).toHaveLength(0)
    expect(await listCompletions(store, SUB_B, RANGE)).toHaveLength(1)
  })

  it('4. undo deletes the completion', async () => {
    const { store } = createMemoryCompletionStore()
    await completeOccurrence(store, SUB_A, OCCURRENCE, 1_000)
    await undoOccurrence(store, SUB_A, OCCURRENCE)
    expect(await listCompletions(store, SUB_A, RANGE)).toEqual([])
  })

  it('5. undoing twice is safe', async () => {
    const { store } = createMemoryCompletionStore()
    await completeOccurrence(store, SUB_A, OCCURRENCE, 1_000)
    await undoOccurrence(store, SUB_A, OCCURRENCE)
    await expect(undoOccurrence(store, SUB_A, OCCURRENCE)).resolves.toBeUndefined()
    // Undoing something that was never completed is not an error either.
    await expect(
      undoOccurrence(store, SUB_A, {
        occurrenceKey: '2026-09-07:never-done',
        anchorDay: '2026-09-07',
      }),
    ).resolves.toBeUndefined()
    expect(await listCompletions(store, SUB_A, RANGE)).toEqual([])
  })

  it('complete → undo → complete restores the completion with a new time', async () => {
    const { store, rows } = createMemoryCompletionStore()
    await completeOccurrence(store, SUB_A, OCCURRENCE, 1_000)
    await undoOccurrence(store, SUB_A, OCCURRENCE)
    await completeOccurrence(store, SUB_A, OCCURRENCE, 5_000)
    expect(rows.size).toBe(1)
    expect([...rows.values()][0].completedAt).toBe(5_000)
  })

  it('reads only the requested day range', async () => {
    const { store } = createMemoryCompletionStore()
    for (const day of ['2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08']) {
      await completeOccurrence(
        store,
        SUB_A,
        { occurrenceKey: `${day}:work`, anchorDay: day },
        1_000,
      )
    }

    const found = await listCompletions(store, SUB_A, RANGE)
    expect(found.map((row) => row.anchorDay)).toEqual(['2026-09-06', '2026-09-07'])
  })

  it('keeps a previous-day spillover distinct from the same item today', async () => {
    const { store } = createMemoryCompletionStore()
    const yesterday = {
      occurrenceKey: '2026-09-06:ready-to-sleep',
      anchorDay: '2026-09-06',
    }
    const today = { occurrenceKey: '2026-09-07:ready-to-sleep', anchorDay: '2026-09-07' }

    await completeOccurrence(store, SUB_A, yesterday, 1_000)
    const found = await listCompletions(store, SUB_A, RANGE)
    expect(found.map((row) => row.occurrenceKey)).toEqual(['2026-09-06:ready-to-sleep'])

    await undoOccurrence(store, SUB_A, today)
    // Undoing today's occurrence must not remove yesterday's.
    expect(await listCompletions(store, SUB_A, RANGE)).toHaveLength(1)
  })
})
