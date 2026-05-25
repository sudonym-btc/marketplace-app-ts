import type { Event, EventTemplate, VerifiedEvent } from 'nostr-tools/core'
import type { BunkerSigner } from 'nostr-tools/nip46'
import type { SimplePool } from 'nostr-tools/pool'
import type * as marketplace from 'nostr-tools/marketplace'

export type AppRoute =
  | { name: 'listings' }
  | { name: 'listing'; id: string }
  | { name: 'inbox' }
  | { name: 'orders' }
  | { name: 'edit-listing'; id?: string }
  | { name: 'settings' }

export type AppSession = {
  pubkey: string
  signer: BunkerSigner
  pool: SimplePool
  relays: string[]
}

export type NostrPublisher = {
  sign(event: EventTemplate): Promise<VerifiedEvent>
  publish(event: VerifiedEvent): Promise<void>
}

export type LoadedMarketplace = {
  seed: string
  runtime: ReturnType<typeof marketplace.createMarketplace>
  evm?: EvmDriverState
}

export type EvmDriverState = {
  enabled: boolean
  started: boolean
  maxUsedIndex: number
  nextTradeIndex: number
  sweepSummary: string
  error?: string
}

export type InboxItem = {
  wrap: Event
  seal?: Event
  rumor?: Event
  error?: string
}

export type OrderBucket = {
  mine: marketplace.ParsedOrderGroup[]
  onMyListings: marketplace.ParsedOrderGroup[]
}

export type ListingFormValue = {
  d: string
  title: string
  summary: string
  description: string
  amount: string
  currency: string
  frequency: string
  location: string
  image: string
  quantity: number
  active: boolean
  negotiable: boolean
}
