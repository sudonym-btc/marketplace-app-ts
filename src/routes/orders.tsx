import { createFileRoute } from '@tanstack/react-router'

import { RequireLogin } from '../components/RequireLogin'
import { useOrderBuckets } from '../hooks/useMarketplaceData'
import { useOpenOrderThread } from '../hooks/useOpenOrderThread'
import { SellerOrdersPage } from '../pages/OrdersPage'
import { useMarketplaceApp } from '../state/AppStateContext'

function OrdersRoute() {
  const { state } = useMarketplaceApp()
  const orderBuckets = useOrderBuckets(state.marketplace, state.refreshRevision)
  const openOrderThread = useOpenOrderThread()

  return (
    <RequireLogin>
      <SellerOrdersPage
        error={orderBuckets.error}
        loading={orderBuckets.loading}
        groups={orderBuckets.orders.onMyListings}
        onOpenThread={openOrderThread}
      />
    </RequireLogin>
  )
}

export const Route = createFileRoute('/orders')({
  component: OrdersRoute,
})
