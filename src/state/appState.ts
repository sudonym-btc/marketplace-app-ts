import { useCallback, useEffect, useMemo, useState } from 'react'
import * as marketplace from 'nostr-tools/marketplace'
import { createEvmAuctionPolicy, createEvmEscrowPolicy } from '@sudonym-btc/marketplace-evm'

import { loadAppConfig, type AppConfig } from '../config/appConfig'
import { createEvmChainConfigs } from '../evm/config'
import { LocalOperationStore } from '../evm/operationStore'
import { fetchGiftWraps, fetchListings, fetchOrderBuckets, publishEscrowMethod } from '../nostr/marketplaceApi'
import { clearStoredSession, isBunkerSessionTimeout, publisher, restoreBunkerSession } from '../nostr/session'
import type { AppRoute, AppSession, InboxItem, LoadedMarketplace, OrderBucket, SessionRestoreError } from '../types'
import { unwrapGiftWrapWithSigner } from '../nostr/giftwrap'
import { routeFromHash } from './routing'

export type AppState = {
  config: AppConfig
  route: AppRoute
  session?: AppSession
  marketplace?: LoadedMarketplace
  listings: marketplace.MarketplaceListing[]
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
  const [route, setRoute] = useState<AppRoute>(() => routeFromHash())
  const [session, setSession] = useState<AppSession>()
  const [loadedMarketplace, setLoadedMarketplace] = useState<LoadedMarketplace>()
  const [listings, setListings] = useState<marketplace.MarketplaceListing[]>([])
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
      const evmEscrowPolicy = evmChains.length > 0
        ? createEvmEscrowPolicy({
            chains: evmChains,
            operationStore: new LocalOperationStore(),
            appId: 'hostr',
          })
        : null
      const evmAuctionPolicy = evmChains.some(chain => chain.multiAuctionAddress)
        ? createEvmAuctionPolicy({
            chains: evmChains,
            operationStore: new LocalOperationStore(),
            appId: 'hostr',
          })
        : null
      if (evmEscrowPolicy) orderPolicies.push(evmEscrowPolicy)
      if (evmAuctionPolicy) bidPolicies.push(evmAuctionPolicy)
      console.debug('[marketplace-app] marketplace payment policies configured', {
        orderPolicyCount: orderPolicies.length,
        bidPolicyCount: bidPolicies.length,
        evmEnabled: Boolean(evmEscrowPolicy || evmAuctionPolicy),
        evmChainCount: evmChains.length,
      })

      setStatus('Initializing marketplace runtime')
      const runtime = await marketplace.init({
        pool: nextSession.pool,
        relays: nextSession.relays,
        identity: {
          pubkey: nextSession.pubkey,
          signer: nextSession.signer,
        },
        orderPolicies,
        bidPolicies,
        publish: event => pub.publish(event),
      })
      console.debug('[marketplace-app] marketplace runtime initialized', {
        seedCreated: runtime.seedCreated,
        seedEventId: runtime.seedEvent?.id,
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

      if (config.evm.enabled) {
        setStatus('Publishing EVM escrow method')
        const evmPolicies = started.policies.filter(policy => policy.method === 'evm' && policy.hash)
        const evmAssets = started.assets.filter(asset => asset.method === 'evm')
        console.debug('[marketplace-app] publishing EVM escrow method from policy capabilities', {
          policyCount: evmPolicies.length,
          assetCount: evmAssets.length,
          hasArbiterPubkey: Boolean(config.evm.arbiterNostrPubkey),
        })
        await publishEscrowMethod(nextSession, pub, {
          trustedEscrowPubkey: config.evm.arbiterNostrPubkey || nextSession.pubkey,
          bytecodeHash: evmPolicies[0]?.hash,
          paymentForms: evmAssets.map(asset => ({
            denomination: asset.denomination,
            assetId: asset.assetId,
            ...(asset.appId ? { appId: asset.appId } : {}),
          })),
        })
      }

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

  const refreshListings = useCallback(async () => {
    if (!session) return
    console.debug('[marketplace-app] refreshing listings')
    const nextListings = await fetchListings(session)
    setListings(nextListings)
    console.debug('[marketplace-app] listings refreshed', { listingCount: nextListings.length })
  }, [session])

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
    if (!session) return
    setLoading(true)
    setError(undefined)
    try {
      setStatus('Refreshing marketplace data')
      const [nextListings, wraps] = await Promise.all([
        fetchListings(session),
        fetchGiftWraps(session),
      ])
      const nextOrders = loadedMarketplace
        ? await fetchOrderBuckets(loadedMarketplace.runtime)
        : emptyOrders
      setListings(nextListings)
      setInbox(await Promise.all(wraps.map(wrap => unwrapGiftWrapWithSigner(wrap, session.signer))))
      setOrders(nextOrders)
      console.debug('[marketplace-app] marketplace data refreshed', {
        listingCount: nextListings.length,
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
  }, [loadedMarketplace, session])

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
        const [nextListings, wraps] = await Promise.all([
          fetchListings(nextSession),
          fetchGiftWraps(nextSession),
        ])
        const nextOrders = await fetchOrderBuckets(nextMarketplace.runtime)
        setListings(nextListings)
        setInbox(await Promise.all(wraps.map(wrap => unwrapGiftWrapWithSigner(wrap, nextSession.signer))))
        setOrders(nextOrders)
        console.debug('[marketplace-app] session attached and marketplace data loaded', {
          listingCount: nextListings.length,
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
      if (!restored) setStatus('Ready')
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
      setStatus(timedOut ? 'Bunker reconnect timed out' : 'Bunker reconnect failed')
    } finally {
      setLoading(false)
    }
  }, [attachSession, config.relays])

  const clearSession = useCallback(() => {
    console.debug('[marketplace-app] clearing active marketplace session')
    session?.pool.close(session.relays)
    clearStoredSession()
    setSession(undefined)
    setLoadedMarketplace(undefined)
    setListings([])
    setInbox([])
    setOrders(emptyOrders)
    setError(undefined)
    setSessionError(undefined)
    setStatus('Ready')
  }, [session])

  return {
    state: {
      config,
      route,
      session,
      marketplace: loadedMarketplace,
      listings,
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
