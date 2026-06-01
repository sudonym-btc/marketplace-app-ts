import type { NostrProfile } from '../nostr/profiles'
import { shortPubkey } from '../nostr/inboxThreads'

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
    <span className={`profile-chip${compact ? ' compact' : ''}`} title={pubkey}>
      {profile?.picture ? (
        <img src={profile.picture} alt="" loading="lazy" />
      ) : (
        <span className="profile-fallback">{fallbackInitial(pubkey, profile)}</span>
      )}
      <span>
        <strong>{name}</strong>
        {!compact && <small>{shortPubkey(pubkey)}</small>}
      </span>
    </span>
  )
}
