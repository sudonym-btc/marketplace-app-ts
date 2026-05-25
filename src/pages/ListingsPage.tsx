import type * as marketplace from 'nostr-tools/marketplace'

import { EmptyState } from '../components/EmptyState'
import { ListingCard } from '../components/ListingCard'

type Props = {
  listings: marketplace.MarketplaceListing[]
}

export function ListingsPage({ listings }: Props) {
  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <span className="label">Classifieds</span>
          <h1>Listings</h1>
        </div>
        <a className="button" href="#/edit-listing">Add listing</a>
      </div>
      {listings.length === 0 ? (
        <EmptyState title="No listings loaded" body="Refresh relays or publish the first listing." />
      ) : (
        <div className="listing-grid">
          {listings.map(listing => <ListingCard key={listing.event.id} listing={listing} />)}
        </div>
      )}
    </section>
  )
}
