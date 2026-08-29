import { useEffect, useState } from 'react'

const MINUTE_MS = 60_000
/** Fire just after the boundary so the new minute has definitely landed. */
const SETTLE_MS = 50

function sameMinute(a: Date, b: Date) {
  return Math.floor(a.getTime() / MINUTE_MS) === Math.floor(b.getTime() / MINUTE_MS)
}

/**
 * The one place the app reads the wall clock.
 *
 * Every routine boundary is minute-aligned, so re-reading the clock on each
 * local minute boundary is enough for the page to recompute exactly when a
 * status changes — 20:29 → 20:30 flips Gym training to NOW with no refresh.
 * Timezone offsets are whole minutes, so `Date.now() % 60_000` is the offset
 * into the current local minute everywhere.
 *
 * The returned `Date` is referentially stable within a minute, so the pure
 * engine downstream only re-runs when something can actually have changed.
 * Domain logic takes `now` as an argument and never calls this hook, which is
 * what keeps the engine tests deterministic.
 */
export function useTodayClock(): Date {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined

    // Background tabs throttle timers and a suspended device stops them
    // entirely, so re-sync whenever the page becomes interesting again.
    const sync = () => {
      setNow((previous) => {
        const next = new Date()
        return sameMinute(previous, next) ? previous : next
      })
    }

    const schedule = () => {
      timer = setTimeout(
        () => {
          sync()
          schedule()
        },
        MINUTE_MS - (Date.now() % MINUTE_MS) + SETTLE_MS,
      )
    }

    schedule()
    document.addEventListener('visibilitychange', sync)
    window.addEventListener('focus', sync)

    return () => {
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', sync)
      window.removeEventListener('focus', sync)
    }
  }, [])

  return now
}
