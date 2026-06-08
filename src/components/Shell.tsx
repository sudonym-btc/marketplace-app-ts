import type { ReactNode } from 'react'

import type { AppRoute, AppSession, LoadedMarketplace } from '../types'
import { routeHref } from '../state/routing'

type ShellProps = {
  route: AppRoute
  session?: AppSession
  marketplace?: LoadedMarketplace
  status: string
  loading: boolean
  error?: string
  onRefresh(): void
  onLogout(): void
  children: ReactNode
}

function navClass(route: AppRoute, name: AppRoute['name']): string {
  return route.name === name ? 'nav-link active' : 'nav-link'
}

export function Shell({ route, session, marketplace, status, loading, error, onRefresh, onLogout, children }: ShellProps) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#/">
          <span className="brand-mark">M</span>
          <span>Marketplace</span>
        </a>
        <nav>
          <a className={navClass(route, 'listings')} href={routeHref({ name: 'listings' })}>Listings</a>
          <a className={navClass(route, 'auctions')} href={routeHref({ name: 'auctions' })}>Auctions</a>
          <a className={navClass(route, 'my-listings')} href={routeHref({ name: 'my-listings' })}>My Listings</a>
          {session ? (
            <>
              <a className={navClass(route, 'inbox')} href={routeHref({ name: 'inbox' })}>Inbox</a>
              <a className={navClass(route, 'orders')} href={routeHref({ name: 'orders' })}>Orders</a>
              <a className={navClass(route, 'edit-listing')} href={routeHref({ name: 'edit-listing' })}>Add listing</a>
              <a className={navClass(route, 'settings')} href={routeHref({ name: 'settings' })}>Settings</a>
            </>
          ) : (
            <a className={navClass(route, 'login')} href={routeHref({ name: 'login' })}>Sign in</a>
          )}
        </nav>
        <div className="session-panel">
          <span className="label">Session</span>
          <strong>{session ? `${session.pubkey.slice(0, 8)}...${session.pubkey.slice(-6)}` : 'Logged out'}</strong>
          {marketplace && (
            <p>
              Next trade index {marketplace.nextTradeIndex}
              {marketplace.evm?.startSummary ? (
                <>
                  <br />
                  {marketplace.evm.startSummary}
                </>
              ) : null}
            </p>
          )}
          {session && (
            <button className="button secondary session-logout-button" type="button" onClick={onLogout}>
              Log out
            </button>
          )}
        </div>
      </aside>
      <main className={route.name === 'inbox' ? 'inbox-main' : undefined}>
        <header className="topbar">
          <div>
            <span className="label">Status</span>
            <strong>{loading ? 'Working...' : status}</strong>
          </div>
          <button className="button secondary" type="button" onClick={onRefresh} disabled={loading}>
            Refresh
          </button>
        </header>
        {error && <div className="notice error">{error}</div>}
        {children}
      </main>
    </div>
  )
}
