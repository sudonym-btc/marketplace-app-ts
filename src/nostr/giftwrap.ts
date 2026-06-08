import type { Event } from 'nostr-tools/core'
import { GiftWrap, Seal } from 'nostr-tools/kinds'

import type { AppSigner, InboxItem } from '../types'

function parseEventJson(value: string): Event {
  return JSON.parse(value) as Event
}

export async function unwrapGiftWrapWithSigner(wrap: Event, signer: AppSigner): Promise<InboxItem> {
  if (wrap.kind !== GiftWrap) {
    console.warn('[marketplace-app] attempted to unwrap non-gift-wrap event', {
      eventId: wrap.id,
      kind: wrap.kind,
    })
    return { wrap, error: 'Not a gift wrap event' }
  }
  try {
    console.debug('[marketplace-app] unwrapping gift wrap', { eventId: wrap.id, pubkey: wrap.pubkey })
    const seal = parseEventJson(await signer.nip44Decrypt(wrap.pubkey, wrap.content))
    if (seal.kind !== Seal) {
      console.warn('[marketplace-app] gift wrap did not contain a seal', {
        wrapId: wrap.id,
        innerKind: seal.kind,
      })
      return { wrap, seal, error: 'Gift wrap did not contain a seal' }
    }
    const rumor = parseEventJson(await signer.nip44Decrypt(seal.pubkey, seal.content))
    console.debug('[marketplace-app] unwrapped gift wrap', {
      wrapId: wrap.id,
      sealId: seal.id,
      rumorId: rumor.id,
      rumorKind: rumor.kind,
    })
    return { wrap, seal, rumor }
  } catch (err) {
    console.warn('[marketplace-app] unable to unwrap gift wrap', { wrapId: wrap.id }, err)
    return { wrap, error: err instanceof Error ? err.message : 'Unable to unwrap event' }
  }
}
