/**
 * VShape100 v2 Worker.
 *
 * Owns the auth, Today, exercise media, workout logging, Holiday and
 * notification APIs, and otherwise hands the request to Static Assets, which
 * serves the built React app (with SPA fallback for client routes).
 *
 * It also runs the scheduled reminder sweep. That sweep derives what is due
 * from the SAME shared Today engine the page renders; it is a delivery layer,
 * not a second scheduler.
 */

import type { Env } from './auth/config'
import { handleAuthRequest } from './auth/routes'
import { handleExerciseMediaRequest } from './exerciseMedia/routes'
import { handleHolidayRequest } from './holiday/routes'
import { readVapidConfig } from './notifications/config'
import { createD1PushStore } from './notifications/d1Store'
import { handleNotificationRequest } from './notifications/routes'
import { runScheduledSweep } from './notifications/scheduler'
import { createD1ScheduleTruth } from './notifications/truth'
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

    const holidayResponse = await handleHolidayRequest(request, env)
    if (holidayResponse) return holidayResponse

    const notificationResponse = await handleNotificationRequest(request, env)
    if (notificationResponse) return notificationResponse

    return env.ASSETS.fetch(request)
  },

  /**
   * The once-a-minute reminder sweep.
   *
   * `event.scheduledTime` is the authority, NOT the clock at execution.
   * Cloudflare may start a scheduled event a little late, and a 20:30 event
   * that begins at 20:30:20 is still the 20:30 event — using execution time
   * would silently skip the minute it was meant to serve.
   *
   * Missing VAPID configuration is handled inside the sweep: it sends nothing
   * and reports why, rather than throwing once a minute.
   */
  async scheduled(event: ScheduledController, env: Env): Promise<void> {
    await runScheduledSweep({
      scheduledTime: event.scheduledTime,
      store: createD1PushStore(env.DB),
      truth: createD1ScheduleTruth(env.DB),
      vapid: readVapidConfig(env),
    })
  },
} satisfies ExportedHandler<Env>
