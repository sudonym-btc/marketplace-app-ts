import type { Event } from 'nostr-tools/core'
import * as kinds from 'nostr-tools/kinds'
import * as marketplace from 'nostr-tools/marketplace'

import type { InboxItem } from '../types'

export type ParsedInboxMessage = {
  item: InboxItem
  event?: Event
  structured?: marketplace.ParsedStructuredMessage
  order?: marketplace.ParsedOrder
  title: string
  body: string
  senderPubkey: string
  recipientPubkeys: string[]
  deliveryParticipants: string[]
  participants: string[]
  conversationTag: string
  conversationId: string
  messageId: string
  createdAt: number
}

export type ConversationGroup = {
  id: string
  conversationTag: string
  participants: string[]
  replyPubkeys: string[]
  latestAt: number
  latestMessage?: ParsedInboxMessage
  orderGroup?: marketplace.ParsedOrderGroup
  messages: ParsedInboxMessage[]
}

export function shortPubkey(pubkey: string): string {
  return pubkey.length > 16 ? `${pubkey.slice(0, 8)}...${pubkey.slice(-6)}` : pubkey
}

export function uniqueSorted(values: Iterable<string | undefined>): string[] {
  return [...new Set([...values].filter((value): value is string => Boolean(value)))].sort((a, b) =>
    a.localeCompare(b))
}

function tagValue(event: Event | undefined, name: string): string | undefined {
  return event?.tags.find(tag => tag[0] === name)?.[1]
}

function pTags(event: Event | undefined): string[] {
  return event?.tags.filter(tag => tag[0] === 'p' && tag[1]).map(tag => tag[1]) ?? []
}

function parseEventJson(value: string): Event | null {
  try {
    const parsed = JSON.parse(value) as Event
    return typeof parsed.kind === 'number' && typeof parsed.pubkey === 'string' ? parsed : null
  } catch {
    return null
  }
}

function marketplaceEventForRumor(rumor: Event): Event {
  if (rumor.kind === kinds.PrivateDirectMessage) return parseEventJson(rumor.content) ?? rumor
  return rumor
}

export function formatAmount(amount: marketplace.MarketplaceAmount | undefined): string {
  if (!amount) return 'No amount'
  if (!/^\d+$/.test(amount.value) || amount.decimals === 0) return `${amount.value} ${amount.denomination}`
  const raw = amount.value.padStart(amount.decimals + 1, '0')
  const whole = raw.slice(0, -amount.decimals)
  const fraction = raw.slice(-amount.decimals).replace(/0+$/, '')
  return `${whole}${fraction ? `.${fraction}` : ''} ${amount.denomination}`
}

export function formatDate(value: string | undefined): string | undefined {
  if (!value) return undefined
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : value
}

function orderTitle(order: marketplace.ParsedOrder): string {
  return 'Reservation offer'
}

function orderSummary(order: marketplace.ParsedOrder): string {
  return [
    formatAmount(order.content.amount),
    order.content.start || order.content.end ? [formatDate(order.content.start), formatDate(order.content.end)].filter(Boolean).join(' -> ') : undefined,
  ].filter(Boolean).join(' · ')
}

function parsedFallbackMessage(item: InboxItem, title: string, body: string, createdAt: number): ParsedInboxMessage {
  const senderPubkey = item.wrap.pubkey
  const participants = uniqueSorted([senderPubkey])
  const conversationTag = item.wrap.id
  return {
    item,
    title,
    body,
    senderPubkey,
    recipientPubkeys: [],
    deliveryParticipants: participants,
    participants,
    conversationTag,
    conversationId: `${participants.join(',')}|${conversationTag}`,
    messageId: item.wrap.id,
    createdAt,
  }
}

export function parsedInboxMessage(item: InboxItem): ParsedInboxMessage {
  const createdAt = item.rumor?.created_at ?? item.wrap.created_at
  if (item.error) return parsedFallbackMessage(item, 'Unreadable gift wrap', item.error, createdAt)
  if (!item.rumor) return parsedFallbackMessage(item, 'Empty message', 'The gift wrap decrypted but did not contain a rumor.', createdAt)

  const event = marketplaceEventForRumor(item.rumor)
  let structured: marketplace.ParsedStructuredMessage | undefined
  let order: marketplace.ParsedOrder | undefined
  try {
    if (event.kind === kinds.StructuredMessage) {
      structured = marketplace.structuredMessages.parse(event)
      if (structured.childEvent.kind === kinds.MarketplaceOrder) {
        order = marketplace.orders.parse(structured.childEvent)
      }
    } else if (event.kind === kinds.MarketplaceOrder) {
      order = marketplace.orders.parse(event)
    }
  } catch (err) {
    console.warn('[marketplace-app] unable to parse inbox marketplace message', {
      wrapId: item.wrap.id,
      rumorId: item.rumor.id,
      kind: event.kind,
    }, err)
  }

  const senderPubkey = event.pubkey || item.rumor.pubkey
  const recipientPubkeys = uniqueSorted([
    ...pTags(item.rumor),
    ...pTags(event),
    ...(structured?.recipients.map(recipient => recipient.pubkey) ?? []),
  ])
  const deliveryParticipants = uniqueSorted([senderPubkey, ...recipientPubkeys])
  const participants = uniqueSorted([
    ...deliveryParticipants,
    ...(order?.participants.map(participant => participant.pubkey) ?? []),
  ])
  const conversationTag = structured?.conversation ?? tagValue(event, 'conversation') ?? order?.tradeId ?? item.rumor.id
  const conversationId = `${deliveryParticipants.join(',')}|${conversationTag}`
  const title = order ? orderTitle(order) : event.kind === kinds.StructuredMessage ? 'Marketplace message' : 'Message'
  const body = order ? orderSummary(order) : event.content
  return {
    item,
    event,
    structured,
    order,
    title,
    body,
    senderPubkey,
    recipientPubkeys,
    deliveryParticipants,
    participants,
    conversationTag,
    conversationId,
    messageId: event.id || item.rumor.id || item.wrap.id,
    createdAt,
  }
}

export function conversationGroups(inbox: InboxItem[]): ConversationGroup[] {
  const messages = new Map<string, ParsedInboxMessage>()
  for (const item of inbox) {
    const message = parsedInboxMessage(item)
    const existing = messages.get(message.messageId)
    if (!existing || message.createdAt >= existing.createdAt) messages.set(message.messageId, message)
  }

  const groups = new Map<string, ConversationGroup>()
  for (const message of messages.values()) {
    const existing = groups.get(message.conversationId)
    if (existing) {
      existing.messages.push(message)
      existing.latestAt = Math.max(existing.latestAt, message.createdAt)
      if (!existing.latestMessage || message.createdAt >= existing.latestMessage.createdAt) {
        existing.latestMessage = message
      }
      existing.participants = uniqueSorted([...existing.participants, ...message.participants])
      existing.replyPubkeys = uniqueSorted([...existing.replyPubkeys, ...message.deliveryParticipants])
    } else {
      groups.set(message.conversationId, {
        id: message.conversationId,
        conversationTag: message.conversationTag,
        participants: message.participants,
        replyPubkeys: message.deliveryParticipants,
        latestAt: message.createdAt,
        latestMessage: message,
        messages: [message],
      })
    }
  }
  return [...groups.values()]
    .map(group => ({
      ...group,
      messages: group.messages.sort((a, b) => a.createdAt - b.createdAt || a.messageId.localeCompare(b.messageId)),
    }))
    .sort((a, b) => b.latestAt - a.latestAt || a.id.localeCompare(b.id))
}

export function latestOrderCreatedAt(group: marketplace.ParsedOrderGroup): number {
  return group.orders.reduce((latest, order) => Math.max(latest, order.event.created_at), 0)
}

export function conversationId(participants: string[], conversationTag: string): string {
  return `${uniqueSorted(participants).join(',')}|${conversationTag}`
}

export function orderBackedConversationGroup(
  orderGroup: marketplace.ParsedOrderGroup,
  participants: string[],
): ConversationGroup {
  const sortedParticipants = uniqueSorted(participants)
  return {
    id: conversationId(sortedParticipants, orderGroup.tradeId),
    conversationTag: orderGroup.tradeId,
    participants: sortedParticipants,
    replyPubkeys: sortedParticipants,
    latestAt: latestOrderCreatedAt(orderGroup),
    orderGroup,
    messages: [],
  }
}

function sameValues(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

function orderGroupParticipants(orderGroup: marketplace.ParsedOrderGroup): string[] {
  return uniqueSorted([
    orderGroup.sellerPubkey,
    ...orderGroup.participantPubkeys,
    ...orderGroup.escrowPubkeys,
  ])
}

function conversationMatchesOrderGroup(
  group: ConversationGroup,
  orderGroup: marketplace.ParsedOrderGroup,
): boolean {
  if (group.conversationTag !== orderGroup.tradeId) return false
  const orderParticipants = orderGroupParticipants(orderGroup)
  return [
    uniqueSorted(group.replyPubkeys),
    uniqueSorted(group.participants),
  ].some(participants => sameValues(participants, orderParticipants))
}

export function withMatchingOrderGroups(
  groups: ConversationGroup[],
  orderGroups: marketplace.ParsedOrderGroup[],
): ConversationGroup[] {
  const output = groups.map(group => {
    const orderGroup = orderGroups.find(candidate => conversationMatchesOrderGroup(group, candidate))
    return orderGroup ? { ...group, orderGroup } : group
  })
  return output.sort((a, b) => b.latestAt - a.latestAt || a.id.localeCompare(b.id))
}
