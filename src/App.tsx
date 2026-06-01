import { useEffect, useMemo } from 'react'
import type * as marketplace from 'nostr-tools/marketplace'

import { Shell } from './components/Shell'
import { LoginPage } from './pages/LoginPage'
import { SessionErrorPage } from './pages/SessionErrorPage'
import { ListingsPage } from './pages/ListingsPage'
import { ListingDetailPage } from './pages/ListingDetailPage'
import { InboxPage } from './pages/InboxPage'
import { ListingEditorPage } from './pages/ListingEditorPage'
import { OrdersPage } from './pages/OrdersPage'
import { SettingsPage } from './pages/SettingsPage'
import { useAppState } from './state/appState'
import { routeHref } from './state/routing'

function buyerPeerPubkey(group: marketplace.ParsedOrderGroup): string | undefined {
  return group.buyerOrder?.event.pubkey ?? group.participants.find(participant => participant.role === 'buyer')?.pubkey
}

let initialRestoreStarted = false

export function App() {
  const { state, publisher, actions } = useAppState()
  const route = state.route

  useEffect(() => {
    if (initialRestoreStarted) return
    initialRestoreStarted = true
    void actions.restore()
  }, [])

  const selectedListing = useMemo(() => {
    if (route.name !== 'listing') return undefined
    return state.listings.find(listing => listing.event.id === route.id)
  }, [route, state.listings])
  const inboxOrderGroups = useMemo(() => {
    const groups = new Map<string, marketplace.ParsedOrderGroup>()
    for (const group of [...state.orders.mine, ...state.orders.onMyListings]) {
      groups.set(`${group.id}:${group.listingAnchor}`, group)
    }
    return [...groups.values()]
  }, [state.orders.mine, state.orders.onMyListings])

  if (!state.session || !publisher) {
    if (state.sessionError) {
      return (
        <SessionErrorPage
          error={state.sessionError}
          loading={state.loading}
          onRetry={actions.restore}
          onClearSession={actions.clearSession}
        />
      )
    }
    return (
      <LoginPage
        relays={state.config.relays}
        loading={state.loading}
        error={state.error}
        onLogin={actions.attachSession}
        onError={actions.setError}
      />
    )
  }
  const session = state.session

  async function openOrderThread(group: marketplace.ParsedOrderGroup, peerRole: 'buyer' | 'seller') {
    let peerPubkey = peerRole === 'seller' ? group.sellerPubkey : buyerPeerPubkey(group)
    if (peerRole === 'buyer' && state.marketplace) {
      try {
        const resolved = await state.marketplace.runtime.orders.groups.resolveParticipants(group, {
          signer: session.signer,
          signerPubkey: session.pubkey,
        })
        peerPubkey = resolved.participants.find(participant =>
          participant.role === 'buyer' && participant.realPubkey)?.realPubkey ?? peerPubkey
      } catch (err) {
        console.warn('[marketplace-app] unable to resolve buyer participant for order thread', {
          tradeId: group.tradeId,
        }, err)
      }
    }
    if (!peerPubkey) {
      actions.setError('No order participant found for this thread')
      return
    }
    const participants = [session.pubkey, peerPubkey].sort((a, b) => a.localeCompare(b))
    console.debug('[marketplace-app] opening order thread from orders page', {
      tradeId: group.tradeId,
      peerRole,
      peerPubkey,
      participantCount: participants.length,
    })
    window.location.hash = routeHref({
      name: 'inbox',
      thread: { conversation: group.tradeId, participants },
    })
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
          session={state.session}
          publisher={publisher}
          onTradeIndexUsed={actions.markTradeIndexUsed}
          onPublished={actions.refreshAll}
          onError={actions.setError}
        />
      )}
      {state.route.name === 'inbox' && (
        <InboxPage
          inbox={state.inbox}
          marketplaceState={state.marketplace}
          orderGroups={inboxOrderGroups}
          session={state.session}
          targetThread={route.name === 'inbox' ? route.thread : undefined}
          publisher={publisher}
          onSent={actions.refreshInbox}
          onOrdersChanged={actions.refreshAll}
          onError={actions.setError}
        />
      )}
      {state.route.name === 'orders' && (
        <OrdersPage
          mine={state.orders.mine}
          onMyListings={state.orders.onMyListings}
          onOpenThread={openOrderThread}
        />
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
