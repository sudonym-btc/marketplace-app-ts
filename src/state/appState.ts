import { useCallback, useEffect, useMemo, useState } from 'react'
import * as marketplace from 'nostr-tools/marketplace'
import { SimplePool } from 'nostr-tools/pool'
import { createCashuAuctionPolicy, createCashuEscrowPolicy } from '@sudonym-btc/marketplace-cashu'
import { createEvmAuctionPolicy, createEvmEscrowPolicy } from '@sudonym-btc/marketplace-evm'

import { loadAppConfig, type AppConfig } from '../config/appConfig'
import { LocalCashuEscrowStore } from '../cashu/storage'
import { createEvmChainConfigs } from '../evm/config'
import { LocalOperationStore } from '../evm/operationStore'
import {
  fetchAuctionRows,
  fetchGiftWraps,
  fetchListings,
  fetchOrderBuckets,
  type AuctionListingResolution,
} from '../nostr/marketplaceApi'
import { clearStoredSession, isBunkerSessionTimeout, publisher, restoreBunkerSession } from '../nostr/session'
import type { AppRoute, AppSession, InboxItem, LoadedMarketplace, OrderBucket, SessionRestoreError } from '../types'
import { unwrapGiftWrapWithSigner } from '../nostr/giftwrap'
import { routeFromHash } from './routing'

export type AppState = {
  config: AppConfig
  route: AppRoute
  session?: AppSession
  publicMarketplace: ReturnType<typeof marketplace.bind>
  marketplace?: LoadedMarketplace
  listings: marketplace.MarketplaceListing[]
  auctionRows: AuctionListingResolution[]
  inbox: InboxItem[]
  orders: OrderBucket
  loading: boolean
  status: string
  error?: string
  sessionError?: SessionRestoreError
}

const emptyOrders: OrderBucket = { mine: [], onMyListings: [] }

export function useAppState() {
  const [config] = useState(loadAppConfig)
  const [publicPool] = useState(() => new SimplePool())
  const [route, setRoute] = useState<AppRoute>(() => routeFromHash())
  const [session, setSession] = useState<AppSession>()
  const [loadedMarketplace, setLoadedMarketplace] = useState<LoadedMarketplace>()
  const [listings, setListings] = useState<marketplace.MarketplaceListing[]>([])
  const [auctionRows, setAuctionRows] = useState<AuctionListingResolution[]>([])
  const [inbox, setInbox] = useState<InboxItem[]>([])
  const [orders, setOrders] = useState<OrderBucket>(emptyOrders)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('Ready')
  const [error, setError] = useState<string>()
  const [sessionError, setSessionError] = useState<SessionRestoreError>()

  useEffect(() => {
    const onHashChange = () => setRoute(routeFromHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const publicReader = useMemo(
    () => ({ pool: publicPool, relays: config.relays }),
    [config.relays, publicPool],
  )
  const publicMarketplace = useMemo(
    () => marketplace.bind(publicReader.pool, publicReader.relays),
    [publicReader],
  )
  const appPublisher = useMemo(() => (session ? publisher(session) : undefined), [session])

  const initializeMarketplace = useCallback(
    async (nextSession: AppSession): Promise<LoadedMarketplace> => {
      console.debug('[marketplace-app] initializing marketplace runtime', {
        pubkey: nextSession.pubkey,
        relayCount: nextSession.relays.length,
      })
      const pub = publisher(nextSession)
      const orderPolicies: marketplace.MarketplaceOrderPolicy[] = []
      const bidPolicies: marketplace.MarketplaceBidPolicy[] = []
      const evmChains = createEvmChainConfigs(config)
      const cashuStorage = new LocalCashuEscrowStore()
      const evmEscrowPolicy = evmChains.length > 0
        ? createEvmEscrowPolicy({
            chains: evmChains,
            operationStore: new LocalOperationStore(),
            appId: 'marketplace',
          })
        : null
      const evmAuctionPolicy = evmChains.length > 0
        ? createEvmAuctionPolicy({
            chains: evmChains,
            operationStore: new LocalOperationStore(),
            appId: 'marketplace',
          })
        : null
      const cashuEscrowPolicy = config.cashu.enabled
        ? createCashuEscrowPolicy({
            mints: config.cashu.mints,
            storage: cashuStorage,
            appId: 'marketplace',
          })
        : null
      const cashuAuctionPolicy = config.cashu.enabled
        ? createCashuAuctionPolicy({
            mints: config.cashu.mints,
            storage: cashuStorage,
            appId: 'marketplace',
          })
        : null
      if (evmEscrowPolicy) orderPolicies.push(evmEscrowPolicy)
      if (evmAuctionPolicy) bidPolicies.push(evmAuctionPolicy)
      if (cashuEscrowPolicy) orderPolicies.push(cashuEscrowPolicy)
      if (cashuAuctionPolicy) bidPolicies.push(cashuAuctionPolicy)
      console.debug('[marketplace-app] marketplace payment policies configured', {
        orderPolicyCount: orderPolicies.length,
        bidPolicyCount: bidPolicies.length,
        evmEnabled: Boolean(evmEscrowPolicy || evmAuctionPolicy),
        evmChainCount: evmChains.length,
        cashuEnabled: Boolean(cashuEscrowPolicy || cashuAuctionPolicy),
        cashuMintCount: config.cashu.mints.length,
      })

      setStatus('Initializing marketplace runtime')
      const runtime = await marketplace.session(nextSession.pool, nextSession.relays, nextSession.signer, {
        pubkey: nextSession.pubkey,
        orderPolicies,
        bidPolicies,
        autoTrustEscrow: config.autoTrustEscrowPubkeys,
        publish: event => pub.publish(event),
      })
      console.debug('[marketplace-app] marketplace runtime initialized', {
        seedCreated: runtime.seed.created,
        seedEventId: runtime.seed.event?.id,
      })
      setStatus('Starting marketplace policies')
      const started = await runtime.start({ unusedWindow: 25 })
      console.debug('[marketplace-app] marketplace runtime started', {
        nextUnusedIndex: started.discovery.nextUnusedIndex,
        maxUsedIndex: started.discovery.maxUsedIndex,
        converged: started.discovery.converged,
        policyResultCount: started.policyResults.length,
        policyCount: started.policies.length,
        assetCount: started.assets.length,
      })

      const loaded: LoadedMarketplace = {
        runtime,
        nextTradeIndex: started.discovery.nextUnusedIndex,
        evm: evmEscrowPolicy?.state() ?? evmAuctionPolicy?.state() ?? {
          enabled: false,
          started: false,
          maxUsedIndex: -1,
          nextTradeIndex: started.discovery.nextUnusedIndex,
          startSummary: 'EVM disabled',
        },
      }
      setLoadedMarketplace(loaded)
      console.debug('[marketplace-app] marketplace initialization complete', {
        nextTradeIndex: loaded.nextTradeIndex,
        evmStarted: loaded.evm?.started,
        evmSummary: loaded.evm?.startSummary,
      })
      return loaded
    },
    [config],
  )

  const loadPublicListings = useCallback(async () => {
    console.debug('[marketplace-app] loading public listings')
    const [nextListings, nextAuctionRows] = await Promise.all([
      fetchListings(publicReader),
      fetchAuctionRows(publicReader, publicMarketplace),
    ])
    setListings(nextListings)
    setAuctionRows(nextAuctionRows)
    console.debug('[marketplace-app] public listings loaded', {
      listingCount: nextListings.length,
      auctionCount: nextAuctionRows.length,
    })
    return nextListings
  }, [publicMarketplace, publicReader])

  const refreshListings = useCallback(async () => {
    console.debug('[marketplace-app] refreshing listings')
    const nextListings = await fetchListings(session ?? publicReader)
    setListings(nextListings)
    console.debug('[marketplace-app] listings refreshed', { listingCount: nextListings.length })
  }, [publicReader, session])

  const refreshInbox = useCallback(async () => {
    if (!session) return
    console.debug('[marketplace-app] refreshing inbox')
    const wraps = await fetchGiftWraps(session)
    const items = await Promise.all(wraps.map(wrap => unwrapGiftWrapWithSigner(wrap, session.signer)))
    const failedCount = items.filter(item => item.error).length
    if (failedCount > 0) {
      console.warn('[marketplace-app] some inbox items failed to unwrap', { failedCount, total: items.length })
    }
    setInbox(items)
    console.debug('[marketplace-app] inbox refreshed', { wrapCount: wraps.length, itemCount: items.length })
  }, [session])

  const refreshOrders = useCallback(async () => {
    if (!loadedMarketplace) return
    console.debug('[marketplace-app] refreshing orders')
    const nextOrders = await fetchOrderBuckets(loadedMarketplace.runtime)
    setOrders(nextOrders)
    console.debug('[marketplace-app] orders refreshed', {
      mineCount: nextOrders.mine.length,
      onMyListingsCount: nextOrders.onMyListings.length,
    })
  }, [loadedMarketplace])

  const refreshAll = useCallback(async () => {
    setLoading(true)
    setError(undefined)
    try {
      if (!session) {
        setStatus('Refreshing public listings')
        await loadPublicListings()
        setStatus('Ready')
        return
      }
      setStatus('Refreshing marketplace data')
      const auctionRuntime = loadedMarketplace?.runtime ?? publicMarketplace
      const [nextListings, wraps, nextAuctionRows] = await Promise.all([
        fetchListings(session),
        fetchGiftWraps(session),
        fetchAuctionRows(session, auctionRuntime),
      ])
      const nextOrders = loadedMarketplace
        ? await fetchOrderBuckets(loadedMarketplace.runtime)
        : emptyOrders
      setListings(nextListings)
      setAuctionRows(nextAuctionRows)
      setInbox(await Promise.all(wraps.map(wrap => unwrapGiftWrapWithSigner(wrap, session.signer))))
      setOrders(nextOrders)
      console.debug('[marketplace-app] marketplace data refreshed', {
        listingCount: nextListings.length,
        auctionCount: nextAuctionRows.length,
        inboxCount: wraps.length,
        mineOrderCount: nextOrders.mine.length,
        onMyListingsCount: nextOrders.onMyListings.length,
      })
      setStatus('Ready')
    } catch (err) {
      console.warn('[marketplace-app] refresh failed', err)
      setError(err instanceof Error ? err.message : 'Refresh failed')
    } finally {
      setLoading(false)
    }
  }, [loadPublicListings, loadedMarketplace, publicMarketplace, session])

  const markTradeIndexUsed = useCallback((index: number) => {
    console.debug('[marketplace-app] marking trade index used', { index })
    setLoadedMarketplace(current => current
      ? {
          ...current,
          nextTradeIndex: Math.max(current.nextTradeIndex, index + 1),
          ...(current.evm
            ? { evm: { ...current.evm, nextTradeIndex: Math.max(current.evm.nextTradeIndex, index + 1) } }
            : {}),
        }
      : current)
  }, [])

  const attachSession = useCallback(
    async (nextSession: AppSession) => {
      setLoading(true)
      setError(undefined)
      try {
        setSession(nextSession)
        setSessionError(undefined)
        const nextMarketplace = await initializeMarketplace(nextSession)
        setStatus('Loading marketplace data')
        const [nextListings, wraps, nextAuctionRows] = await Promise.all([
          fetchListings(nextSession),
          fetchGiftWraps(nextSession),
          fetchAuctionRows(nextSession, nextMarketplace.runtime),
        ])
        const nextOrders = await fetchOrderBuckets(nextMarketplace.runtime)
        setListings(nextListings)
        setAuctionRows(nextAuctionRows)
        setInbox(await Promise.all(wraps.map(wrap => unwrapGiftWrapWithSigner(wrap, nextSession.signer))))
        setOrders(nextOrders)
        console.debug('[marketplace-app] session attached and marketplace data loaded', {
          listingCount: nextListings.length,
          auctionCount: nextAuctionRows.length,
          wrapCount: wraps.length,
          mineOrderCount: nextOrders.mine.length,
          onMyListingsCount: nextOrders.onMyListings.length,
        })
        setStatus('Ready')
      } catch (err) {
        console.warn('[marketplace-app] startup failed', err)
        setError(err instanceof Error ? err.message : 'Startup failed')
      } finally {
        setLoading(false)
      }
    },
    [initializeMarketplace],
  )

  const restore = useCallback(async () => {
    setLoading(true)
    setError(undefined)
    setSessionError(undefined)
    setStatus('Reconnecting bunker session')
    try {
      const restored = await restoreBunkerSession(config.relays)
      if (restored) await attachSession(restored)
      else console.debug('[marketplace-app] no restored session found')
      if (!restored) {
        setStatus('Loading public listings')
        await loadPublicListings()
        setStatus('Ready')
      }
    } catch (err) {
      const timedOut = isBunkerSessionTimeout(err)
      const message = err instanceof Error ? err.message : 'Saved bunker session could not be restored'
      console.warn('[marketplace-app] session restore failed', err)
      setSession(undefined)
      setLoadedMarketplace(undefined)
      setSessionError({
        title: timedOut ? 'Bunker reconnect timed out' : 'Bunker reconnect failed',
        message: timedOut
          ? 'Marketplace found a saved NIP-46 session, but the remote signer did not answer in time.'
          : 'Marketplace found a saved NIP-46 session, but it could not be restored.',
        detail: message,
        timedOut,
      })
      try {
        setStatus('Loading public listings')
        await loadPublicListings()
        setStatus(timedOut ? 'Bunker reconnect timed out' : 'Bunker reconnect failed')
      } catch (publicErr) {
        console.warn('[marketplace-app] public listing load failed after session restore error', publicErr)
        setError(publicErr instanceof Error ? publicErr.message : 'Unable to load public listings')
        setStatus(timedOut ? 'Bunker reconnect timed out' : 'Bunker reconnect failed')
      }
    } finally {
      setLoading(false)
    }
  }, [attachSession, config.relays, loadPublicListings])

  const clearSession = useCallback(() => {
    console.debug('[marketplace-app] clearing active marketplace session')
    session?.pool.close(session.relays)
    clearStoredSession()
    setSession(undefined)
    setLoadedMarketplace(undefined)
    setInbox([])
    setOrders(emptyOrders)
    setAuctionRows([])
    setError(undefined)
    setSessionError(undefined)
    setStatus('Ready')
    void loadPublicListings()
  }, [loadPublicListings, session])

  return {
    state: {
      config,
      route,
      session,
      publicMarketplace,
      marketplace: loadedMarketplace,
      listings,
      auctionRows,
      inbox,
      orders,
      loading,
      status,
      error,
      sessionError,
    },
    publisher: appPublisher,
    actions: {
      attachSession,
      refreshAll,
      refreshListings,
      refreshInbox,
      refreshOrders,
      restore,
      clearSession,
      setError,
      setStatus,
      markTradeIndexUsed,
    },
  }
}
