import type { ReactNode } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { X } from 'lucide-react'

import type { AppNotification, AppSession, LoadedMarketplaceSession } from '../types'
import { useNavigationCounts } from '../hooks/useMarketplaceData'
import { Alert, AlertAction, AlertDescription, AlertTitle, Button } from './ui'
import { AppSidebar, appShellClassName } from './widgets/AppSidebar'

type ShellProps = {
  session?: AppSession
  marketplaceSession?: LoadedMarketplaceSession
  refreshRevision: number
  status: string
  loading: boolean
  error?: string
  notifications: AppNotification[]
  onLogout(): void
  onDismissNotification(id: number): void
  children: ReactNode
}

export function Shell({
  session,
  marketplaceSession,
  refreshRevision,
  status,
  loading,
  error,
  notifications,
  onLogout,
  onDismissNotification,
  children,
}: ShellProps) {
  const isInbox = useRouterState({ select: state => state.location.pathname === '/inbox' })
  const navigationCounts = useNavigationCounts(marketplaceSession, refreshRevision)

  return (
    <div className="grid min-h-dvh items-start grid-cols-[260px_minmax(0,1fr)] bg-muted/30 max-[860px]:grid-cols-1">
      <AppSidebar
        loading={loading}
        marketplaceSession={marketplaceSession}
        navigationCounts={navigationCounts}
        onLogout={onLogout}
        session={session}
        status={status}
      />
      <main className={appShellClassName(isInbox)}>
        {error && <Alert className="mx-7 mt-5" variant="destructive">{error}</Alert>}
        {notifications.length > 0 && (
          <div
            className="fixed right-5 top-5 z-50 grid w-[min(420px,calc(100vw-2.5rem))] gap-2"
            data-testid="notification-stack"
          >
            {notifications.map(notification => (
              <Alert
                key={notification.id}
                data-testid="app-notification"
                variant={notification.level === 'error' ? 'destructive' : 'default'}
              >
                <AlertTitle>{notification.title}</AlertTitle>
                {notification.message && <AlertDescription>{notification.message}</AlertDescription>}
                <AlertAction>
                  <Button
                    aria-label="Dismiss notification"
                    size="icon-xs"
                    variant="ghost"
                    onClick={() => onDismissNotification(notification.id)}
                  >
                    <X />
                  </Button>
                </AlertAction>
              </Alert>
            ))}
          </div>
        )}
        {children}
      </main>
    </div>
  )
}
