import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react'
import * as marketplace from 'nostr-tools/marketplace'

import type { LoadedMarketplaceSession, MarketplaceSession, MyBidAuction, MyOrders } from '../types'

const emptyOrders: MyOrders = { placed: [], received: [], arbitrating: [] }
const emptyNavigationCounts = { myBids: 0, myOrders: 0, sellerOrders: 0 }

export type NavigationCounts = typeof emptyNavigationCounts

function bidAuctions(groups: marketplace.ParsedAuctionBidGroup[]): MyBidAuction[] {
  const byAuction = new Map<string, MyBidAuction>()
  for (const group of groups) {
    const current = byAuction.get(group.auctionAnchor)
    const lastBidAt = group.bid.event.created_at
    if (current) {
      current.groups.push(group)
      current.lastBidAt = Math.max(current.lastBidAt, lastBidAt)
    } else {
      byAuction.set(group.auctionAnchor, {
        auctionAnchor: group.auctionAnchor,
        lastBidAt,
        groups: [group],
      })
    }
  }
  return [...byAuction.values()]
    .map(auction => ({
      ...auction,
      groups: auction.groups.sort((left, right) =>
        right.bid.event.created_at - left.bid.event.created_at ||
        right.bid.event.id.localeCompare(left.bid.event.id),
      ),
    }))
    .sort((left, right) =>
      right.lastBidAt - left.lastBidAt ||
      right.auctionAnchor.localeCompare(left.auctionAnchor),
    )
}

export function useRouteFetch<T>(
  load: () => Promise<T>,
  initialData: T,
  deps: DependencyList,
) {
  const [data, setData] = useState<T>(initialData)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const requestId = useRef(0)

  const refresh = useCallback(async () => {
    const currentRequest = requestId.current + 1
    requestId.current = currentRequest
    setLoading(true)
    setError(undefined)
    try {
      const nextData = await load()
      if (requestId.current === currentRequest) setData(nextData)
    } catch (err) {
      if (requestId.current === currentRequest) {
        setError(err instanceof Error ? err.message : 'Unable to load marketplace data')
      }
    } finally {
      if (requestId.current === currentRequest) setLoading(false)
    }
  }, deps)

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { data, loading, error, refresh, setData }
}

export function useMyOrders(
  marketplaceSession: LoadedMarketplaceSession | undefined,
  refreshRevision: number,
) {
  const [orders, setOrders] = useState<MyOrders>(emptyOrders)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()

  const refresh = useCallback(async () => {
    if (!marketplaceSession) {
      setOrders(emptyOrders)
      return
    }
    setLoading(true)
    setError(undefined)
    try {
      setOrders(await marketplaceSession.me.orders.list({}, { maxWait: 2500 }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load orders')
    } finally {
      setLoading(false)
    }
  }, [marketplaceSession])

  useEffect(() => {
    if (!marketplaceSession) {
      setOrders(emptyOrders)
      return undefined
    }

    setLoading(true)
    setError(undefined)
    console.debug('[marketplace-app] subscribing to my order roles')
    const stream = marketplaceSession.me.orders.watch({}, {
      label: 'marketplace-app:me.orders',
      maxWait: 2500,
    })
    const snapshotSubscription = stream.snapshot.subscribe(snapshot => {
      setOrders(snapshot)
      setLoading(false)
    })
    const statusSubscription = stream.status.subscribe(status => {
      if (status instanceof marketplace.StreamError) {
        console.warn('[marketplace-app] my order stream error', status.error)
        setLoading(false)
      }
      if (status instanceof marketplace.StreamEose || status instanceof marketplace.StreamLive) {
        console.debug('[marketplace-app] my order stream live', {
          eventCount: status.eventCount,
        })
        setLoading(false)
      }
    })
    return () => {
      snapshotSubscription.unsubscribe()
      statusSubscription.unsubscribe()
      stream.close('marketplace route changed')
    }
  }, [marketplaceSession, refreshRevision])

  return { orders, loading, error, refresh }
}

export function useNavigationCounts(
  marketplaceSession: LoadedMarketplaceSession | undefined,
  refreshRevision: number,
): NavigationCounts {
  const [counts, setCounts] = useState<NavigationCounts>(emptyNavigationCounts)

  useEffect(() => {
    if (!marketplaceSession) {
      setCounts(current => ({
        ...current,
        myOrders: 0,
        sellerOrders: 0,
      }))
      return undefined
    }

    console.debug('[marketplace-app] subscribing to sidebar order counts')
    const stream = marketplaceSession.me.orders.watch({}, {
      label: 'marketplace-app:sidebar.me.orders',
      maxWait: 2500,
    })
    const snapshotSubscription = stream.snapshot.subscribe(snapshot => {
      setCounts(current => ({
        ...current,
        myOrders: snapshot.placed.length,
        sellerOrders: snapshot.received.length,
      }))
    })
    const statusSubscription = stream.status.subscribe(status => {
      if (status instanceof marketplace.StreamError) {
        console.warn('[marketplace-app] sidebar order count stream error', status.error)
      }
    })
    return () => {
      snapshotSubscription.unsubscribe()
      statusSubscription.unsubscribe()
      stream.close('sidebar order counts changed')
    }
  }, [marketplaceSession, refreshRevision])

  useEffect(() => {
    if (!marketplaceSession) {
      setCounts(current => ({
        ...current,
        myBids: 0,
      }))
      return undefined
    }

    console.debug('[marketplace-app] subscribing to sidebar bid count')
    const stream = marketplaceSession.me.bids.placed.watch({}, {
      label: 'marketplace-app:sidebar.me.bids',
      maxWait: 2500,
    })
    const snapshotSubscription = stream.snapshot.subscribe(bids => {
      setCounts(current => ({
        ...current,
        myBids: bidAuctions(bids).length,
      }))
    })
    const statusSubscription = stream.status.subscribe(status => {
      if (status instanceof marketplace.StreamError) {
        console.warn('[marketplace-app] sidebar bid count stream error', status.error)
      }
    })

    return () => {
      snapshotSubscription.unsubscribe()
      statusSubscription.unsubscribe()
      stream.close('sidebar bid counts changed')
    }
  }, [marketplaceSession, refreshRevision])

  return counts
}

export function useMyBidAuctions(
  marketplaceSession: LoadedMarketplaceSession | undefined,
  refreshRevision: number,
) {
  const [auctions, setAuctions] = useState<MyBidAuction[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()

  const refresh = useCallback(async () => {
    if (!marketplaceSession) {
      setAuctions([])
      return
    }
    setLoading(true)
    setError(undefined)
    try {
      setAuctions(bidAuctions(await marketplaceSession.me.bids.placed.list({}, { maxWait: 2500 })))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load bids')
    } finally {
      setLoading(false)
    }
  }, [marketplaceSession])

  useEffect(() => {
    if (!marketplaceSession) {
      setAuctions([])
      return undefined
    }

    setLoading(true)
    setError(undefined)
    console.debug('[marketplace-app] subscribing to my bids')
    const stream = marketplaceSession.me.bids.placed.watch({}, {
      label: 'marketplace-app:me.bids',
      maxWait: 2500,
    })
    const snapshotSubscription = stream.snapshot.subscribe(bids => {
      setAuctions(bidAuctions(bids))
      setLoading(false)
    })
    const statusSubscription = stream.status.subscribe(status => {
      if (status instanceof marketplace.StreamError) {
        console.warn('[marketplace-app] my bids stream error', status.error)
        setError(status.error.message)
        setLoading(false)
      }
      if (status instanceof marketplace.StreamEose || status instanceof marketplace.StreamLive) {
        setLoading(false)
      }
    })
    return () => {
      snapshotSubscription.unsubscribe()
      statusSubscription.unsubscribe()
      stream.close('marketplace route changed')
    }
  }, [marketplaceSession, refreshRevision])

  return { auctions, loading, error, refresh }
}

export function useInboxItems(
  marketplaceSession: MarketplaceSession | undefined,
  refreshRevision: number,
) {
  const [inbox, setInbox] = useState<marketplace.MarketplaceInboxItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()

  const refresh = useCallback(async () => {
    if (!marketplaceSession) {
      setInbox([])
      return
    }
    setLoading(true)
    setError(undefined)
    try {
      setInbox(await marketplaceSession.me.inbox.list({ limit: 100 }, {
        label: 'marketplace-app:me.inbox.list',
        maxWait: 2500,
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load inbox')
    } finally {
      setLoading(false)
    }
  }, [marketplaceSession])

  useEffect(() => {
    if (!marketplaceSession) {
      setInbox([])
      return undefined
    }

    setLoading(true)
    setError(undefined)
    console.debug('[marketplace-app] subscribing to marketplace inbox')
    const stream = marketplaceSession.me.inbox.watch({ limit: 100 }, {
      label: 'marketplace-app:inbox',
      maxWait: 2500,
    })
    const snapshotSubscription = stream.snapshot.subscribe(items => {
      setInbox(items)
      setLoading(false)
    })
    const statusSubscription = stream.status.subscribe(status => {
      if (status instanceof marketplace.StreamError) {
        console.warn('[marketplace-app] inbox stream error', status.error)
        setError(status.error.message)
        setLoading(false)
      }
      if (status instanceof marketplace.StreamEose || status instanceof marketplace.StreamLive) {
        console.debug('[marketplace-app] inbox stream live', {
          eventCount: status.eventCount,
        })
        setLoading(false)
      }
    })
    return () => {
      snapshotSubscription.unsubscribe()
      statusSubscription.unsubscribe()
      stream.close('marketplace route changed')
    }
  }, [marketplaceSession, refreshRevision])

  return { inbox, loading, error, refresh }
}
