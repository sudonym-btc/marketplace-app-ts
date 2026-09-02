import * as marketplace from 'nostr-tools/marketplace'
import type {
  MarketplaceEscrowRecord,
  MarketplaceSessionDriverState,
} from 'nostr-tools/marketplace'

import type { LoadedMarketplaceSession } from '../types'
import type { EscrowDashboardAction, EscrowDashboardDriver, EscrowDashboardRecord } from './types'

export type RuntimeEscrowRecord = MarketplaceEscrowRecord

type EscrowRecordWatchCallbacks = {
  onError(error: string): void
  onLoading(loading: boolean): void
  onSnapshot(records: RuntimeEscrowRecord[]): void
}

export function actionLabel(action: RuntimeEscrowRecord['actions'][number]): string {
  if (action === 'release') return 'Release to seller'
  if (action === 'refund') return 'Refund buyer'
  return action
}

export function driverView(driver: MarketplaceSessionDriverState | undefined): EscrowDashboardDriver | undefined {
  if (!driver) return undefined
  return {
    id: driver.id,
    label: driver.label,
    status: driver.status,
    ...(driver.error ? { error: driver.error } : {}),
  }
}

export function recordView(record: RuntimeEscrowRecord): EscrowDashboardRecord {
  const viewDriver = driverView(record.driver)
  return {
    id: record.id,
    kind: record.kind,
    tradeId: record.tradeId,
    listingAnchor: record.listingAnchor,
    ...('auctionAnchor' in record.source && typeof record.source.auctionAnchor === 'string'
      ? { auctionAnchor: record.source.auctionAnchor }
      : {}),
    stage: record.stage,
    updatedAt: record.updatedAt,
    ...(viewDriver ? { driver: viewDriver } : {}),
    ...(record.validation
      ? {
          validation: {
            status: record.validation.status,
            ...(record.validation.error ? { error: record.validation.error } : {}),
          },
        }
      : {}),
    actions: record.actions.map(action => ({
      id: action,
      label: actionLabel(action),
      description: action === 'release'
        ? 'Settle the validated escrow payment to the seller.'
        : 'Return the validated escrow payment to the buyer.',
      enabled: true,
    })),
    ...(record.actionReason ? { actionReason: record.actionReason.message } : {}),
  }
}

export function watchEscrowRecords(
  session: LoadedMarketplaceSession,
  callbacks: EscrowRecordWatchCallbacks,
): () => void {
  callbacks.onLoading(true)
  const stream = session.escrow.records.watch()
  const snapshotSubscription = stream.snapshot.subscribe(snapshot => {
    callbacks.onSnapshot(snapshot)
    callbacks.onLoading(false)
  })
  const statusSubscription = stream.status.subscribe(status => {
    if (status instanceof marketplace.StreamError) {
      callbacks.onError(status.error.message)
      callbacks.onLoading(false)
    }
    if (status instanceof marketplace.StreamEose || status instanceof marketplace.StreamLive) {
      callbacks.onLoading(false)
    }
  })
  return () => {
    snapshotSubscription.unsubscribe()
    statusSubscription.unsubscribe()
    stream.close('escrow dashboard changed')
  }
}

export function watchEscrowDrivers(
  session: LoadedMarketplaceSession,
  onDriver: (driver: EscrowDashboardDriver) => void,
): () => void {
  const subscriptions = session.drivers.all.map(driver => driver.state.subscribe(state => {
    const view = driverView(state)
    if (view) onDriver(view)
  }))
  return () => subscriptions.forEach(subscription => subscription.unsubscribe())
}

export async function executeEscrowDashboardAction(
  session: LoadedMarketplaceSession,
  records: RuntimeEscrowRecord[],
  record: EscrowDashboardRecord,
  action: EscrowDashboardAction,
): Promise<void> {
  const runtimeRecord = records.find(candidate => candidate.id === record.id && candidate.kind === record.kind)
  if (!runtimeRecord) throw new Error('Escrow record is stale; refresh and try again')
  const runtimeAction = runtimeRecord.actions.find(candidate => candidate === action.id)
  if (!runtimeAction) throw new Error('Escrow action is no longer available')
  const states = session.escrow.execute(runtimeRecord, runtimeAction)[Symbol.asyncIterator]()
  for (;;) {
    const next = await states.next()
    if (next.done) return
    const state = next.value
    // Driver and relay progress is reflected by the live escrow record stream.
    // Publication is the terminal UI boundary: stop consuming here even when
    // a driver-backed iterable remains open for reconciliation updates. Use
    // explicit `next()` calls so returning does not await the iterable's
    // long-lived `return()` cleanup path.
    if (state.type === 'settlement_published') return
  }
}
