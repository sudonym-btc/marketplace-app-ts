import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { MenuIcon } from 'lucide-react'

import type { NavigationCounts } from '../../hooks/useMarketplaceData'
import type { AppSession, LoadedMarketplaceSession } from '../../types'
import { Button, Dialog, DialogContent, DialogTitle, cn } from '../ui'
import { SessionPanel } from './SessionPanel'

type AppSidebarProps = {
  session?: AppSession
  marketplaceSession?: LoadedMarketplaceSession
  navigationCounts: NavigationCounts
  status: string
  loading: boolean
  onLogout(): void
}

const activeProps = {
  className: 'flex w-full items-center justify-between rounded-md bg-sidebar-accent px-3 py-2 text-sm font-medium text-sidebar-accent-foreground',
}

const inactiveProps = {
  className: 'flex w-full items-center justify-between rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
}

function NavBadge({ count }: { count: number }) {
  return (
    <span
      aria-label={`${count} item${count === 1 ? '' : 's'}`}
      className="ml-3 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full border border-sidebar-border bg-sidebar-accent px-1.5 text-[11px] font-semibold leading-none text-sidebar-accent-foreground"
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}

function NavLinkWithBadge({
  count,
  onNavigate,
  to,
  children,
}: {
  children: ReactNode
  count: number
  onNavigate?: () => void
  to: '/my-orders' | '/my-bids' | '/orders'
}) {
  return (
    <Link activeProps={activeProps} inactiveProps={inactiveProps} onClick={onNavigate} to={to}>
      <span className="flex min-w-0 w-full items-center justify-between gap-3">
        <span className="truncate">{children}</span>
        <NavBadge count={count} />
      </span>
    </Link>
  )
}

function NavSection({
  children,
  title,
}: {
  children: ReactNode
  title: string
}) {
  return (
    <section className="grid gap-1">
      <h2 className="px-3 text-[11px] font-semibold uppercase tracking-wide text-sidebar-foreground/45">{title}</h2>
      <div className="grid gap-1">
        {children}
      </div>
    </section>
  )
}

function SidebarContent({
  loading,
  marketplaceSession,
  navigationCounts,
  onLogout,
  onNavigate,
  session,
  status,
}: AppSidebarProps & { onNavigate?: () => void }) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-6">
      <Link className="flex shrink-0 items-center gap-3 pr-8 font-semibold" onClick={onNavigate} to="/">
        <span className="grid size-9 place-items-center rounded-md bg-sidebar-primary text-sm font-bold text-sidebar-primary-foreground">
          M
        </span>
        <span>Marketplace</span>
      </Link>
      <nav className="grid min-h-0 flex-1 content-start gap-5 overflow-y-auto pr-1">
        <div className="grid gap-1">
          <Link activeOptions={{ exact: true }} activeProps={activeProps} inactiveProps={inactiveProps} onClick={onNavigate} to="/">Listings</Link>
          <Link activeProps={activeProps} inactiveProps={inactiveProps} onClick={onNavigate} to="/auctions">Auctions</Link>
          {session ? (
            <>
              <Link activeProps={activeProps} inactiveProps={inactiveProps} onClick={onNavigate} to="/inbox">Inbox</Link>
              <Link activeProps={activeProps} inactiveProps={inactiveProps} onClick={onNavigate} to="/settings">Settings</Link>
            </>
          ) : (
            <Link activeProps={activeProps} inactiveProps={inactiveProps} onClick={onNavigate} to="/login">Sign in</Link>
          )}
        </div>
        {session ? (
          <>
            <NavSection title="Buyer">
              <NavLinkWithBadge count={navigationCounts.myOrders} onNavigate={onNavigate} to="/my-orders">My Orders</NavLinkWithBadge>
              <NavLinkWithBadge count={navigationCounts.myBids} onNavigate={onNavigate} to="/my-bids">My Bids</NavLinkWithBadge>
            </NavSection>
            <NavSection title="Seller">
              <Link activeProps={activeProps} inactiveProps={inactiveProps} onClick={onNavigate} to="/my-listings">My Listings</Link>
              <NavLinkWithBadge count={navigationCounts.sellerOrders} onNavigate={onNavigate} to="/orders">Orders</NavLinkWithBadge>
            </NavSection>
          </>
        ) : null}
      </nav>
      <SessionPanel
        loading={loading}
        marketplaceSession={marketplaceSession}
        onLogout={onLogout}
        session={session}
        status={status}
      />
    </div>
  )
}

export function AppSidebar(props: AppSidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <>
      <aside className="sticky top-0 flex h-dvh max-h-dvh min-h-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar p-6 text-sidebar-foreground max-[860px]:hidden">
        <SidebarContent {...props} />
      </aside>

      <div className="sticky top-0 z-40 hidden h-14 items-center justify-between border-b border-border bg-background/95 px-4 text-foreground backdrop-blur supports-backdrop-filter:bg-background/80 max-[860px]:flex">
        <Button aria-label="Open navigation" onClick={() => setMobileOpen(true)} size="icon" variant="outline">
          <MenuIcon />
        </Button>
        <Link className="flex min-w-0 items-center gap-2 font-semibold" to="/">
          <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
            M
          </span>
          <span className="truncate">Marketplace</span>
        </Link>
        <span aria-hidden className="size-8" />
      </div>

      <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
        <DialogContent
          className="top-0 left-0 h-dvh w-[min(22rem,calc(100vw-2rem))] max-w-none translate-x-0 translate-y-0 rounded-none rounded-r-lg border-r border-sidebar-border bg-sidebar p-6 text-sidebar-foreground"
        >
          <DialogTitle className="sr-only">Navigation</DialogTitle>
          <SidebarContent {...props} onNavigate={() => setMobileOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  )
}

export function appShellClassName(isInbox: boolean): string {
  return cn(
    'min-h-dvh min-w-0 max-[860px]:min-h-[calc(100dvh-3.5rem)]',
    isInbox && 'flex h-dvh flex-col overflow-hidden max-[860px]:h-[calc(100dvh-3.5rem)]',
  )
}
