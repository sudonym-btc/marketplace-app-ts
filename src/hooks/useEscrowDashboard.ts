import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  executeEscrowDashboardAction,
  recordView,
  watchEscrowDrivers,
  watchEscrowRecords,
  type RuntimeEscrowRecord,
} from '../escrow/dashboardModel'
import type { EscrowDashboardAction, EscrowDashboardDriver, EscrowDashboardRecord } from '../escrow/types'
import type { LoadedMarketplaceSession } from '../types'

export function useEscrowDashboard(
  marketplaceSession: LoadedMarketplaceSession | undefined,
  refreshRevision: number,
) {
  const [records, setRecords] = useState<RuntimeEscrowRecord[]>([])
  const [driverStates, setDriverStates] = useState<Record<string, EscrowDashboardDriver>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [executing, setExecuting] = useState<string>()

  const refresh = useCallback(async () => {
    if (!marketplaceSession) {
      setRecords([])
      return
    }
    setLoading(true)
    setError(undefined)
    try {
      setRecords(await marketplaceSession.escrow.records.list())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load escrow records')
    } finally {
      setLoading(false)
    }
  }, [marketplaceSession])

  useEffect(() => {
    if (!marketplaceSession) {
      setRecords([])
      setLoading(false)
      return undefined
    }

    setError(undefined)
    return watchEscrowRecords(marketplaceSession, {
      onError: setError,
      onLoading: setLoading,
      onSnapshot: snapshot => {
        setRecords(snapshot)
        setError(undefined)
      },
    })
  }, [marketplaceSession, refreshRevision])

  useEffect(() => {
    if (!marketplaceSession) {
      setDriverStates({})
      return undefined
    }
    return watchEscrowDrivers(marketplaceSession, driver => {
      setDriverStates(current => ({
        ...current,
        [driver.id]: driver,
      }))
    })
  }, [marketplaceSession])

  const execute = useCallback(async (
    record: EscrowDashboardRecord,
    action: EscrowDashboardAction,
  ) => {
    if (!marketplaceSession) throw new Error('Marketplace session is not ready')
    const key = `${record.id}:${action.id}`
    setExecuting(key)
    setError(undefined)
    try {
      await executeEscrowDashboardAction(marketplaceSession, records, record, action)
      await refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Escrow action failed'
      setError(message)
      throw err
    } finally {
      setExecuting(undefined)
    }
  }, [marketplaceSession, records, refresh])

  const views = useMemo(() => records.map(recordView), [records])
  const drivers = useMemo(() => {
    if (!marketplaceSession) return []
    return marketplaceSession.drivers.all.map(driver => driverStates[driver.id] ?? {
      id: driver.id,
      label: driver.label,
      status: driver.state.value?.status ?? 'idle',
      ...(driver.state.value?.error ? { error: driver.state.value.error } : {}),
    })
  }, [driverStates, marketplaceSession])

  return { records: views, drivers, loading, error, executing, refresh, execute }
}
