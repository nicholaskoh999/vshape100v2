import '@fontsource-variable/outfit'
import '@/design/tokens.css'

import { MotionConfig } from 'motion/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'

import { router } from '@/app/router/router'
import { AuthProvider } from '@/features/auth/AuthProvider'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* reducedMotion="user" makes every Motion animation honor the OS setting */}
    <MotionConfig reducedMotion="user">
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </MotionConfig>
  </StrictMode>,
)
