import type {
  EvmOperationQuery,
  EvmOperationRecord,
  EvmOperationStatus,
  EvmOperationStore,
} from '@sudonym-btc/marketplace-evm'

const storageKey = 'marketplace-app:evm-operations'

function parseRecords(): EvmOperationRecord[] {
  const raw = localStorage.getItem(storageKey)
  if (!raw) return []
  try {
    return JSON.parse(raw) as EvmOperationRecord[]
  } catch {
    return []
  }
}

function writeRecords(records: EvmOperationRecord[]): void {
  localStorage.setItem(storageKey, JSON.stringify(records))
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
    return parseRecords().find(record => record.id === id) ?? null
  }

  async put(record: EvmOperationRecord): Promise<void> {
    const records = parseRecords()
    const next = records.filter(item => item.id !== record.id)
    next.push(record)
    writeRecords(next)
  }

  async list(query: EvmOperationQuery = {}): Promise<EvmOperationRecord[]> {
    return parseRecords().filter(record => matches(record, query))
  }

  async delete(id: string): Promise<void> {
    writeRecords(parseRecords().filter(record => record.id !== id))
  }
}
