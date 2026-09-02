import { createBrowserRouter, Navigate } from 'react-router'

import { AppShell } from '@/app/shell/AppShell'
import { AchievementsPage } from '@/features/achievements/AchievementsPage'
import { LoginPage } from '@/features/auth/LoginPage'
import { RequireAuth } from '@/features/auth/RequireAuth'
import { CalendarPage } from '@/features/calendar/CalendarPage'
import { ProgrammeProvider } from '@/features/programme/ProgrammeProvider'
import { ProgressPage } from '@/features/progress/ProgressPage'
import { ExerciseLibraryPage } from '@/features/settings/ExerciseLibraryPage'
import { ExerciseMediaEditorPage } from '@/features/settings/ExerciseMediaEditorPage'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { TodayPage } from '@/features/today/TodayPage'
import { ExerciseDetailPage } from '@/features/training/ExerciseDetailPage'
import { ExtraWorkoutPage } from '@/features/training/ExtraWorkoutPage'
import { TrainingPage } from '@/features/training/TrainingPage'
import { TrainingSessionPage } from '@/features/training/TrainingSessionPage'
import { NotFoundPage } from '@/pages/NotFoundPage'

/**
 * Route map.
 *
 * `/login` sits outside the app shell — it gets no navigation chrome. Every
 * other route is behind RequireAuth, which also owns the auth bootstrap so
 * the shell never renders for a signed-out visitor.
 */
export const routes = [
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        /*
         * ROUND 22. The account's programme is read ONCE, here, and shared by
         * Training, the Exercise Library, an exercise's own page and the Extra
         * chooser. Inside RequireAuth because it is account state; above the
         * shell because every one of those screens needs the same answer to
         * the same question, and two of them disagreeing is the bug this
         * round exists to remove.
         */
        element: (
          <ProgrammeProvider>
            <AppShell />
          </ProgrammeProvider>
        ),
        children: [
          { path: '/', element: <Navigate to="/today" replace /> },
          { path: '/today', element: <TodayPage /> },
          { path: '/training', element: <TrainingPage /> },
          // Static before dynamic. `extra` is the reserved Extra Workout
          // occurrence, not a Foundation session, so it must never fall
          // through to the session page — which would look it up in the
          // training week and correctly report "Session not found".
          { path: '/training/extra', element: <ExtraWorkoutPage /> },
          { path: '/training/:session', element: <TrainingSessionPage /> },
          { path: '/exercises/:id', element: <ExerciseDetailPage /> },
          { path: '/progress', element: <ProgressPage /> },
          { path: '/calendar', element: <CalendarPage /> },
          { path: '/achievements', element: <AchievementsPage /> },
          { path: '/settings', element: <SettingsPage /> },
          { path: '/settings/exercises', element: <ExerciseLibraryPage /> },
          { path: '/settings/exercises/:id', element: <ExerciseMediaEditorPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]

export const router = createBrowserRouter(routes)
