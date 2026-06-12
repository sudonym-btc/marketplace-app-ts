import type { NostrProfile } from '../nostr/profiles'
import { shortPubkey } from '../nostr/inboxThreads'
import { cn } from './ui'

type Props = {
  pubkey: string
  profile?: NostrProfile
  compact?: boolean
}

function profileName(pubkey: string, profile?: NostrProfile): string {
  return profile?.displayName || profile?.name || profile?.nip05 || shortPubkey(pubkey)
}

function fallbackInitial(pubkey: string, profile?: NostrProfile): string {
  return profileName(pubkey, profile).slice(0, 1).toUpperCase()
}

export function profileLabel(pubkey: string, profile?: NostrProfile): string {
  return profileName(pubkey, profile)
}

export function ProfileChip({ pubkey, profile, compact = false }: Props) {
  const name = profileName(pubkey, profile)
  return (
    <span
      className={cn(
        'inline-flex min-w-0 items-center gap-2 text-foreground',
        compact && 'max-w-52 rounded-full bg-muted py-1 pl-1 pr-2',
      )}
      title={pubkey}
    >
      {profile?.picture ? (
        <img
          className={cn('size-8 shrink-0 rounded-full bg-muted object-cover', compact && 'size-6')}
          src={profile.picture}
          alt=""
          loading="lazy"
        />
      ) : (
        <span
          className={cn(
            'grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-foreground',
            compact && 'size-6',
          )}
        >
          {fallbackInitial(pubkey, profile)}
        </span>
      )}
      <span className="grid min-w-0">
        <strong className="truncate text-sm font-semibold">{name}</strong>
        {!compact && <small className="truncate text-xs text-muted-foreground">{shortPubkey(pubkey)}</small>}
      </span>
    </span>
  )
}
