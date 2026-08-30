/**
 * VShape100 v2 Worker.
 *
 * Owns the auth, Today, exercise media and workout logging APIs and
 * otherwise hands the request to Static Assets, which serves the built React
 * app (with SPA fallback for client routes).
 */

import type { Env } from './auth/config'
import { handleAuthRequest } from './auth/routes'
import { handleExerciseMediaRequest } from './exerciseMedia/routes'
import { handleTodayRequest } from './today/routes'
import { handleWorkoutRequest } from './workouts/routes'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const authResponse = await handleAuthRequest(request, env)
    if (authResponse) return authResponse

    const todayResponse = await handleTodayRequest(request, env)
    if (todayResponse) return todayResponse

    const mediaResponse = await handleExerciseMediaRequest(request, env)
    if (mediaResponse) return mediaResponse

    const workoutResponse = await handleWorkoutRequest(request, env)
    if (workoutResponse) return workoutResponse

    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
