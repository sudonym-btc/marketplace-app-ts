import type * as marketplace from 'nostr-tools/marketplace'

import { EmptyState } from '../components/EmptyState'
import { OrderWidget } from '../components/OrderWidget'

type Props = {
  mine: marketplace.ParsedOrderGroup[]
  onMyListings: marketplace.ParsedOrderGroup[]
  onOpenThread: (group: marketplace.ParsedOrderGroup, peerRole: 'buyer' | 'seller') => void | Promise<void>
}

function OrderGroupList({
  groups,
  role,
  onOpenThread,
}: {
  groups: marketplace.ParsedOrderGroup[]
  role: 'buyer' | 'seller'
  onOpenThread: Props['onOpenThread']
}) {
  if (groups.length === 0) return <EmptyState title="No orders" body="Orders will appear once reservations are created." />
  const peerRole = role === 'buyer' ? 'seller' : 'buyer'
  return (
    <div className="stack">
      {groups.map(group => (
        <OrderWidget
          group={group}
          key={`${group.id}:${group.listingAnchor}`}
          onOpen={() => onOpenThread(group, peerRole)}
        />
      ))}
    </div>
  )
}

export function OrdersPage({ mine, onMyListings, onOpenThread }: Props) {
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
          <OrderGroupList groups={mine} role="buyer" onOpenThread={onOpenThread} />
        </section>
        <section>
          <h2>Orders on my listings</h2>
          <OrderGroupList groups={onMyListings} role="seller" onOpenThread={onOpenThread} />
        </section>
      </div>
    </section>
  )
}
