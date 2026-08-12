import type {
  MarketplaceSettlementJournal,
  MarketplaceSettlementJournalRecord,
} from 'nostr-tools/marketplace'

const storageVersion = 1
type StoredJournal = {
  version: 1
  records: MarketplaceSettlementJournalRecord[]
}

export function retainedSettlementRecords(
  records: MarketplaceSettlementJournalRecord[],
  _now = Math.floor(Date.now() / 1000),
): MarketplaceSettlementJournalRecord[] {
  // The signed outbox and action commitments make retries idempotent. Keep
  // them until an operator performs protocol-aware archival.
  return records
}

function storageKey(pubkey: string): string {
  return `marketplace-app:settlement-journal:v1:${pubkey}`
}

export class LocalSettlementJournal implements MarketplaceSettlementJournal {
  constructor(private readonly pubkey: string) {}

  private read(): MarketplaceSettlementJournalRecord[] {
    const key = storageKey(this.pubkey)
    const raw = localStorage.getItem(key)
    if (!raw) return []
    try {
      const stored = JSON.parse(raw) as StoredJournal
      if (stored.version !== storageVersion || !Array.isArray(stored.records)) {
        throw new Error('unsupported settlement journal version')
      }
      return retainedSettlementRecords(stored.records)
    } catch (err) {
      localStorage.removeItem(key)
      console.warn('[marketplace-app] unable to parse settlement journal', err)
      return []
    }
  }

  private write(records: MarketplaceSettlementJournalRecord[]): void {
    const stored: StoredJournal = { version: storageVersion, records }
    localStorage.setItem(storageKey(this.pubkey), JSON.stringify(stored))
  }

  async get(id: string): Promise<MarketplaceSettlementJournalRecord | null> {
    const record = this.read().find(candidate => candidate.id === id)
    return record ? structuredClone(record) : null
  }

  async put(record: MarketplaceSettlementJournalRecord): Promise<void> {
    if (record.version !== 1) throw new Error('Unsupported settlement journal record')
    const records = this.read().filter(candidate => candidate.id !== record.id)
    records.push(structuredClone(record))
    this.write(records)
  }
}
