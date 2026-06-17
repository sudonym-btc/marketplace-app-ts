import { createFileRoute } from '@tanstack/react-router'

import { RequireLogin } from '../components/RequireLogin'
import { useRouteFetch } from '../hooks/useMarketplaceData'
import { ListingsPage } from '../pages/ListingsPage'
import { useMarketplaceApp } from '../state/AppStateContext'

function MyListingsRoute() {
  const { state } = useMarketplaceApp()
  const marketplaceClient = state.marketplace
  const sessionPubkey = state.session?.pubkey
  const listings = useRouteFetch(
    async () => {
      if (!sessionPubkey) return []
      return marketplaceClient.listings.search({ authors: [sessionPubkey], limit: 80 })
    },
    [],
    [marketplaceClient, sessionPubkey, state.refreshRevision],
  )

  return (
    <RequireLogin>
      <ListingsPage
        error={listings.error}
        listings={listings.data}
        loading={listings.loading}
        marketplace={marketplaceClient}
        signedIn={Boolean(state.session)}
        editable
        label="Seller"
        title="My Listings"
        emptyTitle="No listings published"
        emptyBody="Add a listing to publish it to the local marketplace relay."
      />
    </RequireLogin>
  )
}

export const Route = createFileRoute('/my-listings')({
  component: MyListingsRoute,
})
