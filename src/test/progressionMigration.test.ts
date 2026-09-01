import { describe, expect, it } from 'vitest'

import migration from '../../migrations/0009_training_progression.sql?raw'

/**
 * Round 16 — migration 0009.
 *
 * Two things are worth asserting on the SQL itself.
 *
 * The table must be ADDITIVE and safe to apply repeatedly against a local
 * database: nothing is dropped, altered, back-filled or seeded, and the create
 * is conditional.
 *
 * The key IS the scope. One account cannot reach another's calibration, Monday
 * cannot leak into Wednesday, one evening cannot leak into the next, and a
 * repeated exercise cannot leak across its own slots — all four because the
 * corresponding column is part of the primary key, not because a query happens
 * to filter on it.
 */

describe('migration 0009', () => {
  it('is additive: it drops, alters and rewrites nothing', () => {
    for (const banned of [/DROP\s+TABLE/i, /DELETE\s+FROM/i, /ALTER\s+TABLE/i, /TRUNCATE/i, /UPDATE\s+\w/i]) {
      expect(migration, String(banned)).not.toMatch(banned)
    }
  })

  it('creates its table idempotently, so a repeated local apply is safe', () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS workout_calibration/)
    // Exactly one table is created, and no index collides with an existing name.
    expect(migration.match(/CREATE TABLE/g)).toHaveLength(1)
    expect(migration).not.toMatch(/CREATE\s+(UNIQUE\s+)?INDEX/i)
  })

  it('seeds nothing and carries no real account identifier', () => {
    expect(migration).not.toMatch(/INSERT INTO/)
    expect(migration).not.toMatch(/[0-9]{15,}/)
  })

  it('scopes a calibration to one account, date, session and exercise slot', () => {
    expect(migration).toMatch(
      /PRIMARY KEY \(google_sub, workout_date, session_id, exercise_order\)/,
    )
  })

  it('belongs to a workout that exists, and goes when that workout does', () => {
    expect(migration).toMatch(
      /FOREIGN KEY \(google_sub, workout_date, session_id\)[\s\S]*?REFERENCES workout_occurrences \(google_sub, workout_date, session_id\)[\s\S]*?ON DELETE CASCADE/,
    )
  })

  it('stores the lane semantics the judgement was given under', () => {
    // Without this, a changed prescription would inherit a calibration that
    // was about different work.
    expect(migration).toMatch(/lane_fingerprint TEXT NOT NULL/)
  })

  it('stores what the person said, from a closed vocabulary', () => {
    expect(migration).toMatch(
      /feedback TEXT NOT NULL CHECK \(feedback IN \('too_light', 'good', 'too_heavy'\)\)/,
    )
  })

  it('stores the observed load with its unit, so "each" can never be lost', () => {
    expect(migration).toMatch(/observed_load_value REAL NOT NULL/)
    expect(migration).toMatch(
      /observed_load_unit TEXT NOT NULL CHECK \(observed_load_unit IN \('kg', 'kg_each'\)\)/,
    )
    expect(migration).toMatch(/CHECK \(\(chosen_load_value IS NULL\) = \(chosen_load_unit IS NULL\)\)/)
  })

  it('stores NO derived recommendation', () => {
    // The state and the recommended load are recomputed from workout history on
    // every read. A stored copy would go stale the moment a set is corrected.
    for (const banned of [
      /recommended_load/i,
      /suggested_load/i,
      /progression_state/i,
      /next_load/i,
      /current_state/i,
    ]) {
      expect(migration, String(banned)).not.toMatch(banned)
    }
  })

  it('names no invented hardware increment', () => {
    // No ladder is asserted here, and no default step is baked into the schema.
    expect(migration).not.toMatch(/DEFAULT\s+[0-9]/)
    expect(migration).not.toMatch(/\b2\.5\b/)
  })

  it('bounds a stored load the same way the set table does', () => {
    expect(migration).toMatch(/observed_load_value >= 0 AND observed_load_value <= 1000/)
    expect(migration).toMatch(/chosen_load_value >= 0 AND chosen_load_value <= 1000/)
    expect(migration).toMatch(/exercise_order >= 0 AND exercise_order < 24/)
  })

  it('validates the workout date the same way 0004 does', () => {
    expect(migration).toMatch(
      /workout_date GLOB '\[0-9\]\[0-9\]\[0-9\]\[0-9\]-\[0-9\]\[0-9\]-\[0-9\]\[0-9\]'/,
    )
  })
})
