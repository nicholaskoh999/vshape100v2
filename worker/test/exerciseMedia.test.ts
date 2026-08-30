import { describe, expect, it } from 'vitest'

import {
  isSafeMediaUrl,
  listMedia,
  MAX_EXERCISE_ID_LENGTH,
  MAX_MEDIA_ALT_LENGTH,
  MAX_MEDIA_URL_LENGTH,
  parseExerciseId,
  parseMediaInput,
  readMedia,
  removeMedia,
  saveMedia,
} from '../exerciseMedia/media'
import { createMemoryExerciseMediaStore } from './memoryStores'

/**
 * Round 07 — canonical exercise media rules and storage boundary.
 *
 * No real media is referenced anywhere: every URL here is a fixture.
 */

const GIF = {
  kind: 'gif',
  url: 'https://media.test.invalid/lat-pulldown.gif',
  alt: 'Lat Pulldown demonstration',
} as const

const IMAGE = {
  kind: 'image',
  url: 'https://media.test.invalid/lat-pulldown.png',
  alt: 'Lat Pulldown still',
} as const

describe('exercise id validation', () => {
  it('accepts stable lowercase slugs', () => {
    for (const id of ['lat-pulldown', 'plank', 'one-arm-db-row', 'dead-bug']) {
      expect(parseExerciseId(id)).toBe(id)
    }
  })

  it('rejects anything that is not a stable slug', () => {
    for (const id of [
      '',
      'Lat-Pulldown',
      'lat_pulldown',
      'lat pulldown',
      '-lat',
      'lat-',
      'lat--pulldown',
      '../../etc/passwd',
      "lat'; DROP TABLE exercise_media;--",
      'lat/pulldown',
      'a'.repeat(MAX_EXERCISE_ID_LENGTH + 1),
      null,
      undefined,
    ]) {
      expect(parseExerciseId(id as string)).toBeNull()
    }
  })
})

describe('media URL validation', () => {
  it('accepts absolute http and https URLs', () => {
    expect(isSafeMediaUrl('https://media.test.invalid/a.gif')).toBe(true)
    expect(isSafeMediaUrl('http://media.test.invalid/a.png')).toBe(true)
    // Surrounding whitespace is trimmed, not rejected.
    expect(isSafeMediaUrl('  https://media.test.invalid/a.gif  ')).toBe(true)
  })

  it('rejects every unapproved scheme', () => {
    for (const url of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
      'file:///etc/passwd',
      'blob:https://media.test.invalid/abc',
      'ftp://media.test.invalid/a.gif',
      'vbscript:msgbox(1)',
    ]) {
      expect(isSafeMediaUrl(url)).toBe(false)
    }
  })

  it('rejects malformed and relative URLs', () => {
    for (const url of [
      '',
      '   ',
      'not a url',
      '/media/lat-pulldown.gif',
      '//media.test.invalid/a.gif',
      'https://',
      `https://media.test.invalid/${'a'.repeat(MAX_MEDIA_URL_LENGTH)}`,
      42,
      null,
    ]) {
      expect(isSafeMediaUrl(url as string)).toBe(false)
    }
  })
})

describe('media body validation', () => {
  it('accepts a well-formed body and trims it', () => {
    const parsed = parseMediaInput({
      kind: 'gif',
      url: '  https://media.test.invalid/a.gif  ',
      alt: '  Lat Pulldown demonstration  ',
    })
    expect(parsed).toEqual({
      ok: true,
      value: {
        kind: 'gif',
        url: 'https://media.test.invalid/a.gif',
        alt: 'Lat Pulldown demonstration',
      },
    })
  })

  it('rejects an unsupported media type', () => {
    for (const kind of ['video', 'GIF', 'webm', '', null, 1]) {
      expect(parseMediaInput({ ...GIF, kind })).toEqual({ ok: false, field: 'kind' })
    }
  })

  it('rejects an unsafe or malformed URL', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,x', 'nope', '']) {
      expect(parseMediaInput({ ...GIF, url })).toEqual({ ok: false, field: 'url' })
    }
  })

  it('requires useful alt text', () => {
    for (const alt of ['', '   ', '\t\n', 'x'.repeat(MAX_MEDIA_ALT_LENGTH + 1), 7, null]) {
      expect(parseMediaInput({ ...GIF, alt })).toEqual({ ok: false, field: 'alt' })
    }
  })

  it('rejects a body that is not an object', () => {
    for (const body of [null, 'a string', 42, [GIF]]) {
      expect(parseMediaInput(body)).toEqual({ ok: false, field: 'body' })
    }
  })
})

describe('canonical storage', () => {
  it('reads back what was saved for one exercise identity', async () => {
    const { store } = createMemoryExerciseMediaStore()
    await saveMedia(store, 'sub-a', 'lat-pulldown', GIF, 100)

    expect(await readMedia(store, 'sub-a', 'lat-pulldown')).toEqual({
      googleSub: 'sub-a',
      exerciseId: 'lat-pulldown',
      ...GIF,
      updatedAt: 100,
    })
  })

  it('replaces rather than duplicates on a second save', async () => {
    const { store, rows } = createMemoryExerciseMediaStore()
    await saveMedia(store, 'sub-a', 'lat-pulldown', GIF, 100)
    await saveMedia(store, 'sub-a', 'lat-pulldown', IMAGE, 200)

    expect(rows.size).toBe(1)
    const record = await readMedia(store, 'sub-a', 'lat-pulldown')
    expect(record?.kind).toBe('image')
    expect(record?.url).toBe(IMAGE.url)
    expect(record?.updatedAt).toBe(200)
  })

  it('gives one record back however many days train the exercise', async () => {
    // The days are not part of the key at all, so there is nothing to
    // duplicate: three sessions, one row.
    const { store, rows } = createMemoryExerciseMediaStore()
    await saveMedia(store, 'sub-a', 'lat-pulldown', GIF, 100)

    expect(rows.size).toBe(1)
    expect([...rows.keys()][0]).toContain('lat-pulldown')
    expect([...rows.keys()][0]).not.toContain('monday')
  })

  it('returns null for an exercise with no media', async () => {
    const { store } = createMemoryExerciseMediaStore()
    expect(await readMedia(store, 'sub-a', 'plank')).toBeNull()
  })

  it('removes a record and leaves removing again harmless', async () => {
    const { store, rows } = createMemoryExerciseMediaStore()
    await saveMedia(store, 'sub-a', 'lat-pulldown', GIF, 100)

    await removeMedia(store, 'sub-a', 'lat-pulldown')
    await removeMedia(store, 'sub-a', 'lat-pulldown')

    expect(rows.size).toBe(0)
    expect(await readMedia(store, 'sub-a', 'lat-pulldown')).toBeNull()
  })

  it('keeps accounts isolated', async () => {
    const { store } = createMemoryExerciseMediaStore()
    await saveMedia(store, 'sub-a', 'lat-pulldown', GIF, 100)
    await saveMedia(store, 'sub-b', 'lat-pulldown', IMAGE, 200)

    expect((await readMedia(store, 'sub-a', 'lat-pulldown'))?.url).toBe(GIF.url)
    expect((await readMedia(store, 'sub-b', 'lat-pulldown'))?.url).toBe(IMAGE.url)

    await removeMedia(store, 'sub-b', 'lat-pulldown')
    expect(await readMedia(store, 'sub-a', 'lat-pulldown')).not.toBeNull()
  })

  it('lists only the current account, newest edit first', async () => {
    const { store } = createMemoryExerciseMediaStore()
    await saveMedia(store, 'sub-a', 'lat-pulldown', GIF, 100)
    await saveMedia(store, 'sub-a', 'plank', IMAGE, 300)
    await saveMedia(store, 'sub-b', 'face-pull', GIF, 200)

    expect((await listMedia(store, 'sub-a')).map((row) => row.exerciseId)).toEqual([
      'plank',
      'lat-pulldown',
    ])
    expect((await listMedia(store, 'sub-b')).map((row) => row.exerciseId)).toEqual([
      'face-pull',
    ])
  })
})
