import {
  CalendarDays,
  Check,
  Database,
  Globe,
  Loader2,
  Lock,
  RefreshCw,
  Server,
  Timer,
  Trash2,
  Wrench,
} from 'lucide-react'
import { motion } from 'motion/react'
import { useCallback, useEffect, useId, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Banner } from '@/components/ui/Feedback'
import { Card, PageHeader, SectionHeader } from '@/components/ui/Layout'
import { listItemVariants, listVariants } from '@/design/motion'
import { useAuth } from '@/features/auth/AuthContext'
import { isLocalDate } from '@shared/localDate'
import type { AdminFoundation, AdminOverview } from '@shared/admin'

import {
  AdminApiError,
  fetchAdminOverview,
  saveAdminFoundationStart,
  type AdminErrorKind,
} from './adminApi'
import { FactRow, SystemCard } from './AdminStatus'

/**
 * VShape Admin Lite / System Health v1.
 *
 * A small owner-only control page, deliberately NOT a DevOps console. It shows
 * what this build can actually prove, offers exactly one safe control, and says
 * plainly where a control has been left out.
 *
 * THE PAGE'S ONE RULE: nothing on it may look more certain than it is.
 *
 *   - a status this build cannot prove reads Unknown, never a green tick
 *   - a count that could not be read reads Unknown, never 0
 *   - Maintenance says it is designed but not wired, rather than offering a
 *     switch that would do nothing
 *   - the Danger Zone DESCRIBES the Fresh Activity Reset and offers no way to
 *     run it. There is no button, no link and no endpoint behind it
 *
 * SECURITY. This route is not a secret and is not treated as one. It renders
 * for any signed-in user; what it renders for a non-admin is a refusal, because
 * every fact on it comes from an API that checks a server-side allowlist. There
 * is no client-side admin flag to find, edit or forge.
 */

/** Epoch ms → a short local timestamp, or null when there is nothing to show. */
function formatMoment(at: number | null): string | null {
  if (at === null) return null
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

/** A count, or the honest absence of one. `0` is a real answer and stays `0`. */
function formatCount(value: number | null): string | null {
  return value === null ? null : value.toLocaleString()
}

/** One line of evidence for the scheduler's status. */
function cronNote(overview: AdminOverview): string {
  const at = formatMoment(overview.system.cronLastSweepAt)
  switch (overview.system.cronReason) {
    case 'observed_sweep':
      return `A reminder was claimed at ${at}, so the sweep ran.`
    case 'vapid_unconfigured':
      return 'Push keys are not configured, so the sweep can deliver nothing.'
    case 'no_observed_sweep':
      return 'No reminder has been due, so there is nothing to prove it ran.'
    case 'stale_observation':
      return `Last reminder claimed ${at}. Nothing since, which proves nothing either way.`
    case 'unreadable':
      return 'The delivery ledger could not be read.'
  }
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; overview: AdminOverview }
  | { status: 'error'; kind: AdminErrorKind }

export function AdminPage() {
  const { user } = useAuth()
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)

  /*
   * Read once per attempt. Following FoundationStartProvider: the effect reads
   * and reports, and Refresh resets the state itself rather than the effect
   * body setting `loading` on every run — a synchronous setState inside an
   * effect is a cascading render.
   */
  useEffect(() => {
    const controller = new AbortController()
    let active = true

    fetchAdminOverview(controller.signal)
      .then((overview) => {
        if (!active) return
        setState({ status: 'ready', overview })
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted) return
        setState({
          status: 'error',
          kind: error instanceof AdminApiError ? error.kind : 'failed',
        })
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [reloadKey])

  const refresh = useCallback(() => {
    setState({ status: 'loading' })
    setReloadKey((n) => n + 1)
  }, [])

  // Adopt the row the SERVER re-read after a save, so the page shows persisted
  // truth rather than the value that was typed.
  const adoptFoundation = useCallback((foundation: AdminFoundation) => {
    setState((current) =>
      current.status === 'ready'
        ? {
            status: 'ready',
            overview: {
              ...current.overview,
              account: { ...current.overview.account, foundation },
            },
          }
        : current,
    )
  }, [])

  return (
    <>
      <PageHeader
        eyebrow="Owner only"
        title="Admin"
        subline="System health, account facts and one safe control"
        actions={
          <Button size="sm" onClick={refresh} disabled={state.status === 'loading'}>
            <RefreshCw className="size-4" aria-hidden="true" />
            Refresh
          </Button>
        }
      />

      {state.status === 'loading' && (
        <p role="status" className="flex items-center gap-2 text-[13px] font-semibold text-ink-2">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Reading system status…
        </p>
      )}

      {state.status === 'error' && <AdminError kind={state.kind} />}

      {state.status === 'ready' && (
        <motion.div
          variants={listVariants}
          initial="initial"
          animate="enter"
          className="flex flex-col gap-1"
        >
          <motion.section variants={listItemVariants} aria-labelledby="admin-system">
            <SectionHeader title="System" id="admin-system" className="mt-0" />
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {/*
                App is the one signal this page can prove entirely on its own:
                the shell fetched, parsed and rendered, which is what "the app
                is being served" means. It is not read from the API, because the
                API answering says nothing about static assets.
              */}
              <SystemCard
                icon={Globe}
                name="App"
                status="healthy"
                note="This page loaded and is rendering."
              />
              <SystemCard
                icon={Server}
                name="API"
                status={state.overview.system.api}
                note="The Worker answered this request."
              />
              <SystemCard
                icon={Database}
                name="D1"
                status={state.overview.system.d1}
                note={
                  state.overview.system.d1 === 'healthy'
                    ? 'A read against the database succeeded.'
                    : 'The database did not answer a trivial read.'
                }
              />
              <SystemCard
                icon={Timer}
                name="Cron"
                status={state.overview.system.cron}
                note={cronNote(state.overview)}
              />
            </div>

            <Card flush className="mt-3">
              <div className="divide-y divide-line">
                <FactRow
                  label="Build"
                  note="Reported by the deployment. Never derived."
                  value={state.overview.system.buildSha}
                />
                <FactRow
                  label="D1 migration level"
                  note="Newest applied migration."
                  value={state.overview.system.migrationLevel}
                />
              </div>
            </Card>
          </motion.section>

          <motion.section variants={listItemVariants} aria-labelledby="admin-account">
            <SectionHeader title="Account" id="admin-account" />
            <Card flush>
              <div className="divide-y divide-line">
                <FactRow label="Signed in as" value={user?.email ?? null} />
                <FoundationRow
                  foundation={state.overview.account.foundation}
                  onSaved={adoptFoundation}
                />
                <FactRow
                  label="Programme"
                  note={
                    state.overview.account.programme.status === 'seed'
                      ? 'Never edited — reading the Foundation programme.'
                      : undefined
                  }
                  value={
                    state.overview.account.programme.status === 'edited'
                      ? `Revision ${state.overview.account.programme.revision}`
                      : state.overview.account.programme.status === 'seed'
                        ? 'Foundation default'
                        : null
                  }
                />
                <FactRow
                  label="Push devices"
                  value={formatCount(state.overview.account.pushDevices)}
                />
                <FactRow
                  label="Active sessions"
                  note="Live, unrevoked devices."
                  value={formatCount(state.overview.account.activeSessions)}
                />
              </div>
            </Card>
          </motion.section>

          <motion.section variants={listItemVariants} aria-labelledby="admin-activity">
            <SectionHeader
              title="Activity"
              id="admin-activity"
              trailing={
                <span className="text-[12px] font-semibold text-ink-3">This account only</span>
              }
            />
            <Card flush>
              <div className="divide-y divide-line">
                <FactRow
                  label="Workouts"
                  value={formatCount(state.overview.activity.workoutOccurrences)}
                />
                <FactRow label="Sets" value={formatCount(state.overview.activity.workoutSets)} />
                <FactRow
                  label="Weight entries"
                  value={formatCount(state.overview.activity.bodyWeightEntries)}
                />
                <FactRow
                  label="Today completions"
                  value={formatCount(state.overview.activity.todayCompletions)}
                />
                <FactRow
                  label="Corrections"
                  value={formatCount(state.overview.activity.workoutCorrections)}
                />
                <FactRow
                  label="Training flex"
                  value={formatCount(state.overview.activity.trainingFlex)}
                />
              </div>
            </Card>
          </motion.section>

          <motion.section variants={listItemVariants} aria-labelledby="admin-maintenance">
            <SectionHeader title="Maintenance" id="admin-maintenance" />
            <Card className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-soft text-ink-2"
                >
                  <Wrench className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-ink">Maintenance mode</p>
                  <p className="mt-0.5 text-[13px] text-ink-3">
                    Status: <span className="font-bold text-ink-2">OFF</span> — normal app
                  </p>
                </div>
                <Button size="sm" disabled aria-describedby="admin-maintenance-note">
                  <Lock className="size-4" aria-hidden="true" />
                  Turn on
                </Button>
              </div>
              <p id="admin-maintenance-note" className="text-[13px] leading-relaxed text-ink-3">
                Designed, not wired. Turning maintenance on has to survive a restart, and this
                build has nowhere durable to keep a global flag — the only candidate would be a
                new database table, which this spike is not adding. Until then the state is OFF
                by construction: nothing in the app reads a maintenance flag, so nothing can
                turn one on behind your back.
              </p>
            </Card>
          </motion.section>

          <motion.section variants={listItemVariants} aria-labelledby="admin-danger">
            <SectionHeader title="Danger zone" id="admin-danger" />
            {/*
              DISPLAY ONLY. There is deliberately no button, no link and no form
              in this region, and no endpoint exists that this page could call.
              The Fresh Activity Reset is executed exclusively by the accepted
              Round 25 operator, under an explicit authorisation, from a machine
              with credentials — never from a web page.
            */}
            <div
              data-admin-danger-zone
              className="vs-bordered flex items-start gap-3.5 rounded-card border border-danger-ink/25 bg-danger-soft p-5"
            >
              <span
                aria-hidden="true"
                className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface/70 text-danger-ink"
              >
                <Trash2 className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-bold text-danger-ink">Fresh Activity Reset</p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-ink-2">
                  Clears activity history while preserving configuration.
                </p>
                <p className="mt-2.5 text-[13px] font-semibold text-ink-2">
                  Managed separately · Not available here
                </p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">
                  Run only by the Round 25 operator tool, from a machine with credentials, after
                  an explicit go-ahead. This page has no control that can start it.
                </p>
              </div>
            </div>
          </motion.section>
        </motion.div>
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* The one safe control                                                */
/* ------------------------------------------------------------------ */

type SaveState =
  | { status: 'idle' }
  | { status: 'editing' }
  | { status: 'confirming'; date: string }
  | { status: 'saving'; date: string }
  | { status: 'saved' }
  | { status: 'failed'; message: string }

/**
 * Foundation Day 1 — edit, validate, confirm, save.
 *
 * FOUR THINGS STAND BETWEEN A STRAY CLICK AND A WRITE: the control is closed by
 * default; the date must be a real calendar date; an explicit confirmation step
 * names the old value and the new one; and the request itself carries a
 * `confirm` flag the server insists on.
 *
 * What it changes is stated on the card, because a date field that silently
 * reshuffled training would be alarming — and because this is NOT the Fresh
 * Reset, and the page should never let anyone confuse the two.
 */
function FoundationRow({
  foundation,
  onSaved,
}: {
  foundation: AdminFoundation
  onSaved: (next: AdminFoundation) => void
}) {
  const inputId = useId()
  const [save, setSave] = useState<SaveState>({ status: 'idle' })
  const [draft, setDraft] = useState('')

  const current = foundation.status === 'set' ? foundation.date : null
  const valid = isLocalDate(draft)
  const busy = save.status === 'saving'

  const label =
    foundation.status === 'set'
      ? foundation.date
      : foundation.status === 'unset'
        ? 'Not set'
        : null

  const open = () => {
    setDraft(current ?? '')
    setSave({ status: 'editing' })
  }

  const commit = async (date: string) => {
    setSave({ status: 'saving', date })
    try {
      onSaved(await saveAdminFoundationStart(date))
      setSave({ status: 'saved' })
    } catch (error) {
      setSave({
        status: 'failed',
        message:
          error instanceof AdminApiError && error.kind === 'forbidden'
            ? 'This account is not allowed to change Day 1.'
            : 'The date was not saved. Nothing has been changed.',
      })
    }
  }

  return (
    <div className="px-4 py-3">
      <div className="flex min-h-tap items-center gap-3">
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold text-ink">Foundation Day 1</span>
          <span className="mt-0.5 block text-[12.5px] text-ink-3">
            {foundation.status === 'unreadable'
              ? 'The stored value could not be read.'
              : 'Renumbers Foundation days and milestones only.'}
          </span>
        </span>
        {label === null ? (
          <span className="shrink-0 text-[13px] font-bold text-ink-4">Unknown</span>
        ) : (
          <span className="shrink-0 text-[15px] font-bold tabular-nums text-ink">{label}</span>
        )}
        {save.status === 'idle' || save.status === 'saved' || save.status === 'failed' ? (
          <Button size="sm" onClick={open}>
            <CalendarDays className="size-4" aria-hidden="true" />
            Edit
          </Button>
        ) : null}
      </div>

      {save.status === 'saved' && (
        <p
          role="status"
          className="mt-2 flex items-center gap-1.5 text-[13px] font-semibold text-accent-ink"
        >
          <Check className="size-4" aria-hidden="true" />
          Day 1 saved.
        </p>
      )}

      {save.status === 'failed' && (
        <p role="alert" className="mt-2 text-[13px] font-semibold text-danger-ink">
          {save.message}
        </p>
      )}

      {save.status === 'editing' && (
        <form
          className="mt-3 flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (!valid) return
            // Never straight to the write. The confirmation is a separate step,
            // and it names both dates.
            setSave({ status: 'confirming', date: draft })
          }}
        >
          <div className="min-w-0">
            <label
              htmlFor={inputId}
              className="block text-[11px] font-bold uppercase tracking-[0.09em] text-ink-3"
            >
              New Day 1
            </label>
            <input
              id={inputId}
              type="date"
              value={draft}
              aria-invalid={draft !== '' && !valid}
              onChange={(event) => setDraft(event.target.value)}
              className="mt-1.5 w-44 rounded-control border border-line-strong bg-surface px-3 py-2 text-[15px] font-bold text-ink outline-offset-2 aria-[invalid=true]:border-danger-ink"
            />
          </div>
          <Button type="submit" variant="primary" size="md" disabled={!valid}>
            Save
          </Button>
          <Button size="md" onClick={() => setSave({ status: 'idle' })}>
            Cancel
          </Button>
          {draft !== '' && !valid && (
            <p role="alert" className="w-full text-[13px] font-semibold text-danger-ink">
              That is not a real calendar date. Pick a valid day.
            </p>
          )}
        </form>
      )}

      {(save.status === 'confirming' || busy) && (
        <Banner tone="warn" className="mt-3" title="Confirm Day 1" live="alert">
          <p>
            {current === null
              ? `Set Foundation Day 1 to ${'date' in save ? save.date : ''}?`
              : `Change Foundation Day 1 from ${current} to ${'date' in save ? save.date : ''}?`}{' '}
            Day numbers and milestones are renumbered. No workout, set or history row is
            changed, and this is not the Fresh Activity Reset.
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="md"
              disabled={busy}
              aria-busy={busy}
              onClick={() => {
                if ('date' in save) void commit(save.date)
              }}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Check className="size-4" aria-hidden="true" />
              )}
              {busy ? 'Saving…' : 'Confirm change'}
            </Button>
            <Button size="md" disabled={busy} onClick={() => setSave({ status: 'editing' })}>
              Back
            </Button>
          </div>
        </Banner>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Refusals                                                            */
/* ------------------------------------------------------------------ */

/**
 * What a non-admin sees.
 *
 * A refusal, and nothing else — no counts, no health, no hint about who is on
 * the allowlist or whether one is configured. The route rendered; the data did
 * not, because the server said no.
 */
function AdminError({ kind }: { kind: AdminErrorKind }) {
  if (kind === 'forbidden') {
    return (
      <Banner tone="warn" title="Not available for this account" live="alert">
        Admin is limited to the owner account. Nothing on this page has loaded.
      </Banner>
    )
  }
  if (kind === 'unauthenticated') {
    return (
      <Banner tone="warn" title="Session ended" live="alert">
        Sign in again to read system status.
      </Banner>
    )
  }
  if (kind === 'unreadable') {
    return (
      <Banner tone="danger" title="Status could not be read" live="alert">
        The server answered in a shape this page does not understand, so nothing is shown
        rather than a status that might be wrong.
      </Banner>
    )
  }
  return (
    <Banner tone="danger" title="Could not load system status" live="alert">
      Nothing has been changed. Try Refresh.
    </Banner>
  )
}
