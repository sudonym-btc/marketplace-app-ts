import type {
  CashuEscrowOperation,
  CashuEscrowOperationQuery,
  CashuEscrowOperationStatus,
  CashuEscrowStorage,
} from '@sudonym-btc/marketplace-cashu'

const storageKey = 'marketplace-app:cashu-operations'

function parseRecords(): CashuEscrowOperation[] {
  const raw = localStorage.getItem(storageKey)
  if (!raw) return []
  try {
    return JSON.parse(raw) as CashuEscrowOperation[]
  } catch (err) {
    console.warn('[marketplace-app] unable to parse stored Cashu operations', err)
    return []
  }
}

function writeRecords(records: CashuEscrowOperation[]): void {
  console.debug('[marketplace-app] writing Cashu operation records', { count: records.length })
  localStorage.setItem(storageKey, JSON.stringify(records))
}

function statusMatches(record: CashuEscrowOperation, status?: CashuEscrowOperationStatus | CashuEscrowOperationStatus[]): boolean {
  if (!status) return true
  return Array.isArray(status) ? status.includes(record.status) : record.status === status
}

function matches(record: CashuEscrowOperation, query: CashuEscrowOperationQuery = {}): boolean {
  return (
    statusMatches(record, query.status) &&
    (!query.tradeId || query.tradeId === record.tradeId) &&
    (!query.settlementId || query.settlementId === record.settlementId) &&
    (!query.quoteId || query.quoteId === record.quoteId) &&
    (!query.mintUrl || query.mintUrl === record.mintUrl)
  )
}

export class LocalCashuEscrowStore implements CashuEscrowStorage {
  async get(id: string): Promise<CashuEscrowOperation | null> {
    const record = parseRecords().find(item => item.id === id) ?? null
    console.debug('[marketplace-app] Cashu operation get', { id, found: Boolean(record) })
    return record
  }

  async put(record: CashuEscrowOperation): Promise<void> {
    console.debug('[marketplace-app] Cashu operation put', {
      id: record.id,
      kind: record.kind,
      status: record.status,
      tradeId: record.tradeId,
      settlementId: record.settlementId,
      mintUrl: record.mintUrl,
      quoteId: record.quoteId,
    })
    const records = parseRecords()
    const next = records.filter(item => item.id !== record.id)
    next.push(record)
    writeRecords(next)
  }

  async list(query: CashuEscrowOperationQuery = {}): Promise<CashuEscrowOperation[]> {
    const records = parseRecords().filter(record => matches(record, query))
    console.debug('[marketplace-app] Cashu operation list', {
      status: query.status,
      tradeId: query.tradeId,
      settlementId: query.settlementId,
      quoteId: query.quoteId,
      mintUrl: query.mintUrl,
      count: records.length,
    })
    return records
  }

  async delete(id: string): Promise<void> {
    console.debug('[marketplace-app] Cashu operation delete', { id })
    writeRecords(parseRecords().filter(record => record.id !== id))
  }
}
