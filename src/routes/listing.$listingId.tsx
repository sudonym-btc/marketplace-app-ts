import { createFileRoute, useNavigate } from '@tanstack/react-router'

import { useRouteFetch } from '../hooks/useMarketplaceData'
import { ListingDetailPage } from '../pages/ListingDetailPage'
import { useMarketplaceApp } from '../state/AppStateContext'

function ListingRoute() {
  const { listingId } = Route.useParams()
  const navigate = useNavigate()
  const { state, publisher, actions } = useMarketplaceApp()
  const marketplaceClient = state.marketplace
  const listing = useRouteFetch(
    () => marketplaceClient.listings.findById(listingId),
    null,
    [listingId, marketplaceClient, state.refreshRevision],
  )

  return (
    <ListingDetailPage
      listing={listing.data ?? undefined}
      marketplace={marketplaceClient}
      marketplaceSession={state.marketplaceSession}
      session={state.session}
      publisher={publisher}
      evmBlockExplorerUrl={state.config.evm.blockExplorerUrl}
      onPublished={actions.refreshAll}
      onError={actions.setError}
      onLoginRequired={message => {
        actions.setError(message)
        void navigate({ to: '/login' })
      }}
    />
  )
}

export const Route = createFileRoute('/listing/$listingId')({
  component: ListingRoute,
})
