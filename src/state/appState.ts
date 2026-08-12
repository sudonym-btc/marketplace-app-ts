import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as marketplace from 'nostr-tools/marketplace'
import { SimplePool } from 'nostr-tools/pool'
import { createCashuAuctionPolicy, createCashuEscrowPolicy } from '@sudonym-btc/marketplace-cashu'
import { createEvmAuctionPolicy, createEvmEscrowPolicy } from '@sudonym-btc/marketplace-evm'

import { loadAppConfig, type AppConfig } from '../config/appConfig'
import { LocalCashuEscrowStore } from '../cashu/storage'
import { createEvmChainConfigs } from '../evm/config'
import { LocalOperationStore } from '../evm/operationStore'
import { createLnurlPayInvoice } from '../lightning/lnurl'
import { clearStoredSession, isBunkerSessionTimeout, publisher, restoreStoredSession } from '../nostr/session'
import { LocalSettlementJournal } from '../nostr/settlementJournal'
import { fetchProfiles } from '../nostr/profiles'
import type { AppNotification, AppSession, LoadedMarketplaceSession, MarketplaceClient, MarketplaceLogItem, SessionRestoreError } from '../types'
import { createAppLocationProvider } from '../nostr/locationProvider'

export type AppState = {
  config: AppConfig
  session?: AppSession
  marketplace: MarketplaceClient
  marketplaceSession?: LoadedMarketplaceSession
  refreshRevision: number
  marketplaceLog: MarketplaceLogItem[]
  notifications: AppNotification[]
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

function dataString(data: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = data?.[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function dataNumber(data: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = data?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function sweepAmountSats(record: marketplace.MarketplacePaymentSweepRecord): number | undefined {
  const data = record.latest?.data
  const direct = dataNumber(data, 'amountSats')
  if (direct !== undefined) return direct
  const sweeps = data?.sweeps
  if (!Array.isArray(sweeps)) return undefined
  return sweeps.reduce<number | undefined>((total, sweep) => {
    if (!sweep || typeof sweep !== 'object') return total
    const amount = dataNumber(sweep as Record<string, unknown>, 'amountSats')
    if (amount === undefined) return total
    return (total ?? 0) + amount
  }, undefined)
}

function formatSats(amountSats: number | undefined): string | undefined {
  if (amountSats === undefined) return undefined
  return `${new Intl.NumberFormat().format(amountSats)} sats`
}

function paymentSweepNotification(
  record: marketplace.MarketplacePaymentSweepRecord,
): Omit<AppNotification, 'id' | 'at'> | undefined {
  const driver = record.driver ? record.driver.toUpperCase() : 'Marketplace'
  const tradeId = record.tradeId ? ` for ${record.tradeId}` : ''
  if (record.status === 'swept') {
    const amount = formatSats(sweepAmountSats(record))
    return {
      level: 'info',
      title: 'Withdrawal submitted',
      message: amount
        ? `${driver} payout${tradeId} is being swapped out to your Lightning address (${amount}).`
        : `${driver} payout${tradeId} is being swapped out to your Lightning address.`,
    }
  }
  if (record.status === 'failed') {
    return {
      level: 'error',
      title: 'Withdrawal failed',
      message: record.error ?? `${driver} payout${tradeId} could not be swept.`,
    }
  }
  if (record.status !== 'noop') return undefined

  const reason = dataString(record.latest?.data, 'reason') ?? record.error
  if (!reason) return undefined
  if (/no local .* beneficiary|no .* balances? .*sweepable|cannot sweep .*driver|has no payment sweep hook/i.test(reason)) {
    return undefined
  }
  const isActionable = record.reason === 'settlement' || /invoice|unable|cannot|requires|not configured|failed/i.test(reason)
  if (!isActionable) return undefined
  const isError = /invoice|unable|cannot|requires|not configured|failed/i.test(reason)
  return {
    level: isError ? 'error' : 'info',
    title: isError ? 'Withdrawal could not be started' : 'No withdrawal available',
    message: `${driver} payout${tradeId}: ${reason}.`,
  }
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

export function useAppState() {
  const [config] = useState(loadAppConfig)
  const [publicPool] = useState(() => new SimplePool())
  const [session, setSession] = useState<AppSession>()
  const [signedMarketplace, setSignedMarketplace] = useState<MarketplaceClient>()
  const [marketplaceSession, setMarketplaceSession] = useState<LoadedMarketplaceSession>()
  const [paymentSweeps, setPaymentSweeps] = useState<marketplace.MarketplaceMePaymentsStream>()
  const [refreshRevision, setRefreshRevision] = useState(0)
  const [marketplaceLog, setMarketplaceLog] = useState<MarketplaceLogItem[]>([])
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [loading, setLoading] = useState(false)
  const [restoringSigner, setRestoringSigner] = useState(false)
  const [status, setStatus] = useState('Ready')
  const [error, setError] = useState<string>()
  const [sessionError, setSessionError] = useState<SessionRestoreError>()
  const nextLogId = useRef(0)
  const nextNotificationId = useRef(0)
  const notifiedPaymentSweeps = useRef(new Set<string>())

  const notify = useCallback((notification: Omit<AppNotification, 'id' | 'at'> & { at?: string | number | Date }) => {
    const at = notification.at instanceof Date
      ? notification.at.toISOString()
      : typeof notification.at === 'number'
        ? new Date(notification.at).toISOString()
        : notification.at ?? new Date().toISOString()
    setNotifications(current => [
      {
        id: nextNotificationId.current++,
        at,
        level: notification.level,
        title: notification.title,
        ...(notification.message ? { message: notification.message } : {}),
      },
      ...current,
    ].slice(0, 8))
  }, [])

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

  useEffect(() => {
    notifiedPaymentSweeps.current.clear()
    if (!paymentSweeps) return undefined
    const subscription = paymentSweeps.snapshot.subscribe(snapshot => {
      for (const record of snapshot.all) {
        const notification = paymentSweepNotification(record)
        if (!notification) continue
        const key = `${record.paymentId}:${record.status}:${record.attempts}`
        if (notifiedPaymentSweeps.current.has(key)) continue
        notifiedPaymentSweeps.current.add(key)
        notify(notification)
      }
    })
    return () => subscription.unsubscribe()
  }, [paymentSweeps, notify])

  const publicReader = useMemo(
    () => ({ pool: publicPool, relays: config.relays }),
    [config.relays, publicPool],
  )
  const locationProvider = useMemo(() => createAppLocationProvider(), [])
  const defaultMarketplace = useMemo(
    () => marketplace.bind(publicReader.pool, publicReader.relays, { logger: marketplaceLogger, locationProvider }),
    [locationProvider, marketplaceLogger, publicReader],
  )
  const activeMarketplace = signedMarketplace ?? defaultMarketplace
  const appPublisher = useMemo(() => (session ? publisher(session) : undefined), [session])

  const initializeMarketplace = useCallback(
    async (nextSession: AppSession): Promise<LoadedMarketplaceSession> => {
      console.debug('[marketplace-app] initializing marketplace runtime', {
        pubkey: nextSession.pubkey,
        relayCount: nextSession.relays.length,
      })
      const pub = publisher(nextSession)
      const orderDrivers: marketplace.MarketplaceOrderDriver[] = []
      const auctionDrivers: marketplace.MarketplaceAuctionDriver[] = []
      const evmChains = createEvmChainConfigs(config)
      if (config.evm.enabled && config.evm.boltzSwapUnavailableReason) {
        console.warn('[marketplace-app] EVM swap routes disabled', {
          reason: config.evm.boltzSwapUnavailableReason,
        })
        notify({
          level: 'info',
          title: 'Lightning-to-EVM swaps unavailable',
          message: config.evm.boltzSwapUnavailableReason,
        })
      }
      const cashuStorage = new LocalCashuEscrowStore()
      const createWithdrawalInvoice = async (amountSats: number, description?: string): Promise<string> => {
        try {
          const profiles = await fetchProfiles(nextSession, [nextSession.pubkey])
          const profile = profiles.get(nextSession.pubkey)
          if (!profile?.lud16) throw new Error('Your Nostr profile does not have a lud16 Lightning address')
          return await createLnurlPayInvoice(profile.lud16, amountSats, description)
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unable to create payout invoice'
          notify({
            level: 'error',
            title: 'Unable to create payout invoice',
            message,
          })
          throw err
        }
      }
      const evmEscrowPolicy = evmChains.length > 0
        ? createEvmEscrowPolicy({
            chains: evmChains,
            operationStore: new LocalOperationStore(),
            withdrawals: { createInvoice: createWithdrawalInvoice },
            appId: 'marketplace',
            logger: marketplaceLogger,
          })
        : null
      const evmAuctionPolicy = evmChains.length > 0
        ? createEvmAuctionPolicy({
            chains: evmChains,
            operationStore: new LocalOperationStore(),
            withdrawals: { createInvoice: createWithdrawalInvoice },
            appId: 'marketplace',
            logger: marketplaceLogger,
          })
        : null
      const cashuEscrowPolicy = config.cashu.enabled
        ? createCashuEscrowPolicy({
            mints: config.cashu.mints,
            storage: cashuStorage,
            withdrawals: { createInvoice: createWithdrawalInvoice },
            appId: 'marketplace',
            logger: marketplaceLogger,
          })
        : null
      const cashuAuctionPolicy = config.cashu.enabled
        ? createCashuAuctionPolicy({
            mints: config.cashu.mints,
            storage: cashuStorage,
            withdrawals: { createInvoice: createWithdrawalInvoice },
            appId: 'marketplace',
            logger: marketplaceLogger,
          })
        : null
      if (evmEscrowPolicy) orderDrivers.push(evmEscrowPolicy)
      if (evmAuctionPolicy) auctionDrivers.push(evmAuctionPolicy)
      if (cashuEscrowPolicy) orderDrivers.push(cashuEscrowPolicy)
      if (cashuAuctionPolicy) auctionDrivers.push(cashuAuctionPolicy)
      console.debug('[marketplace-app] marketplace payment policies configured', {
        orderDriverCount: orderDrivers.length,
        auctionDriverCount: auctionDrivers.length,
        evmEnabled: Boolean(evmEscrowPolicy || evmAuctionPolicy),
        evmChainCount: evmChains.length,
        cashuEnabled: Boolean(cashuEscrowPolicy || cashuAuctionPolicy),
        cashuMintCount: config.cashu.mints.length,
      })

      setStatus('Initializing marketplace runtime')
      const boundMarketplace = marketplace.bind(nextSession.pool, nextSession.relays, {
        logger: marketplaceLogger,
        locationProvider,
      })
      const runtime = await boundMarketplace.session(nextSession.signer, {
        pubkey: nextSession.pubkey,
        orderDrivers,
        auctionDrivers,
        settlementJournal: new LocalSettlementJournal(nextSession.pubkey),
        autoTrustArbiter: config.autoTrustArbiterPubkeys,
        publish: event => pub.publish(event),
      })
      console.debug('[marketplace-app] marketplace runtime initialized', {
        seedCreated: runtime.seed.created,
        seedEventId: runtime.seed.event?.id,
      })
      setStatus('Starting marketplace policies')
      const started = await runtime.start()
      console.debug('[marketplace-app] marketplace runtime started', {
        nextUnusedIndex: started.discovery.nextUnusedIndex,
        maxUsedIndex: started.discovery.maxUsedIndex,
        converged: started.discovery.converged,
        policyResultCount: started.policyResults.length,
        policyCount: started.policies.length,
        assetCount: started.assets.length,
      })

      setSignedMarketplace(boundMarketplace)
      const nextPaymentSweeps = runtime.me.payments.watch()
      setPaymentSweeps(current => {
        current?.close('session replaced')
        return nextPaymentSweeps
      })
      setMarketplaceSession(runtime)
      console.debug('[marketplace-app] marketplace initialization complete', {
        nextTradeIndex: runtime.nextTradeIndex.value ?? started.discovery.nextUnusedIndex,
        paymentSweepStatus: nextPaymentSweeps.status.latest?.constructor.name,
      })
      return runtime
    },
    [config, locationProvider, marketplaceLogger, notify],
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
          nextTradeIndex: nextMarketplace.nextTradeIndex.value,
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
      setSignedMarketplace(undefined)
      setMarketplaceSession(undefined)
      setPaymentSweeps(current => {
        current?.close('session restore failed')
        return undefined
      })
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
    paymentSweeps?.close('session cleared')
    session?.pool.close(session.relays)
    clearStoredSession()
    setSession(undefined)
    setSignedMarketplace(undefined)
    setMarketplaceSession(undefined)
    setPaymentSweeps(undefined)
    setError(undefined)
    setSessionError(undefined)
    setRefreshRevision(current => current + 1)
    setStatus('Ready')
  }, [paymentSweeps, session])

  const clearMarketplaceLog = useCallback(() => {
    setMarketplaceLog([])
  }, [])

  const dismissNotification = useCallback((id: number) => {
    setNotifications(current => current.filter(notification => notification.id !== id))
  }, [])

  return {
    state: {
      config,
      session,
      marketplace: activeMarketplace,
      marketplaceSession,
      refreshRevision,
      marketplaceLog,
      notifications,
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
      clearMarketplaceLog,
      notify,
      dismissNotification,
    },
  }
}
