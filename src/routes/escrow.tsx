import { createFileRoute } from '@tanstack/react-router'

import { RequireLogin } from '../components/RequireLogin'
import type { EscrowDashboardAction, EscrowDashboardRecord } from '../escrow/types'
import { useEscrowDashboard } from '../hooks/useEscrowDashboard'
import { EscrowDashboardPage } from '../pages/EscrowDashboardPage'
import { useMarketplaceApp } from '../state/AppStateContext'

function EscrowRoute() {
  const { state, actions } = useMarketplaceApp()
  const dashboard = useEscrowDashboard(state.marketplaceSession, state.refreshRevision)

  async function execute(record: EscrowDashboardRecord, action: EscrowDashboardAction): Promise<void> {
    try {
      await dashboard.execute(record, action)
      actions.notify({
        level: 'info',
        title: 'Escrow action completed',
        message: `${action.label} completed for ${record.kind === 'order' ? 'order' : 'auction bid'} ${record.tradeId}.`,
      })
    } catch (err) {
      actions.notify({
        level: 'error',
        title: 'Escrow action failed',
        message: err instanceof Error ? err.message : 'The driver could not complete this action.',
      })
    }
  }

  return (
    <RequireLogin>
      <EscrowDashboardPage
        identity={state.marketplaceSession?.identity.pubkey ?? state.session?.pubkey ?? ''}
        records={dashboard.records}
        drivers={dashboard.drivers}
        loading={dashboard.loading}
        error={dashboard.error}
        executing={dashboard.executing}
        onRefresh={dashboard.refresh}
        onExecute={execute}
      />
    </RequireLogin>
  )
}

export const Route = createFileRoute('/escrow')({
  component: EscrowRoute,
})

