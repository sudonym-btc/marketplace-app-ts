import type { AppConfig } from '../config/appConfig'
import type { AppSession, LoadedMarketplace, MarketplaceLogItem } from '../types'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui'
import { MarketplaceLogPanel } from '../components/widgets/MarketplaceLogPanel'
import { Page, PageHeader } from '../components/widgets/PageLayout'
import { CodeHintsControl } from '../components/widgets/CodeHintsControl'
import { ThemeModeControl } from '../components/widgets/ThemeModeControl'
import { TrustedArbitersSettings } from '../components/widgets/TrustedArbitersSettings'

type Props = {
  config: AppConfig
  marketplaceLog: MarketplaceLogItem[]
  session?: AppSession
  marketplace?: LoadedMarketplace
  onClearMarketplaceLog(): void
  onPaymentMethodUpdated(): void | Promise<void>
}

export function SettingsPage({
  config,
  marketplaceLog,
  session,
  marketplace,
  onClearMarketplaceLog,
  onPaymentMethodUpdated,
}: Props) {
  return (
    <Page>
      <PageHeader eyebrow="Runtime" title="Settings" />
      <div className="grid grid-cols-2 gap-4 max-[860px]:grid-cols-1">
        <ThemeModeControl />
        <CodeHintsControl />
        <TrustedArbitersSettings
          autoTrustedArbiterPubkeys={config.autoTrustArbiterPubkeys}
          marketplace={marketplace}
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
            <p className="text-sm text-muted-foreground">{marketplace?.evm?.startSummary}</p>
          </CardContent>
        </Card>
        <MarketplaceLogPanel entries={marketplaceLog} onClear={onClearMarketplaceLog} />
      </div>
    </Page>
  )
}
