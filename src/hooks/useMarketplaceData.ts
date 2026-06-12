import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react'
import * as marketplace from 'nostr-tools/marketplace'

import { deriveLocalAuctionBidPubkeys, isOwnBidChain, sortBidChains } from '../nostr/auctionBidChains'
import type { AppSession, LoadedMarketplace, MyBidChainResolution, OrderBucket } from '../types'

const emptyOrders: OrderBucket = { mine: [], onMyListings: [] }
const emptyNavigationCounts = { myBids: 0, myOrders: 0, sellerOrders: 0 }

export type NavigationCounts = typeof emptyNavigationCounts

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

export function useOrderBuckets(
  marketplaceState: LoadedMarketplace | undefined,
  refreshRevision: number,
) {
  const marketplaceSession = marketplaceState?.runtime
  const [orders, setOrders] = useState<OrderBucket>(emptyOrders)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()

  const refresh = useCallback(async () => {
    if (!marketplaceState) {
      setOrders(emptyOrders)
      return
    }
    setLoading(true)
    setError(undefined)
    try {
      const buckets = await marketplaceState.runtime.orders.groups.mine()
      setOrders({
        mine: buckets.buyer,
        onMyListings: buckets.seller,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load orders')
    } finally {
      setLoading(false)
    }
  }, [marketplaceState])

  useEffect(() => {
    if (!marketplaceSession) {
      setOrders(emptyOrders)
      return undefined
    }

    setLoading(true)
    setError(undefined)
    console.debug('[marketplace-app] subscribing to my order buckets')
    const stream = marketplaceSession.orders.groups.mine.stream({}, {
      label: 'marketplace-app:orders.mine',
      maxWait: 2500,
    })
    const snapshotSubscription = stream.snapshot.subscribe(buckets => {
      setOrders({
        mine: buckets.buyer,
        onMyListings: buckets.seller,
      })
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
  marketplaceState: LoadedMarketplace | undefined,
  session: AppSession | undefined,
  refreshRevision: number,
): NavigationCounts {
  const marketplaceSession = marketplaceState?.runtime
  const [counts, setCounts] = useState<NavigationCounts>(emptyNavigationCounts)

  useEffect(() => {
    if (!marketplaceSession || !session) {
      setCounts(current => ({
        ...current,
        myOrders: 0,
        sellerOrders: 0,
      }))
      return undefined
    }

    console.debug('[marketplace-app] subscribing to sidebar order counts')
    const stream = marketplaceSession.orders.groups.mine.stream({}, {
      label: 'marketplace-app:sidebar.orders',
      maxWait: 2500,
    })
    const snapshotSubscription = stream.snapshot.subscribe(buckets => {
      setCounts(current => ({
        ...current,
        myOrders: buckets.buyer.length,
        sellerOrders: buckets.seller.length,
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
  }, [marketplaceSession, refreshRevision, session])

  useEffect(() => {
    let closed = false
    let closer: { close(reason?: string): void } | undefined

    if (!marketplaceState || !marketplaceSession || !session) {
      setCounts(current => ({
        ...current,
        myBids: 0,
      }))
      return undefined
    }

    setCounts(current => ({
      ...current,
      myBids: 0,
    }))

    void (async () => {
      try {
        const localAuctionBidPubkeys = await deriveLocalAuctionBidPubkeys(session, marketplaceState)
        if (closed) return
        const participantPubkeys = [session.pubkey, ...localAuctionBidPubkeys]

        const updateBidCount = (groups: marketplace.ParsedAuctionBidGroup[]) => {
          if (closed) return
          const ownChains = marketplaceSession.auctions.bidGroups
            .chains(groups)
            .filter(chain => isOwnBidChain(chain, session.pubkey, localAuctionBidPubkeys))
          setCounts(current => ({
            ...current,
            myBids: ownChains.length,
          }))
        }

        console.debug('[marketplace-app] subscribing to sidebar bid count', {
          participantPubkeyCount: participantPubkeys.length,
        })
        closer = marketplaceSession.auctions.bidGroups.subscribe({
          participantPubkeys,
          limit: 500,
        }, {
          ongroups: updateBidCount,
          oninvalid: (event, error) => {
            console.warn('[marketplace-app] sidebar bid count skipped invalid event', {
              eventId: event.id,
              kind: event.kind,
            }, error)
          },
        }, {
          label: 'marketplace-app:sidebar.bids',
          maxWait: 2500,
        })
      } catch (err) {
        if (!closed) console.warn('[marketplace-app] unable to subscribe to sidebar bid count', err)
      }
    })()

    return () => {
      closed = true
      closer?.close('sidebar bid counts changed')
    }
  }, [marketplaceSession, marketplaceState, refreshRevision, session])

  return counts
}

export function useMyBidChains(
  marketplaceState: LoadedMarketplace | undefined,
  session: AppSession | undefined,
  refreshRevision: number,
) {
  const [bidChains, setBidChains] = useState<MyBidChainResolution[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()

  const refresh = useCallback(async () => {
    const marketplaceSession = marketplaceState?.runtime
    if (!marketplaceSession || !session) {
      setBidChains([])
      return
    }
    setLoading(true)
    setError(undefined)
    try {
      const localAuctionBidPubkeys = await deriveLocalAuctionBidPubkeys(session, marketplaceState)
      const myBidGroups = await marketplaceSession.auctions.bidGroups.mine.fetch({}, { maxWait: 2500 })
      const auctionAnchors = [...new Set(myBidGroups.map(group => group.auctionAnchor))]
      const rows = await Promise.all(auctionAnchors.map(async auctionAnchor => {
        try {
          const snapshot = await marketplaceSession.auctions.scope({ auctionAnchor }).query({ maxWait: 2500 })
          if (!snapshot.auction) return []
          const ownChains = sortBidChains(
            snapshot.bidChains.filter(chain => isOwnBidChain(chain, session.pubkey, localAuctionBidPubkeys)),
          )
          if (ownChains.length === 0) return []
          const listing = await marketplaceSession.listings.findByAnchor(snapshot.auction.listingAnchor)
          return ownChains.map(chain => ({
            auction: snapshot.auction!,
            chain,
            listing,
            snapshot,
          }))
        } catch {
          return []
        }
      }))
      setBidChains(rows.flat().sort((left, right) =>
        right.chain.head.bid.event.created_at - left.chain.head.bid.event.created_at ||
        right.chain.head.bid.event.id.localeCompare(left.chain.head.bid.event.id),
      ))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load bids')
    } finally {
      setLoading(false)
    }
  }, [marketplaceState, session])

  useEffect(() => {
    void refresh()
  }, [refresh, refreshRevision])

  return { bidChains, loading, error, refresh }
}

export function useInboxItems(
  marketplaceSession: LoadedMarketplace['runtime'] | undefined,
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
      setInbox(await marketplaceSession.inbox.fetch({ limit: 100 }, {
        label: 'marketplace-app:inbox.fetch',
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
    const stream = marketplaceSession.inbox.stream({ limit: 100 }, {
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
