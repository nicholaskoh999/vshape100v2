/**
 * Exercise media contract.
 *
 * Round 06 establishes how exercise media is *rendered*; the real media
 * library is not populated yet, so nothing in the app supplies a source and
 * every exercise currently resolves to the no-media fallback.
 *
 * `kind` is carried even though GIFs and images both go through the browser
 * image pipeline today. Keeping the distinction typed is what lets a later
 * round add WebP/MP4/WebM — a video kind will branch on it — without
 * reshaping every call site.
 */

export type ExerciseMediaKind = 'gif' | 'image'

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
