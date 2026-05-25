import type { Event, EventTemplate, VerifiedEvent } from 'nostr-tools/core'
import * as kinds from 'nostr-tools/kinds'
import * as marketplace from 'nostr-tools/marketplace'

import type { AppSession, ListingFormValue, NostrPublisher, OrderBucket } from '../types'

export function listingAnchor(event: Event): string {
  const d = event.tags.find(tag => tag[0] === 'd')?.[1]
  return `${event.kind}:${event.pubkey}:${d ?? event.id}`
}

export async function fetchListings(session: AppSession): Promise<marketplace.MarketplaceListing[]> {
  const events = await session.pool.querySync(
    session.relays,
    marketplace.listings.filters.search({ limit: 80 }),
  )
  return events.filter(marketplace.listings.validate).map(marketplace.listings.parse)
}

export async function fetchListingById(session: AppSession, id: string): Promise<marketplace.MarketplaceListing | null> {
  const [event] = await session.pool.querySync(session.relays, { ids: [id], limit: 1 })
  return event && marketplace.listings.validate(event) ? marketplace.listings.parse(event) : null
}

export async function fetchGiftWraps(session: AppSession): Promise<Event[]> {
  return session.pool.querySync(session.relays, {
    kinds: [kinds.GiftWrap],
    '#p': [session.pubkey],
    limit: 100,
  })
}

export async function fetchOrderBuckets(session: AppSession): Promise<OrderBucket> {
  const authored = await session.pool.querySync(session.relays, {
    kinds: [kinds.MarketplaceOrder],
    authors: [session.pubkey],
    limit: 200,
  })
  const addressed = await session.pool.querySync(session.relays, {
    kinds: [kinds.MarketplaceOrder],
    '#p': [session.pubkey],
    limit: 200,
  })
  const unique = new Map([...authored, ...addressed].map(event => [event.id, event]))
  const groups = marketplace.orders.groups.group([...unique.values()])
  return {
    mine: groups.filter(group => group.orders.some(order => order.event.pubkey === session.pubkey)),
    onMyListings: groups.filter(group => group.sellerPubkey === session.pubkey),
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
  return event
}

export async function publishEscrowMethod(
  session: AppSession,
  publisher: NostrPublisher,
  options: {
    trustedEscrowPubkey?: string
    bytecodeHash?: string
    paymentForms: marketplace.AcceptedPaymentForm[]
  },
): Promise<VerifiedEvent> {
  const template = marketplace.escrowMethods.template({
    trustedEscrowPubkeys: [options.trustedEscrowPubkey || session.pubkey],
    supportedContractBytecodeHashes: options.bytecodeHash ? [options.bytecodeHash] : [],
    acceptedPaymentForms: options.paymentForms,
  })
  const event = await publisher.sign(template)
  await publisher.publish(event)
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
    stage: 'negotiate',
    amount: options.amount,
    start: options.start,
    end: options.end,
    participants,
  })
  const event = await publisher.sign(template)
  await publisher.publish(event)
  return event
}
