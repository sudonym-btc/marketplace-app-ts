import { createFileRoute } from '@tanstack/react-router'

import { useRouteFetch } from '../hooks/useMarketplaceData'
import { ListingsPage } from '../pages/ListingsPage'
import { useMarketplaceApp } from '../state/AppStateContext'

function ListingsRoute() {
  const { state } = useMarketplaceApp()
  const marketplaceClient = state.marketplace?.runtime ?? state.publicMarketplace
  const listings = useRouteFetch(
    () => marketplaceClient.listings.search({ limit: 80 }),
    [],
    [marketplaceClient, state.refreshRevision],
  )
  return (
    <ListingsPage
      error={listings.error}
      listings={listings.data}
      loading={listings.loading}
      marketplace={marketplaceClient}
      signedIn={Boolean(state.session)}
    />
  )
}

export const Route = createFileRoute('/')({
  component: ListingsRoute,
})
