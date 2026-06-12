import type * as marketplace from 'nostr-tools/marketplace'

import { shortPubkey } from '../../nostr/inboxThreads'
import type { NostrProfile } from '../../nostr/profiles'
import { ProfileChip } from '../ProfileChip'

type Props = {
  arbiterPubkey?: string
  fallback: string
  profile?: NostrProfile
  route?: marketplace.MarketplacePaymentRoute
  serviceType?: string
  summary?: string
}

export function paymentRouteSummary(
  route: marketplace.MarketplacePaymentRoute | undefined,
  serviceType?: string,
): string | undefined {
  if (!route) return undefined
  const type = serviceType ?? route.arbitrationService.content.type
  return `${route.policy.method.toUpperCase()} / ${route.asset.denomination}${type ? ` via ${type}` : ''}`
}

function assetSummary(route: marketplace.MarketplacePaymentRoute): string {
  return [
    route.asset.denomination,
    route.asset.chainId !== undefined ? `chain ${route.asset.chainId}` : undefined,
    route.asset.assetId ? shortPubkey(route.asset.assetId) : undefined,
  ].filter(Boolean).join(' / ')
}

export function PaymentRouteSummary({
  arbiterPubkey,
  fallback,
  profile,
  route,
  serviceType,
  summary,
}: Props) {
  const routeLabel = summary ?? paymentRouteSummary(route, serviceType)
  return (
    <div className="flex min-w-0 items-center justify-between gap-4 rounded-lg border bg-muted/50 p-3 max-[860px]:items-stretch max-[860px]:flex-col">
      {arbiterPubkey ? (
        <ProfileChip pubkey={arbiterPubkey} profile={profile} />
      ) : (
        <span className="text-sm font-medium text-foreground">Arbiter</span>
      )}
      {route ? (
        <div className="grid min-w-0 gap-1 text-right text-sm leading-6 max-[860px]:text-left">
          <span className="font-medium text-foreground [overflow-wrap:anywhere]">{routeLabel}</span>
          <span className="text-muted-foreground [overflow-wrap:anywhere]">
            {assetSummary(route)}
          </span>
        </div>
      ) : (
        <p className="m-0 text-right text-sm leading-6 text-muted-foreground max-[860px]:text-left">
          {fallback}
        </p>
      )}
    </div>
  )
}
