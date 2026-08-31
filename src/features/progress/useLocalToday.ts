import { useEffect, useState } from "react";

import { localWorkoutDate } from "@/features/training/workoutPlan";

/**
 * The device's own calendar date, kept current while the page stays mounted.
 *
 * Reading it once at mount is what production caught: a Progress tab opened on
 * 31 August still offered 31 August as Today after Kuala Lumpur had crossed
 * into 1 September, and only a reload corrected it. The server was never at
 * risk — it validates against the request's own zone — but "the date field
 * defaults to Today" stops being true the moment the clock moves past
 * midnight, and a tab left open overnight is the ordinary case, not an exotic
 * one.
 *
 * ## Why a timer and not a poll
 *
 * The date changes at exactly one predictable instant, so this waits for that
 * instant rather than asking the clock what it is every few seconds. One
 * timeout is armed for the next local midnight; when it fires the date is
 * recomputed and the next one is armed.
 *
 * ## Why that timer is not enough on its own
 *
 * A backgrounded or sleeping tab does not get its timers on time — a laptop
 * closed at 23:00 and opened at 09:00 may fire that timeout hours late, or
 * effectively not at all. So the date is also resynchronised whenever the tab
 * becomes visible or regains focus. Both paths recompute from the real clock,
 * which makes a late timer harmless rather than something to compensate for.
 */

/** Milliseconds until the next local midnight, with a small guard. */
export function msUntilNextLocalMidnight(now: Date): number {
  // Built from local calendar parts, so it is midnight where the user is.
  // Adding a day through the Date constructor also carries month, year and
  // any daylight-saving shift correctly.
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  // Land just past the boundary rather than exactly on it: firing a
  // millisecond early would recompute the SAME date and arm a zero-length
  // timer, which is a spin rather than a wait.
  const delay = next.getTime() - now.getTime() + 250;
  // A clock that has been moved backwards could produce a negative or absurd
  // delay. Clamp into a sane band; the visibility resync covers the rest.
  return Math.min(Math.max(delay, 250), 25 * 60 * 60 * 1000);
}

export function useLocalToday(): string {
  const [today, setToday] = useState(() => localWorkoutDate());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    /** Recompute from the real clock, then arm the next wait. */
    function sync() {
      // Setting the same string is a no-op for React, so an early or repeated
      // sync cannot cause a re-render.
      setToday((current) => {
        const now = localWorkoutDate();
        return current === now ? current : now;
      });
      arm();
    }

    function arm() {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(sync, msUntilNextLocalMidnight(new Date()));
    }

    arm();
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", sync);

    return () => {
      if (timer !== undefined) clearTimeout(timer);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("focus", sync);
    };
  }, []);

  return today;
}
