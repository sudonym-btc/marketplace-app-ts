import type * as marketplace from 'nostr-tools/marketplace'

export function latestOrder(group: marketplace.ParsedOrderGroup): marketplace.ParsedOrder | undefined {
  return group.orders.reduce<marketplace.ParsedOrder | undefined>((latest, order) => {
    if (!latest) return order
    if (order.event.created_at !== latest.event.created_at) {
      return order.event.created_at > latest.event.created_at ? order : latest
    }
    return order.event.id.localeCompare(latest.event.id) > 0 ? order : latest
  }, undefined)
}

export function arbiterPubkeyForOrderGroup(group: marketplace.ParsedOrderGroup): string | undefined {
  return group.arbiterPubkeys[0] ??
    group.participants.find(participant => participant.role === 'arbiter')?.pubkey
}

export function orderGroupCancellable(group: marketplace.ParsedOrderGroup): boolean {
  if (group.stage === 'cancel' || group.confirmedCommitted) return false
  return group.stage === 'negotiate'
}

export function orderStageLabel(group: marketplace.ParsedOrderGroup): string {
  if (group.payment && !group.confirmedCommitted) return 'payment pending validation'
  return group.stage
}
