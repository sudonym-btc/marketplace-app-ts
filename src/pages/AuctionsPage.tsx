import { useEffect, useState } from 'react'

import { EmptyState } from '../components/EmptyState'
import { formatPrice } from '../components/ListingCard'
import type { AuctionListingResolution } from '../nostr/marketplaceApi'
import { routeHref } from '../state/routing'

type Props = {
  rows: AuctionListingResolution[]
}

const pageSize = 10

function shortPubkey(pubkey: string): string {
  return `${pubkey.slice(0, 8)}...${pubkey.slice(-6)}`
}

function formatDateTime(seconds?: number): string {
  if (!seconds) return 'Not scheduled'
  return new Date(seconds * 1000).toLocaleString()
}

function formatUnits(value: string | undefined, decimals: number): string {
  if (!value) return 'None'
  try {
    const units = BigInt(value)
    if (decimals <= 0) return units.toString()
    const scale = 10n ** BigInt(decimals)
    const whole = units / scale
    const fraction = (units % scale).toString().padStart(decimals, '0').replace(/0+$/, '')
    return fraction ? `${whole}.${fraction}` : whole.toString()
  } catch {
    return value
  }
}

function auctionStatus(auction: AuctionListingResolution['auction']): string {
  const now = Math.floor(Date.now() / 1000)
  if (auction.endAt && now >= auction.endAt) return 'Ended'
  if (auction.startAt && now < auction.startAt) return 'Scheduled'
  return 'Live'
}

export function AuctionsPage({ rows }: Props) {
  const [page, setPage] = useState(1)
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
  const visibleRows = rows.slice((page - 1) * pageSize, page * pageSize)

  useEffect(() => {
    setPage(current => Math.min(current, pageCount))
  }, [pageCount])

  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <span className="label">Auctions</span>
          <h1>Auctions</h1>
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No auctions loaded" body="Refresh relays or schedule an auction from one of your listings." />
      ) : (
        <>
          <div className="auction-list">
            {visibleRows.map(row => {
              const { auction, listing } = row
              const content = (
                <>
                  <div className="auction-card-heading">
                    <div>
                      <strong>{listing?.title ?? 'Unresolved listing'}</strong>
                      <span>{auction.currency} {auction.auctionType ?? 'english'} auction</span>
                    </div>
                    <span className="status-pill">{auctionStatus(auction)}</span>
                  </div>
                  {listing && <p className="muted">{listing.summary || listing.description}</p>}
                  <dl className="auction-facts">
                    <div>
                      <dt>Listing price</dt>
                      <dd>{listing ? formatPrice(listing.prices[0]) : 'Not loaded'}</dd>
                    </div>
                    <div>
                      <dt>Starting bid</dt>
                      <dd>{formatUnits(auction.startingBid, auction.decimals)} {auction.currency}</dd>
                    </div>
                    <div>
                      <dt>Starts</dt>
                      <dd>{formatDateTime(auction.startAt)}</dd>
                    </div>
                    <div>
                      <dt>Ends</dt>
                      <dd>{formatDateTime(auction.endAt)}</dd>
                    </div>
                    <div>
                      <dt>Arbiter</dt>
                      <dd>{shortPubkey(auction.arbiterPubkey)}</dd>
                    </div>
                  </dl>
                  <div className="auction-actions">
                    {listing ? <span>Open listing to bid</span> : <span>{row.error ?? 'Listing event not loaded'}</span>}
                  </div>
                </>
              )
              return listing ? (
                <a
                  className="auction-card auction-card-link"
                  href={routeHref({ name: 'listing', id: listing.event.id })}
                  key={auction.auctionAnchor}
                >
                  {content}
                </a>
              ) : (
                <article className="auction-card" key={auction.auctionAnchor}>
                  {content}
                </article>
              )
            })}
          </div>
          <div className="pagination-controls">
            <button className="button secondary" type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Previous
            </button>
            <span>Page {page} of {pageCount}</span>
            <button
              className="button secondary"
              type="button"
              disabled={page >= pageCount}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </div>
        </>
      )}
    </section>
  )
}
