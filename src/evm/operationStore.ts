import type {
  EvmOperationQuery,
  EvmOperationRecord,
  EvmOperationStatus,
  EvmOperationStore,
} from '@sudonym-btc/marketplace-evm'

const storageKey = 'marketplace-app:evm-operations'
const bigintMarker = '__marketplaceAppBigInt'

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
  if (!raw) return []
  try {
    return JSON.parse(raw, decodeBigInt) as EvmOperationRecord[]
  } catch (err) {
    console.warn('[marketplace-app] unable to parse stored EVM operations', err)
    return []
  }
}

function writeRecords(records: EvmOperationRecord[]): void {
  console.debug('[marketplace-app] writing EVM operation records', { count: records.length })
  localStorage.setItem(storageKey, JSON.stringify(records, encodeBigInt))
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
