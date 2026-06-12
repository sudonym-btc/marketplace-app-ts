import type { ReactNode } from 'react'
import { useRouterState } from '@tanstack/react-router'

import type { AppSession, LoadedMarketplace } from '../types'
import { useNavigationCounts } from '../hooks/useMarketplaceData'
import { Alert } from './ui'
import { AppSidebar, appShellClassName } from './widgets/AppSidebar'

type ShellProps = {
  session?: AppSession
  marketplace?: LoadedMarketplace
  refreshRevision: number
  status: string
  loading: boolean
  error?: string
  onRefresh(): void
  onLogout(): void
  children: ReactNode
}

export function Shell({ session, marketplace, refreshRevision, status, loading, error, onRefresh, onLogout, children }: ShellProps) {
  const isInbox = useRouterState({ select: state => state.location.pathname === '/inbox' })
  const navigationCounts = useNavigationCounts(marketplace, session, refreshRevision)

  return (
    <div className="grid min-h-dvh items-start grid-cols-[260px_minmax(0,1fr)] bg-muted/30 max-[860px]:grid-cols-1">
      <AppSidebar
        loading={loading}
        marketplace={marketplace}
        navigationCounts={navigationCounts}
        onLogout={onLogout}
        onRefresh={onRefresh}
        session={session}
        status={status}
      />
      <main className={appShellClassName(isInbox)}>
        {error && <Alert className="mx-7 mt-5" variant="destructive">{error}</Alert>}
        {children}
      </main>
    </div>
  )
}
