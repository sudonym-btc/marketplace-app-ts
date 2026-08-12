import { describe, expect, test } from 'bun:test'

import { retainedCashuRecords } from '../cashu/storage'
import { retainedEvmRecords } from '../evm/operationStore'
import { retainedSettlementRecords } from '../nostr/settlementJournal'

const now = 1_800_000_000
const recent = now - 60
const expired = now - 31 * 24 * 60 * 60

describe('durable operation retention', () => {
  test('does not age out Cashu idempotency tombstones', () => {
    const base = {
      kind: 'cashu_escrow_mint' as const,
      tradeId: 'trade',
      settlementId: 'settlement',
      accountIndex: 0,
      mintUrl: 'https://mint.example',
      unit: 'sat',
      data: {} as never,
      createdAt: expired,
    }
    const records = retainedCashuRecords([
      { ...base, id: 'recent', status: 'completed', updatedAt: recent },
      { ...base, id: 'expired', status: 'completed', updatedAt: expired },
      { ...base, id: 'active', status: 'payment_required', updatedAt: expired },
    ], now)
    expect(records.map(record => record.id)).toEqual(['recent', 'expired', 'active'])
  })

  test('does not age out EVM idempotency tombstones', () => {
    const records = retainedEvmRecords([
      { id: 'recent', kind: 'escrow', status: 'completed', chainId: 1, data: {}, createdAt: expired, updatedAt: recent },
      { id: 'expired', kind: 'escrow', status: 'failed', chainId: 1, data: {}, createdAt: expired, updatedAt: expired },
      { id: 'active', kind: 'escrow', status: 'settling', chainId: 1, data: {}, createdAt: expired, updatedAt: expired },
    ], now)
    expect(records.map(record => record.id)).toEqual(['recent', 'expired', 'active'])
  })

  test('does not age out signed settlement outboxes', () => {
    const base = { version: 1 as const, auctionAnchor: '30421:pubkey:auction', actions: {}, outbox: {} }
    const records = retainedSettlementRecords([
      { ...base, id: 'recent', status: 'completed', updatedAt: recent },
      { ...base, id: 'expired', status: 'completed', updatedAt: expired },
      { ...base, id: 'active', status: 'publishing', updatedAt: expired },
    ], now)
    expect(records.map(record => record.id)).toEqual(['recent', 'expired', 'active'])
  })
})
