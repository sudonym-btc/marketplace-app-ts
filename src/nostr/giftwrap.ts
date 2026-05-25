import type { Event } from 'nostr-tools/core'
import type { BunkerSigner } from 'nostr-tools/nip46'
import { GiftWrap, Seal } from 'nostr-tools/kinds'

import type { InboxItem } from '../types'

function parseEventJson(value: string): Event {
  return JSON.parse(value) as Event
}

export async function unwrapGiftWrapWithSigner(wrap: Event, signer: BunkerSigner): Promise<InboxItem> {
  if (wrap.kind !== GiftWrap) return { wrap, error: 'Not a gift wrap event' }
  try {
    const seal = parseEventJson(await signer.nip44Decrypt(wrap.pubkey, wrap.content))
    if (seal.kind !== Seal) return { wrap, seal, error: 'Gift wrap did not contain a seal' }
    const rumor = parseEventJson(await signer.nip44Decrypt(seal.pubkey, seal.content))
    return { wrap, seal, rumor }
  } catch (err) {
    return { wrap, error: err instanceof Error ? err.message : 'Unable to unwrap event' }
  }
}
