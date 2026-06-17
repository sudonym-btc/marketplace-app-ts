import { useEffect } from 'react'
import { createRootRoute, Outlet } from '@tanstack/react-router'

import { Shell } from '../components/Shell'
import { useMarketplaceApp } from '../state/AppStateContext'

let initialRestoreStarted = false

function RootLayout() {
  const { state, actions } = useMarketplaceApp()

  useEffect(() => {
    if (initialRestoreStarted) return
    initialRestoreStarted = true
    void actions.restore()
  }, [actions.restore])

  return (
    <Shell
      session={state.session}
      marketplaceSession={state.marketplaceSession}
      refreshRevision={state.refreshRevision}
      status={state.status}
      loading={state.loading}
      error={state.error}
      onLogout={actions.clearSession}
    >
      <Outlet />
    </Shell>
  )
}

export const Route = createRootRoute({
  component: RootLayout,
})
