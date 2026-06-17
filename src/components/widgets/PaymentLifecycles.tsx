import { useMemo, useState } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import {
  CheckCircleIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  FileTextIcon,
  RefreshCwIcon,
  XCircleIcon,
} from 'lucide-react'
import type * as marketplace from 'nostr-tools/marketplace'

import { shortPubkey } from '../../nostr/inboxThreads'
import { formatMarketplaceAmount } from '../../utils/amountDisplay'
import { formatDateTime } from '../../utils/timeDisplay'
import { Badge, Button, cn } from '../ui'

type BadgeVariant = NonNullable<ComponentProps<typeof Badge>['variant']>
type PaymentEvent = marketplace.ParsedPayment['event']
type PaymentDecision =
  | marketplace.ParsedPaymentAck
  | marketplace.ParsedPaymentNack
  | marketplace.ParsedPaymentSettlement

type LifecycleFact = {
  label: string
  value?: ReactNode
}

type LifecycleItem = {
  key: string
  label: string
  badge: string
  badgeVariant: BadgeVariant
  event: PaymentEvent
  icon: ReactNode
  message?: string
  action?: ReactNode
  facts: LifecycleFact[]
}

type PaymentLifecycle = {
  id: string
  payment?: marketplace.ParsedPayment
  paymentIndex?: number
  acks: marketplace.ParsedPaymentAck[]
  nacks: marketplace.ParsedPaymentNack[]
  settlements: marketplace.ParsedPaymentSettlement[]
}

type PaymentLifecyclesProps = {
  payments: marketplace.ParsedPayment[]
  paymentAcks: marketplace.ParsedPaymentAck[]
  paymentNacks: marketplace.ParsedPaymentNack[]
  settlements: marketplace.ParsedPaymentSettlement[]
  evmBlockExplorerUrl?: string
  className?: string
  emptyText?: string
}

function shortIdList(ids: string[]): string | undefined {
  return ids.length > 0 ? ids.map(shortPubkey).join(', ') : undefined
}

function refFacts(refs: marketplace.ParsedPayment['refs']): LifecycleFact[] {
  return [
    { label: 'Order refs', value: shortIdList(refs.orders) },
    { label: 'Bid refs', value: shortIdList(refs.auctionBids) },
    { label: 'Payment refs', value: shortIdList(refs.payments) },
    { label: 'ACK refs', value: shortIdList(refs.paymentAcks) },
    { label: 'NACK refs', value: shortIdList(refs.paymentNacks) },
    { label: 'Settlement refs', value: shortIdList(refs.settlements) },
  ]
}

function eventKindLabel(kind: number): string {
  if (kind === 32123) return 'Payment'
  if (kind === 32124) return 'Payment ACK'
  if (kind === 32125) return 'Payment settlement'
  if (kind === 32127) return 'Payment NACK'
  return `Kind ${kind}`
}

function parsedEventJson(event: PaymentEvent): string {
  let content: unknown = event.content
  try {
    content = JSON.parse(event.content)
  } catch {
    content = event.content
  }
  return JSON.stringify({ ...event, content }, null, 2)
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function stringParam(params: Record<string, unknown>, name: string): string | undefined {
  const value = params[name]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function numberParam(params: Record<string, unknown>, name: string): number | undefined {
  const value = params[name]
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined
}

function txHashParam(params: Record<string, unknown>): string | undefined {
  const value = stringParam(params, 'txHash')
  return value && /^0x[a-fA-F0-9]{64}$/.test(value) ? value : undefined
}

function evmTransactionProofUrl(baseUrl: string | undefined, params: Record<string, unknown>): string | undefined {
  const txHash = txHashParam(params)
  if (!baseUrl || !txHash) return undefined
  try {
    const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
    return new URL(`tx/${txHash}`, base).toString()
  } catch {
    return undefined
  }
}

function paymentContentFields(payment: marketplace.ParsedPayment): {
  amount?: marketplace.MarketplaceAmount
  sealedAmount?: unknown
} {
  const content = recordValue(payment.content)
  const amount = content?.amount
  return {
    ...(recordValue(amount) ? { amount: amount as marketplace.MarketplaceAmount } : {}),
    ...(content?.sealedAmount ? { sealedAmount: content.sealedAmount } : {}),
  }
}

function paymentProofParams(proof: marketplace.PaymentProofEvidence | null | undefined): Record<string, unknown> {
  const proofRecord = recordValue(proof)
  const params = recordValue(proofRecord?.params)
  return params ?? {}
}

function formatProofAmount(params: Record<string, unknown>): string | undefined {
  const value = stringParam(params, 'amount') ?? stringParam(params, 'value') ?? stringParam(params, 'fundedValue')
  const denomination = stringParam(params, 'denomination') ?? stringParam(params, 'currency')
  const decimals = numberParam(params, 'decimals')
  if (!value) return undefined
  if (!denomination || decimals === undefined) return value
  return formatMarketplaceAmount({ value, denomination, decimals })
}

function paymentAmountLabel(
  payment: marketplace.ParsedPayment,
  proof: marketplace.PaymentProofEvidence | null | undefined,
): string {
  const content = paymentContentFields(payment)
  if (content.amount) return formatMarketplaceAmount(content.amount)
  if (content.sealedAmount) return 'Sealed amount'
  const proofAmount = formatProofAmount(paymentProofParams(proof))
  if (proofAmount) return proofAmount
  return 'Unknown amount'
}

function proofDriverLabel(proof: marketplace.PaymentProofEvidence | null | undefined): string | undefined {
  const proofRecord = recordValue(proof)
  const driver = proofRecord?.driver
  const method = proofRecord?.method
  if (typeof driver === 'string') return driver
  if (typeof method === 'string') return method
  return undefined
}

function settlementLabel(settlement: marketplace.ParsedPaymentSettlement): string {
  if (settlement.content.action === 'auction_promote') return 'Payment promote'
  if (settlement.content.action === 'auction_refund') return 'Payment refund'
  return 'Payment settlement'
}

function latestEvent<T extends { event: PaymentEvent }>(items: T[]): T | undefined {
  return [...items].sort((left, right) =>
    right.event.created_at - left.event.created_at || right.event.id.localeCompare(left.event.id),
  )[0]
}

function lifecycleStatus(lifecycle: PaymentLifecycle): {
  label: string
  variant: BadgeVariant
} {
  const latestDecision = latestEvent<PaymentDecision>([
    ...lifecycle.acks,
    ...lifecycle.nacks,
    ...lifecycle.settlements,
  ])
  if (latestDecision?.event.kind === 32125) {
    const settlement = latestDecision as marketplace.ParsedPaymentSettlement
    if (settlement.content.action === 'auction_promote') return { label: 'Promoted', variant: 'default' }
    if (settlement.content.action === 'auction_refund') return { label: 'Refunded', variant: 'secondary' }
    return { label: 'Settled', variant: 'secondary' }
  }
  if (latestDecision?.event.kind === 32127) return { label: 'Rejected', variant: 'destructive' }
  if (latestDecision?.event.kind === 32124) return { label: 'Accepted', variant: 'default' }
  return lifecycle.payment
    ? { label: 'Payment sent', variant: 'outline' }
    : { label: 'Payment missing', variant: 'destructive' }
}

function paymentIdsForDecision(decision: PaymentDecision): string[] {
  return decision.refs.payments.length > 0 ? decision.refs.payments : [`unreferenced:${decision.event.id}`]
}

function buildPaymentLifecycles(
  payments: marketplace.ParsedPayment[],
  paymentAcks: marketplace.ParsedPaymentAck[],
  paymentNacks: marketplace.ParsedPaymentNack[],
  settlements: marketplace.ParsedPaymentSettlement[],
): PaymentLifecycle[] {
  const lifecycles = new Map<string, PaymentLifecycle>()

  function ensureLifecycle(id: string): PaymentLifecycle {
    const existing = lifecycles.get(id)
    if (existing) return existing
    const created = { id, acks: [], nacks: [], settlements: [] }
    lifecycles.set(id, created)
    return created
  }

  payments.forEach((payment, index) => {
    const lifecycle = ensureLifecycle(payment.event.id)
    lifecycle.payment = payment
    lifecycle.paymentIndex = index
  })

  for (const ack of paymentAcks) {
    for (const paymentId of paymentIdsForDecision(ack)) ensureLifecycle(paymentId).acks.push(ack)
  }
  for (const nack of paymentNacks) {
    for (const paymentId of paymentIdsForDecision(nack)) ensureLifecycle(paymentId).nacks.push(nack)
  }
  for (const settlement of settlements) {
    for (const paymentId of paymentIdsForDecision(settlement)) ensureLifecycle(paymentId).settlements.push(settlement)
  }

  return [...lifecycles.values()].sort((left, right) => {
    const leftTime = left.payment?.event.created_at ?? latestEvent([...left.acks, ...left.nacks, ...left.settlements])?.event.created_at ?? 0
    const rightTime = right.payment?.event.created_at ?? latestEvent([...right.acks, ...right.nacks, ...right.settlements])?.event.created_at ?? 0
    if (leftTime !== rightTime) return leftTime - rightTime
    return left.id.localeCompare(right.id)
  })
}

function paymentEventItem(
  payment: marketplace.ParsedPayment,
  index: number,
  totalPayments: number,
  evmBlockExplorerUrl: string | undefined,
): LifecycleItem {
  const proof = payment.content.proof?.paymentProof
  const proofLabel = proofDriverLabel(proof)
  const sealed = Boolean(payment.content.sealedProof)
  const params = paymentProofParams(proof)
  const proofUrl = proofLabel?.startsWith('evm') ? evmTransactionProofUrl(evmBlockExplorerUrl, params) : undefined
  return {
    key: `payment:${payment.event.id}:${index}`,
    label: totalPayments > 1 ? `Payment ${index + 1}` : 'Payment',
    badge: proofLabel ?? (sealed ? 'sealed' : 'payment'),
    badgeVariant: 'outline',
    event: payment.event,
    icon: <FileTextIcon aria-hidden="true" className="size-4" />,
    action: proofUrl ? (
      <Button asChild size="sm" variant="secondary">
        <a href={proofUrl} target="_blank" rel="noreferrer">
          <ExternalLinkIcon aria-hidden="true" className="size-4" />
          See Proof
        </a>
      </Button>
    ) : undefined,
    facts: [
      { label: 'Amount', value: paymentAmountLabel(payment, proof) },
      { label: 'Proof', value: proofLabel ?? (sealed ? 'sealed' : undefined) },
      { label: 'Policy', value: stringParam(params, 'policyType') },
      { label: 'Mint', value: stringParam(params, 'mint') },
      { label: 'Settlement', value: stringParam(params, 'settlementId') ? shortPubkey(stringParam(params, 'settlementId')!) : undefined },
      { label: 'Trade', value: shortPubkey(payment.tradeId) },
      ...refFacts(payment.refs),
    ],
  }
}

function ackEventItem(ack: marketplace.ParsedPaymentAck, index: number, count: number): LifecycleItem {
  return {
    key: `ack:${ack.event.id}:${index}`,
    label: count > 1 ? `Payment ACK ${index + 1}` : 'Payment ACK',
    badge: ack.content.status,
    badgeVariant: 'default',
    event: ack.event,
    icon: <CheckCircleIcon aria-hidden="true" className="size-4" />,
    message: ack.content.message ?? 'Accepted',
    facts: [
      { label: 'Author', value: shortPubkey(ack.event.pubkey) },
      { label: 'Trade', value: shortPubkey(ack.tradeId) },
      ...refFacts(ack.refs),
    ],
  }
}

function nackEventItem(nack: marketplace.ParsedPaymentNack, index: number, count: number): LifecycleItem {
  return {
    key: `nack:${nack.event.id}:${index}`,
    label: count > 1 ? `Payment NACK ${index + 1}` : 'Payment NACK',
    badge: nack.content.status,
    badgeVariant: 'destructive',
    event: nack.event,
    icon: <XCircleIcon aria-hidden="true" className="size-4" />,
    message: nack.content.message ?? 'Rejected',
    facts: [
      { label: 'Author', value: shortPubkey(nack.event.pubkey) },
      { label: 'Trade', value: shortPubkey(nack.tradeId) },
      ...refFacts(nack.refs),
    ],
  }
}

function settlementEventItem(
  settlement: marketplace.ParsedPaymentSettlement,
  index: number,
  count: number,
): LifecycleItem {
  return {
    key: `settlement:${settlement.event.id}:${index}`,
    label: count > 1 ? `${settlementLabel(settlement)} ${index + 1}` : settlementLabel(settlement),
    badge: settlement.content.action.replace(/_/g, ' '),
    badgeVariant: settlement.content.action === 'auction_promote' ? 'default' : 'secondary',
    event: settlement.event,
    icon: <RefreshCwIcon aria-hidden="true" className="size-4" />,
    message: settlement.content.action === 'auction_promote' ? 'Winning payment promoted into escrow' : undefined,
    facts: [
      { label: 'Method', value: settlement.content.method },
      { label: 'Action', value: settlement.content.action },
      { label: 'Outputs', value: settlement.content.outputs?.length },
      { label: 'Trade', value: shortPubkey(settlement.tradeId) },
      ...refFacts(settlement.refs),
    ],
  }
}

function lifecycleItems(
  lifecycle: PaymentLifecycle,
  totalPayments: number,
  evmBlockExplorerUrl: string | undefined,
): LifecycleItem[] {
  const items = [
    ...(lifecycle.payment
      ? [paymentEventItem(lifecycle.payment, lifecycle.paymentIndex ?? 0, totalPayments, evmBlockExplorerUrl)]
      : []),
    ...lifecycle.acks.map((ack, index) => ackEventItem(ack, index, lifecycle.acks.length)),
    ...lifecycle.nacks.map((nack, index) => nackEventItem(nack, index, lifecycle.nacks.length)),
    ...lifecycle.settlements.map((settlement, index) => settlementEventItem(settlement, index, lifecycle.settlements.length)),
  ]
  return items.sort((left, right) =>
    left.event.created_at === right.event.created_at
      ? left.event.id.localeCompare(right.event.id)
      : left.event.created_at - right.event.created_at,
  )
}

function visibleFacts(facts: LifecycleFact[]): LifecycleFact[] {
  return facts.filter(fact => fact.value !== undefined && fact.value !== null && fact.value !== '')
}

function LifecycleFacts({ facts }: { facts: LifecycleFact[] }) {
  const factsToShow = visibleFacts(facts)
  if (factsToShow.length === 0) return null
  return (
    <dl className="grid gap-2 text-xs leading-5 sm:grid-cols-2">
      {factsToShow.map(fact => (
        <div className="min-w-0" key={fact.label}>
          <dt className="uppercase text-muted-foreground">{fact.label}</dt>
          <dd className="mt-0.5 font-mono text-foreground [overflow-wrap:anywhere]">{fact.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function LifecycleEventPanel({ item }: { item: LifecycleItem }) {
  return (
    <div className="grid gap-3 rounded-lg border bg-background p-3">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 gap-2">
          <span className="mt-0.5 text-muted-foreground">{item.icon}</span>
          <div className="min-w-0">
            <strong className="block text-sm font-medium">{item.label}</strong>
            <span className="mt-1 block text-xs text-muted-foreground [overflow-wrap:anywhere]">
              {eventKindLabel(item.event.kind)} · {shortPubkey(item.event.id)}
            </span>
          </div>
        </div>
        <Badge className="shrink-0 capitalize" variant={item.badgeVariant}>{item.badge}</Badge>
      </div>
      {item.message && <p className="m-0 text-sm leading-6 text-muted-foreground">{item.message}</p>}
      {item.action}
      <LifecycleFacts facts={[
        { label: 'Event id', value: item.event.id },
        { label: 'Author', value: shortPubkey(item.event.pubkey) },
        { label: 'Created', value: formatDateTime(item.event.created_at) },
        { label: 'Kind', value: item.event.kind },
        ...item.facts,
      ]} />
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
        {parsedEventJson(item.event)}
      </pre>
    </div>
  )
}

function PaymentLifecycleAccordion({
  evmBlockExplorerUrl,
  lifecycle,
  totalPayments,
}: {
  evmBlockExplorerUrl?: string
  lifecycle: PaymentLifecycle
  totalPayments: number
}) {
  const [expanded, setExpanded] = useState(false)
  const items = lifecycleItems(lifecycle, totalPayments, evmBlockExplorerUrl)
  const status = lifecycleStatus(lifecycle)
  const payment = lifecycle.payment
  const proof = payment?.content.proof?.paymentProof
  const amount = payment ? paymentAmountLabel(payment, proof) : undefined
  const latest = latestEvent(items)
  const title = payment
    ? totalPayments > 1 ? `Payment ${Number(lifecycle.paymentIndex ?? 0) + 1}` : 'Payment'
    : lifecycle.id.startsWith('unreferenced:')
      ? 'Unreferenced payment lifecycle'
      : `Missing payment ${shortPubkey(lifecycle.id)}`
  return (
    <article className="rounded-lg border bg-background">
      <button
        aria-expanded={expanded}
        className="flex w-full min-w-0 items-center justify-between gap-3 rounded-lg p-3 text-left outline-none transition hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50"
        onClick={() => setExpanded(value => !value)}
        type="button"
      >
        <span className="grid min-w-0 gap-1">
          <strong className="text-sm font-medium text-foreground">{title}</strong>
          <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
            {amount ? `${amount} · ` : ''}
            {payment ? shortPubkey(payment.event.id) : 'payment event not loaded'}
            {' · '}
            {items.length === 1 ? '1 event' : `${items.length} events`}
            {latest ? <> · updated {formatDateTime(latest.event.created_at)}</> : null}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <Badge className="capitalize" variant={status.variant}>{status.label}</Badge>
          <ChevronDownIcon
            aria-hidden="true"
            className={cn('size-4 text-muted-foreground transition-transform', expanded && 'rotate-180')}
          />
        </span>
      </button>
      {expanded && (
        <div className="grid gap-2 border-t p-3">
          {items.map(item => <LifecycleEventPanel item={item} key={item.key} />)}
        </div>
      )}
    </article>
  )
}

export function PaymentLifecycles({
  payments,
  paymentAcks,
  paymentNacks,
  settlements,
  evmBlockExplorerUrl,
  className,
  emptyText = 'No payment, ACK, NACK, or settlement event has been published yet.',
}: PaymentLifecyclesProps) {
  const lifecycles = useMemo(
    () => buildPaymentLifecycles(payments, paymentAcks, paymentNacks, settlements),
    [paymentAcks, paymentNacks, payments, settlements],
  )

  if (lifecycles.length === 0) {
    return (
      <p className={cn('m-0 rounded-lg border border-dashed p-3 text-sm leading-6 text-muted-foreground', className)}>
        {emptyText}
      </p>
    )
  }

  return (
    <div className={cn('grid gap-2', className)}>
      {lifecycles.map(lifecycle => (
        <PaymentLifecycleAccordion
          evmBlockExplorerUrl={evmBlockExplorerUrl}
          key={lifecycle.id}
          lifecycle={lifecycle}
          totalPayments={payments.length}
        />
      ))}
    </div>
  )
}
