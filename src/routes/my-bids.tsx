import { createFileRoute } from '@tanstack/react-router'

import { RequireLogin } from '../components/RequireLogin'
import { useMyBidAuctions } from '../hooks/useMarketplaceData'
import { MyBidsPage } from '../pages/OrdersPage'
import { useMarketplaceApp } from '../state/AppStateContext'

function MyBidsRoute() {
  const { state } = useMarketplaceApp()
  const myBidAuctions = useMyBidAuctions(state.marketplaceSession, state.refreshRevision)

  return (
    <RequireLogin>
      <MyBidsPage
        auctions={myBidAuctions.auctions}
        bidError={myBidAuctions.error}
        bidLoading={myBidAuctions.loading}
        marketplace={state.marketplace}
        marketplaceSession={state.marketplaceSession}
        refreshRevision={state.refreshRevision}
      />
    </RequireLogin>
  )
}

export const Route = createFileRoute('/my-bids')({
  component: MyBidsRoute,
})
