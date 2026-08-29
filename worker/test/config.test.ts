import { describe, expect, it } from 'vitest'

import {
  ConfigError,
  isAllowedEmail,
  loadConfig,
  parseAllowedEmails,
  type Env,
} from '../auth/config'

const baseEnv = {
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  ALLOWED_GOOGLE_EMAILS: 'person@example.com',
} as unknown as Env

describe('allowlist', () => {
  it('parses and normalises a comma-separated list', () => {
    expect(parseAllowedEmails(' One@Example.com , two@example.com ,')).toEqual([
      'one@example.com',
      'two@example.com',
    ])
  })

  it('treats an unset allowlist as empty', () => {
    expect(parseAllowedEmails(undefined)).toEqual([])
    expect(parseAllowedEmails('')).toEqual([])
  })

  it('accepts an allowlisted identity regardless of case', () => {
    expect(isAllowedEmail('Person@Example.com', ['person@example.com'])).toBe(true)
  })

  it('rejects an identity that is not listed', () => {
    expect(isAllowedEmail('someone@else.com', ['person@example.com'])).toBe(false)
  })

  it('rejects everything when the allowlist is empty', () => {
    // Fail closed: an unconfigured allowlist must not mean "allow anyone".
    expect(isAllowedEmail('person@example.com', [])).toBe(false)
  })
})

describe('loadConfig', () => {
  const url = new URL('http://localhost:5173/api/auth/google/start')

  it('derives the callback URI from APP_ORIGIN', () => {
    const config = loadConfig(
      { ...baseEnv, APP_ORIGIN: 'https://vshapev2.nkmwei.de' } as Env,
      url,
    )
    expect(config.redirectUri).toBe('https://vshapev2.nkmwei.de/api/auth/google/callback')
    expect(config.secureCookies).toBe(true)
  })

  it('falls back to the request origin for local development', () => {
    const config = loadConfig(baseEnv, url)
    expect(config.redirectUri).toBe('http://localhost:5173/api/auth/google/callback')
    expect(config.secureCookies).toBe(false)
  })

  it('refuses to run without Google credentials', () => {
    expect(() => loadConfig({ ...baseEnv, GOOGLE_CLIENT_ID: '' } as Env, url)).toThrow(
      ConfigError,
    )
    expect(() => loadConfig({ ...baseEnv, GOOGLE_CLIENT_SECRET: '' } as Env, url)).toThrow(
      ConfigError,
    )
  })

  it('refuses to run without an allowlist', () => {
    expect(() => loadConfig({ ...baseEnv, ALLOWED_GOOGLE_EMAILS: '' } as Env, url)).toThrow(
      ConfigError,
    )
  })
})
