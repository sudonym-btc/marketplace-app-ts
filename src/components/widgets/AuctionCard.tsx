import { Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import type * as marketplaceSdk from 'nostr-tools/marketplace'

import type { AuctionListingResolution } from '../../types'
import { formatDenominatedValue, formatPriceAmount } from '../../utils/amountDisplay'
import { formatDateTime } from '../../utils/timeDisplay'
import { Badge, Button, Card } from '../ui'
import { Facts } from './FactList'
import { AuctionEndValue } from './TimeText'

type AuctionCardProps = {
  backfillComplete?: boolean
  row: AuctionListingResolution
  snapshot?: marketplaceSdk.MarketplaceAuctionScopeSnapshot
}

function shortPubkey(pubkey: string): string {
  return `${pubkey.slice(0, 8)}...${pubkey.slice(-6)}`
}

function auctionStatus(auction: AuctionListingResolution['auction']): string {
  const now = Math.floor(Date.now() / 1000)
  if (auction.endAt && now >= auction.endAt) return 'Ended'
  if (auction.startAt && now < auction.startAt) return 'Scheduled'
  return 'Live'
}

function formatListingPrice(listing: NonNullable<AuctionListingResolution['listing']>): string {
  const price = listing.prices[0]
  if (!price) return 'No price'
  return `${formatPriceAmount(price.amount, price.currency)}${price.frequency ? ` / ${price.frequency}` : ''}`
}

export function AuctionCard({ backfillComplete, row, snapshot }: AuctionCardProps) {
  const { auction, listing } = row
  const image = listing?.images[0]?.url
  const summary = listing?.summary || listing?.description
  const highestBid = snapshot?.highestBid?.amount
  const paymentSummary = snapshot
    ? `${snapshot.payments.length} / ${snapshot.paymentAcks.length} ack / ${snapshot.paymentNacks.length} nack`
    : 'Loading'
  const status = snapshot?.complete?.status ?? auctionStatus(auction)

  return (
    <Card className="overflow-hidden p-0 shadow-sm">
      <article className="grid grid-cols-[168px_minmax(0,1fr)] max-[720px]:grid-cols-1">
        <div className="relative min-h-44 bg-muted max-[720px]:aspect-[16/9] max-[720px]:min-h-0">
          {image ? (
            <img className="size-full object-cover" src={image} alt="" />
          ) : (
            <div className="grid size-full place-items-center">
              <span className="text-5xl font-semibold text-muted-foreground">
                {(listing?.title ?? 'A').slice(0, 1).toUpperCase()}
              </span>
            </div>
          )}
          <Badge className="absolute left-3 top-3 bg-background/90 text-foreground shadow-sm backdrop-blur">
            {status}
          </Badge>
        </div>
        <div className="grid gap-4 p-4">
          <div className="flex min-w-0 items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {auction.currency} {auction.auctionType ?? 'english'} auction
              </p>
              <h3 className="text-base font-semibold leading-6 text-foreground">
                {listing?.title ?? 'Unresolved listing'}
              </h3>
              {summary && <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">{summary}</p>}
            </div>
            {listing && (
              <strong className="shrink-0 text-sm font-semibold text-foreground">
                {formatListingPrice(listing)}
              </strong>
            )}
          </div>
          <Facts
            className="gap-x-6 gap-y-3"
            facts={[
              { label: 'Starting bid', value: formatDenominatedValue(auction.startingBid, auction.decimals, auction.currency) },
              {
                label: 'Highest bid',
                value: highestBid
                  ? formatDenominatedValue(highestBid.value, highestBid.decimals, highestBid.denomination)
                  : 'None',
              },
              { label: 'Bids', value: snapshot ? snapshot.bidGroups.length.toString() : 'Loading' },
              { label: 'Payments', value: paymentSummary },
              { label: 'Starts', value: formatDateTime(auction.startAt) },
              { label: 'Ends', value: <AuctionEndValue seconds={auction.endAt} /> },
              { label: 'Backfill', value: backfillComplete ? 'EOSE' : 'Syncing' },
              { label: 'Arbiter', value: shortPubkey(auction.arbiterPubkey) },
            ]}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">
              {listing ? 'Open classified to bid' : row.error ?? 'Listing event not loaded'}
            </span>
            {listing && (
              <Button asChild variant="secondary">
                <Link params={{ listingId: listing.event.id }} to="/listing/$listingId">
                  Open
                  <ArrowRight />
                </Link>
              </Button>
            )}
          </div>
        </div>
      </article>
    </Card>
  )
}
