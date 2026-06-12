import type { Event, EventTemplate, VerifiedEvent } from 'nostr-tools/core'
import type { SimplePool } from 'nostr-tools/pool'
import type * as marketplace from 'nostr-tools/marketplace'
import type { EvmMarketplacePolicyState } from '@sudonym-btc/marketplace-evm'

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
export type MarketplaceSession = Awaited<ReturnType<typeof marketplace.session>>

export type LoadedMarketplace = {
  runtime: MarketplaceSession
  nextTradeIndex: number
  evm?: EvmMarketplacePolicyState
}

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

export type OrderBucket = {
  mine: marketplace.ParsedOrderGroup[]
  onMyListings: marketplace.ParsedOrderGroup[]
}

export type AuctionListingResolution = {
  auction: marketplace.ParsedMarketplaceAuction
  listing: marketplace.MarketplaceListing | null
  snapshot?: marketplace.MarketplaceAuctionScopeSnapshot
  error?: string
}

export type MyBidChainResolution = {
  auction: marketplace.ParsedMarketplaceAuction
  chain: marketplace.ParsedAuctionBidChain
  listing: marketplace.MarketplaceListing | null
  snapshot: marketplace.MarketplaceAuctionScopeSnapshot
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
