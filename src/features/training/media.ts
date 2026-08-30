/**
 * Exercise media contract.
 *
 * Round 06 established how exercise media is *rendered*. Round 07 adds where
 * a source comes from: one canonical record per exercise identity, saved by
 * the account and loaded from D1. An exercise with no record still resolves
 * to the no-media fallback.
 *
 * `kind` is carried even though GIFs and images both go through the browser
 * image pipeline today. Keeping the distinction typed is what lets a later
 * round add WebP/MP4/WebM — a video kind will branch on it — without
 * reshaping every call site.
 */

// The kind union lives in shared/exerciseMedia.ts, which the Worker validates
// against too — one definition, so client and server cannot drift apart on
// what a media kind is.
export type { ExerciseMediaKind } from '@shared/exerciseMedia'
import type { ExerciseMediaKind } from '@shared/exerciseMedia'

export type ExerciseMediaSource = {
  kind: ExerciseMediaKind
  /** Absolute or app-relative URL of the media file. */
  url: string
  /** What the media shows, for anyone who cannot see it. Never decorative. */
  alt: string
}

/** Kinds the current renderer serves through `<img>`. */
export const IMAGE_KINDS: readonly ExerciseMediaKind[] = ['gif', 'image']

export function isImageKind(kind: ExerciseMediaKind): boolean {
  return IMAGE_KINDS.includes(kind)
}
