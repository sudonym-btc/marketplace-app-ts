import type * as marketplace from 'nostr-tools/marketplace'

import { EmptyState } from '../components/EmptyState'
import { ListingCard } from '../components/ListingCard'

type Props = {
  listings: marketplace.MarketplaceListing[]
  signedIn: boolean
  label?: string
  title?: string
  emptyTitle?: string
  emptyBody?: string
}

export function ListingsPage({
  listings,
  signedIn,
  label = 'Classifieds',
  title = 'Listings',
  emptyTitle = 'No listings loaded',
  emptyBody = 'Refresh relays or publish the first listing.',
}: Props) {
  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <span className="label">{label}</span>
          <h1>{title}</h1>
        </div>
        <a className="button" href={signedIn ? '#/edit-listing' : '#/login'}>
          {signedIn ? 'Add listing' : 'Sign in to add listing'}
        </a>
      </div>
      {listings.length === 0 ? (
        <EmptyState title={emptyTitle} body={emptyBody} />
      ) : (
        <div className="listing-grid">
          {listings.map(listing => <ListingCard key={listing.event.id} listing={listing} />)}
        </div>
      )}
    </section>
  )
}
