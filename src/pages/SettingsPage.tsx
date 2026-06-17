import type { AppConfig } from '../config/appConfig'
import type { AppSession, LoadedMarketplaceSession, MarketplaceLogItem } from '../types'
import type * as marketplace from 'nostr-tools/marketplace'
import { RefreshCwIcon } from 'lucide-react'

import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '../components/ui'
import { useMarketplaceValue } from '../hooks/useMarketplaceValue'
import { MarketplaceLogPanel } from '../components/widgets/MarketplaceLogPanel'
import { Page, PageHeader } from '../components/widgets/PageLayout'
import { CodeHintsControl } from '../components/widgets/CodeHintsControl'
import { ThemeModeControl } from '../components/widgets/ThemeModeControl'
import { TrustedArbitersSettings } from '../components/widgets/TrustedArbitersSettings'

type Props = {
  config: AppConfig
  marketplaceLog: MarketplaceLogItem[]
  session?: AppSession
  marketplaceSession?: LoadedMarketplaceSession
  loading?: boolean
  onClearMarketplaceLog(): void
  onPaymentMethodUpdated(): void | Promise<void>
  onRefresh(): void | Promise<void>
}

export function SettingsPage({
  config,
  marketplaceLog,
  session,
  marketplaceSession,
  loading = false,
  onClearMarketplaceLog,
  onPaymentMethodUpdated,
  onRefresh,
}: Props) {
  return (
    <Page>
      <PageHeader eyebrow="Runtime" title="Settings" />
      <div className="grid grid-cols-2 gap-4 max-[860px]:grid-cols-1">
        <ThemeModeControl />
        <CodeHintsControl />
        <Card>
          <CardHeader><CardTitle>Marketplace</CardTitle></CardHeader>
          <CardContent>
            <Button disabled={loading} onClick={onRefresh} variant="secondary">
              <RefreshCwIcon className={loading ? 'animate-spin' : undefined} aria-hidden />
              Refresh
            </Button>
          </CardContent>
        </Card>
        <DriverRecoveryPanel drivers={marketplaceSession?.drivers.all ?? []} />
        <TrustedArbitersSettings
          autoTrustedArbiterPubkeys={config.autoTrustArbiterPubkeys}
          marketplaceSession={marketplaceSession}
          session={session}
          onUpdated={onPaymentMethodUpdated}
        />
        <Card>
          <CardHeader><CardTitle>Nostr</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{session?.pubkey ?? 'Not logged in'}</p>
            <code className="whitespace-pre-wrap rounded-md bg-muted px-2 py-1 text-sm [overflow-wrap:anywhere]">{config.relays.join('\n')}</code>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>NIP-46</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{config.signetUrl ?? 'No local Signet URL configured'}</p>
            <code className="whitespace-pre-wrap rounded-md bg-muted px-2 py-1 text-sm [overflow-wrap:anywhere]">{config.nip46Relays.join('\n')}</code>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>EVM</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            <p className="text-sm text-muted-foreground">{config.evm.enabled ? `${config.evm.chainName} (${config.evm.chainId})` : 'Disabled'}</p>
            <code className="rounded-md bg-muted px-2 py-1 text-sm [overflow-wrap:anywhere]">{config.evm.rpcUrl || 'No RPC configured'}</code>
          </CardContent>
        </Card>
        <MarketplaceLogPanel entries={marketplaceLog} onClear={onClearMarketplaceLog} />
      </div>
    </Page>
  )
}

function DriverRecoveryPanel({ drivers }: { drivers: marketplace.MarketplaceSessionDriver[] }) {
  return (
    <Card className="col-span-2 max-[860px]:col-span-1">
      <CardHeader>
        <CardTitle>Drivers</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {drivers.length ? (
          drivers.map(driver => <DriverRecoveryRow driver={driver} key={`${driver.kind}:${driver.id}`} />)
        ) : (
          <p className="text-sm text-muted-foreground">No drivers configured</p>
        )}
      </CardContent>
    </Card>
  )
}

function DriverRecoveryRow({ driver }: { driver: marketplace.MarketplaceSessionDriver }) {
  const state = useMarketplaceValue(driver.state)
  const recovery = useMarketplaceValue(driver.recovery)
  const events = useMarketplaceValue(driver.recoveryStream.snapshot) ?? []
  const latestEvent = events.at(-1)
  const status = state?.status ?? 'idle'

  return (
    <div className="grid gap-3 rounded-md border border-border/70 bg-muted/20 p-3">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="font-medium">{driver.label}</span>
            <Badge variant={status === 'error' ? 'destructive' : status === 'ready' ? 'secondary' : 'outline'}>
              {status}
            </Badge>
          </div>
          <code className="mt-1 block text-xs text-muted-foreground [overflow-wrap:anywhere]">{driver.id}</code>
        </div>
        <Badge variant="outline">{driver.kind}</Badge>
      </div>
      <div className="grid grid-cols-4 gap-2 max-[720px]:grid-cols-2">
        <DriverRecoveryFact label="Active" value={recovery?.active ?? 0} />
        <DriverRecoveryFact label="Resumed" value={recovery?.resumed ?? 0} />
        <DriverRecoveryFact label="Settled" value={recovery?.settled ?? 0} />
        <DriverRecoveryFact label="Failed" value={recovery?.failed ?? 0} />
      </div>
      <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
        {latestEvent ? latestRecoveryEventText(latestEvent) : 'No recovery events'}
      </p>
    </div>
  )
}

function DriverRecoveryFact({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="text-base font-semibold tabular-nums">{value}</div>
    </div>
  )
}

function latestRecoveryEventText(event: marketplace.MarketplaceSessionDriverRecoveryEvent): string {
  if (event.type === 'progress') return event.status
  if (event.type === 'failed') return event.error
  return event.type
}
