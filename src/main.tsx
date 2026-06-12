import React from 'react'
import { createRoot } from 'react-dom/client'
import { createRouter, RouterProvider } from '@tanstack/react-router'

import { routeTree } from './routeTree.gen'
import { AppStateProvider } from './state/AppStateContext'
import { CodeHintsProvider } from './codeHints/codeHints'
import { ThemeProvider } from './theme/theme'
import './styles.css'

const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <CodeHintsProvider>
        <AppStateProvider>
          <RouterProvider router={router} />
        </AppStateProvider>
      </CodeHintsProvider>
    </ThemeProvider>
  </React.StrictMode>,
)
