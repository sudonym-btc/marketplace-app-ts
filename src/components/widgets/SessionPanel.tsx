import type { AppSession, LoadedMarketplace } from '../../types'
import { LoadingSpinner } from '../LoadingSpinner'
import { Button, Card } from '../ui'
import { Eyebrow } from './Eyebrow'

type SessionPanelProps = {
  session?: AppSession
  marketplace?: LoadedMarketplace
  status: string
  loading: boolean
  onRefresh(): void
  onLogout(): void
}

export function SessionPanel({ loading, marketplace, onLogout, onRefresh, session, status }: SessionPanelProps) {
  return (
    <Card className="min-w-0 shrink-0 border-sidebar-border bg-sidebar-accent p-4 text-sidebar-accent-foreground shadow-none">
      <Eyebrow className="text-sidebar-foreground/60">Session</Eyebrow>
      <strong className="mt-2 block truncate text-sm font-semibold">
        {session ? `${session.pubkey.slice(0, 8)}...${session.pubkey.slice(-6)}` : 'Logged out'}
      </strong>
      <div className="mt-3 rounded-md border border-sidebar-border/70 bg-sidebar/60 p-3">
        <Eyebrow className="text-sidebar-foreground/60">Status</Eyebrow>
        <div className="mt-2 flex min-w-0 items-center gap-2 text-sm font-semibold">
          {loading && <LoadingSpinner label={status} />}
          <span className="truncate">{status}</span>
        </div>
      </div>
      {marketplace && (
        <p className="mt-3 text-sm leading-6 text-sidebar-foreground/70 [overflow-wrap:anywhere]">
          Next trade index {marketplace.nextTradeIndex}
          {marketplace.evm?.startSummary ? (
            <>
              <br />
              {marketplace.evm.startSummary}
            </>
          ) : null}
        </p>
      )}
      <Button className="mt-3 w-full" disabled={loading} onClick={onRefresh} variant="secondary">
        Refresh
      </Button>
      {session && (
        <Button className="mt-3 w-full" onClick={onLogout} variant="secondary">
          Log out
        </Button>
      )}
    </Card>
  )
}
