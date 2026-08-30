/**
 * VShape100 v2 Worker.
 *
 * Owns the auth, Today and exercise media APIs and otherwise hands the
 * request to Static Assets, which serves the built React app (with SPA
 * fallback for client routes).
 */

import type { Env } from './auth/config'
import { handleAuthRequest } from './auth/routes'
import { handleExerciseMediaRequest } from './exerciseMedia/routes'
import { handleTodayRequest } from './today/routes'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const authResponse = await handleAuthRequest(request, env)
    if (authResponse) return authResponse

    const todayResponse = await handleTodayRequest(request, env)
    if (todayResponse) return todayResponse

    const mediaResponse = await handleExerciseMediaRequest(request, env)
    if (mediaResponse) return mediaResponse

    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
