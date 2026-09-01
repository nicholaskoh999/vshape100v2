import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useLocalToday } from '@/features/progress/useLocalToday'
import type { TrainingFlexKind } from '@shared/trainingFlex'

import { fetchTrainingFlex, saveTrainingFlex } from './trainingFlexApi'

/**
 * Today's training flex choice, for the CURRENT LOCAL DAY only.
 *
 * MIDNIGHT IS THE WHOLE POINT of reading it this way. The choice belongs to one
 * calendar date, so the date is part of the read identity: when the local day
 * turns, the previous day's answer stops being this hook's answer and a fresh
 * read is issued for the new day. Yesterday's Recovery cannot leak into today.
 *
 * `useLocalToday` is the accepted freshness pattern — one armed timeout for the
 * next local midnight plus visibility/focus recovery for a tab that slept
 * through it. No polling is introduced here.
 */

export type TrainingFlexStatus = 'loading' | 'ready' | 'error'

export type TrainingFlexState = {
  status: TrainingFlexStatus
  /** The local date this answer is about. */
  today: string
  /** The choice in force for today, or null when the scheduled workout stands. */
  choice: TrainingFlexKind | null
  /** A save is in flight. */
  saving: boolean
  /** Last recoverable save failure; the previous confirmed truth stays visible. */
  saveError: string | null
  reload: () => void
  /** Returns true when the server confirmed the write. */
  choose: (kind: TrainingFlexKind | null) => Promise<boolean>
}

type Loaded = { id: string; choice: TrainingFlexKind | null }

export function useTrainingFlex(): TrainingFlexState {
  const today = useLocalToday()
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failedId, setFailedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // A save in flight. A ref so the double-submit guard is decided synchronously
  // inside the handler, the same rule Today's toggle and the media editor use.
  const inFlight = useRef(false)

  /**
   * The full read identity: attempt AND the local day.
   *
   * Both halves are load-bearing. Without the day, a result fetched yesterday
   * would keep satisfying today's read — the same defect Round 18 corrected in
   * the body weight card, and the reason it is written this way here from the
   * start.
   */
  const readId = useMemo(() => `${attempt}:${today}`, [attempt, today])
  const matched = loaded?.id === readId

  const status: TrainingFlexStatus = matched
    ? 'ready'
    : failedId === readId
      ? 'error'
      : 'loading'

  useEffect(() => {
    const controller = new AbortController()
    let active = true

    fetchTrainingFlex(today, today, controller.signal)
      .then((choices) => {
        if (!active) return
        // The range is a single day, so at most one row can come back, and it
        // must be for the day asked about.
        const forToday = choices.find((row) => row.date === today) ?? null
        setLoaded({ id: readId, choice: forToday?.kind ?? null })
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted) return
        // Never fall back to "no choice": that would tell the user their day is
        // unresolved when the truth is we could not find out.
        console.error("Today's training choice could not be loaded", error)
        setFailedId(readId)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [readId, today])

  const reload = useCallback(() => setAttempt((n) => n + 1), [])

  const choose = useCallback(
    async (kind: TrainingFlexKind | null) => {
      if (inFlight.current) return false
      inFlight.current = true
      setSaving(true)
      setSaveError(null)
      try {
        // Always writes the date this hook is currently about, never a date the
        // caller chose, so a stale component cannot write to yesterday.
        const stored = await saveTrainingFlex(today, kind)
        // The SERVER's stored value is adopted, not the value clicked.
        setLoaded({ id: `${attempt}:${today}`, choice: stored?.kind ?? null })
        return true
      } catch (error: unknown) {
        console.error("Today's training choice could not be saved", error)
        // The previously confirmed choice stays in `loaded` and therefore stays
        // on screen and authoritative. A failed save changes nothing.
        setSaveError('Could not save that choice. Nothing was changed — try again.')
        return false
      } finally {
        inFlight.current = false
        setSaving(false)
      }
    },
    [attempt, today],
  )

  return {
    status,
    today,
    choice: matched ? (loaded as Loaded).choice : null,
    saving,
    saveError,
    reload,
    choose,
  }
}
