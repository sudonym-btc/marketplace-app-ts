import { useEffect, useMemo, useState } from 'react'
import * as marketplace from 'nostr-tools/marketplace'
import { finalizeEvent } from 'nostr-tools/pure'

import { formatPrice } from '../components/ListingCard'
import { ProfileChip, profileLabel } from '../components/ProfileChip'
import { listingAnchor, publishNegotiationOffer } from '../nostr/marketplaceApi'
import { shortPubkey } from '../nostr/inboxThreads'
import { fetchProfiles, type NostrProfile } from '../nostr/profiles'
import type { AppSession, LoadedMarketplace, NostrPublisher } from '../types'

type Props = {
  listing?: marketplace.MarketplaceListing
  marketplaceState?: LoadedMarketplace
  session: AppSession
  publisher: NostrPublisher
  onTradeIndexUsed(index: number): void
  onPublished(): void
  onError(error: string): void
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

function routeProbeFor(
  listing: marketplace.MarketplaceListing,
  price: marketplace.MarketplacePrice,
): marketplace.OrderTemplate {
  return {
    tradeId: 'route-probe',
    listingAnchor: listingAnchor(listing.event),
    amount: {
      value: '0',
      denomination: price.currency,
      decimals: 0,
    },
    participants: [
      { pubkey: listing.event.pubkey, role: 'seller' },
    ],
  }
}

export function ListingDetailPage({
  listing,
  marketplaceState,
  session,
  publisher,
  onTradeIndexUsed,
  onPublished,
  onError,
}: Props) {
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [invoice, setInvoice] = useState<string>()
  const [paymentMessages, setPaymentMessages] = useState<string[]>([])
  const [offerAmount, setOfferAmount] = useState('')
  const [offerTouched, setOfferTouched] = useState(false)
  const [escrowPickerOpen, setEscrowPickerOpen] = useState(false)
  const [escrowPickerLoading, setEscrowPickerLoading] = useState(false)
  const [escrowPickerError, setEscrowPickerError] = useState<string>()
  const [escrowChoices, setEscrowChoices] = useState<EscrowChoice[]>([])
  const [selectedEscrowPubkey, setSelectedEscrowPubkey] = useState('')
  const [selectedServiceKey, setSelectedServiceKey] = useState('')
  const price = listing?.prices[0]
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

  const selectedEscrow = useMemo(
    () => escrowChoices.find(choice => choice.pubkey === selectedEscrowPubkey),
    [escrowChoices, selectedEscrowPubkey],
  )
  const selectedService = useMemo(
    () => selectedEscrow?.services.find(service => service.key === selectedServiceKey),
    [selectedEscrow, selectedServiceKey],
  )
  const selectedRoute = selectedService?.route

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

  function nextTrade() {
    if (!listing || !marketplaceState) throw new Error('Marketplace runtime is not ready yet')
    const tradeIndex = marketplaceState.nextTradeIndex
    const anchor = listingAnchor(listing.event)
    const trade = marketplace.seed.deriveTradeMaterial(marketplaceState.runtime.seed, {
      index: tradeIndex,
      role: 'buyer',
    })
    console.debug('[marketplace-app] derived next trade material', {
      listingId: listing.event.id,
      tradeIndex,
      tradeId: trade.tradeId,
      buyerPubkey: trade.tradePubkey,
    })
    return { tradeIndex, anchor, trade }
  }

  function selectEscrow(pubkey: string, choices = escrowChoices) {
    const choice = choices.find(item => item.pubkey === pubkey)
    const firstUsableService = choice?.services.find(service => service.route)
    setSelectedEscrowPubkey(pubkey)
    setSelectedServiceKey(firstUsableService?.key ?? '')
  }

  async function loadEscrowChoices() {
    if (!listing || !price || !marketplaceState) return
    setEscrowPickerLoading(true)
    setEscrowPickerError(undefined)
    try {
      console.debug('[marketplace-app] loading checkout escrow choices', {
        listingId: listing.event.id,
        sellerPubkey: listing.event.pubkey,
        denomination: price.currency,
      })
      const method = await marketplaceState.runtime.escrowMethods.findOne({
        author: listing.event.pubkey,
        limit: 5,
      })
      if (!method) {
        setEscrowChoices([])
        setSelectedEscrowPubkey('')
        setSelectedServiceKey('')
        setEscrowPickerError('The seller has not published any escrow methods')
        console.warn('[marketplace-app] checkout seller has no escrow method', {
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

  async function negotiate() {
    if (!listing || !price || !total) return
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
      const { tradeIndex, trade } = nextTrade()
      console.debug('[marketplace-app] publishing negotiation offer', {
        listingId: listing.event.id,
        tradeIndex,
        tradeId: trade.tradeId,
        denomination: price.currency,
        amount: offerAmount || total,
      })
      await publishNegotiationOffer(session, publisher, listing, {
        tradeId: trade.tradeId,
        start: start || undefined,
        end: end || undefined,
        amount: amountForNegotiation(offerAmount || total, price.currency),
      })
      onTradeIndexUsed(tradeIndex)
      onPublished()
      console.debug('[marketplace-app] negotiation offer published', {
        listingId: listing.event.id,
        tradeIndex,
        tradeId: trade.tradeId,
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
    if (!marketplaceState) {
      console.warn('[marketplace-app] checkout attempted before marketplace runtime is ready', {
        listingId: listing.event.id,
      })
      onError('Marketplace runtime is not ready yet')
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
    setEscrowPickerOpen(true)
    await loadEscrowChoices()
  }

  async function checkoutWithRoute(route: marketplace.MarketplacePaymentRoute) {
    if (!listing || !price || total === undefined) return
    if (!marketplaceState) {
      onError('Marketplace runtime is not ready yet')
      return
    }
    setPublishing(true)
    setInvoice(undefined)
    setPaymentMessages([])
    setEscrowPickerOpen(false)
    try {
      const { tradeIndex, anchor, trade } = nextTrade()
      console.debug('[marketplace-app] starting checkout', {
        listingId: listing.event.id,
        tradeIndex,
        tradeId: trade.tradeId,
        denomination: price.currency,
        total,
      })
      const participants = [
        { pubkey: trade.tradePubkey, role: 'buyer' as const },
        { pubkey: listing.event.pubkey, role: 'seller' as const },
      ]
      console.debug('[marketplace-app] selected checkout payment route', {
        listingId: listing.event.id,
        tradeId: trade.tradeId,
        method: route.policy.method,
        assetId: route.asset.assetId,
        denomination: route.asset.denomination,
        decimals: route.asset.decimals,
        policyId: route.descriptor.id,
      })
      const paymentAmount = decimalToUnits(price.amount, route.asset.decimals) *
        frequencyMultiplier(price.frequency, start, end)
      console.debug('[marketplace-app] checkout payment amount calculated', {
        listingId: listing.event.id,
        tradeId: trade.tradeId,
        value: paymentAmount.toString(),
        denomination: route.asset.denomination,
        decimals: route.asset.decimals,
      })
      const paymentStates = marketplaceState.runtime.pay(listing, {
        tradeId: trade.tradeId,
        listingAnchor: anchor,
        start: start || undefined,
        end: end || undefined,
        amount: {
          value: paymentAmount.toString(),
          denomination: route.asset.denomination,
          decimals: route.asset.decimals,
        },
        participants,
      }, {
        accountIndex: tradeIndex,
        route,
      })
      for await (const paymentState of paymentStates) {
        console.debug('[marketplace-app] checkout payment state', {
          listingId: listing.event.id,
          tradeId: trade.tradeId,
          type: paymentState.type,
          status: 'status' in paymentState ? paymentState.status : undefined,
          hasOrderDraft: Boolean(paymentState.orderDraft),
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
            hasOrderDraft: Boolean(paymentState.orderDraft),
          }),
        ])
        if (paymentState.type === 'order_ready') {
          const event = finalizeEvent(paymentState.orderDraft, trade.tradeSecretKey)
          await publisher.publish(event)
          const paymentEvent = finalizeEvent(paymentState.paymentDraft(event), trade.tradeSecretKey)
          await publisher.publish(paymentEvent)
          console.debug('[marketplace-app] checkout order draft published', {
            listingId: listing.event.id,
            tradeId: trade.tradeId,
            eventId: event.id,
            paymentEventId: paymentEvent?.id,
            kind: event.kind,
            pubkey: event.pubkey,
          })
          setPaymentMessages(messages => [
            ...messages,
            stringifyProgress({
              at: new Date().toISOString(),
              type: 'nostr_published',
              eventId: event.id,
              paymentEventId: paymentEvent?.id,
              kind: event.kind,
            }),
          ])
          onPublished()
        }
        if (paymentState.type === 'payment_required' && paymentState.request.type === 'bolt11') {
          console.debug('[marketplace-app] checkout requires external payment', {
            listingId: listing.event.id,
            tradeId: trade.tradeId,
            requestType: paymentState.request.type,
            amount: paymentState.request.amount,
          })
          setInvoice(paymentState.request.bolt11)
        }
      }
      onTradeIndexUsed(tradeIndex)
      console.debug('[marketplace-app] checkout payment stream completed', {
        listingId: listing.event.id,
        tradeIndex,
        tradeId: trade.tradeId,
      })
    } catch (err) {
      console.warn('[marketplace-app] checkout failed', err)
      onError(err instanceof Error ? err.message : 'Unable to publish reservation offer')
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
    </section>
  )
}
