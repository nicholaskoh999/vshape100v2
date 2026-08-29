import { createBrowserRouter, Navigate } from 'react-router'

import { AppShell } from '@/app/shell/AppShell'
import { AchievementsPage } from '@/features/achievements/AchievementsPage'
import { CalendarPage } from '@/features/calendar/CalendarPage'
import { ProgressPage } from '@/features/progress/ProgressPage'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { TodayPage } from '@/features/today/TodayPage'
import { ExerciseDetailPage } from '@/features/training/ExerciseDetailPage'
import { TrainingPage } from '@/features/training/TrainingPage'
import { TrainingSessionPage } from '@/features/training/TrainingSessionPage'
import { NotFoundPage } from '@/pages/NotFoundPage'

/** Accepted route map — all app URLs live under the responsive shell. */
export const routes = [
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
]

export const router = createBrowserRouter(routes)
