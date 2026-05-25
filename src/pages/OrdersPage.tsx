import type * as marketplace from 'nostr-tools/marketplace'

import { EmptyState } from '../components/EmptyState'

type Props = {
  mine: marketplace.ParsedOrderGroup[]
  onMyListings: marketplace.ParsedOrderGroup[]
}

function OrderGroupList({ groups }: { groups: marketplace.ParsedOrderGroup[] }) {
  if (groups.length === 0) return <EmptyState title="No orders" body="Orders will appear once reservations are created." />
  return (
    <div className="stack">
      {groups.map(group => (
        <article className="order-row" key={`${group.id}:${group.listingAnchor}`}>
          <div>
            <h3>{group.tradeId.slice(0, 16)}...</h3>
            <span>{group.stage} · {group.orders.length} events</span>
          </div>
          <code>{group.listingAnchor}</code>
        </article>
      ))}
    </div>
  )
}

export function OrdersPage({ mine, onMyListings }: Props) {
  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <span className="label">Reservations</span>
          <h1>Orders</h1>
        </div>
      </div>
      <div className="two-column">
        <section>
          <h2>Orders I made</h2>
          <OrderGroupList groups={mine} />
        </section>
        <section>
          <h2>Orders on my listings</h2>
          <OrderGroupList groups={onMyListings} />
        </section>
      </div>
    </section>
  )
}
