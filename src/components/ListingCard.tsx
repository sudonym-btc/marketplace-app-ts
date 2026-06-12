import type * as marketplace from 'nostr-tools/marketplace'
import { Link } from '@tanstack/react-router'

import { Badge } from './ui'
import { formatPriceAmount } from '../utils/amountDisplay'

type Props = {
  listing: marketplace.MarketplaceListing
}

export function formatPrice(price: marketplace.MarketplacePrice): string {
  return `${formatPriceAmount(price.amount, price.currency)}${price.frequency ? ` / ${price.frequency}` : ''}`
}

export function ListingCard({ listing }: Props) {
  const image = listing.images[0]?.url
  return (
    <Link
      className="grid min-h-36 grid-cols-[112px_minmax(0,1fr)] overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-sm transition-colors hover:border-foreground/20 max-[640px]:grid-cols-1"
      params={{ listingId: listing.event.id }}
      to="/listing/$listingId"
    >
      <div className="relative grid h-36 max-h-36 place-items-center overflow-hidden bg-muted max-[640px]:h-40 max-[640px]:max-h-40">
        {image ? (
          <img className="absolute inset-0 h-full w-full object-cover" src={image} alt="" />
        ) : (
          <span className="text-4xl font-semibold text-muted-foreground">{listing.title.slice(0, 1).toUpperCase()}</span>
        )}
      </div>
      <div className="grid gap-3 p-4">
        <div className="flex items-start justify-between gap-4">
          <h3 className="min-w-0 text-base font-semibold leading-6 text-foreground">{listing.title}</h3>
          <strong className="shrink-0 text-sm font-semibold text-foreground">{formatPrice(listing.prices[0])}</strong>
        </div>
        <p className="line-clamp-2 text-sm leading-6 text-muted-foreground">{listing.summary || listing.description}</p>
        <div className="flex flex-wrap gap-2">
          {listing.location && <Badge>{listing.location}</Badge>}
          <Badge>{listing.rentOrBuy}</Badge>
          {listing.negotiable && <Badge>negotiable</Badge>}
        </div>
      </div>
    </Link>
  )
}
