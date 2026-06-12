import { useEffect, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type * as marketplace from 'nostr-tools/marketplace'

import { formatAmount, formatDate, shortPubkey } from '../nostr/inboxThreads'
import {
  arbiterPubkeyForOrderGroup,
  latestOrder,
  orderGroupCancellable,
  orderStageLabel,
} from '../nostr/orderGroups'
import { useMarketplaceApp } from '../state/AppStateContext'
import { Badge, Button, Card, Skeleton, cn } from './ui'
import { Eyebrow } from './widgets/Eyebrow'
import { Facts } from './widgets/FactList'
import { PaymentLifecycles } from './widgets/PaymentLifecycles'

type Props = {
  group: marketplace.ParsedOrderGroup
  compact?: boolean
  onOpen?: (group: marketplace.ParsedOrderGroup) => void | Promise<void>
  onCancel?: (group: marketplace.ParsedOrderGroup) => void | Promise<void>
  onMessageArbiter?: (group: marketplace.ParsedOrderGroup) => void
}

type ListingState =
  | { status: 'idle' | 'loading'; listing?: undefined; error?: undefined }
  | { status: 'loaded'; listing: marketplace.MarketplaceListing; error?: undefined }
  | { status: 'missing'; listing?: undefined; error?: string }

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

function listingFallbackText(anchor: string): string {
  const parts = anchor.split(':')
  return parts.length >= 3 ? parts.slice(2).join(':') : shortPubkey(anchor)
}

function OrderListingPreview({
  anchor,
  compact,
  listingState,
}: {
  anchor: string
  compact: boolean
  listingState: ListingState
}) {
  const listing = listingState.status === 'loaded' ? listingState.listing : undefined
  const image = listing?.images[0]?.url
  const title = listing?.title
  const fallbackTitle = listingState.status === 'missing'
    ? listingState.error ?? 'Listing unavailable'
    : listingFallbackText(anchor)
  const thumbClass = compact ? 'size-12' : 'size-16'

  if (listingState.status === 'loading') {
    return (
      <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
        <Skeleton className={cn('shrink-0 rounded-md', thumbClass)} />
        <div className="grid min-w-0 gap-2">
          <Skeleton className="h-4 w-2/3" />
          {!compact && <Skeleton className="h-3 w-1/2" />}
        </div>
      </div>
    )
  }

  return (
    <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
      <div className={cn('grid shrink-0 place-items-center overflow-hidden rounded-md bg-muted text-sm font-semibold text-muted-foreground', thumbClass)}>
        {image ? (
          <img
            alt={title ? `${title} listing image` : ''}
            className="size-full object-cover"
            src={image}
          />
        ) : (
          <span>{(title ?? fallbackTitle).slice(0, 1).toUpperCase()}</span>
        )}
      </div>
      <div className="min-w-0">
        <span className="block truncate text-sm font-semibold text-foreground">
          {title ?? fallbackTitle}
        </span>
        {!compact && (
          <span className="mt-1 block truncate text-xs text-muted-foreground">
            {shortPubkey(anchor)}
          </span>
        )}
      </div>
    </div>
  )
}

export function OrderWidget({ group, compact = false, onOpen, onCancel, onMessageArbiter }: Props) {
  const { state } = useMarketplaceApp()
  const marketplaceClient = state.marketplace?.runtime ?? state.publicMarketplace
  const [listingState, setListingState] = useState<ListingState>({ status: 'idle' })
  const cancellable = orderGroupCancellable(group)
  const arbiterPubkey = arbiterPubkeyForOrderGroup(group)
  const statusVariant = group.stage === 'cancel'
      ? 'destructive'
      : 'secondary'
  const showLifecycle = !compact
  const lifecycleEventCount = group.payments.length + group.paymentAcks.length + group.paymentNacks.length + group.settlements.length
  const lifecycleLabel = lifecycleEventCount === 1 ? '1 event' : `${lifecycleEventCount} events`

  useEffect(() => {
    let cancelled = false
    setListingState({ status: 'loading' })
    marketplaceClient.listings.findByAnchor(group.listingAnchor)
      .then(listing => {
        if (cancelled) return
        setListingState(listing
          ? { status: 'loaded', listing }
          : { status: 'missing', error: 'Listing unavailable' })
      })
      .catch(err => {
        if (cancelled) return
        console.warn('[marketplace-app] order listing fetch failed', {
          listingAnchor: group.listingAnchor,
          tradeId: group.tradeId,
        }, err)
        setListingState({
          status: 'missing',
          error: err instanceof Error ? err.message : 'Listing unavailable',
        })
      })
    return () => {
      cancelled = true
    }
  }, [group.listingAnchor, group.tradeId, marketplaceClient])

  function open(): void {
    if (!onOpen) return
    void Promise.resolve(onOpen(group)).catch(err => {
      console.warn('[marketplace-app] order widget open failed', { tradeId: group.tradeId }, err)
    })
  }

  return (
    <Card
      className={cn(
        'grid min-w-0 gap-3 p-4 shadow-none',
        compact && 'gap-2 bg-muted/40 p-3',
        onOpen && 'cursor-pointer transition-colors hover:border-foreground/20 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
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
      <header className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <Eyebrow className="mb-2">Order</Eyebrow>
          <strong className="block truncate text-sm font-semibold text-foreground">{shortPubkey(group.tradeId)}</strong>
        </div>
        <Badge className="max-w-44 text-right [overflow-wrap:anywhere]" variant={statusVariant}>
          {orderStageLabel(group)}
        </Badge>
      </header>
      <OrderListingPreview
        anchor={group.listingAnchor}
        compact={compact}
        listingState={listingState}
      />
      <Facts compact={compact} facts={orderFacts(group)} />
      {showLifecycle && (
        <section
          className="grid gap-3 border-t border-border pt-3"
          onClick={event => event.stopPropagation()}
        >
          <div className="flex min-w-0 items-center justify-between gap-3 px-2">
            <span className="grid min-w-0 gap-1">
              <span className="text-sm font-medium text-foreground">Payment lifecycle</span>
              <span className="text-xs text-muted-foreground">{lifecycleLabel}</span>
            </span>
            <Badge variant={lifecycleEventCount > 0 ? 'secondary' : 'outline'}>
              {lifecycleEventCount}
            </Badge>
          </div>
          <PaymentLifecycles
            evmBlockExplorerUrl={state.config.evm.blockExplorerUrl}
            payments={group.payments}
            paymentAcks={group.paymentAcks}
            paymentNacks={group.paymentNacks}
            settlements={group.settlements}
            emptyText="No payment, ACK, NACK, or settlement event has been published for this order yet."
          />
        </section>
      )}
      {(onCancel || onMessageArbiter) && (
        <div className="flex flex-wrap gap-2">
          {onCancel && cancellable && (
            <Button
              size={compact ? 'sm' : 'default'}
              variant="secondary"
              onClick={event => {
                event.stopPropagation()
                void Promise.resolve(onCancel(group)).catch(err => {
                  console.warn('[marketplace-app] order widget cancel failed', { tradeId: group.tradeId }, err)
                })
              }}
            >
              Cancel
            </Button>
          )}
          {onMessageArbiter && arbiterPubkey && (
            <Button
              size={compact ? 'sm' : 'default'}
              variant="secondary"
              onClick={event => {
                event.stopPropagation()
                onMessageArbiter(group)
              }}
            >
              Message arbiter
            </Button>
          )}
        </div>
      )}
    </Card>
  )
}
