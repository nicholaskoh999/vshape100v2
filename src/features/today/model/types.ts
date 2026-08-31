/**
 * The Today domain types.
 *
 * The definition now lives in shared/today so the Worker's notification
 * scheduler and the React app read exactly the same routes, item ids and
 * clock times. This file only re-exports it, so no import path had to churn
 * and there is still only one definition.
 */

export * from '@shared/today/types'
