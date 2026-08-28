import { useState } from 'react'
import { RefreshCw } from 'lucide-react'

import { CodeHint } from '../codeHints/codeHints'
import { EmptyState } from '../components/EmptyState'
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui'
import { Page, PageHeader } from '../components/widgets/PageLayout'
import type { EscrowDashboardAction, EscrowDashboardDriver, EscrowDashboardRecord } from '../escrow/types'
import { shortPubkey } from '../nostr/inboxThreads'

type Props = {
  identity: string
  records: EscrowDashboardRecord[]
  drivers: EscrowDashboardDriver[]
  loading: boolean
  error?: string
  executing?: string
  onRefresh(): void | Promise<void>
  onExecute(record: EscrowDashboardRecord, action: EscrowDashboardAction): void | Promise<void>
}

const codeHint = [
  "const stream = session.escrow.records.watch()",
  "for await (const state of session.escrow.execute(record, action)) { /* render */ }",
]

function readable(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase())
}

function statusVariant(status: string): 'default' | 'secondary' | 'outline' | 'destructive' {
  if (status === 'invalid' || status === 'error' || status === 'rejected') return 'destructive'
  if (status === 'valid' || status === 'ready' || status === 'accepted' || status === 'settled') return 'default'
  if (status === 'pending' || status === 'recovering' || status === 'starting') return 'secondary'
  return 'outline'
}

function DriverSummary({ drivers }: { drivers: EscrowDashboardDriver[] }) {
  if (drivers.length === 0) {
    return (
      <Card className="p-4 shadow-none">
        <CardTitle>No escrow drivers configured</CardTitle>
        <CardDescription>Records remain visible, but no financial action can be offered without a matching driver.</CardDescription>
      </Card>
    )
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="escrow-driver-status">
      {drivers.map(driver => (
        <Card className="p-4 shadow-none" key={driver.id}>
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="truncate">{driver.label}</CardTitle>
              <CardDescription className="mt-1 truncate">{driver.id}</CardDescription>
            </div>
            <Badge variant={statusVariant(driver.status)}>{readable(driver.status)}</Badge>
          </div>
          {driver.error && <p className="m-0 text-xs text-destructive">{driver.error}</p>}
        </Card>
      ))}
    </div>
  )
}

function RecordActions({
  record,
  executing,
  onExecute,
}: {
  record: EscrowDashboardRecord
  executing?: string
  onExecute: Props['onExecute']
}) {
  return (
    <div className="grid w-full gap-2" data-testid="escrow-record-actions">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Available actions</strong>
        <span className="text-xs text-muted-foreground">Revalidated by the driver before execution</span>
      </div>
      {record.actions.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {record.actions.map(action => {
            const actionKey = `${record.id}:${action.id}`
            const busy = executing === actionKey
            return (
              <Button
                disabled={!action.enabled || Boolean(executing)}
                key={action.id}
                onClick={() => void Promise.resolve(onExecute(record, action))}
                title={action.unavailableReason ?? action.description}
                variant={action.id === 'refund' ? 'destructive' : 'secondary'}
              >
                {busy ? 'Working…' : action.label}
              </Button>
            )
          })}
        </div>
      ) : (
        <p className="m-0 text-sm text-muted-foreground">
          {record.actionReason ?? 'No executable driver action is currently safe. This record will update automatically when its payment, validation, or settlement state changes.'}
        </p>
      )}
    </div>
  )
}

function RecordCard({
  record,
  executing,
  onExecute,
}: {
  record: EscrowDashboardRecord
  executing?: string
  onExecute: Props['onExecute']
}) {
  const kindLabel = record.kind === 'order' ? 'Order' : 'Auction bid'
  const updatedAt = new Date(record.updatedAt * 1000)
  return (
    <Card data-testid="escrow-record-card" className="shadow-none">
      <CardHeader>
        <CardTitle>{kindLabel} · {shortPubkey(record.tradeId)}</CardTitle>
        <CardDescription>
          Listing {shortPubkey(record.listingAnchor)}
          {record.auctionAnchor ? ` · Auction ${shortPubkey(record.auctionAnchor)}` : ''}
        </CardDescription>
        <CardAction>
          <Badge variant={statusVariant(record.stage)}>{readable(record.stage)}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-1">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">Driver</span>
          <span className="text-sm font-medium">{record.driver?.label ?? 'No matching driver'}</span>
          {record.driver && <span className="text-xs text-muted-foreground">{readable(record.driver.status)}</span>}
        </div>
        <div className="grid gap-1">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">Validation</span>
          <span className="text-sm font-medium">{record.validation ? readable(record.validation.status) : 'Not available'}</span>
          {record.validation?.error && <span className="text-xs text-destructive">{record.validation.error}</span>}
        </div>
        <div className="grid gap-1">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">Updated</span>
          <time className="text-sm font-medium" dateTime={updatedAt.toISOString()}>{updatedAt.toLocaleString()}</time>
        </div>
      </CardContent>
      <CardFooter>
        <RecordActions record={record} executing={executing} onExecute={onExecute} />
      </CardFooter>
    </Card>
  )
}

export function EscrowDashboardPage({
  identity,
  records,
  drivers,
  loading,
  error,
  executing,
  onRefresh,
  onExecute,
}: Props) {
  const [pending, setPending] = useState<{ record: EscrowDashboardRecord; action: EscrowDashboardAction }>()
  const [confirming, setConfirming] = useState(false)
  const actionable = records.filter(record => record.actions.some(action => action.enabled)).length

  async function confirmAction(): Promise<void> {
    if (!pending || confirming) return
    setConfirming(true)
    try {
      await onExecute(pending.record, pending.action)
    } finally {
      setConfirming(false)
      setPending(undefined)
    }
  }

  return (
    <Page>
      <PageHeader
        eyebrow="Arbiter"
        title="Escrow dashboard"
        actions={(
          <Button disabled={loading} onClick={() => void Promise.resolve(onRefresh())} variant="outline">
            <RefreshCw className={loading ? 'animate-spin' : undefined} />
            Refresh
          </Button>
        )}
      />
      <p className="m-0 max-w-3xl text-sm leading-6 text-muted-foreground">
        Monitoring orders and auction bids where <strong className="font-mono text-foreground">{shortPubkey(identity)}</strong>
        {' '}is the selected escrow arbiter. Record state and action availability come from the matching payment driver.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4 shadow-none"><CardTitle>{records.length}</CardTitle><CardDescription>Escrow records</CardDescription></Card>
        <Card className="p-4 shadow-none"><CardTitle>{actionable}</CardTitle><CardDescription>Actionable now</CardDescription></Card>
        <Card className="p-4 shadow-none"><CardTitle>{drivers.filter(driver => driver.status === 'ready').length}/{drivers.length}</CardTitle><CardDescription>Drivers ready</CardDescription></Card>
      </div>
      <DriverSummary drivers={drivers} />
      {error && <EmptyState title="Unable to update escrow records" body={error} />}
      <CodeHint code={codeHint} className="rounded-xl">
        <section className="grid gap-3" aria-label="Escrow records">
          {records.length === 0 ? (
            <EmptyState
              title={loading ? 'Loading escrow records' : 'No escrow records'}
              body={loading
                ? 'Subscribing to arbiter order and auction-bid state.'
                : 'Orders and auction bids naming this escrow will appear here.'}
            />
          ) : records.map(record => (
            <RecordCard
              key={`${record.kind}:${record.id}`}
              record={record}
              executing={executing}
              onExecute={(selectedRecord, action) => setPending({ record: selectedRecord, action })}
            />
          ))}
        </section>
      </CodeHint>
      <Dialog
        open={Boolean(pending)}
        onOpenChange={open => {
          if (!open && !confirming) setPending(undefined)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm escrow action</DialogTitle>
            <DialogDescription>
              {pending
                ? `${pending.action.label} for ${pending.record.kind === 'order' ? 'order' : 'auction bid'} ${shortPubkey(pending.record.tradeId)}. The driver will revalidate current payment and settlement state before submitting this financial action.`
                : 'Confirm the selected financial action.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button disabled={confirming} onClick={() => setPending(undefined)} variant="outline">Cancel</Button>
            <Button
              data-testid="escrow-confirm-action"
              disabled={confirming || Boolean(executing)}
              onClick={() => void confirmAction()}
              variant={pending?.action.id === 'refund' ? 'destructive' : 'default'}
            >
              {confirming ? 'Submitting…' : pending?.action.label ?? 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  )
}
