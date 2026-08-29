import { createBrowserRouter, Navigate } from 'react-router'

import { AppShell } from '@/app/shell/AppShell'
import { AchievementsPage } from '@/features/achievements/AchievementsPage'
import { LoginPage } from '@/features/auth/LoginPage'
import { RequireAuth } from '@/features/auth/RequireAuth'
import { CalendarPage } from '@/features/calendar/CalendarPage'
import { ProgressPage } from '@/features/progress/ProgressPage'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { TodayPage } from '@/features/today/TodayPage'
import { ExerciseDetailPage } from '@/features/training/ExerciseDetailPage'
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
        element: <AppShell />,
        children: [
          { path: '/', element: <Navigate to="/today" replace /> },
          { path: '/today', element: <TodayPage /> },
          { path: '/training', element: <TrainingPage /> },
          { path: '/training/:session', element: <TrainingSessionPage /> },
          { path: '/exercises/:id', element: <ExerciseDetailPage /> },
          { path: '/progress', element: <ProgressPage /> },
          { path: '/calendar', element: <CalendarPage /> },
          { path: '/achievements', element: <AchievementsPage /> },
          { path: '/settings', element: <SettingsPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]

export const router = createBrowserRouter(routes)
