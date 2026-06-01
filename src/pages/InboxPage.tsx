import { useEffect, useMemo, useState } from 'react'
import * as marketplace from 'nostr-tools/marketplace'
import { finalizeEvent } from 'nostr-tools/pure'

import { EmptyState } from '../components/EmptyState'
import { ThreadList } from '../components/ThreadList'
import { ThreadView } from '../components/ThreadView'
import {
  conversationGroups,
  conversationId,
  orderBackedConversationGroup,
  type ConversationGroup,
  uniqueSorted,
  withMatchingOrderGroups,
} from '../nostr/inboxThreads'
import {
  escrowPubkeyForOrderGroup,
  latestOrder,
  orderGroupCancellable,
} from '../nostr/orderGroups'
import { publishPrivateThreadReply } from '../nostr/privateMessages'
import { fetchProfiles, type NostrProfile } from '../nostr/profiles'
import type { AppSession, InboxItem, LoadedMarketplace, NostrPublisher } from '../types'

type Props = {
  inbox: InboxItem[]
  orderGroups: marketplace.ParsedOrderGroup[]
  marketplaceState?: LoadedMarketplace
  targetThread?: { conversation: string; participants: string[] }
  session: AppSession
  publisher: NostrPublisher
  onSent: () => Promise<void>
  onOrdersChanged: () => Promise<void>
  onError: (message: string) => void
}

function profilePubkeys(groups: ConversationGroup[]): string[] {
  return [...new Set(groups.flatMap(group => [...group.participants, ...group.replyPubkeys]))].sort((a, b) =>
    a.localeCompare(b))
}

function replyRecipients(group: ConversationGroup, currentPubkey: string): string[] {
  return [...new Set(group.replyPubkeys.filter(pubkey => pubkey !== currentPubkey))]
}

function buyerPubkeyForOrderGroup(group: marketplace.ParsedOrderGroup): string | undefined {
  return group.buyerOrder?.event.pubkey ?? group.participants.find(participant => participant.role === 'buyer')?.pubkey
}

function sourceOrderForCancel(group: marketplace.ParsedOrderGroup): marketplace.ParsedOrder | undefined {
  return group.buyerOrder ?? latestOrder(group)
}

function deriveBuyerSecretForOrderGroup(
  group: marketplace.ParsedOrderGroup,
  marketplaceState: LoadedMarketplace | undefined,
): { index: number; secretKey: Uint8Array } | undefined {
  const targetPubkey = buyerPubkeyForOrderGroup(group)
  if (!targetPubkey || !marketplaceState) return undefined
  for (let index = 0; index < 500; index += 1) {
    const material = marketplace.seed.deriveTradeMaterial(marketplaceState.runtime.seed, { index, role: 'buyer' })
    if (material.tradePubkey === targetPubkey) return { index, secretKey: material.tradeSecretKey }
  }
  return undefined
}

function routedConversationGroup(
  targetThread: { conversation: string; participants: string[] } | undefined,
  orderGroups: marketplace.ParsedOrderGroup[],
  currentPubkey: string,
): ConversationGroup | undefined {
  if (!targetThread) return undefined
  const participants = uniqueSorted([...targetThread.participants, currentPubkey])
  const orderGroup = orderGroups.find(group => group.tradeId === targetThread.conversation)
  if (orderGroup) return orderBackedConversationGroup(orderGroup, participants)
  return {
    id: conversationId(participants, targetThread.conversation),
    conversationTag: targetThread.conversation,
    participants,
    replyPubkeys: participants,
    latestAt: Math.floor(Date.now() / 1000),
    messages: [],
  }
}

export function InboxPage({
  inbox,
  orderGroups,
  marketplaceState,
  targetThread,
  session,
  publisher,
  onSent,
  onOrdersChanged,
  onError,
}: Props) {
  const baseGroups = useMemo(
    () => withMatchingOrderGroups(conversationGroups(inbox), orderGroups),
    [inbox, orderGroups],
  )
  const routeThread = useMemo(
    () => routedConversationGroup(targetThread, orderGroups, session.pubkey),
    [orderGroups, session.pubkey, targetThread],
  )
  const [adHocThread, setAdHocThread] = useState<ConversationGroup>()
  const [selectedId, setSelectedId] = useState<string>()
  const [profiles, setProfiles] = useState<Map<string, NostrProfile>>(() => new Map())
  const selectedGroup = useMemo(() => {
    if (routeThread) {
      return baseGroups.find(group => group.id === routeThread.id) ?? routeThread
    }
    if (adHocThread && selectedId === adHocThread.id) {
      return baseGroups.find(group => group.id === adHocThread.id) ?? adHocThread
    }
    return baseGroups.find(group => group.id === selectedId) ?? baseGroups[0] ?? adHocThread
  }, [adHocThread, baseGroups, routeThread, selectedId])
  const profileGroups = useMemo(() => {
    if (selectedGroup && !baseGroups.some(group => group.id === selectedGroup.id)) return [selectedGroup, ...baseGroups]
    return baseGroups
  }, [baseGroups, selectedGroup])
  const pubkeyKey = useMemo(() => profilePubkeys(profileGroups).join(','), [profileGroups])

  useEffect(() => {
    if (routeThread) {
      setSelectedId(routeThread.id)
      return
    }
    if (adHocThread && selectedId === adHocThread.id) return
    if (baseGroups.length === 0) {
      setSelectedId(undefined)
      return
    }
    if (!selectedId || !baseGroups.some(group => group.id === selectedId)) setSelectedId(baseGroups[0].id)
  }, [adHocThread, baseGroups, routeThread, selectedId])

  useEffect(() => {
    const pubkeys = pubkeyKey ? pubkeyKey.split(',') : []
    if (pubkeys.length === 0) {
      setProfiles(new Map())
      return
    }
    let cancelled = false
    fetchProfiles(session, pubkeys)
      .then(nextProfiles => {
        if (!cancelled) setProfiles(nextProfiles)
      })
      .catch(err => {
        console.warn('[marketplace-app] inbox profile fetch failed', err)
      })
    return () => {
      cancelled = true
    }
  }, [pubkeyKey, session])

  async function reply(group: ConversationGroup, content: string): Promise<void> {
    const recipients = replyRecipients(group, session.pubkey)
    console.debug('[marketplace-app] sending inbox thread reply', {
      conversationId: group.id,
      conversationTag: group.conversationTag,
      recipientCount: recipients.length,
    })
    try {
      await publishPrivateThreadReply(session, publisher, {
        conversation: group.conversationTag,
        recipientPubkeys: recipients,
        content,
      })
      await onSent()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to send reply'
      onError(message)
      throw err
    }
  }

  async function cancelOrder(group: marketplace.ParsedOrderGroup): Promise<void> {
    if (!orderGroupCancellable(group)) {
      onError('This order is no longer cancellable')
      return
    }

    const source = sourceOrderForCancel(group)
    if (!source) {
      onError('No buyer order found to cancel')
      return
    }

    try {
      const template = marketplace.orders.cancelTemplate({
        tradeId: group.tradeId,
        listingAnchor: group.listingAnchor,
        refs: { orders: [source.event.id] },
        reason: 'cancelled',
        participants: group.participants.length > 0 ? group.participants : source.participants,
      })
      const buyerSecret = deriveBuyerSecretForOrderGroup(group, marketplaceState)
      const buyerPubkey = buyerPubkeyForOrderGroup(group)
      const canSignAsPublicParticipant =
        buyerPubkey === session.pubkey ||
        source.event.pubkey === session.pubkey ||
        group.sellerPubkey === session.pubkey
      const event = buyerSecret
        ? finalizeEvent(template, buyerSecret.secretKey)
        : canSignAsPublicParticipant
          ? await publisher.sign(template)
          : undefined
      if (!event) throw new Error('Current session cannot sign for this order')

      console.debug('[marketplace-app] publishing order cancel', {
        tradeId: group.tradeId,
        orderId: source.event.id,
        signingIndex: buyerSecret?.index,
        signerPubkey: event.pubkey,
      })
      await publisher.publish(event)
      await onOrdersChanged()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to cancel order'
      console.warn('[marketplace-app] order cancel failed', { tradeId: group.tradeId }, err)
      onError(message)
      throw err
    }
  }

  function messageEscrow(group: marketplace.ParsedOrderGroup): void {
    const escrowPubkey = escrowPubkeyForOrderGroup(group)
    if (!escrowPubkey) {
      onError('This order does not tag an escrow pubkey')
      return
    }
    const participants = uniqueSorted([session.pubkey, escrowPubkey, group.sellerPubkey])
    const thread = orderBackedConversationGroup(group, participants)
    const existing = baseGroups.find(candidate => candidate.id === thread.id)
    console.debug('[marketplace-app] opening escrow order thread', {
      tradeId: group.tradeId,
      conversationId: thread.id,
      participantCount: participants.length,
      existing: Boolean(existing),
    })
    setAdHocThread(existing ? undefined : thread)
    setSelectedId(existing?.id ?? thread.id)
  }

  function selectThread(id: string): void {
    setAdHocThread(undefined)
    setSelectedId(id)
    if (targetThread) window.location.hash = '#/inbox'
  }

  return (
    <section className="page inbox-page">
      <div className="page-heading">
        <div>
          <h1>Inbox</h1>
        </div>
      </div>
      {baseGroups.length === 0 && !selectedGroup ? (
        <EmptyState title="Inbox empty" body="Gift-wrapped messages and negotiation offers will appear here." />
      ) : (
        <div className="inbox-layout">
          <ThreadList
            currentPubkey={session.pubkey}
            groups={baseGroups}
            onCancelOrder={cancelOrder}
            onMessageEscrow={messageEscrow}
            onSelect={selectThread}
            profiles={profiles}
            selectedId={selectedGroup?.id}
          />
          <ThreadView
            currentPubkey={session.pubkey}
            group={selectedGroup}
            onCancelOrder={cancelOrder}
            onMessageEscrow={messageEscrow}
            onReply={reply}
            profiles={profiles}
          />
        </div>
      )}
    </section>
  )
}
