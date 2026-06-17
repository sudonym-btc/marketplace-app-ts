import { useEffect, useState } from 'react'
import type { AppSession, LoadedMarketplaceSession } from '../../types'
import { useMarketplaceValue } from '../../hooks/useMarketplaceValue'
import { fetchProfiles, type NostrProfile } from '../../nostr/profiles'
import { LoadingSpinner } from '../LoadingSpinner'
import { ProfileChip } from '../ProfileChip'
import { Button, Card } from '../ui'
import { Eyebrow } from './Eyebrow'

type SessionPanelProps = {
  session?: AppSession
  marketplaceSession?: LoadedMarketplaceSession
  status: string
  loading: boolean
  onLogout(): void
}

export function SessionPanel({ loading, marketplaceSession, onLogout, session, status }: SessionPanelProps) {
  const nextTradeIndex = useMarketplaceValue(marketplaceSession?.nextTradeIndex)
  const [profile, setProfile] = useState<NostrProfile>()

  useEffect(() => {
    if (!session) {
      setProfile(undefined)
      return
    }

    let closed = false
    setProfile(undefined)
    void fetchProfiles(session, [session.pubkey])
      .then(profiles => {
        if (!closed) setProfile(profiles.get(session.pubkey))
      })
      .catch(err => {
        console.warn('[marketplace-app] unable to fetch session profile', {
          pubkey: session.pubkey,
        }, err)
      })

    return () => {
      closed = true
    }
  }, [session])

  return (
    <Card className="min-w-0 shrink-0 border-sidebar-border bg-sidebar-accent p-4 text-sidebar-accent-foreground shadow-none">
      <Eyebrow className="text-sidebar-foreground/60">Session</Eyebrow>
      <div className="mt-3 min-w-0">
        {session ? <ProfileChip pubkey={session.pubkey} profile={profile} /> : <strong className="block text-sm font-semibold">Logged out</strong>}
      </div>
      <div className="mt-3 rounded-md border border-sidebar-border/70 bg-sidebar/60 p-3">
        <Eyebrow className="text-sidebar-foreground/60">Status</Eyebrow>
        <div className="mt-2 flex min-w-0 items-center gap-2 text-sm font-semibold">
          {loading && <LoadingSpinner label={status} />}
          <span className="truncate">{status}</span>
        </div>
      </div>
      {marketplaceSession && (
        <p className="mt-3 text-sm leading-6 text-sidebar-foreground/70 [overflow-wrap:anywhere]">
          Next trade index {nextTradeIndex ?? 'not discovered'}
        </p>
      )}
      {session && (
        <Button className="mt-3 w-full" onClick={onLogout} variant="secondary">
          Log out
        </Button>
      )}
    </Card>
  )
}
