/**
 * The accepted daily routes.
 *
 * Defined in shared/today, because the notification scheduler must derive
 * what is due from the SAME route definitions the page renders. A second
 * copy of 07:30 or 20:30 anywhere would be a second schedule.
 */

export * from '@shared/today/routines'
