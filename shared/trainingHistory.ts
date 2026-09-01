/**
 * The training-history authority.
 *
 * WHY THIS IS SEPARATE FROM THE FOUNDATION START DATE.
 *
 * Round 18 gave the account an editable Foundation Day 1. That setting answers
 * one question — "what day number is today?" — and it must answer no others.
 *
 * Round 18 Correction 1: Achievements had been evaluating training evidence over
 * a window that began at that editable date. Moving Day 1 forward therefore moved
 * the evidence: completed scheduled sessions before the new start fell outside
 * the window and stopped counting, so `Sessions finished`, `First Session`,
 * `Full Week`, `Consistency` and both streaks changed because of a preference. A
 * training fact must never be rewritten by a display setting.
 *
 * This epoch is the fixed point those facts are measured from instead. It is the
 * earliest local date the application can hold recorded training history — Round
 * 01, when the first occurrence could be written. It is not configurable, is not
 * derived from any account row, and must not be changed to follow a default: it
 * is a statement about what the DATABASE can contain, not about what any user
 * prefers.
 *
 * It happens to share a value with `DEFAULT_FOUNDATION_START`, because Round 01
 * both started the programme and started the history. They are still different
 * facts: the default is a fallback a user can override, this is not.
 */

/** The earliest local date recorded training history can exist for. */
export const TRAINING_HISTORY_EPOCH = '2026-08-31'
