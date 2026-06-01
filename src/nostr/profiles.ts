import type { Event } from 'nostr-tools/core'
import * as kinds from 'nostr-tools/kinds'

import type { AppSession } from '../types'

export type NostrProfile = {
  pubkey: string
  name?: string
  displayName?: string
  picture?: string
  nip05?: string
  about?: string
}

const profileChunkSize = 200

function uniquePubkeys(pubkeys: Iterable<string>): string[] {
  return [...new Set([...pubkeys].filter(Boolean))]
}

function chunks<T>(values: T[], size: number): T[][] {
  const output: T[][] = []
  for (let index = 0; index < values.length; index += size) output.push(values.slice(index, index + size))
  return output
}

function parseProfile(pubkey: string, event: Event): NostrProfile {
  try {
    const json = JSON.parse(event.content) as Record<string, unknown>
    const name = typeof json.name === 'string' ? json.name : undefined
    const displayName = typeof json.display_name === 'string'
      ? json.display_name
      : typeof json.displayName === 'string'
        ? json.displayName
        : undefined
    const picture = typeof json.picture === 'string'
      ? json.picture
      : typeof json.image === 'string'
        ? json.image
        : undefined
    const nip05 = typeof json.nip05 === 'string' ? json.nip05 : undefined
    const about = typeof json.about === 'string' ? json.about : undefined
    return { pubkey, name, displayName, picture, nip05, about }
  } catch (err) {
    console.warn('[marketplace-app] unable to parse profile metadata', { pubkey, eventId: event.id }, err)
    return { pubkey }
  }
}

function newerProfileEvent(current: Event | undefined, candidate: Event): boolean {
  if (!current) return true
  if (candidate.created_at !== current.created_at) return candidate.created_at > current.created_at
  return candidate.id < current.id
}

export async function fetchProfiles(session: AppSession, pubkeys: string[]): Promise<Map<string, NostrProfile>> {
  const requested = uniquePubkeys(pubkeys)
  if (requested.length === 0) return new Map()
  console.debug('[marketplace-app] fetching profiles', {
    pubkeyCount: requested.length,
    relayCount: session.relays.length,
  })
  const latest = new Map<string, Event>()
  await Promise.all(chunks(requested, profileChunkSize).map(async authors => {
    const events = await session.pool.querySync(
      session.relays,
      {
        kinds: [kinds.Metadata],
        authors,
        limit: authors.length * 3,
      },
      { maxWait: 1500 },
    )
    for (const event of events) {
      if (event.kind !== kinds.Metadata) continue
      if (!authors.includes(event.pubkey)) continue
      if (newerProfileEvent(latest.get(event.pubkey), event)) latest.set(event.pubkey, event)
    }
  }))

  const profiles = new Map<string, NostrProfile>()
  for (const pubkey of requested) {
    const event = latest.get(pubkey)
    profiles.set(pubkey, event ? parseProfile(pubkey, event) : { pubkey })
  }
  console.debug('[marketplace-app] fetched profiles', {
    requestedCount: requested.length,
    foundCount: latest.size,
  })
  return profiles
}
