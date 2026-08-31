import { describe, expect, it } from 'vitest'

import webPushSource from '../../worker/push/webPush.ts?raw'
import schedulerSource from '../../worker/notifications/scheduler.ts?raw'
import routinesSource from '../../shared/today/routines.ts?raw'

/**
 * Round 14 — Workers runtime compatibility, and one schedule.
 *
 * Two things are checked by reading the source itself, because both are
 * properties of what the code IMPORTS and CONTAINS rather than of what it
 * returns:
 *
 *   1. The Web Push implementation must run inside Cloudflare Workers. A
 *      single `node:crypto` or `Buffer` would make it a feature that builds
 *      and then fails in production.
 *   2. The notification scheduler must not carry its own copy of the routine.
 *      A stray `20:30` in the Worker would be a second schedule, and the two
 *      would drift the first time a time changed.
 *
 * Comments are stripped before matching: they explain WHY those things are
 * absent, and would otherwise trip the very check that proves it.
 */

function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

/* ------------------------------------------------------------------ */
/* 1. Web Push runs in Workers                                         */
/* ------------------------------------------------------------------ */

describe('1. Web Push is Workers-native', () => {
  const code = codeOnly(webPushSource)

  it('imports nothing Node-only', () => {
    for (const banned of [
      /from ['"]node:/,
      /require\(/,
      /from ['"]crypto['"]/,
      /from ['"]https['"]/,
      /from ['"]http['"]/,
      /\bBuffer\b/,
      /process\./,
    ]) {
      expect(code, String(banned)).not.toMatch(banned)
    }
  })

  it('takes no dependency on a push library', () => {
    // The compatibility question disappears entirely when there is nothing to
    // be compatible with.
    for (const banned of [/web-push/, /['"]jose['"]/, /['"]node-forge['"]/]) {
      expect(code, String(banned)).not.toMatch(banned)
    }
    // Its only imports are relative, if any.
    const imports = [...code.matchAll(/from ['"]([^'"]+)['"]/g)].map((m) => m[1])
    for (const specifier of imports) {
      expect(specifier.startsWith('.'), specifier).toBe(true)
    }
  })

  it('uses the SubtleCrypto primitives Workers provides', () => {
    for (const required of [
      /crypto\.subtle\.importKey/,
      /crypto\.subtle\.deriveBits/,
      /crypto\.subtle\.encrypt/,
      /crypto\.subtle\.sign/,
      /crypto\.getRandomValues/,
      /ECDH/,
      /AES-GCM/,
      /ECDSA/,
    ]) {
      expect(code, String(required)).toMatch(required)
    }
  })

  it('keeps a short TTL so a missed reminder cannot arrive late', () => {
    expect(code).toMatch(/PUSH_TTL_SECONDS\s*=\s*(\d+)/)
    const seconds = Number(/PUSH_TTL_SECONDS\s*=\s*(\d+)/.exec(code)?.[1])
    expect(seconds).toBeGreaterThan(0)
    expect(seconds).toBeLessThanOrEqual(900)
  })
})

/* ------------------------------------------------------------------ */
/* 2. There is only one schedule                                       */
/* ------------------------------------------------------------------ */

describe('2. the scheduler owns no schedule', () => {
  const code = codeOnly(schedulerSource)

  it('contains none of the accepted clock times', () => {
    // Every one of these lives in shared/today/routines.ts and nowhere else.
    for (const time of ['7, 30', '8)', '17, 30', '18, 30', '20, 30', '21, 30', '22, 30', '23, 30']) {
      expect(code, time).not.toContain(`at(${time}`)
    }
    // And no bare clock literals either.
    expect(code).not.toMatch(/\b(0?7:30|08:00|17:30|20:30|21:30|23:30)\b/)
  })

  it('defines no weekday-to-session mapping of its own', () => {
    for (const banned of [/'monday'/, /'tuesday'/, /'wednesday'/, /'thursday'/, /'friday'/]) {
      expect(code, String(banned)).not.toMatch(banned)
    }
  })

  it('derives what is due from the shared Today engine', () => {
    expect(code).toMatch(/from '\.\.\/\.\.\/shared\/notifications\/due'/)
    expect(code).toMatch(/from '\.\.\/\.\.\/shared\/today\/engine'/)
    expect(code).toMatch(/dueAt\(/)
  })
})

/* ------------------------------------------------------------------ */
/* 3. The one authoritative clock definition                           */
/* ------------------------------------------------------------------ */

describe('3. the routine is defined once', () => {
  it('holds the accepted times, in shared/ where both sides read them', () => {
    const code = codeOnly(routinesSource)
    // The gym slot, still exactly where it always was.
    expect(code).toMatch(/at\(20, 30\)/)
    expect(code).toMatch(/at\(21, 30\)/)
    // And the single weekday mapping.
    expect(code).toMatch(/sessionIdForWeekday/)
    expect(code).toMatch(/weekdaySessionIds/)
  })

  it('is reachable by the Worker without a copy', () => {
    // shared/ is outside src/, so the Worker imports the same file the React
    // app does rather than a duplicate.
    expect(routinesSource.length).toBeGreaterThan(0)
  })
})
