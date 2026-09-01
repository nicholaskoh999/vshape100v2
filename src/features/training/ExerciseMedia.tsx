import { ImageOff } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { useCallback, useState } from 'react'

import { Card } from '@/components/ui/Card'
import { tween } from '@/design/motion'
import { cn } from '@/lib/utils'
import type { ExerciseMediaSource } from './media'

/**
 * The one place exercise media is rendered.
 *
 * Every consumer goes through this component — Exercise Detail and the canonical
 * media editor's preview — so the fit rule below is a shared contract rather
 * than a per-page style. A page-local crop fix would have left the other
 * surface still cropping the same file.
 *
 * THE FIT RULE (Round 19.1).
 *
 * The frame used to be a fixed 16:9 box with `object-cover`, which CROPS. A
 * square demonstration — the reported Incline DB Press GIF is exactly this —
 * lost its top and bottom, cutting the bench and the lifter's arms out of the
 * very demonstration the media exists to show.
 *
 * Now: the media is rendered `object-contain` and the frame ADOPTS THE MEDIA'S
 * OWN ASPECT RATIO once it is known. Contain alone would have been enough to
 * stop the cropping, but it would have letterboxed a square GIF inside a 16:9
 * box and rendered it far smaller than the space allows — visible in full, yet
 * harder to actually see. Taking the intrinsic ratio means the box fits the
 * media instead of the media fitting the box.
 *
 * `object-contain` is kept regardless, so nothing can crop or stretch even in
 * the moments before the ratio is known, or when the height cap below clamps
 * the box away from the exact intrinsic ratio.
 *
 * Bounds, so "show all of it" never becomes "show an enormous one":
 *   - width is the caller's column, never wider
 *   - height is capped, so a tall portrait clip cannot run down the page on a
 *     wide desktop column
 *   - the placeholder states keep the familiar 16:9 reservation, so the page
 *     does not sit at an odd height before anything has loaded
 */
type LoadState = 'loading' | 'ready' | 'error'

/**
 * How the *source* was obtained, when the caller resolves it asynchronously.
 *
 * Round 06 only had to render a source it was handed. Round 07 fetches the
 * canonical record from D1 first, and "we have not heard back yet" is not the
 * same thing as "this exercise has no media" — showing the permanent
 * "Media coming soon" during a load would state something untrue. Callers
 * that already have their source simply omit this and nothing changes.
 */
export type ExerciseMediaResolution = 'loading' | 'ready' | 'error'

/** The reservation used before the media's own ratio is known. */
export const DEFAULT_MEDIA_RATIO = 16 / 9

export function ExerciseMedia({
  media,
  resolution = 'ready',
  className,
}: {
  media: ExerciseMediaSource | null | undefined
  resolution?: ExerciseMediaResolution
  className?: string
}) {
  if (resolution === 'loading') {
    return (
      <Frame state="loading" className={className}>
        <Skeleton />
        <span className="sr-only">Loading current media</span>
      </Frame>
    )
  }

  if (resolution === 'error') {
    return (
      <Frame state="error" className={className}>
        <Fallback label="Media unavailable" />
      </Frame>
    )
  }

  if (!media) {
    return (
      <Frame state="empty" className={className}>
        <Fallback label="Media coming soon" />
      </Frame>
    )
  }

  // Keyed by url: a new source remounts with a clean loading state AND a clean
  // ratio, so a previous file's shape can never be applied to this one.
  return <LoadedMedia key={media.url} media={media} className={className} />
}

function LoadedMedia({
  media,
  className,
}: {
  media: ExerciseMediaSource
  className?: string
}) {
  const [state, setState] = useState<LoadState>('loading')
  /** width / height, from the file itself. Null until the browser knows. */
  const [ratio, setRatio] = useState<number | null>(null)
  const reduceMotion = useReducedMotion()

  /** Read the media's own shape. Ignores the 0×0 a failed decode reports. */
  const adopt = useCallback((node: HTMLImageElement) => {
    if (node.naturalWidth > 0 && node.naturalHeight > 0) {
      setRatio(node.naturalWidth / node.naturalHeight)
    }
  }, [])

  // A cached image can finish before React attaches onLoad, which would leave
  // the skeleton up forever. Only ever promotes to ready — failure stays the
  // job of onError.
  const captureCached = useCallback(
    (node: HTMLImageElement | null) => {
      if (node?.complete && node.naturalWidth > 0) {
        adopt(node)
        setState('ready')
      }
    },
    [adopt],
  )

  return (
    <Frame
      state={state}
      className={className}
      // Only once ready: a failed load falls back to the reservation rather
      // than to whatever shape a broken decode reported.
      ratio={state === 'ready' ? ratio : null}
    >
      {state !== 'error' && (
        <motion.img
          ref={captureCached}
          src={media.url}
          alt={media.alt}
          loading="lazy"
          decoding="async"
          onLoad={(event) => {
            adopt(event.currentTarget)
            setState('ready')
          }}
          onError={() => setState('error')}
          initial={{ opacity: 0 }}
          animate={{ opacity: state === 'ready' ? 1 : 0 }}
          transition={reduceMotion ? { duration: 0 } : tween.enter}
          // contain, never cover: the whole demonstration, never a crop, and
          // never stretched to fill a box it does not match.
          className="absolute inset-0 size-full object-contain"
        />
      )}

      {state === 'loading' && <Skeleton />}
      {state === 'error' && <Fallback label="Media unavailable" />}
    </Frame>
  )
}

/**
 * The media surface, in the app's existing card language.
 *
 * Width always comes from the caller's column. Height comes from the ratio, and
 * is capped: `max-h-[70svh]` keeps a portrait clip inside the viewport on a
 * phone, and the px cap stops a wide desktop column from producing something
 * absurdly tall. When the cap bites, the box is simply shorter than the exact
 * ratio and `object-contain` letterboxes inside it — still complete, still
 * undistorted.
 */
function Frame({
  state,
  className,
  ratio,
  children,
}: {
  state: LoadState | 'empty'
  className?: string
  ratio?: number | null
  children: React.ReactNode
}) {
  const applied = ratio && Number.isFinite(ratio) && ratio > 0 ? ratio : DEFAULT_MEDIA_RATIO

  return (
    <Card
      className={cn(
        'relative w-full overflow-hidden',
        // The cap. Both bounds are needed: svh for phones, px for wide desktop.
        'max-h-[70svh] sm:max-h-[520px]',
        className,
      )}
      style={{ aspectRatio: String(applied) }}
    >
      {/* Card does not forward extra props, so the markers live here. */}
      <div
        data-media-state={state}
        data-media-fit="contain"
        data-media-ratio={applied.toFixed(4)}
        className="absolute inset-0 grid place-items-center"
      >
        {children}
      </div>
    </Card>
  )
}

function Skeleton() {
  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 animate-pulse bg-surface-raised"
    />
  )
}

function Fallback({ label }: { label: string }) {
  return (
    <div className="relative flex flex-col items-center gap-2 text-ink-faint">
      <ImageOff className="size-7" aria-hidden="true" />
      <p className="text-[13px] font-semibold">{label}</p>
    </div>
  )
}
