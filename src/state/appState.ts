import { useCallback, useEffect, useMemo, useState } from 'react'
import * as marketplace from 'nostr-tools/marketplace'

import { loadAppConfig, type AppConfig } from '../config/appConfig'
import { createEvmMarketplaceDriver, configuredEscrowBytecodeHash, evmPaymentForms } from '../evm/driver'
import { fetchGiftWraps, fetchListings, fetchOrderBuckets, publishEscrowMethod } from '../nostr/marketplaceApi'
import { getOrCreateMarketplaceSeed } from '../nostr/marketplaceSeed'
import { publisher, restoreBunkerSession } from '../nostr/session'
import type { AppRoute, AppSession, InboxItem, LoadedMarketplace, OrderBucket } from '../types'
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

  useEffect(() => {
    const onHashChange = () => setRoute(routeFromHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const appPublisher = useMemo(() => (session ? publisher(session) : undefined), [session])

  const initializeMarketplace = useCallback(
    async (nextSession: AppSession) => {
      const pub = publisher(nextSession)
      setStatus('Recovering marketplace seed')
      const seed = await getOrCreateMarketplaceSeed(nextSession, pub)
      const drivers = []
      const evmDriver = createEvmMarketplaceDriver(config, seed.seed)
      if (evmDriver) drivers.push(evmDriver)

      const runtime = marketplace.createMarketplace({
        pool: nextSession.pool,
        relays: nextSession.relays,
        seed: seed.seed,
        paymentDrivers: drivers,
      })
      setStatus('Starting marketplace drivers')
      const started = await runtime.start({ unusedWindow: 25 })

      if (config.evm.enabled) {
        setStatus('Publishing EVM escrow method')
        await publishEscrowMethod(nextSession, pub, {
          trustedEscrowPubkey: config.evm.arbiterNostrPubkey || nextSession.pubkey,
          bytecodeHash: configuredEscrowBytecodeHash(config),
          paymentForms: evmPaymentForms(config),
        })
      }

      setLoadedMarketplace({
        seed: seed.seed,
        runtime,
        evm: evmDriver?.state() ?? {
          enabled: false,
          started: false,
          maxUsedIndex: -1,
          nextTradeIndex: started.discovery.nextUnusedIndex,
          sweepSummary: 'EVM disabled',
        },
      })
    },
    [config],
  )

  const refreshListings = useCallback(async () => {
    if (!session) return
    setListings(await fetchListings(session))
  }, [session])

  const refreshInbox = useCallback(async () => {
    if (!session) return
    const wraps = await fetchGiftWraps(session)
    setInbox(await Promise.all(wraps.map(wrap => unwrapGiftWrapWithSigner(wrap, session.signer))))
  }, [session])

  const refreshOrders = useCallback(async () => {
    if (!session) return
    setOrders(await fetchOrderBuckets(session))
  }, [session])

  const refreshAll = useCallback(async () => {
    if (!session) return
    setLoading(true)
    setError(undefined)
    try {
      setStatus('Refreshing marketplace data')
      await Promise.all([refreshListings(), refreshInbox(), refreshOrders()])
      setStatus('Ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed')
    } finally {
      setLoading(false)
    }
  }, [refreshInbox, refreshListings, refreshOrders, session])

  const attachSession = useCallback(
    async (nextSession: AppSession) => {
      setLoading(true)
      setError(undefined)
      try {
        setSession(nextSession)
        await initializeMarketplace(nextSession)
        setStatus('Loading marketplace data')
        const [nextListings, wraps, nextOrders] = await Promise.all([
          fetchListings(nextSession),
          fetchGiftWraps(nextSession),
          fetchOrderBuckets(nextSession),
        ])
        setListings(nextListings)
        setInbox(await Promise.all(wraps.map(wrap => unwrapGiftWrapWithSigner(wrap, nextSession.signer))))
        setOrders(nextOrders)
        setStatus('Ready')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Startup failed')
      } finally {
        setLoading(false)
      }
    },
    [initializeMarketplace],
  )

  const restore = useCallback(async () => {
    setLoading(true)
    try {
      const restored = await restoreBunkerSession(config.relays)
      if (restored) await attachSession(restored)
    } catch {
      setStatus('Ready')
    } finally {
      setLoading(false)
    }
  }, [attachSession, config.relays])

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
    },
    publisher: appPublisher,
    actions: {
      attachSession,
      refreshAll,
      refreshListings,
      refreshInbox,
      refreshOrders,
      restore,
      setError,
      setStatus,
    },
  }
}
