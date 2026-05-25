import * as kinds from 'nostr-tools/kinds'
import * as marketplace from 'nostr-tools/marketplace'

import { EmptyState } from '../components/EmptyState'
import type { InboxItem } from '../types'

type Props = {
  inbox: InboxItem[]
}

function rumorTitle(item: InboxItem): string {
  if (item.error) return 'Unreadable gift wrap'
  if (!item.rumor) return 'Empty message'
  if (item.rumor.kind === kinds.MarketplaceOrder) {
    try {
      const order = marketplace.orders.parse(item.rumor)
      return `Offer: ${order.content.stage} (${order.tradeId.slice(0, 10)}...)`
    } catch {
      return 'Marketplace order'
    }
  }
  if (item.rumor.kind === kinds.StructuredMessage) return 'Marketplace message'
  return `Kind ${item.rumor.kind}`
}

function rumorBody(item: InboxItem): string {
  if (item.error) return item.error
  if (!item.rumor) return ''
  if (item.rumor.kind === kinds.MarketplaceOrder) {
    try {
      const order = marketplace.orders.parse(item.rumor)
      return JSON.stringify(order.content, null, 2)
    } catch {
      return item.rumor.content
    }
  }
  return item.rumor.content
}

export function InboxPage({ inbox }: Props) {
  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <span className="label">Gift wraps</span>
          <h1>Inbox</h1>
        </div>
      </div>
      {inbox.length === 0 ? (
        <EmptyState title="Inbox empty" body="Gift-wrapped messages and negotiation offers will appear here." />
      ) : (
        <div className="stack">
          {inbox.map(item => (
            <article className="message-row" key={item.wrap.id}>
              <div>
                <h3>{rumorTitle(item)}</h3>
                <span>{new Date(item.wrap.created_at * 1000).toLocaleString()}</span>
              </div>
              <pre>{rumorBody(item)}</pre>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
