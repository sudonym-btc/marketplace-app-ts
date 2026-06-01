import type { Event, VerifiedEvent } from 'nostr-tools/core'
import { GiftWrap, PrivateDirectMessage, Seal } from 'nostr-tools/kinds'
import { encrypt, getConversationKey } from 'nostr-tools/nip44'
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'

import type { AppSession, NostrPublisher } from '../types'
import { nowSeconds } from '../utils/hex'

function uniquePubkeys(pubkeys: string[]): string[] {
  return [...new Set(pubkeys.filter(Boolean))]
}

async function wrapForRecipient(session: AppSession, rumor: Event, recipientPubkey: string): Promise<VerifiedEvent> {
  console.debug('[marketplace-app] wrapping private rumor for recipient', {
    rumorId: rumor.id,
    rumorKind: rumor.kind,
    recipientPubkey,
  })
  const seal = await session.signer.signEvent({
    kind: Seal,
    created_at: nowSeconds(),
    content: await session.signer.nip44Encrypt(recipientPubkey, JSON.stringify(rumor)),
    tags: [],
  })
  const randomKey = generateSecretKey()
  const conversationKey = getConversationKey(randomKey, recipientPubkey)
  return finalizeEvent(
    {
      kind: GiftWrap,
      created_at: nowSeconds(),
      content: encrypt(JSON.stringify(seal), conversationKey),
      tags: [['p', recipientPubkey]],
    },
    randomKey,
  )
}

export async function publishGiftWrappedRumor(
  session: AppSession,
  publisher: NostrPublisher,
  rumor: Event,
  recipientPubkeys: string[],
): Promise<VerifiedEvent[]> {
  const recipients = uniquePubkeys([...recipientPubkeys, session.pubkey])
  console.debug('[marketplace-app] publishing gift-wrapped rumor', {
    rumorId: rumor.id,
    rumorKind: rumor.kind,
    recipientCount: recipients.length,
  })
  const wraps = await Promise.all(
    recipients.map(pubkey => wrapForRecipient(session, rumor, pubkey)),
  )
  await Promise.all(wraps.map(wrap => publisher.publish(wrap)))
  console.debug('[marketplace-app] published gift-wrapped rumor', {
    rumorId: rumor.id,
    wrapCount: wraps.length,
  })
  return wraps
}

export async function publishPrivateThreadReply(
  session: AppSession,
  publisher: NostrPublisher,
  options: {
    conversation: string
    content: string
    recipientPubkeys: string[]
  },
): Promise<VerifiedEvent[]> {
  const content = options.content.trim()
  const recipients = uniquePubkeys(options.recipientPubkeys.filter(pubkey => pubkey !== session.pubkey))
  if (!content) throw new Error('Reply cannot be empty')
  if (recipients.length === 0) throw new Error('No reply recipient found for this thread')
  const rumor = await publisher.sign({
    kind: PrivateDirectMessage,
    created_at: nowSeconds(),
    content,
    tags: [
      ...recipients.map(pubkey => ['p', pubkey]),
      ['conversation', options.conversation],
    ],
  })
  console.debug('[marketplace-app] publishing private thread reply', {
    rumorId: rumor.id,
    conversation: options.conversation,
    recipientCount: recipients.length,
  })
  return publishGiftWrappedRumor(session, publisher, rumor, recipients)
}
