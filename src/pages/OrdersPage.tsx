import { Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import type * as marketplace from 'nostr-tools/marketplace'

import { CodeHint } from '../codeHints/codeHints'
import { EmptyState } from '../components/EmptyState'
import { OrderWidget } from '../components/OrderWidget'
import { Badge, Button } from '../components/ui'
import { Facts } from '../components/widgets/FactList'
import { Page, PageHeader } from '../components/widgets/PageLayout'
import { AuctionEndValue, TimeAgoText } from '../components/widgets/TimeText'
import {
  bidChainStageClass,
  bidChainStageLabel,
  publicBidChainBuyerPubkey,
} from '../nostr/auctionBidChains'
import { shortPubkey } from '../nostr/inboxThreads'
import type { MyBidChainResolution } from '../types'
import { formatMarketplaceAmount } from '../utils/amountDisplay'

type Props = {
  onOpenThread: (group: marketplace.ParsedOrderGroup, peerRole: 'buyer' | 'seller') => void | Promise<void>
}

type OrderListPageProps = Props & {
  codeHint: string[]
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
  bidChains: MyBidChainResolution[]
  bidError?: string
  bidLoading?: boolean
}

const myBidCodeHint = [
  'const myBidGroups = await marketplaceSession.auctions.bidGroups.mine.fetch({}, { maxWait: 2500 })',
  'const snapshot = await marketplaceSession.auctions.scope({ auctionAnchor }).query({ maxWait: 2500 })',
  'const myBidChains = snapshot.bidChains.filter(chain => isOwnBidChain(chain, sessionPubkey, localBidPubkeys))',
]

const ordersIMadeCodeHint = [
  'const buckets = await marketplaceSession.orders.groups.mine()',
  'const ordersIMade = buckets.buyer',
  'marketplaceSession.orders.groups.mine.stream({}, { maxWait: 2500 })',
]

const ordersOnMyListingsCodeHint = [
  'const buckets = await marketplaceSession.orders.groups.mine()',
  'const ordersOnMyListings = buckets.seller',
  'marketplaceSession.orders.groups.mine.stream({}, { maxWait: 2500 })',
]

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

function bidStageVariant(stageClass: string): 'default' | 'secondary' | 'destructive' {
  if (stageClass === 'commit') return 'default'
  if (stageClass === 'cancel') return 'destructive'
  return 'secondary'
}

function MyBidChainCard({ row }: { row: MyBidChainResolution }) {
  const { auction, chain, listing, snapshot } = row
  const publicBuyerPubkey = publicBidChainBuyerPubkey(chain)
  const stageClass = bidChainStageClass(chain, snapshot.complete)
  const title = listing?.title ?? 'Unresolved auction listing'
  return (
    <article className="grid gap-3 rounded-lg border bg-muted/30 p-4">
      <div className="flex min-w-0 items-start justify-between gap-4 max-[640px]:grid">
        <div className="min-w-0">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {auction.currency} bid chain
          </p>
          <h3 className="text-base font-semibold leading-6 text-foreground">{title}</h3>
          <p className="mt-1 text-sm text-muted-foreground [overflow-wrap:anywhere]">
            head {shortPubkey(chain.head.tradeId)}
            {' · '}
            updated <TimeAgoText seconds={chain.head.bid.event.created_at} />
            {publicBuyerPubkey ? ` · public as ${shortPubkey(publicBuyerPubkey)}` : ' · private bidder'}
          </p>
        </div>
        <Badge className="shrink-0" variant={bidStageVariant(stageClass)}>
          {bidChainStageLabel(chain, snapshot.complete)}
        </Badge>
      </div>
      <Facts
        className="gap-x-6 gap-y-3"
        facts={[
          { label: 'Total bid', value: formatMarketplaceAmount(chain.amount) },
          { label: 'Bid legs', value: chain.groups.length.toString() },
          { label: 'Payments', value: chain.paymentEventIds.length.toString() },
          { label: 'Complete chain', value: chain.complete ? 'Yes' : 'No' },
          { label: 'Auction ends', value: <AuctionEndValue seconds={auction.endAt} /> },
        ]}
      />
      <div className="flex min-w-0 items-center justify-between gap-3 max-[640px]:grid">
        <span className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
          chain {shortPubkey(chain.id)} · auction {shortPubkey(auction.auctionAnchor)}
        </span>
        {listing ? (
          <Button asChild className="max-[640px]:w-full" variant="secondary">
            <Link params={{ listingId: listing.event.id }} to="/listing/$listingId">
              Open
              <ArrowRight />
            </Link>
          </Button>
        ) : (
          <span className="text-sm text-muted-foreground">Listing event not loaded</span>
        )}
      </div>
    </article>
  )
}

function MyBidChainList({
  chains,
  loading,
  error,
}: {
  chains: MyBidChainResolution[]
  loading?: boolean
  error?: string
}) {
  if (chains.length === 0) {
    return (
      <EmptyState
        title={error ? 'Unable to load bids' : loading ? 'Loading bids' : 'No bids'}
        body={error ?? (loading ? 'Scanning auction bid chains.' : 'Auction bids you place will appear here.')}
      />
    )
  }
  return (
    <div className="grid gap-3">
      {chains.map(row => (
        <MyBidChainCard
          key={`${row.auction.auctionAnchor}:${row.chain.id}`}
          row={row}
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

export function MyBidsPage({ bidChains, bidError, bidLoading = false }: MyBidsPageProps) {
  return (
    <Page>
      <PageHeader eyebrow="Buyer" title="My Bids" />
      <CodeHint code={myBidCodeHint} className="rounded-xl">
        <section className="grid content-start gap-3">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-foreground">Bid chains</h2>
            {bidLoading && bidChains.length > 0 && (
              <Badge variant="secondary">Refreshing</Badge>
            )}
          </div>
          <MyBidChainList chains={bidChains} error={bidError} loading={bidLoading} />
        </section>
      </CodeHint>
    </Page>
  )
}
