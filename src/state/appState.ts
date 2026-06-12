import { useCallback, useMemo, useRef, useState } from 'react'
import * as marketplace from 'nostr-tools/marketplace'
import { SimplePool } from 'nostr-tools/pool'
import { createCashuAuctionPolicy, createCashuEscrowPolicy } from '@sudonym-btc/marketplace-cashu'
import { createEvmAuctionPolicy, createEvmEscrowPolicy } from '@sudonym-btc/marketplace-evm'

import { loadAppConfig, type AppConfig } from '../config/appConfig'
import { LocalCashuEscrowStore } from '../cashu/storage'
import { createEvmChainConfigs } from '../evm/config'
import { LocalOperationStore } from '../evm/operationStore'
import { clearStoredSession, isBunkerSessionTimeout, publisher, restoreStoredSession } from '../nostr/session'
import type { AppSession, LoadedMarketplace, MarketplaceLogItem, SessionRestoreError } from '../types'
import { createAppLocationProvider } from '../nostr/locationProvider'

export type AppState = {
  config: AppConfig
  session?: AppSession
  publicMarketplace: ReturnType<typeof marketplace.bind>
  marketplace?: LoadedMarketplace
  refreshRevision: number
  marketplaceLog: MarketplaceLogItem[]
  loading: boolean
  restoringSigner: boolean
  status: string
  error?: string
  sessionError?: SessionRestoreError
}

type AppLoggerContext = {
  scope?: string
  span?: string
  data?: Record<string, unknown>
}

function mergeLogData(
  base?: Record<string, unknown>,
  next?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!base && !next) return undefined
  return {
    ...(base ?? {}),
    ...(next ?? {}),
  }
}

function isPromiseLike<Result>(value: Result): value is Result & PromiseLike<unknown> {
  return Boolean(value && typeof value === 'object' && 'then' in value && typeof value.then === 'function')
}

function asMarketplaceOrderPolicy(policy: unknown): marketplace.MarketplaceOrderPolicy {
  return policy as marketplace.MarketplaceOrderPolicy
}

function asMarketplaceBidPolicy(policy: unknown): marketplace.MarketplaceBidPolicy {
  return policy as marketplace.MarketplaceBidPolicy
}

export function useAppState() {
  const [config] = useState(loadAppConfig)
  const [publicPool] = useState(() => new SimplePool())
  const [session, setSession] = useState<AppSession>()
  const [loadedMarketplace, setLoadedMarketplace] = useState<LoadedMarketplace>()
  const [refreshRevision, setRefreshRevision] = useState(0)
  const [marketplaceLog, setMarketplaceLog] = useState<MarketplaceLogItem[]>([])
  const [loading, setLoading] = useState(false)
  const [restoringSigner, setRestoringSigner] = useState(false)
  const [status, setStatus] = useState('Ready')
  const [error, setError] = useState<string>()
  const [sessionError, setSessionError] = useState<SessionRestoreError>()
  const nextLogId = useRef(0)

  const appendMarketplaceLog = useCallback((
    entry: Omit<MarketplaceLogItem, 'id' | 'at'> & { at?: string | number | Date },
  ) => {
    const at = entry.at instanceof Date
      ? entry.at.toISOString()
      : typeof entry.at === 'number'
        ? new Date(entry.at).toISOString()
        : entry.at ?? new Date().toISOString()
    setMarketplaceLog(current => [
      {
        id: nextLogId.current++,
        at,
        level: entry.level,
        scope: entry.scope || 'marketplace',
        ...(entry.span ? { span: entry.span } : {}),
        message: entry.message,
        ...(entry.data ? { data: entry.data } : {}),
        ...(entry.error ? { error: entry.error } : {}),
      },
      ...current,
    ].slice(0, 300))
  }, [])

  const marketplaceLogger = useMemo<NonNullable<marketplace.MarketplaceRuntimeOptions['logger']>>(() => {
    const createLogger = (context: AppLoggerContext = {}): NonNullable<marketplace.MarketplaceRuntimeOptions['logger']> => {
      const emit = (
        level: MarketplaceLogItem['level'],
        message: string,
        data?: Record<string, unknown>,
        error?: unknown,
      ) => {
        const mergedData = mergeLogData(context.data, data)
        appendMarketplaceLog({
          level,
          scope: context.scope ?? 'marketplace',
          ...(context.span ? { span: context.span } : {}),
          message,
          ...(mergedData ? { data: mergedData } : {}),
          ...(error ? { error } : {}),
        })
      }

      return {
        debug: (message, data, error) => emit('debug', message, data, error),
        info: (message, data, error) => emit('info', message, data, error),
        warn: (message, data, error) => emit('warn', message, data, error),
        error: (message, data, error) => emit('error', message, data, error),
        child: nextContext => createLogger({
          scope: nextContext.scope ?? context.scope,
          span: nextContext.span ?? context.span,
          data: mergeLogData(context.data, nextContext.data),
        }),
        span: (name, data, run) => {
          const spanLogger = createLogger({
            ...context,
            span: name,
            data: mergeLogData(context.data, data),
          })
          spanLogger.debug('Span started')
          try {
            const result = run(spanLogger)
            if (isPromiseLike(result)) {
              return result.then(
                value => {
                  spanLogger.debug('Span completed')
                  return value
                },
                reason => {
                  spanLogger.error('Span failed', undefined, reason)
                  throw reason
                },
              ) as typeof result
            }
            spanLogger.debug('Span completed')
            return result
          } catch (reason) {
            spanLogger.error('Span failed', undefined, reason)
            throw reason
          }
        },
      }
    }

    return createLogger({ scope: 'marketplace.app' })
  }, [appendMarketplaceLog])

  const publicReader = useMemo(
    () => ({ pool: publicPool, relays: config.relays }),
    [config.relays, publicPool],
  )
  const locationProvider = useMemo(() => createAppLocationProvider(), [])
  const publicMarketplace = useMemo(
    () => marketplace.bind(publicReader.pool, publicReader.relays, { logger: marketplaceLogger, locationProvider }),
    [locationProvider, marketplaceLogger, publicReader],
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
            logger: marketplaceLogger,
          })
        : null
      const evmAuctionPolicy = evmChains.length > 0
        ? createEvmAuctionPolicy({
            chains: evmChains,
            operationStore: new LocalOperationStore(),
            appId: 'marketplace',
            logger: marketplaceLogger,
          })
        : null
      const cashuEscrowPolicy = config.cashu.enabled
        ? createCashuEscrowPolicy({
            mints: config.cashu.mints,
            storage: cashuStorage,
            appId: 'marketplace',
            logger: marketplaceLogger,
          })
        : null
      const cashuAuctionPolicy = config.cashu.enabled
        ? createCashuAuctionPolicy({
            mints: config.cashu.mints,
            storage: cashuStorage,
            appId: 'marketplace',
            logger: marketplaceLogger,
          })
        : null
      if (evmEscrowPolicy) orderPolicies.push(asMarketplaceOrderPolicy(evmEscrowPolicy))
      if (evmAuctionPolicy) bidPolicies.push(asMarketplaceBidPolicy(evmAuctionPolicy))
      if (cashuEscrowPolicy) orderPolicies.push(asMarketplaceOrderPolicy(cashuEscrowPolicy))
      if (cashuAuctionPolicy) bidPolicies.push(asMarketplaceBidPolicy(cashuAuctionPolicy))
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
        autoTrustArbiter: config.autoTrustArbiterPubkeys,
        publish: event => pub.publish(event),
        locationProvider,
        logger: marketplaceLogger,
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
    [config, locationProvider, marketplaceLogger],
  )

  const refreshAll = useCallback(async () => {
    setLoading(true)
    setError(undefined)
    try {
      setStatus('Refreshing marketplace data')
      setRefreshRevision(current => current + 1)
      setStatus('Ready')
    } catch (err) {
      console.warn('[marketplace-app] refresh failed', err)
      setError(err instanceof Error ? err.message : 'Refresh failed')
    } finally {
      setLoading(false)
    }
  }, [])

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
        setRefreshRevision(current => current + 1)
        console.debug('[marketplace-app] session attached and marketplace runtime ready', {
          nextTradeIndex: nextMarketplace.nextTradeIndex,
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
    setRestoringSigner(true)
    setError(undefined)
    setSessionError(undefined)
    setStatus('Restoring signer')
    try {
      const restored = await restoreStoredSession(config.relays)
      if (restored) await attachSession(restored)
      else console.debug('[marketplace-app] no restored session found')
      if (!restored) {
        setRefreshRevision(current => current + 1)
        setStatus('Ready')
      }
    } catch (err) {
      const timedOut = isBunkerSessionTimeout(err)
      const message = err instanceof Error ? err.message : 'Saved signer session could not be restored'
      console.warn('[marketplace-app] session restore failed', err)
      setSession(undefined)
      setLoadedMarketplace(undefined)
      setSessionError({
        title: timedOut ? 'Signer reconnect timed out' : 'Signer restore failed',
        message: timedOut
          ? 'Marketplace found a saved signer, but it did not answer in time.'
          : 'Marketplace found a saved signer, but it could not be restored.',
        detail: message,
        timedOut,
      })
      setRefreshRevision(current => current + 1)
      setStatus(timedOut ? 'Signer reconnect timed out' : 'Signer restore failed')
    } finally {
      setLoading(false)
      setRestoringSigner(false)
    }
  }, [attachSession, config.relays])

  const clearSession = useCallback(() => {
    console.debug('[marketplace-app] clearing active marketplace session')
    session?.pool.close(session.relays)
    clearStoredSession()
    setSession(undefined)
    setLoadedMarketplace(undefined)
    setError(undefined)
    setSessionError(undefined)
    setRefreshRevision(current => current + 1)
    setStatus('Ready')
  }, [session])

  const clearMarketplaceLog = useCallback(() => {
    setMarketplaceLog([])
  }, [])

  return {
    state: {
      config,
      session,
      publicMarketplace,
      marketplace: loadedMarketplace,
      refreshRevision,
      marketplaceLog,
      loading,
      restoringSigner,
      status,
      error,
      sessionError,
    },
    publisher: appPublisher,
    actions: {
      attachSession,
      refreshAll,
      restore,
      clearSession,
      setError,
      setStatus,
      markTradeIndexUsed,
      clearMarketplaceLog,
    },
  }
}
