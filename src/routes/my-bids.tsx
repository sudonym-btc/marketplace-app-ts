import { createFileRoute } from '@tanstack/react-router'

import { RequireLogin } from '../components/RequireLogin'
import { useMyBidChains } from '../hooks/useMarketplaceData'
import { MyBidsPage } from '../pages/OrdersPage'
import { useMarketplaceApp } from '../state/AppStateContext'

function MyBidsRoute() {
  const { state } = useMarketplaceApp()
  const myBidChains = useMyBidChains(state.marketplace, state.session, state.refreshRevision)

  return (
    <RequireLogin>
      <MyBidsPage
        bidChains={myBidChains.bidChains}
        bidError={myBidChains.error}
        bidLoading={myBidChains.loading}
      />
    </RequireLogin>
  )
}

export const Route = createFileRoute('/my-bids')({
  component: MyBidsRoute,
})
