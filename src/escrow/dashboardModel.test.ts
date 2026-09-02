import { describe, expect, test } from 'bun:test'
import {
  MarketplaceStream,
  ReplayStream,
  type MarketplaceEscrowRecord,
  type MarketplaceSessionDriverState,
} from 'nostr-tools/marketplace'

import type { LoadedMarketplaceSession } from '../types'
import {
  executeEscrowDashboardAction,
  recordView,
  watchEscrowDrivers,
  watchEscrowRecords,
} from './dashboardModel'
import type { EscrowDashboardAction } from './types'

function runtimeRecord(id: string, actions: MarketplaceEscrowRecord['actions'] = []): MarketplaceEscrowRecord {
  return {
    id,
    kind: 'order',
    tradeId: `trade-${id}`,
    listingAnchor: `listing-${id}`,
    stage: 'commit',
    updatedAt: 1_800_000_000,
    source: {},
    actions,
  } as unknown as MarketplaceEscrowRecord
}

function fakeSession(options: {
  drivers?: LoadedMarketplaceSession['drivers']['all']
  execute?: LoadedMarketplaceSession['escrow']['execute']
  stream?: MarketplaceStream<MarketplaceEscrowRecord, MarketplaceEscrowRecord[]>
} = {}): LoadedMarketplaceSession {
  const stream = options.stream ?? new MarketplaceStream<MarketplaceEscrowRecord, MarketplaceEscrowRecord[]>()
  return {
    drivers: { all: options.drivers ?? [] },
    escrow: {
      records: {
        list: async () => stream.currentSnapshot ?? [],
        watch: () => stream,
      },
      execute: options.execute ?? (async function* () {}),
    },
  } as unknown as LoadedMarketplaceSession
}

describe('escrow dashboard model', () => {
  test('isolates live record updates to the active marketplace session and closes the old stream', () => {
    let closedA: string | undefined
    const streamA = new MarketplaceStream<MarketplaceEscrowRecord, MarketplaceEscrowRecord[]>({
      onClose: reason => { closedA = reason },
    })
    const streamB = new MarketplaceStream<MarketplaceEscrowRecord, MarketplaceEscrowRecord[]>()
    const snapshots: string[][] = []
    const loading: boolean[] = []
    const errors: string[] = []
    const callbacks = {
      onError: (error: string) => errors.push(error),
      onLoading: (value: boolean) => loading.push(value),
      onSnapshot: (records: MarketplaceEscrowRecord[]) => snapshots.push(records.map(record => record.id)),
    }

    const stopA = watchEscrowRecords(fakeSession({ stream: streamA }), callbacks)
    streamA.emitSnapshot([runtimeRecord('session-a')])
    streamA.fail(new Error('relay unavailable'), { at: 1_800_000_001 })
    expect(snapshots).toEqual([['session-a']])
    expect(errors).toEqual(['relay unavailable'])
    expect(loading.at(-1)).toBe(false)

    stopA()
    streamA.emitSnapshot([runtimeRecord('stale-session-a')])
    expect(closedA).toBe('escrow dashboard changed')
    expect(snapshots).toEqual([['session-a']])

    const stopB = watchEscrowRecords(fakeSession({ stream: streamB }), callbacks)
    streamB.emitSnapshot([runtimeRecord('session-b')])
    expect(snapshots).toEqual([['session-a'], ['session-b']])
    stopB()
  })

  test('replays live driver state, forwards updates, and unsubscribes cleanly', () => {
    const state = new ReplayStream<MarketplaceSessionDriverState>({ replayLimit: 1 })
    const starting: MarketplaceSessionDriverState = {
      id: 'evm-order',
      label: 'EVM order escrow',
      kind: 'order',
      status: 'starting',
      updatedAt: 1_800_000_000,
    }
    state.next(starting)
    const drivers = [{
      id: starting.id,
      label: starting.label,
      kind: starting.kind,
      state,
    }] as unknown as LoadedMarketplaceSession['drivers']['all']
    const observed: string[] = []

    const stop = watchEscrowDrivers(fakeSession({ drivers }), driver => observed.push(driver.status))
    state.next({ ...starting, status: 'ready', updatedAt: 1_800_000_001 })
    expect(observed).toEqual(['starting', 'ready'])

    stop()
    state.next({ ...starting, status: 'error', updatedAt: 1_800_000_002, error: 'late update' })
    expect(observed).toEqual(['starting', 'ready'])
  })

  test('rejects stale or withdrawn actions before delegating and executes a current action exactly once', async () => {
    const current = runtimeRecord('current', ['release'])
    const calls: Array<{ record: MarketplaceEscrowRecord; action: string }> = []
    const execute = (async function* (record, action) {
      calls.push({ record, action })
      yield { type: 'complete', at: 1_800_000_001 }
    }) as LoadedMarketplaceSession['escrow']['execute']
    const session = fakeSession({ execute })
    const release = recordView(current).actions[0]

    await expect(executeEscrowDashboardAction(
      session,
      [current],
      recordView(runtimeRecord('missing', ['release'])),
      release,
    )).rejects.toThrow('Escrow record is stale')

    const refund: EscrowDashboardAction = { id: 'refund', label: 'Refund buyer', enabled: true }
    await expect(executeEscrowDashboardAction(session, [current], recordView(current), refund))
      .rejects.toThrow('Escrow action is no longer available')
    expect(calls).toHaveLength(0)

    await executeEscrowDashboardAction(session, [current], recordView(current), release)
    expect(calls).toEqual([{ record: current, action: 'release' }])
  })

  test('returns at terminal settlement publication without waiting for later driver states', async () => {
    const current = runtimeRecord('published', ['release'])
    const execute = (async function* () {
      yield { type: 'progress', status: 'settling' }
      yield { type: 'settlement_published', event: { id: 'settlement-event' } }
      throw new Error('terminal stream was consumed too far')
    }) as LoadedMarketplaceSession['escrow']['execute']

    await expect(executeEscrowDashboardAction(
      fakeSession({ execute }),
      [current],
      recordView(current),
      recordView(current).actions[0],
    )).resolves.toBeUndefined()
  })

  test('maps unavailable runtime records without inventing dashboard actions', () => {
    const record = {
      ...runtimeRecord('monitor-only'),
      actionReason: {
        code: 'auction_requires_settlement_context',
        message: 'Whole-auction settlement context is required.',
      },
    } as MarketplaceEscrowRecord

    expect(recordView(record)).toMatchObject({
      id: 'monitor-only',
      actions: [],
      actionReason: 'Whole-auction settlement context is required.',
    })
  })
})
