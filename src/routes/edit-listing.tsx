import { createFileRoute, useNavigate } from '@tanstack/react-router'

import { RequireLogin } from '../components/RequireLogin'
import { useRouteFetch } from '../hooks/useMarketplaceData'
import { ListingEditorPage } from '../pages/ListingEditorPage'
import { useMarketplaceApp } from '../state/AppStateContext'

type EditListingSearch = {
  listingId?: string
}

function EditListingRoute() {
  const navigate = useNavigate()
  const search = Route.useSearch()
  const { state, publisher, actions } = useMarketplaceApp()
  const marketplaceClient = state.marketplace
  const listing = useRouteFetch(
    () => search.listingId ? marketplaceClient.listings.findById(search.listingId) : Promise.resolve(null),
    null,
    [marketplaceClient, search.listingId, state.refreshRevision],
  )

  if (!state.session || !publisher) return <RequireLogin><></></RequireLogin>

  return (
    <RequireLogin>
      <ListingEditorPage
        blossomUploadUrl={state.config.blossomUploadUrl}
        listing={listing.data ?? undefined}
        loading={listing.loading}
        publisher={publisher}
        onPublished={async () => {
          await actions.refreshAll()
          await navigate({ to: '/my-listings' })
        }}
        onError={actions.setError}
      />
    </RequireLogin>
  )
}

export const Route = createFileRoute('/edit-listing')({
  validateSearch: (search: Record<string, unknown>): EditListingSearch => ({
    listingId: typeof search.listingId === 'string' ? search.listingId : undefined,
  }),
  component: EditListingRoute,
})
