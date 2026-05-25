import { useEffect, useMemo } from 'react'

import { Shell } from './components/Shell'
import { LoginPage } from './pages/LoginPage'
import { ListingsPage } from './pages/ListingsPage'
import { ListingDetailPage } from './pages/ListingDetailPage'
import { InboxPage } from './pages/InboxPage'
import { ListingEditorPage } from './pages/ListingEditorPage'
import { OrdersPage } from './pages/OrdersPage'
import { SettingsPage } from './pages/SettingsPage'
import { useAppState } from './state/appState'

export function App() {
  const { state, publisher, actions } = useAppState()
  const route = state.route

  useEffect(() => {
    void actions.restore()
  }, [])

  const selectedListing = useMemo(() => {
    if (route.name !== 'listing') return undefined
    return state.listings.find(listing => listing.event.id === route.id)
  }, [route, state.listings])

  if (!state.session || !publisher) {
    return (
      <LoginPage
        relays={state.config.relays}
        loading={state.loading}
        onLogin={actions.attachSession}
        onError={actions.setError}
      />
    )
  }

  return (
    <Shell
      route={state.route}
      session={state.session}
      marketplace={state.marketplace}
      status={state.status}
      loading={state.loading}
      error={state.error}
      onRefresh={actions.refreshAll}
    >
      {state.route.name === 'listing' && (
        <ListingDetailPage
          listing={selectedListing}
          marketplaceState={state.marketplace}
          publisher={publisher}
          onPublished={actions.refreshAll}
          onError={actions.setError}
        />
      )}
      {state.route.name === 'inbox' && <InboxPage inbox={state.inbox} />}
      {state.route.name === 'orders' && (
        <OrdersPage mine={state.orders.mine} onMyListings={state.orders.onMyListings} />
      )}
      {state.route.name === 'edit-listing' && (
        <ListingEditorPage publisher={publisher} onPublished={actions.refreshAll} onError={actions.setError} />
      )}
      {state.route.name === 'settings' && (
        <SettingsPage config={state.config} session={state.session} marketplace={state.marketplace} />
      )}
      {state.route.name === 'listings' && <ListingsPage listings={state.listings} />}
    </Shell>
  )
}
