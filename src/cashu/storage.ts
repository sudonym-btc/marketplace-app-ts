import type {
  CashuEscrowOperation,
  CashuEscrowOperationQuery,
  CashuEscrowOperationStatus,
  CashuEscrowStorage,
} from '@sudonym-btc/marketplace-cashu'

const storageKey = 'marketplace-app:cashu-operations:v2'
const legacyStorageKey = 'marketplace-app:cashu-operations'
const storageVersion = 2
type StoredOperations = {
  version: 2
  records: CashuEscrowOperation[]
}

export function retainedCashuRecords(
  records: CashuEscrowOperation[],
  _now = Math.floor(Date.now() / 1000),
): CashuEscrowOperation[] {
  // Terminal records are compact idempotency tombstones. Aging them out can
  // turn a late retry into a second financial action, so cleanup must be an
  // explicit protocol-aware operation rather than a wall-clock side effect.
  return records
}

function parseRecords(): CashuEscrowOperation[] {
  // The legacy schema could contain bearer proofs. Delete it rather than
  // attempting a value-preserving migration.
  localStorage.removeItem(legacyStorageKey)
  const raw = localStorage.getItem(storageKey)
  if (!raw) return []
  try {
    const stored = JSON.parse(raw) as StoredOperations
    if (stored.version !== storageVersion || !Array.isArray(stored.records)) throw new Error('unsupported storage version')
    return retainedCashuRecords(stored.records)
  } catch (err) {
    console.warn('[marketplace-app] unable to parse stored Cashu operations', err)
    localStorage.removeItem(storageKey)
    return []
  }
}

function writeRecords(records: CashuEscrowOperation[]): void {
  console.debug('[marketplace-app] writing Cashu operation records', { count: records.length })
  const stored: StoredOperations = { version: storageVersion, records: retainedCashuRecords(records) }
  localStorage.setItem(storageKey, JSON.stringify(stored))
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

  async create(record: CashuEscrowOperation): Promise<boolean> {
    const records = parseRecords()
    if (records.some(item => item.id === record.id)) return false
    writeRecords([...records, record])
    return true
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
