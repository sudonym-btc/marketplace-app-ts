import type * as marketplace from 'nostr-tools/marketplace'

import { routeHref } from '../state/routing'

type Props = {
  listing: marketplace.MarketplaceListing
}

export function formatPrice(price: marketplace.MarketplacePrice): string {
  return `${price.amount} ${price.currency}${price.frequency ? ` / ${price.frequency}` : ''}`
}

export function ListingCard({ listing }: Props) {
  const image = listing.images[0]?.url
  return (
    <a className="listing-card" href={routeHref({ name: 'listing', id: listing.event.id })}>
      <div className="listing-media">
        {image ? <img src={image} alt="" /> : <span>{listing.title.slice(0, 1).toUpperCase()}</span>}
      </div>
      <div className="listing-body">
        <div className="listing-title-row">
          <h3>{listing.title}</h3>
          <strong>{formatPrice(listing.prices[0])}</strong>
        </div>
        <p>{listing.summary || listing.description}</p>
        <div className="tags">
          {listing.location && <span>{listing.location}</span>}
          <span>{listing.rentOrBuy}</span>
          {listing.negotiable && <span>negotiable</span>}
        </div>
      </div>
    </a>
  )
}
