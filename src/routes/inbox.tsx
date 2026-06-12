import { createFileRoute, useNavigate } from '@tanstack/react-router'
import type * as marketplace from 'nostr-tools/marketplace'

import { RequireLogin } from '../components/RequireLogin'
import { useInboxItems, useOrderBuckets } from '../hooks/useMarketplaceData'
import { InboxPage } from '../pages/InboxPage'
import { useMarketplaceApp } from '../state/AppStateContext'

type InboxSearch = {
  conversation?: string
  participants?: string
}

function uniqueOrderGroups(groups: marketplace.ParsedOrderGroup[]): marketplace.ParsedOrderGroup[] {
  const byId = new Map<string, marketplace.ParsedOrderGroup>()
  for (const group of groups) byId.set(`${group.id}:${group.listingAnchor}`, group)
  return [...byId.values()]
}

function InboxRoute() {
  const navigate = useNavigate()
  const search = Route.useSearch()
  const { state, publisher, actions } = useMarketplaceApp()
  const marketplaceSession = state.marketplace?.runtime
  const inboxItems = useInboxItems(marketplaceSession, state.refreshRevision)
  const orderBuckets = useOrderBuckets(state.marketplace, state.refreshRevision)

  if (!state.session || !publisher) return <RequireLogin><></></RequireLogin>

  const orderGroups = uniqueOrderGroups([...orderBuckets.orders.mine, ...orderBuckets.orders.onMyListings])
  const targetThread = search.conversation
    ? {
        conversation: search.conversation,
        participants: search.participants?.split(',').filter(Boolean) ?? [],
      }
    : undefined

  return (
    <RequireLogin>
      <InboxPage
        error={inboxItems.error ?? orderBuckets.error}
        inbox={inboxItems.inbox}
        loading={inboxItems.loading || orderBuckets.loading}
        orderGroups={orderGroups}
        marketplaceState={state.marketplace}
        targetThread={targetThread}
        onTargetThreadCleared={() => void navigate({ to: '/inbox' })}
        session={state.session}
        publisher={publisher}
        onSent={inboxItems.refresh}
        onOrdersChanged={orderBuckets.refresh}
        onError={actions.setError}
      />
    </RequireLogin>
  )
}

export const Route = createFileRoute('/inbox')({
  validateSearch: (search: Record<string, unknown>): InboxSearch => ({
    conversation: typeof search.conversation === 'string' ? search.conversation : undefined,
    participants: typeof search.participants === 'string' ? search.participants : undefined,
  }),
  component: InboxRoute,
})
