import { createFileRoute } from '@tanstack/react-router'

import { useRouteFetch } from '../hooks/useMarketplaceData'
import { AuctionsPage } from '../pages/AuctionsPage'
import { useMarketplaceApp } from '../state/AppStateContext'

function AuctionsRoute() {
  const { state } = useMarketplaceApp()
  const marketplaceClient = state.marketplace?.runtime ?? state.publicMarketplace
  const rows = useRouteFetch(
    async () => {
      const auctions = await marketplaceClient.auctions.search({ limit: 80 })
      return Promise.all(auctions.map(async auction => {
        try {
          const snapshot = await marketplaceClient.auctions.scope({ auctionAnchor: auction.auctionAnchor }).query({ maxWait: 2500 })
          const resolvedAuction = snapshot.auction ?? auction
          return {
            auction: resolvedAuction,
            listing: await marketplaceClient.listings.findByAnchor(resolvedAuction.listingAnchor),
            snapshot,
          }
        } catch (err) {
          return {
            auction,
            listing: null,
            error: err instanceof Error ? err.message : 'Unable to resolve auction listing',
          }
        }
      }))
    },
    [],
    [marketplaceClient, state.refreshRevision],
  )
  return (
    <AuctionsPage
      error={rows.error}
      loading={rows.loading}
      marketplace={marketplaceClient}
      rows={rows.data}
    />
  )
}

export const Route = createFileRoute('/auctions')({
  component: AuctionsRoute,
})
