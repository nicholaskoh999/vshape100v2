import { describe, expect, it, vi } from 'vitest'

import {
  audienceOf,
  base64UrlToBytes,
  bytesToBase64Url,
  encryptPayload,
  PUSH_TTL_SECONDS,
  sendPush,
  vapidAuthorization,
  type VapidConfig,
} from '../push/webPush'

/**
 * Round 14 — proof that the Web Push implementation is real.
 *
 * "Web Push" that produces plausible bytes nobody can decrypt is not a
 * feature, so the central test here does not assert a shape: it plays the part
 * of the browser. It generates a subscription key pair, hands the public half
 * to the encrypter, and then DECRYPTS the result with the private half,
 * following RFC 8291 in reverse. If the derivation, the HKDF info strings, the
 * nonce or the record framing were wrong, the AES-GCM tag would not verify and
 * this would throw.
 *
 * Everything uses the same SubtleCrypto surface the Workers runtime provides,
 * with no Node-only imports anywhere in the module under test.
 */

const utf8 = (value: string) => new TextEncoder().encode(value)

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const imported = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return new Uint8Array(await crypto.subtle.sign('HMAC', imported, data))
}

async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const prk = await hmac(salt, ikm)
  return (await hmac(prk, concat(info, new Uint8Array([1])))).slice(0, length)
}

/** A browser's push subscription: an ECDH key pair plus a 16-byte auth secret. */
async function fakeSubscription() {
  const keyPair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair
  const publicRaw = new Uint8Array((await crypto.subtle.exportKey('raw', keyPair.publicKey)) as ArrayBuffer)
  const auth = crypto.getRandomValues(new Uint8Array(16))

  return {
    keyPair,
    publicRaw,
    keys: { p256dh: bytesToBase64Url(publicRaw), auth: bytesToBase64Url(auth) },
    authBytes: auth,
  }
}

/** Undo `encryptPayload`, exactly as a user agent would. */
async function decrypt(
  body: Uint8Array,
  subscription: Awaited<ReturnType<typeof fakeSubscription>>,
): Promise<string> {
  const salt = body.slice(0, 16)
  const keyIdLength = body[20]
  const senderPublic = body.slice(21, 21 + keyIdLength)
  const ciphertext = body.slice(21 + keyIdLength)

  const senderKey = await crypto.subtle.importKey(
    'raw',
    senderPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  )
  type DeriveAlgorithm = Parameters<typeof crypto.subtle.deriveBits>[0]
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'ECDH', public: senderKey } as unknown as DeriveAlgorithm,
      subscription.keyPair.privateKey,
      256,
    ),
  )

  const keyInfo = concat(
    utf8('WebPush: info'),
    new Uint8Array([0]),
    subscription.publicRaw,
    senderPublic,
  )
  const ikm = await hkdf(subscription.authBytes, shared, keyInfo, 32)
  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12)

  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt'])
  const plaintext = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce, tagLength: 128 },
      aesKey,
      ciphertext,
    ),
  )

  // Strip the 0x02 final-record delimiter.
  return new TextDecoder().decode(plaintext.slice(0, plaintext.length - 1))
}

/** A throwaway VAPID key pair, in the storage format the Worker expects. */
async function fakeVapid(): Promise<VapidConfig & { verifyKey: CryptoKey }> {
  const keyPair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  const publicRaw = new Uint8Array((await crypto.subtle.exportKey('raw', keyPair.publicKey)) as ArrayBuffer)
  const jwk = (await crypto.subtle.exportKey('jwk', keyPair.privateKey)) as JsonWebKey

  return {
    publicKey: bytesToBase64Url(publicRaw),
    privateKey: jwk.d as string,
    subject: 'mailto:reminders@example.com',
    verifyKey: keyPair.publicKey,
  }
}

/* ------------------------------------------------------------------ */
/* 1. The encryption really is Web Push encryption                     */
/* ------------------------------------------------------------------ */

describe('1. aes128gcm payload encryption', () => {
  it('produces a body the subscribed browser can decrypt', async () => {
    const subscription = await fakeSubscription()
    const payload = JSON.stringify({ title: 'Gym training', body: 'Gym training' })

    const body = await encryptPayload(payload, subscription.keys)

    // The real proof: round-trips through an independent RFC 8291 decrypt.
    await expect(decrypt(body, subscription)).resolves.toBe(payload)
  })

  it('frames the record exactly as RFC 8188 requires', async () => {
    const subscription = await fakeSubscription()
    const body = await encryptPayload('x', subscription.keys)

    // salt(16) | record size(4) | key id length(1) | key id(65) | ciphertext
    expect(body.length).toBeGreaterThan(16 + 4 + 1 + 65)
    const recordSize = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0)
    expect(recordSize).toBe(4096)
    expect(body[20]).toBe(65)
    // Uncompressed P-256 point.
    expect(body[21]).toBe(0x04)
  })

  it('gives a different body every time, even for identical input', async () => {
    const subscription = await fakeSubscription()
    const a = await encryptPayload('same', subscription.keys)
    const b = await encryptPayload('same', subscription.keys)

    // Fresh salt and ephemeral key per message: no nonce is ever reused.
    expect(bytesToBase64Url(a)).not.toBe(bytesToBase64Url(b))
    // Both still decrypt.
    await expect(decrypt(a, subscription)).resolves.toBe('same')
    await expect(decrypt(b, subscription)).resolves.toBe('same')
  })

  it('cannot be decrypted by a different subscription', async () => {
    const mine = await fakeSubscription()
    const theirs = await fakeSubscription()
    const body = await encryptPayload('private', mine.keys)

    // The key info binds both public keys, so the derivation does not transfer.
    await expect(decrypt(body, theirs)).rejects.toBeDefined()
  })

  it('round-trips a payload with non-ASCII content', async () => {
    const subscription = await fakeSubscription()
    const payload = JSON.stringify({ body: 'Cook dinner + shower · 17:30' })
    const body = await encryptPayload(payload, subscription.keys)
    await expect(decrypt(body, subscription)).resolves.toBe(payload)
  })
})

/* ------------------------------------------------------------------ */
/* 2. VAPID                                                            */
/* ------------------------------------------------------------------ */

describe('2. VAPID authorization', () => {
  it('signs a JWT the push service can verify with the public key', async () => {
    const vapid = await fakeVapid()
    const header = await vapidAuthorization(
      'https://fcm.googleapis.com/fcm/send/abc123',
      vapid,
      1_800_000_000_000,
    )

    expect(header.startsWith('vapid t=')).toBe(true)
    const jwt = header.slice('vapid t='.length, header.indexOf(', k='))
    const [encHeader, encClaims, encSignature] = jwt.split('.')

    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      vapid.verifyKey,
      base64UrlToBytes(encSignature),
      utf8(`${encHeader}.${encClaims}`),
    )
    expect(valid).toBe(true)
  })

  it('claims the endpoint origin as the audience, and nothing wider', async () => {
    const vapid = await fakeVapid()
    const header = await vapidAuthorization(
      'https://updates.push.services.mozilla.com/wpush/v2/xyz',
      vapid,
      1_800_000_000_000,
    )
    const jwt = header.slice('vapid t='.length, header.indexOf(', k='))
    const claims = JSON.parse(new TextDecoder().decode(base64UrlToBytes(jwt.split('.')[1])))

    expect(claims.aud).toBe('https://updates.push.services.mozilla.com')
    expect(claims.sub).toBe('mailto:reminders@example.com')
  })

  it('expires within the 24 hours RFC 8292 allows', async () => {
    const vapid = await fakeVapid()
    const now = 1_800_000_000_000
    const header = await vapidAuthorization('https://push.example/x', vapid, now)
    const jwt = header.slice('vapid t='.length, header.indexOf(', k='))
    const claims = JSON.parse(new TextDecoder().decode(base64UrlToBytes(jwt.split('.')[1])))

    const seconds = claims.exp - Math.floor(now / 1000)
    expect(seconds).toBeGreaterThan(0)
    expect(seconds).toBeLessThanOrEqual(24 * 60 * 60)
  })

  it('advertises the public key and never the private one', async () => {
    const vapid = await fakeVapid()
    const header = await vapidAuthorization('https://push.example/x', vapid, 1_800_000_000_000)

    expect(header).toContain(`k=${vapid.publicKey}`)
    expect(header).not.toContain(vapid.privateKey)
  })

  it('reads the audience from any endpoint, and refuses a non-URL', () => {
    expect(audienceOf('https://push.example/path?x=1')).toBe('https://push.example')
    expect(audienceOf('not a url')).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* 3. Sending                                                          */
/* ------------------------------------------------------------------ */

describe('3. sendPush', () => {
  async function target() {
    const subscription = await fakeSubscription()
    return { endpoint: 'https://push.example/send/abc', ...subscription.keys }
  }

  it('POSTs the encrypted body with the required Web Push headers', async () => {
    const vapid = await fakeVapid()
    const fetcher = vi.fn(async () => new Response(null, { status: 201 }))

    const outcome = await sendPush(await target(), '{"a":1}', vapid, 1_800_000_000_000, fetcher)

    expect(outcome).toEqual({ status: 'sent' })
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://push.example/send/abc')
    expect(init.method).toBe('POST')

    const headers = init.headers as Record<string, string>
    expect(headers['Content-Encoding']).toBe('aes128gcm')
    expect(headers['Content-Type']).toBe('application/octet-stream')
    expect(headers.Authorization.startsWith('vapid t=')).toBe(true)
    // Short TTL: an exact-time reminder must not arrive hours late.
    expect(headers.TTL).toBe(String(PUSH_TTL_SECONDS))
    expect(Number(headers.TTL)).toBeLessThanOrEqual(900)
    expect((init.body as Uint8Array).byteLength).toBeGreaterThan(86)
  })

  it('never puts the private key or the payload in the request', async () => {
    const vapid = await fakeVapid()
    const fetcher = vi.fn(async () => new Response(null, { status: 201 }))
    await sendPush(await target(), 'SECRET-PLAINTEXT', vapid, 1_800_000_000_000, fetcher)

    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    const serialised = JSON.stringify(init.headers) + bytesToBase64Url(init.body as Uint8Array)
    expect(serialised).not.toContain(vapid.privateKey)
    // The payload travels encrypted, never in the clear.
    expect(serialised).not.toContain('SECRET-PLAINTEXT')
  })

  it('reports a gone subscription as expired, so only that one is retired', async () => {
    const vapid = await fakeVapid()
    for (const status of [404, 410]) {
      const fetcher = vi.fn(async () => new Response(null, { status }))
      const outcome = await sendPush(await target(), '{}', vapid, 1_800_000_000_000, fetcher)
      expect(outcome, String(status)).toEqual({ status: 'expired', httpStatus: status })
    }
  })

  it('reports a transient failure without discarding the subscription', async () => {
    const vapid = await fakeVapid()
    const fetcher = vi.fn(async () => new Response(null, { status: 500 }))
    const outcome = await sendPush(await target(), '{}', vapid, 1_800_000_000_000, fetcher)
    expect(outcome).toEqual({ status: 'failed', httpStatus: 500 })
  })

  it('survives a network error without leaking anything', async () => {
    const vapid = await fakeVapid()
    const fetcher = vi.fn(async () => {
      throw new Error('connection reset by peer at endpoint https://push.example/send/abc')
    })
    const outcome = await sendPush(await target(), '{}', vapid, 1_800_000_000_000, fetcher)
    // The thrown message is swallowed: it can carry endpoints or key material.
    expect(outcome).toEqual({ status: 'failed', httpStatus: null })
  })

  it('fails closed on an unusable subscription rather than throwing', async () => {
    const vapid = await fakeVapid()
    const fetcher = vi.fn(async () => new Response(null, { status: 201 }))
    const outcome = await sendPush(
      { endpoint: 'https://push.example/x', p256dh: 'not-a-key', auth: 'nope' },
      '{}',
      vapid,
      1_800_000_000_000,
      fetcher,
    )

    expect(outcome).toEqual({ status: 'failed', httpStatus: null })
    expect(fetcher).not.toHaveBeenCalled()
  })
})
