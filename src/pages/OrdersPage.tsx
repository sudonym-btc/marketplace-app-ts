import type * as marketplace from 'nostr-tools/marketplace'

import { CodeHint } from '../codeHints/codeHints'
import { EmptyState } from '../components/EmptyState'
import { OrderWidget } from '../components/OrderWidget'
import { Badge } from '../components/ui'
import { AuctionWidget } from '../components/widgets/AuctionWidget'
import { Page, PageHeader } from '../components/widgets/PageLayout'
import type { MarketplaceClient, MarketplaceSession, MyBidAuction } from '../types'

type Props = {
  onOpenThread: (group: marketplace.ParsedOrderGroup, peerRole: 'buyer' | 'seller') => void | Promise<void>
}

type OrderListPageProps = Props & {
  codeHint: string | string[]
  emptyBody: string
  emptyTitle: string
  error?: string
  eyebrow: string
  groups: marketplace.ParsedOrderGroup[]
  loading?: boolean
  role: 'buyer' | 'seller'
  title: string
}

type MyBidsPageProps = {
  auctions: MyBidAuction[]
  bidError?: string
  bidLoading?: boolean
  marketplace?: MarketplaceClient
  marketplaceSession?: MarketplaceSession
  refreshRevision?: number
}

const myBidCodeHint = 'marketplaceSession.me.bids.placed.watch()'

const ordersIMadeCodeHint = 'marketplaceSession.me.orders.placed.watch()'

const ordersOnMyListingsCodeHint = 'marketplaceSession.me.orders.received.watch()'

function OrderGroupList({
  emptyBody,
  emptyTitle,
  groups,
  role,
  onOpenThread,
}: {
  emptyBody: string
  emptyTitle: string
  groups: marketplace.ParsedOrderGroup[]
  role: 'buyer' | 'seller'
  onOpenThread: Props['onOpenThread']
}) {
  if (groups.length === 0) return <EmptyState title={emptyTitle} body={emptyBody} />
  const peerRole = role === 'buyer' ? 'seller' : 'buyer'
  return (
    <div className="grid gap-3">
      {groups.map(group => (
        <OrderWidget
          group={group}
          key={`${group.id}:${group.listingAnchor}`}
          onOpen={() => onOpenThread(group, peerRole)}
        />
      ))}
    </div>
  )
}

function MyBidAuctionList({
  auctions,
  loading,
  error,
  marketplace,
  marketplaceSession,
  refreshRevision,
}: {
  auctions: MyBidAuction[]
  loading?: boolean
  error?: string
  marketplace?: MarketplaceClient
  marketplaceSession?: MarketplaceSession
  refreshRevision?: number
}) {
  if (auctions.length === 0) {
    return (
      <EmptyState
        title={error ? 'Unable to load bids' : loading ? 'Loading bids' : 'No bids'}
        body={error ?? (loading ? 'Fetching bids.' : 'Auction bids you place will appear here.')}
      />
    )
  }
  return (
    <div className="grid gap-3">
      {auctions.map(auction => (
        <AuctionWidget
          auctionAnchor={auction.auctionAnchor}
          key={auction.auctionAnchor}
          marketplace={marketplace}
          marketplaceSession={marketplaceSession}
          refreshRevision={refreshRevision}
        />
      ))}
    </div>
  )
}

export function OrdersPage({
  codeHint,
  emptyBody,
  emptyTitle,
  error,
  eyebrow,
  groups,
  loading = false,
  onOpenThread,
  role,
  title,
}: OrderListPageProps) {
  return (
    <Page>
      <PageHeader eyebrow={eyebrow} title={title} />
      {(loading || error) && (
        <div className="mb-4">
          <EmptyState
            title={error ? `Unable to load ${title.toLowerCase()}` : `Loading ${title.toLowerCase()}`}
            body={error ?? 'Subscribing to marketplace order groups.'}
          />
        </div>
      )}
      <CodeHint code={codeHint} className="rounded-xl">
        <section className="grid content-start gap-3">
          <OrderGroupList
            emptyBody={emptyBody}
            emptyTitle={emptyTitle}
            groups={groups}
            role={role}
            onOpenThread={onOpenThread}
          />
        </section>
      </CodeHint>
    </Page>
  )
}

export function SellerOrdersPage({
  error,
  groups,
  loading,
  onOpenThread,
}: Props & {
  error?: string
  groups: marketplace.ParsedOrderGroup[]
  loading?: boolean
}) {
  return (
    <OrdersPage
      codeHint={ordersOnMyListingsCodeHint}
      emptyBody="Buyer reservations for your listings will appear here."
      emptyTitle="No seller orders"
      error={error}
      eyebrow="Seller"
      groups={groups}
      loading={loading}
      role="seller"
      title="Orders"
      onOpenThread={onOpenThread}
    />
  )
}

export function BuyerOrdersPage({
  error,
  groups,
  loading,
  onOpenThread,
}: Props & {
  error?: string
  groups: marketplace.ParsedOrderGroup[]
  loading?: boolean
}) {
  return (
    <OrdersPage
      codeHint={ordersIMadeCodeHint}
      emptyBody="Reservations you create will appear here."
      emptyTitle="No buyer orders"
      error={error}
      eyebrow="Buyer"
      groups={groups}
      loading={loading}
      role="buyer"
      title="My Orders"
      onOpenThread={onOpenThread}
    />
  )
}

export function MyBidsPage({
  auctions,
  bidError,
  bidLoading = false,
  marketplace,
  marketplaceSession,
  refreshRevision,
}: MyBidsPageProps) {
  return (
    <Page>
      <PageHeader eyebrow="Buyer" title="My Bids" />
      <CodeHint code={myBidCodeHint} className="rounded-xl">
        <section className="grid content-start gap-3">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-foreground">Auctions I bid on</h2>
            {bidLoading && auctions.length > 0 && (
              <Badge variant="secondary">Refreshing</Badge>
            )}
          </div>
          <MyBidAuctionList
            auctions={auctions}
            error={bidError}
            loading={bidLoading}
            marketplace={marketplace}
            marketplaceSession={marketplaceSession}
            refreshRevision={refreshRevision}
          />
        </section>
      </CodeHint>
    </Page>
  )
}
