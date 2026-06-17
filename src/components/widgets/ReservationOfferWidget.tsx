import { Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import * as marketplace from 'nostr-tools/marketplace'

import { formatAmount, formatDate, shortPubkey } from '../../nostr/inboxThreads'
import { useMarketplaceApp } from '../../state/AppStateContext'
import { Button, Skeleton, cn } from '../ui'
import { AdvancedAccordion } from './AdvancedAccordion'
import { Facts } from './FactList'

type ListingState =
  | { status: 'idle' | 'loading'; listing?: undefined; error?: undefined }
  | { status: 'loaded'; listing: marketplace.MarketplaceListing; error?: undefined }
  | { status: 'missing'; listing?: undefined; error?: string }

type Props = {
  order: marketplace.ParsedOrder
}

function listingFallbackText(anchor: string): string {
  const parts = anchor.split(':')
  return parts.length >= 3 ? parts.slice(2).join(':') : shortPubkey(anchor)
}

function embeddedListing(order: marketplace.ParsedOrder): marketplace.MarketplaceListing | undefined {
  if (!order.content.listing) return undefined
  try {
    return marketplace.listings.parse(order.content.listing)
  } catch (err) {
    console.warn('[marketplace-app] unable to parse embedded offer listing', {
      orderId: order.event.id,
      listingAnchor: order.listingAnchor,
    }, err)
    return undefined
  }
}

function ListingPreview({
  anchor,
  listingState,
}: {
  anchor: string
  listingState: ListingState
}) {
  const listing = listingState.status === 'loaded' ? listingState.listing : undefined
  const image = listing?.images[0]?.url
  const fallbackTitle = listingState.status === 'missing'
    ? listingState.error ?? 'Listing unavailable'
    : listingFallbackText(anchor)
  const title = listing?.title ?? fallbackTitle

  if (listingState.status === 'loading') {
    return (
      <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-md border border-border/70 bg-background/60 p-3">
        <Skeleton className="size-14 shrink-0 rounded-md" />
        <div className="grid min-w-0 gap-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
    )
  }

  return (
    <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-border/70 bg-background/60 p-3 max-[640px]:grid-cols-[auto_minmax(0,1fr)]">
      <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-md bg-muted text-sm font-semibold text-muted-foreground">
        {image ? (
          <img
            alt={listing?.title ? `${listing.title} listing image` : ''}
            className="size-full object-cover"
            src={image}
          />
        ) : (
          <span>{title.slice(0, 1).toUpperCase()}</span>
        )}
      </div>
      <div className="min-w-0">
        <span className="block truncate text-sm font-semibold text-foreground">{title}</span>
        {listing?.location && <span className="mt-1 block truncate text-xs text-muted-foreground">{listing.location}</span>}
        {!listing?.location && (
          <span className="mt-1 block truncate text-xs text-muted-foreground">{shortPubkey(anchor)}</span>
        )}
      </div>
      {listing && (
        <Button
          asChild
          className="max-[640px]:col-span-2"
          size="sm"
          variant="secondary"
        >
          <Link params={{ listingId: listing.event.id }} to="/listing/$listingId">
            Open listing
          </Link>
        </Button>
      )}
    </div>
  )
}

function roleLabel(role: string): string {
  return role.slice(0, 1).toUpperCase() + role.slice(1)
}

function formatUnixTimestamp(timestamp: number | undefined): string | undefined {
  if (!timestamp) return undefined
  return new Date(timestamp * 1000).toLocaleString()
}

function participantFacts(order: marketplace.ParsedOrder): { label: string; value: string }[] {
  return order.participants.map(participant => ({
    label: roleLabel(participant.role ?? 'participant'),
    value: shortPubkey(participant.pubkey),
  }))
}

function extraFacts(order: marketplace.ParsedOrder): { label: string; value: string }[] {
  const published = formatUnixTimestamp(order.publishedAt)
  return [
    { label: 'Quantity', value: String(order.content.quantity) },
    { label: 'Trade', value: shortPubkey(order.tradeId) },
    { label: 'Order group', value: shortPubkey(order.orderGroupId) },
    { label: 'Order event', value: shortPubkey(order.event.id) },
    { label: 'Author role', value: roleLabel(order.authorRole) },
    ...(order.content.recipient ? [{ label: 'Recipient', value: shortPubkey(order.content.recipient) }] : []),
    ...(published ? [{ label: 'Published', value: published }] : []),
    { label: 'Listing anchor', value: shortPubkey(order.listingAnchor) },
    { label: 'Participant proofs', value: String(order.participantProofs.length) },
    { label: 'Proof keys', value: String(order.participantProofKeys.length) },
  ]
}

export function ReservationOfferWidget({ order }: Props) {
  const { state } = useMarketplaceApp()
  const marketplaceClient = state.marketplace
  const [listingState, setListingState] = useState<ListingState>(() => {
    const listing = embeddedListing(order)
    return listing ? { status: 'loaded', listing } : { status: 'idle' }
  })
  const start = formatDate(order.content.start)
  const end = formatDate(order.content.end)
  const advancedFacts = extraFacts(order)
  const participants = participantFacts(order)

  useEffect(() => {
    let cancelled = false
    const fallback = embeddedListing(order)
    setListingState(fallback ? { status: 'loaded', listing: fallback } : { status: 'loading' })
    marketplaceClient.listings.findByAnchor(order.listingAnchor)
      .then(listing => {
        if (cancelled) return
        setListingState(listing
          ? { status: 'loaded', listing }
          : fallback
            ? { status: 'loaded', listing: fallback }
            : { status: 'missing', error: 'Listing unavailable' })
      })
      .catch(err => {
        if (cancelled) return
        console.warn('[marketplace-app] offer listing fetch failed', {
          orderId: order.event.id,
          listingAnchor: order.listingAnchor,
        }, err)
        setListingState(fallback
          ? { status: 'loaded', listing: fallback }
          : { status: 'missing', error: err instanceof Error ? err.message : 'Listing unavailable' })
      })
    return () => {
      cancelled = true
    }
  }, [marketplaceClient, order, order.event.id, order.listingAnchor])

  return (
    <section className="grid min-w-0 gap-3">
      <ListingPreview anchor={order.listingAnchor} listingState={listingState} />
      <Facts
        facts={[
          { label: 'Offered amount', value: formatAmount(order.content.amount) },
          ...(start ? [{ label: 'Start', value: start }] : []),
          ...(end ? [{ label: 'End', value: end }] : []),
        ]}
      />
      <AdvancedAccordion
        className={cn('bg-background/50', advancedFacts.length === 0 && participants.length === 0 && 'hidden')}
        summary={`${advancedFacts.length + participants.length} fields`}
      >
        <Facts compact facts={advancedFacts} />
        {participants.length > 0 && (
          <div className="grid gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Participants</span>
            <Facts compact facts={participants} />
          </div>
        )}
      </AdvancedAccordion>
    </section>
  )
}
