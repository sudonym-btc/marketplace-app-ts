import { useMemo, useState } from 'react'
import * as marketplace from 'nostr-tools/marketplace'

import { formatPrice } from '../components/ListingCard'
import type { EvmOrderAndPayResult } from '../evm/driver'
import { listingAnchor } from '../nostr/marketplaceApi'
import type { LoadedMarketplace, NostrPublisher } from '../types'

type Props = {
  listing?: marketplace.MarketplaceListing
  marketplaceState?: LoadedMarketplace
  publisher: NostrPublisher
  onPublished(): void
  onError(error: string): void
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

export function ListingDetailPage({ listing, marketplaceState, publisher, onPublished, onError }: Props) {
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [invoice, setInvoice] = useState<string>()
  const price = listing?.prices[0]
  const amount = useMemo(() => {
    if (!price) return undefined
    return BigInt(price.amount) * frequencyMultiplier(price.frequency, start, end)
  }, [end, price, start])

  async function checkout() {
    if (!listing || !price || amount === undefined) return
    if (!marketplaceState) {
      onError('Marketplace runtime is not ready yet')
      return
    }
    if (price.frequency && (!start || !end)) {
      onError('Choose start and end dates before checkout')
      return
    }
    setPublishing(true)
    setInvoice(undefined)
    try {
      const tradeIndex = marketplaceState.evm?.nextTradeIndex ?? 0
      const anchor = listingAnchor(listing.event)
      const trade = marketplace.seeds.deriveTradeMaterial(marketplaceState.seed, {
        index: tradeIndex,
        listingAnchor: anchor,
        role: 'buyer',
      })
      const result = await marketplaceState.runtime.orderAndPay<EvmOrderAndPayResult>(listing, {
        tradeId: trade.tradeId,
        listingAnchor: anchor,
        stage: 'commit',
        start: start || undefined,
        end: end || undefined,
        amount: {
          value: amount.toString(),
          denomination: price.currency,
          decimals: 0,
        },
        participants: [
          { pubkey: trade.tradePubkey, role: 'buyer' },
          { pubkey: listing.event.pubkey, role: 'seller' },
        ],
      })
      const event = await publisher.sign(result.orderDraft)
      await publisher.publish(event)
      if (result.type === 'external-payment-required') setInvoice(result.invoice)
      onPublished()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Unable to publish reservation offer')
    } finally {
      setPublishing(false)
    }
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
          <strong>{amount?.toString() ?? '0'} {price?.currency}</strong>
        </div>
        <button className="button" type="button" disabled={publishing} onClick={checkout}>
          {publishing ? 'Publishing offer...' : 'Reserve / checkout'}
        </button>
        {invoice && (
          <div className="invoice-box">
            <span className="label">Lightning invoice</span>
            <textarea readOnly value={invoice} />
          </div>
        )}
      </aside>
    </section>
  )
}
