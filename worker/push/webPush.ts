/**
 * Web Push, implemented against the standards with nothing but Web Crypto.
 *
 *   RFC 8291  Message Encryption for Web Push  (aes128gcm)
 *   RFC 8188  Encrypted Content-Encoding
 *   RFC 8292  VAPID  (ES256 JWT)
 *
 * ## Why no library
 *
 * The usual Node `web-push` package reaches for `crypto`, `https` and Buffer,
 * none of which are Workers-native, and enabling broad Node compatibility to
 * force it in would be adding a runtime shim to avoid writing ~150 lines. Every
 * primitive Web Push needs — ECDH P-256, HKDF via HMAC-SHA256, AES-128-GCM and
 * ECDSA P-256 signing — is already in the Workers runtime as SubtleCrypto. So
 * there is no dependency here, and therefore no compatibility question: if the
 * Worker builds, this runs.
 *
 * ## What never leaves this module
 *
 * The VAPID private key is imported, used to sign, and never returned, logged
 * or embedded in any error. Subscription endpoints and keys are likewise never
 * logged — callers get an outcome, not the material.
 */

/* ------------------------------------------------------------------ */
/* base64url                                                           */
/* ------------------------------------------------------------------ */

export function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

const utf8 = (value: string) => new TextEncoder().encode(value)

/* ------------------------------------------------------------------ */
/* HKDF, the RFC 8291 way                                              */
/* ------------------------------------------------------------------ */

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const imported = await crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return new Uint8Array(await crypto.subtle.sign('HMAC', imported, data as BufferSource))
}

/**
 * One-block HKDF: extract with `salt`, expand with `info`, truncate.
 *
 * Web Push never needs more than 32 bytes of output, so a single expansion
 * round with the `0x01` counter is the whole of it.
 */
async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const prk = await hmac(salt, ikm)
  const okm = await hmac(prk, concat(info, new Uint8Array([1])))
  return okm.slice(0, length)
}

/* ------------------------------------------------------------------ */
/* Payload encryption                                                  */
/* ------------------------------------------------------------------ */

/** The public half of a subscription, as the browser reported it. */
export type PushKeys = {
  /** Uncompressed P-256 point, 65 bytes, base64url. */
  p256dh: string
  /** 16-byte auth secret, base64url. */
  auth: string
}

/** Record size. One record is plenty: payloads here are a few hundred bytes. */
const RECORD_SIZE = 4096

/**
 * Encrypt a payload for one subscription, producing an aes128gcm body.
 *
 * Body layout (RFC 8188 header + one record):
 *   salt(16) | record size(4, big-endian) | key id length(1) | key id(65) | ciphertext
 */
export async function encryptPayload(
  payload: string,
  keys: PushKeys,
  // Injectable ONLY so a test can pin the randomness and assert the exact
  // bytes. Production always uses real random values.
  entropy?: { salt: Uint8Array; keyPair: CryptoKeyPair },
): Promise<Uint8Array> {
  const userPublic = base64UrlToBytes(keys.p256dh)
  const authSecret = base64UrlToBytes(keys.auth)

  const salt = entropy?.salt ?? crypto.getRandomValues(new Uint8Array(16))
  const local =
    entropy?.keyPair ??
    ((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveBits',
    ])) as CryptoKeyPair)

  // `exportKey` is typed as ArrayBuffer | JsonWebKey; the 'raw' overload
  // always returns the buffer.
  const localPublic = new Uint8Array(
    (await crypto.subtle.exportKey('raw', local.publicKey)) as ArrayBuffer,
  )

  const userKey = await crypto.subtle.importKey(
    'raw',
    userPublic as BufferSource,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  )

  // The Workers type definitions spell the peer key `$public`; the runtime
  // and the Web Crypto standard both expect `public`. Passing the standard
  // name through a cast keeps the call correct at runtime.
  type DeriveAlgorithm = Parameters<typeof crypto.subtle.deriveBits>[0]
  const ecdh = { name: 'ECDH', public: userKey } as unknown as DeriveAlgorithm
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits(ecdh, local.privateKey, 256),
  )

  // RFC 8291 §3.4: the auth secret salts the shared secret, and the key info
  // binds BOTH public keys so a derived key cannot be replayed at another
  // subscription.
  const keyInfo = concat(utf8('WebPush: info'), new Uint8Array([0]), userPublic, localPublic)
  const ikm = await hkdf(authSecret, shared, keyInfo, 32)

  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12)

  const aesKey = await crypto.subtle.importKey('raw', cek as BufferSource, 'AES-GCM', false, [
    'encrypt',
  ])
  // 0x02 marks the final record; there is only one.
  const plaintext = concat(utf8(payload), new Uint8Array([2]))
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce as BufferSource, tagLength: 128 },
      aesKey,
      plaintext as BufferSource,
    ),
  )

  const recordSize = new Uint8Array(4)
  new DataView(recordSize.buffer).setUint32(0, RECORD_SIZE)

  return concat(
    salt,
    recordSize,
    new Uint8Array([localPublic.length]),
    localPublic,
    ciphertext,
  )
}

/* ------------------------------------------------------------------ */
/* VAPID                                                               */
/* ------------------------------------------------------------------ */

export type VapidConfig = {
  /** Uncompressed P-256 point, 65 bytes, base64url. Safe to send to browsers. */
  publicKey: string
  /** Raw 32-byte scalar, base64url. SECRET — never returned or logged. */
  privateKey: string
  /** `mailto:` or `https:` contact, per RFC 8292. */
  subject: string
}

/** The origin a push service expects in the JWT audience. */
export function audienceOf(endpoint: string): string | null {
  try {
    return new URL(endpoint).origin
  } catch {
    return null
  }
}

/**
 * Import the VAPID signing key.
 *
 * The private key is stored as the raw 32-byte scalar, so the public point is
 * split out of `publicKey` to complete the JWK. `d` never leaves this call.
 */
async function importSigningKey(config: VapidConfig): Promise<CryptoKey> {
  const publicBytes = base64UrlToBytes(config.publicKey)
  if (publicBytes.length !== 65 || publicBytes[0] !== 0x04) {
    throw new Error('vapid public key must be a 65-byte uncompressed P-256 point')
  }

  return crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      x: bytesToBase64Url(publicBytes.slice(1, 33)),
      y: bytesToBase64Url(publicBytes.slice(33, 65)),
      d: config.privateKey,
      ext: false,
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
}

/**
 * The `Authorization: vapid` header value for one push endpoint.
 *
 * Web Crypto's ECDSA output is already the raw r||s pair JWS ES256 wants, so
 * no DER unwrapping is needed.
 */
export async function vapidAuthorization(
  endpoint: string,
  config: VapidConfig,
  now: number,
): Promise<string> {
  const audience = audienceOf(endpoint)
  if (!audience) throw new Error('push endpoint is not a URL')

  const header = bytesToBase64Url(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = bytesToBase64Url(
    utf8(
      JSON.stringify({
        aud: audience,
        // Twelve hours: comfortably inside the 24h maximum RFC 8292 allows.
        exp: Math.floor(now / 1000) + 12 * 60 * 60,
        sub: config.subject,
      }),
    ),
  )

  const signingInput = utf8(`${header}.${claims}`)
  const key = await importSigningKey(config)
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      signingInput as BufferSource,
    ),
  )

  const jwt = `${header}.${claims}.${bytesToBase64Url(signature)}`
  return `vapid t=${jwt}, k=${config.publicKey}`
}

/* ------------------------------------------------------------------ */
/* Sending                                                             */
/* ------------------------------------------------------------------ */

export type PushTarget = { endpoint: string } & PushKeys

/**
 * What happened, in terms precise enough to decide whether a retry is SAFE.
 *
 *   sent       the push service accepted it. Never send again.
 *   expired    the subscription is gone (404/410). Retire THIS one only.
 *   retryable  the service explicitly refused it — 408/429/5xx. We can PROVE
 *              it was not accepted, so the same trigger minute may be tried
 *              again without any risk of a duplicate.
 *   rejected   the service refused it permanently (a 4xx we caused). Not
 *              accepted, but retrying the identical request cannot help.
 *   ambiguous  the request never produced an answer — a network error, an
 *              abort, a timeout. It may or may not have reached the service,
 *              so it is NEVER retried: a second buzz for one moment is worse
 *              than a missed one.
 */
export type PushOutcome =
  | { status: 'sent' }
  | { status: 'expired'; httpStatus: number }
  | { status: 'retryable'; httpStatus: number }
  | { status: 'rejected'; httpStatus: number }
  | { status: 'ambiguous' }

/**
 * Statuses a push service uses to say "I did not take this, try later".
 *
 * Each one is a definite refusal, which is what makes a retry safe: the
 * message did not enter the queue.
 */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

/**
 * Time-to-live, in seconds.
 *
 * These are exact-time reminders: a 20:30 reminder arriving at 22:00 is not a
 * late reminder, it is noise. Ten minutes is long enough to ride out a brief
 * push-service problem and short enough that nothing stale ever surfaces.
 */
export const PUSH_TTL_SECONDS = 600

export async function sendPush(
  target: PushTarget,
  payload: string,
  config: VapidConfig,
  now: number,
  fetcher: typeof fetch = fetch,
): Promise<PushOutcome> {
  let body: Uint8Array
  let authorization: string
  try {
    body = await encryptPayload(payload, target)
    authorization = await vapidAuthorization(target.endpoint, config, now)
  } catch {
    // Never surface the underlying error: it can carry key material. Nothing
    // was sent, so this is a definite non-delivery rather than an ambiguous
    // one — but it is also not something a retry would fix.
    return { status: 'rejected', httpStatus: 0 }
  }

  let response: Response
  try {
    response = await fetcher(target.endpoint, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(PUSH_TTL_SECONDS),
        Urgency: 'normal',
      },
      body: body as BodyInit,
    })
  } catch {
    // The request threw. It may have reached the push service before failing,
    // so we cannot prove it was not accepted and must never retry it.
    return { status: 'ambiguous' }
  }

  if (response.ok) return { status: 'sent' }
  // 404/410 are the push services' way of saying this subscription is gone.
  if (response.status === 404 || response.status === 410) {
    return { status: 'expired', httpStatus: response.status }
  }
  if (isRetryableStatus(response.status)) {
    return { status: 'retryable', httpStatus: response.status }
  }
  return { status: 'rejected', httpStatus: response.status }
}
