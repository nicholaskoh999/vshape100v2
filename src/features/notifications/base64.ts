/**
 * base64url decoding for the browser.
 *
 * `PushManager.subscribe` wants the VAPID public key as raw bytes, and the
 * server sends it base64url. Kept separate from pushClient so a test can use
 * it without touching the Push APIs.
 */

export function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}
