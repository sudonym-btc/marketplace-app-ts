import type { Event, EventTemplate } from 'nostr-tools/core'
import { MarketplaceSeed } from 'nostr-tools/kinds'
import * as marketplace from 'nostr-tools/marketplace'

import type { AppSession, NostrPublisher } from '../types'

export type MarketplaceSeedRecord = {
  event: Event
  seed: string
  created: boolean
}

function seedFilter(pubkey: string) {
  return { kinds: [MarketplaceSeed], authors: [pubkey], limit: 1 }
}

async function decryptSeedEvent(session: AppSession, event: Event): Promise<string> {
  const plaintext = await session.signer.nip44Decrypt(session.pubkey, event.content)
  return marketplace.seeds.parsePayload(plaintext).seed
}

async function createSeedEvent(session: AppSession, publisher: NostrPublisher): Promise<MarketplaceSeedRecord> {
  const seed = marketplace.seeds.generate()
  const payload = marketplace.seeds.encodePayload(seed)
  const encryptedContent = await session.signer.nip44Encrypt(session.pubkey, payload)
  const template: EventTemplate = marketplace.seeds.template({ encryptedContent })
  const event = await publisher.sign(template)
  await publisher.publish(event)
  return { event, seed, created: true }
}

export async function getOrCreateMarketplaceSeed(
  session: AppSession,
  publisher: NostrPublisher,
): Promise<MarketplaceSeedRecord> {
  const events = await session.pool.querySync(session.relays, seedFilter(session.pubkey))
  const existing = events.find(event => marketplace.seeds.validate(event))
  if (existing) return { event: existing, seed: await decryptSeedEvent(session, existing), created: false }
  return createSeedEvent(session, publisher)
}
