import type { Event, EventTemplate, VerifiedEvent } from 'nostr-tools/core'
import * as kinds from 'nostr-tools/kinds'
import * as marketplace from 'nostr-tools/marketplace'

import type { AppSession, ListingFormValue, NostrPublisher, OrderBucket } from '../types'
import { publishGiftWrappedRumor } from './privateMessages'

type RelayReader = Pick<AppSession, 'pool' | 'relays'>

export type AuctionListingResolution = {
  auction: marketplace.ParsedMarketplaceAuction
  listing: marketplace.MarketplaceListing | null
  error?: string
}

export function listingAnchor(event: Event): string {
  const d = event.tags.find(tag => tag[0] === 'd')?.[1]
  return `${event.kind}:${event.pubkey}:${d ?? event.id}`
}

export async function fetchListings(reader: RelayReader): Promise<marketplace.MarketplaceListing[]> {
  console.debug('[marketplace-app] fetching listings', { relayCount: reader.relays.length })
  const events = await reader.pool.querySync(
    reader.relays,
    marketplace.listings.filters.search({ limit: 80 }),
  )
  const invalidCount = events.filter(event => !marketplace.listings.validate(event)).length
  if (invalidCount > 0) {
    console.warn('[marketplace-app] ignoring invalid listing events', { invalidCount })
  }
  const listings = events.filter(marketplace.listings.validate).map(marketplace.listings.parse)
  console.debug('[marketplace-app] fetched listings', {
    eventCount: events.length,
    listingCount: listings.length,
  })
  return listings
}

export async function fetchAuctions(
  runtime: ReturnType<typeof marketplace.bind>,
): Promise<marketplace.ParsedMarketplaceAuction[]> {
  console.debug('[marketplace-app] fetching auctions')
  const auctions = await runtime.auctions.search({ limit: 80 })
  console.debug('[marketplace-app] fetched auctions', { auctionCount: auctions.length })
  return auctions
}

function listingAnchorParts(anchor: string): { kind: number; pubkey: string; d: string } {
  const [kindValue, pubkey, ...rest] = anchor.split(':')
  const kind = Number.parseInt(kindValue, 10)
  if (!Number.isSafeInteger(kind) || !pubkey || rest.length === 0) {
    throw new Error(`Invalid listing anchor: ${anchor}`)
  }
  return { kind, pubkey, d: rest.join(':') }
}

export async function fetchListingByAnchor(
  reader: RelayReader,
  anchor: string,
): Promise<marketplace.MarketplaceListing | null> {
  const { kind, pubkey, d } = listingAnchorParts(anchor)
  console.debug('[marketplace-app] fetching listing by anchor', { anchor })
  const events = await reader.pool.querySync(reader.relays, {
    kinds: [kind],
    authors: [pubkey],
    '#d': [d],
    limit: 5,
  })
  const listings = events
    .filter(marketplace.listings.validate)
    .map(marketplace.listings.parse)
    .sort((a, b) => b.event.created_at - a.event.created_at || b.event.id.localeCompare(a.event.id))
  if (!listings[0]) {
    console.warn('[marketplace-app] listing not found for auction anchor', { anchor })
    return null
  }
  return listings[0]
}

export async function fetchAuctionRows(
  reader: RelayReader,
  runtime: ReturnType<typeof marketplace.bind>,
): Promise<AuctionListingResolution[]> {
  const auctions = await fetchAuctions(runtime)
  return Promise.all(auctions.map(async auction => {
    try {
      return {
        auction,
        listing: await fetchListingByAnchor(reader, auction.listingAnchor),
      }
    } catch (err) {
      console.warn('[marketplace-app] unable to resolve auction listing', {
        auctionAnchor: auction.auctionAnchor,
        listingAnchor: auction.listingAnchor,
      }, err)
      return {
        auction,
        listing: null,
        error: err instanceof Error ? err.message : 'Unable to resolve auction listing',
      }
    }
  }))
}

export async function fetchListingById(reader: RelayReader, id: string): Promise<marketplace.MarketplaceListing | null> {
  console.debug('[marketplace-app] fetching listing by id', { id })
  const [event] = await reader.pool.querySync(reader.relays, { ids: [id], limit: 1 })
  if (!event) {
    console.warn('[marketplace-app] listing not found', { id })
    return null
  }
  if (!marketplace.listings.validate(event)) {
    console.warn('[marketplace-app] fetched listing failed validation', { id, kind: event.kind })
    return null
  }
  console.debug('[marketplace-app] fetched listing by id', { id, kind: event.kind })
  return marketplace.listings.parse(event)
}

export async function fetchGiftWraps(session: AppSession): Promise<Event[]> {
  console.debug('[marketplace-app] fetching gift wraps', {
    pubkey: session.pubkey,
    relayCount: session.relays.length,
  })
  const wraps = await session.pool.querySync(session.relays, {
    kinds: [kinds.GiftWrap],
    '#p': [session.pubkey],
    limit: 100,
  })
  console.debug('[marketplace-app] fetched gift wraps', { wrapCount: wraps.length })
  return wraps
}

export async function fetchOrderBuckets(runtime: ReturnType<typeof marketplace.bind>): Promise<OrderBucket> {
  console.debug('[marketplace-app] fetching order buckets')
  const groups = await runtime.orders.groups.mine()
  console.debug('[marketplace-app] fetched order buckets', {
    mineCount: groups.buyer.length,
    onMyListingsCount: groups.seller.length,
    escrowCount: groups.escrow.length,
    allCount: groups.all.length,
  })
  return {
    mine: groups.buyer,
    onMyListings: groups.seller,
  }
}

export async function publishListing(
  publisher: NostrPublisher,
  form: ListingFormValue,
): Promise<VerifiedEvent> {
  const template = marketplace.listings.template({
    d: form.d,
    title: form.title,
    summary: form.summary || undefined,
    description: form.description,
    location: form.location || undefined,
    active: form.active,
    negotiable: form.negotiable,
    quantity: form.quantity,
    prices: [
      {
        amount: form.amount,
        currency: form.currency,
        ...(form.frequency ? { frequency: form.frequency } : {}),
      },
    ],
    images: form.image ? [{ url: form.image }] : [],
  })
  const event = await publisher.sign(template)
  await publisher.publish(event)
  console.debug('[marketplace-app] published listing', {
    eventId: event.id,
    kind: event.kind,
    d: form.d,
  })
  return event
}

export async function publishPaymentMethod(
  session: AppSession,
  publisher: NostrPublisher,
  options: {
    trustedEscrowPubkey?: string
    bytecodeHash?: string
    paymentForms: marketplace.AcceptedPaymentForm[]
  },
): Promise<VerifiedEvent> {
  const template = marketplace.paymentMethod.template({
    trustedEscrowPubkeys: [options.trustedEscrowPubkey || session.pubkey],
    supportedContractBytecodeHashes: options.bytecodeHash ? [options.bytecodeHash] : [],
    acceptedPaymentForms: options.paymentForms,
  })
  const event = await publisher.sign(template)
  await publisher.publish(event)
  console.debug('[marketplace-app] published payment method', {
    eventId: event.id,
    kind: event.kind,
    paymentFormCount: options.paymentForms.length,
    hasBytecodeHash: Boolean(options.bytecodeHash),
  })
  return event
}

export async function publishReservationOffer(
  session: AppSession,
  publisher: NostrPublisher,
  listing: marketplace.MarketplaceListing,
  options: {
    tradeId: string
    amount: marketplace.MarketplaceAmount
    start?: string
    end?: string
    escrowPubkey?: string
  },
): Promise<VerifiedEvent> {
  const participants = [
    { pubkey: session.pubkey, role: 'buyer' },
    { pubkey: listing.event.pubkey, role: 'seller' },
    ...(options.escrowPubkey ? [{ pubkey: options.escrowPubkey, role: 'escrow' }] : []),
  ]
  const template: EventTemplate = marketplace.orders.template({
    tradeId: options.tradeId,
    listingAnchor: listingAnchor(listing.event),
    amount: options.amount,
    start: options.start,
    end: options.end,
    participants,
  })
  const event = await publisher.sign(template)
  await publisher.publish(event)
  console.debug('[marketplace-app] published reservation offer', {
    eventId: event.id,
    kind: event.kind,
    tradeId: options.tradeId,
    hasEscrow: Boolean(options.escrowPubkey),
  })
  return event
}

export async function publishNegotiationOffer(
  session: AppSession,
  publisher: NostrPublisher,
  listing: marketplace.MarketplaceListing,
  options: {
    tradeId: string
    amount: marketplace.MarketplaceAmount
    start?: string
    end?: string
  },
): Promise<VerifiedEvent[]> {
  const participants = [
    { pubkey: session.pubkey, role: 'buyer' },
    { pubkey: listing.event.pubkey, role: 'seller' },
  ]
  const order = await publisher.sign(marketplace.orders.template({
    tradeId: options.tradeId,
    listingAnchor: listingAnchor(listing.event),
    amount: options.amount,
    start: options.start,
    end: options.end,
    participants,
  }))
  const message = await publisher.sign(marketplace.structuredMessages.template({
    childEvent: order,
    conversation: options.tradeId,
    recipients: participants,
    alt: 'Marketplace negotiation offer',
  }))
  console.debug('[marketplace-app] publishing negotiation offer gift wrap', {
    orderId: order.id,
    messageId: message.id,
    tradeId: options.tradeId,
  })
  const events = await publishGiftWrappedRumor(session, publisher, message, [listing.event.pubkey])
  console.debug('[marketplace-app] published negotiation offer gift wrap', {
    tradeId: options.tradeId,
    eventCount: events.length,
  })
  return events
}
