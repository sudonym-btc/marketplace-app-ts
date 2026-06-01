import type { KeyboardEvent } from 'react'
import type * as marketplace from 'nostr-tools/marketplace'

import { formatAmount, formatDate, shortPubkey } from '../nostr/inboxThreads'
import {
  escrowPubkeyForOrderGroup,
  latestOrder,
  orderGroupCancellable,
  orderStageLabel,
} from '../nostr/orderGroups'

type Props = {
  group: marketplace.ParsedOrderGroup
  compact?: boolean
  onOpen?: (group: marketplace.ParsedOrderGroup) => void | Promise<void>
  onCancel?: (group: marketplace.ParsedOrderGroup) => void | Promise<void>
  onMessageEscrow?: (group: marketplace.ParsedOrderGroup) => void
}

function orderFacts(group: marketplace.ParsedOrderGroup): { label: string; value: string }[] {
  const order = group.buyerOrder ?? latestOrder(group)
  const start = formatDate(order?.content.start)
  const end = formatDate(order?.content.end)
  return [
    { label: 'Stage', value: orderStageLabel(group) },
    { label: 'Amount', value: formatAmount(order?.content.amount) },
    ...(start ? [{ label: 'Start', value: start }] : []),
    ...(end ? [{ label: 'End', value: end }] : []),
    { label: 'Trade', value: shortPubkey(group.tradeId) },
  ]
}

export function OrderWidget({ group, compact = false, onOpen, onCancel, onMessageEscrow }: Props) {
  const cancellable = orderGroupCancellable(group)
  const escrowPubkey = escrowPubkeyForOrderGroup(group)
  const className = [
    'order-widget',
    compact ? 'compact' : '',
    onOpen ? 'clickable' : '',
  ].filter(Boolean).join(' ')

  function open(): void {
    if (!onOpen) return
    void Promise.resolve(onOpen(group)).catch(err => {
      console.warn('[marketplace-app] order widget open failed', { tradeId: group.tradeId }, err)
    })
  }

  return (
    <section
      className={className}
      aria-label="Order"
      {...(onOpen
        ? {
            role: 'button',
            tabIndex: 0,
            onClick: open,
            onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                open()
              }
            },
          }
        : {})}
    >
      <header className="order-widget-header">
        <div>
          <span className="label">Order</span>
          <strong>{shortPubkey(group.tradeId)}</strong>
        </div>
        <span className={`order-status ${group.stage}`}>{orderStageLabel(group)}</span>
      </header>
      <dl className="order-widget-facts">
        {orderFacts(group).map(fact => (
          <div key={fact.label}>
            <dt>{fact.label}</dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
      </dl>
      {(onCancel || onMessageEscrow) && (
        <div className="order-widget-actions">
          {onCancel && cancellable && (
            <button
              className="button secondary"
              type="button"
              onClick={event => {
                event.stopPropagation()
                void Promise.resolve(onCancel(group)).catch(err => {
                  console.warn('[marketplace-app] order widget cancel failed', { tradeId: group.tradeId }, err)
                })
              }}
            >
              Cancel
            </button>
          )}
          {onMessageEscrow && escrowPubkey && (
            <button
              className="button secondary"
              type="button"
              onClick={event => {
                event.stopPropagation()
                onMessageEscrow(group)
              }}
            >
              Message escrow
            </button>
          )}
        </div>
      )}
    </section>
  )
}
