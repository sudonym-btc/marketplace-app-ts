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
      marketplace={state.marketplace}
      onClearMarketplaceLog={actions.clearMarketplaceLog}
      onPaymentMethodUpdated={actions.refreshAll}
    />
  )
}

export const Route = createFileRoute('/settings')({
  component: SettingsRoute,
})
