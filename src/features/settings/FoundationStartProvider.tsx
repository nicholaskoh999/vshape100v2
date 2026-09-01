import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  DEFAULT_FOUNDATION_START,
  resolveFoundationStart,
  type AccountSettings,
} from '@shared/settings'

import {
  FoundationStartContext,
  type FoundationStartState,
  type FoundationStartStatus,
} from './FoundationStartContext'
import { fetchSettings, saveFoundationStartDate } from './settingsApi'

/**
 * Loads the account's Foundation start date once and shares it with every page.
 *
 * Mounted inside the authenticated shell, so it never runs for a signed-out
 * visitor and every consumer can assume an account exists.
 *
 * Nothing is mirrored into browser storage: a refresh re-reads the server. The
 * same rule the workout, Today and media clients follow.
 */
export function FoundationStartProvider({ children }: { children: React.ReactNode }) {
  const [attempt, setAttempt] = useState(0)
  const [settings, setSettings] = useState<AccountSettings | null>(null)
  const [failed, setFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // A save in flight. A ref so the double-submit guard is decided synchronously
  // inside the handler, the same rule Today's toggle and the media editor use.
  const inFlight = useRef(false)

  // Resolved once, here, so `startDate` and `persisted` can never disagree
  // about the same settings object.
  const resolution = settings === null ? null : resolveFoundationStart(settings.foundationStartDate)

  // A settings object that resolves to `unreadable` is an ERROR, not a ready
  // state with a default in it. The client already refuses such a response, so
  // this is the second of two independent gates rather than the only one.
  const status: FoundationStartStatus =
    resolution?.status === 'ready' ? 'ready' : failed || resolution !== null ? 'error' : 'loading'

  useEffect(() => {
    const controller = new AbortController()
    let active = true

    fetchSettings(controller.signal)
      .then((result) => {
        if (!active) return
        setSettings(result)
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted) return
        // Never quietly fall back to the default here: a wrong start date
        // renders a wrong day number everywhere, which looks authoritative.
        console.error('Foundation start date could not be loaded', error)
        setFailed(true)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [attempt])

  const reload = useCallback(() => {
    setSettings(null)
    setFailed(false)
    setAttempt((n) => n + 1)
  }, [])

  const save = useCallback(async (date: string | null) => {
    if (inFlight.current) return false
    inFlight.current = true
    setSaving(true)
    setSaveError(null)
    setSaved(false)
    try {
      // The SERVER's stored value is adopted, not the value typed, so what the
      // page shows afterwards is what was actually persisted.
      const stored = await saveFoundationStartDate(date)
      setSettings(stored)
      setSaved(true)
      return true
    } catch (error: unknown) {
      console.error('Foundation start date could not be saved', error)
      // The previously confirmed value stays in `settings` and therefore stays
      // on screen and authoritative. A failed save changes nothing.
      setSaveError('Could not save the start date. Your saved date is unchanged — try again.')
      return false
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }, [])

  const value = useMemo<FoundationStartState>(
    () => ({
      status,
      // Only meaningful while `status` is 'ready'; never a guess otherwise.
      startDate: resolution?.status === 'ready' ? resolution.startDate : DEFAULT_FOUNDATION_START,
      persisted: resolution?.status === 'ready' ? resolution.persisted : null,
      saving,
      saveError,
      saved,
      reload,
      save,
    }),
    [status, resolution, saving, saveError, saved, reload, save],
  )

  return (
    <FoundationStartContext.Provider value={value}>{children}</FoundationStartContext.Provider>
  )
}
