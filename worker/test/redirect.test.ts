import { describe, expect, it } from 'vitest'

import { isSafeNextPath, loginUrlFor, safeNextPath } from '../../shared/redirect'

describe('safe next paths', () => {
  it('accepts same-app paths', () => {
    for (const path of ['/today', '/training/monday', '/exercises/lat-pulldown?x=1#a']) {
      expect(isSafeNextPath(path)).toBe(true)
      expect(safeNextPath(path)).toBe(path)
    }
  })

  it('rejects absolute URLs', () => {
    for (const value of [
      'https://evil.example.com/steal',
      'http://evil.example.com',
      'javascript:alert(1)',
      'data:text/html,<script>',
    ]) {
      expect(isSafeNextPath(value)).toBe(false)
      expect(safeNextPath(value)).toBe('/today')
    }
  })

  it('rejects protocol-relative and backslash tricks', () => {
    for (const value of ['//evil.example.com', '/\\evil.example.com', '//evil.com/path']) {
      expect(isSafeNextPath(value)).toBe(false)
      expect(safeNextPath(value)).toBe('/today')
    }
  })

  it('rejects control characters', () => {
    expect(isSafeNextPath('/today\nSet-Cookie: x=1')).toBe(false)
    expect(isSafeNextPath('/today\r\nLocation: https://evil.com')).toBe(false)
  })

  it('rejects empty and relative values', () => {
    for (const value of ['', null, undefined, 'today', '../admin']) {
      expect(isSafeNextPath(value)).toBe(false)
    }
  })

  it('refuses to bounce back to the login screen', () => {
    expect(isSafeNextPath('/login')).toBe(false)
    expect(isSafeNextPath('/login?next=%2Ftoday')).toBe(false)
  })
})

describe('loginUrlFor', () => {
  it('preserves the intended destination', () => {
    expect(loginUrlFor('/training/monday')).toBe('/login?next=%2Ftraining%2Fmonday')
  })

  it('keeps query and hash in the preserved path', () => {
    expect(loginUrlFor('/progress', '?range=week', '#chart')).toBe(
      '/login?next=%2Fprogress%3Frange%3Dweek%23chart',
    )
  })

  it('omits next for the default destination', () => {
    expect(loginUrlFor('/today')).toBe('/login')
  })

  it('omits next for an unsafe path', () => {
    expect(loginUrlFor('//evil.example.com')).toBe('/login')
  })
})
