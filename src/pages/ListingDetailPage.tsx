import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { CheckCircleIcon, ChevronDownIcon } from 'lucide-react'
import * as marketplaceSdk from 'nostr-tools/marketplace'

import { CodeHint } from '../codeHints/codeHints'
import { formatPrice } from '../components/ListingCard'
import { ProfileChip, profileLabel } from '../components/ProfileChip'
import {
  Badge,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from '../components/ui'
import { AdvancedAccordion } from '../components/widgets/AdvancedAccordion'
import { Eyebrow } from '../components/widgets/Eyebrow'
import { CurrencyInput } from '../components/widgets/CurrencyInput'
import { DateRangePicker } from '../components/widgets/DateRangePicker'
import { Facts } from '../components/widgets/FactList'
import { Field } from '../components/widgets/FormField'
import { InvoiceBox } from '../components/widgets/InvoiceBox'
import { ListingReviews, type ListingReviewItem } from '../components/widgets/ListingReviews'
import { PaymentLifecycles } from '../components/widgets/PaymentLifecycles'
import { PaymentProgressIndicator } from '../components/widgets/PaymentProgressIndicator'
import { PaymentRouteSummary, paymentRouteSummary } from '../components/widgets/PaymentRouteSummary'
import { PaymentStatusPanel } from '../components/widgets/PaymentStatusPanel'
import { PrivacyOption } from '../components/widgets/PrivacyOption'
import { AuctionEndValue, TimeAgoText } from '../components/widgets/TimeText'
import {
  bidChainStageClass,
  bidChainStageLabel,
  isOwnBidChain,
  isWinningBidChain,
  publicBidBuyerPubkey,
  publicBidChainBuyerPubkey,
  sortBidChains,
} from '../nostr/auctionBidChains'
import { shortPubkey } from '../nostr/inboxThreads'
import { fetchProfiles, type NostrProfile } from '../nostr/profiles'
import type { AppSession, LoadedMarketplaceSession, NostrPublisher } from '../types'
import {
  formatDecimalUnits,
  formatDenominatedUnits,
  formatMarketplaceAmount,
} from '../utils/amountDisplay'
import {
  defaultCurrencyDecimals,
  minimumCurrencyAmount,
  parseCurrencyAmountInput,
  validateCurrencyAmountInput,
  type CurrencyAmount,
  type CurrencyAmountValidation,
} from '../utils/currencyAmount'

type Props = {
  listing?: marketplaceSdk.MarketplaceListing
  marketplace: ReturnType<typeof marketplaceSdk.bind>
  marketplaceSession?: LoadedMarketplaceSession
  session?: AppSession
  publisher?: NostrPublisher
  evmBlockExplorerUrl?: string
  onPublished(): void
  onError(error: string): void
  onLoginRequired(message: string): void
}

type ArbitrationServiceChoice = {
  key: string
  service: marketplaceSdk.ParsedArbitrationService
  route?: marketplaceSdk.MarketplacePaymentRoute
  disabledReason?: string
}

type ArbiterChoice = {
  pubkey: string
  profile?: NostrProfile
  services: ArbitrationServiceChoice[]
  disabledReason?: string
}

type PaymentFlowStatus = 'idle' | 'working' | 'success' | 'error'

const DEFAULT_CHECKOUT_PUBLIC = false
const DEFAULT_BID_PUBLIC = true

function FlowDoneView({ body }: { body?: string }) {
  return (
    <div className="grid min-h-64 place-items-center rounded-lg border bg-muted/30 p-8 text-center">
      <div className="grid justify-items-center gap-3">
        <CheckCircleIcon className="size-14 text-green-500" aria-hidden="true" />
        <div className="grid gap-1">
          <strong className="text-xl">Done</strong>
          {body && <p className="m-0 max-w-sm text-sm text-muted-foreground">{body}</p>}
        </div>
      </div>
    </div>
  )
}

function parseDecimalAmount(value: string): { units: bigint; decimals: number } {
  const match = value.trim().match(/^(\d+)(?:\.(\d+))?$/)
  if (!match) throw new Error(`Invalid decimal amount: ${value}`)
  const [, whole, fraction = ''] = match
  return {
    units: BigInt(`${whole}${fraction}`),
    decimals: fraction.length,
  }
}

function formatUnits(units: bigint, decimals: number): string {
  if (decimals === 0) return units.toString()
  const negative = units < 0n
  const value = negative ? -units : units
  const raw = value.toString().padStart(decimals + 1, '0')
  const whole = raw.slice(0, -decimals)
  const fraction = raw.slice(-decimals).replace(/0+$/, '')
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`
}

function decimalToUnits(value: string, decimals: number): bigint {
  const { units, decimals: sourceDecimals } = parseDecimalAmount(value)
  if (sourceDecimals === decimals) return units
  if (sourceDecimals < decimals) return units * 10n ** BigInt(decimals - sourceDecimals)
  const scale = 10n ** BigInt(sourceDecimals - decimals)
  if (units % scale !== 0n) {
    throw new Error(`Price ${value} has more decimal places than the selected asset supports`)
  }
  return units / scale
}

function denomination(value: string): string {
  const normalized = value.toUpperCase()
  if (normalized === 'SAT' || normalized === 'SATS' || normalized === 'XBT') return 'BTC'
  if (normalized === 'USDT' || normalized === 'USDC') return 'USD'
  return normalized
}

function amountForAuctionRoute(value: string, currency: string, asset: marketplaceSdk.MarketplacePaymentAsset): marketplaceSdk.MarketplaceAmount {
  void asset
  const normalized = denomination(currency)
  const targetDecimals = defaultCurrencyDecimals(normalized) ?? 0
  const units = decimalToUnits(value, targetDecimals)
  return {
    value: units.toString(),
    currency: normalized,
    denomination: normalized,
    decimals: targetDecimals,
  }
}

function auctionRouteAmountDecimals(
  currency: string,
  asset: marketplaceSdk.MarketplacePaymentAsset | undefined,
): number | undefined {
  void asset
  return defaultCurrencyDecimals(denomination(currency))
}

function currencyAmountLimits(amount: CurrencyAmount | undefined): CurrencyAmount[] | undefined {
  return amount ? [amount] : undefined
}

function minimumAmountLimits(denomination: string, decimals: number | undefined): CurrencyAmount[] | undefined {
  return currencyAmountLimits(minimumCurrencyAmount(denomination, decimals))
}

function currencyAmountLimitFromDecimal(
  value: string | undefined,
  denomination: string,
  decimals: number | undefined,
): CurrencyAmount[] | undefined {
  if (!value || !denomination) return undefined
  try {
    return [parseCurrencyAmountInput(value, { denomination, decimals })]
  } catch {
    return undefined
  }
}

function amountForNegotiation(value: string, currency: string): marketplaceSdk.MarketplaceAmount {
  const parsed = parseDecimalAmount(value)
  const normalized = denomination(currency)
  return {
    value: parsed.units.toString(),
    currency: normalized,
    denomination: normalized,
    decimals: parsed.decimals,
  }
}

function readableError(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback
}

function arbiterProfileLabel(pubkey: string, profile?: NostrProfile): string {
  const label = profileLabel(pubkey, profile)
  return label === shortPubkey(pubkey) ? label : `${label} (${shortPubkey(pubkey)})`
}

function routeChoiceKey(route: marketplaceSdk.MarketplacePaymentRoute): string {
  return JSON.stringify([
    route.arbitrationService.event.id,
    route.descriptor.id,
    route.descriptor.type,
    route.descriptor.hash ?? null,
    route.asset.assetId,
  ])
}

function routeAmountForCurrency(currency: string): marketplaceSdk.MarketplaceAmount {
  const normalized = denomination(currency)
  const decimals = defaultCurrencyDecimals(normalized) ?? 0
  return {
    value: '0',
    currency: normalized,
    denomination: normalized,
    decimals,
  }
}

function arbiterChoicesForRoutes(
  routes: marketplaceSdk.MarketplacePaymentRoute[],
  profiles: Map<string, NostrProfile>,
): ArbiterChoice[] {
  const choicesByPubkey = new Map<string, ArbiterChoice>()
  for (const route of routes) {
    const pubkey = route.arbitrationService.event.pubkey
    const choice = choicesByPubkey.get(pubkey) ?? {
      pubkey,
      profile: profiles.get(pubkey),
      services: [],
    }
    if (!choicesByPubkey.has(pubkey)) choicesByPubkey.set(pubkey, choice)

    const key = routeChoiceKey(route)
    if (!choice.services.some(service => service.key === key)) {
      choice.services.push({
        key,
        service: route.arbitrationService,
        route,
      })
    }
  }
  return [...choicesByPubkey.values()]
}

function serviceChoiceLabel(choice: ArbitrationServiceChoice): string {
  const service = choice.service
  const parts = [
    service.content.type,
    service.d || shortPubkey(service.event.id),
  ]
  if (choice.route) {
    parts.push(choice.route.asset.denomination)
    if (choice.route.asset.chainId !== undefined) parts.push(`chain ${choice.route.asset.chainId}`)
  }
  return parts.filter(Boolean).join(' / ')
}

function routeSummary(route: marketplaceSdk.MarketplacePaymentRoute | undefined, service: ArbitrationServiceChoice | undefined): string | undefined {
  return paymentRouteSummary(route, service?.service.content.type)
}

function dateTimeLocalFromSeconds(seconds: number): string {
  const date = new Date(seconds * 1000)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function secondsFromDateTimeLocal(value: string, label: string): number {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new Error(`Choose a valid ${label}`)
  return Math.floor(parsed / 1000)
}

function formatDateTime(seconds: number | undefined): string {
  if (seconds === undefined) return 'Not set'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(seconds * 1000))
}

function auctionStatus(auction: marketplaceSdk.ParsedMarketplaceAuction, now = Math.floor(Date.now() / 1000)): string {
  if (auction.startAt && now < auction.startAt) return 'Scheduled'
  if (auction.endAt && now > auction.endAt) return 'Ended'
  return 'Live'
}

function auctionCompleteLabel(complete: marketplaceSdk.ParsedMarketplaceAuctionComplete | undefined): string | undefined {
  if (!complete) return undefined
  if (complete.status === 'closed') return 'Closed'
  if (complete.status === 'reserve_not_met') return 'Reserve not met'
  if (complete.status === 'cancelled') return 'Cancelled'
  return complete.status.replace(/_/g, ' ')
}

function auctionDisplayStatus(
  auction: marketplaceSdk.ParsedMarketplaceAuction,
  complete: marketplaceSdk.ParsedMarketplaceAuctionComplete | undefined,
): string {
  return auctionCompleteLabel(complete) ?? auctionStatus(auction)
}

function plural(value: number, singular: string, pluralForm = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : pluralForm}`
}

function EventFactGrid({ facts }: { facts: Array<{ label: string; value?: ReactNode }> }) {
  const visibleFacts = facts.filter(fact => fact.value !== undefined && fact.value !== null && fact.value !== '')
  if (visibleFacts.length === 0) return null
  return (
    <dl className="grid gap-2 text-xs leading-5 sm:grid-cols-2">
      {visibleFacts.map(fact => (
        <div className="min-w-0" key={fact.label}>
          <dt className="uppercase text-muted-foreground">{fact.label}</dt>
          <dd className="mt-0.5 font-mono text-foreground [overflow-wrap:anywhere]">{fact.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function AuctionBidChainAccordion({
  bidProfiles,
  chain,
  complete,
  evmBlockExplorerUrl,
  expanded,
  onToggle,
}: {
  bidProfiles: Map<string, NostrProfile>
  chain: marketplaceSdk.ParsedAuctionBidChain
  complete: marketplaceSdk.ParsedMarketplaceAuctionComplete | undefined
  evmBlockExplorerUrl?: string
  expanded: boolean
  onToggle(): void
}) {
  const publicBuyerPubkey = publicBidChainBuyerPubkey(chain)
  const stageClass = bidChainStageClass(chain, complete)
  const arbiterEventCount = chain.groups.reduce(
    (sum, group) => sum + group.paymentAcks.length + group.paymentNacks.length + group.settlements.length,
    0,
  )
  return (
    <div
      className={`rounded-lg border ${isWinningBidChain(chain, complete) ? 'bg-muted/50' : 'bg-muted/30'}`}
      data-testid="auction-bid-chain"
    >
      <button
        aria-expanded={expanded}
        className="flex w-full min-w-0 items-center justify-between gap-4 rounded-lg p-3 text-left outline-none transition hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50"
        data-testid="auction-bid-chain-toggle"
        onClick={onToggle}
        type="button"
      >
        <div className="grid min-w-0 gap-1">
          <strong>{formatMarketplaceAmount(chain.amount)}</strong>
          {publicBuyerPubkey ? (
            <ProfileChip compact pubkey={publicBuyerPubkey} profile={bidProfiles.get(publicBuyerPubkey)} />
          ) : (
            <span className="text-xs font-medium text-muted-foreground">Anonymous bid</span>
          )}
          <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
            updated <TimeAgoText seconds={chain.head.bid.event.created_at} />
            {' · '}
            head {shortPubkey(chain.head.tradeId)}
            {' · '}
            {plural(chain.groups.length, 'bid')}
            {' · '}
            {plural(chain.paymentEventIds.length, 'payment')}
            {' · '}
            {chain.complete ? 'complete chain' : 'incomplete chain'}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant={stageClass === 'cancel' ? 'destructive' : stageClass === 'commit' ? 'default' : 'secondary'}>
            {bidChainStageLabel(chain, complete)}
          </Badge>
          <ChevronDownIcon
            aria-hidden="true"
            className={`size-4 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        </div>
      </button>
      {expanded && (
        <div className="grid gap-3 border-t p-3">
          <EventFactGrid facts={[
            { label: 'Bid chain', value: chain.id },
            { label: 'Total', value: formatMarketplaceAmount(chain.amount) },
            { label: 'Head bid', value: chain.head.bid.event.id },
            { label: 'Head trade', value: chain.head.tradeId },
            { label: 'Updated', value: <TimeAgoText seconds={chain.head.bid.event.created_at} /> },
            { label: 'Bid legs', value: plural(chain.groups.length, 'bid') },
            { label: 'Payment events', value: plural(chain.paymentEventIds.length, 'payment') },
            { label: 'Complete', value: chain.complete ? 'Yes' : 'No' },
          ]} />
          {arbiterEventCount === 0 && (
            <p className="m-0 rounded-lg border border-dashed p-3 text-sm leading-6 text-muted-foreground">
              No arbiter ACK, NACK, or payment promote/refund event has been published for this chain yet.
            </p>
          )}
          <div className="grid gap-3">
            {chain.groups.map((group, index) => {
              const isHead = group.bid.event.id === chain.head.bid.event.id
              return (
                <div className="grid gap-3 rounded-lg border bg-background p-3" key={group.id}>
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <div className="min-w-0">
                      <strong className="block text-sm font-medium">
                        {isHead ? 'Current bid leg' : `Bid leg ${index + 1}`}
                      </strong>
                      <span className="mt-1 block text-xs text-muted-foreground [overflow-wrap:anywhere]">
                        trade {shortPubkey(group.tradeId)} · bid <TimeAgoText seconds={group.bid.event.created_at} />
                      </span>
                    </div>
                    <Badge className="shrink-0" variant="outline">{formatMarketplaceAmount(group.amount)}</Badge>
                  </div>
                  <EventFactGrid facts={[
                    { label: 'Bid group', value: group.id },
                    { label: 'Trade', value: group.tradeId },
                    { label: 'Bid event', value: group.bid.event.id },
                    { label: 'Payment event', value: group.payment?.event.id },
                    { label: 'Latest ACK', value: group.paymentAck?.event.id },
                    { label: 'Latest NACK', value: group.paymentNack?.event.id },
                    { label: 'Latest promote/refund', value: group.settlement?.event.id },
                  ]} />
                  <PaymentLifecycles
                    evmBlockExplorerUrl={evmBlockExplorerUrl}
                    payments={group.payments}
                    paymentAcks={group.paymentAcks}
                    paymentNacks={group.paymentNacks}
                    settlements={group.settlements}
                    emptyText="No payment, ACK, NACK, or settlement event has been published for this bid leg yet."
                  />
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function safeUnits(value: string | undefined): bigint {
  return value && /^\d+$/.test(value) ? BigInt(value) : 0n
}

function bidChainUnits(chain: marketplaceSdk.ParsedAuctionBidChain): bigint {
  return safeUnits(chain.amount.value)
}

function highestBidChainUnits(chains: marketplaceSdk.ParsedAuctionBidChain[]): bigint {
  return chains.reduce((highest, chain) => {
    const value = bidChainUnits(chain)
    return value > highest ? value : highest
  }, 0n)
}

function minimumNextBidUnits(
  auction: marketplaceSdk.ParsedMarketplaceAuction,
  chains: marketplaceSdk.ParsedAuctionBidChain[],
): bigint {
  const highest = highestBidChainUnits(chains)
  const minimum = safeUnits(auction.startingBid)
  const increment = safeUnits(auction.minIncrement)
  if (highest <= 0n) return minimum
  return highest + (increment > 0n ? increment : 1n)
}

function defaultBidAddAmount(
  auction: marketplaceSdk.ParsedMarketplaceAuction,
  chains: marketplaceSdk.ParsedAuctionBidChain[],
  previousChain: marketplaceSdk.ParsedAuctionBidChain | undefined,
): string {
  const previousTotal = previousChain ? bidChainUnits(previousChain) : 0n
  const target = minimumNextBidUnits(auction, chains)
  const increment = safeUnits(auction.minIncrement)
  const addAmount = previousChain
    ? target > previousTotal
      ? target - previousTotal
      : (increment > 0n ? increment : 1n)
    : target
  return formatUnits(addAmount, auction.decimals)
}

function sortBidGroups(groups: marketplaceSdk.ParsedAuctionBidGroup[]): marketplaceSdk.ParsedAuctionBidGroup[] {
  return [...groups].sort((left, right) => {
    const rightValue = safeUnits(right.amount.value)
    const leftValue = safeUnits(left.amount.value)
    if (rightValue !== leftValue) return rightValue > leftValue ? 1 : -1
    return right.bid.event.created_at - left.bid.event.created_at
  })
}

function latestOwnBidChain(
  chains: marketplaceSdk.ParsedAuctionBidChain[],
  ownBidGroups: marketplaceSdk.ParsedAuctionBidGroup[],
): marketplaceSdk.ParsedAuctionBidChain | undefined {
  return sortBidChains(
    chains.filter(chain => isOwnBidChain(chain, ownBidGroups)),
  )[0]
}

function uniqueCurrencies(listing: marketplaceSdk.MarketplaceListing | undefined): string[] {
  return [...new Set((listing?.prices ?? []).map(item => item.currency).filter(Boolean))]
}

export function ListingDetailPage({
  listing,
  marketplace,
  marketplaceSession,
  session,
  publisher,
  evmBlockExplorerUrl,
  onPublished,
  onError,
  onLoginRequired,
}: Props) {
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [invoice, setInvoice] = useState<string>()
  const [checkoutInvoiceActive, setCheckoutInvoiceActive] = useState(false)
  const [checkoutProgressMessage, setCheckoutProgressMessage] = useState('Creating the order payment with the selected arbitration route.')
  const [checkoutPaymentOpen, setCheckoutPaymentOpen] = useState(false)
  const [checkoutFlowStatus, setCheckoutFlowStatus] = useState<PaymentFlowStatus>('idle')
  const [checkoutFlowError, setCheckoutFlowError] = useState<string>()
  const [checkoutPublic, setCheckoutPublic] = useState(DEFAULT_CHECKOUT_PUBLIC)
  const [checkoutPaymentPrivate, setCheckoutPaymentPrivate] = useState(false)
  const [offerAmount, setOfferAmount] = useState('')
  const [offerTouched, setOfferTouched] = useState(false)
  const [negotiateOpen, setNegotiateOpen] = useState(false)
  const [arbiterPickerOpen, setArbiterPickerOpen] = useState(false)
  const [arbiterPickerLoading, setArbiterPickerLoading] = useState(false)
  const [arbiterPickerError, setArbiterPickerError] = useState<string>()
  const [arbiterChoices, setArbiterChoices] = useState<ArbiterChoice[]>([])
  const [selectedArbiterPubkey, setSelectedArbiterPubkey] = useState('')
  const [selectedServiceKey, setSelectedServiceKey] = useState('')
  const [reviews, setReviews] = useState<marketplaceSdk.ParsedReview[]>([])
  const [reviewsLoading, setReviewsLoading] = useState(false)
  const [reviewsError, setReviewsError] = useState<string>()
  const [reviewProfiles, setReviewProfiles] = useState<Map<string, NostrProfile>>(() => new Map())
  const [auctions, setAuctions] = useState<marketplaceSdk.ParsedMarketplaceAuction[]>([])
  const [auctionLoading, setAuctionLoading] = useState(false)
  const [auctionError, setAuctionError] = useState<string>()
  const [bidGroupsByAuction, setBidGroupsByAuction] = useState<Record<string, marketplaceSdk.ParsedAuctionBidGroup[]>>({})
  const [bidProfiles, setBidProfiles] = useState<Map<string, NostrProfile>>(() => new Map())
  const [auctionCompletesByAuction, setAuctionCompletesByAuction] = useState<Record<string, marketplaceSdk.ParsedMarketplaceAuctionComplete>>({})
  const [auctionModalOpen, setAuctionModalOpen] = useState(false)
  const [auctionPublishing, setAuctionPublishing] = useState(false)
  const [auctionArbiterLoading, setAuctionArbiterLoading] = useState(false)
  const [auctionArbiterError, setAuctionArbiterError] = useState<string>()
  const [auctionArbiterChoices, setAuctionArbiterChoices] = useState<ArbiterChoice[]>([])
  const [selectedAuctionArbiterPubkey, setSelectedAuctionArbiterPubkey] = useState('')
  const [selectedAuctionServiceKey, setSelectedAuctionServiceKey] = useState('')
  const [auctionCurrency, setAuctionCurrency] = useState('')
  const [auctionStart, setAuctionStart] = useState('')
  const [auctionEnd, setAuctionEnd] = useState('')
  const [auctionStartingBid, setAuctionStartingBid] = useState('')
  const [auctionMinIncrement, setAuctionMinIncrement] = useState('1')
  const [auctionReserve, setAuctionReserve] = useState('')
  const [bidAuctionAnchor, setBidAuctionAnchor] = useState('')
  const [bidAuctionSnapshot, setBidAuctionSnapshot] = useState<marketplaceSdk.ParsedMarketplaceAuction>()
  const [bidAmount, setBidAmount] = useState('')
  const [bidPublishing, setBidPublishing] = useState(false)
  const [bidInvoice, setBidInvoice] = useState<string>()
  const [bidInvoiceActive, setBidInvoiceActive] = useState(false)
  const [bidProgressMessage, setBidProgressMessage] = useState('Creating the funded bid with the selected auction arbiter.')
  const [bidFlowStatus, setBidFlowStatus] = useState<PaymentFlowStatus>('idle')
  const [bidFlowError, setBidFlowError] = useState<string>()
  const [bidPublic, setBidPublic] = useState(DEFAULT_BID_PUBLIC)
  const [bidPaymentPrivate, setBidPaymentPrivate] = useState(false)
  const [bidRouteChoices, setBidRouteChoices] = useState<ArbiterChoice[]>([])
  const [selectedBidServiceKey, setSelectedBidServiceKey] = useState('')
  const [bidRouteLoading, setBidRouteLoading] = useState(false)
  const [bidRouteError, setBidRouteError] = useState<string>()
  const [bidArbiterProfile, setBidArbiterProfile] = useState<NostrProfile>()
  const [bidPreviousChainSnapshot, setBidPreviousChainSnapshot] = useState<marketplaceSdk.ParsedAuctionBidChain>()
  const [ownAuctionBidGroups, setOwnAuctionBidGroups] = useState<marketplaceSdk.ParsedAuctionBidGroup[]>([])
  const [expandedBidGroupKey, setExpandedBidGroupKey] = useState<string>()
  const price = listing?.prices[0]
  const listingAnchorValue = useMemo(() => listing ? marketplace.listings.anchor(listing) : '', [listing, marketplace])
  const reviewItems = useMemo<ListingReviewItem[]>(
    () => reviews.map(review => {
      const buyerPubkey = marketplace.reviews.revealedBuyerPubkey(review)
      return {
        review,
        ...(buyerPubkey ? { buyerPubkey } : {}),
      }
    }),
    [reviews],
  )
  const isSeller = Boolean(listing && session?.pubkey === listing.event.pubkey)
  const availableAuctionCurrencies = useMemo(() => uniqueCurrencies(listing), [listing])
  const publicBidPubkeys = useMemo(() => {
    const pubkeys = Object.values(bidGroupsByAuction)
      .flatMap(groups => groups.map(publicBidBuyerPubkey))
      .filter((pubkey): pubkey is string => Boolean(pubkey))
    return [...new Set(pubkeys)]
  }, [bidGroupsByAuction])
  const bidChainsByAuction = useMemo<Record<string, marketplaceSdk.ParsedAuctionBidChain[]>>(() => {
    return Object.fromEntries(Object.entries(bidGroupsByAuction).map(([auctionAnchor, groups]) => [
      auctionAnchor,
      sortBidChains(marketplace.auctions.bidGroups.chains(groups)),
    ]))
  }, [bidGroupsByAuction])
  const totalAmount = useMemo(() => {
    if (!listing) return undefined
    try {
      return marketplace.listings.price(listing, { start, end })
    } catch (err) {
      console.warn('[marketplace-app] unable to calculate listing price', {
        listingId: listing.event.id,
      }, err)
      return undefined
    }
  }, [end, listing, marketplace, start])
  const total = useMemo(() => {
    if (!totalAmount || !/^\d+$/.test(totalAmount.value)) return undefined
    return formatDecimalUnits(BigInt(totalAmount.value), totalAmount.decimals)
  }, [totalAmount])
  const formattedTotal = useMemo(() => {
    if (!totalAmount) return '0'
    return formatMarketplaceAmount(totalAmount, '0')
  }, [totalAmount])
  const priceCurrencyDecimals = useMemo(
    () => price ? defaultCurrencyDecimals(price.currency) : undefined,
    [price],
  )
  const offerMinimum = useMemo(
    () => price ? minimumAmountLimits(price.currency, priceCurrencyDecimals) : undefined,
    [price, priceCurrencyDecimals],
  )
  const offerMaximum = useMemo(
    () => price ? currencyAmountLimitFromDecimal(total, price.currency, priceCurrencyDecimals) : undefined,
    [price, priceCurrencyDecimals, total],
  )
  const offerAmountValidation = useMemo<CurrencyAmountValidation>(
    () => price
      ? validateCurrencyAmountInput(offerAmount, {
          decimals: priceCurrencyDecimals,
          denomination: price.currency,
          max: offerMaximum,
          min: offerMinimum,
          required: true,
        })
      : { valid: true },
    [offerAmount, offerMaximum, offerMinimum, price, priceCurrencyDecimals],
  )
  useEffect(() => {
    if (!offerTouched) setOfferAmount(total ?? '')
  }, [offerTouched, total])

  useEffect(() => {
    if (!marketplaceSession) {
      setOwnAuctionBidGroups([])
      return undefined
    }

    const stream = marketplaceSession.me.bids.placed.watch({}, {
      label: 'marketplace-app:listing.me.bids',
      maxWait: 2500,
    })
    const snapshotSubscription = stream.snapshot.subscribe(bids => {
      setOwnAuctionBidGroups(bids)
    })
    const statusSubscription = stream.status.subscribe(status => {
      if (status instanceof marketplaceSdk.StreamError) {
        console.warn('[marketplace-app] unable to load owned auction bid groups', status.error)
        setOwnAuctionBidGroups([])
      }
    })
    return () => {
      snapshotSubscription.unsubscribe()
      statusSubscription.unsubscribe()
      stream.close('listing bids changed')
    }
  }, [marketplaceSession])

  useEffect(() => {
    setAuctionCurrency(current => current || availableAuctionCurrencies[0] || price?.currency || '')
    setAuctionStartingBid(current => current || price?.amount || '')
    setAuctionStart(current => current || dateTimeLocalFromSeconds(Math.floor(Date.now() / 1000) + 3600))
    setAuctionEnd(current => current || dateTimeLocalFromSeconds(Math.floor(Date.now() / 1000) + 86_400))
  }, [availableAuctionCurrencies, price])

  useEffect(() => {
    if (!listingAnchorValue) {
      setReviews([])
      setReviewsLoading(false)
      setReviewsError(undefined)
      return
    }

    let closed = false
    setReviewsLoading(true)
    setReviewsError(undefined)
    void marketplace.reviews.search({ listingAnchor: listingAnchorValue, limit: 80 }, { maxWait: 1500 })
      .then(nextReviews => {
        if (!closed) setReviews(nextReviews)
      })
      .catch(err => {
        console.warn('[marketplace-app] unable to fetch listing reviews', {
          listingAnchor: listingAnchorValue,
        }, err)
        if (!closed) setReviewsError(err instanceof Error ? err.message : 'Unable to load reviews')
      })
      .finally(() => {
        if (!closed) setReviewsLoading(false)
      })

    return () => {
      closed = true
    }
  }, [listingAnchorValue, marketplace])

  useEffect(() => {
    const pubkeys = reviewItems
      .map(item => item.buyerPubkey)
      .filter((pubkey): pubkey is string => Boolean(pubkey))
    if (!session || pubkeys.length === 0) {
      setReviewProfiles(new Map())
      return
    }

    let closed = false
    void fetchProfiles(session, pubkeys)
      .then(profiles => {
        if (!closed) setReviewProfiles(profiles)
      })
      .catch(err => {
        console.warn('[marketplace-app] unable to fetch review buyer profiles', { pubkeyCount: pubkeys.length }, err)
        if (!closed) setReviewProfiles(new Map())
      })

    return () => {
      closed = true
    }
  }, [reviewItems, session])

  useEffect(() => {
    if (!session || publicBidPubkeys.length === 0) {
      setBidProfiles(new Map())
      return
    }

    let closed = false
    void fetchProfiles(session, publicBidPubkeys)
      .then(profiles => {
        if (!closed) setBidProfiles(profiles)
      })
      .catch(err => {
        console.warn('[marketplace-app] unable to fetch public bid profiles', { pubkeyCount: publicBidPubkeys.length }, err)
        if (!closed) setBidProfiles(new Map())
      })

    return () => {
      closed = true
    }
  }, [publicBidPubkeys, session])

  useEffect(() => {
    if (!listing || !listingAnchorValue) {
      setAuctions([])
      setBidGroupsByAuction({})
      setAuctionCompletesByAuction({})
      setAuctionLoading(false)
      setAuctionError(undefined)
      return
    }

    let closed = false
    setAuctionLoading(true)
    setAuctionError(undefined)
    const stream = marketplace.auctions.watch(
      { listingAnchor: listingAnchorValue },
      { label: `listing-auction-scope:${listingAnchorValue}`, maxWait: 2500 },
    )

    const snapshotSubscription = stream.snapshot.subscribe(snapshots => {
      if (closed) return
      setAuctions(Object.values(snapshots)
        .map(snapshot => snapshot.auction)
        .filter((auction): auction is marketplaceSdk.ParsedMarketplaceAuction => Boolean(auction))
        .sort((left, right) => right.event.created_at - left.event.created_at))
      setBidGroupsByAuction(Object.fromEntries(
        Object.entries(snapshots).map(([auctionAnchor, snapshot]) => [
          auctionAnchor,
          sortBidGroups(snapshot.bidGroups),
        ]),
      ))
      setAuctionCompletesByAuction(Object.fromEntries(
        Object.entries(snapshots)
          .filter((entry): entry is [string, marketplaceSdk.MarketplaceAuctionScopeSnapshot & {
            complete: marketplaceSdk.ParsedMarketplaceAuctionComplete
          }] => Boolean(entry[1].complete))
          .map(([auctionAnchor, snapshot]) => [auctionAnchor, snapshot.complete]),
      ))
    })
    const statusSubscription = stream.status.subscribe(status => {
      if (status instanceof marketplaceSdk.StreamError) {
        console.warn('[marketplace-app] ignoring invalid listing auction scope event', {
          listingAnchor: listingAnchorValue,
        }, status.error)
        setAuctionError(status.error.message)
        setAuctionLoading(false)
      } else if (status instanceof marketplaceSdk.StreamEose || status instanceof marketplaceSdk.StreamLive) {
        setAuctionLoading(false)
      }
    })

    return () => {
      closed = true
      snapshotSubscription.unsubscribe()
      statusSubscription.unsubscribe()
      stream.close('listing auctions changed')
    }
  }, [listing, listingAnchorValue, marketplace])

  const selectedArbiter = useMemo(
    () => arbiterChoices.find(choice => choice.pubkey === selectedArbiterPubkey),
    [arbiterChoices, selectedArbiterPubkey],
  )
  const selectedService = useMemo(
    () => selectedArbiter?.services.find(service => service.key === selectedServiceKey),
    [selectedArbiter, selectedServiceKey],
  )
  const selectedRoute = selectedService?.route
  const selectedAuctionArbiter = useMemo(
    () => auctionArbiterChoices.find(choice => choice.pubkey === selectedAuctionArbiterPubkey),
    [auctionArbiterChoices, selectedAuctionArbiterPubkey],
  )
  const selectedAuctionService = useMemo(
    () => selectedAuctionArbiter?.services.find(service => service.key === selectedAuctionServiceKey),
    [selectedAuctionArbiter, selectedAuctionServiceKey],
  )
  const selectedAuctionRoute = selectedAuctionService?.route
  const bidAuction = useMemo(
    () => (
      auctions.find(auction => auction.auctionAnchor === bidAuctionAnchor) ??
      (bidAuctionSnapshot?.auctionAnchor === bidAuctionAnchor ? bidAuctionSnapshot : undefined)
    ),
    [auctions, bidAuctionAnchor, bidAuctionSnapshot],
  )
  const selectedBidArbiter = useMemo(
    () => bidRouteChoices.find(choice => choice.pubkey === bidAuction?.arbiterPubkey) ?? bidRouteChoices[0],
    [bidAuction, bidRouteChoices],
  )
  const selectedBidService = useMemo(
    () => selectedBidArbiter?.services.find(service => service.key === selectedBidServiceKey),
    [selectedBidArbiter, selectedBidServiceKey],
  )
  const selectedBidRoute = selectedBidService?.route
  const bidAuctionChains = useMemo(
    () => bidAuction ? (bidChainsByAuction[bidAuction.auctionAnchor] ?? []) : [],
    [bidAuction, bidChainsByAuction],
  )
  const bidPreviousChain = useMemo(
    () => bidPreviousChainSnapshot
      ? bidAuctionChains.find(chain => chain.id === bidPreviousChainSnapshot.id) ?? bidPreviousChainSnapshot
      : undefined,
    [bidAuctionChains, bidPreviousChainSnapshot],
  )
  const bidAddUnits = useMemo(() => {
    if (!bidAuction || !bidAmount) return 0n
    try {
      return decimalToUnits(bidAmount, bidAuction.decimals)
    } catch {
      return 0n
    }
  }, [bidAmount, bidAuction])
  const bidPreviousTotalUnits = bidPreviousChain ? bidChainUnits(bidPreviousChain) : 0n
  const bidNewTotalUnits = bidPreviousTotalUnits + bidAddUnits
  const auctionAmountDecimals = useMemo(
    () => auctionRouteAmountDecimals(auctionCurrency, selectedAuctionRoute?.asset),
    [auctionCurrency, selectedAuctionRoute],
  )
  const auctionMinimum = useMemo(
    () => minimumAmountLimits(auctionCurrency, auctionAmountDecimals),
    [auctionAmountDecimals, auctionCurrency],
  )
  const auctionStartingBidMinimum = useMemo(
    () => auctionCurrency && auctionAmountDecimals !== undefined
      ? [{ value: '0', denomination: auctionCurrency, decimals: auctionAmountDecimals }]
      : undefined,
    [auctionAmountDecimals, auctionCurrency],
  )
  const auctionStartingBidValidation = useMemo<CurrencyAmountValidation>(
    () => validateCurrencyAmountInput(auctionStartingBid, {
      decimals: auctionAmountDecimals,
      denomination: auctionCurrency,
      min: auctionStartingBidMinimum,
    }),
    [auctionAmountDecimals, auctionCurrency, auctionStartingBid, auctionStartingBidMinimum],
  )
  const auctionMinIncrementValidation = useMemo<CurrencyAmountValidation>(
    () => validateCurrencyAmountInput(auctionMinIncrement, {
      decimals: auctionAmountDecimals,
      denomination: auctionCurrency,
      min: auctionMinimum,
    }),
    [auctionAmountDecimals, auctionCurrency, auctionMinIncrement, auctionMinimum],
  )
  const auctionReserveValidation = useMemo<CurrencyAmountValidation>(
    () => validateCurrencyAmountInput(auctionReserve, {
      decimals: auctionAmountDecimals,
      denomination: auctionCurrency,
      min: auctionMinimum,
    }),
    [auctionAmountDecimals, auctionCurrency, auctionMinimum, auctionReserve],
  )
  const auctionAmountsValid = (
    auctionStartingBidValidation.valid &&
    auctionMinIncrementValidation.valid &&
    auctionReserveValidation.valid
  )
  const bidMinimumAddUnits = useMemo(() => {
    if (!bidAuction) return 1n
    const minimumTotal = minimumNextBidUnits(bidAuction, bidAuctionChains)
    const needed = minimumTotal - bidPreviousTotalUnits
    return needed > 1n ? needed : 1n
  }, [bidAuction, bidAuctionChains, bidPreviousTotalUnits])
  const bidMinimum = useMemo(
    () => bidAuction
      ? [{ value: bidMinimumAddUnits.toString(), denomination: bidAuction.currency, decimals: bidAuction.decimals }]
      : undefined,
    [bidAuction, bidMinimumAddUnits],
  )
  const bidAmountValidation = useMemo<CurrencyAmountValidation>(
    () => bidAuction
      ? validateCurrencyAmountInput(bidAmount, {
          decimals: bidAuction.decimals,
          denomination: bidAuction.currency,
          min: bidMinimum,
          required: true,
        })
      : { valid: true },
    [bidAmount, bidAuction, bidMinimum],
  )
  const bidRouteAmount = useMemo<marketplaceSdk.MarketplaceAmount | undefined>(() => {
    if (!bidAuction) return undefined
    try {
      const units = bidAmount ? decimalToUnits(bidAmount, bidAuction.decimals) : bidMinimumAddUnits
      return {
        value: (units > 0n ? units : bidMinimumAddUnits).toString(),
        denomination: bidAuction.currency,
        decimals: bidAuction.decimals,
      }
    } catch {
      return {
        value: bidMinimumAddUnits.toString(),
        denomination: bidAuction.currency,
        decimals: bidAuction.decimals,
      }
    }
  }, [bidAmount, bidAuction, bidMinimumAddUnits])

  useEffect(() => {
    if (auctionModalOpen && auctionCurrency) void loadAuctionArbiterChoices(auctionCurrency)
  }, [auctionCurrency, auctionModalOpen, listing, marketplaceSession])

  useEffect(() => {
    if (!bidAuction || !listing || !marketplaceSession || !bidRouteAmount) {
      setBidRouteChoices([])
      setSelectedBidServiceKey('')
      setBidRouteLoading(false)
      setBidRouteError(undefined)
      setBidArbiterProfile(undefined)
      return
    }

    let closed = false
    setBidRouteLoading(true)
    setBidRouteError(undefined)
    void (async () => {
      try {
        const routes = await resolveBidPaymentRoutes(bidAuction, bidRouteAmount)
        if (closed) return
        const arbiterPubkeys = [...new Set([
          bidAuction.arbiterPubkey,
          ...routes.map(route => route.arbitrationService.event.pubkey),
        ])]
        let profiles = new Map<string, NostrProfile>()
        if (session) {
          try {
            profiles = await fetchProfiles(session, arbiterPubkeys)
          } catch (err) {
            console.warn('[marketplace-app] unable to fetch bid arbiter profile', {
              arbiterPubkey: bidAuction.arbiterPubkey,
            }, err)
          }
        }
        if (closed) return
        const choices = arbiterChoicesForRoutes(routes, profiles)
        setBidRouteChoices(choices)
        if (routes.length === 0) {
          setBidRouteError(`No supported ${bidAuction.currency} bid payment route for this auction arbiter`)
        }
        const services = choices.flatMap(choice => choice.services)
        const currentService = services.find(service => service.key === selectedBidServiceKey && service.route)
        const firstUsableService = services.find(service => service.route)
        setSelectedBidServiceKey(currentService?.key ?? firstUsableService?.key ?? '')
        setBidArbiterProfile(profiles.get(bidAuction.arbiterPubkey))
      } catch (err) {
        if (!closed) {
          setBidRouteChoices([])
          setSelectedBidServiceKey('')
          setBidRouteError(readableError(err, 'Unable to load bid payment route'))
        }
      } finally {
        if (!closed) setBidRouteLoading(false)
      }
    })()
    return () => {
      closed = true
    }
  }, [
    bidAuction,
    bidRouteAmount,
    listing,
    marketplaceSession,
    session,
  ])

  function requireCheckoutDates(): boolean {
    if (price?.frequency && (!start || !end)) {
      console.warn('[marketplace-app] checkout dates required', {
        listingId: listing?.event.id,
        hasStart: Boolean(start),
        hasEnd: Boolean(end),
      })
      onError('Choose start and end dates before checkout')
      return false
    }
    return true
  }

  function selectArbiter(pubkey: string, choices = arbiterChoices) {
    const choice = choices.find(item => item.pubkey === pubkey)
    const firstUsableService = choice?.services.find(service => service.route)
    setSelectedArbiterPubkey(pubkey)
    setSelectedServiceKey(firstUsableService?.key ?? '')
  }

  function selectAuctionArbiter(pubkey: string, choices = auctionArbiterChoices) {
    const choice = choices.find(item => item.pubkey === pubkey)
    const firstUsableService = choice?.services.find(service => service.route)
    setSelectedAuctionArbiterPubkey(pubkey)
    setSelectedAuctionServiceKey(firstUsableService?.key ?? '')
  }

  async function resolveBidPaymentRoutes(
    auction: marketplaceSdk.ParsedMarketplaceAuction,
    amount: marketplaceSdk.MarketplaceAmount,
  ): Promise<marketplaceSdk.MarketplacePaymentRoute[]> {
    if (!listing || !marketplaceSession) return []
    const bidRoutes = await marketplaceSession.auctions.paymentRoutes(listing, auction, {
      amount,
    })
    if (bidRoutes.length === 0) {
      console.warn('[marketplace-app] no matching auction bid route', {
        auctionAnchor: auction.auctionAnchor,
        arbiterPubkey: auction.arbiterPubkey,
        currency: auction.currency,
        decimals: auction.decimals,
        routes: bidRoutes.map(candidate => ({
          arbiterPubkey: candidate.arbitrationService.event.pubkey,
          service: candidate.arbitrationService.d,
          assetId: candidate.asset.assetId,
          denomination: candidate.asset.denomination,
          decimals: candidate.asset.decimals,
          policyType: candidate.descriptor.type,
          policyHash: candidate.descriptor.hash,
        })),
      })
    }
    return bidRoutes
  }

  async function loadArbiterChoices() {
    if (!listing || !price || !marketplaceSession) return
    if (!session) {
      onLoginRequired('Sign in to choose arbiter and checkout')
      return
    }
    setArbiterPickerLoading(true)
    setArbiterPickerError(undefined)
    try {
      console.debug('[marketplace-app] loading checkout arbiter choices', {
        listingId: listing.event.id,
        sellerPubkey: listing.event.pubkey,
        denomination: price.currency,
      })
      const amount = marketplace.listings.price(listing, { start, end })
      const routes = await marketplaceSession.orders.paymentRoutes(listing, {
        amount,
      })
      if (routes.length === 0) {
        setArbiterChoices([])
        setSelectedArbiterPubkey('')
        setSelectedServiceKey('')
        setArbiterPickerError(`No supported ${price.currency} marketplace payment route`)
        console.warn('[marketplace-app] checkout has no supported payment routes', {
          listingId: listing.event.id,
          sellerPubkey: listing.event.pubkey,
          amount,
        })
        return
      }

      const arbiterPubkeys = [...new Set(routes.map(route => route.arbitrationService.event.pubkey))]
      const profiles = await fetchProfiles(session, arbiterPubkeys)
      const choices = arbiterChoicesForRoutes(routes, profiles)

      setArbiterChoices(choices)
      const firstUsableArbiter = choices.find(choice => choice.services.some(service => service.route))
      if (firstUsableArbiter) {
        selectArbiter(firstUsableArbiter.pubkey, choices)
      } else {
        setSelectedArbiterPubkey('')
        setSelectedServiceKey('')
      }
      console.debug('[marketplace-app] loaded checkout arbiter choices', {
        listingId: listing.event.id,
        arbiterCount: choices.length,
        serviceCount: choices.reduce((sum, choice) => sum + choice.services.length, 0),
        usableRouteCount: routes.length,
      })
    } catch (err) {
      console.warn('[marketplace-app] unable to load checkout arbiter choices', err)
      setArbiterPickerError(err instanceof Error ? err.message : 'Unable to load arbiter choices')
    } finally {
      setArbiterPickerLoading(false)
    }
  }

  async function loadAuctionArbiterChoices(currency = auctionCurrency) {
    if (!listing || !marketplaceSession || !currency) return
    if (!session) {
      onLoginRequired('Sign in to create auctions')
      return
    }
    setAuctionArbiterLoading(true)
    setAuctionArbiterError(undefined)
    try {
      const amount = routeAmountForCurrency(currency)
      const routes = await marketplaceSession.auctions.paymentRoutes(listing, {
        amount,
      })
      if (routes.length === 0) {
        setAuctionArbiterChoices([])
        setSelectedAuctionArbiterPubkey('')
        setSelectedAuctionServiceKey('')
        setAuctionArbiterError(`No supported ${currency} auction payment route`)
        return
      }

      const arbiterPubkeys = [...new Set(routes.map(route => route.arbitrationService.event.pubkey))]
      const profiles = await fetchProfiles(session, arbiterPubkeys)
      const choices = arbiterChoicesForRoutes(routes, profiles)

      setAuctionArbiterChoices(choices)
      const firstUsableArbiter = choices.find(choice => choice.services.some(service => service.route))
      if (firstUsableArbiter) selectAuctionArbiter(firstUsableArbiter.pubkey, choices)
      else {
        setSelectedAuctionArbiterPubkey('')
        setSelectedAuctionServiceKey('')
      }
    } catch (err) {
      console.warn('[marketplace-app] unable to load auction arbiter choices', err)
      setAuctionArbiterError(err instanceof Error ? err.message : 'Unable to load auction arbiter choices')
    } finally {
      setAuctionArbiterLoading(false)
    }
  }

  function openAuctionModal() {
    if (!listing || !isSeller) return
    if (!session || !publisher || !marketplaceSession) {
      onLoginRequired('Sign in as the seller to create auctions')
      return
    }
    const now = Math.floor(Date.now() / 1000)
    setAuctionCurrency(auctionCurrency || availableAuctionCurrencies[0] || price?.currency || '')
    setAuctionStartingBid(auctionStartingBid || price?.amount || '')
    setAuctionStart(auctionStart || dateTimeLocalFromSeconds(now + 3600))
    setAuctionEnd(auctionEnd || dateTimeLocalFromSeconds(now + 86_400))
    setAuctionModalOpen(true)
    void loadAuctionArbiterChoices(auctionCurrency || availableAuctionCurrencies[0] || price?.currency || '')
  }

  function openNegotiateDialog() {
    if (!listing?.negotiable || !price) return
    if (!offerTouched) setOfferAmount(total ?? '')
    setNegotiateOpen(true)
  }

  async function createAuction() {
    if (!session || !publisher || !marketplaceSession) {
      onLoginRequired('Sign in as the seller to create auctions')
      return
    }
    if (!listing || !selectedAuctionRoute || !listingAnchorValue) {
      onError('Choose a usable auction arbitration service')
      return
    }
    const invalidAuctionAmount = [
      auctionStartingBidValidation,
      auctionMinIncrementValidation,
      auctionReserveValidation,
    ].find(validation => !validation.valid)
    if (invalidAuctionAmount) {
      const message = invalidAuctionAmount.error ?? 'Enter valid auction amounts'
      setAuctionArbiterError(message)
      onError(message)
      return
    }
    setAuctionPublishing(true)
    setAuctionArbiterError(undefined)
    try {
      const startAt = secondsFromDateTimeLocal(auctionStart, 'auction start')
      const endAt = secondsFromDateTimeLocal(auctionEnd, 'auction end')
      if (endAt <= startAt) throw new Error('Auction end must be after auction start')
      const startingBid = amountForAuctionRoute(
        auctionStartingBid || '0',
        auctionCurrency,
        selectedAuctionRoute.asset,
      )
      const minIncrement = auctionMinIncrement
        ? amountForAuctionRoute(auctionMinIncrement, auctionCurrency, selectedAuctionRoute.asset)
        : undefined
      const reserve = auctionReserve
        ? amountForAuctionRoute(auctionReserve, auctionCurrency, selectedAuctionRoute.asset)
        : undefined
      const template = marketplace.auctions.template({
        d: `${listing.d}-auction-${Date.now()}`,
        listingAnchor: listingAnchorValue,
        arbiterPubkey: selectedAuctionRoute.arbitrationService.event.pubkey,
        currency: startingBid.denomination,
        decimals: startingBid.decimals,
        startAt,
        endAt,
        maxEndAt: endAt,
        settlementGrace: 3600,
        startingBid: startingBid.value,
        ...(minIncrement !== undefined ? { minIncrement: minIncrement.value } : {}),
        ...(reserve !== undefined ? { reserve: reserve.value } : {}),
        content: {
          route: {
            method: selectedAuctionRoute.policy.method,
            policyId: selectedAuctionRoute.descriptor.id,
            assetId: selectedAuctionRoute.asset.assetId,
            arbitrationServiceId: selectedAuctionRoute.arbitrationService.event.id,
          },
        },
      })
      const event = await publisher.sign(template)
      await publisher.publish(event)
      const parsed = marketplace.auctions.parse(event)
      setAuctions(current => [parsed, ...current.filter(auction => auction.auctionAnchor !== parsed.auctionAnchor)])
      setAuctionModalOpen(false)
      onPublished()
    } catch (err) {
      console.warn('[marketplace-app] unable to create auction', err)
      const message = err instanceof Error ? err.message : 'Unable to create auction'
      setAuctionArbiterError(message)
      onError(message)
    } finally {
      setAuctionPublishing(false)
    }
  }

  function openBidModal(auction: marketplaceSdk.ParsedMarketplaceAuction) {
    const chains = bidChainsByAuction[auction.auctionAnchor] ?? []
    const previousChain = latestOwnBidChain(chains, ownAuctionBidGroups)
    setBidAuctionAnchor(auction.auctionAnchor)
    setBidAuctionSnapshot(auction)
    setBidPreviousChainSnapshot(previousChain)
    setBidAmount(defaultBidAddAmount(auction, chains, previousChain))
    setBidInvoice(undefined)
    setBidInvoiceActive(false)
    setBidProgressMessage('Creating the funded bid with the selected auction arbiter.')
    setBidFlowStatus('idle')
    setBidFlowError(undefined)
    setBidPublic(DEFAULT_BID_PUBLIC)
    setBidPaymentPrivate(false)
    setBidRouteChoices([])
    setSelectedBidServiceKey('')
    setBidRouteLoading(true)
    setBidRouteError(undefined)
    setBidArbiterProfile(undefined)
  }

  function closeBidModal() {
    setBidAuctionAnchor('')
    setBidAuctionSnapshot(undefined)
    setBidPreviousChainSnapshot(undefined)
    setBidPublic(DEFAULT_BID_PUBLIC)
    setBidPaymentPrivate(false)
    setBidRouteChoices([])
    setSelectedBidServiceKey('')
    setBidRouteLoading(false)
    setBidRouteError(undefined)
    setBidArbiterProfile(undefined)
  }

  async function submitBid() {
    if (!session || !marketplaceSession) {
      onLoginRequired('Sign in to place auction bids')
      return
    }
    if (!listing || !bidAuction) return
    if (price?.frequency && (!start || !end)) {
      const message = 'Choose start and end dates before bidding'
      setBidFlowStatus('error')
      setBidFlowError(message)
      onError(message)
      return
    }
    if (!bidAmountValidation.valid) {
      const message = bidAmountValidation.error ?? 'Enter a valid bid amount'
      setBidFlowStatus('error')
      setBidFlowError(message)
      onError(message)
      return
    }
    setBidPublishing(true)
    setBidInvoice(undefined)
    setBidInvoiceActive(false)
    setBidProgressMessage('Creating the funded bid with the selected auction arbiter.')
    setBidFlowStatus('working')
    setBidFlowError(undefined)
    try {
      const addUnits = decimalToUnits(bidAmount, bidAuction.decimals)
      if (addUnits <= 0n) throw new Error('Bid amount must be greater than zero')
      const chains = bidChainsByAuction[bidAuction.auctionAnchor] ?? []
      const previousChain = bidPreviousChain
      const previousTotal = previousChain ? bidChainUnits(previousChain) : 0n
      const chainTotal = previousTotal + addUnits
      const minimumTotal = minimumNextBidUnits(bidAuction, chains)
      if (chainTotal < minimumTotal) {
        throw new Error(`Bid chain total must be at least ${formatDenominatedUnits(minimumTotal, bidAuction.decimals, bidAuction.currency)}`)
      }
      const amount: marketplaceSdk.MarketplaceAmount = {
        value: addUnits.toString(),
        denomination: bidAuction.currency,
        decimals: bidAuction.decimals,
      }
      const chainTotalAmount: marketplaceSdk.MarketplaceAmount = {
        value: chainTotal.toString(),
        denomination: bidAuction.currency,
        decimals: bidAuction.decimals,
      }
      const bidRoute = selectedBidRoute
      if (!bidRoute) {
        throw new Error(`Choose a supported ${bidAuction.currency} bid payment route`)
      }
      const states = marketplaceSession.auctions.bid(listing, {
        auctionAnchor: bidAuction.auctionAnchor,
        listingAnchor: listingAnchorValue,
        amount,
        data: {
          bidChainTotal: chainTotalAmount,
          ...(previousChain ? {
            previousBidId: previousChain.head.bid.event.id,
            previousBidChainId: previousChain.id,
            previousBidAmount: previousChain.amount,
            bidIncrement: amount,
          } : {}),
        },
        ...(previousChain ? {
          extraTags: [
            ['prev_bid', previousChain.head.bid.event.id],
            ['e', previousChain.head.bid.event.id, '', 'prev_bid'],
            ['prev_amount', previousChain.amount.value, previousChain.amount.denomination, previousChain.amount.decimals.toString()],
            ['delta_amount', amount.value, amount.denomination, amount.decimals.toString()],
            ['chain_amount', chainTotalAmount.value, chainTotalAmount.denomination, chainTotalAmount.decimals.toString()],
          ],
        } : {
          extraTags: [
            ['chain_amount', chainTotalAmount.value, chainTotalAmount.denomination, chainTotalAmount.decimals.toString()],
          ],
        }),
        targetOrder: {
          listingAnchor: listingAnchorValue,
          start: start || undefined,
          end: end || undefined,
          amount: chainTotalAmount,
        },
      }, {
        auction: bidAuction.event,
        route: bidRoute,
        identityProofPrivacy: bidPublic ? 'public' : 'none',
        paymentProofPrivacy: bidPaymentPrivate ? 'sealed' : 'public',
      })

      for await (const state of states) {
        if (state.type === 'payment_required' && state.request.type === 'bolt11') {
          setBidInvoice(state.request.bolt11)
          setBidInvoiceActive(true)
          setBidProgressMessage('Waiting for the external invoice payment to complete.')
        }
        if (state.type === 'payment_progress') {
          setBidProgressMessage(state.status)
        }
        if (state.type === 'bid_published') {
          setBidProgressMessage('Publishing bid payment proof.')
        }
        if (state.type === 'payment_published') {
          setBidInvoiceActive(false)
          setBidFlowStatus('success')
          onPublished()
        }
      }
      setBidFlowStatus('success')
    } catch (err) {
      console.warn('[marketplace-app] unable to submit auction bid', err)
      const message = readableError(err, 'Unable to submit auction bid')
      setBidFlowStatus('error')
      setBidFlowError(message)
      setBidInvoiceActive(false)
      onError(message)
    } finally {
      setBidPublishing(false)
    }
  }

  async function negotiate() {
    if (!listing || !price || !total) return
    if (!session || !marketplaceSession) {
      onLoginRequired('Sign in to negotiate this listing')
      return
    }
    if (!listing.negotiable) {
      console.warn('[marketplace-app] attempted negotiation on non-negotiable listing', {
        listingId: listing.event.id,
      })
      onError('This listing is not negotiable')
      return
    }
    if (!requireCheckoutDates()) return
    if (!offerAmountValidation.valid) {
      onError(offerAmountValidation.error ?? 'Enter a valid offer amount')
      return
    }
    setPublishing(true)
    setInvoice(undefined)
    setCheckoutInvoiceActive(false)
    setCheckoutProgressMessage('Creating the order payment with the selected arbitration route.')
    try {
      console.debug('[marketplace-app] publishing negotiation offer', {
        listingId: listing.event.id,
        denomination: price.currency,
        amount: offerAmount || total,
      })
      const result = await marketplaceSession.orders.negotiate(listing, {
        start: start || undefined,
        end: end || undefined,
        amount: amountForNegotiation(offerAmount || total, price.currency),
      })
      onPublished()
      setNegotiateOpen(false)
      console.debug('[marketplace-app] negotiation offer published', {
        listingId: listing.event.id,
        tradeIndex: result.accountIndex,
        tradeId: result.tradeId,
      })
    } catch (err) {
      console.warn('[marketplace-app] unable to send negotiation offer', err)
      onError(err instanceof Error ? err.message : 'Unable to send negotiation offer')
    } finally {
      setPublishing(false)
    }
  }

  async function startCheckout() {
    if (!listing || !price || total === undefined) return
    if (!session || !publisher || !marketplaceSession) {
      console.warn('[marketplace-app] checkout attempted before marketplace runtime is ready', {
        listingId: listing.event.id,
      })
      onLoginRequired('Sign in to checkout')
      return
    }
    if (!requireCheckoutDates()) return
    setInvoice(undefined)
    setCheckoutInvoiceActive(false)
    setCheckoutProgressMessage('Creating the order payment with the selected arbitration route.')
    setCheckoutFlowStatus('idle')
    setCheckoutFlowError(undefined)
    setCheckoutPublic(DEFAULT_CHECKOUT_PUBLIC)
    setCheckoutPaymentPrivate(false)
    setCheckoutPaymentOpen(false)
    setArbiterPickerOpen(true)
    await loadArbiterChoices()
  }

  async function checkoutWithRoute(route: marketplaceSdk.MarketplacePaymentRoute) {
    if (!listing || !price || total === undefined) return
    if (!session || !marketplaceSession) {
      onLoginRequired('Sign in to checkout')
      return
    }
    setPublishing(true)
    setInvoice(undefined)
    setCheckoutInvoiceActive(false)
    setCheckoutProgressMessage('Creating the order payment with the selected arbitration route.')
    setCheckoutFlowStatus('working')
    setCheckoutFlowError(undefined)
    setCheckoutPaymentOpen(true)
    setArbiterPickerOpen(false)
    try {
      console.debug('[marketplace-app] starting checkout', {
        listingId: listing.event.id,
        denomination: price.currency,
        total,
      })
      console.debug('[marketplace-app] selected checkout payment route', {
        listingId: listing.event.id,
        method: route.policy.method,
        assetId: route.asset.assetId,
        denomination: route.asset.denomination,
        decimals: route.asset.decimals,
        policyId: route.descriptor.id,
      })
      const paymentAmount = marketplace.listings.price(listing, { start, end })
      console.debug('[marketplace-app] checkout payment amount calculated', {
        listingId: listing.event.id,
        value: paymentAmount.value,
        denomination: paymentAmount.denomination,
        decimals: paymentAmount.decimals,
      })
      let publishedOrderId: string | undefined
      const paymentStates = marketplaceSession.pay(listing, {
        start: start || undefined,
        end: end || undefined,
        amount: paymentAmount,
      }, {
        route,
        identityProofPrivacy: checkoutPublic ? 'public' : 'none',
        paymentProofPrivacy: checkoutPaymentPrivate ? 'sealed' : 'public',
      })
      for await (const paymentState of paymentStates) {
        console.debug('[marketplace-app] checkout payment state', {
          listingId: listing.event.id,
          type: paymentState.type,
          status: 'status' in paymentState ? paymentState.status : undefined,
          eventId: 'event' in paymentState ? paymentState.event.id : undefined,
        })
        if (paymentState.type === 'payment_required' && paymentState.request.type === 'bolt11') {
          console.debug('[marketplace-app] checkout requires external payment', {
            listingId: listing.event.id,
            requestType: paymentState.request.type,
            amount: paymentState.request.amount,
          })
          setInvoice(paymentState.request.bolt11)
          setCheckoutInvoiceActive(true)
          setCheckoutProgressMessage('Waiting for the external invoice payment to complete.')
        }
        if (paymentState.type === 'payment_progress') {
          setCheckoutProgressMessage(paymentState.status)
        }
        if (paymentState.type === 'order_published') {
          setCheckoutProgressMessage('Publishing order payment proof.')
          publishedOrderId = paymentState.event.id
          console.debug('[marketplace-app] checkout order published', {
            listingId: listing.event.id,
            eventId: paymentState.event.id,
            kind: paymentState.event.kind,
            pubkey: paymentState.event.pubkey,
          })
        }
        if (paymentState.type === 'payment_published') {
          setCheckoutInvoiceActive(false)
          setCheckoutFlowStatus('success')
          console.debug('[marketplace-app] checkout payment proof published', {
            listingId: listing.event.id,
            orderEventId: publishedOrderId,
            paymentEventId: paymentState.event.id,
            kind: paymentState.event.kind,
            pubkey: paymentState.event.pubkey,
          })
          onPublished()
        }
      }
      setCheckoutFlowStatus('success')
      console.debug('[marketplace-app] checkout payment stream completed', {
        listingId: listing.event.id,
      })
    } catch (err) {
      console.warn('[marketplace-app] checkout failed', err)
      const message = readableError(err, 'Unable to publish reservation offer')
      setCheckoutFlowStatus('error')
      setCheckoutFlowError(message)
      setCheckoutInvoiceActive(false)
      onError(message)
    } finally {
      setPublishing(false)
    }
  }

  async function confirmArbiterSelection() {
    if (!selectedRoute) {
      onError('Choose a usable arbiter and arbitration service')
      return
    }
    await checkoutWithRoute(selectedRoute)
  }

  if (!listing) {
    return (
      <section className="grid gap-4 p-7">
        <h1 className="text-3xl font-medium leading-tight">Listing not found</h1>
      </section>
    )
  }

  const image = listing.images[0]?.url
  return (
    <section
      className="grid grid-cols-[minmax(0,1fr)_360px] items-start gap-6 p-7 max-[860px]:grid-cols-1"
      data-testid="listing-detail"
    >
      <div className="min-w-0">
        {image && <img className="mb-5 h-[390px] w-full rounded-xl object-cover max-[860px]:h-64" src={image} alt="" />}
        <Eyebrow className="mb-2">{listing.location || 'Classified'}</Eyebrow>
        <h1 className="text-3xl font-medium leading-tight">{listing.title}</h1>
        {listing.summary && <p className="mt-3 text-lg leading-8 text-muted-foreground">{listing.summary}</p>}
        <p className={cn(listing.summary ? 'text-sm leading-6' : 'mt-3 text-lg leading-8', 'text-muted-foreground')}>{listing.description}</p>
        <CodeHint
          code="marketplace.reviews.search({ listingAnchor: listingAnchorValue, limit: 80 })"
          className="rounded-xl"
        >
          <ListingReviews
            error={reviewsError}
            loading={reviewsLoading}
            profiles={reviewProfiles}
            reviews={reviewItems}
          />
        </CodeHint>
        <CodeHint
          code="marketplace.auctions.watch({ listingAnchor: listingAnchorValue })"
          className="mt-6 rounded-xl"
        >
          <section className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <Eyebrow className="mb-2">Auctions</Eyebrow>
                <h2 className="text-lg font-medium">Listing auctions</h2>
              </div>
              {isSeller && (
                <Button
                  variant="secondary"
                  disabled={!marketplaceSession || auctionPublishing}
                  onClick={openAuctionModal}
                >
                  Create auction
                </Button>
              )}
            </div>
            {auctionLoading && <p className="m-0 text-sm leading-6 text-muted-foreground">Loading auctions...</p>}
            {auctionError && <p className="m-0 text-sm leading-6 text-destructive">{auctionError}</p>}
            {!auctionLoading && auctions.length === 0 && (
              <p className="m-0 text-sm leading-6 text-muted-foreground">No auctions attached to this listing.</p>
            )}
            {auctions.length > 0 && (
              <div className="grid gap-3">
                {auctions.map(auction => {
                  const chains = bidChainsByAuction[auction.auctionAnchor] ?? []
                  const complete = auctionCompletesByAuction[auction.auctionAnchor]
                  const highest = highestBidChainUnits(chains)
                  const status = auctionDisplayStatus(auction, complete)
                  const isLive = status === 'Live'
                  return (
                    <Card className="grid gap-4 p-4" key={auction.auctionAnchor}>
                      <div className="flex min-w-0 items-center justify-between gap-4">
                        <div className="min-w-0">
                          <strong className="block text-base font-medium">{status}</strong>
                          <span className="mt-1 block text-sm text-muted-foreground">{auction.currency} auction</span>
                        </div>
                        <Badge variant={complete ? 'default' : 'secondary'}>
                          {complete ? status : `${chains.length} bid chain${chains.length === 1 ? '' : 's'}`}
                        </Badge>
                      </div>
                      <Facts facts={[
                        { label: 'Starts', value: formatDateTime(auction.startAt) },
                        { label: 'Ends', value: <AuctionEndValue seconds={auction.endAt} /> },
                        { label: 'Starting bid', value: formatDenominatedUnits(safeUnits(auction.startingBid), auction.decimals, auction.currency) },
                        { label: 'Highest bid', value: formatDenominatedUnits(highest, auction.decimals, auction.currency) },
                        { label: 'Arbiter', value: shortPubkey(auction.arbiterPubkey) },
                      ]} />
                      <div className="flex min-w-0 flex-wrap items-center justify-between gap-4">
                        {!isSeller && (
                          <Button
                            data-testid="place-bid-button"
                            disabled={!isLive || bidPublishing}
                            onClick={() => {
                              if (!session) onLoginRequired('Sign in to place auction bids')
                              else openBidModal(auction)
                            }}
                          >
                            Place bid
                          </Button>
                        )}
                        {isSeller && <span className="text-sm text-muted-foreground">Bids settle through {shortPubkey(auction.arbiterPubkey)}</span>}
                      </div>
                      {complete && (
                        <div className="grid gap-1 rounded-lg border bg-muted/50 p-3 text-sm leading-6">
                          <strong>{auctionCompleteLabel(complete)}</strong>
                          <span className="text-muted-foreground [overflow-wrap:anywhere]">
                            {complete.finalAmount
                              ? formatMarketplaceAmount(complete.finalAmount)
                              : 'No winning amount'}
                            {complete.winnerPubkey ? ` · winner ${shortPubkey(complete.winnerPubkey)}` : ''}
                          </span>
                          {(complete.promotedOrderId || complete.promotedPaymentId) && (
                            <span className="text-muted-foreground [overflow-wrap:anywhere]">
                              {complete.promotedOrderId ? `order ${shortPubkey(complete.promotedOrderId)}` : ''}
                              {complete.promotedOrderId && complete.promotedPaymentId ? ' · ' : ''}
                              {complete.promotedPaymentId ? `payment ${shortPubkey(complete.promotedPaymentId)}` : ''}
                            </span>
                          )}
                        </div>
                      )}
                      {chains.length > 0 && (
                        <div className="grid gap-3 border-t pt-3">
                          {chains.map(chain => {
                            const bidGroupKey = `${auction.auctionAnchor}:${chain.id}`
                            return (
                              <CodeHint
                                code={[
                                  'const auctions = await marketplace.auctions.get({ auctionAnchor: auction.auctionAnchor })',
                                  'marketplace.auctions.watch({ auctionAnchor: auction.auctionAnchor })',
                                ]}
                                className="rounded-lg"
                                key={bidGroupKey}
                              >
                                <AuctionBidChainAccordion
                                  bidProfiles={bidProfiles}
                                  chain={chain}
                                  complete={complete}
                                  evmBlockExplorerUrl={evmBlockExplorerUrl}
	                                  expanded={expandedBidGroupKey === bidGroupKey}
                                  onToggle={() => {
                                    setExpandedBidGroupKey(current => current === bidGroupKey ? undefined : bidGroupKey)
                                  }}
                                />
                              </CodeHint>
                            )
                          })}
                        </div>
                      )}
                    </Card>
                  )
                })}
              </div>
            )}
          </section>
        </CodeHint>
      </div>
	      <CodeHint
	        code={[
	          'const amount = marketplace.listings.price(listing, { start, end })',
	          'const route = await marketplaceSession.orders.paymentRoute(listing, { amount })',
	          'marketplaceSession.pay(listing, order, { route, identityProofPrivacy, paymentProofPrivacy })',
	        ]}
        className="sticky top-7 rounded-xl"
      >
        <Card className="grid min-w-0 gap-4 p-4">
          <Eyebrow>Checkout</Eyebrow>
          <h2 className="text-lg font-medium">{price ? formatPrice(price) : 'No price'}</h2>
          {price?.frequency && (
            <DateRangePicker
              end={end}
              id="checkout-date-range"
              label="Dates"
              start={start}
              onChange={range => {
                setStart(range.start)
                setEnd(range.end)
              }}
            />
          )}
          <div className="flex items-baseline justify-between gap-4">
            <span>Total</span>
            <strong className="min-w-0 text-right [overflow-wrap:anywhere]">{formattedTotal}</strong>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2">
            <Button data-testid="checkout-button" disabled={publishing || !price} onClick={startCheckout}>
              {publishing ? 'Working...' : 'Checkout'}
            </Button>
            {listing.negotiable && (
              <Button data-testid="negotiate-button" variant="secondary" disabled={publishing || !price} onClick={openNegotiateDialog}>
                Negotiate
              </Button>
            )}
          </div>
        </Card>
      </CodeHint>
      <Dialog open={negotiateOpen} onOpenChange={open => !publishing && setNegotiateOpen(open)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <Eyebrow>Negotiate</Eyebrow>
            <DialogTitle>Send offer</DialogTitle>
            <DialogDescription className="sr-only">
              Enter an offer amount and send the negotiation offer to the seller.
            </DialogDescription>
          </DialogHeader>
          <CodeHint
            code="marketplaceSession.orders.negotiate(listing, { amount })"
            className="grid gap-4 rounded-xl"
          >
            <div className="flex items-baseline justify-between gap-4 rounded-lg border bg-muted/50 p-3">
              <span className="text-sm text-muted-foreground">Listed total</span>
              <strong className="min-w-0 text-right [overflow-wrap:anywhere]">{formattedTotal}</strong>
            </div>
            {price && (
              <Field label="Amount">
                <CurrencyInput
                  currency={price.currency}
                  data-testid="negotiation-amount-input"
                  decimals={priceCurrencyDecimals}
                  max={offerMaximum}
                  min={offerMinimum}
                  value={offerAmount}
                  onValueChange={value => {
                    setOfferTouched(true)
                    setOfferAmount(value)
                  }}
                />
              </Field>
            )}
            {!offerAmountValidation.valid && (
              <p className="m-0 text-sm text-destructive">{offerAmountValidation.error}</p>
            )}
          </CodeHint>
          <DialogFooter>
            <Button variant="secondary" disabled={publishing} onClick={() => setNegotiateOpen(false)}>
              Cancel
            </Button>
            <Button data-testid="send-offer-button" disabled={publishing || !offerAmountValidation.valid} onClick={() => void negotiate()}>
              {publishing ? 'Sending...' : 'Send offer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={arbiterPickerOpen} onOpenChange={open => !publishing && setArbiterPickerOpen(open)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <Eyebrow>Arbiter</Eyebrow>
            <DialogTitle>Choose arbitration</DialogTitle>
            <DialogDescription className="sr-only">
              Review or change the arbitration route before creating the purchase invoice.
            </DialogDescription>
          </DialogHeader>
	          <CodeHint
	            code={[
	              'const amount = marketplace.listings.price(listing, { start, end })',
	              'const route = await marketplaceSession.orders.paymentRoute(listing, { amount })',
            ]}
            className="grid gap-4 rounded-xl"
          >
            <AdvancedAccordion
              title="Advanced payment settings"
              summary={[
                routeSummary(selectedRoute, selectedService) ?? (arbiterPickerLoading ? 'Loading route' : 'No route selected'),
                checkoutPublic ? 'Public identity' : '',
                checkoutPaymentPrivate ? 'Private payment proof' : '',
              ].filter(Boolean).join(', ')}
            >
              <div className="grid grid-cols-2 gap-4 max-[860px]:grid-cols-1">
                <Field label="Seller trusted arbiter">
                  <Select
                    value={selectedArbiterPubkey}
                    disabled={arbiterPickerLoading || publishing || arbiterChoices.length === 0}
                    onValueChange={value => selectArbiter(value)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={arbiterPickerLoading ? 'Loading arbiters...' : 'Choose arbiter'} />
                    </SelectTrigger>
                    <SelectContent>
                      {arbiterChoices.map(choice => (
                        <SelectItem
                          key={choice.pubkey}
                          value={choice.pubkey}
                          disabled={Boolean(choice.disabledReason)}
                        >
                          {arbiterProfileLabel(choice.pubkey, choice.profile)}
                          {choice.disabledReason ? ` - ${choice.disabledReason}` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Arbitration service">
                  <Select
                    value={selectedServiceKey}
                    disabled={arbiterPickerLoading || publishing || !selectedArbiter}
                    onValueChange={setSelectedServiceKey}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={selectedArbiter ? 'Choose service' : 'Choose arbiter first'} />
                    </SelectTrigger>
                    <SelectContent>
                      {(selectedArbiter?.services ?? []).map(choice => (
                        <SelectItem key={choice.key} value={choice.key} disabled={!choice.route}>
                          {serviceChoiceLabel(choice)}
                          {choice.disabledReason ? ` - ${choice.disabledReason}` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              {selectedArbiter && (
                <PaymentRouteSummary
                  arbiterPubkey={selectedArbiter.pubkey}
                  fallback={selectedArbiter.disabledReason ?? 'Select a usable arbitration service'}
                  profile={selectedArbiter.profile}
                  route={selectedService?.route}
                  serviceType={selectedService?.service.content.type}
                />
              )}
              <PrivacyOption
                id="checkout-public"
                checked={checkoutPublic}
                disabled={publishing}
                label="Make public"
                description="Attach proof of your real pubkey to this order."
                onChange={setCheckoutPublic}
              />
              <PrivacyOption
                id="checkout-payment-private"
                checked={checkoutPaymentPrivate}
                disabled={publishing}
                label="Keep payment proof private"
                description="Only the seller, arbiter, and your trade key can decrypt it."
                onChange={setCheckoutPaymentPrivate}
              />
            </AdvancedAccordion>
            {arbiterPickerError && <p className="m-0 text-sm text-destructive">{arbiterPickerError}</p>}
          </CodeHint>
          <DialogFooter>
              <Button
                variant="secondary"
                disabled={publishing}
                onClick={loadArbiterChoices}
              >
                Refresh
              </Button>
              <Button
                data-testid="checkout-continue-button"
                disabled={publishing || arbiterPickerLoading || !selectedRoute}
                onClick={confirmArbiterSelection}
              >
                Continue to invoice
              </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={checkoutPaymentOpen} onOpenChange={setCheckoutPaymentOpen}>
        <DialogContent className={checkoutFlowStatus === 'success' ? 'max-w-md' : 'max-w-2xl'}>
          {checkoutFlowStatus === 'success' ? (
            <>
              <DialogTitle className="sr-only">Purchase submitted</DialogTitle>
              <FlowDoneView body="The order and payment proof were published." />
              <DialogFooter>
                <Button data-testid="checkout-done-button" onClick={() => setCheckoutPaymentOpen(false)}>
                  Done
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <Eyebrow>Payment</Eyebrow>
                <DialogTitle>Purchase payment</DialogTitle>
                <DialogDescription className="sr-only">
                  Track purchase payment status and invoice details.
                </DialogDescription>
              </DialogHeader>
              <CodeHint
                code="marketplaceSession.pay(listing, order, { route, identityProofPrivacy, paymentProofPrivacy })"
                className="grid gap-4 rounded-xl"
              >
                <PaymentStatusPanel
                    error={checkoutFlowError}
                    hasInvoice={checkoutInvoiceActive}
                    status={checkoutFlowStatus}
                    labels={{
                      successTitle: 'Purchase submitted',
                      errorTitle: 'Purchase failed',
                      invoiceTitle: 'Payment required',
                      workingTitle: 'Preparing payment',
                      successBody: 'The order and payment proof were published.',
                      errorBody: 'The purchase flow stopped before publishing.',
                      invoiceBody: 'Waiting for the external invoice payment to complete.',
                      workingBody: checkoutProgressMessage,
                    }}
                  />
                  {checkoutFlowError && checkoutFlowStatus !== 'error' && (
                    <p className="m-0 text-sm text-destructive">{checkoutFlowError}</p>
                  )}
                  {checkoutInvoiceActive && invoice ? (
                    <InvoiceBox value={invoice} />
                  ) : checkoutFlowStatus === 'working' ? (
                    <PaymentProgressIndicator label={checkoutProgressMessage} />
                  ) : null}
              </CodeHint>
              <DialogFooter>
                  <Button
                    variant="secondary"
                    onClick={() => setCheckoutPaymentOpen(false)}
                  >
                    Close
                  </Button>
                  {checkoutFlowStatus === 'error' && selectedRoute && (
                    <Button
                      disabled={publishing}
                      onClick={() => void checkoutWithRoute(selectedRoute)}
                    >
                      Retry
                    </Button>
                  )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={auctionModalOpen} onOpenChange={open => !auctionPublishing && setAuctionModalOpen(open)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <Eyebrow>Auction</Eyebrow>
            <DialogTitle>Schedule auction</DialogTitle>
            <DialogDescription className="sr-only">
              Create an auction for this listing and adjust optional auction route settings.
            </DialogDescription>
          </DialogHeader>
	          <CodeHint
	            code={[
	              'const amount = routeAmountForCurrency(currency)',
	              'const route = await marketplaceSession.auctions.paymentRoute(listing, { amount })',
	              'marketplace.auctions.template(auction)',
	              'publisher.sign(template)',
	              'publisher.publish(event)',
            ]}
            className="grid gap-4 rounded-xl"
          >
            <div className="grid grid-cols-2 gap-4 max-[860px]:grid-cols-1">
              <Field label="Currency">
                <Select
                  value={auctionCurrency}
                  disabled={auctionPublishing || availableAuctionCurrencies.length === 0}
                  onValueChange={setAuctionCurrency}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Choose currency" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableAuctionCurrencies.map(currency => (
                      <SelectItem key={currency} value={currency}>{currency}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Starting bid">
                <CurrencyInput
                  currency={auctionCurrency}
                  decimals={auctionAmountDecimals}
                  min={auctionStartingBidMinimum}
                  value={auctionStartingBid}
                  disabled={auctionPublishing}
                  onValueChange={value => setAuctionStartingBid(value)}
                />
              </Field>
              <Field label="Min increment">
                <CurrencyInput
                  currency={auctionCurrency}
                  decimals={auctionAmountDecimals}
                  min={auctionMinimum}
                  value={auctionMinIncrement}
                  disabled={auctionPublishing}
                  onValueChange={value => setAuctionMinIncrement(value)}
                />
              </Field>
              <Field label="Reserve">
                <CurrencyInput
                  currency={auctionCurrency}
                  decimals={auctionAmountDecimals}
                  min={auctionMinimum}
                  value={auctionReserve}
                  disabled={auctionPublishing}
                  placeholder="Optional"
                  onValueChange={value => setAuctionReserve(value)}
                />
              </Field>
              <Field label="Starts">
                <Input
                  type="datetime-local"
                  value={auctionStart}
                  disabled={auctionPublishing}
                  onChange={event => setAuctionStart(event.target.value)}
                />
              </Field>
              <Field label="Ends">
                <Input
                  type="datetime-local"
                  value={auctionEnd}
                  disabled={auctionPublishing}
                  onChange={event => setAuctionEnd(event.target.value)}
                />
              </Field>
            </div>
            <AdvancedAccordion
              title="Advanced auction settings"
              summary={routeSummary(selectedAuctionRoute, selectedAuctionService) ?? (auctionArbiterLoading ? 'Loading route' : 'No route selected')}
            >
              <div className="grid grid-cols-2 gap-4 max-[860px]:grid-cols-1">
                <Field label="Auction arbiter">
                  <Select
                    value={selectedAuctionArbiterPubkey}
                    disabled={auctionArbiterLoading || auctionPublishing || auctionArbiterChoices.length === 0}
                    onValueChange={value => selectAuctionArbiter(value)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={auctionArbiterLoading ? 'Loading arbiters...' : 'Choose arbiter'} />
                    </SelectTrigger>
                    <SelectContent>
                      {auctionArbiterChoices.map(choice => (
                        <SelectItem
                          key={choice.pubkey}
                          value={choice.pubkey}
                          disabled={Boolean(choice.disabledReason)}
                        >
                          {arbiterProfileLabel(choice.pubkey, choice.profile)}
                          {choice.disabledReason ? ` - ${choice.disabledReason}` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Auction service">
                  <Select
                    value={selectedAuctionServiceKey}
                    disabled={auctionArbiterLoading || auctionPublishing || !selectedAuctionArbiter}
                    onValueChange={setSelectedAuctionServiceKey}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={selectedAuctionArbiter ? 'Choose service' : 'Choose arbiter first'} />
                    </SelectTrigger>
                    <SelectContent>
                      {(selectedAuctionArbiter?.services ?? []).map(choice => (
                        <SelectItem key={choice.key} value={choice.key} disabled={!choice.route}>
                          {serviceChoiceLabel(choice)}
                          {choice.disabledReason ? ` - ${choice.disabledReason}` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              {selectedAuctionArbiter && (
                <PaymentRouteSummary
                  arbiterPubkey={selectedAuctionArbiter.pubkey}
                  fallback={selectedAuctionArbiter.disabledReason ?? 'Select a usable auction service'}
                  profile={selectedAuctionArbiter.profile}
                  route={selectedAuctionRoute}
                  serviceType={selectedAuctionService?.service.content.type}
                />
              )}
            </AdvancedAccordion>
            {auctionArbiterError && <p className="m-0 text-sm text-destructive">{auctionArbiterError}</p>}
          <DialogFooter>
              <Button
                variant="secondary"
                disabled={auctionPublishing || auctionArbiterLoading}
                onClick={() => loadAuctionArbiterChoices()}
              >
                Refresh
              </Button>
              <Button
                disabled={auctionPublishing || auctionArbiterLoading || !selectedAuctionRoute || !auctionAmountsValid}
                onClick={createAuction}
              >
	                {auctionPublishing ? 'Publishing...' : 'Create auction'}
	              </Button>
	          </DialogFooter>
          </CodeHint>
	        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(bidAuction)} onOpenChange={open => {
        if (!open) closeBidModal()
      }}>
        <DialogContent className={bidFlowStatus === 'success' ? 'max-w-md' : 'max-w-3xl'}>
          {bidFlowStatus === 'success' ? (
            <>
              <DialogTitle className="sr-only">Bid submitted</DialogTitle>
              <FlowDoneView body="The bid and payment proof were published." />
              <DialogFooter>
                <Button data-testid="bid-done-button" onClick={closeBidModal}>
                  Done
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <Eyebrow>Bid</Eyebrow>
                <DialogTitle>{bidPreviousChain ? 'Increase auction bid' : 'Place auction bid'}</DialogTitle>
                <DialogDescription className="sr-only">
                  Enter an auction bid and adjust optional bid privacy settings.
                </DialogDescription>
	            </DialogHeader>
		            {bidAuction && (
		            <CodeHint
		              code={[
		                'const bidRoutes = await marketplaceSession.auctions.paymentRoutes(listing, bidAuction.event, { amount })',
		                'const bidRoute = bidRoutes.find(route => route.descriptor.id === selectedRouteId)',
		                'marketplaceSession.auctions.bid(listing, bid, { auction: bidAuction.event, route: bidRoute, identityProofPrivacy, paymentProofPrivacy })',
		              ]}
		              className="grid gap-4 rounded-xl"
		            >
	            <PaymentStatusPanel
	              error={bidFlowError}
	              hasInvoice={bidInvoiceActive}
              status={bidFlowStatus}
              labels={{
                successTitle: 'Bid payment published',
                errorTitle: 'Bid failed',
                invoiceTitle: 'Payment required',
                workingTitle: 'Preparing bid',
                successBody: 'The bid and payment proof were published. The arbiter still needs to validate it before it counts.',
                errorBody: 'The bid flow stopped before publishing.',
                invoiceBody: 'Waiting for the external invoice payment to complete.',
                workingBody: bidProgressMessage,
              }}
            />
            <Facts facts={[
              { label: 'Currency', value: bidAuction.currency },
              {
                label: 'Current high bid',
                value: formatDenominatedUnits(
                  highestBidChainUnits(bidAuctionChains),
                  bidAuction.decimals,
                  bidAuction.currency,
                ),
              },
              ...(bidPreviousChain ? [
                {
                  label: 'Previous bid',
                  value: `${formatMarketplaceAmount(bidPreviousChain.amount)} across ${plural(bidPreviousChain.groups.length, 'bid')}`,
                },
                {
                  label: 'New bid total',
                  value: formatDenominatedUnits(bidNewTotalUnits, bidAuction.decimals, bidAuction.currency),
                },
              ] : []),
              { label: 'Ends', value: formatDateTime(bidAuction.endAt) },
            ]} />
            <Field label={bidPreviousChain ? 'Add amount' : 'Bid amount'}>
              <CurrencyInput
                currency={bidAuction.currency}
                data-testid="bid-amount-input"
                decimals={bidAuction.decimals}
                min={bidMinimum}
                required
                value={bidAmount}
                disabled={bidPublishing}
                onValueChange={value => {
                  setBidAmount(value)
                  if (bidFlowStatus !== 'working') {
                    setBidFlowStatus('idle')
                    setBidFlowError(undefined)
                    setBidInvoice(undefined)
                    setBidInvoiceActive(false)
                    setBidProgressMessage('Creating the funded bid with the selected auction arbiter.')
                  }
                }}
              />
            </Field>
            {bidPreviousChain && (
              <div className="grid gap-1 rounded-lg border bg-muted/50 p-3 text-sm leading-6">
                <strong>Previous bid chain</strong>
                <span className="text-muted-foreground [overflow-wrap:anywhere]">
                  {formatMarketplaceAmount(bidPreviousChain.amount)}
                  {' · '}
                  head {shortPubkey(bidPreviousChain.head.bid.event.id)}
                  {' · '}
                  {plural(bidPreviousChain.paymentEventIds.length, 'payment')}
                </span>
              </div>
            )}
            <AdvancedAccordion
              title="Advanced bid settings"
              summary={[
                routeSummary(selectedBidRoute, selectedBidService) ?? (bidRouteLoading ? 'Loading route' : bidRouteError ? 'Route unavailable' : 'No route selected'),
                bidPublic ? 'Public identity' : '',
                bidPaymentPrivate ? 'Private payment proof' : '',
              ].filter(Boolean).join(', ')}
            >
              <Field label="Bid payment route">
                <Select
                  value={selectedBidServiceKey}
                  disabled={bidRouteLoading || bidPublishing || !selectedBidArbiter || selectedBidArbiter.services.length === 0}
                  onValueChange={setSelectedBidServiceKey}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={bidRouteLoading ? 'Loading routes...' : selectedBidArbiter ? 'Choose route' : 'No route available'} />
                  </SelectTrigger>
                  <SelectContent>
                    {(selectedBidArbiter?.services ?? []).map(choice => (
                      <SelectItem key={choice.key} value={choice.key} disabled={!choice.route}>
                        {serviceChoiceLabel(choice)}
                        {choice.disabledReason ? ` - ${choice.disabledReason}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <PaymentRouteSummary
                arbiterPubkey={bidAuction.arbiterPubkey}
                fallback={bidRouteLoading ? 'Loading bid payment route' : bidRouteError ?? 'No supported bid payment route for this auction arbiter'}
                profile={selectedBidArbiter?.profile ?? bidArbiterProfile}
                route={selectedBidRoute}
                serviceType={selectedBidService?.service.content.type}
              />
              <PrivacyOption
                id="bid-public"
                checked={bidPublic}
                disabled={bidPublishing}
                label="Make public"
                description="Attach proof of your real pubkey to this bid."
                onChange={setBidPublic}
              />
              <PrivacyOption
                id="bid-payment-private"
                checked={bidPaymentPrivate}
                disabled={bidPublishing}
                label="Keep payment proof private"
                description="Only the seller, arbiter, and your trade key can decrypt it."
                onChange={setBidPaymentPrivate}
              />
            </AdvancedAccordion>
            {bidInvoiceActive && bidInvoice ? (
              <InvoiceBox label="Payment required" value={bidInvoice} />
            ) : bidFlowStatus === 'working' ? (
              <PaymentProgressIndicator label={bidProgressMessage} />
            ) : null}
            <DialogFooter>
              <Button
                variant="secondary"
                onClick={closeBidModal}
              >
                Cancel
              </Button>
              <Button
                data-testid="bid-continue-button"
                disabled={bidPublishing || bidRouteLoading || !selectedBidRoute || !bidAmountValidation.valid}
                onClick={submitBid}
              >
                {bidPublishing
                  ? 'Working...'
                  : bidFlowStatus === 'error'
                    ? 'Retry'
                    : 'Continue to invoice'}
	              </Button>
	            </DialogFooter>
	            </CodeHint>
	          )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  )
}
