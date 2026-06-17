import { createFileRoute } from '@tanstack/react-router'

import { RequireLogin } from '../components/RequireLogin'
import { useMyOrders } from '../hooks/useMarketplaceData'
import { useOpenOrderThread } from '../hooks/useOpenOrderThread'
import { SellerOrdersPage } from '../pages/OrdersPage'
import { useMarketplaceApp } from '../state/AppStateContext'

function OrdersRoute() {
  const { state } = useMarketplaceApp()
  const myOrders = useMyOrders(state.marketplaceSession, state.refreshRevision)
  const openOrderThread = useOpenOrderThread()

  return (
    <RequireLogin>
      <SellerOrdersPage
        error={myOrders.error}
        loading={myOrders.loading}
        groups={myOrders.orders.received}
        onOpenThread={openOrderThread}
      />
    </RequireLogin>
  )
}

export const Route = createFileRoute('/orders')({
  component: OrdersRoute,
})
