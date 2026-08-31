/**
 * The pure Today engine.
 *
 * Defined in shared/today so the Worker can build the same agenda, with the
 * same occurrence identity, the same cross-midnight anchoring and the same
 * Holiday spillover suppression the page uses.
 */

export * from '@shared/today/engine'
