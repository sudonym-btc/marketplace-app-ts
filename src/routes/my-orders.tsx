import { createFileRoute } from '@tanstack/react-router'

import { RequireLogin } from '../components/RequireLogin'
import { useMyOrders } from '../hooks/useMarketplaceData'
import { useOpenOrderThread } from '../hooks/useOpenOrderThread'
import { BuyerOrdersPage } from '../pages/OrdersPage'
import { useMarketplaceApp } from '../state/AppStateContext'

function MyOrdersRoute() {
  const { state } = useMarketplaceApp()
  const myOrders = useMyOrders(state.marketplaceSession, state.refreshRevision)
  const openOrderThread = useOpenOrderThread()

  return (
    <RequireLogin>
      <BuyerOrdersPage
        error={myOrders.error}
        groups={myOrders.orders.placed}
        loading={myOrders.loading}
        onOpenThread={openOrderThread}
      />
    </RequireLogin>
  )
}

export const Route = createFileRoute('/my-orders')({
  component: MyOrdersRoute,
})
