import { useEffect, useMemo, useState } from 'react'
import * as marketplace from 'nostr-tools/marketplace'

import { formatPrice } from '../components/ListingCard'
import { ProfileChip, profileLabel } from '../components/ProfileChip'
import { listingAnchor, publishNegotiationOffer } from '../nostr/marketplaceApi'
import { shortPubkey } from '../nostr/inboxThreads'
import { fetchProfiles, type NostrProfile } from '../nostr/profiles'
import type { AppSession, LoadedMarketplace, NostrPublisher } from '../types'

type Props = {
  listing?: marketplace.MarketplaceListing
  marketplaceRuntime: ReturnType<typeof marketplace.bind>
  marketplaceState?: LoadedMarketplace
  session?: AppSession
  publisher?: NostrPublisher
  onTradeIndexUsed(index: number): void
  onPublished(): void
  onError(error: string): void
  onLoginRequired(message: string): void
}

type EscrowServiceChoice = {
  key: string
  service: marketplace.ParsedEscrowService
  route?: marketplace.MarketplacePaymentRoute
  disabledReason?: string
}

type EscrowChoice = {
  pubkey: string
  profile?: NostrProfile
  services: EscrowServiceChoice[]
  disabledReason?: string
}

type PaymentFlowStatus = 'idle' | 'working' | 'success' | 'error'

function daysBetween(start: string, end: string): number {
  const left = new Date(start).getTime()
  const right = new Date(end).getTime()
  if (!Number.isFinite(left) || !Number.isFinite(right) || right <= left) return 1
  return Math.max(1, Math.ceil((right - left) / 86_400_000))
}

function frequencyMultiplier(frequency: string | undefined, start: string, end: string): bigint {
  if (!frequency) return 1n
  if (frequency === 'P1D' || frequency.toLowerCase().includes('day')) return BigInt(daysBetween(start, end))
  return 1n
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

function amountForPrice(value: string, currency: string, multiplier = 1n): marketplace.MarketplaceAmount {
  const parsed = parseDecimalAmount(value)
  return {
    value: (parsed.units * multiplier).toString(),
    denomination: currency,
    decimals: parsed.decimals,
  }
}

function denomination(value: string): string {
  return value.toUpperCase()
}

function isBtcSatPair(left: string, right: string): boolean {
  const a = denomination(left)
  const b = denomination(right)
  return (a === 'BTC' && b === 'SAT') || (a === 'SAT' && b === 'BTC')
}

function amountForAuctionRoute(value: string, currency: string, asset: marketplace.MarketplacePaymentAsset): marketplace.MarketplaceAmount {
  const targetDecimals = isBtcSatPair(currency, asset.denomination)
    ? denomination(currency) === 'BTC' ? 8 : 0
    : asset.decimals
  const units = decimalToUnits(value, targetDecimals)
  return {
    value: units.toString(),
    denomination: currency,
    decimals: targetDecimals,
  }
}

function displayTotal(value: string, multiplier: bigint): string {
  try {
    const amount = parseDecimalAmount(value)
    return formatUnits(amount.units * multiplier, amount.decimals)
  } catch {
    return value
  }
}

function compareDecimalAmounts(left: string, right: string): number {
  const a = parseDecimalAmount(left)
  const b = parseDecimalAmount(right)
  const decimals = Math.max(a.decimals, b.decimals)
  const leftUnits = a.units * 10n ** BigInt(decimals - a.decimals)
  const rightUnits = b.units * 10n ** BigInt(decimals - b.decimals)
  return leftUnits === rightUnits ? 0 : leftUnits > rightUnits ? 1 : -1
}

function amountForNegotiation(value: string, denomination: string): marketplace.MarketplaceAmount {
  const parsed = parseDecimalAmount(value)
  return {
    value,
    denomination,
    decimals: parsed.decimals,
  }
}

function isBelowTotal(offer: string, total: string | undefined): boolean {
  if (!offer || !total) return false
  try {
    return compareDecimalAmounts(offer, total) < 0
  } catch {
    return false
  }
}

function stringifyProgress(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, entry) => (typeof entry === 'bigint' ? entry.toString() : entry),
    2,
  )
}

function readableError(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback
}

function escrowProfileLabel(pubkey: string, profile?: NostrProfile): string {
  const label = profileLabel(pubkey, profile)
  return label === shortPubkey(pubkey) ? label : `${label} (${shortPubkey(pubkey)})`
}

function serviceChoiceKey(service: marketplace.ParsedEscrowService): string {
  return service.event.id
}

function routeForService(
  service: marketplace.ParsedEscrowService,
  routes: marketplace.MarketplacePaymentRoute[],
): marketplace.MarketplacePaymentRoute | undefined {
  return routes.find(route => route.escrowService.event.id === service.event.id)
}

function serviceChoiceLabel(choice: EscrowServiceChoice): string {
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

function routeProbeForCurrency(
  listing: marketplace.MarketplaceListing,
  currency: string,
): marketplace.OrderTemplate {
  return {
    tradeId: 'route-probe',
    listingAnchor: listingAnchor(listing.event),
    amount: {
      value: '0',
      denomination: currency,
      decimals: 0,
    },
    participants: [
      { pubkey: listing.event.pubkey, role: 'seller' },
    ],
  }
}

function routeProbeFor(
  listing: marketplace.MarketplaceListing,
  price: marketplace.MarketplacePrice,
): marketplace.OrderTemplate {
  return routeProbeForCurrency(listing, price.currency)
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

function auctionStatus(auction: marketplace.ParsedMarketplaceAuction, now = Math.floor(Date.now() / 1000)): string {
  if (auction.startAt && now < auction.startAt) return 'Scheduled'
  if (auction.endAt && now > auction.endAt) return 'Ended'
  return 'Live'
}

function auctionCompleteLabel(complete: marketplace.ParsedMarketplaceAuctionComplete | undefined): string | undefined {
  if (!complete) return undefined
  if (complete.status === 'closed') return 'Closed'
  if (complete.status === 'reserve_not_met') return 'Reserve not met'
  if (complete.status === 'cancelled') return 'Cancelled'
  return complete.status.replace(/_/g, ' ')
}

function auctionDisplayStatus(
  auction: marketplace.ParsedMarketplaceAuction,
  complete: marketplace.ParsedMarketplaceAuctionComplete | undefined,
): string {
  return auctionCompleteLabel(complete) ?? auctionStatus(auction)
}

function auctionCompleteMap(
  completes: marketplace.ParsedMarketplaceAuctionComplete[],
): Record<string, marketplace.ParsedMarketplaceAuctionComplete> {
  return Object.fromEntries(completes.map(complete => [complete.auctionAnchor, complete]))
}

function completeWinningBidId(complete: marketplace.ParsedMarketplaceAuctionComplete | undefined): string | undefined {
  const data = complete?.content.data
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const winningBidId = (data as Record<string, unknown>).winningBidId
    if (typeof winningBidId === 'string' && winningBidId.length > 0) return winningBidId
  }
  return complete?.winningBidId
}

function isWinningBidGroup(
  group: marketplace.ParsedAuctionBidGroup,
  complete: marketplace.ParsedMarketplaceAuctionComplete | undefined,
): boolean {
  const winner = completeWinningBidId(complete)
  return Boolean(winner && (winner === group.bid.event.id || winner === group.bidId))
}

function bidStageLabel(
  group: marketplace.ParsedAuctionBidGroup,
  complete: marketplace.ParsedMarketplaceAuctionComplete | undefined,
): string {
  if (group.settlement?.content.action === 'auction_promote') return 'Promoted to order'
  if (group.settlement?.content.action === 'auction_refund') return 'Refunded'
  if (complete && isWinningBidGroup(group, complete)) return 'Selected winner'
  if (complete) return 'Outbid'
  if (group.paymentNack) return 'Escrow rejected'
  if (group.paymentAck) return 'Escrow accepted'
  if (group.payment) return 'Funded, awaiting escrow'
  return 'Bid sent'
}

function bidStageClass(
  group: marketplace.ParsedAuctionBidGroup,
  complete: marketplace.ParsedMarketplaceAuctionComplete | undefined,
): string {
  if (group.settlement?.content.action === 'auction_promote' || (complete && isWinningBidGroup(group, complete))) {
    return 'commit'
  }
  if (group.paymentNack) return 'cancel'
  return ''
}

function safeUnits(value: string | undefined): bigint {
  return value && /^\d+$/.test(value) ? BigInt(value) : 0n
}

function highestBidUnits(groups: marketplace.ParsedAuctionBidGroup[]): bigint {
  return groups.reduce((highest, group) => {
    const value = safeUnits(group.amount.value)
    return value > highest ? value : highest
  }, 0n)
}

function defaultBidAmount(
  auction: marketplace.ParsedMarketplaceAuction,
  groups: marketplace.ParsedAuctionBidGroup[],
): string {
  const highest = highestBidUnits(groups)
  const minimum = safeUnits(auction.startingBid)
  const increment = safeUnits(auction.minIncrement)
  const next = highest > 0n ? highest + (increment > 0n ? increment : 1n) : minimum
  return formatUnits(next, auction.decimals)
}

function sortBidGroups(groups: marketplace.ParsedAuctionBidGroup[]): marketplace.ParsedAuctionBidGroup[] {
  return [...groups].sort((left, right) => {
    const rightValue = safeUnits(right.amount.value)
    const leftValue = safeUnits(left.amount.value)
    if (rightValue !== leftValue) return rightValue > leftValue ? 1 : -1
    return right.bid.event.created_at - left.bid.event.created_at
  })
}

function uniqueCurrencies(listing: marketplace.MarketplaceListing | undefined): string[] {
  return [...new Set((listing?.prices ?? []).map(item => item.currency).filter(Boolean))]
}

export function ListingDetailPage({
  listing,
  marketplaceRuntime,
  marketplaceState,
  session,
  publisher,
  onTradeIndexUsed,
  onPublished,
  onError,
  onLoginRequired,
}: Props) {
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [invoice, setInvoice] = useState<string>()
  const [paymentMessages, setPaymentMessages] = useState<string[]>([])
  const [checkoutPaymentOpen, setCheckoutPaymentOpen] = useState(false)
  const [checkoutFlowStatus, setCheckoutFlowStatus] = useState<PaymentFlowStatus>('idle')
  const [checkoutFlowError, setCheckoutFlowError] = useState<string>()
  const [offerAmount, setOfferAmount] = useState('')
  const [offerTouched, setOfferTouched] = useState(false)
  const [escrowPickerOpen, setEscrowPickerOpen] = useState(false)
  const [escrowPickerLoading, setEscrowPickerLoading] = useState(false)
  const [escrowPickerError, setEscrowPickerError] = useState<string>()
  const [escrowChoices, setEscrowChoices] = useState<EscrowChoice[]>([])
  const [selectedEscrowPubkey, setSelectedEscrowPubkey] = useState('')
  const [selectedServiceKey, setSelectedServiceKey] = useState('')
  const [auctions, setAuctions] = useState<marketplace.ParsedMarketplaceAuction[]>([])
  const [auctionLoading, setAuctionLoading] = useState(false)
  const [auctionError, setAuctionError] = useState<string>()
  const [bidGroupsByAuction, setBidGroupsByAuction] = useState<Record<string, marketplace.ParsedAuctionBidGroup[]>>({})
  const [auctionCompletesByAuction, setAuctionCompletesByAuction] = useState<Record<string, marketplace.ParsedMarketplaceAuctionComplete>>({})
  const [auctionModalOpen, setAuctionModalOpen] = useState(false)
  const [auctionPublishing, setAuctionPublishing] = useState(false)
  const [auctionEscrowLoading, setAuctionEscrowLoading] = useState(false)
  const [auctionEscrowError, setAuctionEscrowError] = useState<string>()
  const [auctionEscrowChoices, setAuctionEscrowChoices] = useState<EscrowChoice[]>([])
  const [selectedAuctionEscrowPubkey, setSelectedAuctionEscrowPubkey] = useState('')
  const [selectedAuctionServiceKey, setSelectedAuctionServiceKey] = useState('')
  const [auctionCurrency, setAuctionCurrency] = useState('')
  const [auctionStart, setAuctionStart] = useState('')
  const [auctionEnd, setAuctionEnd] = useState('')
  const [auctionStartingBid, setAuctionStartingBid] = useState('')
  const [auctionMinIncrement, setAuctionMinIncrement] = useState('1')
  const [auctionReserve, setAuctionReserve] = useState('')
  const [bidAuctionAnchor, setBidAuctionAnchor] = useState('')
  const [bidAuctionSnapshot, setBidAuctionSnapshot] = useState<marketplace.ParsedMarketplaceAuction>()
  const [bidAmount, setBidAmount] = useState('')
  const [bidPublishing, setBidPublishing] = useState(false)
  const [bidInvoice, setBidInvoice] = useState<string>()
  const [bidMessages, setBidMessages] = useState<string[]>([])
  const [bidFlowStatus, setBidFlowStatus] = useState<PaymentFlowStatus>('idle')
  const [bidFlowError, setBidFlowError] = useState<string>()
  const price = listing?.prices[0]
  const listingAnchorValue = useMemo(() => listing ? listingAnchor(listing.event) : '', [listing])
  const isSeller = Boolean(listing && session?.pubkey === listing.event.pubkey)
  const availableAuctionCurrencies = useMemo(() => uniqueCurrencies(listing), [listing])
  const total = useMemo(() => {
    if (!price) return undefined
    return displayTotal(price.amount, frequencyMultiplier(price.frequency, start, end))
  }, [end, price, start])
  const offerIsBelowTotal = Boolean(
    listing?.negotiable &&
    price &&
    isBelowTotal(offerAmount, total),
  )

  useEffect(() => {
    if (!offerTouched) setOfferAmount(total ?? '')
  }, [offerTouched, total])

  useEffect(() => {
    setAuctionCurrency(current => current || availableAuctionCurrencies[0] || price?.currency || '')
    setAuctionStartingBid(current => current || price?.amount || '')
    setAuctionStart(current => current || dateTimeLocalFromSeconds(Math.floor(Date.now() / 1000) + 3600))
    setAuctionEnd(current => current || dateTimeLocalFromSeconds(Math.floor(Date.now() / 1000) + 86_400))
  }, [availableAuctionCurrencies, price])

  useEffect(() => {
    if (!listing || !listingAnchorValue) {
      setAuctions([])
      setBidGroupsByAuction({})
      setAuctionCompletesByAuction({})
      return
    }

    let closed = false
    let closer: { close(reason?: string): void } | undefined
    let completeCloser: { close(reason?: string): void } | undefined
    setAuctionLoading(true)
    setAuctionError(undefined)

    void marketplaceRuntime.auctions.search({ listingAnchor: listingAnchorValue, limit: 20 })
      .then(nextAuctions => {
        if (!closed) setAuctions(nextAuctions)
      })
      .catch(err => {
        if (!closed) setAuctionError(err instanceof Error ? err.message : 'Unable to load auctions')
      })
	      .finally(() => {
	        if (!closed) setAuctionLoading(false)
	      })

	    void marketplaceRuntime.auctions.completes.search({ listingAnchor: listingAnchorValue, limit: 50 })
	      .then(completes => {
	        if (!closed) setAuctionCompletesByAuction(auctionCompleteMap(completes))
	      })
	      .catch(err => {
	        console.warn('[marketplace-app] unable to fetch auction close events', {
	          listingAnchor: listingAnchorValue,
	        }, err)
	      })

    try {
      closer = marketplaceRuntime.auctions.subscribe(
        { listingAnchor: listingAnchorValue, limit: 20 },
        {
          onauctions(nextAuctions) {
            if (!closed) setAuctions(nextAuctions)
          },
          oninvalid(event, error) {
            console.warn('[marketplace-app] ignoring invalid auction event', { eventId: event.id }, error)
          },
        },
        { label: `listing-auctions:${listingAnchorValue}` },
      )
	    } catch (err) {
	      console.warn('[marketplace-app] unable to subscribe to listing auctions', err)
	    }

	    try {
	      completeCloser = marketplaceRuntime.auctions.completes.subscribe(
	        { listingAnchor: listingAnchorValue, limit: 50 },
	        {
	          oncompletes(completes) {
	            if (!closed) setAuctionCompletesByAuction(auctionCompleteMap(completes))
	          },
	          oninvalid(event, error) {
	            console.warn('[marketplace-app] ignoring invalid auction close event', { eventId: event.id }, error)
	          },
	        },
	        { label: `listing-auction-completes:${listingAnchorValue}` },
	      )
	    } catch (err) {
	      console.warn('[marketplace-app] unable to subscribe to auction close events', {
	        listingAnchor: listingAnchorValue,
	      }, err)
	    }

	    return () => {
	      closed = true
	      closer?.close('listing changed')
	      completeCloser?.close('listing changed')
	    }
	  }, [listing, listingAnchorValue, marketplaceRuntime])

  useEffect(() => {
    if (auctions.length === 0) {
      setBidGroupsByAuction({})
      return
    }

    let closed = false
    const closers: Array<{ close(reason?: string): void }> = []
    const auctionAnchors = auctions.map(auction => auction.auctionAnchor)

    for (const auction of auctions) {
      void marketplaceRuntime.auctions.bidGroups.fetch({ auctionAnchor: auction.auctionAnchor, limit: 100 })
        .then(groups => {
          if (!closed) {
            setBidGroupsByAuction(current => ({
              ...current,
              [auction.auctionAnchor]: sortBidGroups(groups),
            }))
          }
        })
        .catch(err => {
          console.warn('[marketplace-app] unable to fetch auction bid groups', {
            auctionAnchor: auction.auctionAnchor,
          }, err)
        })

      try {
        closers.push(marketplaceRuntime.auctions.bidGroups.subscribe(
          { auctionAnchor: auction.auctionAnchor, limit: 100 },
          {
            ongroups(groups) {
              if (!closed) {
                setBidGroupsByAuction(current => ({
                  ...current,
                  [auction.auctionAnchor]: sortBidGroups(groups),
                }))
              }
            },
            oninvalid(event, error) {
              console.warn('[marketplace-app] ignoring invalid auction bid group event', { eventId: event.id }, error)
            },
          },
          { label: `auction-bids:${auction.auctionAnchor}` },
        ))
      } catch (err) {
        console.warn('[marketplace-app] unable to subscribe to auction bid groups', {
          auctionAnchor: auction.auctionAnchor,
        }, err)
      }
    }

    return () => {
      closed = true
      for (const closer of closers) closer.close('listing auctions changed')
      setBidGroupsByAuction(current => Object.fromEntries(
        Object.entries(current).filter(([anchor]) => auctionAnchors.includes(anchor)),
      ))
    }
  }, [auctions, marketplaceRuntime])

  const selectedEscrow = useMemo(
    () => escrowChoices.find(choice => choice.pubkey === selectedEscrowPubkey),
    [escrowChoices, selectedEscrowPubkey],
  )
  const selectedService = useMemo(
    () => selectedEscrow?.services.find(service => service.key === selectedServiceKey),
    [selectedEscrow, selectedServiceKey],
  )
  const selectedRoute = selectedService?.route
  const selectedAuctionEscrow = useMemo(
    () => auctionEscrowChoices.find(choice => choice.pubkey === selectedAuctionEscrowPubkey),
    [auctionEscrowChoices, selectedAuctionEscrowPubkey],
  )
  const selectedAuctionService = useMemo(
    () => selectedAuctionEscrow?.services.find(service => service.key === selectedAuctionServiceKey),
    [selectedAuctionEscrow, selectedAuctionServiceKey],
  )
  const selectedAuctionRoute = selectedAuctionService?.route
  const bidAuction = useMemo(
    () => (
      auctions.find(auction => auction.auctionAnchor === bidAuctionAnchor) ??
      (bidAuctionSnapshot?.auctionAnchor === bidAuctionAnchor ? bidAuctionSnapshot : undefined)
    ),
    [auctions, bidAuctionAnchor, bidAuctionSnapshot],
  )

  useEffect(() => {
    if (auctionModalOpen && auctionCurrency) void loadAuctionEscrowChoices(auctionCurrency)
  }, [auctionCurrency, auctionModalOpen, listing, marketplaceState])

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

  async function nextTrade() {
    if (!listing || !marketplaceState) throw new Error('Marketplace runtime is not ready yet')
    const tradeIndex = await marketplaceState.runtime.getNextAccountIndex()
    const anchor = listingAnchor(listing.event)
    const tradeId = `${anchor}:negotiation:${tradeIndex}`
    console.debug('[marketplace-app] derived next trade material', {
      listingId: listing.event.id,
      tradeIndex,
      tradeId,
    })
    return { tradeIndex, anchor, tradeId }
  }

  function selectEscrow(pubkey: string, choices = escrowChoices) {
    const choice = choices.find(item => item.pubkey === pubkey)
    const firstUsableService = choice?.services.find(service => service.route)
    setSelectedEscrowPubkey(pubkey)
    setSelectedServiceKey(firstUsableService?.key ?? '')
  }

  function selectAuctionEscrow(pubkey: string, choices = auctionEscrowChoices) {
    const choice = choices.find(item => item.pubkey === pubkey)
    const firstUsableService = choice?.services.find(service => service.route)
    setSelectedAuctionEscrowPubkey(pubkey)
    setSelectedAuctionServiceKey(firstUsableService?.key ?? '')
  }

  async function loadEscrowChoices() {
    if (!listing || !price || !marketplaceState) return
    if (!session) {
      onLoginRequired('Sign in to choose escrow and checkout')
      return
    }
    setEscrowPickerLoading(true)
    setEscrowPickerError(undefined)
    try {
      console.debug('[marketplace-app] loading checkout escrow choices', {
        listingId: listing.event.id,
        sellerPubkey: listing.event.pubkey,
        denomination: price.currency,
      })
      const method = await marketplaceState.runtime.paymentMethod.findOne({
        author: listing.event.pubkey,
        limit: 5,
      })
      if (!method) {
        setEscrowChoices([])
        setSelectedEscrowPubkey('')
        setSelectedServiceKey('')
        setEscrowPickerError('The seller has not published any payment methods')
        console.warn('[marketplace-app] checkout seller has no payment method', {
          listingId: listing.event.id,
          sellerPubkey: listing.event.pubkey,
        })
        return
      }

      const trustedEscrows = [...new Set(method.trustedEscrowPubkeys)]
      const [profiles, routes, servicesByEscrow] = await Promise.all([
        fetchProfiles(session, trustedEscrows),
        marketplaceState.runtime.paymentRoutes.forListing(listing, routeProbeFor(listing, price)),
        Promise.all(trustedEscrows.map(async pubkey => ({
          pubkey,
          services: await marketplaceState.runtime.escrowServices.search({ author: pubkey, limit: 20 }),
        }))),
      ])

      const choices: EscrowChoice[] = trustedEscrows.map(pubkey => {
        const services = servicesByEscrow.find(entry => entry.pubkey === pubkey)?.services ?? []
        const serviceChoices: EscrowServiceChoice[] = services.map(service => {
          const route = routeForService(service, routes)
          return {
            key: serviceChoiceKey(service),
            service,
            ...(route ? { route } : { disabledReason: `No supported ${price.currency} route` }),
          }
        })
        return {
          pubkey,
          profile: profiles.get(pubkey),
          services: serviceChoices,
          ...(serviceChoices.some(service => service.route)
            ? {}
            : {
                disabledReason: serviceChoices.length === 0
                  ? 'No arbitration services published'
                  : `No usable ${price.currency} arbitration service`,
              }),
        }
      })

      setEscrowChoices(choices)
      const firstUsableEscrow = choices.find(choice => choice.services.some(service => service.route))
      if (firstUsableEscrow) {
        selectEscrow(firstUsableEscrow.pubkey, choices)
      } else {
        setSelectedEscrowPubkey('')
        setSelectedServiceKey('')
      }
      console.debug('[marketplace-app] loaded checkout escrow choices', {
        listingId: listing.event.id,
        escrowCount: choices.length,
        serviceCount: choices.reduce((sum, choice) => sum + choice.services.length, 0),
        usableRouteCount: routes.length,
      })
    } catch (err) {
      console.warn('[marketplace-app] unable to load checkout escrow choices', err)
      setEscrowPickerError(err instanceof Error ? err.message : 'Unable to load escrow choices')
    } finally {
      setEscrowPickerLoading(false)
    }
  }

  async function loadAuctionEscrowChoices(currency = auctionCurrency) {
    if (!listing || !marketplaceState || !currency) return
    if (!session) {
      onLoginRequired('Sign in to create auctions')
      return
    }
    setAuctionEscrowLoading(true)
    setAuctionEscrowError(undefined)
    try {
      const method = await marketplaceState.runtime.paymentMethod.findOne({
        author: listing.event.pubkey,
        limit: 5,
      })
      if (!method) {
        setAuctionEscrowChoices([])
        setSelectedAuctionEscrowPubkey('')
        setSelectedAuctionServiceKey('')
        setAuctionEscrowError('The seller has not published any payment methods')
        return
      }

      const trustedEscrows = [...new Set(method.trustedEscrowPubkeys)]
      const [profiles, routes, servicesByEscrow] = await Promise.all([
        fetchProfiles(session, trustedEscrows),
        marketplaceState.runtime.auctions.paymentRoutes.forListing(listing, routeProbeForCurrency(listing, currency)),
        Promise.all(trustedEscrows.map(async pubkey => ({
          pubkey,
          services: await marketplaceState.runtime.escrowServices.search({ author: pubkey, limit: 20 }),
        }))),
      ])

      const choices: EscrowChoice[] = trustedEscrows.map(pubkey => {
        const services = servicesByEscrow.find(entry => entry.pubkey === pubkey)?.services ?? []
        const serviceChoices: EscrowServiceChoice[] = services.map(service => {
          const route = routeForService(service, routes)
          return {
            key: serviceChoiceKey(service),
            service,
            ...(route ? { route } : { disabledReason: `No supported ${currency} auction route` }),
          }
        })
        return {
          pubkey,
          profile: profiles.get(pubkey),
          services: serviceChoices,
          ...(serviceChoices.some(service => service.route)
            ? {}
            : {
                disabledReason: serviceChoices.length === 0
                  ? 'No arbitration services published'
                  : `No usable ${currency} auction service`,
              }),
        }
      })

      setAuctionEscrowChoices(choices)
      const firstUsableEscrow = choices.find(choice => choice.services.some(service => service.route))
      if (firstUsableEscrow) selectAuctionEscrow(firstUsableEscrow.pubkey, choices)
      else {
        setSelectedAuctionEscrowPubkey('')
        setSelectedAuctionServiceKey('')
      }
    } catch (err) {
      console.warn('[marketplace-app] unable to load auction escrow choices', err)
      setAuctionEscrowError(err instanceof Error ? err.message : 'Unable to load auction escrow choices')
    } finally {
      setAuctionEscrowLoading(false)
    }
  }

  function openAuctionModal() {
    if (!listing || !isSeller) return
    if (!session || !publisher || !marketplaceState) {
      onLoginRequired('Sign in as the seller to create auctions')
      return
    }
    const now = Math.floor(Date.now() / 1000)
    setAuctionCurrency(auctionCurrency || availableAuctionCurrencies[0] || price?.currency || '')
    setAuctionStartingBid(auctionStartingBid || price?.amount || '')
    setAuctionStart(auctionStart || dateTimeLocalFromSeconds(now + 3600))
    setAuctionEnd(auctionEnd || dateTimeLocalFromSeconds(now + 86_400))
    setAuctionModalOpen(true)
    void loadAuctionEscrowChoices(auctionCurrency || availableAuctionCurrencies[0] || price?.currency || '')
  }

  async function createAuction() {
    if (!session || !publisher || !marketplaceState) {
      onLoginRequired('Sign in as the seller to create auctions')
      return
    }
    if (!listing || !selectedAuctionRoute || !listingAnchorValue) {
      onError('Choose a usable auction escrow service')
      return
    }
    setAuctionPublishing(true)
    setAuctionEscrowError(undefined)
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
        arbiterPubkey: selectedAuctionRoute.escrowService.event.pubkey,
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
            escrowServiceId: selectedAuctionRoute.escrowService.event.id,
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
      setAuctionEscrowError(message)
      onError(message)
    } finally {
      setAuctionPublishing(false)
    }
  }

  function openBidModal(auction: marketplace.ParsedMarketplaceAuction) {
    const groups = bidGroupsByAuction[auction.auctionAnchor] ?? []
    setBidAuctionAnchor(auction.auctionAnchor)
    setBidAuctionSnapshot(auction)
    setBidAmount(defaultBidAmount(auction, groups))
    setBidInvoice(undefined)
    setBidMessages([])
    setBidFlowStatus('idle')
    setBidFlowError(undefined)
  }

  function closeBidModal() {
    setBidAuctionAnchor('')
    setBidAuctionSnapshot(undefined)
  }

  async function submitBid() {
    if (!session || !marketplaceState) {
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
    setBidPublishing(true)
    setBidInvoice(undefined)
    setBidMessages([])
    setBidFlowStatus('working')
    setBidFlowError(undefined)
    try {
      const value = decimalToUnits(bidAmount, bidAuction.decimals).toString()
      const amount: marketplace.MarketplaceAmount = {
        value,
        denomination: bidAuction.currency,
        decimals: bidAuction.decimals,
      }
      const tradeIndex = await marketplaceState.runtime.getNextAccountIndex()
      const states = marketplaceState.runtime.auctions.bid(listing, {
        auctionAnchor: bidAuction.auctionAnchor,
        listingAnchor: listingAnchorValue,
        amount,
        targetOrder: {
          listingAnchor: listingAnchorValue,
          start: start || undefined,
          end: end || undefined,
          amount,
        },
      }, {
        auction: bidAuction.event,
        accountIndex: tradeIndex,
      })

      for await (const state of states) {
        setBidMessages(messages => [
          ...messages,
          stringifyProgress({
            at: new Date().toISOString(),
            type: state.type,
            status: 'status' in state ? state.status : undefined,
            request: 'request' in state
              ? {
                  type: state.request.type,
                  amount: state.request.amount,
                  description: state.request.description,
                  data: state.request.data,
                }
              : undefined,
            data: state.data,
            eventId: 'event' in state ? state.event.id : undefined,
          }),
        ])
        if (state.type === 'payment_required' && state.request.type === 'bolt11') {
          setBidInvoice(state.request.bolt11)
        }
        if (state.type === 'payment_published') {
          setBidFlowStatus('success')
          onPublished()
        }
      }
      onTradeIndexUsed(tradeIndex)
      setBidFlowStatus('success')
    } catch (err) {
      console.warn('[marketplace-app] unable to submit auction bid', err)
      const message = readableError(err, 'Unable to submit auction bid')
      setBidFlowStatus('error')
      setBidFlowError(message)
      setBidMessages(messages => [
        ...messages,
        stringifyProgress({
          at: new Date().toISOString(),
          type: 'error',
          status: 'error',
          message,
        }),
      ])
      onError(message)
    } finally {
      setBidPublishing(false)
    }
  }

  async function negotiate() {
    if (!listing || !price || !total) return
    if (!session || !publisher || !marketplaceState) {
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
    setPublishing(true)
    setInvoice(undefined)
    setPaymentMessages([])
    try {
      const { tradeIndex, tradeId } = await nextTrade()
      console.debug('[marketplace-app] publishing negotiation offer', {
        listingId: listing.event.id,
        tradeIndex,
        tradeId,
        denomination: price.currency,
        amount: offerAmount || total,
      })
      await publishNegotiationOffer(session, publisher, listing, {
        tradeId,
        start: start || undefined,
        end: end || undefined,
        amount: amountForNegotiation(offerAmount || total, price.currency),
      })
      onTradeIndexUsed(tradeIndex)
      onPublished()
      console.debug('[marketplace-app] negotiation offer published', {
        listingId: listing.event.id,
        tradeIndex,
        tradeId,
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
    if (!session || !publisher || !marketplaceState) {
      console.warn('[marketplace-app] checkout attempted before marketplace runtime is ready', {
        listingId: listing.event.id,
      })
      onLoginRequired('Sign in to checkout')
      return
    }
    if (!requireCheckoutDates()) return
    if (offerIsBelowTotal) {
      console.debug('[marketplace-app] checkout amount is below total; starting negotiation flow', {
        listingId: listing.event.id,
        offerAmount,
        total,
      })
      await negotiate()
      return
    }
    setInvoice(undefined)
    setPaymentMessages([])
    setCheckoutFlowStatus('idle')
    setCheckoutFlowError(undefined)
    setCheckoutPaymentOpen(false)
    setEscrowPickerOpen(true)
    await loadEscrowChoices()
  }

  async function checkoutWithRoute(route: marketplace.MarketplacePaymentRoute) {
    if (!listing || !price || total === undefined) return
    if (!session || !marketplaceState) {
      onLoginRequired('Sign in to checkout')
      return
    }
    setPublishing(true)
    setInvoice(undefined)
    setPaymentMessages([])
    setCheckoutFlowStatus('working')
    setCheckoutFlowError(undefined)
    setCheckoutPaymentOpen(true)
    setEscrowPickerOpen(false)
    try {
      const tradeIndex = await marketplaceState.runtime.getNextAccountIndex()
      console.debug('[marketplace-app] starting checkout', {
        listingId: listing.event.id,
        tradeIndex,
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
      const paymentAmount = amountForPrice(
        price.amount,
        price.currency,
        frequencyMultiplier(price.frequency, start, end),
      )
      console.debug('[marketplace-app] checkout payment amount calculated', {
        listingId: listing.event.id,
        value: paymentAmount.value,
        denomination: paymentAmount.denomination,
        decimals: paymentAmount.decimals,
      })
      let publishedOrderId: string | undefined
      const paymentStates = marketplaceState.runtime.pay(listing, {
        start: start || undefined,
        end: end || undefined,
        amount: paymentAmount,
      }, {
        accountIndex: tradeIndex,
        route,
      })
      for await (const paymentState of paymentStates) {
        console.debug('[marketplace-app] checkout payment state', {
          listingId: listing.event.id,
          type: paymentState.type,
          status: 'status' in paymentState ? paymentState.status : undefined,
          eventId: 'event' in paymentState ? paymentState.event.id : undefined,
        })
        setPaymentMessages(messages => [
          ...messages,
          stringifyProgress({
            at: new Date().toISOString(),
            type: paymentState.type,
            status: 'status' in paymentState ? paymentState.status : undefined,
            request: 'request' in paymentState
              ? {
                  type: paymentState.request.type,
                  amount: paymentState.request.amount,
                  description: paymentState.request.description,
                  data: paymentState.request.data,
                }
              : undefined,
            data: paymentState.data,
            eventId: 'event' in paymentState ? paymentState.event.id : undefined,
          }),
        ])
        if (paymentState.type === 'order_published') {
          publishedOrderId = paymentState.event.id
          console.debug('[marketplace-app] checkout order published', {
            listingId: listing.event.id,
            eventId: paymentState.event.id,
            kind: paymentState.event.kind,
            pubkey: paymentState.event.pubkey,
          })
        }
        if (paymentState.type === 'payment_published') {
          setCheckoutFlowStatus('success')
          console.debug('[marketplace-app] checkout payment proof published', {
            listingId: listing.event.id,
            orderEventId: publishedOrderId,
            paymentEventId: paymentState.event.id,
            kind: paymentState.event.kind,
            pubkey: paymentState.event.pubkey,
          })
          setPaymentMessages(messages => [
            ...messages,
            stringifyProgress({
              at: new Date().toISOString(),
              type: 'nostr_published',
              eventId: publishedOrderId,
              paymentEventId: paymentState.event.id,
              kind: paymentState.event.kind,
            }),
          ])
          onPublished()
        }
        if (paymentState.type === 'payment_required' && paymentState.request.type === 'bolt11') {
          console.debug('[marketplace-app] checkout requires external payment', {
            listingId: listing.event.id,
            requestType: paymentState.request.type,
            amount: paymentState.request.amount,
          })
          setInvoice(paymentState.request.bolt11)
        }
      }
      onTradeIndexUsed(tradeIndex)
      setCheckoutFlowStatus('success')
      console.debug('[marketplace-app] checkout payment stream completed', {
        listingId: listing.event.id,
        tradeIndex,
      })
    } catch (err) {
      console.warn('[marketplace-app] checkout failed', err)
      const message = readableError(err, 'Unable to publish reservation offer')
      setCheckoutFlowStatus('error')
      setCheckoutFlowError(message)
      setPaymentMessages(messages => [
        ...messages,
        stringifyProgress({
          at: new Date().toISOString(),
          type: 'error',
          status: 'error',
          message,
        }),
      ])
      onError(message)
    } finally {
      setPublishing(false)
    }
  }

  async function confirmEscrowSelection() {
    if (!selectedRoute) {
      onError('Choose a usable escrow and arbitration service')
      return
    }
    await checkoutWithRoute(selectedRoute)
  }

  if (!listing) {
    return (
      <section className="page">
        <h1>Listing not found</h1>
      </section>
    )
  }

  const image = listing.images[0]?.url
  return (
    <section className="detail-layout">
      <div className="detail-main">
        {image && <img className="detail-image" src={image} alt="" />}
        <span className="label">{listing.location || 'Classified'}</span>
        <h1>{listing.title}</h1>
        <p className="lede">{listing.summary}</p>
        <p>{listing.description}</p>
        <section className="auction-section">
          <div className="section-heading">
            <div>
              <span className="label">Auctions</span>
              <h2>Listing auctions</h2>
            </div>
            {isSeller && (
              <button
                className="button secondary"
                type="button"
                disabled={!marketplaceState || auctionPublishing}
                onClick={openAuctionModal}
              >
                Create auction
              </button>
            )}
          </div>
          {auctionLoading && <p className="muted">Loading auctions...</p>}
          {auctionError && <p className="message-error">{auctionError}</p>}
          {!auctionLoading && auctions.length === 0 && (
            <p className="muted">No auctions attached to this listing.</p>
          )}
          {auctions.length > 0 && (
            <div className="auction-list">
              {auctions.map(auction => {
	                const groups = bidGroupsByAuction[auction.auctionAnchor] ?? []
	                const complete = auctionCompletesByAuction[auction.auctionAnchor]
	                const highest = highestBidUnits(groups)
	                const status = auctionDisplayStatus(auction, complete)
	                const isLive = status === 'Live'
	                return (
                  <article className="auction-card" key={auction.auctionAnchor}>
                    <div className="auction-card-heading">
                      <div>
                        <strong>{status}</strong>
                        <span>{auction.currency} auction</span>
                      </div>
	                      <span className={`order-status ${complete ? 'commit' : ''}`}>
	                        {complete ? status : `${groups.length} bid${groups.length === 1 ? '' : 's'}`}
	                      </span>
                    </div>
                    <dl className="auction-facts">
                      <div>
                        <dt>Starts</dt>
                        <dd>{formatDateTime(auction.startAt)}</dd>
                      </div>
                      <div>
                        <dt>Ends</dt>
                        <dd>{formatDateTime(auction.endAt)}</dd>
                      </div>
                      <div>
                        <dt>Starting bid</dt>
                        <dd>{formatUnits(safeUnits(auction.startingBid), auction.decimals)} {auction.currency}</dd>
                      </div>
                      <div>
                        <dt>Highest bid</dt>
                        <dd>{formatUnits(highest, auction.decimals)} {auction.currency}</dd>
                      </div>
                      <div>
                        <dt>Arbiter</dt>
                        <dd>{shortPubkey(auction.arbiterPubkey)}</dd>
                      </div>
                    </dl>
	                    <div className="auction-actions">
                      {!isSeller && (
                        <button
                          className="button"
                          type="button"
                          disabled={!isLive || bidPublishing}
                          onClick={() => {
                            if (!session) onLoginRequired('Sign in to place auction bids')
                            else openBidModal(auction)
                          }}
                        >
                          Place bid
                        </button>
                      )}
	                      {isSeller && <span className="muted">Bids settle through {shortPubkey(auction.arbiterPubkey)}</span>}
	                    </div>
	                    {complete && (
	                      <div className="auction-close-summary">
	                        <strong>{auctionCompleteLabel(complete)}</strong>
	                        <span>
	                          {complete.finalAmount
	                            ? `${formatUnits(safeUnits(complete.finalAmount.value), complete.finalAmount.decimals)} ${complete.finalAmount.denomination}`
	                            : 'No winning amount'}
	                          {complete.winnerPubkey ? ` · winner ${shortPubkey(complete.winnerPubkey)}` : ''}
	                        </span>
	                        {(complete.promotedOrderId || complete.promotedPaymentId) && (
	                          <span>
	                            {complete.promotedOrderId ? `order ${shortPubkey(complete.promotedOrderId)}` : ''}
	                            {complete.promotedOrderId && complete.promotedPaymentId ? ' · ' : ''}
	                            {complete.promotedPaymentId ? `payment ${shortPubkey(complete.promotedPaymentId)}` : ''}
	                          </span>
	                        )}
	                      </div>
	                    )}
	                    {groups.length > 0 && (
	                      <div className="bid-list">
	                        {groups.map(group => (
	                          <div
	                            className={`bid-row ${isWinningBidGroup(group, complete) ? 'winning-bid' : ''}`}
	                            key={group.id}
	                          >
	                            <div>
	                              <strong>{formatUnits(safeUnits(group.amount.value), group.amount.decimals)} {group.amount.denomination}</strong>
	                              <span>
	                                {shortPubkey(group.bid.event.pubkey)}
	                                {group.paymentAck ? ` · ack ${shortPubkey(group.paymentAck.event.pubkey)}` : ''}
	                              </span>
	                            </div>
	                            <span className={`order-status ${bidStageClass(group, complete)}`}>
	                              {bidStageLabel(group, complete)}
	                            </span>
	                          </div>
	                        ))}
                      </div>
                    )}
                  </article>
                )
              })}
            </div>
          )}
        </section>
      </div>
      <aside className="checkout-panel">
        <span className="label">Checkout</span>
        <h2>{price ? formatPrice(price) : 'No price'}</h2>
        {price?.frequency && (
          <div className="date-grid">
            <label>
              Start
              <input type="datetime-local" value={start} onChange={event => setStart(event.target.value)} />
            </label>
            <label>
              End
              <input type="datetime-local" value={end} onChange={event => setEnd(event.target.value)} />
            </label>
          </div>
        )}
        <div className="quote-row">
          <span>Total</span>
          <strong>{total ?? '0'} {price?.currency}</strong>
        </div>
        {price && listing.negotiable && (
          <label>
            Offer
            <input
              inputMode="decimal"
              value={offerAmount}
              onChange={event => {
                setOfferTouched(true)
                setOfferAmount(event.target.value)
              }}
            />
          </label>
        )}
        <div className="checkout-actions">
          <button className="button" type="button" disabled={publishing} onClick={startCheckout}>
            {publishing ? 'Working...' : offerIsBelowTotal ? 'Negotiate' : 'Checkout'}
          </button>
          {listing.negotiable && !offerIsBelowTotal && (
            <button className="button secondary" type="button" disabled={publishing} onClick={negotiate}>
              Negotiate
            </button>
          )}
        </div>
        {invoice && (
          <div className="invoice-box">
            <span className="label">Lightning invoice</span>
            <textarea readOnly value={invoice} />
          </div>
        )}
        {paymentMessages.length > 0 && (
          <pre className="payment-log">{paymentMessages.join('\n\n')}</pre>
        )}
      </aside>
      {escrowPickerOpen && (
        <div className="modal-backdrop" role="presentation">
          <section
            className="modal-panel escrow-picker"
            role="dialog"
            aria-modal="true"
            aria-labelledby="escrow-picker-title"
          >
            <div className="modal-header">
              <div>
                <span className="label">Escrow</span>
                <h2 id="escrow-picker-title">Choose arbitration</h2>
              </div>
              <button
                className="button secondary"
                type="button"
                disabled={publishing}
                onClick={() => setEscrowPickerOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="escrow-picker-grid">
              <label>
                Seller trusted escrow
                <select
                  value={selectedEscrowPubkey}
                  disabled={escrowPickerLoading || publishing || escrowChoices.length === 0}
                  onChange={event => selectEscrow(event.target.value)}
                >
                  <option value="" disabled>
                    {escrowPickerLoading ? 'Loading escrows...' : 'Choose escrow'}
                  </option>
                  {escrowChoices.map(choice => (
                    <option
                      key={choice.pubkey}
                      value={choice.pubkey}
                      disabled={Boolean(choice.disabledReason)}
                    >
                      {escrowProfileLabel(choice.pubkey, choice.profile)}
                      {choice.disabledReason ? ` - ${choice.disabledReason}` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Arbitration service
                <select
                  value={selectedServiceKey}
                  disabled={escrowPickerLoading || publishing || !selectedEscrow}
                  onChange={event => setSelectedServiceKey(event.target.value)}
                >
                  <option value="" disabled>
                    {selectedEscrow ? 'Choose service' : 'Choose escrow first'}
                  </option>
                  {(selectedEscrow?.services ?? []).map(choice => (
                    <option
                      key={choice.key}
                      value={choice.key}
                      disabled={!choice.route}
                    >
                      {serviceChoiceLabel(choice)}
                      {choice.disabledReason ? ` - ${choice.disabledReason}` : ''}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {selectedEscrow && (
              <div className="escrow-picker-summary">
                <ProfileChip pubkey={selectedEscrow.pubkey} profile={selectedEscrow.profile} />
                {selectedService?.route ? (
                  <p>
                    {selectedService.route.policy.method.toUpperCase()} / {selectedService.route.asset.denomination}
                    {' '}via {selectedService.service.content.type}
                  </p>
                ) : (
                  <p>{selectedEscrow.disabledReason ?? 'Select a usable arbitration service'}</p>
                )}
              </div>
            )}
            {escrowPickerError && <p className="modal-error">{escrowPickerError}</p>}
            <div className="modal-actions">
              <button
                className="button secondary"
                type="button"
                disabled={publishing}
                onClick={loadEscrowChoices}
              >
                Refresh
              </button>
              <button
                className="button"
                type="button"
                disabled={publishing || escrowPickerLoading || !selectedRoute}
                onClick={confirmEscrowSelection}
              >
                Continue to invoice
              </button>
            </div>
          </section>
        </div>
      )}
      {checkoutPaymentOpen && (
        <div className="modal-backdrop" role="presentation">
          <section
            className="modal-panel payment-status-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="checkout-payment-title"
          >
            <div className="modal-header">
              <div>
                <span className="label">Payment</span>
                <h2 id="checkout-payment-title">Purchase payment</h2>
              </div>
              <button
                className="button secondary"
                type="button"
                disabled={publishing}
                onClick={() => setCheckoutPaymentOpen(false)}
              >
                Close
              </button>
            </div>
            {checkoutFlowStatus !== 'idle' && (
              <div
                className={`modal-status ${checkoutFlowStatus}`}
                role={checkoutFlowStatus === 'error' ? 'alert' : 'status'}
              >
                <strong>
                  {checkoutFlowStatus === 'success'
                    ? 'Purchase submitted'
                    : checkoutFlowStatus === 'error'
                      ? 'Purchase failed'
                      : invoice
                        ? 'Payment required'
                        : 'Preparing payment'}
                </strong>
                <p>
                  {checkoutFlowStatus === 'success'
                    ? 'The order and payment proof were published.'
                    : checkoutFlowStatus === 'error'
                      ? checkoutFlowError ?? 'The purchase flow stopped before publishing.'
                      : invoice
                        ? 'Waiting for the external invoice payment to complete.'
                        : 'Creating the order payment with the selected escrow route.'}
                </p>
              </div>
            )}
            {checkoutFlowError && checkoutFlowStatus !== 'error' && (
              <p className="modal-error">{checkoutFlowError}</p>
            )}
            {invoice && (
              <div className="invoice-box">
                <span className="label">Lightning invoice</span>
                <textarea readOnly value={invoice} />
              </div>
            )}
            {paymentMessages.length > 0 && (
              <pre className="payment-log">{paymentMessages.join('\n\n')}</pre>
            )}
            <div className="modal-actions">
              <button
                className="button secondary"
                type="button"
                disabled={publishing}
                onClick={() => setCheckoutPaymentOpen(false)}
              >
                {checkoutFlowStatus === 'success' ? 'Done' : 'Close'}
              </button>
              {checkoutFlowStatus === 'error' && selectedRoute && (
                <button
                  className="button"
                  type="button"
                  disabled={publishing}
                  onClick={() => void checkoutWithRoute(selectedRoute)}
                >
                  Retry
                </button>
              )}
            </div>
          </section>
        </div>
      )}
      {auctionModalOpen && (
        <div className="modal-backdrop" role="presentation">
          <section
            className="modal-panel escrow-picker"
            role="dialog"
            aria-modal="true"
            aria-labelledby="auction-create-title"
          >
            <div className="modal-header">
              <div>
                <span className="label">Auction</span>
                <h2 id="auction-create-title">Schedule auction</h2>
              </div>
              <button
                className="button secondary"
                type="button"
                disabled={auctionPublishing}
                onClick={() => setAuctionModalOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="form-grid">
              <label>
                Currency
                <select
                  value={auctionCurrency}
                  disabled={auctionPublishing || availableAuctionCurrencies.length === 0}
                  onChange={event => setAuctionCurrency(event.target.value)}
                >
                  <option value="" disabled>Choose currency</option>
                  {availableAuctionCurrencies.map(currency => (
                    <option key={currency} value={currency}>{currency}</option>
                  ))}
                </select>
              </label>
              <label>
                Starting bid
                <input
                  inputMode="decimal"
                  value={auctionStartingBid}
                  disabled={auctionPublishing}
                  onChange={event => setAuctionStartingBid(event.target.value)}
                />
              </label>
              <label>
                Min increment
                <input
                  inputMode="decimal"
                  value={auctionMinIncrement}
                  disabled={auctionPublishing}
                  onChange={event => setAuctionMinIncrement(event.target.value)}
                />
              </label>
              <label>
                Reserve
                <input
                  inputMode="decimal"
                  value={auctionReserve}
                  disabled={auctionPublishing}
                  placeholder="Optional"
                  onChange={event => setAuctionReserve(event.target.value)}
                />
              </label>
              <label>
                Starts
                <input
                  type="datetime-local"
                  value={auctionStart}
                  disabled={auctionPublishing}
                  onChange={event => setAuctionStart(event.target.value)}
                />
              </label>
              <label>
                Ends
                <input
                  type="datetime-local"
                  value={auctionEnd}
                  disabled={auctionPublishing}
                  onChange={event => setAuctionEnd(event.target.value)}
                />
              </label>
            </div>
            <div className="escrow-picker-grid">
              <label>
                Auction arbiter
                <select
                  value={selectedAuctionEscrowPubkey}
                  disabled={auctionEscrowLoading || auctionPublishing || auctionEscrowChoices.length === 0}
                  onChange={event => selectAuctionEscrow(event.target.value)}
                >
                  <option value="" disabled>
                    {auctionEscrowLoading ? 'Loading escrows...' : 'Choose escrow'}
                  </option>
                  {auctionEscrowChoices.map(choice => (
                    <option
                      key={choice.pubkey}
                      value={choice.pubkey}
                      disabled={Boolean(choice.disabledReason)}
                    >
                      {escrowProfileLabel(choice.pubkey, choice.profile)}
                      {choice.disabledReason ? ` - ${choice.disabledReason}` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Auction service
                <select
                  value={selectedAuctionServiceKey}
                  disabled={auctionEscrowLoading || auctionPublishing || !selectedAuctionEscrow}
                  onChange={event => setSelectedAuctionServiceKey(event.target.value)}
                >
                  <option value="" disabled>
                    {selectedAuctionEscrow ? 'Choose service' : 'Choose arbiter first'}
                  </option>
                  {(selectedAuctionEscrow?.services ?? []).map(choice => (
                    <option key={choice.key} value={choice.key} disabled={!choice.route}>
                      {serviceChoiceLabel(choice)}
                      {choice.disabledReason ? ` - ${choice.disabledReason}` : ''}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {selectedAuctionEscrow && (
              <div className="escrow-picker-summary">
                <ProfileChip pubkey={selectedAuctionEscrow.pubkey} profile={selectedAuctionEscrow.profile} />
                {selectedAuctionRoute ? (
                  <p>
                    {selectedAuctionRoute.policy.method.toUpperCase()} / {selectedAuctionRoute.asset.denomination}
                    {' '}via {selectedAuctionService?.service.content.type}
                  </p>
                ) : (
                  <p>{selectedAuctionEscrow.disabledReason ?? 'Select a usable auction service'}</p>
                )}
              </div>
            )}
            {auctionEscrowError && <p className="modal-error">{auctionEscrowError}</p>}
            <div className="modal-actions">
              <button
                className="button secondary"
                type="button"
                disabled={auctionPublishing || auctionEscrowLoading}
                onClick={() => loadAuctionEscrowChoices()}
              >
                Refresh
              </button>
              <button
                className="button"
                type="button"
                disabled={auctionPublishing || auctionEscrowLoading || !selectedAuctionRoute}
                onClick={createAuction}
              >
                {auctionPublishing ? 'Publishing...' : 'Create auction'}
              </button>
            </div>
          </section>
        </div>
      )}
      {bidAuction && (
        <div className="modal-backdrop" role="presentation">
          <section
            className="modal-panel escrow-picker"
            role="dialog"
            aria-modal="true"
            aria-labelledby="auction-bid-title"
          >
            <div className="modal-header">
              <div>
                <span className="label">Bid</span>
                <h2 id="auction-bid-title">Place auction bid</h2>
              </div>
              <button
                className="button secondary"
                type="button"
                disabled={bidPublishing}
                onClick={closeBidModal}
              >
                Close
              </button>
            </div>
            {bidFlowStatus !== 'idle' && (
              <div
                className={`modal-status ${bidFlowStatus}`}
                role={bidFlowStatus === 'error' ? 'alert' : 'status'}
              >
                <strong>
                  {bidFlowStatus === 'success'
                    ? 'Bid submitted'
                    : bidFlowStatus === 'error'
                      ? 'Bid failed'
                      : bidInvoice
                        ? 'Payment required'
                        : 'Preparing bid'}
                </strong>
                <p>
                  {bidFlowStatus === 'success'
                    ? 'The bid and payment proof were published.'
                    : bidFlowStatus === 'error'
                      ? bidFlowError ?? 'The bid flow stopped before publishing.'
                      : bidInvoice
                        ? 'Waiting for the external invoice payment to complete.'
                        : 'Creating the funded bid with the selected auction arbiter.'}
                </p>
              </div>
            )}
            <dl className="auction-facts">
              <div>
                <dt>Currency</dt>
                <dd>{bidAuction.currency}</dd>
              </div>
              <div>
                <dt>Current bid</dt>
                <dd>
                  {formatUnits(highestBidUnits(bidGroupsByAuction[bidAuction.auctionAnchor] ?? []), bidAuction.decimals)}
                  {' '}{bidAuction.currency}
                </dd>
              </div>
              <div>
                <dt>Ends</dt>
                <dd>{formatDateTime(bidAuction.endAt)}</dd>
              </div>
            </dl>
            <label>
              Bid amount
              <input
                inputMode="decimal"
                value={bidAmount}
                disabled={bidPublishing}
                onChange={event => {
                  setBidAmount(event.target.value)
                  if (bidFlowStatus !== 'working') {
                    setBidFlowStatus('idle')
                    setBidFlowError(undefined)
                    setBidInvoice(undefined)
                    setBidMessages([])
                  }
                }}
              />
            </label>
            {bidInvoice && (
              <div className="invoice-box">
                <span className="label">Payment required</span>
                <textarea readOnly value={bidInvoice} />
              </div>
            )}
            {bidMessages.length > 0 && (
              <pre className="payment-log">{bidMessages.join('\n\n')}</pre>
            )}
            <div className="modal-actions">
              <button
                className="button secondary"
                type="button"
                disabled={bidPublishing}
                onClick={closeBidModal}
              >
                {bidFlowStatus === 'success' ? 'Close' : 'Cancel'}
              </button>
              <button
                className="button"
                type="button"
                disabled={bidPublishing || !bidAmount || bidFlowStatus === 'success'}
                onClick={submitBid}
              >
                {bidPublishing
                  ? 'Working...'
                  : bidFlowStatus === 'error'
                    ? 'Retry'
                    : bidFlowStatus === 'success'
                      ? 'Submitted'
                      : 'Continue to invoice'}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  )
}
