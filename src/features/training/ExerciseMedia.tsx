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
 * Holds a stable 16:9 box whatever the state, so the page never reflows as
 * media arrives or fails. Three visible states — skeleton, media, fallback —
 * and a failed load unmounts the image entirely rather than leaving the
 * browser's broken-image glyph on screen.
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

  // Keyed by url: a new source remounts with a clean loading state, so a
  // previous "ready" or "error" can never carry over. No reset effect needed.
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
  const reduceMotion = useReducedMotion()

  // A cached image can finish before React attaches onLoad, which would leave
  // the skeleton up forever. Only ever promotes to ready — failure stays the
  // job of onError.
  const captureCached = useCallback((node: HTMLImageElement | null) => {
    if (node?.complete && node.naturalWidth > 0) setState('ready')
  }, [])

  return (
    <Frame state={state} className={className}>
      {state !== 'error' && (
        <motion.img
          ref={captureCached}
          src={media.url}
          alt={media.alt}
          loading="lazy"
          decoding="async"
          onLoad={() => setState('ready')}
          onError={() => setState('error')}
          initial={{ opacity: 0 }}
          animate={{ opacity: state === 'ready' ? 1 : 0 }}
          transition={reduceMotion ? { duration: 0 } : tween.enter}
          className="absolute inset-0 size-full object-cover"
        />
      )}

      {state === 'loading' && <Skeleton />}
      {state === 'error' && <Fallback label="Media unavailable" />}
    </Frame>
  )
}

/** Stable, responsive 16:9 surface in the app's existing card language. */
function Frame({
  state,
  className,
  children,
}: {
  state: LoadState | 'empty'
  className?: string
  children: React.ReactNode
}) {
  return (
    <Card className={cn('relative aspect-video w-full overflow-hidden', className)}>
      {/* Card does not forward extra props, so the state marker lives here. */}
      <div
        data-media-state={state}
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
