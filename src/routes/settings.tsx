import { createFileRoute } from '@tanstack/react-router'

import { SettingsPage } from '../pages/SettingsPage'
import { useMarketplaceApp } from '../state/AppStateContext'

function SettingsRoute() {
  const { state, actions } = useMarketplaceApp()

  return (
    <SettingsPage
      config={state.config}
      marketplaceLog={state.marketplaceLog}
      session={state.session}
      marketplaceSession={state.marketplaceSession}
      loading={state.loading}
      onClearMarketplaceLog={actions.clearMarketplaceLog}
      onPaymentMethodUpdated={actions.refreshAll}
      onRefresh={actions.refreshAll}
    />
  )
}

export const Route = createFileRoute('/settings')({
  component: SettingsRoute,
})
