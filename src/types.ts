import type { Event, EventTemplate, VerifiedEvent } from 'nostr-tools/core'
import type { SimplePool } from 'nostr-tools/pool'
import type * as marketplace from 'nostr-tools/marketplace'

export type AppSession = {
  pubkey: string
  signer: AppSigner
  pool: SimplePool
  relays: string[]
}

export type AppSigner = {
  getPublicKey(): Promise<string>
  nip44Encrypt(pubkey: string, plaintext: string): Promise<string>
  nip44Decrypt(pubkey: string, ciphertext: string): Promise<string>
  signEvent(event: EventTemplate): Promise<VerifiedEvent>
  close?(): Promise<void>
}

export type SessionRestoreError = {
  title: string
  message: string
  detail?: string
  timedOut: boolean
}

export type NostrPublisher = {
  sign(event: EventTemplate): Promise<VerifiedEvent>
  publish(event: Event): Promise<void>
}

export type MarketplaceClient = ReturnType<typeof marketplace.bind>
export type MarketplaceSession = Awaited<ReturnType<MarketplaceClient['session']>>

export type LoadedMarketplaceSession = MarketplaceSession

export type MarketplaceLogItem = {
  id: number
  at: string
  level: 'debug' | 'info' | 'warn' | 'error'
  scope: string
  span?: string
  message: string
  data?: Record<string, unknown>
  error?: unknown
}

export type InboxItem = marketplace.MarketplaceInboxItem

export type MyOrders = {
  placed: marketplace.ParsedOrderGroup[]
  received: marketplace.ParsedOrderGroup[]
  arbitrating: marketplace.ParsedOrderGroup[]
}

export type MyBidAuction = {
  auctionAnchor: string
  lastBidAt: number
  groups: marketplace.ParsedAuctionBidGroup[]
}

export type AuctionListingResolution = {
  auction: marketplace.ParsedMarketplaceAuction
  listing: marketplace.MarketplaceListing | null
  snapshot?: marketplace.MarketplaceAuctionScopeSnapshot
  error?: string
}

export type ListingFormValue = {
  title: string
  description: string
  amount: string
  currency: string
  frequency: string
  location: string
  images: string[]
  quantity: number
  active: boolean
  negotiable: boolean
}
