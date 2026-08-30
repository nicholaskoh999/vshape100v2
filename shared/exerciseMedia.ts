/**
 * Canonical exercise media contract and validation.
 *
 * Shared by the Worker (which decides what may be stored) and the React app
 * (which must not offer to save something the server will reject), following
 * the same pattern as shared/redirect.ts. One definition, so the editor's
 * "Save" button and the API can never disagree about what is valid.
 *
 * A stored URL ends up in an `<img src>`, so the scheme allowlist here is a
 * real safety control, not tidiness.
 */

export type ExerciseMediaKind = 'gif' | 'image'

export const MEDIA_KINDS: readonly ExerciseMediaKind[] = ['gif', 'image']

/** Longest exercise slug accepted. Real slugs are ~24 characters. */
export const MAX_EXERCISE_ID_LENGTH = 64
/** Longest media URL accepted. */
export const MAX_MEDIA_URL_LENGTH = 2048
/** Longest alt text accepted. */
export const MAX_MEDIA_ALT_LENGTH = 160

/**
 * Stable lowercase slug, e.g. `lat-pulldown`. This validates the *shape* of
 * an identity, not membership of the exercise catalog, which stays the
 * client's single source of truth (the same split Today applies to item ids).
 */
const EXERCISE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** The only schemes media may be fetched over. */
const ALLOWED_PROTOCOLS = ['http:', 'https:']

/** Validate an exercise slug, returning it or null. */
export function parseExerciseId(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  if (raw.length === 0 || raw.length > MAX_EXERCISE_ID_LENGTH) return null
  return EXERCISE_ID_PATTERN.test(raw) ? raw : null
}

export function isMediaKind(value: unknown): value is ExerciseMediaKind {
  return typeof value === 'string' && (MEDIA_KINDS as readonly string[]).includes(value)
}

/**
 * Absolute web URL only.
 *
 * `javascript:`, `data:`, `file:`, `blob:` and every other scheme are
 * rejected. Relative values are rejected too: `new URL` cannot resolve them
 * without a base, and a stored record has to mean the same thing wherever it
 * is read.
 */
export function isSafeMediaUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_MEDIA_URL_LENGTH) return false

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return false
  }
  if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) return false
  // Defensive: a URL with no host could never load. `new URL` already rejects
  // `https://` outright, so this is a belt-and-braces check rather than the
  // main control — the scheme allowlist above is that.
  return parsed.hostname.length > 0
}

/** Alt text is required and meaningful: media without a description is not stored. */
export function isUsefulAlt(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= MAX_MEDIA_ALT_LENGTH
}

/** The validated body of a save, without any identity. */
export type ExerciseMediaInput = {
  kind: ExerciseMediaKind
  url: string
  alt: string
}

/** Which field of a save was rejected. Never echoes the offending value. */
export type MediaField = 'kind' | 'url' | 'alt' | 'body'

export type ParsedMedia =
  | { ok: true; value: ExerciseMediaInput }
  | { ok: false; field: MediaField }

/** Validate a decoded request body / editor draft into a storable input. */
export function parseMediaInput(body: unknown): ParsedMedia {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, field: 'body' }
  }

  const raw = body as Record<string, unknown>

  if (!isMediaKind(raw.kind)) return { ok: false, field: 'kind' }
  if (!isSafeMediaUrl(raw.url)) return { ok: false, field: 'url' }
  if (!isUsefulAlt(raw.alt)) return { ok: false, field: 'alt' }

  return {
    ok: true,
    value: { kind: raw.kind, url: raw.url.trim(), alt: raw.alt.trim() },
  }
}
