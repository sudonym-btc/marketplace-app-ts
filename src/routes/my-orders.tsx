import { createFileRoute } from '@tanstack/react-router'

import { RequireLogin } from '../components/RequireLogin'
import { useOrderBuckets } from '../hooks/useMarketplaceData'
import { useOpenOrderThread } from '../hooks/useOpenOrderThread'
import { BuyerOrdersPage } from '../pages/OrdersPage'
import { useMarketplaceApp } from '../state/AppStateContext'

function MyOrdersRoute() {
  const { state } = useMarketplaceApp()
  const orderBuckets = useOrderBuckets(state.marketplace, state.refreshRevision)
  const openOrderThread = useOpenOrderThread()

  return (
    <RequireLogin>
      <BuyerOrdersPage
        error={orderBuckets.error}
        groups={orderBuckets.orders.mine}
        loading={orderBuckets.loading}
        onOpenThread={openOrderThread}
      />
    </RequireLogin>
  )
}

export const Route = createFileRoute('/my-orders')({
  component: MyOrdersRoute,
})
