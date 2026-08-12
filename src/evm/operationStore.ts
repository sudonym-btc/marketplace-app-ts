import type {
  EvmOperationQuery,
  EvmOperationRecord,
  EvmOperationStatus,
  EvmOperationStore,
} from '@sudonym-btc/marketplace-evm'

const storageKey = 'marketplace-app:evm-operations:v2'
const legacyStorageKey = 'marketplace-app:evm-operations'
const storageVersion = 2
const bigintMarker = '__marketplaceAppBigInt'

type StoredOperations = {
  version: 2
  records: EvmOperationRecord[]
}

export function retainedEvmRecords(
  records: EvmOperationRecord[],
  _now = Math.floor(Date.now() / 1000),
): EvmOperationRecord[] {
  // Keep compact tombstones until an explicit, protocol-aware cleanup. A
  // time-based deletion would weaken operation-id replay protection.
  return records
}

function encodeBigInt(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? { [bigintMarker]: value.toString() } : value
}

function decodeBigInt(_key: string, value: unknown): unknown {
  if (
    value &&
    typeof value === 'object' &&
    Object.keys(value).length === 1 &&
    typeof (value as Record<string, unknown>)[bigintMarker] === 'string'
  ) {
    return BigInt((value as Record<string, string>)[bigintMarker])
  }
  return value
}

function parseRecords(): EvmOperationRecord[] {
  const raw = localStorage.getItem(storageKey)
  if (!raw) {
    const legacy = localStorage.getItem(legacyStorageKey)
    if (!legacy) return []
    try {
      const records = retainedEvmRecords(JSON.parse(legacy, decodeBigInt) as EvmOperationRecord[])
      localStorage.removeItem(legacyStorageKey)
      writeRecords(records)
      return records
    } catch (err) {
      localStorage.removeItem(legacyStorageKey)
      console.warn('[marketplace-app] unable to migrate stored EVM operations', err)
      return []
    }
  }
  try {
    const stored = JSON.parse(raw, decodeBigInt) as StoredOperations
    if (stored.version !== storageVersion || !Array.isArray(stored.records)) throw new Error('unsupported storage version')
    return retainedEvmRecords(stored.records)
  } catch (err) {
    console.warn('[marketplace-app] unable to parse stored EVM operations', err)
    localStorage.removeItem(storageKey)
    return []
  }
}

function writeRecords(records: EvmOperationRecord[]): void {
  console.debug('[marketplace-app] writing EVM operation records', { count: records.length })
  const stored: StoredOperations = { version: storageVersion, records: retainedEvmRecords(records) }
  localStorage.setItem(storageKey, JSON.stringify(stored, encodeBigInt))
}

function statusMatches(record: EvmOperationRecord, status?: EvmOperationStatus | EvmOperationStatus[]): boolean {
  if (!status) return true
  return Array.isArray(status) ? status.includes(record.status) : record.status === status
}

function matches(record: EvmOperationRecord, query: EvmOperationQuery = {}): boolean {
  return (
    (!query.kind || query.kind === record.kind) &&
    (!query.chainId || query.chainId === record.chainId) &&
    (!query.tradeId || query.tradeId === record.tradeId) &&
    (!query.swapId || query.swapId === record.swapId) &&
    statusMatches(record, query.status)
  )
}

export class LocalOperationStore implements EvmOperationStore {
  async get(id: string): Promise<EvmOperationRecord | null> {
    const record = parseRecords().find(item => item.id === id) ?? null
    console.debug('[marketplace-app] EVM operation get', { id, found: Boolean(record) })
    return record
  }

  async put(record: EvmOperationRecord): Promise<void> {
    console.debug('[marketplace-app] EVM operation put', {
      id: record.id,
      kind: record.kind,
      status: record.status,
      chainId: record.chainId,
      tradeId: record.tradeId,
      swapId: record.swapId,
    })
    const records = parseRecords()
    const next = records.filter(item => item.id !== record.id)
    next.push(record)
    writeRecords(next)
  }

  async putIfAbsent(record: EvmOperationRecord): Promise<boolean> {
    const records = parseRecords()
    if (records.some(item => item.id === record.id)) return false
    writeRecords([...records, record])
    return true
  }

  async list(query: EvmOperationQuery = {}): Promise<EvmOperationRecord[]> {
    const records = parseRecords().filter(record => matches(record, query))
    console.debug('[marketplace-app] EVM operation list', {
      kind: query.kind,
      chainId: query.chainId,
      tradeId: query.tradeId,
      swapId: query.swapId,
      status: query.status,
      count: records.length,
    })
    return records
  }

  async delete(id: string): Promise<void> {
    console.debug('[marketplace-app] EVM operation delete', { id })
    writeRecords(parseRecords().filter(record => record.id !== id))
  }
}
