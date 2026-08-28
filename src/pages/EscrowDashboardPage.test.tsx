import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { CodeHintsProvider } from '../codeHints/codeHints'
import type { EscrowDashboardRecord } from '../escrow/types'
import { EscrowDashboardPage } from './EscrowDashboardPage'

function record(overrides: Partial<EscrowDashboardRecord> = {}): EscrowDashboardRecord {
  return {
    id: 'order-1',
    kind: 'order',
    tradeId: 'trade-order-1',
    listingAnchor: 'listing-1',
    stage: 'commit',
    updatedAt: 1_800_000_000,
    actions: [],
    ...overrides,
  }
}

function render(records: EscrowDashboardRecord[]): string {
  return renderToStaticMarkup(
    <CodeHintsProvider>
      <EscrowDashboardPage
        identity="arbiter-pubkey"
        records={records}
        drivers={[]}
        loading={false}
        onRefresh={() => undefined}
        onExecute={() => undefined}
      />
    </CodeHintsProvider>,
  )
}

describe('EscrowDashboardPage', () => {
  test('renders a monitor-only record with its fail-closed action reason', () => {
    const html = render([record({
      actionReason: 'Auction actions require canonical whole-auction settlement context.',
    })])

    expect(html).toContain('data-testid="escrow-record-card"')
    expect(html).toContain('dateTime="2027-01-15T08:00:00.000Z"')
    expect(html).toContain('data-testid="escrow-record-actions"')
    expect(html).toContain('Auction actions require canonical whole-auction settlement context.')
    expect(html).not.toContain('Release to seller')
    expect(html).not.toContain('Refund buyer')
  })

  test('renders an unavailable action disabled with the driver-provided reason', () => {
    const html = render([record({
      actions: [{
        id: 'release',
        label: 'Release to seller',
        enabled: false,
        unavailableReason: 'Driver recovery is still running.',
      }],
    })])

    expect(html).toContain('Release to seller')
    expect(html).toContain('disabled=""')
    expect(html).toContain('title="Driver recovery is still running."')
  })
})
