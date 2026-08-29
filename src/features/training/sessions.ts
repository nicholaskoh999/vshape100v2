/**
 * Accepted Mon–Fri Foundation training skeleton (locked in the V START
 * handoff). Static presentation data for the Round 01 shell — real
 * persistence, logging and progression arrive in later rounds via D1.
 */

export type SessionIntensity = 'HARD' | 'LIGHT' | 'PUMP'

export type SessionExercise = {
  /** Stable slug used by /exercises/:id */
  id: string
  name: string
  /** Prescription as accepted text, e.g. "4 × 10–15" */
  sets: string
  equipment?: string
}

export type TrainingSession = {
  /** Stable slug used by /training/:session */
  id: string
  day: string
  focus: string
  intensity: SessionIntensity
  exercises: SessionExercise[]
}

export const trainingSessions: TrainingSession[] = [
  {
    id: 'monday',
    day: 'Monday',
    focus: 'Back Width + Biceps',
    intensity: 'HARD',
    exercises: [
      { id: 'lat-pulldown', name: 'Lat Pulldown', sets: '4 × 10–15', equipment: 'BAND 20kg' },
      { id: 'one-arm-db-row', name: 'One-Arm DB Row', sets: '3 × 8–12', equipment: 'DB + Bench Flat' },
      { id: 'face-pull', name: 'Face Pull', sets: '3 × 15–20', equipment: 'BAND 10kg' },
      { id: 'preacher-curl', name: 'Preacher Curl', sets: '3 × 10–15', equipment: 'DB + Bench Preacher setup' },
      { id: 'hammer-curl', name: 'Hammer Curl', sets: '2 × 10–15', equipment: 'DB' },
    ],
  },
  {
    id: 'tuesday',
    day: 'Tuesday',
    focus: 'Upper Chest + Shoulders + Triceps',
    intensity: 'HARD',
    exercises: [
      { id: 'incline-db-press', name: 'Incline DB Press', sets: '4 × 8–12' },
      { id: 'seated-shoulder-press', name: 'Seated Shoulder Press', sets: '3 × 8–12' },
      { id: 'flat-db-press', name: 'Flat DB Press', sets: '3 × 10–15' },
      { id: 'lateral-raise', name: 'Lateral Raise', sets: '3 × 12–20' },
      { id: 'triceps-pushdown', name: 'Triceps Pushdown', sets: '3 × 10–15' },
    ],
  },
  {
    id: 'wednesday',
    day: 'Wednesday',
    focus: 'Light Back + Rear Delts + Core',
    intensity: 'LIGHT',
    exercises: [
      { id: 'lat-pulldown', name: 'Lat Pulldown', sets: '2 × 15–20' },
      { id: 'face-pull', name: 'Face Pull', sets: '3 × 15–20' },
      { id: 'rear-delt-fly', name: 'Rear Delt Fly', sets: '2 × 15–20' },
      { id: 'dead-bug', name: 'Dead Bug', sets: '3 × 10 / side' },
      { id: 'plank', name: 'Plank', sets: '3 × 30–60s' },
    ],
  },
  {
    id: 'thursday',
    day: 'Thursday',
    focus: 'Back Thickness + Chest + Biceps',
    intensity: 'HARD',
    exercises: [
      { id: 'lat-pulldown', name: 'Lat Pulldown', sets: '4 × 10–15' },
      { id: 'chest-supported-db-row', name: 'Chest-Supported DB Row', sets: '3 × 10–15' },
      { id: 'seated-band-row', name: 'Seated Band Row', sets: '3 × 12–15' },
      { id: 'flat-db-press', name: 'Flat DB Press', sets: '2 × 10–15' },
      { id: 'preacher-curl', name: 'Preacher Curl', sets: '2 × 10–15' },
    ],
  },
  {
    id: 'friday',
    day: 'Friday',
    focus: 'Upper Chest + Shoulders + Arms',
    intensity: 'PUMP',
    exercises: [
      { id: 'incline-db-press', name: 'Incline DB Press', sets: '2 × 12–15' },
      { id: 'lateral-raise', name: 'Lateral Raise', sets: '3 × 15–20' },
      { id: 'face-pull', name: 'Face Pull', sets: '3 × 15–20' },
      { id: 'preacher-curl', name: 'Preacher Curl', sets: '2 × 12–15' },
      { id: 'triceps-pushdown', name: 'Triceps Pushdown', sets: '3 × 12–20' },
      { id: 'hammer-curl', name: 'Hammer Curl', sets: '2 × 12–15' },
    ],
  },
]

export function getSession(id: string | undefined) {
  return trainingSessions.find((session) => session.id === id)
}

/** Look up an exercise by slug across all sessions (first occurrence wins). */
export function getExercise(id: string | undefined) {
  for (const session of trainingSessions) {
    const exercise = session.exercises.find((entry) => entry.id === id)
    if (exercise) return { exercise, session }
  }
  return undefined
}
